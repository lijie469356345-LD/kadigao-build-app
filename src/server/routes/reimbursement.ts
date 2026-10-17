import { Router, Request, Response } from 'express';
import sql from 'mssql';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { getPool } from '../../config/db';

const router = Router();
let ensured = false;

// ============================================================
// 建表逻辑
// ============================================================
async function ensureTables(): Promise<void> {
  if (ensured) return;
  const pool = await getPool();

  // 1. 报销主表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Reimbursement')
    CREATE TABLE Reimbursement (
      id INT IDENTITY(1,1) PRIMARY KEY,
      reimburseNo NVARCHAR(50) NOT NULL,
      applicantId NVARCHAR(100) NOT NULL,
      applicantName NVARCHAR(100) NOT NULL,
      department NVARCHAR(100),
      reimburseDate DATE NOT NULL,
      reimburseType NVARCHAR(50) NOT NULL,
      reason NVARCHAR(500),
      totalAmount DECIMAL(18,2) DEFAULT 0,
      taxTotal DECIMAL(18,2) DEFAULT 0,
      advanceDeduction DECIMAL(18,2) DEFAULT 0,
      actualPayable DECIMAL(18,2) DEFAULT 0,
      status NVARCHAR(30) DEFAULT 'draft',
      templateId INT,
      budgetWarn BIT DEFAULT 0,
      budgetExceed BIT DEFAULT 0,
      financeRemark NVARCHAR(500),
      financeStatus NVARCHAR(30),
      financeRejectReason NVARCHAR(500),
      payStatus NVARCHAR(30) DEFAULT 'unpaid',
      payDate DATE,
      paySerialNo NVARCHAR(100),
      voucherId INT,
      createdBy NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE()
    )
  `);

  // 2. 费用明细表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ReimbursementItem')
    CREATE TABLE ReimbursementItem (
      id INT IDENTITY(1,1) PRIMARY KEY,
      reimburseId INT NOT NULL,
      expenseType NVARCHAR(50) NOT NULL,
      occurDate DATE NOT NULL,
      amount DECIMAL(18,2) NOT NULL,
      taxRate DECIMAL(5,2) DEFAULT 0,
      taxAmount DECIMAL(18,2) DEFAULT 0,
      remark NVARCHAR(500),
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);
  // 升级：taxRate 从 DECIMAL(5,4) 小数改为 DECIMAL(5,2) 百分比（0.13 -> 13）
  try { await pool.request().query(`ALTER TABLE ReimbursementItem ALTER COLUMN taxRate DECIMAL(5,2)`); } catch (_e) {}
  try { await pool.request().query(`UPDATE ReimbursementItem SET taxRate = taxRate * 100 WHERE taxRate < 1 AND taxRate > 0`); } catch (_e) {}

  // 3. 附件表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ReimbursementAttachment')
    CREATE TABLE ReimbursementAttachment (
      id INT IDENTITY(1,1) PRIMARY KEY,
      reimburseId INT NOT NULL,
      fileName NVARCHAR(300),
      filePath NVARCHAR(500),
      fileType NVARCHAR(50),
      uploadedBy NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);

  // 4. 模板表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ReimbursementTemplate')
    CREATE TABLE ReimbursementTemplate (
      id INT IDENTITY(1,1) PRIMARY KEY,
      templateName NVARCHAR(100) NOT NULL,
      reimburseType NVARCHAR(50),
      reason NVARCHAR(500),
      isPublic BIT DEFAULT 1,
      createdBy NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);

  // 5. 预借款表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'EmployeeAdvance')
    CREATE TABLE EmployeeAdvance (
      id INT IDENTITY(1,1) PRIMARY KEY,
      employeeId NVARCHAR(100) NOT NULL,
      employeeName NVARCHAR(100) NOT NULL,
      advanceNo NVARCHAR(50),
      advanceAmount DECIMAL(18,2) NOT NULL,
      deductedAmount DECIMAL(18,2) DEFAULT 0,
      balance DECIMAL(18,2) NOT NULL,
      advanceDate DATE NOT NULL,
      remark NVARCHAR(500),
      status NVARCHAR(30) DEFAULT 'active',
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);
  // 升级：为 EmployeeAdvance 增加费用类型和审批状态字段
  try { await pool.request().query(`IF COL_LENGTH('dbo.EmployeeAdvance','expenseType') IS NULL ALTER TABLE EmployeeAdvance ADD expenseType NVARCHAR(50)`); } catch (_e) {}
  try { await pool.request().query(`IF COL_LENGTH('dbo.EmployeeAdvance','approvalStatus') IS NULL ALTER TABLE EmployeeAdvance ADD approvalStatus NVARCHAR(30) DEFAULT 'approved'`); } catch (_e) {}
  try { await pool.request().query(`IF COL_LENGTH('dbo.EmployeeAdvance','applyReason') IS NULL ALTER TABLE EmployeeAdvance ADD applyReason NVARCHAR(500)`); } catch (_e) {}
  try { await pool.request().query(`IF COL_LENGTH('dbo.EmployeeAdvance','approvedBy') IS NULL ALTER TABLE EmployeeAdvance ADD approvedBy NVARCHAR(100)`); } catch (_e) {}
  try { await pool.request().query(`IF COL_LENGTH('dbo.EmployeeAdvance','approvedAt') IS NULL ALTER TABLE EmployeeAdvance ADD approvedAt DATETIME`); } catch (_e) {}
  try { await pool.request().query(`IF COL_LENGTH('dbo.EmployeeAdvance','rejectReason') IS NULL ALTER TABLE EmployeeAdvance ADD rejectReason NVARCHAR(500)`); } catch (_e) {}

  // 6. 预算配置表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'BudgetConfig')
    CREATE TABLE BudgetConfig (
      id INT IDENTITY(1,1) PRIMARY KEY,
      budgetType NVARCHAR(30) NOT NULL,
      targetName NVARCHAR(100) NOT NULL,
      budgetYear INT NOT NULL,
      budgetMonth INT,
      totalBudget DECIMAL(18,2) NOT NULL,
      usedAmount DECIMAL(18,2) DEFAULT 0,
      remark NVARCHAR(500),
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);

  // 7. 凭证表（报销单生成的会计凭证）
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ReimbursementVoucher')
    CREATE TABLE ReimbursementVoucher (
      id INT IDENTITY(1,1) PRIMARY KEY,
      voucherNo NVARCHAR(50) NOT NULL,
      reimburseId INT NOT NULL,
      sourceType NVARCHAR(20) DEFAULT 'reimbursement',
      voucherDate DATE NOT NULL,
      debitSubject NVARCHAR(100),
      creditSubject NVARCHAR(100),
      amount DECIMAL(18,2) NOT NULL,
      summary NVARCHAR(500),
      createdAt DATETIME DEFAULT GETDATE()
    )
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('ReimbursementVoucher') AND name = 'sourceType')
    ALTER TABLE ReimbursementVoucher ADD sourceType NVARCHAR(20) DEFAULT 'reimbursement'
  `);

  // 8. 审批流配置表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ApprovalFlow')
    CREATE TABLE ApprovalFlow (
      id INT IDENTITY(1,1) PRIMARY KEY,
      flowNo NVARCHAR(50) NOT NULL,
      expenseType NVARCHAR(50),
      expenseCategory NVARCHAR(100),
      paymentType NVARCHAR(50),
      approvalSteps NVARCHAR(MAX),
      conditionConfig NVARCHAR(MAX),
      status NVARCHAR(20) DEFAULT 'active',
      createdBy NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE(),
      org_id INT NULL,
      org_name NVARCHAR(200) NULL
    )
  `);
  // 审批流兼容补列：org_id/org_name（org_id=NULL 表示流程全局适用，非 NULL 表示仅该组织及其下级可用）
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('ApprovalFlow') AND name = 'org_id')
    ALTER TABLE ApprovalFlow ADD org_id INT NULL
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('ApprovalFlow') AND name = 'org_name')
    ALTER TABLE ApprovalFlow ADD org_name NVARCHAR(200) NULL
  `);
  // 审批流兼容补列：org_ids/org_names（适用范围支持多组织，逗号分隔 id/名称快照；空值=全局适用）
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('ApprovalFlow') AND name = 'org_ids')
    ALTER TABLE ApprovalFlow ADD org_ids NVARCHAR(500) NULL
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('ApprovalFlow') AND name = 'org_names')
    ALTER TABLE ApprovalFlow ADD org_names NVARCHAR(1000) NULL
  `);
  // 审批流兼容补列：cc_users/cc_orgs（抄送配置：JSON 数组 [{userCode,userName}] / [{org_id,org_name}]，审批流末尾全局抄送）
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('ApprovalFlow') AND name = 'cc_users')
    ALTER TABLE ApprovalFlow ADD cc_users NVARCHAR(MAX) NULL
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('ApprovalFlow') AND name = 'cc_orgs')
    ALTER TABLE ApprovalFlow ADD cc_orgs NVARCHAR(MAX) NULL
  `);
  // 历史数据回填：已有单组织的流程补 org_ids/org_names（保持原匹配行为）
  await pool.request().query(`
    UPDATE ApprovalFlow SET org_ids = CAST(org_id AS NVARCHAR(20)), org_names = org_name
    WHERE org_id IS NOT NULL AND (org_ids IS NULL OR org_ids = '')
  `);

  // 9. 账簿表（银行卡/现金账簿管理）
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'LedgerAccount')
    CREATE TABLE LedgerAccount (
      id INT IDENTITY(1,1) PRIMARY KEY,
      accountName NVARCHAR(100) NOT NULL,
      accountHolder NVARCHAR(100),
      accountNo NVARCHAR(100),
      bankName NVARCHAR(100),
      accountType NVARCHAR(30) DEFAULT 'bank',
      balance DECIMAL(18,2) DEFAULT 0,
      status NVARCHAR(20) DEFAULT 'active',
      remark NVARCHAR(500),
      createdAt DATETIME DEFAULT GETDATE()
    )
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('LedgerAccount') AND name = 'accountHolder')
    ALTER TABLE LedgerAccount ADD accountHolder NVARCHAR(100)
  `);

  // 10. 付款记录表（报销/借款/预付款的出纳付款记录）
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PaymentRecord')
    CREATE TABLE PaymentRecord (
      id INT IDENTITY(1,1) PRIMARY KEY,
      payNo NVARCHAR(50) NOT NULL,
      sourceType NVARCHAR(30) NOT NULL,
      sourceId INT NOT NULL,
      sourceNo NVARCHAR(50),
      payee NVARCHAR(100),
      amount DECIMAL(18,2) NOT NULL,
      ledgerId INT,
      ledgerName NVARCHAR(100),
      payDate DATE NOT NULL,
      payMethod NVARCHAR(50),
      voucherId INT,
      remark NVARCHAR(500),
      createdBy NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);

  // 11. 预付款申请表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AdvancePayment')
    CREATE TABLE AdvancePayment (
      id INT IDENTITY(1,1) PRIMARY KEY,
      applyNo NVARCHAR(50) NOT NULL,
      applicantId NVARCHAR(100) NOT NULL,
      applicantName NVARCHAR(100) NOT NULL,
      department NVARCHAR(100),
      expenseType NVARCHAR(50),
      paymentType NVARCHAR(50),
      applyAmount DECIMAL(18,2) NOT NULL,
      applyDate DATE NOT NULL,
      reason NVARCHAR(500),
      approvalStatus NVARCHAR(30) DEFAULT 'pending',
      approvedBy NVARCHAR(100),
      approvedAt DATETIME,
      rejectReason NVARCHAR(500),
      payStatus NVARCHAR(30) DEFAULT 'unpaid',
      payDate DATE,
      payAmount DECIMAL(18,2) DEFAULT 0,
      ledgerId INT,
      voucherId INT,
      createdBy NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE()
    )
  `);

  // 种子数据：默认模板
  const tcnt = await pool.request().query('SELECT COUNT(*) as n FROM ReimbursementTemplate');
  if (tcnt.recordset[0].n === 0) {
    await pool.request().query(`INSERT INTO ReimbursementTemplate (templateName, reimburseType, reason, isPublic, createdBy) VALUES ('出差报销模板', '差旅费', '出差费用报销（交通、住宿、餐饮等）', 1, 'system')`);
    await pool.request().query(`INSERT INTO ReimbursementTemplate (templateName, reimburseType, reason, isPublic, createdBy) VALUES ('业务招待报销模板', '业务招待', '业务招待费用报销（餐饮等）', 1, 'system')`);
    await pool.request().query(`INSERT INTO ReimbursementTemplate (templateName, reimburseType, reason, isPublic, createdBy) VALUES ('办公费报销模板', '办公费', '日常办公费用报销', 1, 'system')`);
    console.log('ReimbursementTemplate 已种子化');
  }

  // 12. 审批任务表（每笔提交的审批流实例，按级别逐条记录）
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ApprovalTask')
    CREATE TABLE ApprovalTask (
      id INT IDENTITY(1,1) PRIMARY KEY,
      sourceType NVARCHAR(30) NOT NULL,
      sourceId INT NOT NULL,
      sourceNo NVARCHAR(50),
      applicantId NVARCHAR(100),
      applicantName NVARCHAR(100),
      flowId INT,
      flowNo NVARCHAR(50),
      level INT NOT NULL,
      totalLevels INT NOT NULL,
      approvers NVARCHAR(MAX),
      status NVARCHAR(20) DEFAULT 'pending',
      approvedBy NVARCHAR(100),
      approvedAt DATETIME,
      rejectReason NVARCHAR(500),
      amount DECIMAL(18,2),
      expenseType NVARCHAR(50),
      reason NVARCHAR(500),
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE(),
      applicantOrgId INT NULL,
      applicantOrgName NVARCHAR(200) NULL,
      applicantOrgPath NVARCHAR(MAX) NULL
    )
  `);
  // 审批任务兼容补列：applicantOrgId/Name/Path（申请人组织快照，用于跨组织隔离与组织审批人解析）
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('ApprovalTask') AND name = 'applicantOrgId')
    ALTER TABLE ApprovalTask ADD applicantOrgId INT NULL
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('ApprovalTask') AND name = 'applicantOrgName')
    ALTER TABLE ApprovalTask ADD applicantOrgName NVARCHAR(200) NULL
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('ApprovalTask') AND name = 'applicantOrgPath')
    ALTER TABLE ApprovalTask ADD applicantOrgPath NVARCHAR(MAX) NULL
  `);
  // 审批任务兼容补列：cc_users/cc_orgs（创建任务时固化的抄送快照，JSON 数组；抄送人可查看单据与审批进度）
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('ApprovalTask') AND name = 'cc_users')
    ALTER TABLE ApprovalTask ADD cc_users NVARCHAR(MAX) NULL
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('ApprovalTask') AND name = 'cc_orgs')
    ALTER TABLE ApprovalTask ADD cc_orgs NVARCHAR(MAX) NULL
  `);

  // ============================================================
  // 组织化改造（2026-09）：报销/借款/付款单据归属组织（替换原「部门」语义）
  //  - 新增 org_id / org_name 列；创建单据时自动填充申请人组织（sys_org）
  //  - 数据权限：用户仅可见自己组织及其下级组织的单据
  // ============================================================
  // Reimbursement
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Reimbursement') AND name = 'org_id')
    ALTER TABLE Reimbursement ADD org_id INT NULL
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Reimbursement') AND name = 'org_name')
    ALTER TABLE Reimbursement ADD org_name NVARCHAR(200) NULL
  `);
  // EmployeeAdvance（预借款）
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EmployeeAdvance') AND name = 'org_id')
    ALTER TABLE EmployeeAdvance ADD org_id INT NULL
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EmployeeAdvance') AND name = 'org_name')
    ALTER TABLE EmployeeAdvance ADD org_name NVARCHAR(200) NULL
  `);
  // AdvancePayment（预付款申请）
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('AdvancePayment') AND name = 'org_id')
    ALTER TABLE AdvancePayment ADD org_id INT NULL
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('AdvancePayment') AND name = 'org_name')
    ALTER TABLE AdvancePayment ADD org_name NVARCHAR(200) NULL
  `);
  // PaymentRecord（付款记录）
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('PaymentRecord') AND name = 'org_id')
    ALTER TABLE PaymentRecord ADD org_id INT NULL
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('PaymentRecord') AND name = 'org_name')
    ALTER TABLE PaymentRecord ADD org_name NVARCHAR(200) NULL
  `);

  // 历史数据回填（仅回填可解析的组织；权限表未建时跳过不报错）
  // department 统一覆盖为组织名，完成「部门→组织」语义替换
  const backlogSql = (userCol: string, table: string) => `
    UPDATE T SET
      org_id = X.org_id,
      org_name = X.org_name,
      department = ISNULL(X.org_name, T.department)
    FROM ${table} T
    JOIN (
      SELECT ur.user_code, ur.org_id, o.org_name,
             ROW_NUMBER() OVER (PARTITION BY ur.user_code ORDER BY ur.id DESC) rn
      FROM sys_user_role ur
      JOIN sys_org o ON o.org_id = ur.org_id AND o.del_flag = 0
      WHERE ur.org_id IS NOT NULL
    ) X ON X.user_code = T.${userCol} AND X.rn = 1
    WHERE T.org_id IS NULL
  `;
  try { await pool.request().query(backlogSql('applicantId', 'Reimbursement')); } catch (_e) {}
  try { await pool.request().query(backlogSql('employeeId', 'EmployeeAdvance')); } catch (_e) {}
  try { await pool.request().query(backlogSql('applicantId', 'AdvancePayment')); } catch (_e) {}
  // 付款记录：按来源单继承组织
  try {
    await pool.request().query(`
      UPDATE P SET
        org_id = SRC.org_id,
        org_name = SRC.org_name
      FROM PaymentRecord P
      JOIN (
        SELECT id, org_id, org_name FROM Reimbursement WHERE org_id IS NOT NULL
        UNION ALL
        SELECT id, org_id, org_name FROM EmployeeAdvance WHERE org_id IS NOT NULL
        UNION ALL
        SELECT id, org_id, org_name FROM AdvancePayment WHERE org_id IS NOT NULL
      ) SRC ON (P.sourceType = 'reimbursement' AND SRC.id = P.sourceId)
            OR (P.sourceType = 'advance' AND SRC.id = P.sourceId)
            OR (P.sourceType = 'advance_payment' AND SRC.id = P.sourceId)
      WHERE P.org_id IS NULL
    `);
  } catch (_e) {}

  ensured = true;
  console.log('Reimbursement tables ensured');
}

// ============================================================
// 组织数据权限（报销/借款/付款）：
//  报销借款付款单据归属「组织」（sys_org），非特权用户仅可见自己组织
//  及其下级组织的数据（特权/全局角色不受限）。
//  返回：null → 不限制；{kind:'all'} → 全量；{kind:'self'} → 仅本人；
//        {kind:'orgs'} → 组织集合（自己组织及下级）。
// ============================================================
type OrgScope =
  | null
  | { kind: 'all' }
  | { kind: 'self'; userCode: string }
  | { kind: 'orgs'; orgIds: number[] };

async function resolveOrgScope(pool: sql.ConnectionPool, user: any): Promise<OrgScope> {
  if (!user) return null; // 无登录身份（内部调用/历史兼容）：不限制
  if (user.isAdmin === '是') return { kind: 'all' };
  const privileged = ['super_admin', 'data_admin', 'it'];
  if ((user.roleCodes && user.roleCodes.some((c: string) => privileged.includes(c)))) return { kind: 'all' };
  const ds = user.dataScope ?? null;
  if (ds === 5) return { kind: 'all' }; // 全局
  if (ds === 1) return { kind: 'self', userCode: user.userCode }; // 仅本人
  // 组织集合：默认 2（本组织）/3（本组织及下级，最常用）/null（按角色缺省，按本组织及下级处理）
  const bases: number[] = [];
  if (ds === 4 && user.dataScopeOrgIds) {
    for (const s of String(user.dataScopeOrgIds).split(',')) {
      const v = Number(s.trim());
      if (v > 0) bases.push(v);
    }
  }
  if (bases.length === 0 && user.orgId) bases.push(Number(user.orgId));
  if (bases.length === 0) return null;
  const uniqBases = Array.from(new Set(bases));
  // 自己组织及下级：ancestors 为祖先路径（形如 '/1/2/'），命中即下级
  const likePatterns = uniqBases.map(b => `ancestors LIKE '%/${b}/%'`).join(' OR ');
  try {
    const r = await pool.request().query(`
      SELECT org_id FROM sys_org
      WHERE del_flag = 0 AND (org_id IN (${uniqBases.join(',')}) OR ${likePatterns})
    `);
    const orgIds = Array.from(new Set(r.recordset.map((row: any) => Number(row.org_id))));
    if (orgIds.length === 0) return null;
    return { kind: 'orgs', orgIds };
  } catch {
    // 权限表不可用时降级：仅本人组织本身
    return { kind: 'orgs', orgIds: uniqBases };
  }
}

// 组织范围 → SQL 过滤条件（返回片段与命名参数）
function orgScopeWhere(scope: OrgScope, idCol: string, selfCol: string, params: { name: string; type: any; value: any }[]): string {
  if (!scope) return '';
  if (scope.kind === 'all') return '';
  if (scope.kind === 'self') {
    params.push({ name: 'scopeUc', type: sql.NVarChar, value: scope.userCode });
    return ` AND ${selfCol} = @scopeUc`;
  }
  params.push({ name: 'scopeIds', type: sql.NVarChar, value: scope.orgIds.join(',') });
  return ` AND ${idCol} IN (SELECT value FROM STRING_SPLIT(@scopeIds, ','))`;
}

// 抄送可见性：返回当前用户被抄送的单据 sourceId 列表（用于列表/详情在组织权限之外追加放行）
//  - 命中规则：任务 cc_users 含当前用户，或 cc_orgs 任意组织是当前用户组织链的祖先/自身（即用户属于被抄送组织及其下级）
//  - user 无身份（内部调用）时返回 []（不额外放行，由原组织权限决定）
async function resolveCcVisibleSourceIds(pool: sql.ConnectionPool, sourceType: string, user: any): Promise<number[]> {
  if (!user || !user.userCode) return [];
  const uCode = String(user.userCode);
  // 解析当前用户组织链（orgPath 形如 /1/2/3/）
  let userOrgPath: string | null = null;
  try {
    const orgInfo = await resolveApplicantOrg(pool, uCode);
    userOrgPath = orgInfo ? orgInfo.orgPath : null;
  } catch { /* ignore */ }

  let rows: any[] = [];
  try {
    const r = await pool.request()
      .input('sourceType', sql.NVarChar, sourceType)
      .query(`SELECT sourceId, cc_users, cc_orgs FROM ApprovalTask WHERE sourceType = @sourceType AND (cc_users IS NOT NULL OR cc_orgs IS NOT NULL)`);
    rows = r.recordset;
  } catch { return []; }
  if (rows.length === 0) return [];

  const ids = new Set<number>();
  for (const row of rows) {
    const ccUsers = safeParseCcArray(row.cc_users);
    const ccOrgs = safeParseCcArray(row.cc_orgs);
    let hit = ccUsers.some((u: any) => u && u.userCode === uCode);
    if (!hit && ccOrgs.length > 0 && userOrgPath) {
      hit = ccOrgs.some((o: any) => o && o.org_id != null && isOrgInRange(Number(o.org_id), userOrgPath));
    }
    if (hit && row.sourceId != null) ids.add(Number(row.sourceId));
  }
  return Array.from(ids);
}

// 判断某单据的抄送是否命中当前用户（详情接口 403 兜底放行）
async function isCcVisibleSource(pool: sql.ConnectionPool, sourceType: string, sourceId: number, user: any): Promise<boolean> {
  const ids = await resolveCcVisibleSourceIds(pool, sourceType, user);
  return ids.includes(sourceId);
}

// 单据申请人/借款人组织快照（自动获取用户的组织，作为「部门」的替代）
async function resolveDocOrg(pool: sql.ConnectionPool, user: any, personId: string): Promise<{ orgId: number | null; orgName: string } | null> {
  if (user && user.orgId) {
    return { orgId: Number(user.orgId), orgName: user.orgName || '' };
  }
  try {
    const snap = await resolveApplicantOrg(pool, personId);
    if (snap) return { orgId: snap.orgId, orgName: snap.orgName };
  } catch { /* ignore */ }
  return null;
}

// ============================================================
// 审批流引擎：匹配配置 + 创建任务 + 检查权限 + 更新状态
// ============================================================

// 匹配审批流配置：按 paymentType 查找（审批流已不再配置费用类型/费用类目），检查条件限定与组织适用范围
//  - 适用范围（ApprovalFlow.org_ids，兼容 org_id）：空=全局适用（兜底）；非空=申请人组织线命中任一指定组织即适用
//  - 优先级：组织化流程优先于全局流程；同范围内按创建时间取最新
async function matchApprovalFlow(
  pool: sql.ConnectionPool,
  paymentType: string,
  amount: number,
  applicantId: string
): Promise<any | null> {
  // 申请人组织快照：用于组织范围匹配（组织化流程须命中；解析失败则组织化流程不适用，仅全局流程兜底）
  let orgInfo: { orgId: number; orgName: string; orgPath: string } | null = null;
  try { orgInfo = applicantId ? await resolveApplicantOrg(pool, applicantId) : null; } catch { orgInfo = null; }

  const result = await pool.request()
    .input('paymentType', sql.NVarChar, paymentType)
    .query(`
      SELECT * FROM ApprovalFlow
      WHERE status = 'active' AND paymentType = @paymentType
      ORDER BY CASE WHEN ISNULL(NULLIF(org_ids, ''), '') = '' AND org_id IS NULL THEN 1 ELSE 0 END, createdAt DESC
    `);
  if (result.recordset.length === 0) return null;

  for (const row of result.recordset) {
    // 组织适用范围：流程配置了"指定组织（含下级）"，申请人组织线命中任一组织即适用
    let orgIds: number[] = [];
    if (row.org_ids) orgIds = String(row.org_ids).split(',').map(Number).filter(n => n > 0);
    if (orgIds.length === 0 && row.org_id != null) orgIds = [Number(row.org_id)]; // 历史单组织数据兼容
    if (orgIds.length > 0) {
      const hit = orgIds.some(oid => !!(orgInfo && orgInfo.orgPath && isOrgInRange(oid, orgInfo.orgPath)));
      if (!hit) continue;
    }

    const conditionConfig = row.conditionConfig ? JSON.parse(row.conditionConfig) : null;
    if (!conditionConfig) return row;

    if (conditionConfig.type === 'amount') {
      const min = conditionConfig.minAmount ? Number(conditionConfig.minAmount) : 0;
      const max = conditionConfig.maxAmount ? Number(conditionConfig.maxAmount) : Infinity;
      if (amount >= min && amount <= max) return row;
    } else if (conditionConfig.type === 'group_user') {
      if (applicantId) {
        // 用户组列已删：groupName 恒 ''，groups 匹配必然不中，只按 users 白名单匹配
        const userResult = await pool.request()
          .input('userCode', sql.NVarChar, applicantId)
          .query('SELECT 用户代码 as userCode, \'\' as groupName FROM 用户全 WHERE 用户代码 = @userCode');
        if (userResult.recordset.length > 0) {
          const user = userResult.recordset[0];
          const groups: string[] = conditionConfig.groups || [];
          const users: any[] = conditionConfig.users || [];
          if (groups.includes(user.groupName) || users.some((u: any) => u.userCode === user.userCode)) {
            return row;
          }
        }
      }
    } else if (conditionConfig.type === 'budget') {
      return row;
    } else if (conditionConfig.type === 'org') {
      // 组织条件：流程仅对指定组织（及其下级）生效；orgId 空时按 orgName 解析
      if (orgInfo) {
        const cfgOrgId = conditionConfig.orgId ? Number(conditionConfig.orgId) : null;
        if (cfgOrgId && !isOrgInRange(cfgOrgId, orgInfo.orgPath)) continue;
        const cfgOrgName = conditionConfig.orgName || '';
        if (cfgOrgName && orgInfo.orgName !== cfgOrgName) continue;
        return row;
      }
      continue;
    } else {
      return row;
    }
  }
  return null;
}

// 安全解析抄送 JSON 列（ApprovalFlow / ApprovalTask 的 cc_users / cc_orgs），失败返回 []
function safeParseCcArray(json: any): any[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// 创建审批任务：按 approvalSteps 的每个 level 生成一条 ApprovalTask（含申请人组织快照与抄送快照）
async function createApprovalTasks(
  pool: sql.ConnectionPool,
  sourceType: string,
  sourceId: number,
  sourceNo: string,
  applicantId: string,
  applicantName: string,
  flowId: number,
  flowNo: string,
  steps: any[],
  amount: number,
  expenseType: string,
  reason: string,
  ccUsers?: { userCode: string; userName: string }[],
  ccOrgs?: { org_id: number; org_name: string }[]
): Promise<void> {
  // 【逐级向上】发起定位角色裁剪：申请人命中某级 initiatorRoles 时，本级无需审批，从下一级开始
  //  - 每级可配 initiatorRoles（role_code 数组）：申请人拥有其中任一角色，即视为该级"发起人"
  //  - 取命中的最高级为基准，跳过该级及之前所有级，从下一级开始；重排 level 连续（推进按 level+1 查找）
  //  - 例：Step1(督导审) initiatorRoles=['supervisor']，督导本人提交 → 跳过 Step1 从 Step2(区经) 开始，
  //        实现"二级只能由 3/4/5/6 层审核、用户在哪层就从该层的上一级继续往上提交"
  //  - 未命中任何级 → 从第 1 级开始（门店员工提交，督导先审）
  //  - 裁剪后无任务（末级角色本人提交，如老板）→ 直接通过，不创建任务
  if (applicantId && steps.length > 0) {
    try {
      const roleRes = await pool.request()
        .input('uc', sql.NVarChar, applicantId)
        .query(`
          SELECT DISTINCT r.role_code FROM sys_user_role ur
          JOIN sys_role r ON r.role_id = ur.role_id AND r.status = 1 AND r.del_flag = 0
          WHERE ur.user_code = @uc
        `);
      const roleCodes = new Set(roleRes.recordset.map((row: any) => row.role_code).filter(Boolean));
      let hitMaxIdx = -1;
      for (let i = 0; i < steps.length; i++) {
        const ir = steps[i].initiatorRoles || [];
        if (ir.some((rc: string) => roleCodes.has(rc))) hitMaxIdx = i;
      }
      if (hitMaxIdx >= 0) {
        steps = steps.slice(hitMaxIdx + 1).map((lv: any, i: number) => ({ ...lv, level: i + 1 }));
      }
    } catch { /* 角色查询失败按未命中处理：从第 1 级开始 */ }
  }
  if (steps.length === 0) {
    // 末级角色本人提交（如老板），无人还需审批 → 直接通过
    await updateSourceApprovalStatus(pool, sourceType, sourceId, 'approved');
    return;
  }

  // 申请人组织快照：用于跨组织隔离（谁的单就该谁的上级/所属组织批）
  let orgSnapshot: { orgId: number; orgName: string; orgPath: string } | null = null;
  try { orgSnapshot = await resolveApplicantOrg(pool, applicantId); } catch { /* ignore */ }

  // orgLevel（按组织层）审批人展开：把「申请人组织链第 N 层」固化为具体组织快照
  //  - 组织链 = orgPath 按 '/' 切段（顶层 → 申请人所在组织），第 N 段即第 N 层组织
  //  - 申请人组织链不足 N 层（该层不存在，如第 2 层的人申请时配置了第 4 层）→ 丢弃该审批人
  //  - 目标组织固化到 approver.orgId/orgName（与 org 类型共用审批校验），同一组织流内不串流
  //  - 有效性兜底：目标组织内无持有该角色的有效用户 → 丢弃该审批人（防止统一流在
  //    联营商/经销商（如 org35 lianying、org36 dealer，实际深度恰好命中督导/区经层但无对应角色）上产生无人可批的死锁任务）
  //  - 某级审批人全部被丢弃 → 该级不生成任务（不卡单）；所有级都被丢弃 → 直接通过（不创建任何任务）
  if (orgSnapshot && orgSnapshot.orgPath) {
    const segs = orgSnapshot.orgPath.split('/').filter(Boolean).map(Number);
    const targetIds = new Set<number>();
    const orgRoleTargets = new Set<string>(); // 形如 `${orgId}|${roleCode}`
    for (const lv of steps) {
      for (const a of (lv.approvers || [])) {
        if (a.approverType !== 'orgLevel') continue;
        const n = Number(a.orgLevel);
        if (n >= 1 && n <= segs.length) {
          targetIds.add(segs[n - 1]);
          if (a.roleCode) orgRoleTargets.add(`${segs[n - 1]}|${a.roleCode}`);
        }
      }
    }
    const orgNames: Record<number, string> = {};
    if (targetIds.size > 0) {
      try {
        const r = await pool.request().query(
          `SELECT org_id, org_name FROM sys_org WHERE org_id IN (${Array.from(targetIds).join(',')})`
        );
        for (const row of r.recordset) orgNames[row.org_id] = row.org_name || '';
      } catch { /* 组织名查询失败仅影响展示 */ }
    }
    // 查询目标组织内真实存在的角色绑定，构造有效性集合
    //  - validityChecked 区分「查询成功但结果为空」与「查询失败」：
    //    查询成功（即使无匹配角色）→ 裁剪启用；查询失败 → 保守跳过裁剪（与历史行为一致）
    const validOrgRole = new Set<string>();
    let validityChecked = false;
    if (orgRoleTargets.size > 0) {
      try {
        const orgIds = Array.from(targetIds);
        const roleCodes = Array.from(new Set(Array.from(orgRoleTargets).map(s => s.split('|')[1])));
        const r = await pool.request()
          .input('orgIds', sql.NVarChar, orgIds.join(','))
          .input('roleCodes', sql.NVarChar, roleCodes.join(','))
          .query(`
            SELECT DISTINCT ur.org_id, r.role_code
            FROM sys_user_role ur
            JOIN sys_role r ON r.role_id = ur.role_id AND r.status = 1 AND r.del_flag = 0
            WHERE ur.org_id IS NOT NULL
              AND EXISTS (SELECT 1 FROM STRING_SPLIT(@orgIds, ',') sp WHERE sp.value = CAST(ur.org_id AS nvarchar(20)))
              AND EXISTS (SELECT 1 FROM STRING_SPLIT(@roleCodes, ',') sp WHERE sp.value = r.role_code)
          `);
        for (const row of r.recordset) {
          if (row.org_id != null && row.role_code) validOrgRole.add(`${row.org_id}|${row.role_code}`);
        }
        validityChecked = true;
      } catch { /* 角色绑定查询失败：不做有效性裁剪，仅保留超界丢弃（保守行为） */ }
    }
    const keptSteps: any[] = [];
    for (const lv of steps) {
      const kept = (lv.approvers || [])
        .map((a: any) => {
          if (a.approverType !== 'orgLevel') return a;
          const n = Number(a.orgLevel);
          if (!(n >= 1 && n <= segs.length)) return null;
          const orgId = segs[n - 1];
          // 有效性兜底：目标组织内无持有该角色的有效用户 → 丢弃（仅当有效性查询成功时启用；
          // 查询成功但结果为空 = 目标组织内无任何匹配角色 → 亦全部丢弃，避免残留无人可批的死步骤）
          if (validityChecked && a.roleCode && !validOrgRole.has(`${orgId}|${a.roleCode}`)) return null;
          return { ...a, orgId, orgName: orgNames[orgId] || '' };
        })
        .filter(Boolean);
      if (kept.length === 0) continue;
      keptSteps.push({ ...lv, approvers: kept });
    }
    // 重排 level 保证 1..N 连续：审批推进按 level+1 查找下一级任务，跳号会导致找不到
    steps = keptSteps.map((lv: any, i: number) => ({ ...lv, level: i + 1 }));
    // 全部门场景兜底：所有级都被丢弃（如 orgLevel 全部超界/无效且无 org 类型步骤）→ 直接通过，避免单据卡在无任务状态
    if (steps.length === 0) {
      await updateSourceApprovalStatus(pool, sourceType, sourceId, 'approved');
      return;
    }
  }

  const totalLevels = steps.length;
  const ccUsersJson = ccUsers && ccUsers.length > 0 ? JSON.stringify(ccUsers) : null;
  const ccOrgsJson = ccOrgs && ccOrgs.length > 0 ? JSON.stringify(ccOrgs) : null;
  for (let i = 0; i < totalLevels; i++) {
    const lv = steps[i];
    const taskStatus = i === 0 ? 'pending' : 'waiting';
    await pool.request()
      .input('sourceType', sql.NVarChar, sourceType)
      .input('sourceId', sql.Int, sourceId)
      .input('sourceNo', sql.NVarChar, sourceNo)
      .input('applicantId', sql.NVarChar, applicantId || '')
      .input('applicantName', sql.NVarChar, applicantName || '')
      .input('flowId', sql.Int, flowId)
      .input('flowNo', sql.NVarChar, flowNo)
      .input('level', sql.Int, lv.level || (i + 1))
      .input('totalLevels', sql.Int, totalLevels)
      .input('approvers', sql.NVarChar, JSON.stringify(lv.approvers || []))
      .input('status', sql.NVarChar, taskStatus)
      .input('amount', sql.Decimal(18, 2), amount)
      .input('expenseType', sql.NVarChar, expenseType || '')
      .input('reason', sql.NVarChar, reason || '')
      .input('applicantOrgId', sql.Int, orgSnapshot ? orgSnapshot.orgId : null)
      .input('applicantOrgName', sql.NVarChar, orgSnapshot ? orgSnapshot.orgName : null)
      .input('applicantOrgPath', sql.NVarChar, orgSnapshot ? orgSnapshot.orgPath : null)
      .input('cc_users', sql.NVarChar, ccUsersJson)
      .input('cc_orgs', sql.NVarChar, ccOrgsJson)
      .query(`
        INSERT INTO ApprovalTask (sourceType, sourceId, sourceNo, applicantId, applicantName, flowId, flowNo, level, totalLevels, approvers, status, amount, expenseType, reason, applicantOrgId, applicantOrgName, applicantOrgPath, cc_users, cc_orgs)
        VALUES (@sourceType, @sourceId, @sourceNo, @applicantId, @applicantName, @flowId, @flowNo, @level, @totalLevels, @approvers, @status, @amount, @expenseType, @reason, @applicantOrgId, @applicantOrgName, @applicantOrgPath, @cc_users, @cc_orgs)
      `);
  }
}

// ============================================================
// 审批流组织层级支持（todo[8]）
//  - ApprovalFlow.org_id / org_name：流程适用组织范围（NULL=全局）
//  - ApprovalTask.applicantOrgId/Name/Path：申请人组织快照
//  - approvers 增加 org 类型：{ approverType:'org', orgId, orgName, roleCode }
//    表示"申请人所属 orgId 组织中、拥有 roleCode 角色"的任一用户可审批
// ============================================================

// 解析申请人组织快照：sys_user_role → sys_org；查不到时降级 UserGroups.org_id
async function resolveApplicantOrg(pool: sql.ConnectionPool, applicantId: string): Promise<{ orgId: number; orgName: string; orgPath: string } | null> {
  if (!applicantId) return null;
  try {
    const r = await pool.request()
      .input('uc', sql.NVarChar, applicantId)
      .query(`
        SELECT TOP 1 o.org_id, o.org_name, o.ancestors
        FROM sys_user_role ur
        JOIN sys_org o ON o.org_id = ur.org_id AND o.del_flag = 0
        WHERE ur.user_code = @uc AND ur.org_id IS NOT NULL
        ORDER BY ur.id
      `);
    if (r.recordset.length > 0) {
      const row = r.recordset[0];
      return { orgId: row.org_id, orgName: row.org_name, orgPath: (row.ancestors || '') + row.org_id + '/' };
    }
  } catch { /* 表未配置 */ }
  // 【2026-09 下线】UserGroups.org_id 组级绑定降级：用户组列已删，组名链路不复存在，不再回退
  return null;
}

// 判断 orgId 是否在祖先路径范围内（orgPath 形如 /1/2/3/）
function isOrgInRange(orgId: number, orgPath: string | null | undefined): boolean {
  if (!orgPath) return false;
  return orgPath.includes(`/${orgId}/`);
}

// 扩展审批人匹配：在 person/group 之外支持 org 类型（组织快照 + 角色）
//  - org 类型 {approverType:'org', orgId, orgName, roleCode} 语义：
//    「申请人所属 orgId 组织中、拥有 roleCode 角色」的任一用户可审批
//  - applicantOrgPath 为任务申请人组织快照；传入后 org 命中需同时满足：
//    (a) 任务申请人组织线命中 orgId（防跨组织同名角色误批）
//    (b) 当前用户拥有 roleCode 角色
async function isUserInApproversAsync(
  pool: sql.ConnectionPool,
  approversJson: string,
  userCode: string,
  groupName: string,
  orgId?: number | null,
  orgPath?: string | null,
  applicantOrgPath?: string | null
): Promise<boolean> {
  let approvers: any[] = [];
  try { approvers = JSON.parse(approversJson || '[]'); } catch { return false; }
  for (const a of approvers) {
    const t = a.approverType || 'person';
    if (t === 'person' && a.approverCode === userCode) return true;
    if (t === 'group' && a.approverCode === groupName) return true;
    if (t === 'org' && a.roleCode) {
      // org 类型：三方校验，任一不满足即不能审批
      //  - (a) 申请人组织快照必须在 orgId 组织线内（任务归属该组织及其下级）【crossOrg=true 时豁免】
      //  - (b) 审批人自身组织必须在 orgId 组织线内（防跨组织同名角色越权）
      //  - (c) 审批人拥有 roleCode 角色
      try {
        const orgIdNum = a.orgId ? Number(a.orgId) : null;
        if (orgIdNum) {
          // 跨组织审批（crossOrg）：财务总监/老板等职能组织不挂在门店组织链上，豁免申请人组织线校验
          const crossOrg = a.crossOrg === true;
          // 快照缺失/组织线不命中 → 隔离拒绝（crossOrg 时仅校验审批人自身组织线命中）
          if (!crossOrg && (!applicantOrgPath || !isOrgInRange(orgIdNum, applicantOrgPath))) continue;
          if (!orgPath || !isOrgInRange(orgIdNum, orgPath)) continue;
        }
        // (c) 当前用户拥有该角色
        const r = await pool.request()
          .input('uc', sql.NVarChar, userCode)
          .input('roleCode', sql.NVarChar, a.roleCode)
          .query(`
            SELECT TOP 1 ur.id FROM sys_user_role ur
            JOIN sys_role r ON r.role_id = ur.role_id AND r.role_code = @roleCode AND r.status = 1 AND r.del_flag = 0
            WHERE ur.user_code = @uc
          `);
        if (r.recordset.length > 0) return true;
      } catch { /* ignore */ }
    }
    if (t === 'orgLevel' && a.roleCode && a.orgId) {
      // orgLevel 类型：按组织层审批，创建任务时已把目标组织固化为 a.orgId
      //  - (a) 申请人组织快照必须命中 orgId（同一条组织流，不跨组织流审批）
      //  - (b) 审批人必须是目标组织自身的成员（ur.org_id 严格等于 orgId）：
      //       下级组织的人无权审上级的单，同级/其他组织流的人也无法命中
      //  - (c) 审批人拥有 roleCode 角色
      try {
        const orgIdNum = a.orgId ? Number(a.orgId) : 0;
        if (!(orgIdNum > 0)) continue;
        if (!applicantOrgPath || !isOrgInRange(orgIdNum, applicantOrgPath)) continue;
        const r = await pool.request()
          .input('uc', sql.NVarChar, userCode)
          .input('roleCode', sql.NVarChar, a.roleCode)
          .input('orgId', sql.Int, orgIdNum)
          .query(`
            SELECT TOP 1 ur.id FROM sys_user_role ur
            JOIN sys_role r ON r.role_id = ur.role_id AND r.role_code = @roleCode AND r.status = 1 AND r.del_flag = 0
            WHERE ur.user_code = @uc AND ur.org_id = @orgId
          `);
        if (r.recordset.length > 0) return true;
      } catch { /* ignore */ }
    }
  }
  return false;
}

// 检查用户是否在审批人列表中（支持 person / group 三种类型）
function isUserInApprovers(
  approversJson: string,
  userCode: string,
  groupName: string
): boolean {
  let approvers: any[] = [];
  try { approvers = JSON.parse(approversJson || '[]'); } catch { return false; }
  for (const a of approvers) {
    if (a.approverType === 'person' && a.approverCode === userCode) return true;
    if (a.approverType === 'group' && a.approverCode === groupName) return true;
  }
  return false;
}

// 更新来源单据的审批状态
async function updateSourceApprovalStatus(
  pool: sql.ConnectionPool,
  sourceType: string,
  sourceId: number,
  status: string
): Promise<void> {
  if (sourceType === 'reimbursement') {
    await pool.request()
      .input('id', sql.Int, sourceId)
      .input('status', sql.NVarChar, status)
      .query('UPDATE Reimbursement SET status = @status, updatedAt = GETDATE() WHERE id = @id');
  } else if (sourceType === 'advance') {
    const newStatus = status === 'approved' ? 'active' : 'rejected';
    await pool.request()
      .input('id', sql.Int, sourceId)
      .input('approvalStatus', sql.NVarChar, status)
      .input('status', sql.NVarChar, newStatus)
      .query('UPDATE EmployeeAdvance SET approvalStatus = @approvalStatus, status = @status WHERE id = @id');
  } else if (sourceType === 'advance_payment') {
    await pool.request()
      .input('id', sql.Int, sourceId)
      .input('approvalStatus', sql.NVarChar, status)
      .query('UPDATE AdvancePayment SET approvalStatus = @approvalStatus, updatedAt = GETDATE() WHERE id = @id');
  }
}

// ============================================================
// 文件上传
// ============================================================
const upload = multer({
  storage: multer.diskStorage({
    destination(_req: any, _file: any, cb: any) {
      const dir = path.resolve(process.cwd(), 'uploads');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req: any, file: any, cb: any) {
      const ext = path.extname(file.originalname) || '.png';
      cb(null, 'reimb_' + Date.now() + '_' + Math.round(Math.random() * 1e6) + ext);
    },
  }),
});

router.post('/upload', upload.array('files', 20), (req: Request, res: Response) => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    res.json({ urls: files.map((f) => ({ url: '/uploads/' + f.filename, name: f.originalname })) });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 发票 OCR 识别
router.post('/invoice-ocr', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) { res.status(400).json({ success: false, message: '未收到文件' }); return; }
    const filePath = file.path;

    // 动态加载 tesseract.js（避免编译报错）
    const { createWorker } = require('tesseract.js');
    const worker = await createWorker(['chi_sim', 'eng']);
    const { data: { text } } = await worker.recognize(filePath);
    await worker.terminate();

    // 解析发票关键字段
    const fullText = text || '';

    // 提取金额（价税合计/小写/合计金额）
    let amount = 0;
    const compact = fullText.replace(/\s+/g, '');
    const amountPatterns = [
      /(?:价税合计|小写|合计|总金额|金额)[^\d]*¥?\s*([\d,]+\.?\d*)/i,
      /¥\s*([\d,]+\.?\d*)/i,
      /([0-9,]+\.\d{2})\s*元?/,
    ];
    for (const p of amountPatterns) {
      const m = fullText.match(p) || compact.match(p);
      if (m && m[1]) { amount = parseFloat(m[1].replace(/,/g, '')); break; }
    }

    // 提取税额
    let taxAmount = 0;
    const taxPatterns = [
      /(?:税额|税款)[^\d]*([\d,]+\.?\d*)/i,
      /(?:税额)[^\d]*¥?\s*([\d,]+\.?\d*)/i,
    ];
    for (const p of taxPatterns) {
      const m = fullText.match(p) || compact.match(p);
      if (m && m[1]) { taxAmount = parseFloat(m[1].replace(/,/g, '')); break; }
    }

    // 提取税率（直接存储百分比值，如 13 表示 13%）
    let taxRate = 0;
    const taxRateMatch = fullText.match(/税率[^\d]*(\d{1,2})%/) || compact.match(/税率[^\d]*(\d{1,2})%/);
    if (taxRateMatch) { taxRate = parseFloat(taxRateMatch[1]); }

    // 如果有税额但税率=0，反推税率
    if (taxAmount > 0 && amount > 0 && taxRate === 0) {
      const net = amount - taxAmount;
      if (net > 0) { taxRate = Math.round((taxAmount / net) * 100); }
    }

    // 提取发票号（兼容 OCR 空格）
    let invoiceNo = '';
    const noMatch = fullText.match(/(?:发票号码|No\.?|号码)[^\d]*(\d{8,})/i) || compact.match(/(?:发票号码|No\.?|号码)[^\d]*(\d{8,})/i);
    if (noMatch) { invoiceNo = noMatch[1]; }

    // 提取日期（兼容 OCR 空格，如 "2026 年 09 月 09 日"）
    let date = '';
    const dateMatch = compact.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/) || fullText.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (dateMatch) { date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`; }
    if (!date) {
      const dateMatch2 = fullText.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/) || compact.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
      if (dateMatch2) { date = `${dateMatch2[1]}-${dateMatch2[2].padStart(2, '0')}-${dateMatch2[3].padStart(2, '0')}`; }
    }

    res.json({
      success: amount > 0 || taxAmount > 0,
      amount,
      taxAmount,
      taxRate,
      invoiceNo,
      date,
      rawText: fullText.slice(0, 500),
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: (e as Error).message });
  }
});

// ============================================================
// 工具函数
// ============================================================
function genReimburseNo(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = String(Math.round(Math.random() * 10000)).padStart(4, '0');
  return `BX${ymd}${rand}`;
}

function genVoucherNo(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = String(Math.round(Math.random() * 10000)).padStart(4, '0');
  return `PZ${ymd}${rand}`;
}

const EXPENSE_TYPES = ['差旅费', '业务招待', '办公费', '交通费', '培训费', '其他'];
const REIMBURSE_TYPES = ['差旅费', '业务招待', '办公费', '交通费', '培训费', '其他'];

// ============================================================
// 报销单 CRUD
// ============================================================

// 查询列表
router.get('/list', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { status, applicantId, keyword } = req.query;
    let where = '1=1';
    const params: { name: string; type: any; value: any }[] = [];
    if (status) { where += ' AND r.status = @status'; params.push({ name: 'status', type: sql.NVarChar, value: status }); }
    if (applicantId) { where += ' AND r.applicantId = @applicantId'; params.push({ name: 'applicantId', type: sql.NVarChar, value: applicantId }); }
    if (keyword) { where += ' AND (r.reimburseNo LIKE @keyword OR r.reason LIKE @keyword)'; params.push({ name: 'keyword', type: sql.NVarChar, value: `%${keyword}%` }); }
    // 组织数据权限：仅可见自己组织及其下级的报销单；此外，被抄送的用户（或所在组织被抄送的成员）也可查看
    const scope = await resolveOrgScope(pool, (req as any).user);
    const scopeWhere = orgScopeWhere(scope, 'r.org_id', 'r.applicantId', params);
    where += scopeWhere;
    // 抄送可见性放行：仅在组织权限需要过滤（非全局/非空）时追加 OR 放行，且用括号将原组织条件与抄送条件组合，避免绕过其它筛选
    if (scopeWhere) {
      const ccIds = await resolveCcVisibleSourceIds(pool, 'reimbursement', (req as any).user);
      if (ccIds.length > 0) {
        where = where.replace(scopeWhere, ` AND (1=1${scopeWhere} OR r.id IN (${ccIds.join(',')}))`);
      }
    }
    const req2 = pool.request();
    params.forEach(p => req2.input(p.name, p.type, p.value));
    const result = await req2.query(`
      SELECT r.*, 
        (SELECT COUNT(*) FROM ReimbursementItem ri WHERE ri.reimburseId = r.id) as itemCount,
        (SELECT COUNT(*) FROM ReimbursementAttachment ra WHERE ra.reimburseId = r.id) as attachCount
      FROM Reimbursement r
      WHERE ${where}
      ORDER BY r.createdAt DESC
    `);
    res.json(result.recordset);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// ============================================================
// 欠款查询（必须在 /:id 路由之前注册）
// ============================================================
// 汇总：按员工聚合预支总额、报销冲抵总额、欠款
router.get('/debt-summary', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { employeeId, employeeName } = req.query;
    // 组织数据权限：欠款查询仅覆盖自己组织及其下级组织的员工
    const scope = await resolveOrgScope(pool, (req as any).user);
    const scopeParams1: { name: string; type: any; value: any }[] = [];
    const scopeParams2: { name: string; type: any; value: any }[] = [];
    const scopeWhere1 = orgScopeWhere(scope, 'org_id', 'employeeId', scopeParams1); // EmployeeAdvance
    const scopeWhere2 = orgScopeWhere(scope, 'org_id', 'applicantId', scopeParams2); // Reimbursement

    // 从 EmployeeAdvance 表取预支（只统计 approved 状态）
    const advReq = pool.request();
    let advWhere = "approvalStatus = 'approved'";
    if (employeeId) { advWhere += ' AND employeeId = @employeeId'; advReq.input('employeeId', sql.NVarChar, employeeId); }
    if (employeeName) { advWhere += ' AND employeeName LIKE @employeeName'; advReq.input('employeeName', sql.NVarChar, `%${employeeName}%`); }
    scopeParams1.forEach(p => advReq.input(p.name, p.type, p.value));
    advWhere += scopeWhere1;
    const advResult = await advReq.query(`
      SELECT employeeId, employeeName,
        SUM(advanceAmount) as totalAdvance,
        SUM(deductedAmount) as totalDeducted,
        SUM(balance) as totalBalance
      FROM EmployeeAdvance WHERE ${advWhere}
      GROUP BY employeeId, employeeName
    `);

    // 从 Reimbursement 表取报销冲抵（submitted/approved/finance_approved/paid 状态，advanceDeduction > 0）
    const reimbReq = pool.request();
    let reimbWhere = "1=1 AND advanceDeduction > 0 AND status IN ('submitted','approved','finance_approved','paid')";
    if (employeeId) { reimbWhere += ' AND applicantId = @applicantId'; reimbReq.input('applicantId', sql.NVarChar, employeeId); }
    if (employeeName) { reimbWhere += ' AND applicantName LIKE @applicantName'; reimbReq.input('applicantName', sql.NVarChar, `%${employeeName}%`); }
    scopeParams2.forEach(p => reimbReq.input(p.name, p.type, p.value));
    reimbWhere += scopeWhere2;
    const reimbResult = await reimbReq.query(`
      SELECT applicantId, applicantName,
        SUM(advanceDeduction) as totalReimbDeduction
      FROM Reimbursement WHERE ${reimbWhere}
      GROUP BY applicantId, applicantName
    `);

    // 合并：以 employeeId 为 key
    const map: Record<string, { employeeId: string; employeeName: string; groupName: string; totalAdvance: number; totalReimbDeduction: number }> = {};
    for (const r of advResult.recordset) {
      const eid = r.employeeId || '';
      if (!map[eid]) {
        map[eid] = { employeeId: eid, employeeName: r.employeeName || '', groupName: '', totalAdvance: 0, totalReimbDeduction: 0 };
      }
      map[eid].totalAdvance = Number(r.totalAdvance) || 0;
    }
    for (const r of reimbResult.recordset) {
      const eid = r.applicantId || '';
      if (!map[eid]) {
        map[eid] = { employeeId: eid, employeeName: r.applicantName || '', groupName: '', totalAdvance: 0, totalReimbDeduction: 0 };
      }
      map[eid].totalReimbDeduction = Number(r.totalReimbDeduction) || 0;
      if (!map[eid].employeeName && r.applicantName) map[eid].employeeName = r.applicantName;
    }

    // 用户组列已删：groupName 统一置空（前端旧字段兼容）
    const userIds = Object.keys(map);

    const list = Object.values(map).map(r => ({
      ...r,
      debt: Math.round((r.totalAdvance - r.totalReimbDeduction) * 100) / 100,
    })).filter(r => r.totalAdvance > 0 || r.totalReimbDeduction > 0)
      .sort((a, b) => b.debt - a.debt);

    res.json(list);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 明细：按员工查预支和报销明细记录
router.get('/debt-detail/:employeeId', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const eid = req.params.employeeId;
    // 组织数据权限：目标员工须位于自己组织及其下级组织内（本人/特权除外）
    const scope = await resolveOrgScope(pool, (req as any).user);
    if (scope) {
      let allowed = false;
      if (scope.kind === 'all') allowed = true;
      else if (scope.kind === 'self') allowed = scope.userCode === eid;
      else {
        try {
          const snap = await resolveApplicantOrg(pool, eid);
          allowed = !!snap && scope.orgIds.includes(snap.orgId);
        } catch { allowed = false; }
      }
      if (!allowed) return res.status(403).json({ message: '无权查看该员工的欠款明细' });
    }

    // 预支明细
    const advResult = await pool.request()
      .input('employeeId', sql.NVarChar, eid)
      .query(`SELECT id, advanceNo, advanceAmount, deductedAmount, balance, advanceDate, expenseType, applyReason, approvalStatus, createdAt
              FROM EmployeeAdvance WHERE employeeId = @employeeId ORDER BY advanceDate DESC, createdAt DESC`);

    // 报销冲抵明细
    const reimbResult = await pool.request()
      .input('applicantId', sql.NVarChar, eid)
      .query(`SELECT id, reimburseNo, reimburseDate, totalAmount, advanceDeduction, actualPayable, status, reason
              FROM Reimbursement WHERE applicantId = @applicantId AND advanceDeduction > 0
              AND status IN ('submitted','approved','finance_approved','paid')
              ORDER BY reimburseDate DESC`);

    res.json({
      advances: advResult.recordset.map((r: any) => ({
        ...r,
        type: 'advance',
        amount: Number(r.advanceAmount),
        deducted: Number(r.deductedAmount),
        balance: Number(r.balance),
        date: r.advanceDate ? r.advanceDate.toISOString().slice(0, 10) : '',
      })),
      reimbursements: reimbResult.recordset.map((r: any) => ({
        ...r,
        type: 'reimbursement',
        deduction: Number(r.advanceDeduction),
        date: r.reimburseDate ? r.reimburseDate.toISOString().slice(0, 10) : '',
      })),
    });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 查询单条详情（含明细、附件）
router.get('/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const id = parseInt(req.params.id);
    const main = await pool.request().input('id', sql.Int, id)
      .query('SELECT * FROM Reimbursement WHERE id = @id');
    if (main.recordset.length === 0) { res.status(404).json({ message: '报销单不存在' }); return; }
    // 组织数据权限：详情不得越出自己组织及下级；被抄送的用户也可查看
    const scope = await resolveOrgScope(pool, (req as any).user);
    if (scope) {
      const row = main.recordset[0];
      let allowed = false;
      if (scope.kind === 'all') allowed = true;
      else if (scope.kind === 'self') allowed = (row.applicantId || '') === scope.userCode;
      else allowed = row.org_id != null && scope.orgIds.includes(Number(row.org_id));
      if (!allowed) {
        // 抄送可见性兜底：当前用户是该单抄送人（命中用户或所在组织被抄送）
        allowed = await isCcVisibleSource(pool, 'reimbursement', id, (req as any).user);
      }
      if (!allowed) return res.status(403).json({ message: '无权查看该报销单' });
    }
    const items = await pool.request().input('id', sql.Int, id)
      .query('SELECT * FROM ReimbursementItem WHERE reimburseId = @id ORDER BY id');
    const atts = await pool.request().input('id', sql.Int, id)
      .query('SELECT * FROM ReimbursementAttachment WHERE reimburseId = @id ORDER BY id');
    const voucher = await pool.request().input('id', sql.Int, id)
      .query('SELECT * FROM ReimbursementVoucher WHERE reimburseId = @id ORDER BY id');
    res.json({ ...main.recordset[0], items: items.recordset, attachments: atts.recordset, voucher: voucher.recordset });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 新增报销单（草稿或提交）
router.post('/', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { applicantId, applicantName, department, reimburseDate, reimburseType, reason, items, attachments, templateId, status, advanceDeduction, createdBy } = req.body;
    const reimburseNo = genReimburseNo();
    const itemRows = items || [];
    let totalAmount = 0, taxTotal = 0;
    for (const it of itemRows) {
      totalAmount += Number(it.amount) || 0;
      taxTotal += Number(it.taxAmount) || 0;
    }
    const advDed = Number(advanceDeduction) || 0;
    const actualPayable = totalAmount - advDed;

    // 自动获取用户组织（替换「部门」）：申请人组织 = 当前用户组织，代他人提交时按申请人解析
    const orgSnap = await resolveDocOrg(pool, (req as any).user, applicantId || (createdBy || ''));
    const orgId = orgSnap ? orgSnap.orgId : null;
    const effOrgName = orgSnap ? orgSnap.orgName : '';
    const effDepartment = effOrgName || department || '';

    // 预算校验
    let budgetWarn = 0, budgetExceed = 0;
    if (effDepartment) {
      const budget = await pool.request().input('dept', sql.NVarChar, effDepartment)
        .query(`SELECT * FROM BudgetConfig WHERE targetName = @dept AND budgetYear = YEAR(GETDATE())`);
      if (budget.recordset.length > 0) {
        const b = budget.recordset[0];
        const used = Number(b.usedAmount) || 0;
        const remaining = Number(b.totalBudget) - used;
        if (totalAmount > remaining) { budgetExceed = 1; budgetWarn = 1; }
        else if (remaining > 0 && totalAmount > remaining * 0.8) { budgetWarn = 1; }
      }
    }

    const t = pool.request();
    t.input('reimburseNo', sql.NVarChar, reimburseNo)
      .input('applicantId', sql.NVarChar, applicantId || '')
      .input('applicantName', sql.NVarChar, applicantName || '')
      .input('department', sql.NVarChar, effDepartment)
      .input('org_id', sql.Int, orgId)
      .input('org_name', sql.NVarChar, effOrgName)
      .input('reimburseDate', sql.Date, reimburseDate)
      .input('reimburseType', sql.NVarChar, reimburseType)
      .input('reason', sql.NVarChar, reason || '')
      .input('totalAmount', sql.Decimal(18, 2), totalAmount)
      .input('taxTotal', sql.Decimal(18, 2), taxTotal)
      .input('advanceDeduction', sql.Decimal(18, 2), advDed)
      .input('actualPayable', sql.Decimal(18, 2), actualPayable)
      .input('status', sql.NVarChar, status || 'draft')
      .input('templateId', sql.Int, templateId || null)
      .input('budgetWarn', sql.Bit, budgetWarn)
      .input('budgetExceed', sql.Bit, budgetExceed)
      .input('createdBy', sql.NVarChar, createdBy || applicantName || '');
    const result = await t.query(`
      INSERT INTO Reimbursement (reimburseNo, applicantId, applicantName, department, org_id, org_name, reimburseDate, reimburseType, reason, totalAmount, taxTotal, advanceDeduction, actualPayable, status, templateId, budgetWarn, budgetExceed, createdBy)
      OUTPUT INSERTED.id
      VALUES (@reimburseNo, @applicantId, @applicantName, @department, @org_id, @org_name, @reimburseDate, @reimburseType, @reason, @totalAmount, @taxTotal, @advanceDeduction, @actualPayable, @status, @templateId, @budgetWarn, @budgetExceed, @createdBy)
    `);
    const newId = result.recordset[0].id;

    // 插入明细
    for (const it of itemRows) {
      await pool.request()
        .input('reimburseId', sql.Int, newId)
        .input('expenseType', sql.NVarChar, it.expenseType)
        .input('occurDate', sql.Date, it.occurDate)
        .input('amount', sql.Decimal(18, 2), it.amount)
        .input('taxRate', sql.Decimal(5, 2), it.taxRate || 0)
        .input('taxAmount', sql.Decimal(18, 2), it.taxAmount || 0)
        .input('remark', sql.NVarChar, it.remark || '')
        .query('INSERT INTO ReimbursementItem (reimburseId, expenseType, occurDate, amount, taxRate, taxAmount, remark) VALUES (@reimburseId, @expenseType, @occurDate, @amount, @taxRate, @taxAmount, @remark)');
    }

    // 插入附件
    const atts = attachments || [];
    for (const a of atts) {
      await pool.request()
        .input('reimburseId', sql.Int, newId)
        .input('fileName', sql.NVarChar, a.name || '')
        .input('filePath', sql.NVarChar, a.url || '')
        .input('fileType', sql.NVarChar, a.type || '')
        .input('uploadedBy', sql.NVarChar, createdBy || applicantName || '')
        .query('INSERT INTO ReimbursementAttachment (reimburseId, fileName, filePath, fileType, uploadedBy) VALUES (@reimburseId, @fileName, @filePath, @fileType, @uploadedBy)');
    }

    // 如果冲销预借款，更新预借款余额
    if (advDed > 0 && applicantId) {
      const advances = await pool.request().input('eid', sql.NVarChar, applicantId)
        .query(`SELECT * FROM EmployeeAdvance WHERE employeeId = @eid AND status = 'active' AND approvalStatus = 'approved' AND balance > 0 ORDER BY advanceDate`);
      let remaining = advDed;
      for (const adv of advances.recordset) {
        if (remaining <= 0) break;
        const deduct = Math.min(remaining, Number(adv.balance));
        const newBalance = Number(adv.balance) - deduct;
        const newDeducted = Number(adv.deductedAmount) + deduct;
        await pool.request()
          .input('id', sql.Int, adv.id)
          .input('deducted', sql.Decimal(18, 2), newDeducted)
          .input('balance', sql.Decimal(18, 2), newBalance)
          .query('UPDATE EmployeeAdvance SET deductedAmount = @deducted, balance = @balance WHERE id = @id');
        remaining -= deduct;
      }
    }

    // 如果状态是 submitted，更新预算已用额度
    if ((status === 'submitted' || status === 'approved') && department) {
      await pool.request()
        .input('dept', sql.NVarChar, department)
        .input('amount', sql.Decimal(18, 2), totalAmount)
        .query('UPDATE BudgetConfig SET usedAmount = usedAmount + @amount WHERE targetName = @dept AND budgetYear = YEAR(GETDATE())');
    }

    // 如果是提交状态，匹配审批流并创建审批任务
    if (status === 'submitted') {
      const flow = await matchApprovalFlow(pool, '报销', totalAmount, applicantId || '');
      if (flow) {
        const steps = flow.approvalSteps ? JSON.parse(flow.approvalSteps) : [];
        if (steps.length > 0) {
          await createApprovalTasks(pool, 'reimbursement', newId, reimburseNo, applicantId || '', applicantName || '', flow.id, flow.flowNo, steps, totalAmount, reimburseType, reason || '', safeParseCcArray(flow.cc_users), safeParseCcArray(flow.cc_orgs));
        }
      }
    }

    res.json({ id: newId, reimburseNo, totalAmount, taxTotal, actualPayable, budgetWarn, budgetExceed });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 更新报销单（草稿编辑）
router.put('/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const id = parseInt(req.params.id);
    const { applicantId, applicantName, department, reimburseDate, reimburseType, reason, items, attachments, templateId, status, advanceDeduction, createdBy } = req.body;
    const itemRows = items || [];
    let totalAmount = 0, taxTotal = 0;
    for (const it of itemRows) {
      totalAmount += Number(it.amount) || 0;
      taxTotal += Number(it.taxAmount) || 0;
    }
    const advDed = Number(advanceDeduction) || 0;
    const actualPayable = totalAmount - advDed;

    let budgetWarn = 0, budgetExceed = 0;
    if (department) {
      const budget = await pool.request().input('dept', sql.NVarChar, department)
        .query(`SELECT * FROM BudgetConfig WHERE targetName = @dept AND budgetYear = YEAR(GETDATE())`);
      if (budget.recordset.length > 0) {
        const b = budget.recordset[0];
        const used = Number(b.usedAmount) || 0;
        const remaining = Number(b.totalBudget) - used;
        if (totalAmount > remaining) { budgetExceed = 1; budgetWarn = 1; }
        else if (remaining > 0 && totalAmount > remaining * 0.8) { budgetWarn = 1; }
      }
    }

    await pool.request()
      .input('id', sql.Int, id)
      .input('department', sql.NVarChar, department || '')
      .input('reimburseDate', sql.Date, reimburseDate)
      .input('reimburseType', sql.NVarChar, reimburseType)
      .input('reason', sql.NVarChar, reason || '')
      .input('totalAmount', sql.Decimal(18, 2), totalAmount)
      .input('taxTotal', sql.Decimal(18, 2), taxTotal)
      .input('advanceDeduction', sql.Decimal(18, 2), advDed)
      .input('actualPayable', sql.Decimal(18, 2), actualPayable)
      .input('status', sql.NVarChar, status || 'draft')
      .input('templateId', sql.Int, templateId || null)
      .input('budgetWarn', sql.Bit, budgetWarn)
      .input('budgetExceed', sql.Bit, budgetExceed)
      .query(`
        UPDATE Reimbursement SET
          department = @department, reimburseDate = @reimburseDate, reimburseType = @reimburseType,
          reason = @reason, totalAmount = @totalAmount, taxTotal = @taxTotal,
          advanceDeduction = @advanceDeduction, actualPayable = @actualPayable,
          status = @status, templateId = @templateId, budgetWarn = @budgetWarn, budgetExceed = @budgetExceed,
          updatedAt = GETDATE()
        WHERE id = @id
      `);

    // 重新插入明细
    await pool.request().input('id', sql.Int, id).query('DELETE FROM ReimbursementItem WHERE reimburseId = @id');
    for (const it of itemRows) {
      await pool.request()
        .input('reimburseId', sql.Int, id)
        .input('expenseType', sql.NVarChar, it.expenseType)
        .input('occurDate', sql.Date, it.occurDate)
        .input('amount', sql.Decimal(18, 2), it.amount)
        .input('taxRate', sql.Decimal(5, 2), it.taxRate || 0)
        .input('taxAmount', sql.Decimal(18, 2), it.taxAmount || 0)
        .input('remark', sql.NVarChar, it.remark || '')
        .query('INSERT INTO ReimbursementItem (reimburseId, expenseType, occurDate, amount, taxRate, taxAmount, remark) VALUES (@reimburseId, @expenseType, @occurDate, @amount, @taxRate, @taxAmount, @remark)');
    }

    // 重新插入附件
    await pool.request().input('id', sql.Int, id).query('DELETE FROM ReimbursementAttachment WHERE reimburseId = @id');
    const atts = attachments || [];
    for (const a of atts) {
      await pool.request()
        .input('reimburseId', sql.Int, id)
        .input('fileName', sql.NVarChar, a.name || '')
        .input('filePath', sql.NVarChar, a.url || '')
        .input('fileType', sql.NVarChar, a.type || '')
        .input('uploadedBy', sql.NVarChar, createdBy || '')
        .query('INSERT INTO ReimbursementAttachment (reimburseId, fileName, filePath, fileType, uploadedBy) VALUES (@reimburseId, @fileName, @filePath, @fileType, @uploadedBy)');
    }

    // 提交状态：匹配审批流并创建审批任务（覆盖"先存草稿再提交"的 PUT 路径）
    // 幂等：该单已存在 pending 审批任务时不重复创建；无匹配流程时不创建
    if (status === 'submitted') {
      const existing = await pool.request()
        .input('sourceType', sql.NVarChar, 'reimbursement')
        .input('sourceId', sql.Int, id)
        .query(`SELECT COUNT(*) AS cnt FROM ApprovalTask WHERE sourceType = @sourceType AND sourceId = @sourceId AND status = 'pending'`);
      if (!(existing.recordset?.[0]?.cnt > 0)) {
        const flow = await matchApprovalFlow(pool, '报销', totalAmount, applicantId || '');
        if (flow) {
          const steps = flow.approvalSteps ? JSON.parse(flow.approvalSteps) : [];
          if (steps.length > 0) {
            const { reimburseNo } = (await pool.request()
              .input('id', sql.Int, id)
              .query('SELECT reimburseNo FROM Reimbursement WHERE id = @id')).recordset?.[0] || { reimburseNo: '' };
            await createApprovalTasks(pool, 'reimbursement', id, reimburseNo || '', applicantId || '', applicantName || '', flow.id, flow.flowNo, steps, totalAmount, reimburseType, reason || '', safeParseCcArray(flow.cc_users), safeParseCcArray(flow.cc_orgs));
          }
        }
      }
    }

    res.json({ id, totalAmount, taxTotal, actualPayable, budgetWarn, budgetExceed });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 删除报销单
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const id = parseInt(req.params.id);
    await pool.request().input('id', sql.Int, id).query('DELETE FROM ReimbursementItem WHERE reimburseId = @id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM ReimbursementAttachment WHERE reimburseId = @id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM ReimbursementVoucher WHERE reimburseId = @id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM Reimbursement WHERE id = @id');
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// ============================================================
// 财务审核
// ============================================================
router.post('/:id/finance-review', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const id = parseInt(req.params.id);
    const { financeStatus, financeRemark, financeRejectReason } = req.body;
    await pool.request()
      .input('id', sql.Int, id)
      .input('financeStatus', sql.NVarChar, financeStatus)
      .input('financeRemark', sql.NVarChar, financeRemark || '')
      .input('financeRejectReason', sql.NVarChar, financeRejectReason || '')
      .input('status', sql.NVarChar, financeStatus === 'approved' ? 'finance_approved' : (financeStatus === 'rejected' ? 'finance_rejected' : 'finance_reviewing'))
      .query(`
        UPDATE Reimbursement SET
          financeStatus = @financeStatus, financeRemark = @financeRemark,
          financeRejectReason = @financeRejectReason, status = @status,
          updatedAt = GETDATE()
        WHERE id = @id
      `);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// ============================================================
// 付款管理
// ============================================================
router.post('/:id/payment', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const id = parseInt(req.params.id);
    const { payStatus, payDate, paySerialNo } = req.body;
    await pool.request()
      .input('id', sql.Int, id)
      .input('payStatus', sql.NVarChar, payStatus)
      .input('payDate', sql.Date, payDate || null)
      .input('paySerialNo', sql.NVarChar, paySerialNo || '')
      .input('status', sql.NVarChar, payStatus === 'paid' ? 'paid' : undefined)
      .query(`
        UPDATE Reimbursement SET
          payStatus = @payStatus, payDate = @payDate, paySerialNo = @paySerialNo${payStatus === 'paid' ? ', status = @status' : ''},
          updatedAt = GETDATE()
        WHERE id = @id
      `);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 导出付款清单
router.get('/export/payments', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    // 组织数据权限：导出同样仅含自己组织及下级的已付款报销
    const scope = await resolveOrgScope(pool, (req as any).user);
    const r = pool.request();
    let where = "status IN ('finance_approved','paid') OR payStatus <> 'unpaid'";
    const sp: { name: string; type: any; value: any }[] = [];
    const sw = orgScopeWhere(scope, 'org_id', 'applicantId', sp);
    where += sw;
    sp.forEach(p => r.input(p.name, p.type, p.value));
    const result = await r.query(`
      SELECT reimburseNo, applicantName, org_name AS department, reimburseType, actualPayable, payStatus, payDate, paySerialNo
      FROM Reimbursement WHERE ${where}
      ORDER BY payDate DESC, createdAt DESC
    `);
    res.json(result.recordset);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// ============================================================
// 凭证记录 API
// ============================================================
router.get('/voucher/list', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { startDate, endDate, keyword, sourceType } = req.query;
    const r = pool.request();
    let where = '1=1';
    if (startDate) { where += ' AND v.voucherDate >= @sd'; r.input('sd', sql.Date, startDate as string); }
    if (endDate) { where += ' AND v.voucherDate <= @ed'; r.input('ed', sql.Date, endDate as string); }
    if (sourceType) { where += ' AND v.sourceType = @st'; r.input('st', sql.NVarChar, sourceType as string); }
    if (keyword) {
      where += ' AND (v.voucherNo LIKE @kw OR v.summary LIKE @kw2 OR v.debitSubject LIKE @kw2 OR v.creditSubject LIKE @kw2)';
      r.input('kw', sql.NVarChar, `%${keyword}%`);
      r.input('kw2', sql.NVarChar, `%${keyword}%`);
    }
    const result = await r.query(`
      SELECT v.*,
        CASE
          WHEN v.sourceType = 'payment' THEN p.payNo
          WHEN v.sourceType = 'reimbursement' THEN rm.reimburseNo
          ELSE NULL
        END AS sourceNo,
        CASE
          WHEN v.sourceType = 'payment' THEN p.payee
          WHEN v.sourceType = 'reimbursement' THEN rm.applicantName
          ELSE NULL
        END AS sourcePerson
      FROM ReimbursementVoucher v
      LEFT JOIN PaymentRecord p ON v.sourceType = 'payment' AND v.reimburseId = p.id
      LEFT JOIN Reimbursement rm ON v.sourceType = 'reimbursement' AND v.reimburseId = rm.id
      WHERE ${where}
      ORDER BY v.voucherDate DESC, v.id DESC
    `);
    res.json(result.recordset);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// ============================================================
// 凭证生成
// ============================================================
router.post('/:id/generate-voucher', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const id = parseInt(req.params.id);
    const main = await pool.request().input('id', sql.Int, id).query('SELECT * FROM Reimbursement WHERE id = @id');
    if (main.recordset.length === 0) { res.status(404).json({ message: '报销单不存在' }); return; }
    const r = main.recordset[0];
    const voucherNo = genVoucherNo();
    const voucherDate = new Date().toISOString().slice(0, 10);
    await pool.request()
      .input('voucherNo', sql.NVarChar, voucherNo)
      .input('reimburseId', sql.Int, id)
      .input('voucherDate', sql.Date, voucherDate)
      .input('debitSubject', sql.NVarChar, `管理费用-${r.reimburseType}`)
      .input('creditSubject', sql.NVarChar, '银行存款/库存现金')
      .input('amount', sql.Decimal(18, 2), r.actualPayable)
      .input('summary', sql.NVarChar, `${r.applicantName} ${r.reimburseType}报销 ${r.reimburseNo}`)
      .query(`
        INSERT INTO ReimbursementVoucher (voucherNo, reimburseId, sourceType, voucherDate, debitSubject, creditSubject, amount, summary)
        OUTPUT INSERTED.id
        VALUES (@voucherNo, @reimburseId, 'reimbursement', @voucherDate, @debitSubject, @creditSubject, @amount, @summary)
      `);
    const voucherId = (await pool.request().input('id', sql.Int, id).query('SELECT TOP 1 id FROM ReimbursementVoucher WHERE reimburseId = @id ORDER BY id DESC')).recordset[0]?.id;
    if (voucherId) {
      await pool.request().input('id', sql.Int, id).input('voucherId', sql.Int, voucherId)
        .query('UPDATE Reimbursement SET voucherId = @voucherId, updatedAt = GETDATE() WHERE id = @id');
    }
    res.json({ success: true, voucherNo, voucherId });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// ============================================================
// 模板管理
// ============================================================
router.get('/templates/list', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const result = await pool.request().query('SELECT * FROM ReimbursementTemplate ORDER BY id');
    res.json(result.recordset);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

router.post('/templates', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { templateName, reimburseType, reason, isPublic, createdBy } = req.body;
    const result = await pool.request()
      .input('templateName', sql.NVarChar, templateName)
      .input('reimburseType', sql.NVarChar, reimburseType || '')
      .input('reason', sql.NVarChar, reason || '')
      .input('isPublic', sql.Bit, isPublic !== false ? 1 : 0)
      .input('createdBy', sql.NVarChar, createdBy || '')
      .query(`
        INSERT INTO ReimbursementTemplate (templateName, reimburseType, reason, isPublic, createdBy)
        OUTPUT INSERTED.id
        VALUES (@templateName, @reimburseType, @reason, @isPublic, @createdBy)
      `);
    res.json({ id: result.recordset[0].id });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

router.delete('/templates/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    await pool.request().input('id', sql.Int, parseInt(req.params.id)).query('DELETE FROM ReimbursementTemplate WHERE id = @id');
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// ============================================================
// 预借款管理
// ============================================================
router.get('/advances/list', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { employeeId, approvalStatus } = req.query;
    let where = '1=1';
    const params: { name: string; type: any; value: any }[] = [];
    if (employeeId) { where += ' AND employeeId = @employeeId'; params.push({ name: 'employeeId', type: sql.NVarChar, value: employeeId }); }
    if (approvalStatus) { where += ' AND approvalStatus = @approvalStatus'; params.push({ name: 'approvalStatus', type: sql.NVarChar, value: approvalStatus }); }
    // 组织数据权限：仅可见自己组织及其下级的借款；此外，被抄送的用户（或所在组织被抄送的成员）也可查看
    const scope = await resolveOrgScope(pool, (req as any).user);
    const scopeWhere = orgScopeWhere(scope, 'org_id', 'employeeId', params);
    where += scopeWhere;
    if (scopeWhere) {
      const ccIds = await resolveCcVisibleSourceIds(pool, 'advance', (req as any).user);
      if (ccIds.length > 0) {
        where = where.replace(scopeWhere, ` AND (1=1${scopeWhere} OR id IN (${ccIds.join(',')}))`);
      }
    }
    const r = pool.request();
    params.forEach(p => r.input(p.name, p.type, p.value));
    const result = await r.query(`SELECT * FROM EmployeeAdvance WHERE ${where} ORDER BY advanceDate DESC`);
    res.json(result.recordset);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

router.post('/advances', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { employeeId, employeeName, advanceAmount, advanceDate, remark, expenseType, applyReason } = req.body;
    const advanceNo = `YZ${Date.now()}${Math.round(Math.random() * 1000)}`;
    // 自动获取用户组织（借款归属当前用户组织；代他人登记时按员工解析）
    const orgSnap = await resolveDocOrg(pool, (req as any).user, employeeId || '');
    const orgId = orgSnap ? orgSnap.orgId : null;
    const orgName = orgSnap ? orgSnap.orgName : '';
    const result = await pool.request()
      .input('employeeId', sql.NVarChar, employeeId)
      .input('employeeName', sql.NVarChar, employeeName)
      .input('advanceNo', sql.NVarChar, advanceNo)
      .input('advanceAmount', sql.Decimal(18, 2), advanceAmount)
      .input('balance', sql.Decimal(18, 2), advanceAmount)
      .input('advanceDate', sql.Date, advanceDate)
      .input('remark', sql.NVarChar, remark || '')
      .input('expenseType', sql.NVarChar, expenseType || '其他')
      .input('applyReason', sql.NVarChar, applyReason || '')
      .input('approvalStatus', sql.NVarChar, 'pending')
      .input('org_id', sql.Int, orgId)
      .input('org_name', sql.NVarChar, orgName)
      .query(`
        INSERT INTO EmployeeAdvance (employeeId, employeeName, advanceNo, advanceAmount, balance, advanceDate, remark, expenseType, applyReason, approvalStatus, org_id, org_name)
        OUTPUT INSERTED.id
        VALUES (@employeeId, @employeeName, @advanceNo, @advanceAmount, @balance, @advanceDate, @remark, @expenseType, @applyReason, @approvalStatus, @org_id, @org_name)
      `);
    const newAdvId = result.recordset[0].id;
    // 匹配审批流并创建审批任务
    const flow = await matchApprovalFlow(pool, '借款', Number(advanceAmount), employeeId);
    if (flow) {
      const steps = flow.approvalSteps ? JSON.parse(flow.approvalSteps) : [];
      if (steps.length > 0) {
        await createApprovalTasks(pool, 'advance', newAdvId, advanceNo, employeeId, employeeName, flow.id, flow.flowNo, steps, Number(advanceAmount), expenseType || '', applyReason || '', safeParseCcArray(flow.cc_users), safeParseCcArray(flow.cc_orgs));
      }
    }
    res.json({ id: newAdvId, advanceNo });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 预支申请审批
router.post('/advances/:id/approve', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const id = parseInt(req.params.id);
    const { approvalStatus, approvedBy, rejectReason } = req.body;
    // 审批通过时设置 status=active，审批驳回时设置 status=rejected
    const newStatus = approvalStatus === 'approved' ? 'active' : 'rejected';
    await pool.request()
      .input('id', sql.Int, id)
      .input('approvalStatus', sql.NVarChar, approvalStatus)
      .input('status', sql.NVarChar, newStatus)
      .input('approvedBy', sql.NVarChar, approvedBy || '')
      .input('approvedAt', sql.DateTime, new Date())
      .input('rejectReason', sql.NVarChar, rejectReason || '')
      .query(`
        UPDATE EmployeeAdvance SET
          approvalStatus = @approvalStatus, status = @status,
          approvedBy = @approvedBy, approvedAt = @approvedAt, rejectReason = @rejectReason
        WHERE id = @id
      `);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 查询员工已审批通过的可用预支款（balance > 0）
router.get('/advances/available', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { employeeId } = req.query;
    if (!employeeId) { res.json([]); return; }
    const result = await pool.request()
      .input('employeeId', sql.NVarChar, employeeId)
      .query(`SELECT * FROM EmployeeAdvance WHERE employeeId = @employeeId AND approvalStatus = 'approved' AND status = 'active' AND balance > 0 ORDER BY advanceDate`);
    res.json(result.recordset);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// ============================================================
// 预算管理
// ============================================================
router.get('/budgets/list', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const result = await pool.request().query('SELECT * FROM BudgetConfig ORDER BY budgetYear DESC, budgetMonth DESC, id');
    res.json(result.recordset);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

router.post('/budgets', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { budgetType, targetName, budgetYear, budgetMonth, totalBudget, remark } = req.body;
    const result = await pool.request()
      .input('budgetType', sql.NVarChar, budgetType)
      .input('targetName', sql.NVarChar, targetName)
      .input('budgetYear', sql.Int, budgetYear || new Date().getFullYear())
      .input('budgetMonth', sql.Int, budgetMonth || null)
      .input('totalBudget', sql.Decimal(18, 2), totalBudget)
      .input('remark', sql.NVarChar, remark || '')
      .query(`
        INSERT INTO BudgetConfig (budgetType, targetName, budgetYear, budgetMonth, totalBudget, remark)
        OUTPUT INSERTED.id
        VALUES (@budgetType, @targetName, @budgetYear, @budgetMonth, @totalBudget, @remark)
      `);
    res.json({ id: result.recordset[0].id });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 查询预算剩余额度
router.get('/budgets/remaining', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { department, year } = req.query;
    const r = pool.request();
    let where = 'budgetYear = @year';
    r.input('year', sql.Int, year || new Date().getFullYear());
    if (department) { where += ' AND targetName = @dept'; r.input('dept', sql.NVarChar, department); }
    const result = await r.query(`SELECT *, (totalBudget - usedAmount) as remaining FROM BudgetConfig WHERE ${where}`);
    res.json(result.recordset);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// ============================================================
// 审批流配置 API
// ============================================================

// 获取用户列表（从"用户全"表查询，供审批步骤筛选）
router.get('/approval/users', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const keyword = (req.query.keyword as string || '').trim();
    let where = '';
    const r = pool.request();
    if (keyword) {
      where = " WHERE 用户代码 LIKE @kw OR 用户名称 LIKE @kw";
      r.input('kw', sql.NVarChar, `%${keyword}%`);
    }
    const result = await r.query(`SELECT TOP 200 用户代码 as userCode, 用户名称 as userName, '' as groupName FROM 用户全${where} ORDER BY 用户代码`);
    res.json(result.recordset);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 获取用户组列表（用户组列已删：返回空数组，旧筛选器下线）
router.get('/approval/groups', async (req: Request, res: Response) => {
  res.json([]);
});

// 查询审批流列表
router.get('/approval/list', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { expenseType, status } = req.query;
    const r = pool.request();
    let where = '1=1';
    if (expenseType) { where += ' AND expenseType = @et'; r.input('et', sql.NVarChar, expenseType); }
    if (status) { where += ' AND status = @st'; r.input('st', sql.NVarChar, status); }
    const result = await r.query(`SELECT * FROM ApprovalFlow WHERE ${where} ORDER BY createdAt DESC`);
    const rows = result.recordset.map((row: any) => ({
      ...row,
      approvalSteps: row.approvalSteps ? JSON.parse(row.approvalSteps) : [],
      conditionConfig: row.conditionConfig ? JSON.parse(row.conditionConfig) : null,
      ccUsers: safeParseCcArray(row.cc_users),
      ccOrgs: safeParseCcArray(row.cc_orgs),
    }));
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 获取单个审批流详情
router.get('/approval/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT * FROM ApprovalFlow WHERE id = @id');
    if (result.recordset.length === 0) return res.status(404).json({ message: '审批流不存在' });
    const row = result.recordset[0];
    row.approvalSteps = row.approvalSteps ? JSON.parse(row.approvalSteps) : [];
    row.conditionConfig = row.conditionConfig ? JSON.parse(row.conditionConfig) : null;
    row.ccUsers = safeParseCcArray(row.cc_users);
    row.ccOrgs = safeParseCcArray(row.cc_orgs);
    res.json(row);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 新建审批流
router.post('/approval', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { flowNo, paymentType, approvalSteps, conditionConfig, status, createdBy, org_id, org_name, org_ids, org_names, ccUsers, ccOrgs } = req.body;
    // 多组织适用范围归一化：优先用 org_ids；旧客户端只传 org_id 时兜底为单组织
    let saveOrgIds = org_ids || '';
    let saveOrgNames = org_names || '';
    if (!saveOrgIds && org_id) { saveOrgIds = String(org_id); saveOrgNames = saveOrgNames || org_name || ''; }
    const ccUsersJson = ccUsers && ccUsers.length > 0 ? JSON.stringify(ccUsers) : null;
    const ccOrgsJson = ccOrgs && ccOrgs.length > 0 ? JSON.stringify(ccOrgs) : null;
    const result = await pool.request()
      .input('flowNo', sql.NVarChar, flowNo || `AF${Date.now()}`)
      .input('paymentType', sql.NVarChar, paymentType || null)
      .input('approvalSteps', sql.NVarChar, JSON.stringify(approvalSteps || []))
      .input('conditionConfig', sql.NVarChar, conditionConfig ? JSON.stringify(conditionConfig) : null)
      .input('status', sql.NVarChar, status || 'active')
      .input('createdBy', sql.NVarChar, createdBy || null)
      .input('org_id', sql.Int, org_id || null)
      .input('org_name', sql.NVarChar, org_name || null)
      .input('org_ids', sql.NVarChar, saveOrgIds || null)
      .input('org_names', sql.NVarChar, saveOrgNames || null)
      .input('cc_users', sql.NVarChar, ccUsersJson)
      .input('cc_orgs', sql.NVarChar, ccOrgsJson)
      .query(`INSERT INTO ApprovalFlow (flowNo, paymentType, approvalSteps, conditionConfig, status, createdBy, org_id, org_name, org_ids, org_names, cc_users, cc_orgs) OUTPUT INSERTED.* VALUES (@flowNo, @paymentType, @approvalSteps, @conditionConfig, @status, @createdBy, @org_id, @org_name, @org_ids, @org_names, @cc_users, @cc_orgs)`);
    const row = result.recordset[0];
    row.approvalSteps = row.approvalSteps ? JSON.parse(row.approvalSteps) : [];
    row.conditionConfig = row.conditionConfig ? JSON.parse(row.conditionConfig) : null;
    row.ccUsers = safeParseCcArray(row.cc_users);
    row.ccOrgs = safeParseCcArray(row.cc_orgs);
    res.json(row);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 更新审批流
router.put('/approval/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { flowNo, paymentType, approvalSteps, conditionConfig, status, org_id, org_name, org_ids, org_names, ccUsers, ccOrgs } = req.body;
    // 多组织适用范围归一化：优先用 org_ids；旧客户端只传 org_id 时兜底为单组织
    let saveOrgIds = org_ids || '';
    let saveOrgNames = org_names || '';
    if (!saveOrgIds && org_id) { saveOrgIds = String(org_id); saveOrgNames = saveOrgNames || org_name || ''; }
    const ccUsersJson = ccUsers && ccUsers.length > 0 ? JSON.stringify(ccUsers) : null;
    const ccOrgsJson = ccOrgs && ccOrgs.length > 0 ? JSON.stringify(ccOrgs) : null;
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('flowNo', sql.NVarChar, flowNo)
      .input('paymentType', sql.NVarChar, paymentType || null)
      .input('approvalSteps', sql.NVarChar, JSON.stringify(approvalSteps || []))
      .input('conditionConfig', sql.NVarChar, conditionConfig ? JSON.stringify(conditionConfig) : null)
      .input('status', sql.NVarChar, status || 'active')
      .input('org_id', sql.Int, org_id || null)
      .input('org_name', sql.NVarChar, org_name || null)
      .input('org_ids', sql.NVarChar, saveOrgIds || null)
      .input('org_names', sql.NVarChar, saveOrgNames || null)
      .input('cc_users', sql.NVarChar, ccUsersJson)
      .input('cc_orgs', sql.NVarChar, ccOrgsJson)
      .query(`UPDATE ApprovalFlow SET flowNo=@flowNo, paymentType=@paymentType, approvalSteps=@approvalSteps, conditionConfig=@conditionConfig, status=@status, org_id=@org_id, org_name=@org_name, org_ids=@org_ids, org_names=@org_names, cc_users=@cc_users, cc_orgs=@cc_orgs, updatedAt=GETDATE() OUTPUT INSERTED.* WHERE id=@id`);
    if (result.recordset.length === 0) return res.status(404).json({ message: '审批流不存在' });
    const row = result.recordset[0];
    row.approvalSteps = row.approvalSteps ? JSON.parse(row.approvalSteps) : [];
    row.conditionConfig = row.conditionConfig ? JSON.parse(row.conditionConfig) : null;
    row.ccUsers = safeParseCcArray(row.cc_users);
    row.ccOrgs = safeParseCcArray(row.cc_orgs);
    res.json(row);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 删除审批流
router.delete('/approval/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM ApprovalFlow WHERE id = @id');
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// ============================================================
// 账簿管理 API
// ============================================================

router.get('/ledger/list', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { accountType, status } = req.query;
    const r = pool.request();
    let where = '1=1';
    if (accountType) { where += ' AND accountType = @at'; r.input('at', sql.NVarChar, accountType); }
    if (status) { where += ' AND status = @st'; r.input('st', sql.NVarChar, status); }
    const result = await r.query(`SELECT * FROM LedgerAccount WHERE ${where} ORDER BY createdAt DESC`);
    res.json(result.recordset);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

router.post('/ledger', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { accountName, accountHolder, accountNo, bankName, accountType, balance, status, remark } = req.body;
    const result = await pool.request()
      .input('accountName', sql.NVarChar, accountName)
      .input('accountHolder', sql.NVarChar, accountHolder || null)
      .input('accountNo', sql.NVarChar, accountNo || null)
      .input('bankName', sql.NVarChar, bankName || null)
      .input('accountType', sql.NVarChar, accountType || 'bank')
      .input('balance', sql.Decimal(18, 2), balance || 0)
      .input('status', sql.NVarChar, status || 'active')
      .input('remark', sql.NVarChar, remark || null)
      .query('INSERT INTO LedgerAccount (accountName, accountHolder, accountNo, bankName, accountType, balance, status, remark) OUTPUT INSERTED.* VALUES (@accountName, @accountHolder, @accountNo, @bankName, @accountType, @balance, @status, @remark)');
    res.json(result.recordset[0]);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

router.put('/ledger/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { accountName, accountHolder, accountNo, bankName, accountType, balance, status, remark } = req.body;
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('accountName', sql.NVarChar, accountName)
      .input('accountHolder', sql.NVarChar, accountHolder || null)
      .input('accountNo', sql.NVarChar, accountNo || null)
      .input('bankName', sql.NVarChar, bankName || null)
      .input('accountType', sql.NVarChar, accountType || 'bank')
      .input('balance', sql.Decimal(18, 2), balance || 0)
      .input('status', sql.NVarChar, status || 'active')
      .input('remark', sql.NVarChar, remark || null)
      .query('UPDATE LedgerAccount SET accountName=@accountName, accountHolder=@accountHolder, accountNo=@accountNo, bankName=@bankName, accountType=@accountType, balance=@balance, status=@status, remark=@remark OUTPUT INSERTED.* WHERE id=@id');
    if (result.recordset.length === 0) return res.status(404).json({ message: '账簿不存在' });
    res.json(result.recordset[0]);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

router.delete('/ledger/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM LedgerAccount WHERE id = @id');
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 账簿查询：按账簿分组的付款明细和汇总
router.get('/ledger/payments', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { ledgerId, startDate, endDate, sourceType } = req.query;
    const r = pool.request();
    let where = '1=1';
    if (ledgerId) { where += ' AND pr.ledgerId = @lid'; r.input('lid', sql.Int, ledgerId); }
    if (startDate) { where += ' AND pr.payDate >= @sd'; r.input('sd', sql.Date, startDate); }
    if (endDate) { where += ' AND pr.payDate <= @ed'; r.input('ed', sql.Date, endDate); }
    if (sourceType) { where += ' AND pr.sourceType = @st'; r.input('st', sql.NVarChar, sourceType); }
    const result = await r.query(`
      SELECT pr.*, la.accountName, la.accountHolder, la.accountNo, la.bankName, la.accountType
      FROM PaymentRecord pr
      LEFT JOIN LedgerAccount la ON pr.ledgerId = la.id
      WHERE ${where}
      ORDER BY pr.payDate DESC, pr.createdAt DESC
    `);
    // 汇总
    const summary = await pool.request().query(`
      SELECT la.id as ledgerId, la.accountName, la.accountHolder, la.accountNo, la.bankName, la.accountType,
        COUNT(pr.id) as payCount, ISNULL(SUM(pr.amount), 0) as totalAmount
      FROM LedgerAccount la
      LEFT JOIN PaymentRecord pr ON la.id = pr.ledgerId
      GROUP BY la.id, la.accountName, la.accountHolder, la.accountNo, la.bankName, la.accountType
      ORDER BY la.createdAt DESC
    `);
    res.json({ details: result.recordset, summary: summary.recordset });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// ============================================================
// 付款记录 API
// ============================================================

router.get('/payment/list', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { sourceType, sourceId, ledgerId, startDate, endDate } = req.query;
    const r = pool.request();
    let where = '1=1';
    if (sourceType) { where += ' AND sourceType = @st'; r.input('st', sql.NVarChar, sourceType); }
    if (sourceId) { where += ' AND sourceId = @sid'; r.input('sid', sql.Int, sourceId); }
    if (ledgerId) { where += ' AND ledgerId = @lid'; r.input('lid', sql.Int, ledgerId); }
    if (startDate) { where += ' AND payDate >= @sd'; r.input('sd', sql.Date, startDate); }
    if (endDate) { where += ' AND payDate <= @ed'; r.input('ed', sql.Date, endDate); }
    // 组织数据权限：仅可见自己组织及其下级的付款记录
    const scope = await resolveOrgScope(pool, (req as any).user);
    const scopeParams: { name: string; type: any; value: any }[] = [];
    const scopeWhere = orgScopeWhere(scope, 'org_id', 'createdBy', scopeParams);
    if (scopeWhere) scopeParams.forEach(p => r.input(p.name, p.type, p.value));
    where += scopeWhere;
    const result = await r.query(`SELECT * FROM PaymentRecord WHERE ${where} ORDER BY payDate DESC, createdAt DESC`);
    res.json(result.recordset);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 出纳付款：生成付款记录
router.post('/payment', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { sourceType, sourceId, sourceNo, payee, amount, ledgerId, ledgerName, payDate, payMethod, remark, createdBy } = req.body;
    const payNo = `PAY${Date.now()}`;
    // 付款记录归属组织：优先继承来源单据组织；无来源时取当前用户组织
    let payOrgId: number | null = null;
    let payOrgName = '';
    try {
      const srcTable = sourceType === 'reimbursement' ? 'Reimbursement'
        : sourceType === 'advance' ? 'EmployeeAdvance'
        : sourceType === 'advance_payment' ? 'AdvancePayment' : null;
      if (srcTable && sourceId) {
        const s = await pool.request().input('sid', sql.Int, sourceId)
          .query(`SELECT org_id, org_name FROM ${srcTable} WHERE id = @sid`);
        if (s.recordset.length > 0 && s.recordset[0].org_id != null) {
          payOrgId = Number(s.recordset[0].org_id);
          payOrgName = s.recordset[0].org_name || '';
        }
      }
      if (payOrgId === null && (req as any).user && (req as any).user.orgId) {
        payOrgId = Number((req as any).user.orgId);
        payOrgName = (req as any).user.orgName || '';
      }
    } catch { /* 组织解析失败不阻断付款 */ }
    const result = await pool.request()
      .input('payNo', sql.NVarChar, payNo)
      .input('sourceType', sql.NVarChar, sourceType)
      .input('sourceId', sql.Int, sourceId)
      .input('sourceNo', sql.NVarChar, sourceNo || null)
      .input('payee', sql.NVarChar, payee || null)
      .input('amount', sql.Decimal(18, 2), amount)
      .input('ledgerId', sql.Int, ledgerId || null)
      .input('ledgerName', sql.NVarChar, ledgerName || null)
      .input('payDate', sql.Date, payDate || new Date().toISOString().slice(0, 10))
      .input('payMethod', sql.NVarChar, payMethod || '银行转账')
      .input('remark', sql.NVarChar, remark || null)
      .input('createdBy', sql.NVarChar, createdBy || null)
      .input('org_id', sql.Int, payOrgId)
      .input('org_name', sql.NVarChar, payOrgName)
      .query('INSERT INTO PaymentRecord (payNo, sourceType, sourceId, sourceNo, payee, amount, ledgerId, ledgerName, payDate, payMethod, remark, createdBy, org_id, org_name) OUTPUT INSERTED.* VALUES (@payNo, @sourceType, @sourceId, @sourceNo, @payee, @amount, @ledgerId, @ledgerName, @payDate, @payMethod, @remark, @createdBy, @org_id, @org_name)');
    const row = result.recordset[0];

    // 更新账簿余额（扣减）
    if (ledgerId) {
      await pool.request()
        .input('lid', sql.Int, ledgerId)
        .input('amt', sql.Decimal(18, 2), amount)
        .query('UPDATE LedgerAccount SET balance = balance - @amt WHERE id = @lid');
    }

    // 更新来源单据的付款状态
    if (sourceType === 'reimbursement') {
      await pool.request()
        .input('sid', sql.Int, sourceId)
        .input('payStatus', sql.NVarChar, 'paid')
        .input('payDate', sql.Date, payDate || new Date().toISOString().slice(0, 10))
        .query('UPDATE Reimbursement SET payStatus=@payStatus, payDate=@payDate WHERE id=@sid');
    } else if (sourceType === 'advance') {
      await pool.request()
        .input('sid', sql.Int, sourceId)
        .input('payStatus', sql.NVarChar, 'paid')
        .input('payDate', sql.Date, payDate || new Date().toISOString().slice(0, 10))
        .query('UPDATE EmployeeAdvance SET status=\'paid\' WHERE id=@sid');
    } else if (sourceType === 'advance_payment') {
      await pool.request()
        .input('sid', sql.Int, sourceId)
        .input('payStatus', sql.NVarChar, 'paid')
        .input('payDate', sql.Date, payDate || new Date().toISOString().slice(0, 10))
        .input('payAmount', sql.Decimal(18, 2), amount)
        .input('ledgerId', sql.Int, ledgerId)
        .query('UPDATE AdvancePayment SET payStatus=@payStatus, payDate=@payDate, payAmount=@payAmount, ledgerId=@ledgerId WHERE id=@sid');
    }

    res.json(row);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 付款记录生成凭证
router.post('/payment/:id/generate-voucher', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const payResult = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT * FROM PaymentRecord WHERE id = @id');
    if (payResult.recordset.length === 0) return res.status(404).json({ message: '付款记录不存在' });
    const pay = payResult.recordset[0];

    if (pay.voucherId) return res.status(400).json({ message: '该付款记录已生成凭证' });

    const voucherNo = `BV${Date.now()}`;
    const vResult = await pool.request()
      .input('voucherNo', sql.NVarChar, voucherNo)
      .input('reimburseId', sql.Int, pay.id)
      .input('voucherDate', sql.Date, pay.payDate)
      .input('debitSubject', sql.NVarChar, '应付账款')
      .input('creditSubject', sql.NVarChar, pay.ledgerName || '银行存款')
      .input('amount', sql.Decimal(18, 2), pay.amount)
      .input('summary', sql.NVarChar, `付款-${pay.payee || ''}-${pay.sourceNo || pay.payNo}`)
      .query('INSERT INTO ReimbursementVoucher (voucherNo, reimburseId, sourceType, voucherDate, debitSubject, creditSubject, amount, summary) OUTPUT INSERTED.* VALUES (@voucherNo, @reimburseId, \'payment\', @voucherDate, @debitSubject, @creditSubject, @amount, @summary)');

    const voucher = vResult.recordset[0];
    await pool.request()
      .input('id', sql.Int, pay.id)
      .input('vid', sql.Int, voucher.id)
      .query('UPDATE PaymentRecord SET voucherId = @vid WHERE id = @id');

    res.json({ success: true, voucherNo, voucher });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// ============================================================
// 预付款申请 API
// ============================================================

router.get('/advance-payment/list', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { applicantId, approvalStatus, payStatus } = req.query;
    const r = pool.request();
    let where = '1=1';
    if (applicantId) { where += ' AND applicantId = @aid'; r.input('aid', sql.NVarChar, applicantId); }
    if (approvalStatus) { where += ' AND approvalStatus = @aps'; r.input('aps', sql.NVarChar, approvalStatus); }
    if (payStatus) { where += ' AND payStatus = @ps'; r.input('ps', sql.NVarChar, payStatus); }
    // 组织数据权限：仅可见自己组织及其下级的预付款申请；此外，被抄送的用户（或所在组织被抄送的成员）也可查看
    const scope = await resolveOrgScope(pool, (req as any).user);
    const scopeParams: { name: string; type: any; value: any }[] = [];
    const scopeWhere = orgScopeWhere(scope, 'org_id', 'applicantId', scopeParams);
    if (scopeWhere) {
      if (scopeParams.length === 0) { /* noop */ }
      scopeParams.forEach(p => r.input(p.name, p.type, p.value));
      where += scopeWhere;
      const ccIds = await resolveCcVisibleSourceIds(pool, 'advance_payment', (req as any).user);
      if (ccIds.length > 0) {
        where = where.replace(scopeWhere, ` AND (1=1${scopeWhere} OR id IN (${ccIds.join(',')}))`);
      }
    }
    const result = await r.query(`SELECT * FROM AdvancePayment WHERE ${where} ORDER BY createdAt DESC`);
    res.json(result.recordset);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

router.get('/advance-payment/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT * FROM AdvancePayment WHERE id = @id');
    if (result.recordset.length === 0) return res.status(404).json({ message: '预付款申请不存在' });
    // 组织数据权限：详情不得越出自己组织及下级；被抄送的用户也可查看
    const scope = await resolveOrgScope(pool, (req as any).user);
    if (scope) {
      const row = result.recordset[0];
      let allowed = false;
      if (scope.kind === 'all') allowed = true;
      else if (scope.kind === 'self') allowed = (row.applicantId || '') === scope.userCode;
      else allowed = row.org_id != null && scope.orgIds.includes(Number(row.org_id));
      if (!allowed) {
        // 抄送可见性兜底：当前用户是该单抄送人（命中用户或所在组织被抄送）
        allowed = await isCcVisibleSource(pool, 'advance_payment', Number(req.params.id), (req as any).user);
      }
      if (!allowed) return res.status(403).json({ message: '无权查看该预付款申请' });
    }
    res.json(result.recordset[0]);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

router.post('/advance-payment', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { applyNo, applicantId, applicantName, department, expenseType, paymentType, applyAmount, applyDate, reason, createdBy } = req.body;
    // 自动获取用户组织（替换「部门」）：预付款申请归属当前用户组织；代他人提交时按申请人解析
    const orgSnap = await resolveDocOrg(pool, (req as any).user, applicantId || (createdBy || ''));
    const orgId = orgSnap ? orgSnap.orgId : null;
    const effOrgName = orgSnap ? orgSnap.orgName : '';
    const result = await pool.request()
      .input('applyNo', sql.NVarChar, applyNo || `AP${Date.now()}`)
      .input('applicantId', sql.NVarChar, applicantId)
      .input('applicantName', sql.NVarChar, applicantName)
      .input('department', sql.NVarChar, effOrgName || department || null)
      .input('org_id', sql.Int, orgId)
      .input('org_name', sql.NVarChar, effOrgName)
      .input('expenseType', sql.NVarChar, expenseType || null)
      .input('paymentType', sql.NVarChar, paymentType || null)
      .input('applyAmount', sql.Decimal(18, 2), applyAmount)
      .input('applyDate', sql.Date, applyDate || new Date().toISOString().slice(0, 10))
      .input('reason', sql.NVarChar, reason || null)
      .input('createdBy', sql.NVarChar, createdBy || null)
      .query('INSERT INTO AdvancePayment (applyNo, applicantId, applicantName, department, org_id, org_name, expenseType, paymentType, applyAmount, applyDate, reason, createdBy) OUTPUT INSERTED.* VALUES (@applyNo, @applicantId, @applicantName, @department, @org_id, @org_name, @expenseType, @paymentType, @applyAmount, @applyDate, @reason, @createdBy)');
    const apRow = result.recordset[0];
    // 匹配审批流并创建审批任务
    const flow = await matchApprovalFlow(pool, '预付款', Number(applyAmount), applicantId);
    if (flow) {
      const steps = flow.approvalSteps ? JSON.parse(flow.approvalSteps) : [];
      if (steps.length > 0) {
        await createApprovalTasks(pool, 'advance_payment', apRow.id, apRow.applyNo, applicantId, applicantName, flow.id, flow.flowNo, steps, Number(applyAmount), expenseType || '', reason || '', safeParseCcArray(flow.cc_users), safeParseCcArray(flow.cc_orgs));
      }
    }
    res.json(apRow);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

router.put('/advance-payment/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { applicantName, department, expenseType, paymentType, applyAmount, applyDate, reason, approvalStatus, payStatus } = req.body;
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('applicantName', sql.NVarChar, applicantName)
      .input('department', sql.NVarChar, department || null)
      .input('expenseType', sql.NVarChar, expenseType || null)
      .input('paymentType', sql.NVarChar, paymentType || null)
      .input('applyAmount', sql.Decimal(18, 2), applyAmount)
      .input('applyDate', sql.Date, applyDate || new Date().toISOString().slice(0, 10))
      .input('reason', sql.NVarChar, reason || null)
      .input('approvalStatus', sql.NVarChar, approvalStatus || 'pending')
      .input('payStatus', sql.NVarChar, payStatus || 'unpaid')
      .query('UPDATE AdvancePayment SET applicantName=@applicantName, department=@department, expenseType=@expenseType, paymentType=@paymentType, applyAmount=@applyAmount, applyDate=@applyDate, reason=@reason, approvalStatus=@approvalStatus, payStatus=@payStatus, updatedAt=GETDATE() OUTPUT INSERTED.* WHERE id=@id');
    if (result.recordset.length === 0) return res.status(404).json({ message: '预付款申请不存在' });
    res.json(result.recordset[0]);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

router.post('/advance-payment/:id/approve', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { approvalStatus, approvedBy, rejectReason } = req.body;
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('approvalStatus', sql.NVarChar, approvalStatus)
      .input('approvedBy', sql.NVarChar, approvedBy || null)
      .input('rejectReason', sql.NVarChar, rejectReason || null)
      .query('UPDATE AdvancePayment SET approvalStatus=@approvalStatus, approvedBy=@approvedBy, rejectReason=@rejectReason, approvedAt=GETDATE(), updatedAt=GETDATE() OUTPUT INSERTED.* WHERE id=@id');
    if (result.recordset.length === 0) return res.status(404).json({ message: '预付款申请不存在' });
    res.json(result.recordset[0]);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

router.delete('/advance-payment/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM AdvancePayment WHERE id = @id');
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// ============================================================
// 审批任务 API（审批流引擎）
// ============================================================

// 获取当前用户的待审批任务列表（支持 org 类型审批人：组织快照 + 角色，跨组织隔离）
router.get('/approval-task/my-pending', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    // 身份优先取 JWT（authMiddleware 已强制覆盖 groupName），未带 token 时回退 query
    const userCode = (req.user?.userCode) || String(req.query.userCode || '');
    if (!userCode) { res.json([]); return; }
    const groupName = req.user?.groupName || String(req.query.groupName || '');
    // 解析当前用户（审批人）组织快照，供 org 类型审批人判断
    let approverOrg: { orgId: number; orgName: string; orgPath: string } | null = null;
    try { approverOrg = await resolveApplicantOrg(pool, userCode); } catch { /* ignore */ }

    const result = await pool.request()
      .query(`SELECT * FROM ApprovalTask WHERE status = 'pending' ORDER BY createdAt DESC`);

    const pending: any[] = [];
    for (const task of result.recordset) {
      if (await isUserInApproversAsync(
        pool,
        task.approvers,
        userCode,
        groupName,
        approverOrg ? approverOrg.orgId : null,
        approverOrg ? approverOrg.orgPath : null,
        task.applicantOrgPath || null
      )) {
        task.approvers = JSON.parse(task.approvers || '[]');
        pending.push(task);
      }
    }
    res.json(pending);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 获取某笔申请的所有审批任务（用于展示审批进度）
// 可见性：申请人本人、任一任务审批人、抄送命中者、或申请人所在组织范围内的职责审批人才可见，
// 防止跨职能线看到他人审批流（如数据部门看不到运营审批流）
router.get('/approval-task/source/:sourceType/:sourceId', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const userCode = (req.user?.userCode) || String(req.query.userCode || '');
    const result = await pool.request()
      .input('sourceType', sql.NVarChar, req.params.sourceType)
      .input('sourceId', sql.Int, req.params.sourceId)
      .query(`SELECT * FROM ApprovalTask WHERE sourceType = @sourceType AND sourceId = @sourceId ORDER BY level ASC`);
    if (result.recordset.length === 0) {
      res.json([]);
      return;
    }
    // 可见性校验（有登录身份时强制校验；无身份时保持兼容放行）
    if (userCode) {
      let visible = false;
      visible = visible || result.recordset.some((t: any) => String(t.applicantId || '') === userCode); // 申请人本人
      if (!visible) {
        const groupName = req.user?.groupName || String(req.query.groupName || '');
        let approverOrg: { orgId: number; orgName: string; orgPath: string } | null = null;
        try { approverOrg = await resolveApplicantOrg(pool, userCode); } catch { /* ignore */ }
        for (const t of result.recordset) {
          if (await isUserInApproversAsync(
            pool,
            t.approvers,
            userCode,
            groupName,
            approverOrg ? approverOrg.orgId : null,
            approverOrg ? approverOrg.orgPath : null,
            t.applicantOrgPath || null
          )) { visible = true; break; }
        }
      }
      if (!visible) {
        visible = await isCcVisibleSource(pool, String(req.params.sourceType), Number(req.params.sourceId), req.user);
      }
      if (!visible) {
        return res.status(403).json({ message: '无权查看该单据的审批流' });
      }
    }
    const rows = result.recordset.map((row: any) => ({
      ...row,
      approvers: row.approvers ? JSON.parse(row.approvers) : [],
      ccUsers: safeParseCcArray(row.cc_users),
      ccOrgs: safeParseCcArray(row.cc_orgs),
    }));
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 审批通过（每级只需一人通过；支持 org 类型审批人）
router.post('/approval-task/:id/approve', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const id = parseInt(req.params.id);
    const { approvedBy, userCode, groupName } = req.body;
    const identityUserCode = req.user?.userCode || userCode || approvedBy;
    if (!identityUserCode) return res.status(403).json({ message: '缺少审批人身份' });

    const taskResult = await pool.request().input('id', sql.Int, id).query('SELECT * FROM ApprovalTask WHERE id = @id');
    if (taskResult.recordset.length === 0) return res.status(404).json({ message: '审批任务不存在' });
    const task = taskResult.recordset[0];

    if (task.status !== 'pending') return res.status(400).json({ message: '该任务不在待审批状态' });

    // 解析审批人组织快照（org 类型审批人校验用）
    let approverOrg: { orgId: number; orgName: string; orgPath: string } | null = null;
    try { approverOrg = await resolveApplicantOrg(pool, identityUserCode); } catch { /* ignore */ }

    const hasPerm = await isUserInApproversAsync(
      pool,
      task.approvers,
      identityUserCode,
      req.user?.groupName ?? groupName ?? '',
      approverOrg ? approverOrg.orgId : null,
      approverOrg ? approverOrg.orgPath : null,
      task.applicantOrgPath || null
    );
    if (!hasPerm) {
      return res.status(403).json({ message: '您没有该任务的审批权限' });
    }

    await pool.request()
      .input('id', sql.Int, id)
      .input('approvedBy', sql.NVarChar, approvedBy || identityUserCode || '')
      .query(`UPDATE ApprovalTask SET status = 'approved', approvedBy = @approvedBy, approvedAt = GETDATE(), updatedAt = GETDATE() WHERE id = @id`);

    if (task.level < task.totalLevels) {
      await pool.request()
        .input('sourceType', sql.NVarChar, task.sourceType)
        .input('sourceId', sql.Int, task.sourceId)
        .input('nextLevel', sql.Int, task.level + 1)
        .query(`UPDATE ApprovalTask SET status = 'pending', updatedAt = GETDATE() WHERE sourceType = @sourceType AND sourceId = @sourceId AND level = @nextLevel`);
    } else {
      await updateSourceApprovalStatus(pool, task.sourceType, task.sourceId, 'approved');
    }

    res.json({ success: true, message: '审批通过' });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 审批驳回（支持 org 类型审批人）
router.post('/approval-task/:id/reject', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const id = parseInt(req.params.id);
    const { approvedBy, userCode, groupName, rejectReason } = req.body;
    const identityUserCode = req.user?.userCode || userCode || approvedBy;
    if (!identityUserCode) return res.status(403).json({ message: '缺少审批人身份' });

    const taskResult = await pool.request().input('id', sql.Int, id).query('SELECT * FROM ApprovalTask WHERE id = @id');
    if (taskResult.recordset.length === 0) return res.status(404).json({ message: '审批任务不存在' });
    const task = taskResult.recordset[0];

    if (task.status !== 'pending') return res.status(400).json({ message: '该任务不在待审批状态' });

    // 解析审批人组织快照（org 类型审批人校验用）
    let approverOrg: { orgId: number; orgName: string; orgPath: string } | null = null;
    try { approverOrg = await resolveApplicantOrg(pool, identityUserCode); } catch { /* ignore */ }

    const hasPerm = await isUserInApproversAsync(
      pool,
      task.approvers,
      identityUserCode,
      req.user?.groupName ?? groupName ?? '',
      approverOrg ? approverOrg.orgId : null,
      approverOrg ? approverOrg.orgPath : null,
      task.applicantOrgPath || null
    );
    if (!hasPerm) {
      return res.status(403).json({ message: '您没有该任务的审批权限' });
    }

    await pool.request()
      .input('id', sql.Int, id)
      .input('approvedBy', sql.NVarChar, approvedBy || identityUserCode || '')
      .input('rejectReason', sql.NVarChar, rejectReason || '')
      .query(`UPDATE ApprovalTask SET status = 'rejected', approvedBy = @approvedBy, rejectReason = @rejectReason, updatedAt = GETDATE() WHERE id = @id`);

    await updateSourceApprovalStatus(pool, task.sourceType, task.sourceId, 'rejected');

    res.json({ success: true, message: '已驳回' });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

export default router;
