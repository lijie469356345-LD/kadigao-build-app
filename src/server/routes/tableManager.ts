import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';

const router = Router();

// ============================================================
// v3 权限隔离方案：旧权限表（UserGroups / GroupPermissions / PositionModules）已下线
//  - 统一返回 410 Gone，不再读取/自动创建旧表（防止删表后被自动重建）
// ============================================================

const LEGACY_TABLE_DISABLED_MSG =
  '该表归属旧权限体系（用户组/分组权限/岗位模块），已迁移至 v3 权限方案' +
  '（sys_user_role 角色授权 + sys_org 组织树数据范围 + sys_role_menu 菜单授权），数据表已下线';

/** 仅允许操作的白名单；三张旧权限表已移除 → 任何访问一律 410 */
const ALLOWED_TABLES: Record<string, { pk: string; title: string }> = {};

function isAllowed(_table: string): boolean {
  return false;
}

// 安全标识符转义（保留，供后续扩展新表时使用）
function quoteIdent(name: string): string {
  return '[' + String(name).replace(/\]/g, ']]') + ']';
}

// ========== 旧权限表统一下线响应 ==========

router.get('/:table/schema', async (_req, res) => {
  res.status(410).json({ error: LEGACY_TABLE_DISABLED_MSG });
});

router.get('/:table', async (_req, res) => {
  res.status(410).json({ error: LEGACY_TABLE_DISABLED_MSG });
});

router.post('/:table', async (_req, res) => {
  res.status(410).json({ error: LEGACY_TABLE_DISABLED_MSG });
});

router.put('/:table/:id', async (_req, res) => {
  res.status(410).json({ error: LEGACY_TABLE_DISABLED_MSG });
});

router.delete('/:table/clear', async (_req, res) => {
  res.status(410).json({ error: LEGACY_TABLE_DISABLED_MSG });
});

router.delete('/:table/:id', async (_req, res) => {
  res.status(410).json({ error: LEGACY_TABLE_DISABLED_MSG });
});

router.post('/:table/bulk', async (_req, res) => {
  res.status(410).json({ error: LEGACY_TABLE_DISABLED_MSG });
});

export default router;
