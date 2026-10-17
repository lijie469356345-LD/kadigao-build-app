import sql from 'mssql';
import { getPool } from '../../config/db';

// 旧表名 → 新表名的映射
const MIGRATIONS: Record<string, string> = {
  'CoachingStores': 'CoachingStores',
  'DailyShopTargets': 'DailyShopTargets',
  'DataExtraction': 'DataExtraction',
  'DirectSalesSummary': 'DirectSalesSummary',
  'FeedbackTasks': 'FeedbackTasks',
  'FeedbackDetails': 'FeedbackDetails',
  'MonthlyTargetDecomposition': 'MonthlyTargetDecomposition',
  'MonthlyTargetDaily': 'MonthlyTargetDaily',
  'MonthlyTargetChangeRequest': 'MonthlyTargetChangeRequest',
  'StaffMonthlyTarget': 'StaffMonthlyTarget',
  'StaffMonthlyTargetDaily': 'StaffMonthlyTargetDaily',
  'WechatPushRecipients': 'WechatPushRecipients',
  'WechatPushLogs': 'WechatPushLogs',
  'WechatPushSettings': 'WechatPushSettings',
  'WechatPushTemplate': 'WechatPushTemplate',
  'WechatPushHistory': 'WechatPushHistory',
  'StoreInspectionLogs': 'StoreInspectionLogs',
  'StoreInspectionLogItems': 'StoreInspectionLogItems',
  'InspectionTasks': 'InspectionTasks',
  'DailyScores': 'DailyScores',
  'SalesComparison': 'LD_SalesComparison',
  'WechatPushConfig': 'WechatPushConfig',
  '线上调拨记录': '线上调拨记录',
};

// 自动建表：原本没有建表语句的表
async function ensureLegacyTables(pool: sql.ConnectionPool) {
  // StoreInspectionLogs
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'StoreInspectionLogs')
    CREATE TABLE StoreInspectionLogs (
      id INT IDENTITY(1,1) PRIMARY KEY,
      supervisor NVARCHAR(100),
      date DATE,
      departure NVARCHAR(200),
      destination NVARCHAR(200),
      arrivalTime NVARCHAR(50),
      departureTime NVARCHAR(50),
      remarks NVARCHAR(MAX),
      signature NVARCHAR(MAX),
      userId NVARCHAR(100),
      userName NVARCHAR(100),
      status NVARCHAR(20) DEFAULT 'draft',
      createdAt DATETIME DEFAULT GETDATE(),
      checkInPhoto NVARCHAR(MAX),
      checkOutPhoto NVARCHAR(MAX),
      shareToAll INT DEFAULT 0
    )
  `);

  // StoreInspectionLogItems
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'StoreInspectionLogItems')
    CREATE TABLE StoreInspectionLogItems (
      id INT IDENTITY(1,1) PRIMARY KEY,
      logId INT NOT NULL,
      moduleType NVARCHAR(50),
      moduleTypeName NVARCHAR(50),
      itemIndex INT,
      itemContent NVARCHAR(MAX),
      itemResult NVARCHAR(MAX),
      photoPath NVARCHAR(MAX),
      photoName NVARCHAR(200)
    )
  `);

  // InspectionTasks
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'InspectionTasks')
    CREATE TABLE InspectionTasks (
      id INT IDENTITY(1,1) PRIMARY KEY,
      title NVARCHAR(200),
      description NVARCHAR(MAX),
      assignedTo NVARCHAR(100),
      assignedToName NVARCHAR(100),
      shops NVARCHAR(MAX),
      shopNames NVARCHAR(MAX),
      deadline DATE,
      status NVARCHAR(20) DEFAULT 'pending',
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE()
    )
  `);

  // DailyScores
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DailyScores')
    CREATE TABLE DailyScores (
      id INT IDENTITY(1,1) PRIMARY KEY,
      userId NVARCHAR(100),
      userName NVARCHAR(100),
      date NVARCHAR(20),
      salesGrowthScore INT DEFAULT 0,
      quantityGrowthScore INT DEFAULT 0,
      orderCountGrowthScore INT DEFAULT 0,
      avgOrderValueGrowthScore INT DEFAULT 0,
      avgItemPriceGrowthScore INT DEFAULT 0,
      attachmentRateGrowthScore INT DEFAULT 0,
      giftPackageCountGrowthScore INT DEFAULT 0,
      giftPackageAmountGrowthScore INT DEFAULT 0,
      totalScore DECIMAL(10,2),
      finalScore DECIMAL(10,2),
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);

  // SalesComparison
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'LD_SalesComparison')
    CREATE TABLE LD_SalesComparison (
      id INT IDENTITY(1,1) PRIMARY KEY,
      date DATE,
      supervisor NVARCHAR(100),
      salesGrowth DECIMAL(10,4),
      quantityGrowth DECIMAL(10,4),
      orderCountGrowth DECIMAL(10,4),
      avgOrderValueGrowth DECIMAL(10,4),
      avgItemPriceGrowth DECIMAL(10,4),
      attachmentRateGrowth DECIMAL(10,4),
      giftPackageCountGrowth DECIMAL(10,4),
      giftPackageAmountGrowth DECIMAL(10,4)
    )
  `);

  // 迁移现有数据库：将照片字段从 NVARCHAR(500) 扩展为 NVARCHAR(MAX)
  // 压缩后的 Base64 图片约 270KB 字符串，需要 MAX 类型
  try {
    await pool.request().query(`
      IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('StoreInspectionLogs') AND name = 'checkInPhoto' AND max_length >= 0)
        ALTER TABLE StoreInspectionLogs ALTER COLUMN checkInPhoto NVARCHAR(MAX)
    `);
    await pool.request().query(`
      IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('StoreInspectionLogs') AND name = 'checkOutPhoto' AND max_length >= 0)
        ALTER TABLE StoreInspectionLogs ALTER COLUMN checkOutPhoto NVARCHAR(MAX)
    `);
    await pool.request().query(`
      IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('StoreInspectionLogItems') AND name = 'photoPath' AND max_length >= 0)
        ALTER TABLE StoreInspectionLogItems ALTER COLUMN photoPath NVARCHAR(MAX)
    `);
    console.log('照片字段迁移完成：NVARCHAR(500) -> NVARCHAR(MAX)');
  } catch (err) {
    console.log('照片字段迁移跳过（可能已是最新）:', (err as Error).message);
  }
}

// 幂等加列：列不存在则 ALTER TABLE 追加（新列默认 NULL，旧数据按原逻辑兜底，不破坏兼容）
async function addColumnIfMissing(pool: sql.ConnectionPool, table: string, col: string, def: string) {
  await pool.request()
    .input('t', sql.NVarChar, table)
    .input('c', sql.NVarChar, col)
    .input('def', sql.NVarChar, def)
    .query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(@t) AND name = @c)
      BEGIN
        DECLARE @s NVARCHAR(MAX) = N'ALTER TABLE ' + QUOTENAME(@t) + N' ADD ' + QUOTENAME(@c) + N' ' + @def;
        EXEC sp_executesql @s;
      END
    `);
}

// 现有权限表兼容升级：仅 LD_Zxtmh（门户菜单注册表）
// 注：UserGroups/GroupPermissions/PositionModules 已随 v3 组织权限隔离方案整体下线，
//     不再做任何 ALTER/建表/迁移操作，统一由 sys_* 标准四表 + portalRegistry 承担。
async function ensurePermissionCompatColumns(pool: sql.ConnectionPool) {
  // LD_Zxtmh（门户菜单注册表）：增加排序字段（门户/菜单结构由 portal_registry 同源维护）
  await addColumnIfMissing(pool, 'LD_Zxtmh', 'menu_order', 'INT NULL');

  console.log('[Migration] 权限表兼容列检查完成（仅 LD_Zxtmh）');
}

// ============================================================
// 【2026-09】用户全表：删「店铺」列 → 增「组织」列（用户管理口径一致同步）
//  权威源：sys_user_role 主行（user_code + MIN(id) 且 org_id 非空）→ sys_org.org_name
//  迁移顺序（全程幂等，可反复执行）：
//    1) 加「组织」列（不存在才加）
//    2) 按 sys_user_role 主行绑定回填 组织 = org_name（该用户有角色绑定）
//    3) 兜底：仍无组织但旧「店铺」列有值 → 组织 = 店铺旧值（保留历史信息不丢失）
//    4) 删「店铺」列（若被索引/约束依赖则跳过并提示，不阻断服务）
// ============================================================
async function migrateUserTableOrgColumn(pool: sql.ConnectionPool) {
  // 1) 加「组织」列
  await addColumnIfMissing(pool, '用户全', '组织', 'NVARCHAR(200) NULL');

  // 2) 按 sys_user_role 主行绑定回填（与用户管理「配置组织与角色」展示口径一致）
  const backfill = await pool.request().query(`
    UPDATE 用户全
    SET 组织 = o.org_name
    FROM 用户全 u
    JOIN (
      SELECT user_code, MIN(id) AS mid
      FROM sys_user_role
      WHERE org_id IS NOT NULL
      GROUP BY user_code
    ) t ON t.user_code = u.用户代码
    JOIN sys_user_role ur ON ur.id = t.mid
    JOIN sys_org o ON o.org_id = ur.org_id AND o.del_flag = 0
    WHERE ISNULL(u.组织, '') <> o.org_name
  `);
  console.log(`[Migration] 用户全.组织 按角色绑定回填 ${backfill.rowsAffected[0]} 行`);

  // 3) 兜底：旧「店铺」列值迁入「组织」列（仅当店铺列仍存在且组织列为空）
  try {
    const colCheck = await pool.request().query(`SELECT COL_LENGTH('用户全', '店铺') AS len`);
    if (colCheck.recordset[0]?.len != null) {
      const fallback = await pool.request().query(`
        UPDATE 用户全
        SET 组织 = 店铺
        WHERE ISNULL(组织, '') = '' AND ISNULL(店铺, '') <> ''
      `);
      console.log(`[Migration] 用户全.组织 店铺旧值兜底 ${fallback.rowsAffected[0]} 行`);
    }
  } catch (e: any) {
    console.log('[Migration] 店铺旧值兜底跳过:', e.message);
  }

  // 4) 删「店铺」列（先检查是否有索引/引用依赖，避免 ALTER 被阻塞）
  const depCheck = await pool.request().query(`
    SELECT COUNT(*) AS n
    FROM sys.index_columns ic
    JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
    WHERE i.object_id = OBJECT_ID('用户全') AND c.name = '店铺'
  `);
  const depRefs = await pool.request().query(`
    SELECT COUNT(*) AS n FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
    JOIN sys.columns c ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
    WHERE fkc.parent_object_id = OBJECT_ID('用户全') AND c.name = '店铺'
  `);
  if ((depCheck.recordset[0]?.n || 0) === 0 && (depRefs.recordset[0]?.n || 0) === 0) {
    const del = await pool.request().query(`
      IF COL_LENGTH('用户全', '店铺') IS NOT NULL ALTER TABLE 用户全 DROP COLUMN 店铺
    `);
    console.log('[Migration] 用户全.店铺 列已删除，rowsAffected:', del.rowsAffected.length >= 0 ? 'OK' : 'SKIP');
  } else {
    console.log(`[Migration] 用户全.店铺 列存在依赖（索引 ${depCheck.recordset[0]?.n} / 外键 ${depRefs.recordset[0]?.n}），跳过删除，服务不受影响`);
  }
    console.log('[Migration] 用户全 组织列迁移完成（幂等）');
}

// 用户全表：增加时间列（创建时间/更新时间/最后登录时间）
export async function ensureUserTimeColumns() {
  try {
    const pool = await getPool();
    // 创建时间
    try {
      await pool.request().query(`IF COL_LENGTH('用户全','创建时间') IS NULL ALTER TABLE 用户全 ADD 创建时间 DATETIME DEFAULT GETDATE()`);
    } catch (e: any) { console.log('[Migration] 用户全.创建时间 已存在或跳过:', e.message); }
    // 更新时间
    try {
      await pool.request().query(`IF COL_LENGTH('用户全','更新时间') IS NULL ALTER TABLE 用户全 ADD 更新时间 DATETIME DEFAULT GETDATE()`);
    } catch (e: any) { console.log('[Migration] 用户全.更新时间 已存在或跳过:', e.message); }
    // 最后登录时间
    try {
      await pool.request().query(`IF COL_LENGTH('用户全','最后登录时间') IS NULL ALTER TABLE 用户全 ADD 最后登录时间 DATETIME NULL`);
    } catch (e: any) { console.log('[Migration] 用户全.最后登录时间 已存在或跳过:', e.message); }
    // 回填存量行：创建时间和更新时间为 NULL 时设为当前时间
    try {
      const bf = await pool.request().query(`UPDATE 用户全 SET 创建时间 = GETDATE() WHERE 创建时间 IS NULL`);
      if (bf.rowsAffected[0] > 0) console.log(`[Migration] 用户全.创建时间 回填 ${bf.rowsAffected[0]} 行`);
    } catch (e: any) { console.log('[Migration] 用户全.创建时间 回填跳过:', e.message); }
    try {
      const bf2 = await pool.request().query(`UPDATE 用户全 SET 更新时间 = GETDATE() WHERE 更新时间 IS NULL`);
      if (bf2.rowsAffected[0] > 0) console.log(`[Migration] 用户全.更新时间 回填 ${bf2.rowsAffected[0]} 行`);
    } catch (e: any) { console.log('[Migration] 用户全.更新时间 回填跳过:', e.message); }
    console.log('[Migration] 用户全 时间列检查完成（幂等）');
  } catch (e: any) {
    console.log('[Migration] 用户全时间列迁移失败:', e.message);
  }
}

export async function runAllMigrations() {
  try {
    const pool = await getPool();
    // 推送三表 sourceId 列迁移：INT -> NVARCHAR(100)（支持字符串主键如商品代码）
    const pushTables = ['WechatPushLogsV2', 'WechatPushHistoryV2', 'WechatPushQueue'];
    for (const t of pushTables) {
      try {
        const colInfo = await pool.request().input('t', sql.NVarChar, t)
          .query(`SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @t AND COLUMN_NAME = 'sourceId'`);
        const dataType = colInfo.recordset?.[0]?.DATA_TYPE;
        if (dataType === 'int') {
          // 先删除引用该列的普通索引（避免 ALTER 被索引依赖阻塞），之后重建
          const idxs = await pool.request().input('t', sql.NVarChar, t).query(
            `SELECT i.name AS indexName, i.is_primary_key, i.is_unique_constraint
             FROM sys.indexes i
             JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
             JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
             WHERE i.object_id = OBJECT_ID(@t) AND c.name = 'sourceId'`);
          for (const ix of idxs.recordset || []) {
            if (ix.is_primary_key || ix.is_unique_constraint) continue;
            try {
              await pool.request().query(`DROP INDEX [${ix.indexName}] ON ${t}`);
            } catch { /* 索引可能已不存在 */ }
          }
          await pool.request().query(`ALTER TABLE ${t} ALTER COLUMN sourceId NVARCHAR(100) NOT NULL`);
          console.log(`[Migration] ${t}.sourceId 已迁移: INT -> NVARCHAR(100)`);
          if (t === 'WechatPushLogsV2') {
            await pool.request().query(`CREATE NONCLUSTERED INDEX IX_WPLV2_Source ON WechatPushLogsV2 (sourceId, moduleCode)`).catch(() => {});
          }
          if (t === 'WechatPushQueue') {
            await pool.request().query(`CREATE NONCLUSTERED INDEX IX_WPQ_Module ON WechatPushQueue (moduleCode, sourceId)`).catch(() => {});
          }
        }
      } catch (e: any) { console.log(`[Migration] ${t}.sourceId 迁移跳过:`, e.message); }
    }
    // 反向迁移：将 LD_ 前缀表名恢复为原始表名
    const reverseMap: Record<string, string> = {
      'LD_CoachingStores': 'CoachingStores',
      'LD_DailyShopTargets': 'DailyShopTargets',
      'LD_DataExtraction': 'DataExtraction',
      'LD_DirectSalesSummary': 'DirectSalesSummary',
      'LD_FeedbackTasks': 'FeedbackTasks',
      'LD_FeedbackDetails': 'FeedbackDetails',
      'LD_MonthlyTargetDecomposition': 'MonthlyTargetDecomposition',
      'LD_MonthlyTargetDaily': 'MonthlyTargetDaily',
      'LD_MonthlyTargetChangeRequest': 'MonthlyTargetChangeRequest',
      'LD_StaffMonthlyTarget': 'StaffMonthlyTarget',
      'LD_StaffMonthlyTargetDaily': 'StaffMonthlyTargetDaily',
      'LD_WechatPushRecipients': 'WechatPushRecipients',
      'LD_WechatPushLogs': 'WechatPushLogs',
      'LD_WechatPushSettings': 'WechatPushSettings',
      'LD_WechatPushTemplate': 'WechatPushTemplate',
      'LD_WechatPushHistory': 'WechatPushHistory',
      'LD_WechatPushConfig': 'WechatPushConfig',
      'LD_StoreInspectionLogs': 'StoreInspectionLogs',
      'LD_StoreInspectionLogItems': 'StoreInspectionLogItems',
      'LD_InspectionTasks': 'InspectionTasks',
      'LD_DailyScores': 'DailyScores',
      'LD_线上调拨记录': '线上调拨记录',
    };
    for (const [ldName, origName] of Object.entries(reverseMap)) {
      try {
        const exists = await pool.request().input('name', sql.NVarChar, ldName)
          .query(`SELECT COUNT(*) as cnt FROM sys.tables WHERE name = @name`);
        if (exists.recordset[0].cnt > 0) {
          await pool.request().query(`EXEC sp_rename '${ldName}', '${origName}'`);
          console.log(`Reverse migrated: ${ldName} → ${origName}`);
        }
      } catch (e: any) { console.log(`Skip ${ldName}: ${e.message}`); }
    }
    console.log('Reverse migration completed');
    // 权限表兼容升级（幂等加列，须在反向迁移与门户注册之后）
    await ensurePermissionCompatColumns(pool);
    // 用户全表：删「店铺」列 → 增「组织」列（用户管理与角色绑定一致同步）
    await migrateUserTableOrgColumn(pool);
    // 用户全表：增加时间列（创建时间/更新时间/最后登录时间）
    await ensureUserTimeColumns();
  } catch (e: any) { console.log('Migration failed:', e.message); }
}
