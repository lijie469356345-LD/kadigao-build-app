import { Request, Response, NextFunction } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';

/**
 * 菜单授权中间件：校验当前用户（JWT roleIds 并集）在 sys_role_menu 中
 * 是否拥有指定门户/菜单的授权；无授权返回 403。
 * 口径与 /api/permissions/my-menus（角色授权并集）完全一致：
 *  - 任一角色持有该菜单授权即放行
 *  - super_admin/data_admin 同样走 sys_role_menu 授权（不再默认全开）
 *
 * 用法：router.get('/xxx', authMiddleware, requireMenuPerm('pk', 'pkTaskOrder'), handler)
 */
export function requireMenuPerm(portalEn: string, menuEn: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user: any = (req as any).user;
      if (!user) {
        return res.status(401).json({ code: 'UNAUTHORIZED', message: '未登录或登录已过期' });
      }
      const roleIds: number[] = (user.roleIds || []).filter((id: any) => typeof id === 'number');
      if (roleIds.length === 0) {
        return res.status(403).json({ code: 'FORBIDDEN', message: '无权限访问该功能，请先在权限管理中为您的角色授权' });
      }
      const pool = await getPool();
      const placeholders = roleIds.map((_, i) => `@r${i}`).join(',');
      const q = pool.request();
      roleIds.forEach((rid, i) => q.input(`r${i}`, sql.Int, rid));
      q.input('pe', sql.NVarChar, portalEn).input('me', sql.NVarChar, menuEn);
      const r = await q.query(`
        SELECT 1 FROM sys_role_menu
        WHERE role_id IN (${placeholders}) AND portal_en = @pe AND menu_en = @me
      `);
      if (r.recordset.length > 0) return next();
      return res.status(403).json({ code: 'FORBIDDEN', message: '无权限访问该功能，请先在权限管理中为您的角色授权' });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  };
}

/**
 * 菜单授权中间件（任一命中）：校验当前用户持有 多个菜单 中任意一个授权即放行。
 * 用于「报表页只读下拉数据」等场景：有报表权限即可读任务单/PK名称等元数据，
 * 而写操作与管理列表仍走 requireMenuPerm 严格授权。
 */
export function requireAnyMenuPerm(portalEn: string, menuEns: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user: any = (req as any).user;
      if (!user) {
        return res.status(401).json({ code: 'UNAUTHORIZED', message: '未登录或登录已过期' });
      }
      const roleIds: number[] = (user.roleIds || []).filter((id: any) => typeof id === 'number');
      if (roleIds.length === 0) {
        return res.status(403).json({ code: 'FORBIDDEN', message: '无权限访问该功能，请先在权限管理中为您的角色授权' });
      }
      if (menuEns.length === 0) return next();
      const pool = await getPool();
      const placeholders = roleIds.map((_, i) => `@r${i}`).join(',');
      const menuPlaceholders = menuEns.map((_, i) => `@m${i}`).join(',');
      const q = pool.request();
      roleIds.forEach((rid, i) => q.input(`r${i}`, sql.Int, rid));
      q.input('pe', sql.NVarChar, portalEn);
      menuEns.forEach((m, i) => q.input(`m${i}`, sql.NVarChar, m));
      const r = await q.query(`
        SELECT 1 FROM sys_role_menu
        WHERE role_id IN (${placeholders}) AND portal_en = @pe AND menu_en IN (${menuPlaceholders})
      `);
      if (r.recordset.length > 0) return next();
      return res.status(403).json({ code: 'FORBIDDEN', message: '无权限访问该功能，请先在权限管理中为您的角色授权' });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  };
}