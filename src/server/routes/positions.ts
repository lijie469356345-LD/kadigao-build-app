import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requirePermAdmin, requireWrite } from './adminPerm';
import { migratePositionRole } from '../services/positionRoleSync';

// ============================================================
// 职位管理（sys_position）
//  - GET   /           职位列表（含关联角色名 + 用户全表使用人数 + 组织映射）
//  - GET   /options    职位下拉（仅启用项，用户管理/注册审核复用，含组织映射）
//  - POST  /           新增职位（positionName + 可选 roleId + 可选 orgType/orgNameKw）
//  - PUT   /:id        修改关联角色（roleId 传 null 解除关联）与组织映射（orgType/orgNameKw）
//  - DELETE /:id       删除职位（用户全表「职位」列有引用则 409 拒绝）
// 鉴权与角色管理一致：super_admin / data_admin / it / 管理员=是
// ============================================================

/** 合法组织类型（sys_org.org_type），支持 | 组合；空串表示不自动带出组织 */
const ORG_TYPE_OPTIONS = ['company', 'supervisor_group', 'dealer_group', 'shop', 'director', 'group'];

function normalizeOrgMap(body: any): { orgType: string | null; orgNameKw: string | null } {
  const rawType = body?.orgType === null || body?.orgType === undefined ? '' : String(body.orgType).trim();
  const rawKw = body?.orgNameKw === null || body?.orgNameKw === undefined ? '' : String(body.orgNameKw).trim();
  let orgType: string | null = null;
  if (rawType) {
    const parts = rawType.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return { orgType: null, orgNameKw: null };
    if (parts.some(p => !ORG_TYPE_OPTIONS.includes(p))) {
      throw new Error('组织类型取值非法');
    }
    orgType = parts.join('|');
  }
  return { orgType, orgNameKw: rawKw ? rawKw : null };
}

const router = Router();

// 职位列表
router.get('/', authMiddleware, requirePermAdmin, async (_req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT p.position_id, p.position_name, p.role_id, r.role_name, p.org_type, p.org_name_kw, p.status, p.create_time,
             (SELECT COUNT(*) FROM 用户全 u WHERE u.职位 = p.position_name) AS user_count
      FROM sys_position p
      LEFT JOIN sys_role r ON r.role_id = p.role_id AND r.del_flag = 0
      ORDER BY p.position_id
    `);
    res.json({ positions: r.recordset });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 职位下拉（用户管理新增/编辑、注册审核补充资料共用；仅需登录）
router.get('/options', authMiddleware, async (_req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT position_name, role_id, org_type, org_name_kw FROM sys_position WHERE status = 1 ORDER BY position_id
    `);
    res.json({ items: r.recordset });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 新增职位（roleId 可选：不传/传空表示暂不关联角色；orgType 可选：不传表示不自动带出组织）
router.post('/', authMiddleware, requireWrite, async (req, res) => {
  try {
    const { positionName, roleId } = req.body || {};
    const name = String(positionName || '').trim();
    if (!name) return res.status(400).json({ message: '职位名称必填' });
    if (name.length > 50) return res.status(400).json({ message: '职位名称不能超过 50 字' });

    let orgMap: { orgType: string | null; orgNameKw: string | null };
    try {
      orgMap = normalizeOrgMap(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }

    const pool = await getPool();
    const dup = await pool.request().input('pn', sql.NVarChar, name)
      .query(`SELECT position_id FROM sys_position WHERE position_name = @pn`);
    if (dup.recordset.length > 0) return res.status(400).json({ message: '职位名称已存在' });

    const rid = roleId === null || roleId === undefined || roleId === '' ? null : Number(roleId);
    if (rid !== null) {
      const role = await pool.request().input('rid', sql.Int, rid)
        .query(`SELECT role_id FROM sys_role WHERE role_id = @rid AND del_flag = 0`);
      if (role.recordset.length === 0) return res.status(400).json({ message: '关联角色不存在' });
    }

    const r = await pool.request()
      .input('pn', sql.NVarChar, name)
      .input('rid', sql.Int, rid)
      .input('ot', sql.NVarChar, orgMap.orgType)
      .input('ok', sql.NVarChar, orgMap.orgNameKw)
      .query(`INSERT INTO sys_position (position_name, role_id, org_type, org_name_kw) OUTPUT INSERTED.position_id VALUES (@pn, @rid, @ot, @ok)`);
    res.json({ positionId: r.recordset[0].position_id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 修改关联角色与组织映射（roleId 传 null 表示解除关联；orgType 传 null 表示停用自动带出）
router.put('/:id', authMiddleware, requireWrite, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { roleId } = req.body || {};
    if (!Number.isFinite(id)) return res.status(400).json({ message: '参数错误' });

    const pool = await getPool();
    const cur = await pool.request().input('pid', sql.Int, id)
      .query(`SELECT position_id, position_name, role_id AS old_role_id FROM sys_position WHERE position_id = @pid`);
    if (cur.recordset.length === 0) return res.status(404).json({ message: '职位不存在' });
    const pos = cur.recordset[0];
    const oldRoleId = pos.old_role_id === null || pos.old_role_id === undefined ? null : Number(pos.old_role_id);

    const rid = roleId === null || roleId === undefined || roleId === '' ? null : Number(roleId);
    if (rid !== null) {
      const role = await pool.request().input('rid', sql.Int, rid)
        .query(`SELECT role_id FROM sys_role WHERE role_id = @rid AND del_flag = 0`);
      if (role.recordset.length === 0) return res.status(400).json({ message: '关联角色不存在' });
    }

    let orgMap: { orgType: string | null; orgNameKw: string | null };
    try {
      orgMap = normalizeOrgMap(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }

    await pool.request()
      .input('pid', sql.Int, id)
      .input('rid', sql.Int, rid)
      .input('ot', sql.NVarChar, orgMap.orgType)
      .input('ok', sql.NVarChar, orgMap.orgNameKw)
      .query(`UPDATE sys_position SET role_id = @rid, org_type = @ot, org_name_kw = @ok, update_time = GETDATE() WHERE position_id = @pid`);

    // 联动：职位「关联角色」变更 → 迁移该职位下所有在册用户的 sys_user_role 绑定（旧角色→新角色）
    let migrate: any = null;
    if ((oldRoleId ?? null) !== (rid ?? null)) {
      migrate = await migratePositionRole(pool, String(pos.position_name || ''), oldRoleId, rid);
      console.log(`[PositionSync] 职位「${pos.position_name}」关联角色 ${oldRoleId} → ${rid}，迁移 ${migrate.usersScanned} 人（更新 ${migrate.bindingsUpdated}、解绑 ${migrate.bindingsRemoved}）`);
    }
    res.json({ ok: true, migrate });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 删除职位：用户全表「职位」列仍有使用则拒绝（列出部分在用用户）；无用户引用才允许物理删除
router.delete('/:id', authMiddleware, requireWrite, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: '参数错误' });

    const pool = await getPool();
    const cur = await pool.request().input('pid', sql.Int, id)
      .query(`SELECT position_id, position_name FROM sys_position WHERE position_id = @pid`);
    if (cur.recordset.length === 0) return res.status(404).json({ message: '职位不存在' });
    const pos = cur.recordset[0];

    const usage = await pool.request().input('pn', sql.NVarChar, pos.position_name)
      .query(`SELECT TOP 6 用户名称 FROM 用户全 WHERE 职位 = @pn`);
    if (usage.recordset.length > 0) {
      const names = usage.recordset.map((x: any) => x.用户名称 || '未知').join('、');
      const suffix = usage.recordset.length > 5 ? ' 等' : '';
      return res.status(409).json({
        message: `该职位下仍有 ${usage.recordset.length} 名在册用户（${names}${suffix}），请先调整这些用户的职位后再删除`,
      });
    }

    await pool.request().input('pid', sql.Int, id).query(`DELETE FROM sys_position WHERE position_id = @pid`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;