import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireMenuPerm, requireAnyMenuPerm } from '../middlewares/menuPermMiddleware';
import { dispatchCustomNotification } from '../services/push/PushDispatcher';

/**
 * 入职管理（Onboarding）与转正管理（Regularization）联合流程接口
 * ------------------------------------------------------------
 * 入职阶段（menu: onboarding）：
 *   阶段一（公开）：新员工扫码 → GET /options 下拉数据、POST /apply 提交资料（状态 pending_review）
 *   阶段二：督导初审 → POST /records/:id/review（reject 驳回闭环 / approve 同意+定级三要素 → graded）
 *   阶段三：管理层只读监管（GET /records 按管辖范围过滤，无写操作）
 *   阶段四：行政快速建用户 → POST /records/:id/admin-open（建账号+企微群二维码+伯俊备案+会员注册码+提交确认 → account_ready）
 *           account_ready = 建档完成即入职成功；随后信息进入转正管理「待入职」
 * ------------------------------------------------------------
 * 转正阶段（menu: regularization，也可由 onboarding 权限兼容调用）：
 *   阶段五：督导下发 → POST /records/:id/issue（待入职 account_ready → probation，15 天自动计时）
 *   阶段六：考核期结束 → POST /records/:id/confirm-probation（督导确认考核 → probation_passed 转正通过）
 *           工牌+企微码申请 → POST /records/:id/apply-badge（probation_passed → badge_applied + 写工牌台账，body 含 wecomQr）
 *   阶段七：工牌制作/报销闭环（menu: onboardingBadge）→ POST /badge-ledger/:id/submit-making（生成报销单 → badge_making）
 *           POST /reimburse/:id/finance-review（财务核销 → completed 全流程闭环）
 * ------------------------------------------------------------
 * 定时任务：startOnboardingScheduler() 每分钟扫描
 *   - 第 3 天预警（待督导初审超时提醒，写 onboarding_timeout_log day3）
 *   - 第 7 天超时自动台账记录（day7）
 *   - 15 天转正考核期到期待办提醒（probation_due）
 */
const router = Router();

const VALID_STATUSES = [
  'pending_review', 'rejected', 'graded', 'account_ready',
  'probation', 'probation_passed', 'badge_applied', 'badge_making', 'completed',
] as const;

/** 手机上：11 位大陆手机号 */
function isValidPhone(p: string): boolean {
  return /^1\d{10}$/.test(p);
}

/** 入职申请编号：OB+yyyyMMddHHmmss+3位随机 */
function genApplyNo(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const rand = Math.floor(100 + Math.random() * 900);
  return `OB${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${rand}`;
}

/** 系统工号：ON + 5 位序号（onboarding_record 与 用户全 中均未出现过） */
async function genUserCode(pool: sql.ConnectionPool): Promise<string> {
  const r = await pool.request().query(`
    SELECT MAX(CAST(SUBSTRING(code, 3, LEN(code)) AS INT)) AS maxNo FROM (
      SELECT user_code AS code FROM onboarding_record WHERE user_code LIKE 'ON[0-9]%'
      UNION ALL
      SELECT 用户代码 AS code FROM 用户全 WHERE 用户代码 LIKE 'ON[0-9]%'
    ) t
  `);
  let no = 1;
  const cur = r.recordset[0]?.maxNo;
  if (cur !== null && cur !== undefined) no = Number(cur) + 1;
  return 'ON' + String(no).padStart(5, '0');
}

function normalizeRecord(row: any) {
  const d = (v: any) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '');
  return {
    id: row.id,
    applyNo: row.apply_no || '',
    userCode: row.user_code || '',
    phone: row.phone || '',
    userName: row.user_name || '',
    gender: row.gender || '',
    idCard: row.id_card || '',
    birthday: row.birthday || '',
    education: row.education || '',
    emergencyContact: row.emergency_contact || '',
    emergencyPhone: row.emergency_phone || '',
    address: row.address || '',
    email: row.email || '',
    resumeText: row.resume_text || '',
    materials: (() => { try { return JSON.parse(row.materials_json || '[]'); } catch { return []; } })(),
    status: row.status || 'pending_review',
    supervisorCode: row.supervisor_code || '',
    supervisorName: row.supervisor_name || '',
    reviewerCode: row.reviewer_code || '',
    reviewerName: row.reviewer_name || '',
    reviewTime: d(row.review_time),
    rejectReason: row.reject_reason || '',
    shopId: row.shop_id ?? null,
    shopName: row.shop_name || '',
    level: row.level || '',
    salarySchemeId: row.salary_scheme_id ?? null,
    salarySchemeName: row.salary_scheme_name || '',
    gradeTime: d(row.grade_time),
    adminUserCode: row.admin_user_code || '',
    adminBojunAccount: row.admin_bojun_account || '',
    adminGroupQr: row.admin_group_qr || '',
    adminMemberQr: row.admin_member_qr || '',
    memberCode: row.member_code || '',
    adminFinishTime: d(row.admin_finish_time),
    issueTime: d(row.issue_time),
    probationStart: d(row.probation_start),
    probationEnd: d(row.probation_end),
    probationConfirmTime: d(row.probation_confirm_time),
    probationConfirmBy: row.probation_confirm_by || '',
    badgeApplyTime: d(row.badge_apply_time),
    badgeNo: row.badge_no || '',
    badgeAmount: row.badge_amount ?? null,
    wecomQr: row.wecom_qr || '',
    day3Warned: row.day3_warned || 0,
    day7Logged: row.day7_logged || 0,
    remark: row.remark || '',
    createTime: d(row.create_time),
    // 时间信息增强（页面时效标识用）
    daysElapsed: row.days_elapsed ?? null,
    deadlineDays: row.deadline_days ?? null,
  };
}

// ============================================================
// 公开：下拉数据源（督导列表 / 门店列表 / 职级列表 / 薪资方案）
// 新员工扫码录入页与督导定级页共用
// ============================================================
router.get('/options', async (_req, res) => {
  try {
    const pool = await getPool();
    // 督导：sys_role(role_code='supervisor') + sys_user_role + 用户全
    const supervisors = await pool.request().query(`
      SELECT DISTINCT u.用户代码 AS user_code, u.用户名称 AS user_name
      FROM sys_user_role ur
      JOIN sys_role r ON ur.role_id = r.role_id AND r.role_code = 'supervisor'
      JOIN 用户全 u ON u.用户代码 = ur.user_code
      WHERE r.status = 1 AND u.用户代码 IS NOT NULL AND u.用户代码 <> ''
      ORDER BY u.用户名称
    `);
    // 门店：sys_org shop 叶子节点
    const shops = await pool.request().query(`
      SELECT org_id, org_name, warehouse_type
      FROM sys_org WHERE del_flag = 0 AND org_type = 'shop'
      ORDER BY org_level, org_id
    `);
    // 职级：sys_position 职位表
    const levels = await pool.request().query(`
      SELECT position_name FROM sys_position WHERE status = 1 ORDER BY position_id
    `);
    // 薪资方案
    const schemes = await pool.request().query(`
      SELECT id, scheme_name, scheme_desc FROM onboarding_salary_scheme WHERE enabled = 1 ORDER BY sort_order, id
    `);
    res.json({
      supervisors: supervisors.recordset.map((r: any) => ({ userCode: r.user_code, userName: r.user_name })),
      shops: shops.recordset.map((r: any) => ({ orgId: r.org_id, orgName: r.org_name, warehouseType: r.warehouse_type || '' })),
      levels: levels.recordset.map((r: any) => r.position_name),
      salarySchemes: schemes.recordset.map((r: any) => ({ id: r.id, schemeName: r.scheme_name, schemeDesc: r.scheme_desc || '' })),
    });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
});

// ============================================================
// 公开：佐证材料图片上传（入职资料附件，返回 /uploads/onboarding/ 相对路径）
// 权限：公开（扫码页为访客提交，无登录态）；限制类型与大小防滥用
// ============================================================
const onboardingUploadDir = path.resolve(process.cwd(), 'uploads', 'onboarding');
const onboardingUpload = multer({
  storage: multer.diskStorage({
    destination(_req: any, _file: any, cb: any) {
      if (!fs.existsSync(onboardingUploadDir)) fs.mkdirSync(onboardingUploadDir, { recursive: true });
      cb(null, onboardingUploadDir);
    },
    filename(_req: any, file: any, cb: any) {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
      cb(null, `onb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req: any, file: any, cb: any) {
    if (!/^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype || '')) {
      return cb(new Error('仅支持 jpg/png/gif/webp 格式图片'));
    }
    cb(null, true);
  },
});

router.post('/upload', (req, res) => {
  onboardingUpload.single('file')(req as any, res as any, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: '图片不能超过 5MB，请压缩后重试' });
      }
      const msg = err.message || '上传失败';
      if (/格式/.test(msg)) return res.status(400).json({ message: msg });
      return res.status(400).json({ message: '图片上传失败：' + msg });
    }
    try {
      const f = (req as any).file;
      if (!f) return res.status(400).json({ message: '未接收到图片文件' });
      res.json({ ok: true, url: `/uploads/onboarding/${f.filename}` });
    } catch (e: any) {
      return res.status(500).json({ message: '图片上传失败：' + (e.message || '未知错误') });
    }
  });
});

// ============================================================
// 公开：阶段一 新员工提交入职申请（生成记录 → 待督导初审）
// ============================================================
router.post('/apply', async (req, res) => {
  const body = req.body || {};
  const name = String(body.userName || '').trim();
  const phone = String(body.phone || '').trim();
  const supervisorCode = String(body.supervisorCode || '').trim();
  if (!name) return res.status(400).json({ message: '请填写姓名' });
  if (!isValidPhone(phone)) return res.status(400).json({ message: '请填写正确的 11 位手机号' });
  if (!supervisorCode) return res.status(400).json({ message: '请选择负责督导' });

  try {
    const pool = await getPool();
    // 手机号查重：用户全 已存在 / onboarding_record 已有进行中记录
    const dupUser = await pool.request().input('ph', sql.NVarChar, phone)
      .query(`SELECT TOP 1 用户代码 FROM 用户全 WHERE 手机号 = @ph`);
    if (dupUser.recordset.length > 0) {
      return res.status(409).json({ message: '该手机号已存在系统用户，请直接联系督导或行政' });
    }
    const dupRec = await pool.request().input('ph', sql.NVarChar, phone)
      .query(`SELECT TOP 1 id, status FROM onboarding_record WHERE phone = @ph`);
    if (dupRec.recordset.length > 0) {
      const st = dupRec.recordset[0].status;
      if (st === 'rejected') {
        await pool.request().input('ph', sql.NVarChar, phone)
          .query(`DELETE FROM onboarding_record WHERE phone = @ph AND status = 'rejected'`);
      } else {
        return res.status(409).json({ message: '该手机号已有进行中的入职流程，请勿重复提交' });
      }
    }
    // 督导姓名
    const sup = await pool.request().input('uc', sql.NVarChar, supervisorCode)
      .query(`SELECT TOP 1 用户名称 FROM 用户全 WHERE 用户代码 = @uc`);
    const supervisorName = sup.recordset[0]?.用户名称 || supervisorCode;

    const userCode = await genUserCode(pool);
    const materialsJson = JSON.stringify(Array.isArray(body.materials) ? body.materials : []);

    const ins = await pool.request()
      .input('applyNo', sql.NVarChar, genApplyNo())
      .input('userCode', sql.NVarChar, userCode)
      .input('phone', sql.NVarChar, phone)
      .input('userName', sql.NVarChar, name)
      .input('gender', sql.NVarChar, String(body.gender || '').trim())
      .input('idCard', sql.NVarChar, String(body.idCard || '').trim())
      .input('birthday', sql.NVarChar, String(body.birthday || '').trim())
      .input('education', sql.NVarChar, String(body.education || '').trim())
      .input('emergencyContact', sql.NVarChar, String(body.emergencyContact || '').trim())
      .input('emergencyPhone', sql.NVarChar, String(body.emergencyPhone || '').trim())
      .input('address', sql.NVarChar, String(body.address || '').trim())
      .input('email', sql.NVarChar, String(body.email || '').trim())
      .input('resumeText', sql.NVarChar, String(body.resumeText || '').trim())
      .input('materials', sql.NVarChar, materialsJson)
      .input('supCode', sql.NVarChar, supervisorCode)
      .input('supName', sql.NVarChar, supervisorName)
      .query(`
        INSERT INTO onboarding_record (
          apply_no, user_code, phone, user_name, gender, id_card, birthday, education,
          emergency_contact, emergency_phone, address, email, resume_text, materials_json,
          status, supervisor_code, supervisor_name
        )
        OUTPUT INSERTED.id
        VALUES (
          @applyNo, @userCode, @phone, @userName, @gender, @idCard, @birthday, @education,
          @emergencyContact, @emergencyPhone, @address, @email, @resumeText, @materials,
          'pending_review', @supCode, @supName
        )
      `);
    const newId = ins.recordset[0]?.id;

    // 自动推送至对应负责督导
    try {
      const supInfo = await pool.request().input('uc', sql.NVarChar, supervisorCode)
        .query(`SELECT TOP 1 用户名称, 企微账号 FROM 用户全 WHERE 用户代码 = @uc`);
      const s = supInfo.recordset[0];
      if (s?.企微账号) {
        await dispatchCustomNotification(
          `【入职申请】新员工 ${name}（${phone}）已提交入职资料，请于 3-7 个自然日内完成初审。`,
          'auto',
          { templateTitle: '入职申请待初审', recipientOverride: [{ name: s.用户名称, wechatAccount: s.企微账号 }] },
        );
      }
    } catch (pushErr: any) {
      console.error('[Onboarding] 入职申请推送失败:', pushErr.message);
    }

    res.status(201).json({ ok: true, message: '入职资料提交成功，流程已进入待督导初审', id: newId, userCode });
  } catch (e: any) {
    if (/UQ_onboarding_record_phone|duplicate|Violation of UNIQUE/i.test(e.message || '')) {
      return res.status(409).json({ message: '该手机号已提交过入职申请，请勿重复提交' });
    }
    console.error('[Onboarding] 提交入职申请失败:', e.message);
    res.status(500).json({ message: '提交失败：' + (e.message || '未知错误') });
  }
});

// ============================================================
// 管理：入职记录列表（按当前登录人角色/管辖范围过滤）
//  - supervisor：仅本人负责的记录
//  - area_manager（区经）/ ops_director（总监）：管辖组织树下督导负责的记录（只读）
//  - admin_staff/hr_staff/hr/finance/finance_staff/cashier/super_admin/data_admin/it/boss：全量
// ============================================================
interface ScopeFilter {
  cond: string;
  params: { name: string; type: any; value: any }[];
}

async function buildScopeFilter(pool: sql.ConnectionPool, user: any): Promise<ScopeFilter> {
  const roleCodes: string[] = (user.roleCodes || []).filter((c: any) => typeof c === 'string');
  const userCode = String(user.userCode || '');
  const noCond: ScopeFilter = { cond: '1=1', params: [] };
  if (!userCode) return noCond;
  if (roleCodes.includes('supervisor') && !roleCodes.some((r) => ['area_manager', 'ops_director', 'data_admin', 'super_admin', 'admin_staff', 'hr_staff', 'hr', 'finance', 'finance_staff', 'cashier', 'boss', 'it'].includes(r))) {
    return { cond: 'r.supervisor_code = @uc', params: [{ name: 'uc', type: sql.NVarChar, value: userCode }] };
  }
  // 管理/职能/财务角色 → 全量
  if (roleCodes.some((r) => ['area_manager', 'ops_director', 'data_admin', 'super_admin', 'admin_staff', 'hr_staff', 'hr', 'finance', 'finance_staff', 'cashier', 'boss', 'it'].includes(r))) {
    return noCond;
  }
  return noCond;
}

router.get('/records', authMiddleware, requireAnyMenuPerm('baseInfo', ['onboarding', 'regularization']), async (req, res) => {
  try {
    const { status } = req.query;
    const pool = await getPool();
    const scope = await buildScopeFilter(pool, (req as any).user);
    const where: string[] = [];
    const params: { name: string; type: any; value: any }[] = [];
    // 支持逗号分隔多状态过滤（如 account_ready,probation —— 转正管理「待入职+考核中」视图）
    if (typeof status === 'string' && status.trim()) {
      const statuses = status.split(',').map((s) => s.trim()).filter((s) => (VALID_STATUSES as readonly string[]).includes(s));
      if (statuses.length > 0) {
        const ph = statuses.map((_, i) => `@st${i}`).join(',');
        where.push(`r.status IN (${ph})`);
        statuses.forEach((s, i) => params.push({ name: `st${i}`, type: sql.NVarChar, value: s }));
      }
    }
    if (scope.cond !== '1=1') where.push(scope.cond);
    for (const p of scope.params) params.push(p);
    const whereSql = where.length > 0 ? ' WHERE ' + where.join(' AND ') : '';
    const q = pool.request();
    params.forEach((p) => q.input(p.name, p.type, p.value));
    const r = await q.query(`
      SELECT TOP 200 r.*,
        DATEDIFF(DAY, r.create_time, GETDATE()) AS days_elapsed,
        CASE WHEN r.status = 'pending_review'
          THEN CASE WHEN DATEDIFF(DAY, r.create_time, GETDATE()) >= 7 THEN 0
                    WHEN DATEDIFF(DAY, r.create_time, GETDATE()) >= 3 THEN 7 - DATEDIFF(DAY, r.create_time, GETDATE())
                    ELSE 7 - DATEDIFF(DAY, r.create_time, GETDATE()) END
          ELSE NULL END AS deadline_days
      FROM onboarding_record r
      ${whereSql}
      ORDER BY (CASE WHEN r.status = 'pending_review' THEN 0 WHEN r.status = 'graded' THEN 1 WHEN r.status = 'probation' THEN 2 ELSE 3 END), r.id DESC
    `);
    res.json({ records: r.recordset.map(normalizeRecord) });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
});

// ============================================================
// 管理：入职记录详情
// ============================================================
router.get('/records/:id', authMiddleware, requireAnyMenuPerm('baseInfo', ['onboarding', 'regularization']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '记录ID无效' });
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id)
      .query(`SELECT * FROM onboarding_record WHERE id = @id`);
    if (r.recordset.length === 0) return res.status(404).json({ message: '记录不存在' });
    res.json({ record: normalizeRecord(r.recordset[0]) });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
});

function loadRecord(pool: sql.ConnectionPool, id: number) {
  return pool.request().input('id', sql.Int, id).query(`SELECT * FROM onboarding_record WHERE id = @id`);
}

/** 推送助手：按用户代码查企微账号并推送（失败不阻断主流程） */
async function notifyUserByCode(pool: sql.ConnectionPool, userCode: string, title: string, content: string) {
  try {
    const r = await pool.request().input('uc', sql.NVarChar, userCode)
      .query(`SELECT TOP 1 用户名称, 企微账号 FROM 用户全 WHERE 用户代码 = @uc`);
    const u = r.recordset[0];
    if (!u?.企微账号) return;
    await dispatchCustomNotification(content, 'auto', {
      templateTitle: title,
      recipientOverride: [{ name: u.用户名称, wechatAccount: u.企微账号 }],
    });
  } catch (e: any) {
    console.error(`[Onboarding] 推送 ${title} 失败:`, e.message);
  }
}

// ============================================================
// 管理：阶段二 督导初审（驳回闭环 / 同意+定级三要素）
// ============================================================
router.post('/records/:id/review', authMiddleware, requireMenuPerm('baseInfo', 'onboarding'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '记录ID无效' });
  const body = req.body || {};
  const action = String(body.action || '');
  const user: any = (req as any).user;

  try {
    const pool = await getPool();
    const found = await loadRecord(pool, id);
    if (found.recordset.length === 0) return res.status(404).json({ message: '记录不存在' });
    const row = found.recordset[0];
    if (row.status !== 'pending_review') return res.status(409).json({ message: '该记录已不在待初审状态，不能重复操作' });
    // 督导权限：本人负责的记录才能初审
    const roleCodes: string[] = (user.roleCodes || []).filter((c: any) => typeof c === 'string');
    if (roleCodes.includes('supervisor') && row.supervisor_code !== user.userCode) {
      return res.status(403).json({ message: '只能初审本人负责的入职记录' });
    }

    if (action === 'reject') {
      const reason = String(body.reason || '').trim() || '考核不通过';
      await pool.request()
        .input('id', sql.Int, id)
        .input('reviewer', sql.NVarChar, user.userCode || '')
        .input('reviewerName', sql.NVarChar, user.userName || '')
        .input('reason', sql.NVarChar, reason)
        .query(`
          UPDATE onboarding_record
          SET status = 'rejected', reviewer_code = @reviewer, reviewer_name = @reviewerName,
              review_time = GETDATE(), reject_reason = @reason, update_time = GETDATE()
          WHERE id = @id
        `);
      return res.json({ ok: true, message: '已驳回，入职流程终止（状态：入职驳回/考核未通过），数据留存备查' });
    }

    if (action === 'approve') {
      const shopId = Number(body.shopId);
      const level = String(body.level || '').trim();
      const schemeId = Number(body.salarySchemeId);
      if (!Number.isInteger(shopId) || shopId <= 0) return res.status(400).json({ message: '请选择绑定入职店铺' });
      if (!level) return res.status(400).json({ message: '请核定入职职级' });
      if (!Number.isInteger(schemeId) || schemeId <= 0) return res.status(400).json({ message: '请选定对应薪资方案' });

      // 校验店铺与薪资方案存在
      const org = await pool.request().input('oid', sql.Int, shopId)
        .query(`SELECT org_name, org_type FROM sys_org WHERE org_id = @oid AND del_flag = 0`);
      if (org.recordset.length === 0 || org.recordset[0].org_type !== 'shop') {
        return res.status(400).json({ message: '所选店铺不存在或类型错误' });
      }
      const scheme = await pool.request().input('sid', sql.Int, schemeId)
        .query(`SELECT scheme_name FROM onboarding_salary_scheme WHERE id = @sid AND enabled = 1`);
      if (scheme.recordset.length === 0) return res.status(400).json({ message: '所选薪资方案不存在或已停用' });

      await pool.request()
        .input('id', sql.Int, id)
        .input('reviewer', sql.NVarChar, user.userCode || '')
        .input('reviewerName', sql.NVarChar, user.userName || '')
        .input('shopId', sql.Int, shopId)
        .input('shopName', sql.NVarChar, org.recordset[0].org_name || '')
        .input('level', sql.NVarChar, level)
        .input('schemeId', sql.Int, schemeId)
        .input('schemeName', sql.NVarChar, scheme.recordset[0].scheme_name || '')
        .query(`
          UPDATE onboarding_record
          SET status = 'graded', reviewer_code = @reviewer, reviewer_name = @reviewerName,
              review_time = GETDATE(), reject_reason = NULL,
              shop_id = @shopId, shop_name = @shopName, level = @level,
              salary_scheme_id = @schemeId, salary_scheme_name = @schemeName,
              grade_time = GETDATE(), update_time = GETDATE()
          WHERE id = @id
        `);
      // 已自动流转：管理层只读可见；同步推送行政专员（此处以 hr_staff/admin_staff 角色第一个有企微号者为例，站点内待办为准）
      return res.json({ ok: true, message: '初审通过，定级信息已提交，流程自动进入行政账号开通环节' });
    }

    return res.status(400).json({ message: '无效的操作类型' });
  } catch (e: any) {
    console.error('[Onboarding] 初审失败:', e.message);
    res.status(500).json({ message: '操作失败：' + (e.message || '未知错误') });
  }
});

// ============================================================
// 管理：阶段四 行政专员快速建用户（一键集成 4 项自动化/半自动化操作）
// body: { adminUserCode(可选), bojunAccount, groupQr, memberQr, password, confirm }
//  ① 创建系统后台用户（用户全 + sys_user_role 绑定店铺与职级角色）
//  ② 展示企微总群二维码（groupQr：URL 或说明文字）
//  ③ 录入绑定员工伯俊账号（bojunAccount）
//  ④ 展示店铺会员注册码（memberQr：URL 或说明文字）
//  confirm=true 时四项全部完成 → 状态 account_ready（账号开通完成，待下发）
// ============================================================
router.post('/records/:id/admin-open', authMiddleware, requireMenuPerm('baseInfo', 'onboarding'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '记录ID无效' });
  const body = req.body || {};
  const user: any = (req as any).user;
  // 行政/HR/系统管理员才可执行账号开通
  const roleCodes: string[] = (user.roleCodes || []).filter((c: any) => typeof c === 'string');
  if (!roleCodes.some((r) => ['admin_staff', 'hr_staff', 'hr', 'data_admin', 'super_admin', 'it'].includes(r))) {
    return res.status(403).json({ message: '仅行政专员/HR可执行快速建用户' });
  }

  try {
    const pool = await getPool();
    const found = await loadRecord(pool, id);
    if (found.recordset.length === 0) return res.status(404).json({ message: '记录不存在' });
    const row = found.recordset[0];
    if (!['graded', 'account_ready'].includes(row.status)) {
      return res.status(409).json({ message: '当前状态不可执行账号开通（需为已定级待开通）' });
    }
    if (!row.shop_id) return res.status(400).json({ message: '缺少定级店铺，无法开通账号' });

    const adminUserCode = String(body.adminUserCode || row.user_code || '').trim() || row.user_code;
    const bojunAccount = String(body.bojunAccount || '').trim();
    const groupQr = String(body.groupQr || '').trim();
    const memberQr = String(body.memberQr || '').trim();
    const memberCode = String(body.memberCode || '').trim();
    const password = String(body.password || '').trim() || '8888';
    const confirm = body.confirm === true;

    // ① 创建系统后台用户（若尚未创建）；已创建则跳过
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const exists = await tx.request().input('uc', sql.NVarChar, adminUserCode)
        .query(`SELECT TOP 1 用户代码 FROM 用户全 WHERE 用户代码 = @uc`);
      if (exists.recordset.length === 0) {
        await tx.request()
          .input('code', sql.NVarChar, adminUserCode)
          .input('name', sql.NVarChar, row.user_name)
          .input('phone', sql.NVarChar, row.phone || '')
          .input('pwd', sql.NVarChar, password)
          .input('org', sql.NVarChar, row.shop_name || '')
          .input('level', sql.NVarChar, row.level || '')
          .input('wechat', sql.NVarChar, '')
          .query(`
            INSERT INTO 用户全 (用户代码, 用户名称, 手机号, 管理员, 密码, 企微账号, 组织, 职位)
            VALUES (@code, @name, @phone, '否', @pwd, @wechat, @org, @level)
          `);
        // 绑定角色：职位 → 角色（sys_position.role_id，表驱动）；无则默认普通员工(10)；组织绑定定级店铺
        const posRole = await tx.request().input('pn', sql.NVarChar, row.level || '')
          .query(`SELECT role_id FROM sys_position WHERE position_name = @pn AND status = 1`);
        let roleId = 10;
        if (posRole.recordset.length > 0 && Number.isInteger(Number(posRole.recordset[0].role_id))) {
          roleId = Number(posRole.recordset[0].role_id);
        }
        const ur = await tx.request().input('uc', sql.NVarChar, adminUserCode).input('rid', sql.Int, roleId)
          .query(`SELECT id FROM sys_user_role WHERE user_code = @uc AND role_id = @rid`);
        if (ur.recordset.length > 0) {
          await tx.request().input('uc', sql.NVarChar, adminUserCode).input('rid', sql.Int, roleId).input('oid', sql.Int, row.shop_id)
            .query(`UPDATE sys_user_role SET org_id = @oid, update_time = GETDATE() WHERE user_code = @uc AND role_id = @rid`);
        } else {
          await tx.request().input('uc', sql.NVarChar, adminUserCode).input('rid', sql.Int, roleId).input('oid', sql.Int, row.shop_id)
            .query(`INSERT INTO sys_user_role (user_code, role_id, org_id) VALUES (@uc, @rid, @oid)`);
        }
      }
      // 记录四项开通信息
      const admin4 = JSON.stringify({
        accountCreated: true,
        userCode: adminUserCode,
        roleId: undefined,
        groupQr,
        bojunAccount,
        memberQr,
        memberCode,
        confirm,
        adminBy: user.userName || user.userCode || '',
      });
      await tx.request()
        .input('id', sql.Int, id)
        .input('uc2', sql.NVarChar, adminUserCode)
        .input('bojun', sql.NVarChar, bojunAccount)
        .input('groupQr', sql.NVarChar, groupQr)
        .input('memberQr', sql.NVarChar, memberQr)
        .input('memberCode', sql.NVarChar, memberCode)
        .input('admin4', sql.NVarChar, admin4)
        .input('finish', sql.Bit, confirm)
        .query(`
          UPDATE onboarding_record
          SET admin_user_code = @uc2, admin_bojun_account = @bojun,
              admin_group_qr = @groupQr, admin_member_qr = @memberQr,
              member_code = @memberCode,
              admin4_json = @admin4,
              admin_finish_time = CASE WHEN @finish = 1 THEN GETDATE() ELSE admin_finish_time END,
              status = CASE WHEN @finish = 1 THEN 'account_ready' ELSE status END,
              update_time = GETDATE()
          WHERE id = @id
        `);
      await tx.commit();
      // 四项完成后自动生成内购卡调整提醒（普卡 → 内购卡），携带手机号与会员代码
      if (confirm) {
        try {
          await insertCardAdjustReminder(pool, {
            userName: row.user_name,
            userCode: adminUserCode,
            phone: row.phone || '',
            memberCode,
            adjustType: 'normal_to_inner',
            reason: '新员工入职账号开通，需普卡转内购卡',
            submitter: user.userName || user.userCode || '',
          });
        } catch (cardErr: any) {
          console.error('[Onboarding] 内购卡调整提醒写入失败:', cardErr.message);
        }
      }
      res.json({
        ok: true,
        message: confirm
          ? '建档完成，员工入职成功（信息已进入转正管理「待入职」，已同步新增内购卡调整提醒）'
          : '开通信息已保存（四项未全部完成，待提交确认）',
        adminUserCode,
      });
    } catch (txErr: any) {
      await tx.rollback();
      throw txErr;
    }
  } catch (e: any) {
    console.error('[Onboarding] 快速建用户失败:', e.message);
    res.status(500).json({ message: '账号开通失败：' + (e.message || '未知错误') });
  }
});

// ============================================================
// 管理：阶段五 督导账号下发（account_ready → probation，自动进入 15 天转正考核期计时）
// 说明：建档完成后员工信息已进入转正管理「待入职」；由督导在转正管理中下发开启考核。
// ============================================================
router.post('/records/:id/issue', authMiddleware, requireAnyMenuPerm('baseInfo', ['onboarding', 'regularization']), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '记录ID无效' });
  try {
    const pool = await getPool();
    const found = await loadRecord(pool, id);
    if (found.recordset.length === 0) return res.status(404).json({ message: '记录不存在' });
    const row = found.recordset[0];
    if (row.status !== 'account_ready') return res.status(409).json({ message: '该记录不在「待入职」状态' });
    await pool.request()
      .input('id', sql.Int, id)
      .query(`
        UPDATE onboarding_record
        SET status = 'probation', issue_time = GETDATE(),
            probation_start = GETDATE(), probation_end = DATEADD(DAY, 15, GETDATE()),
            update_time = GETDATE()
        WHERE id = @id
      `);
    // 转正管理：下发账号后员工进入 15 天转正考核期（原「推动给新员工」逻辑已并入转正流程）
    res.json({ ok: true, message: '账号已下发，员工进入 15 天转正考核期（系统自动计时）' });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
});

// ============================================================
// 管理：阶段六 督导确认考核（probation → probation_passed，转正通过，展示【制作工牌/企微码】按钮）
// body: { result: 'pass' | 'fail', reason? }
// ============================================================
router.post('/records/:id/confirm-probation', authMiddleware, requireAnyMenuPerm('baseInfo', ['onboarding', 'regularization']), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '记录ID无效' });
  const body = req.body || {};
  const result = String(body.result || 'pass');
  const user: any = (req as any).user;
  try {
    const pool = await getPool();
    const found = await loadRecord(pool, id);
    if (found.recordset.length === 0) return res.status(404).json({ message: '记录不存在' });
    const row = found.recordset[0];
    if (row.status !== 'probation') return res.status(409).json({ message: '该记录不在考核期内' });
    if (result === 'fail') {
      const reason = String(body.reason || '').trim() || '15天考核未通过';
      await pool.request().input('id', sql.Int, id).input('by', sql.NVarChar, user.userName || user.userCode || '').input('reason', sql.NVarChar, reason)
        .query(`
          UPDATE onboarding_record
          SET status = 'rejected', probation_confirm_time = GETDATE(), probation_confirm_by = @by,
              reject_reason = @reason, update_time = GETDATE()
          WHERE id = @id
        `);
      return res.json({ ok: true, message: '考核不通过，转正流程终止，数据留存备查' });
    }
    await pool.request().input('id', sql.Int, id).input('by', sql.NVarChar, user.userName || user.userCode || '')
      .query(`
        UPDATE onboarding_record
        SET status = 'probation_passed', probation_confirm_time = GETDATE(), probation_confirm_by = @by,
            update_time = GETDATE()
        WHERE id = @id
      `);
    res.json({ ok: true, message: '考核通过，员工已转正，可制作工牌与企微码' });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
});

// ============================================================
// 管理：阶段六 督导提交工牌制作申请（probation_passed → badge_applied + 写工牌台账）
// body: { badgeNo, amount, wecomQr } —— wecomQr 为员工个人企微二维码（转正后制作企微码）
// ============================================================
router.post('/records/:id/apply-badge', authMiddleware, requireAnyMenuPerm('baseInfo', ['onboarding', 'regularization']), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '记录ID无效' });
  const body = req.body || {};
  const user: any = (req as any).user;
  try {
    const pool = await getPool();
    const found = await loadRecord(pool, id);
    if (found.recordset.length === 0) return res.status(404).json({ message: '记录不存在' });
    const row = found.recordset[0];
    if (row.status !== 'probation_passed') return res.status(409).json({ message: '该记录未通过考核或已提交工牌申请' });
    const badgeNo = String(body.badgeNo || '').trim();
    const amount = Number(body.amount);
    const wecomQr = String(body.wecomQr || '').trim();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await tx.request()
        .input('id', sql.Int, id)
        .input('badgeNo', sql.NVarChar, badgeNo)
        .input('amount', sql.Decimal(10, 2), Number.isFinite(amount) && amount > 0 ? amount : 0)
        .input('wecomQr', sql.NVarChar, wecomQr)
        .input('user', sql.NVarChar, user.userName || user.userCode || '')
        .query(`
          UPDATE onboarding_record
          SET status = 'badge_applied', badge_apply_time = GETDATE(), badge_no = @badgeNo,
              badge_amount = @amount, wecom_qr = @wecomQr, update_time = GETDATE()
          WHERE id = @id
        `);
      await tx.request()
        .input('rid', sql.Int, id)
        .input('applyNo', sql.NVarChar, row.apply_no)
        .input('userName', sql.NVarChar, row.user_name)
        .input('phone', sql.NVarChar, row.phone || '')
        .input('shopName', sql.NVarChar, row.shop_name || '')
        .input('level', sql.NVarChar, row.level || '')
        .input('badgeNo2', sql.NVarChar, badgeNo)
        .input('amount', sql.Decimal(10, 2), Number.isFinite(amount) && amount > 0 ? amount : 0)
        .query(`
          INSERT INTO onboarding_badge_ledger (record_id, apply_no, user_name, phone, shop_name, level, badge_no, status, amount)
          VALUES (@rid, @applyNo, @userName, @phone, @shopName, @level, @badgeNo2, 'pending', @amount)
        `);
      await tx.commit();
      res.json({ ok: true, message: '工牌及企微码制作申请已提交，已进入工牌制作统计台账' });
    } catch (txErr: any) {
      await tx.rollback();
      throw txErr;
    }
  } catch (e: any) {
    console.error('[Onboarding] 工牌申请失败:', e.message);
    res.status(500).json({ message: '工牌申请失败：' + (e.message || '未知错误') });
  }
});

// ============================================================
// 管理：工牌制作统计台账（阶段七，行政/财务共享查询）
// ============================================================
router.get('/badge-ledger', authMiddleware, requireMenuPerm('baseInfo', 'onboardingBadge'), async (req, res) => {
  try {
    const { status } = req.query;
    const pool = await getPool();
    let cond = '1=1';
    const params: { name: string; type: any; value: any }[] = [];
    if (typeof status === 'string' && ['pending', 'making', 'made', 'reimbursed'].includes(status)) {
      cond = 'b.status = @status';
      params.push({ name: 'status', type: sql.NVarChar, value: status });
    }
    const q = pool.request();
    params.forEach((p) => q.input(p.name, p.type, p.value));
    const r = await q.query(`
      SELECT b.*,
        (SELECT reimburse_no FROM onboarding_reimburse WHERE ledger_id = b.id) AS reimburse_no
      FROM onboarding_badge_ledger b
      WHERE ${cond}
      ORDER BY (CASE WHEN b.status = 'pending' THEN 0 WHEN b.status = 'making' THEN 1 ELSE 2 END), b.id DESC
    `);
    res.json({ ledgers: r.recordset.map((row: any) => ({
      id: row.id,
      recordId: row.record_id,
      applyNo: row.apply_no || '',
      userName: row.user_name || '',
      phone: row.phone || '',
      shopName: row.shop_name || '',
      level: row.level || '',
      badgeNo: row.badge_no || '',
      status: row.status || 'pending',
      maker: row.maker || '',
      amount: row.amount ?? null,
      reimburseNo: row.reimburse_no || '',
      applyTime: row.apply_time ? new Date(row.apply_time).toLocaleString('zh-CN', { hour12: false }) : '',
      submitMakeTime: row.submit_make_time ? new Date(row.submit_make_time).toLocaleString('zh-CN', { hour12: false }) : '',
      madeTime: row.made_time ? new Date(row.made_time).toLocaleString('zh-CN', { hour12: false }) : '',
      reimburseTime: row.reimburse_time ? new Date(row.reimburse_time).toLocaleString('zh-CN', { hour12: false }) : '',
      financeReviewer: row.finance_reviewer || '',
      remark: row.remark || '',
    })) });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
});

/** 生成工牌报销单号：RB+yyyyMMddHHmmss+3位随机 */
function genReimburseNo(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const rand = Math.floor(100 + Math.random() * 900);
  return `RB${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${rand}`;
}

// ============================================================
// 管理：阶段七 行政提交广告公司制作（spec 制作 → 自动生成报销单 → badge_making）
// body: { maker, amount, remark }
// ============================================================
router.post('/badge-ledger/:id/submit-making', authMiddleware, requireMenuPerm('baseInfo', 'onboardingBadge'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '台账ID无效' });
  const body = req.body || {};
  const user: any = (req as any).user;
  // 行政/HR/系统管理员才可提交广告公司制作
  const roleCodes: string[] = (user.roleCodes || []).filter((c: any) => typeof c === 'string');
  if (!roleCodes.some((r) => ['admin_staff', 'hr_staff', 'hr', 'data_admin', 'super_admin', 'it'].includes(r))) {
    return res.status(403).json({ message: '仅行政专员/HR可提交工牌制作' });
  }
  try {
    const pool = await getPool();
    const led = await pool.request().input('id', sql.Int, id)
      .query(`SELECT * FROM onboarding_badge_ledger WHERE id = @id`);
    if (led.recordset.length === 0) return res.status(404).json({ message: '台账记录不存在' });
    const row = led.recordset[0];
    if (row.status !== 'pending') return res.status(409).json({ message: '该工牌不在待制作状态' });
    const maker = String(body.maker || '').trim();
    const amount = Number(body.amount);
    const finalAmount = Number.isFinite(amount) && amount > 0 ? amount : (row.amount ?? 0);
    const reimburseNo = genReimburseNo();

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await tx.request()
        .input('id', sql.Int, id)
        .input('maker', sql.NVarChar, maker)
        .input('amount', sql.Decimal(10, 2), finalAmount)
        .input('remark', sql.NVarChar, String(body.remark || '').trim())
        .query(`
          UPDATE onboarding_badge_ledger
          SET status = 'making', maker = @maker, amount = @amount,
              submit_make_time = GETDATE(), remark = @remark, update_time = GETDATE()
          WHERE id = @id
        `);
      await tx.request()
        .input('ledgerId', sql.Int, id)
        .input('recordId', sql.Int, row.record_id)
        .input('reimburseNo', sql.NVarChar, reimburseNo)
        .input('amount2', sql.Decimal(10, 2), finalAmount)
        .query(`
          INSERT INTO onboarding_reimburse (ledger_id, record_id, reimburse_no, amount, status)
          VALUES (@ledgerId, @recordId, @reimburseNo, @amount2, 'pending')
        `);
      await tx.request()
        .input('recordId', sql.Int, row.record_id)
        .query(`
          UPDATE onboarding_record
          SET status = 'badge_making', update_time = GETDATE()
          WHERE id = @recordId
        `);
      await tx.commit();
      res.json({ ok: true, message: `已提交广告公司制作，工牌报销单 ${reimburseNo} 已自动生成并流转至财务审批` });
    } catch (txErr: any) {
      await tx.rollback();
      throw txErr;
    }
  } catch (e: any) {
    console.error('[Onboarding] 提交广告公司制作失败:', e.message);
    res.status(500).json({ message: '提交失败：' + (e.message || '未知错误') });
  }
});

// ============================================================
// 管理：批量提交广告公司制作（台账勾选多条 → 统一广告公司、逐条金额 → 每人生成报销单 → badge_making）
// body: { ids: number[], maker: string, amounts: { [ledgerId]: number }, remark?: string }
// ============================================================
router.post('/badge-ledger/batch-submit-making', authMiddleware, requireMenuPerm('baseInfo', 'onboardingBadge'), async (req, res) => {
  const body = req.body || {};
  const ids: number[] = Array.isArray(body.ids) ? body.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : [];
  if (ids.length === 0) return res.status(400).json({ message: '请先勾选需要制作工牌的记录' });
  if (ids.length > 100) return res.status(400).json({ message: '单次批量制作最多 100 条' });
  const user: any = (req as any).user;
  // 行政/HR/系统管理员才可提交广告公司制作
  const roleCodes: string[] = (user.roleCodes || []).filter((c: any) => typeof c === 'string');
  if (!roleCodes.some((r) => ['admin_staff', 'hr_staff', 'hr', 'data_admin', 'super_admin', 'it'].includes(r))) {
    return res.status(403).json({ message: '仅行政专员/HR可提交工牌制作' });
  }
  const maker = String(body.maker || '').trim();
  if (!maker) return res.status(400).json({ message: '请填写广告公司名称' });
  const rawAmounts: Record<number, number> = {};
  (Object.keys(body.amounts || {}) as string[]).forEach((k) => {
    const key = Number(k);
    if (Number.isInteger(key) && key > 0) rawAmounts[key] = Number(body.amounts[k]);
  });
  try {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    const doneNos: string[] = [];
    const failed: string[] = [];
    try {
      for (const id of ids) {
        const led = await tx.request().input('id', sql.Int, id)
          .query(`SELECT * FROM onboarding_badge_ledger WHERE id = @id`);
        if (led.recordset.length === 0) { failed.push(`台账#${id}不存在`); continue; }
        const row = led.recordset[0];
        if (row.status !== 'pending') { failed.push(`${row.user_name || '#' + id} 不在待制作状态`); continue; }
        const amount = Number(rawAmounts[id]);
        const finalAmount = Number.isFinite(amount) && amount > 0 ? amount : (row.amount ?? 0);
        if (finalAmount <= 0) { failed.push(`${row.user_name || '#' + id} 制作费用无效`); continue; }
        const reimburseNo = genReimburseNo();

        await tx.request()
          .input('id', sql.Int, id)
          .input('maker', sql.NVarChar, maker)
          .input('amount', sql.Decimal(10, 2), finalAmount)
          .input('remark', sql.NVarChar, String(body.remark || '').trim())
          .query(`
            UPDATE onboarding_badge_ledger
            SET status = 'making', maker = @maker, amount = @amount,
                submit_make_time = GETDATE(), remark = @remark, update_time = GETDATE()
            WHERE id = @id
          `);
        await tx.request()
          .input('ledgerId', sql.Int, id)
          .input('recordId', sql.Int, row.record_id)
          .input('reimburseNo', sql.NVarChar, reimburseNo)
          .input('amount2', sql.Decimal(10, 2), finalAmount)
          .query(`
            INSERT INTO onboarding_reimburse (ledger_id, record_id, reimburse_no, amount, status)
            VALUES (@ledgerId, @recordId, @reimburseNo, @amount2, 'pending')
          `);
        await tx.request()
          .input('recordId', sql.Int, row.record_id)
          .query(`
            UPDATE onboarding_record
            SET status = 'badge_making', update_time = GETDATE()
            WHERE id = @recordId
          `);
        doneNos.push(reimburseNo);
      }
      if (doneNos.length === 0) {
        await tx.rollback();
        return res.status(409).json({ message: '批量提交未成功：' + failed.join('；') });
      }
      await tx.commit();
      const suffix = failed.length > 0 ? `；跳过 ${failed.length} 条（${failed.join('；')}）` : '';
      res.json({ ok: true, message: `已批量提交 ${doneNos.length} 条工牌制作，报销单已自动生成并流转财务审批${suffix}` });
    } catch (txErr: any) {
      await tx.rollback();
      throw txErr;
    }
  } catch (e: any) {
    console.error('[Onboarding] 批量提交广告公司制作失败:', e.message);
    res.status(500).json({ message: '批量提交失败：' + (e.message || '未知错误') });
  }
});

// ============================================================
// 管理：财务报销单列表（pending/approved/settled）
// ============================================================
router.get('/reimburse', authMiddleware, requireMenuPerm('baseInfo', 'onboardingBadge'), async (req, res) => {
  try {
    const { status } = req.query;
    const pool = await getPool();
    let cond = '1=1';
    const params: { name: string; type: any; value: any }[] = [];
    if (typeof status === 'string' && ['pending', 'approved', 'settled'].includes(status)) {
      cond = 'r.status = @status';
      params.push({ name: 'status', type: sql.NVarChar, value: status });
    }
    const q = pool.request();
    params.forEach((p) => q.input(p.name, p.type, p.value));
    const r = await q.query(`
      SELECT r.*, o.user_name, o.apply_no, o.shop_name, b.badge_no
      FROM onboarding_reimburse r
      LEFT JOIN onboarding_record o ON r.record_id = o.id
      LEFT JOIN onboarding_badge_ledger b ON r.ledger_id = b.id
      WHERE ${cond}
      ORDER BY (CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END), r.id DESC
    `);
    res.json({ reimburses: r.recordset.map((row: any) => ({
      id: row.id,
      ledgerId: row.ledger_id,
      recordId: row.record_id,
      reimburseNo: row.reimburse_no || '',
      amount: row.amount ?? 0,
      status: row.status || 'pending',
      applyTime: row.apply_time ? new Date(row.apply_time).toLocaleString('zh-CN', { hour12: false }) : '',
      financeReviewer: row.finance_reviewer || '',
      financeReviewTime: row.finance_review_time ? new Date(row.finance_review_time).toLocaleString('zh-CN', { hour12: false }) : '',
      userName: row.user_name || '',
      applyNo: row.apply_no || '',
      shopName: row.shop_name || '',
      badgeNo: row.badge_no || '',
      remark: row.remark || '',
    })) });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
});

// ============================================================
// 管理：财务审核/核销报销单（settled → 主记录 completed 全流程闭环）
// body: { action: 'approve'|'reject', remark }
// ============================================================
router.post('/reimburse/:id/finance-review', authMiddleware, requireMenuPerm('baseInfo', 'onboardingBadge'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '报销单ID无效' });
  const body = req.body || {};
  const action = String(body.action || '');
  const user: any = (req as any).user;
  // 财务/系统管理员才可审核核销报销单
  const roleCodes: string[] = (user.roleCodes || []).filter((c: any) => typeof c === 'string');
  if (!roleCodes.some((r) => ['finance', 'finance_staff', 'cashier', 'data_admin', 'super_admin', 'it'].includes(r))) {
    return res.status(403).json({ message: '仅财务可审核核销报销单' });
  }
  try {
    const pool = await getPool();
    const rb = await pool.request().input('id', sql.Int, id)
      .query(`SELECT * FROM onboarding_reimburse WHERE id = @id`);
    if (rb.recordset.length === 0) return res.status(404).json({ message: '报销单不存在' });
    const row = rb.recordset[0];
    if (row.status !== 'pending') return res.status(409).json({ message: '该报销单已处理' });

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      if (action === 'reject') {
        await tx.request().input('id', sql.Int, id).input('rev', sql.NVarChar, user.userName || user.userCode || '').input('remark', sql.NVarChar, String(body.remark || '驳回').trim())
          .query(`
            UPDATE onboarding_reimburse
            SET status = 'pending', finance_reviewer = @rev, finance_review_time = GETDATE(), remark = @remark
            WHERE id = @id
          `);
        await tx.commit();
        return res.json({ ok: true, message: '已驳回报销单（保持待审核，可重新处理）' });
      }
      if (action !== 'approve') return res.status(400).json({ message: '无效操作' });
      // 核销：报销单 settled + 台账 reimbursed + 主记录 completed
      await tx.request().input('id', sql.Int, id).input('rev', sql.NVarChar, user.userName || user.userCode || '')
        .query(`
          UPDATE onboarding_reimburse
          SET status = 'settled', finance_reviewer = @rev, finance_review_time = GETDATE()
          WHERE id = @id
        `);
      await tx.request().input('ledgerId', sql.Int, row.ledger_id)
        .query(`
          UPDATE onboarding_badge_ledger
          SET status = 'reimbursed', reimburse_time = GETDATE(), finance_reviewer = @rev, update_time = GETDATE()
          WHERE id = @ledgerId
        `)
        .catch(() => {});
      await tx.request().input('recordId', sql.Int, row.record_id)
        .query(`
          UPDATE onboarding_record
          SET status = 'completed', update_time = GETDATE()
          WHERE id = @recordId
        `);
      await tx.commit();
      res.json({ ok: true, message: '报销单已核销，转正流程全部完成（全流程闭环留痕）' });
    } catch (txErr: any) {
      await tx.rollback();
      throw txErr;
    }
  } catch (e: any) {
    console.error('[Onboarding] 财务核销失败:', e.message);
    res.status(500).json({ message: '操作失败：' + (e.message || '未知错误') });
  }
});

// ============================================================
// 管理：内购卡调整提醒（自动写入，无手动新增入口）
//  - 入职侧：行政快速建用户提交确认后自动写入 normal_to_inner（普卡 → 内购卡）
//  - 离职侧：离职流程完成后由离职模块调用 insertCardAdjustReminder 自动写入
//    inner_to_normal（内购卡 → 普卡），本模块仅提供列表与查询，不做手动新增
// ============================================================

/**
 * 自动写入内购卡调整提醒（供入职/离职流程调用，幂等可重入）
 * @param pool  已连接的 mssql 连接池
 * @param data  userName 员工姓名（必填）、userCode 系统账号可选、adjustType（normal_to_inner/inner_to_normal 必填）、reason 说明、submitter 提交人
 * @returns 写入成功返回 true；校验不通过或写入异常抛错
 */
export async function insertCardAdjustReminder(
  pool: sql.ConnectionPool,
  data: {
    userName: string; userCode?: string; phone?: string; memberCode?: string;
    adjustType: 'normal_to_inner' | 'inner_to_normal'; reason?: string; submitter?: string;
  },
): Promise<boolean> {
  const userName = String(data.userName || '').trim();
  if (!userName) throw new Error('内购卡调整提醒缺少员工姓名');
  if (!['normal_to_inner', 'inner_to_normal'].includes(data.adjustType)) {
    throw new Error('内购卡调整提醒类型无效');
  }
  await pool.request()
    .input('userName', sql.NVarChar, userName)
    .input('userCode', sql.NVarChar, String(data.userCode || '').trim())
    .input('phone', sql.NVarChar, String(data.phone || '').trim())
    .input('memberCode', sql.NVarChar, String(data.memberCode || '').trim())
    .input('adjustType', sql.NVarChar, data.adjustType)
    .input('reason', sql.NVarChar, String(data.reason || '').trim())
    .input('submitter', sql.NVarChar, String(data.submitter || '').trim())
    .query(`
      INSERT INTO onboarding_card_adjust (user_name, user_code, phone, member_code, adjust_type, reason, submitter, status)
      VALUES (@userName, @userCode, @phone, @memberCode, @adjustType, @reason, @submitter, 'pending')
    `);
  return true;
}

// ============================================================
// 管理：内购卡调整提醒（列表；仅展示自动生成的记录）
// ============================================================
router.get('/card-adjust', authMiddleware, requireMenuPerm('baseInfo', 'onboardingCardAdjust'), async (req, res) => {
  try {
    const { status } = req.query;
    const pool = await getPool();
    let cond = '1=1';
    const params: { name: string; type: any; value: any }[] = [];
    if (typeof status === 'string' && ['pending', 'done'].includes(status)) {
      cond = 'c.status = @status';
      params.push({ name: 'status', type: sql.NVarChar, value: status });
    }
    const q = pool.request();
    params.forEach((p) => q.input(p.name, p.type, p.value));
    const r = await q.query(`
      SELECT * FROM onboarding_card_adjust c WHERE ${cond} ORDER BY (CASE WHEN c.status='pending' THEN 0 ELSE 1 END), c.id DESC
    `);
    res.json({ adjusts: r.recordset.map((row: any) => ({
      id: row.id,
      userName: row.user_name || '',
      userCode: row.user_code || '',
      phone: row.phone || '',
      memberCode: row.member_code || '',
      adjustType: row.adjust_type || '',
      adjustTypeLabel: row.adjust_type === 'normal_to_inner' ? '新员工普卡转内购卡' : row.adjust_type === 'inner_to_normal' ? '离职内购卡转普卡' : row.adjust_type || '',
      reason: row.reason || '',
      submitter: row.submitter || '',
      status: row.status || 'pending',
      handler: row.handler || '',
      handleTime: row.handle_time ? new Date(row.handle_time).toLocaleString('zh-CN', { hour12: false }) : '',
      remark: row.remark || '',
      createTime: row.create_time ? new Date(row.create_time).toLocaleString('zh-CN', { hour12: false }) : '',
    })) });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
});

// ============================================================
// 管理：内购卡调整「确认已处理」（会员专员在会员系统完成普卡↔内购卡调整后回填状态）
// body: { remark? }
// ============================================================
router.post('/card-adjust/:id/mark-done', authMiddleware, requireMenuPerm('baseInfo', 'onboardingCardAdjust'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '记录ID无效' });
  const user: any = (req as any).user;
  const remark = String((req.body || {}).remark || '').trim();
  try {
    const pool = await getPool();
    const found = await pool.request().input('id', sql.Int, id)
      .query(`SELECT id, status FROM onboarding_card_adjust WHERE id = @id`);
    if (found.recordset.length === 0) return res.status(404).json({ message: '调整记录不存在' });
    if (found.recordset[0].status === 'done') return res.status(409).json({ message: '该记录已标记为已处理' });
    const q = pool.request()
      .input('id', sql.Int, id)
      .input('handler', sql.NVarChar, user.userName || user.userCode || '')
      .input('remark', sql.NVarChar, remark);
    await q.query(`
      UPDATE onboarding_card_adjust
      SET status = 'done', handle_time = GETDATE(), handler = @handler,
          remark = CASE WHEN @remark = '' THEN remark ELSE @remark END,
          update_time = GETDATE()
      WHERE id = @id
    `);
    res.json({ ok: true, message: '已确认处理' });
  } catch (e: any) {
    console.error('[Onboarding] 内购卡调整确认处理失败:', e.message);
    res.status(500).json({ message: '确认失败：' + (e.message || '未知错误') });
  }
});

// ============================================================
// 管理：超时台账（第3天预警 / 第7天超时 / 15天考核到期，管理员与督导可查）
// ============================================================
router.get('/timeout-logs', authMiddleware, requireMenuPerm('baseInfo', 'onboarding'), async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT t.*, r.user_name, r.supervisor_name FROM onboarding_timeout_log t
      LEFT JOIN onboarding_record r ON t.record_id = r.id
      ORDER BY t.id DESC
    `);
    res.json({ logs: r.recordset.map((row: any) => ({
      id: row.id,
      recordId: row.record_id,
      applyNo: row.apply_no || '',
      warnType: row.warn_type || '',
      warnTypeLabel: row.warn_type === 'day3' ? '第3天预警' : row.warn_type === 'day7' ? '第7天超时台账' : row.warn_type === 'probation_due' ? '15天转正考核到期' : row.warn_type || '',
      warnTime: row.warn_time ? new Date(row.warn_time).toLocaleString('zh-CN', { hour12: false }) : '',
      content: row.content || '',
      userName: row.user_name || '',
      supervisorName: row.supervisor_name || '',
    })) });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
});

// ============================================================
// 定时任务：入职时效管控（每分钟扫描）
//  - 第 3 天：待督导初审超 3 天未审 → 推送提醒 + 台账 day3（幂等，day3_warned 标记）
//  - 第 7 天：超 7 天未审 → 自动台账 day7（幂等，day7_logged 标记）并推送督导
//  - 考核期到：status=probation 且 probation_end <= now → 台账 probation_due + 推送督导
// ============================================================
async function checkOnboardingTimeouts() {
  const pool = await getPool();
  // 第 3 天预警
  try {
    const warn = await pool.request().query(`
      SELECT TOP 50 id, apply_no, user_name, supervisor_code FROM onboarding_record
      WHERE status = 'pending_review' AND day3_warned = 0 AND DATEDIFF(DAY, create_time, GETDATE()) >= 3
        AND DATEDIFF(DAY, create_time, GETDATE()) < 7
    `);
    for (const r of warn.recordset) {
      await pool.request()
        .input('rid', sql.Int, r.id)
        .input('applyNo', sql.NVarChar, r.apply_no)
        .input('userName', sql.NVarChar, r.user_name)
        .query(`
          INSERT INTO onboarding_timeout_log (record_id, apply_no, user_name, warn_type, content)
          VALUES (@rid, @applyNo, @userName, 'day3', '入职申请提交已满 3 天，请督导尽快完成初审（期限 7 个自然日）')
        `).catch(() => {});
      await pool.request().input('id', sql.Int, r.id).query(`
        UPDATE onboarding_record SET day3_warned = 1, update_time = GETDATE() WHERE id = @id
      `);
      await notifyUserByCode(pool, r.supervisor_code, '入职初审超时预警',
        `【入职初审预警】员工 ${r.user_name}（${r.apply_no}）初审已超 3 天，请尽快处理，第 7 天将自动记录超时台账。`);
    }
  } catch (e: any) {
    console.error('[Onboarding] 第3天预警扫描失败:', e.message);
  }

  // 第 7 天超时自动台账
  try {
    const overdue = await pool.request().query(`
      SELECT TOP 50 id, apply_no, user_name, supervisor_code, day7_logged FROM onboarding_record
      WHERE status = 'pending_review' AND day7_logged = 0 AND DATEDIFF(DAY, create_time, GETDATE()) >= 7
    `);
    for (const r of overdue.recordset) {
      await pool.request()
        .input('rid', sql.Int, r.id)
        .input('applyNo', sql.NVarChar, r.apply_no)
        .input('userName', sql.NVarChar, r.user_name)
        .query(`
          INSERT INTO onboarding_timeout_log (record_id, apply_no, user_name, warn_type, content)
          VALUES (@rid, @applyNo, @userName, 'day7', '入职申请提交已满 7 天仍未初审，自动记录超时台账')
        `).catch(() => {});
      await pool.request().input('id', sql.Int, r.id)
        .query(`UPDATE onboarding_record SET day7_logged = 1, update_time = GETDATE() WHERE id = @id`);
      await notifyUserByCode(pool, r.supervisor_code, '入职初审超时台账',
        `【入职初审超时】员工 ${r.user_name}（${r.apply_no}）已超 7 天未初审，系统已自动记录超时台账，请立即处理。`);
    }
  } catch (e: any) {
    console.error('[Onboarding] 第7天超时扫描失败:', e.message);
  }

  // 15 天考核期到期（probation 超期未确认 → 台账 + 推送督导）
  try {
    const due = await pool.request().query(`
      SELECT TOP 50 r.id, r.apply_no, r.user_name, r.supervisor_code
      FROM onboarding_record r
      WHERE r.status = 'probation' AND r.probation_end IS NOT NULL AND r.probation_end <= GETDATE()
        AND NOT EXISTS (SELECT 1 FROM onboarding_timeout_log t WHERE t.record_id = r.id AND t.warn_type = 'probation_due')
    `);
    for (const r of due.recordset) {
      await pool.request()
        .input('rid', sql.Int, r.id)
        .input('applyNo', sql.NVarChar, r.apply_no)
        .input('userName', sql.NVarChar, r.user_name)
        .query(`
          INSERT INTO onboarding_timeout_log (record_id, apply_no, user_name, warn_type, content)
          VALUES (@rid, @applyNo, @userName, 'probation_due', '15 天转正考核期已满，请督导确认考核结果并进入工牌/企微码环节')
        `).catch(() => {});
      await notifyUserByCode(pool, r.supervisor_code, '转正考核期到期',
        `【考核期到期】员工 ${r.user_name}（${r.apply_no}）15 天转正考核期已满，请确认考核结果。`);
    }
  } catch (e: any) {
    console.error('[Onboarding] 考核期到期扫描失败:', e.message);
  }
}

/** 启动入职时效管控定时器（每分钟扫描，幂等可重复调用） */
export function startOnboardingScheduler(): void {
  setInterval(() => {
    checkOnboardingTimeouts().catch((e) => console.error('[Onboarding] 定时扫描异常:', e?.message));
  }, 60 * 1000);
  console.log('[Onboarding] 入职时效管控定时服务已启动（每分钟扫描）');
}

export default router;