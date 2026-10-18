import sql from 'mssql';
import { getPool } from '../../config/db';

// ============================================================
// 离职管理（Resignation）数据模型 v1（2026-10-18）
// 离职登记使用独立表 resignation_record，不改共享业务表「用户全」表结构。
// 本轮范围：用户管理点「离职」→ 登记入离职管理列表。
// 离职审批流转（同意/驳回/交接/内购卡转普卡联动等）等待用户确认流程后扩展，
// status 预置 'pending'（待审批），审批完成后由后续流程推进。
// 启动时由 server.ts 在 ensureOnboardingTables() 之后调用 ensureResignationTables()。
// ============================================================

async function tableExists(pool: sql.ConnectionPool, name: string): Promise<boolean> {
  const r = await pool.request().input('name', sql.NVarChar, name)
    .query(`SELECT COUNT(*) AS cnt FROM sys.tables WHERE name = @name`);
  return (r.recordset?.[0]?.cnt ?? 0) > 0;
}

/** 离职登记表（一人一条，user_code 唯一；登记时快照用户全表基础信息） */
async function ensureTableResignation(pool: sql.ConnectionPool) {
  const name = 'resignation_record';
  if (await tableExists(pool, name)) return;
  await pool.request().query(`
    CREATE TABLE resignation_record (
      id INT IDENTITY(1,1) PRIMARY KEY,
      user_code NVARCHAR(50) NOT NULL,              -- 用户代码（用户全.用户代码，快照）
      user_name NVARCHAR(50) NOT NULL,              -- 姓名（快照）
      org_name NVARCHAR(200) NULL,                  -- 组织/部门（快照）
      phone NVARCHAR(20) NULL,                      -- 手机号（快照）
      status NVARCHAR(20) NOT NULL DEFAULT 'pending', -- 待审批（审批流转待确认后扩展）
      remark NVARCHAR(500) NULL,                    -- 离职备注/原因
      operator_code NVARCHAR(50) NULL,              -- 操作人（用户代码）
      operator_name NVARCHAR(50) NULL,              -- 操作人（姓名）
      resign_time DATETIME NOT NULL DEFAULT GETDATE(), -- 离职登记时间
      create_time DATETIME NOT NULL DEFAULT GETDATE(),
      update_time DATETIME NOT NULL DEFAULT GETDATE(),
      CONSTRAINT UQ_resignation_record_user UNIQUE (user_code)
    );
    CREATE INDEX IX_resignation_record_status ON resignation_record (status);
  `);
  console.log('[Resignation] 表 resignation_record 创建完成');
}

/** 统一入口：幂等建离职管理表（失败不阻断服务启动） */
export async function ensureResignationTables(): Promise<void> {
  try {
    const pool = await getPool();
    await ensureTableResignation(pool);
    console.log('[Resignation] 离职管理数据模型初始化完成');
  } catch (e: any) {
    console.error('[Resignation] 离职管理建表失败（不影响服务启动，功能暂不可用）:', e.message);
  }
}