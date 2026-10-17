// 快速脚本：注册 inspection_task 模块 + 同步所有字段到数据库
import { getPool } from '../../../config/db';
import sql from 'mssql';

async function main() {
  const pool = await getPool();

  // 注册 inspection_task 模块
  await pool.request()
    .input('code', sql.NVarChar, 'inspection_task')
    .input('name', sql.NVarChar, '巡店任务')
    .input('portal', sql.NVarChar, 'inspection')
    .input('portalName', sql.NVarChar, '巡店管理')
    .input('table', sql.NVarChar, 'InspectionTasks')
    .input('statusField', sql.NVarChar, 'status')
    .input('statusVal', sql.NVarChar, 'completed')
    .query(`
      IF NOT EXISTS (SELECT 1 FROM WechatPushModules WHERE moduleCode = @code)
        INSERT INTO WechatPushModules (moduleCode, moduleName, portalCode, portalName, sourceTable, statusField, statusTriggerValue)
        VALUES (@code, @name, @portal, @portalName, @table, @statusField, @statusVal)
    `);

  console.log('inspection_task 模块已注册（如不存在）');

  // 列出所有模块
  const mods = await pool.request().query('SELECT moduleCode, moduleName FROM WechatPushModules ORDER BY moduleCode');
  console.log('\n当前注册的模块:');
  for (const m of mods.recordset || []) {
    console.log(`  ${m.moduleCode} — ${m.moduleName}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
