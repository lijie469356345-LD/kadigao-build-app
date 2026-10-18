import sql from 'mssql';
import { getPool } from '../../config/db';

// ============================================================
// 入职管理（Onboarding）数据模型 v1（2026-10-12）
// 对应七阶段流程：
//   阶段一 新员工扫码录入 → pending_review（待督导初审）
//   阶段二 督导初审：驳回 → rejected；同意 → graded（已定级待行政开通）
//   阶段三 管理层只读监管（无状态变化）
//   阶段四 行政快速建用户四项完成后 → account_ready（账号开通完成待下发）
//   阶段五 督导下发 → probation（15天考核期，自动计时）
//   阶段六 督导确认考核合格 → probation_passed（待工牌申请）；提交制作申请 → badge_applied
//   阶段七 行政提交广告公司制作 → badge_making（生成报销单）；财务核销 → completed（全部完成）
// 状态机汇总：
//   pending_review → graded / rejected
//   graded → account_ready
//   account_ready → probation
//   probation → probation_passed
//   probation_passed → badge_applied
//   badge_applied → badge_making
//   badge_making → completed
//   rejected / completed 为终态
// ────────────────────────────────────────────────────────────
// 建表（幂等）：表不存在才创建；已存在仅追加缺失列（如需），不破坏已有数据。
// 启动时由 server.ts 在 ensureStandardPermissionTables() 之后调用 ensureOnboardingTables()。
// ============================================================

async function tableExists(pool: sql.ConnectionPool, name: string): Promise<boolean> {
  const r = await pool.request().input('name', sql.NVarChar, name)
    .query(`SELECT COUNT(*) AS cnt FROM sys.tables WHERE name = @name`);
  return (r.recordset?.[0]?.cnt ?? 0) > 0;
}

/** 入职记录主表（一人一记录，手机号唯一，被驳回后允许重新提交）
 *  注意：建档完成（account_ready）即入职成功，随后转入转正管理（待入职 → 考核 → 转正 → 工牌/企微码/报销） */
async function ensureTableOnboardingRecord(pool: sql.ConnectionPool) {
  const name = 'onboarding_record';
  if (await tableExists(pool, name)) {
    // 幂等补列 1：转正后需登记员工个人企微二维码（wecom_qr）
    const col = await pool.request().query(
      `SELECT COUNT(*) AS cnt FROM sys.columns WHERE object_id = OBJECT_ID('onboarding_record') AND name = 'wecom_qr'`);
    if ((col.recordset?.[0]?.cnt ?? 0) === 0) {
      await pool.request().query(`ALTER TABLE onboarding_record ADD wecom_qr NVARCHAR(MAX) NULL`);
      console.log('[Onboarding] 表 onboarding_record 追加列 wecom_qr 完成');
    }
    // 幂等补列 2：快速建用户需登记会员代码（member_code）
    const col2 = await pool.request().query(
      `SELECT COUNT(*) AS cnt FROM sys.columns WHERE object_id = OBJECT_ID('onboarding_record') AND name = 'member_code'`);
    if ((col2.recordset?.[0]?.cnt ?? 0) === 0) {
      await pool.request().query(`ALTER TABLE onboarding_record ADD member_code NVARCHAR(100) NULL`);
      console.log('[Onboarding] 表 onboarding_record 追加列 member_code 完成');
    }
    return;
  }
  await pool.request().query(`
    CREATE TABLE onboarding_record (
      id INT IDENTITY(1,1) PRIMARY KEY,
      apply_no NVARCHAR(40) NOT NULL,               -- 入职申请编号：OB + 年月日 + 序列
      user_code NVARCHAR(50) NOT NULL,              -- 系统工号：ON + 5 位序号
      phone NVARCHAR(20) NOT NULL,                  -- 手机号（查重/唯一）
      user_name NVARCHAR(50) NOT NULL,              -- 姓名
      gender NVARCHAR(10) NULL,
      id_card NVARCHAR(30) NULL,
      birthday NVARCHAR(20) NULL,
      education NVARCHAR(30) NULL,                  -- 学历
      emergency_contact NVARCHAR(50) NULL,          -- 紧急联系人
      emergency_phone NVARCHAR(20) NULL,
      address NVARCHAR(200) NULL,
      email NVARCHAR(100) NULL,
      resume_text NVARCHAR(MAX) NULL,               -- 自我评价/简历文本
      materials_json NVARCHAR(MAX) NULL,            -- 佐证材料（文件名数组 JSON）
      status NVARCHAR(30) NOT NULL DEFAULT 'pending_review', -- 状态机见文件头注释
      supervisor_code NVARCHAR(50) NULL,            -- 负责督导（用户代码）
      supervisor_name NVARCHAR(50) NULL,
      reviewer_code NVARCHAR(50) NULL,              -- 初审人
      reviewer_name NVARCHAR(50) NULL,
      review_time DATETIME NULL,
      reject_reason NVARCHAR(500) NULL,             -- 驳回原因
      shop_id INT NULL,                             -- 定级：绑定店铺（sys_org shop 节点）
      shop_name NVARCHAR(100) NULL,
      level NVARCHAR(50) NULL,                      -- 定级：核定职级
      salary_scheme_id INT NULL,                    -- 定级：薪资方案
      salary_scheme_name NVARCHAR(100) NULL,
      grade_time DATETIME NULL,                     -- 定级提交时间
      admin_user_code NVARCHAR(50) NULL,            -- 快速建用户：系统后台账号
      admin_bojun_account NVARCHAR(100) NULL,       -- 快速建用户：伯俊账号
      admin_group_qr NVARCHAR(MAX) NULL,            -- 快速建用户：企微总群二维码（URL/说明）
      admin_member_qr NVARCHAR(MAX) NULL,           -- 快速建用户：店铺会员注册码（URL/说明）
      member_code NVARCHAR(100) NULL,               -- 快速建用户：会员代码（内购卡调整用）
      admin4_json NVARCHAR(MAX) NULL,               -- 四项开通确认明细 JSON
      admin_finish_time DATETIME NULL,              -- 行政提交确认时间
      issue_time DATETIME NULL,                     -- 督导下发时间（进入15天考核）
      probation_start DATETIME NULL,                -- 考核期开始（下发时自动置）
      probation_end DATETIME NULL,                  -- 考核期结束（下发 + 15 天）
      probation_confirm_time DATETIME NULL,         -- 督导确认考核时间
      probation_confirm_by NVARCHAR(50) NULL,
      badge_apply_time DATETIME NULL,               -- 督导提交工牌制作申请时间
      badge_no NVARCHAR(50) NULL,                   -- 工牌编号
      badge_amount DECIMAL(10,2) NULL,              -- 工牌制作费用
      wecom_qr NVARCHAR(MAX) NULL,                  -- 转正后：员工个人企微二维码（URL/说明）
      day3_warned INT NOT NULL DEFAULT 0,           -- 第3天预警已提醒标记
      day7_logged INT NOT NULL DEFAULT 0,           -- 第7天超时台账已记录标记
      remark NVARCHAR(500) NULL,
      create_time DATETIME NOT NULL DEFAULT GETDATE(),
      update_time DATETIME NOT NULL DEFAULT GETDATE(),
      CONSTRAINT UQ_onboarding_record_phone UNIQUE (phone)
    );
    CREATE INDEX IX_onboarding_record_status ON onboarding_record (status);
    CREATE INDEX IX_onboarding_record_supervisor ON onboarding_record (supervisor_code, status);
  `);
  console.log('[Onboarding] 表 onboarding_record 创建完成');
}

/** 薪资方案配置表（督导定级时选择；无现成数据源，内置种子） */
async function ensureTableSalaryScheme(pool: sql.ConnectionPool) {
  const name = 'onboarding_salary_scheme';
  if (await tableExists(pool, name)) return;
  await pool.request().query(`
    CREATE TABLE onboarding_salary_scheme (
      id INT IDENTITY(1,1) PRIMARY KEY,
      scheme_name NVARCHAR(100) NOT NULL,
      scheme_desc NVARCHAR(500) NULL,
      sort_order INT NOT NULL DEFAULT 0,
      enabled INT NOT NULL DEFAULT 1,
      create_time DATETIME NOT NULL DEFAULT GETDATE()
    );
  `);
  // 种子方案（可后续在数据中维护）
  const seeds: [string, string][] = [
    ['底薪+提成（直营）', '底薪按当地标准 + 销售额提成，适用于直营门店'],
    ['纯提成制', '无底薪，按销售额/毛利提成，适用于部分联营门店'],
    ['底薪+绩效（店长）', '底薪 + 门店绩效奖金，适用于店长职级'],
    ['底薪+提成（试用期）', '试用期底薪 80% + 提成，考核通过后按正式方案执行'],
  ];
  for (const [n, d] of seeds) {
    await pool.request().input('n', sql.NVarChar, n).input('d', sql.NVarChar, d)
      .query(`INSERT INTO onboarding_salary_scheme (scheme_name, scheme_desc, sort_order) VALUES (@n, @d, 0)`);
  }
  console.log('[Onboarding] 表 onboarding_salary_scheme 创建完成（含种子方案）');
}

/** 工牌制作统计台账（行政/财务共享；财务核销后联动主记录 closed） */
async function ensureTableBadgeLedger(pool: sql.ConnectionPool) {
  const name = 'onboarding_badge_ledger';
  if (await tableExists(pool, name)) return;
  await pool.request().query(`
    CREATE TABLE onboarding_badge_ledger (
      id INT IDENTITY(1,1) PRIMARY KEY,
      record_id INT NOT NULL,                       -- 关联入职记录
      apply_no NVARCHAR(40) NOT NULL,
      user_name NVARCHAR(50) NOT NULL,
      phone NVARCHAR(20) NULL,
      shop_name NVARCHAR(100) NULL,
      level NVARCHAR(50) NULL,
      badge_no NVARCHAR(50) NULL,                   -- 工牌编号
      status NVARCHAR(20) NOT NULL DEFAULT 'pending', -- pending 待制作 / making 制作中 / made 已制作 / reimbursed 已报销
      maker NVARCHAR(100) NULL,                     -- 广告公司
      amount DECIMAL(10,2) NULL,                    -- 制作费用
      reimburse_no NVARCHAR(50) NULL,               -- 报销单号
      apply_time DATETIME NOT NULL DEFAULT GETDATE(), -- 督导申请时间
      submit_make_time DATETIME NULL,               -- 行政提交制作时间
      made_time DATETIME NULL,                      -- 制作完成时间
      reimburse_time DATETIME NULL,                 -- 报销核销时间
      finance_reviewer NVARCHAR(50) NULL,
      remark NVARCHAR(500) NULL,
      create_time DATETIME NOT NULL DEFAULT GETDATE(),
      update_time DATETIME NOT NULL DEFAULT GETDATE(),
      CONSTRAINT UQ_onboarding_badge_ledger_record UNIQUE (record_id)
    );
    CREATE INDEX IX_onboarding_badge_ledger_status ON onboarding_badge_ledger (status);
  `);
  console.log('[Onboarding] 表 onboarding_badge_ledger 创建完成');
}

/** 工牌报销单（行政提交制作时自动生成，流转财务审批核销） */
async function ensureTableReimburse(pool: sql.ConnectionPool) {
  const name = 'onboarding_reimburse';
  if (await tableExists(pool, name)) return;
  await pool.request().query(`
    CREATE TABLE onboarding_reimburse (
      id INT IDENTITY(1,1) PRIMARY KEY,
      ledger_id INT NOT NULL,                       -- 关联工牌台账
      record_id INT NOT NULL,                       -- 关联入职记录
      reimburse_no NVARCHAR(50) NOT NULL,           -- 报销单号：RB + 年月日 + 序列
      amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      status NVARCHAR(20) NOT NULL DEFAULT 'pending', -- pending 待财务审核 / approved 已审核待核销 / settled 已核销
      apply_time DATETIME NOT NULL DEFAULT GETDATE(), -- 报销单申请时间
      finance_reviewer NVARCHAR(50) NULL,
      finance_review_time DATETIME NULL,
      remark NVARCHAR(500) NULL,
      create_time DATETIME NOT NULL DEFAULT GETDATE(),
      CONSTRAINT UQ_onboarding_reimburse_ledger UNIQUE (ledger_id)
    );
    CREATE INDEX IX_onboarding_reimburse_status ON onboarding_reimburse (status);
  `);
  console.log('[Onboarding] 表 onboarding_reimburse 创建完成');
}

/** 内购卡调整提醒（由会员专员在会员系统实际处理，本系统仅收集/展示，不执行业务） */
async function ensureTableCardAdjust(pool: sql.ConnectionPool) {
  const name = 'onboarding_card_adjust';
  if (await tableExists(pool, name)) {
    // 幂等补列：内购卡调整需展示手机号、会员代码；确认已处理需记录处理人
    for (const col of ['phone', 'member_code', 'handler']) {
      const c = await pool.request().input('col', sql.NVarChar, col)
        .query(`SELECT COUNT(*) AS cnt FROM sys.columns WHERE object_id = OBJECT_ID('onboarding_card_adjust') AND name = @col`);
      if ((c.recordset?.[0]?.cnt ?? 0) === 0) {
        await pool.request().query(`ALTER TABLE onboarding_card_adjust ADD ${col} NVARCHAR(100) NULL`);
        console.log(`[Onboarding] 表 onboarding_card_adjust 追加列 ${col} 完成`);
      }
    }
    return;
  }
  await pool.request().query(`
    CREATE TABLE onboarding_card_adjust (
      id INT IDENTITY(1,1) PRIMARY KEY,
      user_name NVARCHAR(50) NOT NULL,
      user_code NVARCHAR(50) NULL,                  -- 系统账号（若有）
      phone NVARCHAR(20) NULL,                      -- 手机号（调整时展示）
      member_code NVARCHAR(100) NULL,               -- 会员代码（调整时展示）
      adjust_type NVARCHAR(20) NOT NULL,            -- normal_to_inner 新员工普卡转内购卡 / inner_to_normal 离职内购卡转普卡
      reason NVARCHAR(500) NULL,
      submitter NVARCHAR(50) NULL,                  -- 提交人
      status NVARCHAR(20) NOT NULL DEFAULT 'pending', -- pending 待会员专员处理 / done 已处理
      handler NVARCHAR(50) NULL,                    -- 处理人（确认已处理时记录）
      handle_time DATETIME NULL,
      remark NVARCHAR(500) NULL,
      create_time DATETIME NOT NULL DEFAULT GETDATE(),
      update_time DATETIME NOT NULL DEFAULT GETDATE()
    );
    CREATE INDEX IX_onboarding_card_adjust_status ON onboarding_card_adjust (status);
  `);
  console.log('[Onboarding] 表 onboarding_card_adjust 创建完成');
}

/** 入职超时台账（第3天预警 / 第7天超时自动记录，供督导时效监管） */
async function ensureTableTimeoutLog(pool: sql.ConnectionPool) {
  const name = 'onboarding_timeout_log';
  if (await tableExists(pool, name)) return;
  await pool.request().query(`
    CREATE TABLE onboarding_timeout_log (
      id INT IDENTITY(1,1) PRIMARY KEY,
      record_id INT NOT NULL,
      apply_no NVARCHAR(40) NOT NULL,
      user_name NVARCHAR(50) NOT NULL,
      warn_type NVARCHAR(20) NOT NULL,              -- day3 预警 / day7 超时台账
      warn_time DATETIME NOT NULL DEFAULT GETDATE(),
      content NVARCHAR(500) NULL
    );
    CREATE INDEX IX_onboarding_timeout_log_record ON onboarding_timeout_log (record_id);
  `);
  console.log('[Onboarding] 表 onboarding_timeout_log 创建完成');
}

/** 统一入口：幂等建全部入职管理表 + 种子数据 */
export async function ensureOnboardingTables(): Promise<void> {
  try {
    const pool = await getPool();
    await ensureTableOnboardingRecord(pool);
    await ensureTableSalaryScheme(pool);
    await ensureTableBadgeLedger(pool);
    await ensureTableReimburse(pool);
    await ensureTableCardAdjust(pool);
    await ensureTableTimeoutLog(pool);
    console.log('[Onboarding] 入职管理数据模型初始化完成');
  } catch (e: any) {
    console.error('[Onboarding] 入职管理建表失败（不影响服务启动，功能暂不可用）:', e.message);
  }
}