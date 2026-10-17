import sql from 'mssql';
import { getPool } from '../../config/db';
import {
  ORG_TREE_V3, ROLE_SEEDS_V3, MENU_GRANTS_V3, USER_SEEDS_V3,
} from './v3SeedData';
import { backfillAdminOrgBindings } from './adminOrgSync';

// ============================================================
// 标准化权限模型：四张核心表（sys_org / sys_role / sys_role_menu / sys_user_role）
// v3 定稿落地版（2026-09-11）+ 页面化改造（2026-09-12）：
//  - sys_org       组织树（公司/总监/组/督导组/经销商/门店组/shop），店铺归属= org_type='shop' 叶子
//  - sys_role      17 角色（replace 旧 8 角色，保留历史行防引用悬空）
//  - sys_role_menu 菜单授权（唯一授权源）
//  - sys_user_role 用户-角色-组织绑定（一人多角色并集 / 页面可维护）
// ────────────────────────────────────────────────────────────
// 种子策略（页面化核心改动）：
//  结构（建表/加列/加索引）永远幂等执行，不碰数据；
//  数据（组织树/角色/菜单授权/用户角色）仅在目标表为空时播种；
//  新菜单授权（从未在 sys_role_menu 出现过的 menu_en）按种子矩阵自动补种一次；
//  ⇒ 页面在四表上的任何修改（增删改组织/改授权/调角色）重启后都不会被覆盖。
// ============================================================

// ============================================================
// 建表（幂等）：sys_org
// ============================================================
async function ensureTableSysOrg(pool: sql.ConnectionPool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'sys_org')
    CREATE TABLE sys_org (
      org_id INT IDENTITY(1,1) PRIMARY KEY,
      parent_org_id INT NULL,
      org_name NVARCHAR(200) NOT NULL,
      org_type NVARCHAR(50) NOT NULL,       -- company/director/group/supervisor_group/dealer_group/shop_group/shop
      org_level INT NOT NULL DEFAULT 1,
      ancestors NVARCHAR(900) NULL,          -- 层级路径 /1/3/8/（可索引）
      area_name NVARCHAR(100) NULL,
      warehouse_type NVARCHAR(50) NULL,      -- 直营/山东直营/加盟/联营
      business_line NVARCHAR(50) NULL,       -- v3: direct/join/山东/-
      function_line NVARCHAR(50) NULL,       -- v3: 运营/商品/财务/稽查/人事/采购/数据/老板/-
      org_code NVARCHAR(100) NULL,           -- 组织编码（门店/经销商节点由导入脚本补）
      shop_code NVARCHAR(100) NULL,          -- org_type=shop 时对应店仓全.店铺代码
      shop_name NVARCHAR(200) NULL,          -- org_type=shop 时对应店仓全.店铺名称
      status INT NOT NULL DEFAULT 1,
      create_time DATETIME DEFAULT GETDATE(),
      update_time DATETIME DEFAULT GETDATE(),
      del_flag INT NOT NULL DEFAULT 0
    )
  `);
  // v3 新增列幂等补齐（已有库表升级）
  await addColumnIfMissing(pool, 'sys_org', 'business_line', 'NVARCHAR(50)');
  await addColumnIfMissing(pool, 'sys_org', 'function_line', 'NVARCHAR(50)');
  await addColumnIfMissing(pool, 'sys_org', 'org_code', 'NVARCHAR(100)');
  await addColumnIfMissing(pool, 'sys_org', 'shop_code', 'NVARCHAR(100)');
  await addColumnIfMissing(pool, 'sys_org', 'shop_name', 'NVARCHAR(200)');
  // 兼容旧库：ancestors 若为 NVARCHAR(MAX) 则收窄为 NVARCHAR(900)（MAX 不可作索引键）
  try {
    const anc = await pool.request().query(`
      SELECT c.max_length FROM sys.columns c
      WHERE c.object_id = OBJECT_ID('sys_org') AND c.name = 'ancestors'
    `);
    if (anc.recordset[0] && anc.recordset[0].max_length === -1) {
      await pool.request().query(`ALTER TABLE sys_org ALTER COLUMN ancestors NVARCHAR(900) NULL`);
      console.log('[PermSchema] sys_org.ancestors 已从 NVARCHAR(MAX) 收窄为 NVARCHAR(900)');
    }
  } catch { /* ignore */ }
}

/** 幂等加列：仅当列不存在时 ALTER TABLE ADD */
async function addColumnIfMissing(pool: sql.ConnectionPool, table: string, column: string, type: string) {
  const r = await pool.request()
    .input('t', sql.NVarChar, table)
    .input('c', sql.NVarChar, column)
    .query(`SELECT COUNT(*) AS n FROM sys.columns WHERE object_id = OBJECT_ID(@t) AND name = @c`);
  if (r.recordset[0].n === 0) {
    await pool.request().query(`ALTER TABLE ${table} ADD ${column} ${type} NULL`);
    console.log(`[PermSchema] ${table} 新增列: ${column} ${type}`);
  }
}

/** 幂等加索引：仅当索引不存在时创建 */
async function addIndexIfMissing(pool: sql.ConnectionPool, indexName: string, table: string, columns: string) {
  const r = await pool.request()
    .input('n', sql.NVarChar, indexName)
    .query(`SELECT COUNT(*) AS n FROM sys.indexes WHERE name = @n`);
  if (r.recordset[0].n === 0) {
    await pool.request().query(`CREATE NONCLUSTERED INDEX ${indexName} ON ${table} (${columns})`);
    console.log(`[PermSchema] 索引已创建: ${indexName} ON ${table}(${columns})`);
  }
}

// ============================================================
// sys_org 数据播种：仅当公司节点不存在（全新库/空表）时插入 v3 组织树
// 已有组织树 ⇒ 跳过（页面管理的组织/店铺归属不会被覆盖）
// ============================================================
async function seedOrgIfEmpty(pool: sql.ConnectionPool) {
  const companyCheck = await pool.request()
    .input('cn', sql.NVarChar, '卡迪高总公司')
    .query(`SELECT org_id FROM sys_org WHERE org_name = @cn AND org_type = 'company' AND del_flag = 0`);
  if (companyCheck.recordset.length > 0) {
    console.log('[PermSchema] sys_org 已有组织树，跳过播种（页面可维护，重启不覆盖）');
    return;
  }

  // 插入公司根节点（ancestors 语义：裸根 '/'）
  const ins = await pool.request()
    .input('cn', sql.NVarChar, '卡迪高总公司')
    .input('typ', sql.NVarChar, 'company')
    .input('lvl', sql.Int, 1)
    .query(`
      INSERT INTO sys_org (parent_org_id, org_name, org_type, org_level, ancestors, business_line, function_line)
      OUTPUT INSERTED.org_id
      VALUES (NULL, @cn, @typ, @lvl, '/', '-', '-')
    `);
  const companyId = ins.recordset[0].org_id as number;
  console.log(`[PermSchema] 公司节点已创建: 卡迪高总公司 (org_id=${companyId})`);

  // 名称→id 映射（含新公司节点）
  const nameToId: Record<string, number> = { '卡迪高总公司': companyId };
  const meta: Record<number, { level: number; ancestors: string }> = {
    [companyId]: { level: 1, ancestors: '/' },
  };

  let insertedCount = 0;
  const insertNode = async (node: { name: string; parent: string; type: string; biz: string; fn: string }) => {
    if (nameToId[node.name] !== undefined) return;
    let parentId: number | undefined;
    if (node.parent) parentId = nameToId[node.parent];
    if (node.parent && parentId === undefined) {
      console.warn(`[PermSchema] 跳过节点（父节点未找到）: ${node.name} -> ${node.parent}`);
      return;
    }
    if (!parentId) parentId = companyId;
    const parentMeta = meta[parentId] || { level: 1, ancestors: '/' };
    const level = parentMeta.level + 1;
    // 子节点 ancestors = 父节点完整路径 = 父.ancestors + 父id + '/'
    const ancestors = (parentMeta.ancestors.endsWith('/') ? parentMeta.ancestors : parentMeta.ancestors + '/') + String(parentId) + '/';
    const biz = node.biz === '-' ? null : node.biz;
    const fn = node.fn === '-' ? null : node.fn;
    const r = await pool.request()
      .input('pp', sql.Int, parentId)
      .input('nm', sql.NVarChar, node.name)
      .input('typ', sql.NVarChar, node.type)
      .input('lvl', sql.Int, level)
      .input('anc', sql.NVarChar, ancestors)
      .input('bl', sql.NVarChar, biz)
      .input('fl', sql.NVarChar, fn)
      .query(`
        INSERT INTO sys_org (parent_org_id, org_name, org_type, org_level, ancestors, business_line, function_line)
        OUTPUT INSERTED.org_id
        VALUES (@pp, @nm, @typ, @lvl, @anc, @bl, @fl)
      `);
    const newId = r.recordset[0].org_id;
    nameToId[node.name] = newId;
    meta[newId] = { level, ancestors };
    insertedCount++;
  };
  for (const node of ORG_TREE_V3) await insertNode(node);
  console.log(`[PermSchema] v3 组织树播种完成，共 ${insertedCount + 1} 个节点`);
}

// ============================================================
// sys_role：建表 + 数据播种（仅当表为空）
// 已有角色 ⇒ 跳过（页面改动的角色名/数据范围不会被刷新覆盖）
// ============================================================
async function ensureTableSysRole(pool: sql.ConnectionPool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'sys_role')
    CREATE TABLE sys_role (
      role_id INT IDENTITY(1,1) PRIMARY KEY,
      role_name NVARCHAR(100) NOT NULL,
      role_code NVARCHAR(100) NOT NULL,
      default_data_scope INT NOT NULL DEFAULT 3,
      status INT NOT NULL DEFAULT 1,
      create_time DATETIME DEFAULT GETDATE(),
      update_time DATETIME DEFAULT GETDATE(),
      del_flag INT NOT NULL DEFAULT 0,
      CONSTRAINT UK_RoleCode UNIQUE (role_code)
    )
  `);
}

async function seedRolesIfEmpty(pool: sql.ConnectionPool) {
  const cnt = await pool.request().query(`SELECT COUNT(*) AS n FROM sys_role WHERE del_flag = 0`);
  if (cnt.recordset[0].n > 0) {
    console.log('[PermSchema] sys_role 已有角色数据，跳过播种（页面可维护，重启不覆盖）');
    return;
  }
  let inserted = 0;
  for (const r of ROLE_SEEDS_V3) {
    await pool.request()
      .input('rn', sql.NVarChar, r.name)
      .input('rc', sql.NVarChar, r.code)
      .input('ds', sql.Int, r.scope)
      .query(`
        INSERT INTO sys_role (role_name, role_code, default_data_scope)
        VALUES (@rn, @rc, @ds)
      `);
    inserted++;
  }
  console.log(`[PermSchema] sys_role 播种完成，共 ${inserted} 个角色`);
}

// ============================================================
// sys_position：职位表（页面维护：添加/删除，删除前校验用户引用）
//  - 建表幂等；数据仅空表播种（12 项内置职位关联 sys_role 角色）
//  - 删除为物理删除（删除前已强制校验用户全表无引用，重新建同名无唯一冲突）
//  - org_type：职位→组织类型映射（表驱动「自动带出归属组织」的映射源，
//    支持 | 组合多个类型；supervisor_group/dealer_group/shop 为按姓名/店铺收窄型）
//  - org_name_kw：组织名称关键词过滤（| 分隔，OR 语义；空表示不过滤）
// ============================================================
async function ensureTableSysPosition(pool: sql.ConnectionPool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'sys_position')
    CREATE TABLE sys_position (
      position_id INT IDENTITY(1,1) PRIMARY KEY,
      position_name NVARCHAR(50) NOT NULL,
      role_id INT NULL,
      org_type NVARCHAR(50) NULL,
      org_name_kw NVARCHAR(100) NULL,
      status INT NOT NULL DEFAULT 1,
      create_time DATETIME DEFAULT GETDATE(),
      update_time DATETIME DEFAULT GETDATE(),
      CONSTRAINT UK_PositionName UNIQUE (position_name)
    )
  `);
  // 存量表补列（幂等，避免旧库升级时缺列）
  await pool.request().query(`
    IF COL_LENGTH('sys_position', 'org_type') IS NULL
      ALTER TABLE sys_position ADD org_type NVARCHAR(50) NULL;
    IF COL_LENGTH('sys_position', 'org_name_kw') IS NULL
      ALTER TABLE sys_position ADD org_name_kw NVARCHAR(100) NULL;
  `);
}

/** 内置 12 项职位 → [关联 sys_role 角色编码, 组织类型映射, 组织名称关键词]（初始化映射，按业务职能对应总监角色）
 *  org_type 取值：company / supervisor_group / dealer_group / shop / director|group（| 组合多个类型）
 *  org_name_kw：| 分隔多个关键词（OR），空表示不过滤；supervisor_group/dealer_group/shop 由前端按姓名/店铺名收窄 */
const POSITION_ROLE_CODE_MAP: [string, string, string, string][] = [
  ['公司', 'boss', 'company', ''],
  ['运营', 'ops_director', 'director|group', '运营|会员|区经'],
  ['督导', 'supervisor', 'supervisor_group', ''],
  ['经销商', 'dealer', 'dealer_group', ''],
  ['店长', 'shop_manager', 'shop', ''],
  ['店员', 'staff', 'shop', ''],
  ['商品', 'product', 'director|group', '商品'],
  ['财务', 'finance', 'director|group', '财务|出纳'],
  ['稽查', 'inspector', 'director|group', '稽查'],
  ['人事', 'hr', 'director|group', '人事|行政'],
  ['采购', 'procurement', 'director|group', '采购'],
  ['数据', 'data_admin', 'director|group', 'IT|数据'],
];

async function seedPositionsIfEmpty(pool: sql.ConnectionPool) {
  const cnt = await pool.request().query(`SELECT COUNT(*) AS n FROM sys_position`);
  if (cnt.recordset[0].n > 0) {
    console.log('[PermSchema] sys_position 已有职位数据，跳过播种（页面可维护，重启不覆盖）');
    return;
  }
  const roles = await pool.request().query(`SELECT role_id, role_code FROM sys_role WHERE del_flag = 0`);
  const roleIdByCode: Record<string, number> = {};
  for (const r of roles.recordset) roleIdByCode[r.role_code] = r.role_id;
  for (const [name, code, orgType, orgKw] of POSITION_ROLE_CODE_MAP) {
    await pool.request()
      .input('pn', sql.NVarChar, name)
      .input('rid', sql.Int, roleIdByCode[code] ?? null)
      .input('ot', sql.NVarChar, orgType)
      .input('ok', sql.NVarChar, orgKw)
      .query(`INSERT INTO sys_position (position_name, role_id, org_type, org_name_kw) VALUES (@pn, @rid, @ot, @ok)`);
  }
  console.log(`[PermSchema] sys_position 播种完成，共 ${POSITION_ROLE_CODE_MAP.length} 个职位`);
}

/** 幂等补齐「职位→组织映射」：仅对 org_type 为空的存量职位按内置映射 UPDATE（已配置过的绝不覆盖，重启不重置） */
async function syncPositionOrgMap(pool: sql.ConnectionPool) {
  for (const [name, , orgType, orgKw] of POSITION_ROLE_CODE_MAP) {
    await pool.request()
      .input('pn', sql.NVarChar, name)
      .input('ot', sql.NVarChar, orgType)
      .input('ok', sql.NVarChar, orgKw)
      .query(`UPDATE sys_position SET org_type = @ot, org_name_kw = @ok, update_time = GETDATE()
              WHERE position_name = @pn AND org_type IS NULL`);
  }
  const remain = await pool.request().query(`SELECT COUNT(*) AS n FROM sys_position WHERE org_type IS NULL`);
  console.log(`[PermSchema] 职位→组织映射补齐完成，仍有 ${remain.recordset[0].n} 个职位未配置组织映射`);
}

// ============================================================
// sys_role_menu：建表 + 数据播种
//  - 表空：按 v3 菜单授权矩阵全量播种（唯一授权源）
//  - 表非空：仅补「从未出现过的 menu_en」的新菜单授权（页面删除的旧授权绝不恢复）
// ============================================================
async function ensureTableSysRoleMenu(pool: sql.ConnectionPool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'sys_role_menu')
    CREATE TABLE sys_role_menu (
      id INT IDENTITY(1,1) PRIMARY KEY,
      role_id INT NOT NULL,
      portal_en NVARCHAR(100) NOT NULL,
      menu_en NVARCHAR(100) NOT NULL,
      create_time DATETIME DEFAULT GETDATE(),
      CONSTRAINT UK_RoleMenu UNIQUE (role_id, portal_en, menu_en)
    )
  `);
}

async function seedRoleMenuIfEmptyOrNewMenu(pool: sql.ConnectionPool) {
  const roles = await pool.request().query(`SELECT role_id, role_code FROM sys_role WHERE del_flag = 0`);
  const roleIdByCode: Record<string, number> = {};
  for (const r of roles.recordset) roleIdByCode[r.role_code] = r.role_id;

  const cnt = await pool.request().query(`SELECT COUNT(*) AS n FROM sys_role_menu`);
  if (cnt.recordset[0].n === 0) {
    // 全新：全量播种
    let inserted = 0;
    const seen = new Set<string>();
    for (const g of MENU_GRANTS_V3) {
      for (const roleCode of g.roles) {
        const roleId = roleIdByCode[roleCode];
        if (!roleId) {
          console.warn(`[PermSchema] 菜单授权跳过（角色不存在）: ${roleCode} @ ${g.portalEn}.${g.menuEn}`);
          continue;
        }
        const key = `${roleId}|${g.portalEn}|${g.menuEn}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await pool.request()
          .input('rid', sql.Int, roleId)
          .input('pe', sql.NVarChar, g.portalEn)
          .input('me', sql.NVarChar, g.menuEn)
          .query(`INSERT INTO sys_role_menu (role_id, portal_en, menu_en) VALUES (@rid, @pe, @me)`);
        inserted++;
      }
    }
    console.log(`[PermSchema] sys_role_menu 全量播种完成，共 ${inserted} 条授权`);
    return;
  }

  // 已有授权：仅补「从未出现过的 menu_en」的新菜单授权（如本次新增的管理菜单）
  const existingMenu = await pool.request().query(`SELECT DISTINCT menu_en FROM sys_role_menu`);
  const existingMenuSet = new Set(existingMenu.recordset.map((r: any) => r.menu_en as string));
  let inserted = 0;
  const seen = new Set<string>();
  for (const g of MENU_GRANTS_V3) {
    if (existingMenuSet.has(g.menuEn)) continue; // 菜单已出现过 ⇒ 尊重页面现状，绝不重刷/恢复
    for (const roleCode of g.roles) {
      const roleId = roleIdByCode[roleCode];
      if (!roleId) continue;
      const key = `${roleId}|${g.portalEn}|${g.menuEn}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await pool.request()
        .input('rid', sql.Int, roleId)
        .input('pe', sql.NVarChar, g.portalEn)
        .input('me', sql.NVarChar, g.menuEn)
        .query(`INSERT INTO sys_role_menu (role_id, portal_en, menu_en) VALUES (@rid, @pe, @me)`);
      inserted++;
    }
  }
  if (inserted > 0) console.log(`[PermSchema] sys_role_menu 补种新菜单授权 ${inserted} 条（仅在菜单从未出现过时）`);
  else console.log('[PermSchema] sys_role_menu 已有授权数据，跳过播种（页面可维护，重启不覆盖）');
}

// ============================================================
// 门户层级重构：旧门户 → 新门户 的幂等迁移
//  - 新层级框架：主门户 → 门户 → 菜单（原两层 门户 → 菜单 升级为三层）
//  - 迁移目标：sys_role_menu.portal_en 与 LD_Zxtmh.portalEn/menuEn
//  - 迁移原则：UPDATE 不丢授权；目标已存在时删除冗余旧行（幂等，可重复执行）
// ============================================================
const PORTAL_MIGRATIONS: { from: string; to: string; menus?: string[] }[] = [
  // 系统管理瘦身：授权(权限管理已迁回 system)/组织/注册/职位/店铺档案/用户 迁出 system → baseInfo
  { from: 'system', to: 'baseInfo', menus: ['registerAudit', 'orgManage', 'positions', 'shopArchive', 'users'] },
  // 陪跑店铺管理 迁出 system → coaching
  { from: 'system', to: 'coaching', menus: ['coachingStores'] },
  // 权限管理 自 baseInfo 迁回 system（与门户注册表归属保持一致）
  { from: 'baseInfo', to: 'system', menus: ['permissions'] },
];

async function migratePortalEnIfNeeded(pool: sql.ConnectionPool) {
  for (const m of PORTAL_MIGRATIONS) {
    const menuCond = m.menus ? m.menus.map((_, i) => `menu_en = @me${i}`).join(' OR ') : '1=1';
    const req = pool.request()
      .input('from', sql.NVarChar, m.from)
      .input('to', sql.NVarChar, m.to);
    m.menus?.forEach((me, i) => req.input(`me${i}`, sql.NVarChar, me));

    // 1) 无冲突行直接迁移 portal_en（旧授权保留，role 不丢）
    await req.query(`
      UPDATE srm SET portal_en = @to
      FROM sys_role_menu srm
      WHERE srm.portal_en = @from AND (${menuCond})
        AND NOT EXISTS (
          SELECT 1 FROM sys_role_menu s2
          WHERE s2.role_id = srm.role_id AND s2.portal_en = @to AND s2.menu_en = srm.menu_en
        )
    `);
    // 2) 目标已存在同 (role,menu) 授权的：删除冗余旧行（幂等防冲突）
    await pool.request()
      .input('from', sql.NVarChar, m.from)
      .input('to', sql.NVarChar, m.to)
      .query(`
        DELETE srm FROM sys_role_menu srm
        WHERE srm.portal_en = @from
          AND EXISTS (
            SELECT 1 FROM sys_role_menu s2
            WHERE s2.role_id = srm.role_id AND s2.portal_en = @to AND s2.menu_en = srm.menu_en
          )
      `);
  }
  // LD_Zxtmh 门户归属迁移：旧 (portalEn, menuEn) → 新 (portalEn, menuEn)
  const ldzMigrations: { fromPortal: string; fromMenu: string; toPortal: string; toMenu: string }[] = [
    { fromPortal: 'system', fromMenu: 'registerAudit', toPortal: 'baseInfo', toMenu: 'registerAudit' },
    { fromPortal: 'system', fromMenu: 'orgManage', toPortal: 'baseInfo', toMenu: 'orgManage' },
    { fromPortal: 'system', fromMenu: 'positions', toPortal: 'baseInfo', toMenu: 'positions' },
    { fromPortal: 'system', fromMenu: 'shopArchive', toPortal: 'baseInfo', toMenu: 'shopArchive' },
    { fromPortal: 'system', fromMenu: 'users', toPortal: 'baseInfo', toMenu: 'users' },
    { fromPortal: 'system', fromMenu: 'coachingStores', toPortal: 'coaching', toMenu: 'coachingStores' },
    // 权限管理 自 baseInfo 迁回 system（与门户注册表归属保持一致）
    { fromPortal: 'baseInfo', fromMenu: 'permissions', toPortal: 'system', toMenu: 'permissions' },
  ];
  for (const m of ldzMigrations) {
    await pool.request()
      .input('fp', sql.NVarChar, m.fromPortal)
      .input('fm', sql.NVarChar, m.fromMenu)
      .input('tp', sql.NVarChar, m.toPortal)
      .input('tm', sql.NVarChar, m.toMenu)
      .query(`
        IF EXISTS (SELECT 1 FROM LD_Zxtmh WHERE portalEn=@fp AND menuEn=@fm)
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM LD_Zxtmh WHERE portalEn=@tp AND menuEn=@tm)
            UPDATE LD_Zxtmh SET portalEn=@tp, menuEn=@tm WHERE portalEn=@fp AND menuEn=@fm;
          ELSE
            DELETE FROM LD_Zxtmh WHERE portalEn=@fp AND menuEn=@fm;
        END
      `);
  }
  console.log(`[PermSchema] 门户层级迁移完成（sys_role_menu 共 ${PORTAL_MIGRATIONS.length} 组；LD_Zxtmh 共 ${ldzMigrations.length} 条菜单）`);
}

// ============================================================
// sys_user_role：建表 + 数据播种（仅当表为空时按 05 表导入）
// 已有数据 ⇒ 跳过（页面分配的用户-角色-组织不会被覆盖）
// ============================================================
async function ensureTableSysUserRole(pool: sql.ConnectionPool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'sys_user_role')
    CREATE TABLE sys_user_role (
      id INT IDENTITY(1,1) PRIMARY KEY,
      user_code NVARCHAR(100) NOT NULL,      -- 对应 用户全.用户代码
      role_id INT NOT NULL,
      org_id INT NULL,                       -- 用户所属组织（店员 NULL=由组名/门店批量兜底）
      data_scope INT NULL,                   -- 个人级覆盖 1-5；NULL=按角色默认
      data_scope_org_ids NVARCHAR(MAX) NULL, -- data_scope=4 时指定组织 id 列表
      create_time DATETIME DEFAULT GETDATE(),
      update_time DATETIME DEFAULT GETDATE(),
      CONSTRAINT UK_UserRole UNIQUE (user_code, role_id)
    )
  `);
}

/**
 * 05 表用户角色批量导入（仅当 sys_user_role 为空表时执行）：
 *  - 主键 user_code = 用户全.用户代码（按 no / phone 双路匹配）
 *  - 一人多角色：主角色一行 + extra 每个角色一行（权限取并集）
 *  - 经销商 87 人 org = 经销商组加盟节点（05 表方案一归组）
 *  - 山东 6 人按种子 org 落位；店员 org 留空走组名兜底
 *  - 店长/出纳 v3 批复不灌数据（保留角色与组织节点）
 */
async function seedUserRoleIfEmpty(pool: sql.ConnectionPool) {
  const cnt = await pool.request().query(`SELECT COUNT(*) AS n FROM sys_user_role`);
  if (cnt.recordset[0].n > 0) {
    console.log('[PermSchema] sys_user_role 已有数据，跳过导入（页面可维护，重启不覆盖）');
    return;
  }

  // 角色映射
  const roles = await pool.request().query(`SELECT role_id, role_code FROM sys_role WHERE del_flag = 0`);
  const roleIdByCode: Record<string, number> = {};
  for (const r of roles.recordset) roleIdByCode[r.role_code] = r.role_id;

  // 组织映射（按名称）
  const orgs = await pool.request().query(`SELECT org_id, org_name FROM sys_org WHERE del_flag = 0`);
  const orgIdByName: Record<string, number> = {};
  for (const o of orgs.recordset) orgIdByName[o.org_name] = o.org_id;

  // 用户全表匹配（批量按手机号 IN + 用户代码 IN 分两路）
  const phoneList = [...new Set(USER_SEEDS_V3.map(u => u.phone).filter(Boolean))];
  const noList = [...new Set(USER_SEEDS_V3.map(u => u.no).filter(Boolean))];
  const phoneToCode: Record<string, string> = {};
  const noToCode: Record<string, string> = {};

  const batchFetch = async (batch: string[], column: string, target: Record<string, string>) => {
    for (let i = 0; i < batch.length; i += 500) {
      const chunk = batch.slice(i, i + 500);
      const placeholders = chunk.map((_, j) => `@p${j}`).join(', ');
      const req = pool.request();
      chunk.forEach((v, j) => req.input(`p${j}`, sql.NVarChar, v));
      const r = await req.query(
        `SELECT 用户代码, ${column === '手机号' ? '手机号' : '用户代码'} AS match_col
         FROM 用户全 WHERE ${column === '手机号' ? '手机号' : '用户代码'} IN (${placeholders})`
      );
      for (const row of r.recordset) {
        const key = String(row.match_col ?? '').trim();
        const code = String(row['用户代码'] ?? '').trim();
        if (key && code && target[key] === undefined) target[key] = code;
      }
    }
  };

  try {
    await batchFetch(phoneList, '手机号', phoneToCode);
  } catch (e: any) {
    console.warn('[PermSchema] 用户全.手机号批量匹配失败（可能字段名不同或无权限）:', e?.message);
  }
  try {
    await batchFetch(noList, '用户代码', noToCode);
  } catch (e: any) {
    console.warn('[PermSchema] 用户全.用户代码批量匹配失败:', e?.message);
  }

  const resolveUserCode = (u: { no: string; phone: string }): string | null =>
    phoneToCode[u.phone] || noToCode[u.no] || null;

  let inserted = 0;
  let skipped = 0;
  const missing: string[] = [];
  for (const u of USER_SEEDS_V3) {
    const uc = resolveUserCode(u);
    if (!uc) {
      missing.push(`${u.name}(${u.no})`);
      skipped++;
      continue;
    }
    const roleCodes = [u.role, ...(u.extra || [])];
    for (const rc of roleCodes) {
      const rid = roleIdByCode[rc];
      if (!rid) {
        console.warn(`[PermSchema] 用户 ${u.name} 的角色未找到: ${rc}`);
        continue;
      }
      const orgId = u.org ? orgIdByName[u.org] : undefined;
      const dup = await pool.request()
        .input('uc', sql.NVarChar, uc)
        .input('rid', sql.Int, rid)
        .query(`SELECT id FROM sys_user_role WHERE user_code = @uc AND role_id = @rid`);
      if (dup.recordset.length > 0) continue; // 幂等
      await pool.request()
        .input('uc', sql.NVarChar, uc)
        .input('rid', sql.Int, rid)
        .input('oid', sql.Int, orgId ?? null)
        .query(`INSERT INTO sys_user_role (user_code, role_id, org_id) VALUES (@uc, @rid, @oid)`);
      inserted++;
    }
  }
  console.log(
    `[PermSchema] sys_user_role 导入完成：新增 ${inserted} 行` +
    (skipped ? `，跳过 ${skipped} 人（未在用户全匹配: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '...' : ''}）` : '')
  );
}

// ============================================================
// 外部键与索引补建
// ============================================================
async function ensureIndexes(pool: sql.ConnectionPool) {
  await addIndexIfMissing(pool, 'IX_sys_user_role_role', 'sys_user_role', 'role_id');
  await addIndexIfMissing(pool, 'IX_sys_user_role_org', 'sys_user_role', 'org_id');
  await addIndexIfMissing(pool, 'IX_sys_user_role_code', 'sys_user_role', 'user_code');
  await addIndexIfMissing(pool, 'IX_sys_role_menu_role', 'sys_role_menu', 'role_id');
  await addIndexIfMissing(pool, 'IX_sys_role_menu_menu', 'sys_role_menu', 'portal_en, menu_en');
  await addIndexIfMissing(pool, 'IX_sys_org_parent', 'sys_org', 'parent_org_id');
  await addIndexIfMissing(pool, 'IX_sys_org_name', 'sys_org', 'org_name');
  await addIndexIfMissing(pool, 'IX_sys_org_ancestors', 'sys_org', 'ancestors');
}

// ============================================================
// 统一入口（页面化防覆盖版）
//  - 结构：建表/加列/加索引 永远执行（幂等，不碰数据）
//  - 数据：仅空表播种；新菜单授权仅在「从未出现过」时补种
// ============================================================
export async function ensureStandardPermissionTables() {
  try {
    const pool = await getPool();
    // 1) 结构初始化（幂等）
    await ensureTableSysOrg(pool);
    await ensureTableSysRole(pool);
    await ensureTableSysRoleMenu(pool);
    await ensureTableSysUserRole(pool);
    await ensureTableSysPosition(pool);
    await ensureIndexes(pool);
    // 2) 数据播种（空表才播；页面修改永不被覆盖）
    await seedOrgIfEmpty(pool);
    await seedRolesIfEmpty(pool);
    await seedRoleMenuIfEmptyOrNewMenu(pool);
    await seedUserRoleIfEmpty(pool);
    await seedPositionsIfEmpty(pool);
    await syncPositionOrgMap(pool);
    // 门户层级重构迁移（system→baseInfo / system→coaching，幂等）
    await migratePortalEnIfNeeded(pool);
    // 管理员总公司绑定补偿：管理员='是' 的用户自动补 super_admin+org1 绑定（幂等，缺失才插）
    await backfillAdminOrgBindings(pool);
    console.log('[PermSchema] v3 标准权限表初始化完成（结构幂等；数据仅空表播种，页面修改重启不覆盖）');
  } catch (e: any) {
    console.error('[PermSchema] 权限表初始化失败:', e.message);
  }
}