// 一次性脚本：创建多门户推送系统6张新表
// 执行：npx ts-node src/server/services/push/setupPushTables.ts
import { getPool } from '../../../config/db';
import * as sql from 'mssql';

async function main() {
  const pool = await getPool();
  console.log('数据库已连接，开始建表...\n');

  // 表1
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushModules')
    CREATE TABLE WechatPushModules (
      id INT IDENTITY(1,1) PRIMARY KEY,
      moduleCode NVARCHAR(50) NOT NULL UNIQUE,
      moduleName NVARCHAR(100) NOT NULL,
      portalCode NVARCHAR(50) NOT NULL,
      portalName NVARCHAR(100) NOT NULL,
      sourceTable NVARCHAR(200) NOT NULL,
      sourceIdField NVARCHAR(100) NOT NULL DEFAULT 'id',
      statusField NVARCHAR(100),
      statusTriggerValue NVARCHAR(100),
      recipientStrategy NVARCHAR(50) NOT NULL DEFAULT 'permission_group',
      pollingEnabled BIT NOT NULL DEFAULT 1,
      isActive BIT NOT NULL DEFAULT 1,
      description NVARCHAR(500),
      createdAt DATETIME NOT NULL DEFAULT GETDATE(),
      updatedAt DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);
  console.log('1/6 WechatPushModules OK');

  // 表2
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushTemplateFields')
    CREATE TABLE WechatPushTemplateFields (
      id INT IDENTITY(1,1) PRIMARY KEY,
      moduleCode NVARCHAR(50) NOT NULL,
      fieldKey NVARCHAR(100) NOT NULL,
      fieldName NVARCHAR(100) NOT NULL,
      fieldType NVARCHAR(50) NOT NULL DEFAULT 'text',
      sourceColumn NVARCHAR(200) NOT NULL,
      sourceTable NVARCHAR(200),
      category NVARCHAR(50) NOT NULL DEFAULT 'basic',
      sortOrder INT NOT NULL DEFAULT 0,
      description NVARCHAR(500),
      createdAt DATETIME NOT NULL DEFAULT GETDATE(),
      CONSTRAINT UQ_PTF_ModuleField UNIQUE (moduleCode, fieldKey)
    )
  `);
  console.log('2/6 WechatPushTemplateFields OK');

  // 表3
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushTemplateV2')
    CREATE TABLE WechatPushTemplateV2 (
      id INT IDENTITY(1,1) PRIMARY KEY,
      moduleCode NVARCHAR(50) NOT NULL,
      templateName NVARCHAR(100) NOT NULL,
      title NVARCHAR(200) NOT NULL DEFAULT '',
      headerTemplate NVARCHAR(2000),
      bodyTemplate NVARCHAR(4000),
      footerTemplate NVARCHAR(500),
      selectedFields NVARCHAR(MAX) DEFAULT '[]',
      isDefault BIT NOT NULL DEFAULT 0,
      isActive BIT NOT NULL DEFAULT 1,
      createdBy NVARCHAR(100),
      pushMode NVARCHAR(20) NOT NULL DEFAULT 'detail',
      triggerType NVARCHAR(30) NOT NULL DEFAULT 'manual',
      triggerConfig NVARCHAR(MAX),
      dataSourceMode NVARCHAR(20) NOT NULL DEFAULT 'realtime',
      startTime DATETIME NULL,
      endTime DATETIME NULL,
      createdAt DATETIME NOT NULL DEFAULT GETDATE(),
      updatedAt DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);
  console.log('3/6 WechatPushTemplateV2 OK');

  // 表4
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushLogsV2')
    BEGIN
      CREATE TABLE WechatPushLogsV2 (
        id INT IDENTITY(1,1) PRIMARY KEY,
        moduleCode NVARCHAR(50) NOT NULL,
        sourceId NVARCHAR(100) NOT NULL,
        sourceTable NVARCHAR(200) NOT NULL,
        sourceTitle NVARCHAR(500),
        supervisor NVARCHAR(100),
        destination NVARCHAR(200),
        recipientName NVARCHAR(100) NOT NULL,
        recipientAccount NVARCHAR(100) NOT NULL,
        messageContent NVARCHAR(MAX) NOT NULL,
        status NVARCHAR(20) NOT NULL,
        errorDetail NVARCHAR(MAX),
        retryCount INT NOT NULL DEFAULT 0,
        triggeredBy NVARCHAR(50) NOT NULL DEFAULT 'auto',
        triggeredAt DATETIME NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT GETDATE()
      );
      CREATE INDEX IX_WPLV2_Module ON WechatPushLogsV2 (moduleCode);
      CREATE INDEX IX_WPLV2_Source ON WechatPushLogsV2 (sourceId, moduleCode);
      CREATE INDEX IX_WPLV2_Status ON WechatPushLogsV2 (status);
      CREATE INDEX IX_WPLV2_CreatedAt ON WechatPushLogsV2 (createdAt DESC);
    END
  `);
  console.log('4/6 WechatPushLogsV2 OK');

  // 表5
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushHistoryV2')
    BEGIN
      CREATE TABLE WechatPushHistoryV2 (
        id INT IDENTITY(1,1) PRIMARY KEY,
        moduleCode NVARCHAR(50) NOT NULL,
        sourceId NVARCHAR(100) NOT NULL,
        sourceTable NVARCHAR(200) NOT NULL,
        pushedAt DATETIME NOT NULL DEFAULT GETDATE(),
        pushedBy NVARCHAR(50) NOT NULL,
        CONSTRAINT UQ_WPHV2_ModuleSource UNIQUE (moduleCode, sourceId)
      );
      CREATE INDEX IX_WPHV2_Module ON WechatPushHistoryV2 (moduleCode);
    END
  `);
  console.log('5/6 WechatPushHistoryV2 OK');

  // 表6
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushQueue')
    BEGIN
      CREATE TABLE WechatPushQueue (
        id INT IDENTITY(1,1) PRIMARY KEY,
        moduleCode NVARCHAR(50) NOT NULL,
        sourceId NVARCHAR(100) NOT NULL,
        sourceTable NVARCHAR(200) NOT NULL,
        priority INT NOT NULL DEFAULT 0,
        status NVARCHAR(20) NOT NULL DEFAULT 'queued',
        attemptCount INT NOT NULL DEFAULT 0,
        maxAttempts INT NOT NULL DEFAULT 3,
        nextAttemptAt DATETIME,
        lastError NVARCHAR(MAX),
        createdAt DATETIME NOT NULL DEFAULT GETDATE(),
        updatedAt DATETIME NOT NULL DEFAULT GETDATE()
      );
      CREATE INDEX IX_WPQ_Status ON WechatPushQueue (status, nextAttemptAt);
      CREATE INDEX IX_WPQ_Module ON WechatPushQueue (moduleCode, sourceId);
    END
  `);
  console.log('6/6 WechatPushQueue OK');

  // 写入8个模块注册数据
  const modules = [
    {
      code: 'inspection_log', name: '巡店日志', portal: 'inspection', portalName: '巡店管理',
      table: 'StoreInspectionLogs', statusField: 'status', statusVal: 'submitted'
    },
    {
      code: 'direct_sales_summary', name: '运营工作汇报', portal: 'directSales', portalName: '运营工作汇报',
      table: 'DirectSalesSummary', statusField: null, statusVal: null
    },
    {
      code: 'daily_shop_target', name: '日常指标上传', portal: 'directSales', portalName: '运营工作汇报',
      table: 'DailyShopTargets', statusField: null, statusVal: null
    },
    {
      code: 'feedback_task', name: '培训反馈任务', portal: 'staffChannel', portalName: '培训反馈',
      table: 'FeedbackTasks', statusField: 'status', statusVal: 'running'
    },
    {
      code: 'feedback_detail', name: '培训反馈明细', portal: 'staffChannel', portalName: '培训反馈',
      table: 'FeedbackDetails', statusField: 'status', statusVal: 'submitted'
    },
    {
      code: 'coaching_store', name: '陪跑跟进', portal: 'coaching', portalName: '陪跑跟进',
      table: 'CoachingStores', statusField: null, statusVal: null
    },
    {
      code: 'daily_score', name: '评分体系', portal: 'inspection', portalName: '巡店管理',
      table: 'DailyScores', statusField: null, statusVal: null
    },
    {
      code: 'monthly_target', name: '月目标分解', portal: 'sales', portalName: '销售管理',
      table: 'MonthlyTargetDecomposition', statusField: null, statusVal: null
    },
  ];

  for (const m of modules) {
    await pool.request()
      .input('code', sql.NVarChar, m.code)
      .input('name', sql.NVarChar, m.name)
      .input('portal', sql.NVarChar, m.portal)
      .input('portalName', sql.NVarChar, m.portalName)
      .input('table', sql.NVarChar, m.table)
      .input('statusField', sql.NVarChar, m.statusField)
      .input('statusVal', sql.NVarChar, m.statusVal)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM WechatPushModules WHERE moduleCode = @code)
          INSERT INTO WechatPushModules (moduleCode, moduleName, portalCode, portalName, sourceTable, statusField, statusTriggerValue)
          VALUES (@code, @name, @portal, @portalName, @table, @statusField, @statusVal)
        ELSE
          UPDATE WechatPushModules SET
            moduleName = @name, portalCode = @portal, portalName = @portalName,
            sourceTable = @table, statusField = @statusField, statusTriggerValue = @statusVal,
            updatedAt = GETDATE()
          WHERE moduleCode = @code
      `);
    console.log(`  模块注册: ${m.name} (${m.code})`);
  }

  // 校验
  const check = await pool.request().query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE 'WechatPush%'
    ORDER BY TABLE_NAME
  `);
  console.log('\n当前所有企微推送相关表:');
  (check.recordset || []).forEach((r: any) => console.log('  ' + r.TABLE_NAME));

  const modCount = await pool.request().query('SELECT COUNT(*) AS c FROM WechatPushModules');
  console.log(`\n已注册模块: ${modCount.recordset[0].c} 个`);

  process.exit(0);
}

main().catch((e: any) => {
  console.error('建表失败:', e.message);
  process.exit(1);
});
