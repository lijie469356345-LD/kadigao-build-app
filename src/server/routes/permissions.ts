import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { getStandardShopFilter } from '../services/permissionService';
import { PORTAL_MENU_ENTRIES, PORTAL_MASTERS, PORTAL_DEFAULT_ROUTES, expandLegacyMenuKeys } from '../services/portalRegistry';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// ============================================================
// v3 权限隔离方案：旧体系（UserGroups / GroupPermissions / PositionModules）已下线
//  - 用户组管理 → sys_user_role（一人多角色，主键 user_code）
//  - 分组店铺授权 → sys_org 组织树 + sys_role.data_scope 数据范围
//  - 岗位模块授权 → sys_role_menu 菜单授权矩阵（唯一授权源）
// 以下旧接口统一返回 410 Gone，不再访问/自动创建旧表（防止删表后被自动重建）
// ============================================================

router.post('/groups', async (_req, res) => {
  res.status(410).json({ message: '用户组管理已迁移至 v3 权限体系（sys_user_role 角色授权），本功能已下线' });
});

router.get('/groups', async (_req, res) => {
  res.status(410).json({ message: '用户组管理已迁移至 v3 权限体系（sys_user_role 角色授权），本功能已下线', groups: [] });
});

router.put('/groups/:groupId', async (_req, res) => {
  res.status(410).json({ message: '用户组管理已迁移至 v3 权限体系（sys_user_role 角色授权），本功能已下线' });
});

// 从店仓全表获取店铺列表（根据用户权限过滤；v3：优先标准组织层级，旧组名逻辑兜底）
router.get('/shops', async (req, res) => {
  const groupName = typeof req.query.groupName === 'string' ? req.query.groupName : undefined;
  
  console.log('=== 权限配置店铺API被调用 ===');
  console.log('groupName:', groupName);
  
  try {
    const pool = await getPool();
    
    let query = `
      SELECT 
        店铺名称 as shopName,
        仓库类别 as warehouseType,
        区域 as area,
        区经 as districtManager,
        督导 as supervisor,
        商品 as product,
        联系人 as contactPerson,
        手机 as phone,
        经销商 as dealer,
        开业日期 as openDate
      FROM 店仓全
    `;
    
    const permissionResult = await getStandardShopFilter(groupName, req.user || null);
    if (permissionResult.filter) {
      query += ` WHERE ${permissionResult.filter}`;
    }
    
    query += ' ORDER BY 区域, 店铺名称';
    
    console.log('最终查询:', query);
    
    const request = pool.request();
    permissionResult.params.forEach(p => request.input(p.name, p.type, p.value));
    
    const result = await request.query(query);
    
    console.log('返回店铺数量:', result.recordset.length);
    
    res.json(result.recordset.map((row: any, index: number) => ({
      id: index + 1,
      shopName: row.shopName || '',
      warehouseType: row.warehouseType || '',
      area: row.area || '',
      districtManager: row.districtManager || '',
      supervisor: row.supervisor || '',
      product: row.product || '',
      contactPerson: row.contactPerson || '',
      phone: row.phone || '',
      dealer: row.dealer || '',
      openDate: row.openDate ? new Date(row.openDate).toLocaleDateString() : '',
    })));
  } catch (error) {
    console.error('获取店铺列表失败:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/group/:groupName', async (_req, res) => {
  // v3：旧 GroupPermissions 明细已下线，返回空即可（前端不再用该接口展示授权明细）
  res.json({ supervisors: [], shops: [] });
});

router.put('/group/:groupName', async (_req, res) => {
  // v3：旧 GroupPermissions 保存已下线
  res.status(410).json({ message: '分组店铺授权已迁移至 v3 权限体系（sys_org 组织树 + sys_role 数据范围），本功能已下线' });
});

// ========== 岗位模块权限表 + API ==========

// 当前登录用户可见门户与菜单（基于 JWT roleIds → sys_role_menu → 菜单注册表聚合）
router.get('/my-menus', authMiddleware, async (req, res) => {
  try {
    const user = req.user!;
    const roleIds: number[] = (user.roleIds || []).filter((id): id is number => typeof id === 'number');
    if (roleIds.length === 0) {
      return res.json({ portals: [] });
    }
    const pool = await getPool();
    // 查询用户所有角色的菜单授权（并集）
    const placeholders = roleIds.map((_, i) => `@r${i}`).join(',');
    const q = pool.request();
    roleIds.forEach((rid, i) => q.input(`r${i}`, sql.Int, rid));
    const result = await q.query(`
      SELECT DISTINCT portal_en, menu_en FROM sys_role_menu WHERE role_id IN (${placeholders})
    `);
    // 旧版成长课堂整体授权键展开为 8 个分类授权，保证存量角色按分类可见
    const granted = new Set(expandLegacyMenuKeys(result.recordset.map((r: any) => ({ portalEn: r.portal_en, menuEn: r.menu_en }))).map(g => `${g.portalEn}:${g.menuEn}`));

    // 从门户菜单注册表聚合出可见门户（含菜单明细、默认路由、主门户归属）
    const portalMap = new Map<string, { portalEn: string; portalCn: string; masterPortalEn: string; masterPortalCn: string; menus: { menuEn: string; menuCn: string; routePath: string }[] }>();
    for (const entry of PORTAL_MENU_ENTRIES) {
      if (entry.isMenu === false) continue; // 子表/明细表不参与门户菜单展示
      if (!granted.has(`${entry.portalEn}:${entry.menuEn}`)) continue;
      let p = portalMap.get(entry.portalEn);
      if (!p) {
        p = {
          portalEn: entry.portalEn,
          portalCn: entry.portalCn,
          masterPortalEn: entry.masterPortalEn || '',
          masterPortalCn: entry.masterPortalCn || '',
          menus: [],
        };
        portalMap.set(entry.portalEn, p);
      }
      p.menus.push({
        menuEn: entry.menuEn,
        menuCn: entry.menuCn,
        routePath: entry.routePath || '',
      });
    }
    const portals = Array.from(portalMap.values()).map(p => ({
      portalEn: p.portalEn,
      portalCn: p.portalCn,
      masterPortalEn: p.masterPortalEn,
      masterPortalCn: p.masterPortalCn,
      menuCount: p.menus.length,
      defaultRoute: PORTAL_DEFAULT_ROUTES[p.portalEn] || p.menus[0]?.routePath || '',
      menus: p.menus,
    }));
    // 按主门户分组（保持主门户顺序，组内门户按注册顺序；仅含用户有授权的门户）
    const masters = PORTAL_MASTERS.map(m => ({
      masterPortalEn: m.masterPortalEn,
      masterPortalCn: m.masterPortalCn,
      portals: portals.filter(p => p.masterPortalEn === m.masterPortalEn),
    })).filter(m => m.portals.length > 0);
    // 全系统受菜单授权管理的路由清单（供前端按授权过滤菜单项）
    const managedRoutes = Array.from(
      new Set(PORTAL_MENU_ENTRIES.map(e => e.routePath).filter((p): p is string => !!p))
    );
    res.json({ portals, masters, managedRoutes });
  } catch (e: any) {
    console.error('获取我的菜单失败:', e);
    res.status(500).json({ error: e.message, portals: [] });
  }
});

router.get('/position-modules', async (_req, res) => {
  // v3：岗位模块授权已迁移至 sys_role_menu 菜单授权（唯一授权源），本接口下线
  res.json({});
});

router.put('/position-modules', async (_req, res) => {
  res.status(410).json({ message: '岗位模块授权已迁移至 v3 权限体系（sys_role_menu），本功能已下线' });
});

export default router;
