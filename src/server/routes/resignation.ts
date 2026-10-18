import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// ============================================================
// 离职管理 API v1（2026-10-18）
// 本轮范围：登记离职 + 离职列表（审批流转待用户确认后扩展）
// 数据独立存储于 resignation_record 表，不改共享表「用户全」表结构。
// ============================================================

/** 有登记离职权限的管理身份：管理员 / 超管 / 数据管理员 */
function canManageResignation(user: any): boolean {
  if (!user) return false;
  if (String(user.isAdmin || '') === '是') return true;
  const codes = Array.isArray(user.roleCodes) ? user.roleCodes : (user.roleCode ? [user.roleCode] : []);
  return codes.includes('super_admin') || codes.includes('data_admin');
}

/** 登记离职：从「用户全」快照基础信息写入离职表（不删除、不修改用户全） */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const operator = req.user;
    if (!canManageResignation(operator)) {
      return res.status(403).json({ success: false, message: '无权限执行离职登记' });
    }
    const { userCode, remark } = req.body || {};
    const code = String(userCode || '').trim();
    if (!code) return res.status(400).json({ success: false, message: '用户代码不能为空' });

    const pool = await getPool();

    // 1) 用户全快照
    const userR = await pool.request().input('code', sql.NVarChar, code)
      .query(`SELECT 用户名称, 手机号, 组织 FROM 用户全 WHERE 用户代码 = @code`);
    if (userR.recordset.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    const row = userR.recordset[0];
    const userName = String(row['用户名称'] || '');
    const phone = String(row['手机号'] || '');
    const orgName = String(row['组织'] || '');

    // 2) 重复登记拦截（用户代码唯一）
    const dupR = await pool.request().input('code', sql.NVarChar, code)
      .query(`SELECT id FROM resignation_record WHERE user_code = @code`);
    if (dupR.recordset.length > 0) {
      return res.status(409).json({ success: false, message: '该员工已登记离职，请勿重复登记' });
    }

    // 3) 写入离职表（pending 待审批）
    await pool.request()
      .input('code', sql.NVarChar, code)
      .input('name', sql.NVarChar, userName)
      .input('phone', sql.NVarChar, phone)
      .input('org', sql.NVarChar, orgName)
      .input('remark', sql.NVarChar, String(remark || '').trim())
      .input('opCode', sql.NVarChar, String(operator?.userCode || ''))
      .input('opName', sql.NVarChar, String(operator?.userName || ''))
      .query(`
        INSERT INTO resignation_record (user_code, user_name, org_name, phone, status, remark, operator_code, operator_name)
        VALUES (@code, @name, @org, @phone, 'pending', @remark, @opCode, @opName)
      `);

    res.json({ success: true, message: `已登记「${userName}」离职，可前往「离职管理」查看` });
  } catch (error: any) {
    console.error('登记离职失败:', error);
    res.status(500).json({ success: false, message: '登记离职失败：' + (error.message || '未知错误') });
  }
});

/** 离职列表（登记时间倒序，含状态；需登录） */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT id, user_code, user_name, org_name, phone, status, remark,
             operator_code, operator_name, resign_time
      FROM resignation_record
      ORDER BY resign_time DESC, id DESC
    `);
    res.json(r.recordset.map((row: any) => ({
      id: row.id,
      userCode: row.user_code,
      userName: row.user_name,
      orgName: row.org_name || '',
      phone: row.phone || '',
      status: row.status,
      remark: row.remark || '',
      operatorCode: row.operator_code || '',
      operatorName: row.operator_name || '',
      resignTime: row.resign_time,
    })));
  } catch (error: any) {
    console.error('获取离职列表失败:', error);
    res.status(500).json({ success: false, message: '获取离职列表失败：' + (error.message || '') });
  }
});

export default router;