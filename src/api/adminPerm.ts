import axios from './axios';

// ============================================================
// 权限管理页面 API（组织/店铺/角色/菜单授权/用户分配）
// 对应后端 /api/admin-perm（v3 四表，super_admin/data_admin 可操作）
// ============================================================

// ---- 组织 ----
export const getOrgTree = async () => {
  const res = await axios.get('/admin-perm/org/tree');
  return res.data as { nodes: any[] };
};

export const createOrg = async (payload: {
  parentId: number; name: string; orgType: string;
  businessLine?: string; functionLine?: string; warehouseType?: string; orgCode?: string;
}) => {
  const res = await axios.post('/admin-perm/org', payload);
  return res.data;
};

export const updateOrg = async (id: number, payload: {
  name?: string; orgType?: string; businessLine?: string; functionLine?: string; warehouseType?: string; orgCode?: string;
}) => {
  const res = await axios.put(`/admin-perm/org/${id}`, payload);
  return res.data;
};

export const moveOrg = async (id: number, parentId: number) => {
  const res = await axios.put(`/admin-perm/org/${id}/move`, { parentId });
  return res.data;
};

export const deleteOrg = async (id: number) => {
  const res = await axios.delete(`/admin-perm/org/${id}`);
  return res.data;
};

// ---- 店铺归属 ----
export const getShopSource = async (params: {
  kw?: string; supervisor?: string; areaManager?: string; dealer?: string; area?: string; warehouseType?: string; orgId?: number;
}) => {
  const res = await axios.get('/admin-perm/shops/source', { params });
  return res.data as { shops: any[]; total: number };
};

export const getShopFilters = async () => {
  const res = await axios.get('/admin-perm/shops/filters');
  return res.data as {
    filters: { supervisors: string[]; areaManagers: string[]; dealers: string[]; areas: string[]; warehouseTypes: string[] };
  };
};

// 店铺档案轻量列表（用户管理新增/编辑弹窗「店铺」下拉+模糊搜索；storeName 为去 _ZY/_JM 后缀的标准店名）
export const getShopOptions = async (params: { kw?: string; warehouseType?: string } = {}) => {
  const res = await axios.get('/admin-perm/shops/options', { params });
  return res.data as {
    shops: { shopId: number; storeName: string; shopCode: string; available: string; warehouseType: string; area: string; districtManager: string; supervisor: string; dealer: string }[];
  };
};

export const bindShopsToOrg = async (orgId: number, shopCodes: string[]) => {
  const res = await axios.post(`/admin-perm/org/${orgId}/shops`, { shopCodes });
  return res.data;
};

export const unbindShopOrg = async (shopOrgId: number) => {
  const res = await axios.delete(`/admin-perm/org/shops/${shopOrgId}`);
  return res.data;
};

// ---- 组织可见店铺（org_shop_bind 多对多绑定：同一组织可多次绑定多家店） ----
export const getOrgVisibleShops = async (orgId: number) => {
  const res = await axios.get(`/admin-perm/org/${orgId}/visible-shops`);
  return res.data as { shops: { orgId: number; shopCode: string; shopName: string }[] };
};

export const bindOrgVisibleShops = async (orgId: number, shopCodes: string[]) => {
  const res = await axios.post(`/admin-perm/org/${orgId}/visible-shops`, { shopCodes });
  return res.data;
};

export const unbindOrgVisibleShop = async (orgId: number, shopCodes: string[]) => {
  const res = await axios.delete(`/admin-perm/org/${orgId}/visible-shops`, { params: { shopCodes: shopCodes.join(',') } });
  return res.data;
};

// ---- 店铺范围同步：把组织架构树的直属挂载店铺固化为店铺范围（org_shop_bind） ----
// 组织架构只解决管理层级；查看权限由店铺范围决定。组织架构调整挂载后需同步。
export const previewShopScopeSync = async () => {
  const res = await axios.post('/admin-perm/org/shop-scope/preview');
  return res.data as { ok: boolean; plan?: { directPlanned: number; selfPlanned: number; skipped: number }; warnings?: string[]; error?: string };
};

export const runShopScopeSync = async () => {
  const res = await axios.post('/admin-perm/org/shop-scope/sync');
  return res.data as { ok: boolean; result?: { directInserted: number; selfInserted: number; skipped: number }; warnings?: string[]; error?: string };
};

// ---- 组织用户归属（组织框架人头/人数穿透：只调 sys_user_role 的 org_id，不改用户表） ----
export const getOrgUsers = async (orgId: number) => {
  const res = await axios.get(`/admin-perm/org/${orgId}/users`);
  return res.data as { orgId: number; orgName: string; userCount: number; entries: any[]; autoAggregated?: boolean; warehouseType?: string };
};

export const addOrgUser = async (orgId: number, payload: { userCode: string; roleId: number }) => {
  const res = await axios.post(`/admin-perm/org/${orgId}/users`, payload);
  return res.data as { ok: boolean; action: 'inserted' | 'moved'; prevOrgId?: number | null };
};

export const updateOrgUserOrg = async (orgId: number, entryId: number, targetOrgId: number | null) => {
  const res = await axios.put(`/admin-perm/org/${orgId}/users/${entryId}`, { orgId: targetOrgId });
  return res.data as { ok: boolean };
};

export const removeOrgUser = async (orgId: number, entryId: number) => {
  const res = await axios.delete(`/admin-perm/org/${orgId}/users/${entryId}`);
  return res.data as { ok: boolean; deleted: boolean };
};

// ---- 组织架构自动同步（从店铺档案维护：直营 区经→督导→店铺；加盟 区经→督导→经销商→店铺；山东 区经→督导→店铺） ----
export const syncOrgFromArchive = async (payload: {
  dryRun?: boolean; parentOrgId?: number | null; warehouseType?: string;
  dealerLevel?: boolean; dealerGroupPrefix?: string;
}) => {
  const res = await axios.post('/admin-perm/org/sync-archive', payload);
  return res.data as {
    ok: boolean; dryRun: boolean; shopTotal: number; scope: string;
    targetOrg: { orgId: number; orgName: string; orgLevel: number; ancestors: string } | null;
    nodes: { kind: string; action: string; name: string; orgName: string; parentName: string; reason?: string }[];
    users: { userCode: string; userName: string; roleCode: string; action: string; fromOrgId?: number | null; toOrgName: string; reason?: string }[];
    warnings: { level: 'warn' | 'info'; text: string }[];
    summary?: { areaManagers: number; supervisors: number; dealers: number; shops: number; usersMoved: number; usersInserted: number };
  };
};

// ---- 组织架构导入导出（导出 xlsx 文件可直接回导；导入先 dryRun 预览后正式执行） ----
export const exportOrgArchive = async () => {
  const res = await axios.get('/admin-perm/org/export', { responseType: 'blob' });
  const disposition = String(res.headers?.['content-disposition'] || '');
  const m = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const filename = m ? decodeURIComponent(m[1]) : `组织架构_${new Date().toISOString().slice(0, 10)}.xlsx`;
  return { blob: res.data as Blob, filename };
};

export type OrgImportMode = 'diff' | 'replace';

export interface OrgImportPlanRow {
  orgId: string; orgName: string; orgType: string; parentOrgId: string; status: number;
  action: 'create' | 'update' | 'delete'; matchedOrgId?: number; reason?: string;
}

export interface OrgImportResult {
  ok: boolean; dryRun: boolean; mode: OrgImportMode; totalRows: number;
  errors: { row: number; text: string }[];
  warnings: { level: 'warn' | 'info'; text: string }[];
  plan: OrgImportPlanRow[];
  willCleanUserBinds: number;
  willCleanShopBinds: number;
  summary?: { create: number; update: number; delete: number; shops: number; groups: number };
}

export const importOrgArchive = async (file: File, dryRun: boolean, mode: OrgImportMode = 'diff') => {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('dryRun', String(dryRun));
  fd.append('mode', mode);
  const res = await axios.post('/admin-perm/org/import', fd);
  return res.data as OrgImportResult;
};

// ---- 角色 ----
export const getRoles = async () => {
  const res = await axios.get('/admin-perm/roles');
  return res.data as { roles: any[] };
};

export const createRole = async (payload: { roleName: string; roleCode: string; dataScope: number }) => {
  const res = await axios.post('/admin-perm/roles', payload);
  return res.data;
};

export const updateRole = async (id: number, payload: {
  roleName?: string; roleCode?: string; dataScope?: number; status?: number;
}) => {
  const res = await axios.put(`/admin-perm/roles/${id}`, payload);
  return res.data;
};

export const deleteRole = async (id: number) => {
  const res = await axios.delete(`/admin-perm/roles/${id}`);
  return res.data;
};

// ---- 菜单目录与授权 ----
export interface CatalogPortalItem { portalEn: string; portalCn: string; masterPortalEn?: string; masterPortalCn?: string; defaultRoute: string; menus: { menuEn: string; menuCn: string; routePath: string }[] }
export interface CatalogMaster { masterPortalEn: string; masterPortalCn: string; portals: CatalogPortalItem[] }

export const getMenuCatalog = async () => {
  const res = await axios.get('/admin-perm/menu-catalog');
  return res.data as { portals: CatalogPortalItem[]; masters?: CatalogMaster[] };
};

export const getRoleMenus = async (roleId: number) => {
  const res = await axios.get(`/admin-perm/roles/${roleId}/menus`);
  return res.data as { grants: { portal_en: string; menu_en: string }[] };
};

export const saveRoleMenus = async (roleId: number, grants: { portalEn: string; menuEn: string }[]) => {
  const res = await axios.put(`/admin-perm/roles/${roleId}/menus`, { grants });
  return res.data;
};

// ---- 用户角色分配 ----
export const getPermUsers = async (params: { kw?: string }) => {
  const res = await axios.get('/admin-perm/users', { params });
  return res.data as { users: any[] };
};

export const saveUserRoles = async (userCode: string, roles: {
  roleId: number; orgId?: number | null; dataScope?: number | null; dataScopeOrgIds?: string | null;
}[]) => {
  const res = await axios.put(`/admin-perm/users/${encodeURIComponent(userCode)}/roles`, { roles });
  return res.data;
};

// ---- 用户「店铺」列 快速绑定（店长店员填店铺名、督导区经填公司） ----
export const bindStoreShops = async (dryRun: boolean) => {
  const res = await axios.post('/admin-perm/users/bind-store', { dryRun });
  return res.data as {
    ok: boolean; dryRun: boolean; bound: number; already: number; unmatched: number; inserted: number;
    details: { code: string; name: string; group: string; storeVal: string; orgId: number; orgName: string; action: string }[];
    warnings: { level: string; text: string }[];
  };
};

// ---- 权限管理导出（xlsx；tab=roles 角色+菜单授权 / tab=users 用户角色分配，users 支持 kw 过滤） ----
export const exportPermData = async (tab: 'roles' | 'users', kw: string = '') => {
  const res = await axios.get('/admin-perm/export', { params: { tab, kw }, responseType: 'blob' });
  const disposition = String(res.headers?.['content-disposition'] || '');
  const m = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const filename = m ? decodeURIComponent(m[1]) : `权限管理_${new Date().toISOString().slice(0, 10)}.xlsx`;
  return { blob: res.data as Blob, filename };
};