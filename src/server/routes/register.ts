import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireMenuPerm } from '../middlewares/menuPermMiddleware';
import { ensureAdminOrgBinding } from '../services/adminOrgSync';

/**
 * 注册审核：登录页「前往注册」→ 提交申请（系统自建工号 RGxxxxx）→
 * 管理员在系统管理「注册审核」页查看/通过/拒绝 → 通过后直接插入 用户全 + sys_user_role
 *
 * 公开接口（无需登录）：GET /options、POST /apply
 * 管理接口（authMiddleware + requireMenuPerm('baseInfo','registerAudit')）：
 *   GET /applications、POST /applications/:id/approve、POST /applications/:id/reject、
 *   POST /applications/:id/supplement（补充资料：补齐用户管理中用户需填写的全部字段）
 */
const router = Router();

const VALID_STATUS = ['pending', 'approved', 'rejected'] as const;

// 默认审核通过时分配的角色：普通员工（sys_role.role_id=10）
const DEFAULT_ROLE_ID = 10;

/** 手机号校验：11 位大陆手机号 */
function isValidPhone(p: string): boolean {
  return /^1\d{10}$/.test(p);
}

/**
 * 系统自建工号：RG + 5 位序号（在 register_apply 与 用户全 中均未出现过）
 * 例如 RG00001、RG00002 ...
 */
async function genUserCode(pool: sql.ConnectionPool): Promise<string> {
  const r = await pool.request().query(`
    SELECT MAX(CAST(SUBSTRING(code, 3, LEN(code)) AS INT)) AS maxNo FROM (
      SELECT user_code AS code FROM register_apply WHERE user_code LIKE 'RG[0-9]%'
      UNION ALL
      SELECT 用户代码 AS code FROM 用户全 WHERE 用户代码 LIKE 'RG[0-9]%'
    ) t
  `);
  let no = 1;
  const cur = r.recordset[0]?.maxNo;
  if (cur !== null && cur !== undefined) no = Number(cur) + 1;
  return 'RG' + String(no).padStart(5, '0');
}

/** 生成申请编号 RA+yyyyMMddHHmmss+3位随机 */
function genApplyNo(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const rand = Math.floor(100 + Math.random() * 900);
  return `RA${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${rand}`;
}

/** 拒绝/通过的公共校验：申请存在且为 pending */
async function loadPendingApplication(pool: sql.ConnectionPool, id: number) {
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT * FROM register_apply WHERE id = @id`);
  if (r.recordset.length === 0) return null;
  const row = r.recordset[0];
  if (row.status !== 'pending') return { error: '该申请已审核，不能重复操作', row };
  return { error: null, row };
}

function normalizeApply(row: any) {
  return {
    id: row.id,
    applyNo: row.apply_no || '',
    userCode: row.user_code || '',
    userName: row.user_name || '',
    phone: row.phone || '',
    warehouseType: row.warehouse_type || '',
    orgId: row.org_id ?? null,
    orgName: row.org_name || '',
    status: row.status || 'pending',
    rejectReason: row.reject_reason || '',
    approver: row.approver || '',
    approverName: row.approver_name || '',
    approveTime: row.approve_time ? new Date(row.approve_time).toLocaleString('zh-CN', { hour12: false }) : '',
    createTime: row.create_time ? new Date(row.create_time).toLocaleString('zh-CN', { hour12: false }) : '',
    // 补充资料字段（与「用户管理」用户全表可编辑字段对应；岗位已下线，register_apply.post 保留列不再读写）
    position: row.position || '',
    wechatAccount: row.wechat_account || '',
    store: row.store || '',
    isAdmin: row.admin_flag || '',
    password: row.password || '',
  };
}

// ============================================================
// 公开：下拉数据源（仓库类别 + 组织树精简版）
// ============================================================
router.get('/options', async (_req, res) => {
  try {
    const pool = await getPool();
    // 仓库类别：与用户全表实际使用值保持一致
    const wt = await pool.request().query(`
      SELECT DISTINCT 仓库类别 FROM 用户全
      WHERE 仓库类别 IS NOT NULL AND 仓库类别 <> ''
      ORDER BY 仓库类别
    `);
    const warehouseTypes = wt.recordset.map((r: any) => r['仓库类别']);
    // 组织树：全量有效节点（含层级，前端按 orgLevel 缩进展示）
    const org = await pool.request().query(`
      SELECT org_id, org_name, org_type, org_level, ancestors, warehouse_type
      FROM sys_org WHERE del_flag = 0
      ORDER BY org_level, org_id
    `);
    const orgs = org.recordset.map((r: any) => ({
      orgId: r.org_id,
      orgName: r.org_name || '',
      orgType: r.org_type || '',
      orgLevel: r.org_level ?? 1,
      warehouseType: r.warehouse_type || '',
    }));
    res.json({ warehouseTypes, orgs });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 公开：注册引导候选过滤（方案 v4）
// scope: shop 门店 | dealer 经销商组 | supervisor 区经/督导 | func 公司职能岗
// 无匹配一律返回空列表，由前端提示重新输入 / 联系管理员
// ============================================================
function mapOrgCandidate(r: any) {
  return {
    orgId: r.org_id,
    orgName: r.org_name || '',
    orgType: r.org_type || '',
    orgLevel: r.org_level ?? 1,
    warehouseType: r.warehouse_type || '',
  };
}

router.get('/guide/candidates', async (req, res) => {
  try {
    const q = req.query || {};
    const scope = String(q.scope || '');
    const warehouseType = String(q.warehouseType || '').trim();
    const region = String(q.region || '').trim();
    const dealerName = String(q.dealerName || '').trim();
    const funcDir = String(q.funcDir || '').trim();
    const level = String(q.level || '').trim();
    const pool = await getPool();
    const out: { candidates: any[] } = { candidates: [] };

    if (scope === 'shop') {
      // 门店候选：仓库类别 + 区域关键词（门店名带城市/县域前缀）
      const r = await pool.request()
        .input('wt', sql.NVarChar, warehouseType || '')
        .input('kw', sql.NVarChar, region || '')
        .query(`
          SELECT TOP 20 org_id, org_name, org_type, org_level, warehouse_type
          FROM sys_org
          WHERE del_flag = 0 AND org_type = 'shop'
            AND (@wt = '' OR warehouse_type = @wt)
            AND (@kw = '' OR org_name LIKE '%' + @kw + '%')
          ORDER BY org_level, org_id
        `);
      out.candidates = r.recordset.map(mapOrgCandidate);
    } else if (scope === 'dealer') {
      // 经销商组候选：老板姓名 → 「经销商_老板姓名」节点（2 个非姓名命名节点不参与）
      const name = String(dealerName || '').trim();
      if (name) {
        const r = await pool.request()
          .input('name', sql.NVarChar, name)
          .query(`
            SELECT TOP 20 org_id, org_name, org_type, org_level, warehouse_type
            FROM sys_org
            WHERE del_flag = 0 AND org_type = 'dealer_group'
              AND org_name LIKE '经销商\\_%' ESCAPE '\\'
              AND org_name LIKE '%' + @name + '%'
            ORDER BY org_level, org_id
          `);
        out.candidates = r.recordset.map(mapOrgCandidate);
      }
    } else if (scope === 'supervisor') {
      // 区经/督导候选：区域关键词在其下辖门店名中反查（区经/督导节点名不含区域）
      const role = String(q.role || '').trim();
      const lvl = role === '督导' ? 5 : 4;
      const orgType = lvl === 5 ? 'supervisor_group' : 'group';
      if (region) {
        const r = await pool.request()
          .input('kw', sql.NVarChar, region)
          .input('lvl', sql.Int, lvl)
          .input('t', sql.NVarChar, orgType)
          .query(`
            WITH chain AS (
              SELECT org_id, parent_org_id, org_name, org_type, org_level, warehouse_type
              FROM sys_org
              WHERE org_id IN (
                SELECT org_id FROM sys_org
                WHERE del_flag = 0 AND org_type = 'shop' AND org_name LIKE '%' + @kw + '%'
              )
              UNION ALL
              SELECT o.org_id, o.parent_org_id, o.org_name, o.org_type, o.org_level, o.warehouse_type
              FROM sys_org o
              JOIN chain c ON o.org_id = c.parent_org_id
            )
            SELECT DISTINCT TOP 20 org_id, org_name, org_type, org_level, warehouse_type
            FROM chain
            WHERE org_level = @lvl AND org_type = @t
            ORDER BY org_id
          `);
        out.candidates = r.recordset.map(mapOrgCandidate);
      }
    } else if (scope === 'func') {
      // 公司职能岗候选：职能方向关键词 + 总监(L2 director)/专员(L3 group)
      // 按仓库类别过滤仅对运营/会员/商品/财务生效（与组织树这些方向存在 直营/加盟/山东直营 拆分一致）
      const DIR_KEYWORDS: Record<string, string[]> = {
        运营: ['运营'],
        财务: ['财务', '出纳'],
        人事: ['人事'],
        会员: ['会员'],
        商品: ['商品'],
        采购: ['采购'],
        稽查: ['稽查'],
        数据: ['数据'],
        其他: ['IT', '行政', '联营'],
      };
      const FILTER_FUNC_DIRS = new Set(['运营', '会员', '商品', '财务']);
      const needWtFilter = FILTER_FUNC_DIRS.has(funcDir) && !!warehouseType;
      const kws = (DIR_KEYWORDS[funcDir] || []).filter(k => k);
      const lvl = level === '专员' ? 3 : level === '总监' ? 2 : null;
      if (kws.length > 0 && lvl !== null) {
        const q2 = pool.request();
        const conds = kws.map((k, i) => {
          q2.input('k' + i, sql.NVarChar, k);
          return `org_name LIKE '%' + @k${i} + '%'`;
        });
        q2.input('lvl', sql.Int, lvl);
        q2.input('wt', sql.NVarChar, warehouseType || '');
        const r = await q2.query(`
          SELECT TOP 40 org_id, org_name, org_type, org_level, warehouse_type
          FROM sys_org
          WHERE del_flag = 0 AND org_level = @lvl AND org_type IN ('director','group')
            AND (${conds.join(' OR ')})
            ${needWtFilter ? `AND warehouse_type = @wt` : ''}
          ORDER BY org_id
        `);
        out.candidates = r.recordset.map(mapOrgCandidate);
      }
    }

    res.json(out);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 公开：手机号注册状态检查（用户输入手机号时提前拦截）
// ============================================================
router.get('/check-phone', async (req, res) => {
  try {
    const ph = String((req.query as any).phone || '').trim();
    if (!isValidPhone(ph)) return res.json({ status: 'invalid' });
    const pool = await getPool();
    // 用户全 已有用户
    const dupUser = await pool.request().input('ph', sql.NVarChar, ph)
      .query(`SELECT TOP 1 用户代码 FROM 用户全 WHERE 手机号 = @ph`);
    if (dupUser.recordset.length > 0) return res.json({ status: 'exists' });
    // register_apply 已有申请
    const dupApply = await pool.request().input('ph', sql.NVarChar, ph)
      .query(`SELECT TOP 1 id, status FROM register_apply WHERE phone = @ph`);
    if (dupApply.recordset.length > 0) {
      const st = dupApply.recordset[0].status;
      if (st === 'pending') return res.json({ status: 'pending' });
      if (st === 'approved') return res.json({ status: 'approved' });
      return res.json({ status: 'rejected' });
    }
    res.json({ status: 'ok' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 公开：提交注册申请（自动生成工号，落待审表）
// ============================================================
router.post('/apply', async (req, res) => {
  try {
    const { userName, phone, warehouseType, orgId, position } = req.body || {};
    const name = String(userName || '').trim();
    const ph = String(phone || '').trim();
    const wt = String(warehouseType || '').trim();
    const oid = Number.isInteger(Number(orgId)) ? Number(orgId) : null;
    const pos = String(position || '').trim();

    if (!name) return res.status(400).json({ message: '请填写姓名' });
    if (!isValidPhone(ph)) return res.status(400).json({ message: '请填写正确的 11 位手机号' });
    if (!wt) return res.status(400).json({ message: '请选择仓库类别' });
    if (!oid) return res.status(400).json({ message: '请选择组织' });

    const pool = await getPool();

    // 组织有效性校验
    const orgR = await pool.request().input('oid', sql.Int, oid)
      .query(`SELECT org_name FROM sys_org WHERE org_id = @oid AND del_flag = 0`);
    if (orgR.recordset.length === 0) return res.status(400).json({ message: '所选组织不存在或已停用' });
    const orgName = orgR.recordset[0].org_name || '';

    // 仓库类别有效性校验
    const wtR = await pool.request().input('wt', sql.NVarChar, wt)
      .query(`SELECT TOP 1 仓库类别 FROM 用户全 WHERE 仓库类别 = @wt`);
    if (wtR.recordset.length === 0) return res.status(400).json({ message: '仓库类别无效' });

    // 手机号查重：用户全 已存在 / register_apply 已有申请
    // pending（待审核）、approved（已通过）拦截；rejected（已驳回）允许重新提交
    const dupUser = await pool.request().input('ph', sql.NVarChar, ph)
      .query(`SELECT TOP 1 用户代码 FROM 用户全 WHERE 手机号 = @ph`);
    if (dupUser.recordset.length > 0) {
      return res.status(409).json({ message: '该手机号已存在用户，请直接登录' });
    }
    const dupApply = await pool.request().input('ph', sql.NVarChar, ph)
      .query(`SELECT TOP 1 id, status FROM register_apply WHERE phone = @ph`);
    if (dupApply.recordset.length > 0) {
      const st = dupApply.recordset[0].status;
      if (st === 'pending') return res.status(409).json({ message: '您的申请已提交，不能再次提交申请' });
      if (st === 'approved') return res.status(409).json({ message: '该手机号已提交过注册申请（已审核），如有疑问请联系管理员' });
      if (st === 'rejected') {
        // 被驳回的申请允许重新提交：先删除旧驳回记录（register_apply 手机号唯一索引约束同号仅一条），再以全新申请入队
        await pool.request().input('ph', sql.NVarChar, ph)
          .query(`DELETE FROM register_apply WHERE phone = @ph AND status = 'rejected'`);
      }
    }

    // 系统自建工号
    const userCode = await genUserCode(pool);

    // 落待审表（手机号唯一索引兜底并发）
    try {
      const ins = await pool.request()
        .input('applyNo', sql.NVarChar, genApplyNo())
        .input('userCode', sql.NVarChar, userCode)
        .input('userName', sql.NVarChar, name)
        .input('phone', sql.NVarChar, ph)
        .input('wt', sql.NVarChar, wt)
        .input('oid', sql.Int, oid)
        .input('orgName', sql.NVarChar, orgName)
        .input('position', sql.NVarChar, pos)
        .query(`
          INSERT INTO register_apply (apply_no, user_code, user_name, phone, warehouse_type, org_id, org_name, position, status)
          OUTPUT INSERTED.id
          VALUES (@applyNo, @userCode, @userName, @phone, @wt, @oid, @orgName, @position, 'pending')
        `);
      const newId = ins.recordset[0]?.id;
      res.status(201).json({
        ok: true,
        message: '注册申请已提交，请等待管理员审核',
        id: newId,
        userCode,
      });
    } catch (e: any) {
      // 唯一索引冲突 = 并发重复提交同手机号
      if (/UQ_register_apply_phone|duplicate|Violation of UNIQUE/i.test(e.message || '')) {
        return res.status(409).json({ message: '该手机号已提交过注册申请，请勿重复提交' });
      }
      throw e;
    }
  } catch (e: any) {
    console.error('提交注册申请失败:', e.message);
    res.status(500).json({ message: '提交失败：' + (e.message || '未知错误') });
  }
});

// ============================================================
// 管理：待审/全部申请列表（status 可选过滤：pending/approved/rejected）
// ============================================================
router.get('/applications', authMiddleware, requireMenuPerm('baseInfo', 'registerAudit'), async (req, res) => {
  try {
    const { status } = req.query;
    const pool = await getPool();
    let query = 'SELECT * FROM register_apply';
    const params: { name: string; type: any; value: any }[] = [];
    if (typeof status === 'string' && VALID_STATUS.includes(status as any)) {
      query += ' WHERE status = @status';
      params.push({ name: 'status', type: sql.NVarChar, value: status });
    }
    query += ' ORDER BY (CASE WHEN status = \'pending\' THEN 0 ELSE 1 END), id DESC';
    const q = pool.request();
    params.forEach(p => q.input(p.name, p.type, p.value));
    const r = await q.query(query);
    res.json({ applications: r.recordset.map(normalizeApply) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 管理：审核通过 → 事务内插入 用户全 + sys_user_role + 更新申请状态
// ============================================================
router.post('/applications/:id/approve', authMiddleware, requireMenuPerm('baseInfo', 'registerAudit'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '申请ID无效' });
  const body = req.body || {};
  let roleId = Number(body.roleId);
  if (!Number.isInteger(roleId) || roleId <= 0) roleId = DEFAULT_ROLE_ID;
  let orgId = Number(body.orgId);

  try {
    const pool = await getPool();
    const found = await loadPendingApplication(pool, id);
    if (!found) return res.status(404).json({ message: '申请不存在' });
    if (found.error) return res.status(409).json({ message: found.error });
    const apply = found.row;

    // 组织：优先管理员本次选择，未传则沿用申请时的组织
    if (!Number.isInteger(orgId) || orgId <= 0) orgId = apply.org_id ?? null;
    if (!orgId) return res.status(400).json({ message: '缺少组织，无法完成审核' });
    const orgR = await pool.request().input('oid', sql.Int, orgId)
      .query(`SELECT org_name, org_type FROM sys_org WHERE org_id = @oid AND del_flag = 0`);
    if (orgR.recordset.length === 0) return res.status(400).json({ message: '所选组织不存在或已停用' });

    // 组织归属：审核确定组织后，把「组织」列填为该组织 org_name（与用户管理/角色绑定展示口径一致），
    // 使通过的店长/店员自动出现在组织树对应组织节点下
    const orgRow = orgR.recordset[0];
    const orgName = String(orgRow.org_name || '').trim();

    // 再次查重（审核期间可能被并发创建）
    const dup = await pool.request().input('uc', sql.NVarChar, apply.user_code).input('ph', sql.NVarChar, apply.phone)
      .query(`SELECT 用户代码, 手机号 FROM 用户全 WHERE 用户代码 = @uc OR 手机号 = @ph`);
    if (dup.recordset.length > 0) {
      return res.status(409).json({ message: '该工号或手机号已存在用户，无法重复插入，请检查用户管理' });
    }

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      // 1) 插入 用户全（默认密码 8888、管理员=否；审核人已在「补充资料」中补齐的字段优先使用补充值）
      await tx.request()
        .input('code', sql.NVarChar, apply.user_code)
        .input('name', sql.NVarChar, apply.user_name)
        .input('phone', sql.NVarChar, apply.phone)
        .input('pwd', sql.NVarChar, apply.password || '8888')
        .input('admin', sql.NVarChar, apply.admin_flag || '否')
        .input('wt', sql.NVarChar, apply.warehouse_type)
        .input('wechat', sql.NVarChar, apply.wechat_account || '')
        .input('org', sql.NVarChar, String(apply.org || '').trim() || orgName)
        .input('position', sql.NVarChar, apply.position || '')
        .query(`
          INSERT INTO 用户全 (用户代码, 用户名称, 手机号, 管理员, 密码, 企微账号, 仓库类别, 组织, 职位)
          VALUES (@code, @name, @phone, @admin, @pwd, @wechat, @wt, @org, @position)
        `);

      // 2) 写 sys_user_role（绑定组织节点；若存在同 user_code+role_id 则更新 org_id）
      const roleR = await tx.request().input('uc', sql.NVarChar, apply.user_code).input('rid', sql.Int, roleId)
        .query(`SELECT id FROM sys_user_role WHERE user_code = @uc AND role_id = @rid`);
      if (roleR.recordset.length > 0) {
        await tx.request().input('uc', sql.NVarChar, apply.user_code).input('rid', sql.Int, roleId).input('oid', sql.Int, orgId)
          .query(`UPDATE sys_user_role SET org_id = @oid, update_time = GETDATE() WHERE user_code = @uc AND role_id = @rid`);
      } else {
        await tx.request().input('uc', sql.NVarChar, apply.user_code).input('rid', sql.Int, roleId).input('oid', sql.Int, orgId)
          .query(`INSERT INTO sys_user_role (user_code, role_id, org_id) VALUES (@uc, @rid, @oid)`);
      }

      // 3) 联动：申请被设为管理员（管理员='是'）→ 自动绑定 super_admin + 总公司 org 1，
      //    使店铺范围全量（幂等，失败仅记录日志不阻断审核）
      if (String(apply.admin_flag || '').trim() === '是') {
        try {
          const r = await ensureAdminOrgBinding(tx, apply.user_code);
          console.log(`[AdminOrgSync] 审核通过用户 ${apply.user_code} 管理员总公司绑定 (${r})`);
        } catch (bindErr: any) {
          console.error(`[AdminOrgSync] 审核通过用户 ${apply.user_code} 管理员绑定失败:`, bindErr.message);
        }
      }

      // 4) 申请状态置为已通过
      await tx.request()
        .input('id', sql.Int, id)
        .input('approver', sql.NVarChar, (req as any).user?.userCode || '')
        .input('approverName', sql.NVarChar, (req as any).user?.userName || '')
        .query(`
          UPDATE register_apply
          SET status = 'approved', approver = @approver, approver_name = @approverName, approve_time = GETDATE()
          WHERE id = @id
        `);

      await tx.commit();
      res.json({ ok: true, message: `审核通过，用户 ${apply.user_name}（${apply.user_code}）已创建，可在用户管理中查看` });
    } catch (txErr: any) {
      await tx.rollback();
      throw txErr;
    }
  } catch (e: any) {
    console.error('审核通过失败:', e.message);
    res.status(500).json({ message: '审核失败：' + (e.message || '未知错误') });
  }
});

// ============================================================
// 管理：补充资料（编辑）→ 补齐「用户管理」中用户需要填写的全部字段，保存至待审申请
// 通过时这些补充字段将随用户全表创建一并生效
//
// 注意：字段键名与「用户管理」保持一致（中文列名，如 职位/企微账号/密码/管理员；岗位已下线，不再读写）。
// 不能使用 isAdmin/position 等英文键——authMiddleware 会将它们视为身份敏感参数强制覆盖为登录人身份
// ============================================================
router.post('/applications/:id/supplement', authMiddleware, requireMenuPerm('baseInfo', 'registerAudit'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '申请ID无效' });
  const body = req.body || {};

  const name = String(body['用户名称'] || '').trim();
  const ph = String(body['手机号'] || '').trim();
  const wt = String(body['仓库类别'] || '').trim();
  const oid = Number.isInteger(Number(body.orgId)) ? Number(body.orgId) : null;
  const position = String(body['职位'] || '').trim();
  const wechatAccount = String(body['企微账号'] || '').trim();
  const isAdmin = body['管理员'] === '是' ? '是' : '否';
  const password = String(body['密码'] || '').trim();

  if (!name) return res.status(400).json({ message: '请填写姓名' });
  if (!isValidPhone(ph)) return res.status(400).json({ message: '请填写正确的 11 位手机号' });
  if (!wt) return res.status(400).json({ message: '请选择仓库类别' });
  if (!oid) return res.status(400).json({ message: '请选择组织' });

  try {
    const pool = await getPool();
    const found = await loadPendingApplication(pool, id);
    if (!found) return res.status(404).json({ message: '申请不存在' });
    if (found.error) return res.status(409).json({ message: found.error });
    const apply = found.row;

    // 组织有效性校验
    const orgR = await pool.request().input('oid', sql.Int, oid)
      .query(`SELECT org_name FROM sys_org WHERE org_id = @oid AND del_flag = 0`);
    if (orgR.recordset.length === 0) return res.status(400).json({ message: '所选组织不存在或已停用' });
    const orgName = orgR.recordset[0].org_name || '';

    // 仓库类别有效性校验
    const wtR = await pool.request().input('wt', sql.NVarChar, wt)
      .query(`SELECT TOP 1 仓库类别 FROM 用户全 WHERE 仓库类别 = @wt`);
    if (wtR.recordset.length === 0) return res.status(400).json({ message: '仓库类别无效' });

    // 手机号查重：用户全 已存在 / register_apply 其他申请
    if (String(apply.phone) !== ph) {
      const dupUser = await pool.request().input('ph', sql.NVarChar, ph)
        .query(`SELECT TOP 1 用户代码 FROM 用户全 WHERE 手机号 = @ph`);
      if (dupUser.recordset.length > 0) {
        return res.status(409).json({ message: '该手机号已存在用户，请勿重复' });
      }
      const dupApply = await pool.request().input('ph', sql.NVarChar, ph).input('id', sql.Int, id)
        .query(`SELECT TOP 1 id FROM register_apply WHERE phone = @ph AND id <> @id`);
      if (dupApply.recordset.length > 0) {
        return res.status(409).json({ message: '该手机号已被其他注册申请使用' });
      }
    }

    await pool.request()
      .input('id', sql.Int, id)
      .input('name', sql.NVarChar, name)
      .input('phone', sql.NVarChar, ph)
      .input('wt', sql.NVarChar, wt)
      .input('oid', sql.Int, oid)
      .input('orgName', sql.NVarChar, orgName)
      .input('position', sql.NVarChar, position)
      .input('wechat', sql.NVarChar, wechatAccount)
      .input('admin', sql.NVarChar, isAdmin)
      .input('pwd', sql.NVarChar, password || null)
      .query(`
UPDATE register_apply
        SET user_name = @name, phone = @phone, warehouse_type = @wt, org_id = @oid, org_name = @orgName,
            position = @position, wechat_account = @wechat,
            admin_flag = @admin,
            password = CASE WHEN @pwd IS NULL OR @pwd = '' THEN password ELSE @pwd END
        WHERE id = @id
      `);
    res.json({ ok: true, message: `已保存 ${name}（${apply.user_code}）的补充资料，审核通过后将按此创建用户` });
  } catch (e: any) {
    console.error('保存补充资料失败:', e.message);
    res.status(500).json({ message: '保存失败：' + (e.message || '未知错误') });
  }
});

// ============================================================
// 管理：拒绝（填原因）
// ============================================================
router.post('/applications/:id/reject', authMiddleware, requireMenuPerm('baseInfo', 'registerAudit'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '申请ID无效' });
  const reason = String((req.body || {}).reason || '').trim() || '未通过审核';

  try {
    const pool = await getPool();
    const found = await loadPendingApplication(pool, id);
    if (!found) return res.status(404).json({ message: '申请不存在' });
    if (found.error) return res.status(409).json({ message: found.error });

    await pool.request()
      .input('id', sql.Int, id)
      .input('reason', sql.NVarChar, reason)
      .input('approver', sql.NVarChar, (req as any).user?.userCode || '')
      .input('approverName', sql.NVarChar, (req as any).user?.userName || '')
      .query(`
        UPDATE register_apply
        SET status = 'rejected', reject_reason = @reason, approver = @approver, approver_name = @approverName, approve_time = GETDATE()
        WHERE id = @id
      `);
    res.json({ ok: true, message: '已拒绝该申请' });
  } catch (e: any) {
    console.error('拒绝申请失败:', e.message);
    res.status(500).json({ message: '拒绝失败：' + (e.message || '未知错误') });
  }
});

export default router;