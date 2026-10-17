const sql = require('mssql');
const { dbConfig: config } = require('./dist/config/db.js');
(async () => {
  const pool = await sql.connect(config);
  // 用户全 表结构（找离职/在职字段）
  const cols = await pool.request().query(`
    SELECT c.name AS col, t.name AS type FROM sys.columns c
    JOIN sys.types t ON c.user_type_id = t.user_type_id
    WHERE c.object_id = OBJECT_ID('用户全') ORDER BY c.column_id`);
  console.log('[用户全] 列:', cols.recordset.map(c => c.col).join(' | '));
  // 离职相关表
  const tabs = await pool.request().query(`
    SELECT name FROM sys.tables WHERE name LIKE '%resign%' OR name LIKE '%resign%' OR name LIKE '%liang%' OR name LIKE '%离职%' OR name LIKE '%leave%'`);
  console.log('[离职相关表]', tabs.recordset.map(t => t.name).join(', ') || '(无)');
  await pool.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
