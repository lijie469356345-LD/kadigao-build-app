import sql from 'mssql';
import { getPool } from '../../config/db';
import { JwtUserPayload } from './jwt';
import { AREA_PATTERN } from '../../types/permissionConstants';

// ============================================================
// 权限服务：两层能力并存
//  A. 标准权限模型（新增）：组织层级 sys_org + 角色 sys_role + 5 级数据范围
//     buildDataScopePlan / getShopScopeFilter / getLogScopeFilter
//  B. 旧字符串组名逻辑（保留，标准表未配置期间兜底）：组名前缀 + GroupPermissions 店铺明细
// 业务接口统一走 getStandardShopFilter / getStandardLogFilter：标准身份优先，旧逻辑兜底
// ============================================================

export interface PermissionFilter {
  filter: string | null;
  params: { name: string; type: any; value: any }[];
}

export interface MenuItem {
  icon: string;
  label: string;
  path: string;
}

const DEFAULT_WAREHOUSE_FILTER = "(仓库类别 = '直营' OR 仓库类别 = '山东直营' OR 仓库类别 = '加盟')";

// 管理员组：精确全称匹配（只有这几个组名是管理员）
const ADMIN_GROUP_NAMES = ['管理组', '管理员组', 'admin', 'Admin'];

// 其他角色组：精确前缀匹配（区经组_ / 督导组_ / 店铺组_）
const MANAGER_GROUP_PREFIX = '区经组_';
const SUPERVISOR_GROUP_PREFIX = '督导组_';
const SHOP_GROUP_PREFIX = '店铺组_';

export function isAdminGroup(groupName: string): boolean {
  return ADMIN_GROUP_NAMES.includes(groupName);
}

// ============================================================
// 特权用户判定（用于高危写/删操作的二次校验）
//  判定优先级：JWT isAdmin='是' > 标准角色 super_admin/finance/procurement/region_director
//  > 组名命中 ADMIN_GROUP_NAMES。只有管理员级身份才能执行清空/删除等破坏性操作。
// ============================================================
export function isPrivilegedUser(user?: JwtUserPayload | null): boolean {
  if (!user) return false;
  if (user.isAdmin === '是') return true;
  // v3 一人多角色并集（roleCodes 全量）；兼容旧单角色 roleCode
  const codes = user.roleCodes && user.roleCodes.length > 0 ? user.roleCodes : user.roleCode ? [user.roleCode] : [];
  const privileged = ['super_admin', 'finance', 'finance_staff', 'cashier', 'procurement', 'procurement_staff', 'region_director', 'data_admin', 'it'];
  if (codes.some(c => privileged.includes(c))) return true;
  return isAdminGroup(user.groupName || '');
}

export function isManagerGroup(groupName: string): boolean {
  return groupName.startsWith(MANAGER_GROUP_PREFIX) || groupName.startsWith('经理');
}

export function isSupervisorGroup(groupName: string): boolean {
  return groupName.startsWith(SUPERVISOR_GROUP_PREFIX);
}

export function isDirectorGroup(groupName: string): boolean {
  return groupName.startsWith('总监组');
}

export function extractSupervisorName(groupName: string): string | null {
  const supervisorMatch = groupName.match(/督导(.+)/);
  if (supervisorMatch) {
    let namePart = supervisorMatch[1];
    // 移除加盟/直营前缀
    namePart = namePart.replace(/加盟|直营/g, '').trim();
    // 移除区域后缀
    const areaMatch = namePart.match(new RegExp(AREA_PATTERN));
    if (areaMatch) {
      namePart = namePart.replace(areaMatch[1], '').trim();
    }
    // 移除"组_"前缀（如"督导组_XXX" → "XXX"）
    namePart = namePart.replace(/^组[_\s]*/, '').trim();
    // 移除残余的下划线/分隔符
    namePart = namePart.replace(/^[_\s-]+/, '').trim();
    return namePart || null;
  }
  return null;
}

export function extractManagerArea(groupName: string): string | null {
  const managerMatch = groupName.match(/经理(.+)/);
  if (managerMatch) {
    const areaMatch = managerMatch[1].match(new RegExp(AREA_PATTERN));
    return areaMatch ? areaMatch[1] : null;
  }
  return null;
}

export function isShopGroup(groupName: string): boolean {
  return groupName.startsWith(SHOP_GROUP_PREFIX);
}

export function extractShopName(groupName: string): string | null {
  const match = groupName.match(/店铺组_(.+)/);
  if (match) {
    return match[1].replace(/加盟|直营/g, '').trim() || null;
  }
  return null;
}

// ============================================================
// A. 标准权限模型：组织层级 + 5 级数据范围
// ============================================================

// 数据范围：1仅本人 / 2本组织 / 3本组织及下级 / 4指定组织 / 5全局
export interface DataScopePlan {
  dataScope: number;
  includeAll: boolean;        // scope=5：不过滤
  selfOnly: boolean;          // scope=1：仅本人（业务按 create_user_id / userName 过滤）
  orgIds: number[];           // 可见组织节点 id（用于 create_org_id IN 过滤）
  shopNames: string[];        // 可见门店名称（用于 店仓全.店铺名称 IN 过滤）
  shopCodes: string[];        // 可见门店代码（用于 店仓全.店铺代码 IN 过滤）
  resolvedOrg: boolean;       // 是否成功解析出组织边界（false=标准表未配置，调用方应降级旧逻辑）
}

export interface OrgNodeRow {
  org_id: number;
  parent_org_id: number | null;
  org_name: string;
  org_type: string;
  org_level: number;
  ancestors: string | null;
  area_name: string | null;
  warehouse_type: string | null;
  shop_code: string | null;
  shop_name: string | null;
}

// 解析用户最终数据范围：个人级 dataScope > 角色默认 > 旧组名推断
export async function resolveDataScopeValue(pool: sql.ConnectionPool, user: JwtUserPayload): Promise<number> {
  if (typeof user.dataScope === 'number' && user.dataScope >= 1 && user.dataScope <= 5) {
    return user.dataScope;
  }
  // 角色默认
  if (user.roleId) {
    try {
      const r = await pool.request().input('rid', sql.Int, user.roleId)
        .query(`SELECT default_data_scope FROM sys_role WHERE role_id = @rid AND status = 1 AND del_flag = 0`);
      const ds = r.recordset[0]?.default_data_scope;
      if (typeof ds === 'number' && ds >= 1 && ds <= 5) return ds;
    } catch { /* 表未建/未配置 */ }
  }
  // 旧组名推断（标准表完全未配置期；用户组列已删，groupName 恒 ''，此段不再命中）
  // 注意：groupName 为 '' 时不可再视为 admin（旧代码 isAdminGroup('')=false，天然走到 1=仅本人，保持保守）
  // 最终兜底：保守取“仅本人”（scope=1），避免权限意外放大
  return 1;
}

async function getOrgNode(pool: sql.ConnectionPool, orgId: number): Promise<OrgNodeRow | null> {
  try {
    const r = await pool.request().input('oid', sql.Int, orgId)
      .query(`SELECT org_id, parent_org_id, org_name, org_type, org_level, ancestors, area_name, warehouse_type, shop_code, shop_name
              FROM sys_org WHERE org_id = @oid AND del_flag = 0`);
    return r.recordset[0] || null;
  } catch {
    return null;
  }
}

// 从组名解析组织根（标准表未配置 user.orgId 时的兜底：查 UserGroups.org_id，再查 sys_org 区域名）
async function resolveOrgId(pool: sql.ConnectionPool, user: JwtUserPayload): Promise<number | undefined> {
  if (user.orgId) return user.orgId;
  // UserGroups 组级绑定（05 表映射落库）
  try {
    const r = await pool.request().input('gn', sql.NVarChar, user.groupName || '')
      .query(`SELECT TOP 1 org_id FROM UserGroups WHERE name = @gn AND org_id IS NOT NULL`);
    if (r.recordset[0]?.org_id) return r.recordset[0].org_id;
  } catch { /* ignore */ }
  // 组名区域兜底：区经组_郑州 → sys_org 区域节点
  const area = extractManagerArea(user.groupName || '') || (user.groupName || '').match(new RegExp(AREA_PATTERN))?.[1];
  if (area) {
    try {
      const r = await pool.request().input('an', sql.NVarChar, area)
        .query(`SELECT TOP 1 org_id FROM sys_org WHERE org_name = @an AND org_type = 'area' AND del_flag = 0`);
      if (r.recordset[0]?.org_id) return r.recordset[0].org_id;
    } catch { /* ignore */ }
  }
  return undefined;
}

function parseSpecifiedOrgIds(raw: string | null | undefined): number[] {
  if (!raw) return [];
  return raw.split(/[,，]/).map(s => parseInt(s.trim(), 10)).filter(n => Number.isInteger(n) && n > 0);
}

// 核心：构建数据范围计划（可见组织边界 + 可见门店集合）
export async function buildDataScopePlan(pool: sql.ConnectionPool, user: JwtUserPayload): Promise<DataScopePlan> {
  const dataScope = await resolveDataScopeValue(pool, user);
  const plan: DataScopePlan = {
    dataScope,
    includeAll: dataScope === 5,
    selfOnly: dataScope === 1,
    orgIds: [],
    shopNames: [],
    shopCodes: [],
    resolvedOrg: false,
  };
  if (dataScope === 5 || dataScope === 1) {
    plan.resolvedOrg = true; // 5=全局、1=仅本人 均无需组织边界
    return plan;
  }

  const rootOrgId = await resolveOrgId(pool, user);
  if (!rootOrgId) return plan; // resolvedOrg=false → 调用方降级旧逻辑

  const node = await getOrgNode(pool, rootOrgId);
  if (!node) return plan;
  plan.resolvedOrg = true;
  plan.orgIds.push(node.org_id);

  // 组织节点自身若是门店，直接纳入
  if (node.org_type === 'shop' && node.shop_name) {
    plan.shopNames.push(node.shop_name);
    if (node.shop_code) plan.shopCodes.push(node.shop_code);
  }

  // 组织架构只解决管理层级：orgIds 保留组织树推导（管理/审批/任务下发边界）
  // 查看权限（店铺可见性）：scope>=2 时仅由「店铺范围」（org_shop_bind，本组织+全部下级绑定）决定，
  // 不再从组织树子树推导店铺 —— 组织树挂载的店铺只表达管理层级归属。

  if (dataScope === 2) {
    // 仅本组织：只含节点自身（门店用户 = 自己门店）+ 本组织及下级店铺范围绑定
    await appendOrgVisibleBinds(pool, plan, node);
    return plan;
  }

  let rows: { org_id: number; org_type: string; shop_code: string | null; shop_name: string | null }[] = [];
  try {
    if (dataScope === 3) {
      // 本组织及下级（管理边界）：以节点为根的全深度子树，仅收集组织节点（含 shop 节点 id，不推导店铺名）
      const nodePath = (node.ancestors || '') + node.org_id + '/';
      const r = await pool.request().input('p', sql.NVarChar, nodePath)
        .query(`SELECT org_id, org_type, shop_code, shop_name FROM sys_org WHERE ancestors LIKE @p + '%' AND del_flag = 0`);
      rows = r.recordset;
    } else if (dataScope === 4) {
      // 指定组织（管理边界）：指定列表自身 + 其直接门店子级
      const spec = parseSpecifiedOrgIds(user.dataScopeOrgIds);
      if (spec.length === 0) return plan;
      const req = pool.request();
      const placeholders = spec.map((_, i) => '@s' + i).join(', ');
      spec.forEach((id, i) => req.input(`s${i}`, sql.Int, id));
      const r = await req.query(`
        SELECT org_id, org_type, shop_code, shop_name FROM sys_org
        WHERE del_flag = 0 AND (org_id IN (${placeholders})
              OR (parent_org_id IN (${placeholders}) AND org_type = 'shop'))
      `);
      rows = r.recordset;
    }
  } catch (e: any) {
    console.log('[Perm] 组织子树查询失败:', e?.message);
    return plan;
  }

  // 管理边界：收集组织节点（含 shop 节点本身用于管理过滤），但不再把店铺名加入查看店铺集合
  for (const row of rows) {
    if (!plan.orgIds.includes(row.org_id)) plan.orgIds.push(row.org_id);
  }

  // 查看店铺：仅由店铺范围（org_shop_bind 本组织+全部下级绑定）决定
  await appendOrgVisibleBinds(pool, plan, node);

  return plan;
}

// 追加 org_shop_bind 可见店铺到数据范围计划：根组织自身 + 全部下级组织的绑定（上级继承可见）
async function appendOrgVisibleBinds(pool: sql.ConnectionPool, plan: DataScopePlan, node: OrgNodeRow): Promise<void> {
  try {
    const nodePath = (node.ancestors || '') + node.org_id + '/';
    const r = await pool.request()
      .input('root', sql.Int, node.org_id)
      .input('p', sql.NVarChar, nodePath)
      .query(`
        SELECT DISTINCT shop_code, shop_name FROM org_shop_bind b
        WHERE b.org_id = @root
           OR b.org_id IN (
                SELECT org_id FROM sys_org WHERE del_flag = 0 AND (ancestors LIKE @p + '%' OR org_id = @root)
              )
      `);
    for (const row of r.recordset) {
      const sn = String(row.shop_name || '').trim();
      const sc = String(row.shop_code || '').trim();
      if (sn && !plan.shopNames.includes(sn)) plan.shopNames.push(sn);
      if (sc && !plan.shopCodes.includes(sc)) plan.shopCodes.push(sc);
    }
  } catch (e: any) {
    // org_shop_bind 表不存在或查询失败：静默忽略（不影响原有树挂载权限）
    console.log('[Perm] org_shop_bind 查询失败:', e?.message);
  }
}

// 标准店铺过滤（店仓全.店铺名称）：返回 PermissionFilter（null=不过滤；1=0=无任何可见门店）
export async function getShopScopeFilter(pool: sql.ConnectionPool, user: JwtUserPayload): Promise<PermissionFilter> {
  const plan = await buildDataScopePlan(pool, user);
  if (!plan.resolvedOrg || plan.includeAll) {
    return { filter: null, params: [] };
  }
  if (plan.selfOnly) {
    // 仅本人：店铺维度不可用，由业务按 用户名称/create_user_id 处理
    return { filter: null, params: [] };
  }
  if (plan.shopNames.length === 0) {
    return { filter: '1=0', params: [] };
  }
  const params = plan.shopNames.map((n, i) => ({ name: `scShop${i}`, type: sql.NVarChar, value: n }));
  const conds = plan.shopNames.map((_, i) => `店铺名称 = @scShop${i}`).join(' OR ');
  return { filter: `(${conds})`, params };
}

// 标准日志过滤（巡店日志：destination 店铺 + 本人上报）
export async function getLogScopeFilter(pool: sql.ConnectionPool, user: JwtUserPayload): Promise<PermissionFilter> {
  const plan = await buildDataScopePlan(pool, user);
  const params: { name: string; type: any; value: any }[] = [];
  const clauses: string[] = [];
  if (!plan.resolvedOrg || plan.includeAll) {
    return { filter: null, params };
  }
  // 本人上报的记录始终可见
  clauses.push(`(userName = @lgUser OR supervisor = @lgUser)`);
  params.push({ name: 'lgUser', type: sql.NVarChar, value: user.userCode || user.userName || '' });
  if (!plan.selfOnly && plan.shopNames.length > 0) {
    const shopParams = plan.shopNames.map((n, i) => ({ name: `lgShop${i}`, type: sql.NVarChar, value: n }));
    const conds = plan.shopNames.map((_, i) => `destination = @lgShop${i}`).join(' OR ');
    clauses.push(`(destination IN (${plan.shopNames.map((_, i) => `@lgShop${i}`).join(', ')}) OR ${conds})`);
    params.push(...shopParams);
  }
  return { filter: clauses.join(' OR '), params };
}

// ============================================================
// 标准优先统一入口：标准身份可解析 → 走组织层级+数据范围；否则降级旧字符串组名逻辑
// ============================================================

export async function getStandardShopFilter(groupName?: string, user?: JwtUserPayload | null): Promise<PermissionFilter> {
  if (user) {
    try {
      const pool = await getPool();
      const plan = await buildDataScopePlan(pool, user);
      if (plan.includeAll) return { filter: null, params: [] };
      if (plan.selfOnly || !plan.resolvedOrg) {
        // 仅本人或身份未解析：交给旧逻辑（本人场景旧逻辑也能给出用户组店铺）
      } else if (plan.shopNames.length === 0) {
        return { filter: '1=0', params: [] };
      } else {
        return await getShopScopeFilter(pool, user);
      }
    } catch (e: any) {
      console.log('[Perm] 标准过滤降级旧逻辑:', e?.message);
    }
  }
  return getShopPermissionFilter(groupName);
}

export async function getStandardLogFilter(userCode: string, groupName?: string, isAdmin: boolean = false, user?: JwtUserPayload | null): Promise<PermissionFilter> {
  if (user) {
    try {
      const pool = await getPool();
      const plan = await buildDataScopePlan(pool, user);
      if (plan.includeAll) return { filter: null, params: [] };
      if (plan.resolvedOrg && !plan.selfOnly) {
        return await getLogScopeFilter(pool, user);
      }
    } catch (e: any) {
      console.log('[Perm] 标准日志过滤降级旧逻辑:', e?.message);
    }
  }
  return getLogPermissionFilter(userCode, groupName, isAdmin);
}

// 标准可见店铺名称列表：组织层级+数据范围可解析 → 返回标准店铺集合；否则降级旧组名逻辑
// 返回语义与 getVisibleShopNames 一致：null=全部可见；[]=无权限；[names]=可见店铺
export async function getStandardVisibleShopNames(pool: sql.ConnectionPool, groupName?: string, user?: JwtUserPayload | null): Promise<string[] | null> {
  if (user) {
    try {
      const plan = await buildDataScopePlan(pool, user);
      if (plan.includeAll) return null;
      if (plan.resolvedOrg) {
        // selfOnly（仅本人）：店铺维度不可用，视为无店铺级可见范围
        return plan.selfOnly ? [] : plan.shopNames;
      }
    } catch (e: any) {
      console.log('[Perm] 标准店铺列表降级旧逻辑:', e?.message);
    }
  }
  return getVisibleShopNames(pool, groupName);
}

// ============================================================
// B. 旧字符串组名逻辑（兜底，保持原语义）
// ============================================================

export async function getShopPermissionFilter(groupName?: string): Promise<PermissionFilter> {
  console.log('=== getShopPermissionFilter ===');
  console.log('groupName:', groupName);

  if (!groupName || typeof groupName !== 'string') {
    console.log('返回: 无用户组，拒绝访问');
    return { filter: '1=0', params: [] };
  }

  if (isAdminGroup(groupName)) {
    console.log('返回: 管理员，不过滤');
    return { filter: null, params: [] };
  }

  // 查 GroupPermissions 表 → 该用户组配置的所有店铺
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('groupName', sql.NVarChar, groupName)
      .query(`SELECT shopName FROM GroupPermissions WHERE groupName = @groupName`);

    const allowedShops = result.recordset.map((row: any) => row.shopName);
    console.log('GroupPermissions 查询结果数量:', allowedShops.length);

    if (allowedShops.length > 0) {
      const params = allowedShops.map((shopName: string, index: number) => ({
        name: `shop${index}`,
        type: sql.NVarChar,
        value: shopName
      }));
      const shopConditions = allowedShops.map((_: string, index: number) => `店铺名称 = @shop${index}`).join(' OR ');
      console.log('返回: GroupPermissions 配置的店铺');
      return { filter: `(${shopConditions})`, params };
    }
  } catch (error) {
    console.log('GroupPermissions表查询失败');
  }

  console.log('返回: 无匹配权限，拒绝访问');
  return { filter: '1=0', params: [] };
}

export async function getPermissionFilterFromDB(pool: sql.ConnectionPool, groupName?: string): Promise<PermissionFilter> {
  if (!groupName || typeof groupName !== 'string') {
    return { filter: '1=0', params: [] };
  }
  if (isAdminGroup(groupName)) {
    return { filter: null, params: [] };
  }

  // 优先用 getShopPermissionFilter（已改为模式匹配优先）
  return getShopPermissionFilter(groupName);
}

// 返回用户组可见的店铺名称列表（与 getShopPermissionFilter 同一套逻辑）
// null = 全部可见（管理员）；[] = 无权限；[names] = 有权限的店铺列表
export async function getVisibleShopNames(pool: sql.ConnectionPool, groupName?: string): Promise<string[] | null> {
  const gn = (typeof groupName === 'string' ? groupName : '').trim();
  if (!gn || isAdminGroup(gn)) return null;

  // 查 GroupPermissions 表 → 该用户组配置的所有店铺
  try {
    const result = await pool.request()
      .input('groupName', sql.NVarChar, gn)
      .query(`SELECT shopName FROM GroupPermissions WHERE groupName = @groupName`);
    const shops = result.recordset.map((r: any) => String(r.shopName || '').trim()).filter(Boolean);
    if (shops.length > 0) return shops;
  } catch { /* ignore */ }

  return [];
}

// 判断用户角色（用于审批/目标等按角色校验）
// 【2026-09 下线用户组】优先按 JWT 标准角色并集（roleCodes）判定：
//   super_admin / data_admin / it        → admin
//   area_manager / region_director / ops_director → districtManager
//   其余（supervisor / shop_manager / staff 等） → supervisor（保守）
// 兼容旧身份：用户全.管理员='是' 也视为 admin。
// 旧组名逻辑（查组内成员匹配区经/督导）已删除——用户组列物理删除。
// 注意：groupName 传空或无 user 时保守返回 'supervisor'，不再有"空组名=admin"漏洞。
export async function getUserGroupRole(pool: sql.ConnectionPool, groupName?: string, user?: JwtUserPayload | null): Promise<'admin' | 'districtManager' | 'supervisor'> {
  const codes = user?.roleCodes && user.roleCodes.length > 0 ? user.roleCodes : (user?.roleCode ? [user.roleCode] : []);
  if (codes.some(c => ['super_admin', 'data_admin', 'it'].includes(c))) return 'admin';
  if (codes.some(c => ['area_manager', 'region_director', 'ops_director'].includes(c))) return 'districtManager';

  // 兼容旧身份：用户全中管理员='是'
  if (user?.userCode) {
    try {
      const adminCheck = await pool.request()
        .input('uc', sql.NVarChar, user.userCode)
        .query("SELECT COUNT(*) as cnt FROM 用户全 WHERE 用户代码 = @uc AND 管理员 = '是'");
      if (adminCheck.recordset[0]?.cnt > 0) return 'admin';
    } catch { /* ignore */ }
  }
  return 'supervisor';
}

export async function getLogPermissionFilter(userCode: string, groupName?: string, isAdmin: boolean = false): Promise<PermissionFilter> {
  console.log('=== getLogPermissionFilter ===');
  console.log('userCode:', userCode);
  console.log('groupName:', groupName);
  console.log('isAdmin:', isAdmin);

  const params: { name: string; type: any; value: any }[] = [];
  const clauses: string[] = [];

  if (isAdmin || (groupName && isAdminGroup(groupName))) {
    console.log('返回: 管理员，不过滤');
    return { filter: null, params };
  }

  if (!groupName) {
    console.log('无用户组，仅显示自己的日志');
    clauses.push(`userName = @userCode OR supervisor = @userCode`);
    params.push({ name: 'userCode', type: sql.NVarChar, value: userCode });
    return { filter: clauses.join(' AND '), params };
  }

  const isManager = isManagerGroup(groupName);
  console.log('isManager:', isManager);

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('groupName', sql.NVarChar, groupName)
      .query(`SELECT shopName FROM GroupPermissions WHERE groupName = @groupName`);

    const allowedShops = result.recordset.map((row: any) => row.shopName);
    
    if (allowedShops.length > 0) {
      console.log('使用 GroupPermissions 配置的店铺进行过滤');
      allowedShops.forEach((shopName: string, index: number) => {
        params.push({ name: `shop${index}`, type: sql.NVarChar, value: shopName });
      });
      const shopConditions = allowedShops.map((_: string, index: number) => `destination = @shop${index}`).join(' OR ');
      
      if (isManager) {
        const managerArea = extractManagerArea(groupName);
        if (managerArea) {
          clauses.push(`(${shopConditions}) OR supervisor IN (SELECT DISTINCT 督导 FROM 店仓全 WHERE 区域 = @managerArea AND ${DEFAULT_WAREHOUSE_FILTER})`);
          params.push({ name: 'managerArea', type: sql.NVarChar, value: managerArea });
        } else {
          clauses.push(`(${shopConditions})`);
        }
      } else {
        const supervisorName = extractSupervisorName(groupName);
        if (supervisorName) {
          clauses.push(`supervisor = @supervisor OR userName = @supervisor`);
          params.push({ name: 'supervisor', type: sql.NVarChar, value: supervisorName });
        } else {
          clauses.push(`(${shopConditions})`);
        }
      }
    } else {
      console.log('使用区域/督导姓名进行过滤');
      
      if (isManager) {
        const managerArea = extractManagerArea(groupName);
        if (managerArea) {
          clauses.push(`supervisor IN (SELECT DISTINCT 督导 FROM 店仓全 WHERE 区域 = @managerArea AND ${DEFAULT_WAREHOUSE_FILTER})`);
          params.push({ name: 'managerArea', type: sql.NVarChar, value: managerArea });
        } else {
          // 无法从组名提取区域，从数据库查找经理的管理范围
          try {
            const p = await getPool();
            const userRes = await p.request().input('uc', sql.NVarChar, userCode).query('SELECT 姓名 FROM 用户全 WHERE 用户帐号 = @uc');
            const userName = userRes.recordset[0]?.姓名 || userCode;
            const areaRes = await p.request().input('mn', sql.NVarChar, userName).query(`SELECT DISTINCT 区域 FROM 店仓全 WHERE 区经 = @mn AND ${DEFAULT_WAREHOUSE_FILTER}`);
            const areas = areaRes.recordset.map((r: any) => r.区域).filter(Boolean);
            if (areas.length > 0) {
              const areaParams = areas.map((a: string, i: number) => {
                params.push({ name: `mgrArea${i}`, type: sql.NVarChar, value: a });
                return `区域 = @mgrArea${i}`;
              });
              clauses.push(`supervisor IN (SELECT DISTINCT 督导 FROM 店仓全 WHERE (${areaParams.join(' OR ')}) AND ${DEFAULT_WAREHOUSE_FILTER})`);
            } else {
              clauses.push(`userName = @userCode OR supervisor = @userCode`);
              params.push({ name: 'userCode', type: sql.NVarChar, value: userCode });
            }
          } catch {
            clauses.push(`userName = @userCode OR supervisor = @userCode`);
            params.push({ name: 'userCode', type: sql.NVarChar, value: userCode });
          }
        }
      } else {
        const supervisorName = extractSupervisorName(groupName);
        if (supervisorName) {
          clauses.push(`supervisor = @supervisor OR userName = @supervisor`);
          params.push({ name: 'supervisor', type: sql.NVarChar, value: supervisorName });
        } else {
          clauses.push(`userName = @userCode OR supervisor = @userCode`);
          params.push({ name: 'userCode', type: sql.NVarChar, value: userCode });
        }
      }
    }
  } catch (error) {
    console.log('GroupPermissions表查询失败');
    
    if (isManager) {
      const managerArea = extractManagerArea(groupName || '');
      if (managerArea) {
        clauses.push(`supervisor IN (SELECT DISTINCT 督导 FROM 店仓全 WHERE 区域 = @managerArea AND ${DEFAULT_WAREHOUSE_FILTER})`);
        params.push({ name: 'managerArea', type: sql.NVarChar, value: managerArea });
      } else {
        try {
          const p2 = await getPool();
          const userRes2 = await p2.request().input('uc', sql.NVarChar, userCode).query('SELECT 姓名 FROM 用户全 WHERE 用户帐号 = @uc');
          const userName2 = userRes2.recordset[0]?.姓名 || userCode;
          const areaRes2 = await p2.request().input('mn', sql.NVarChar, userName2).query(`SELECT DISTINCT 区域 FROM 店仓全 WHERE 区经 = @mn AND ${DEFAULT_WAREHOUSE_FILTER}`);
          const areas2 = areaRes2.recordset.map((r: any) => r.区域).filter(Boolean);
          if (areas2.length > 0) {
            areas2.forEach((a: string, i: number) => {
              params.push({ name: `mgrAreaB${i}`, type: sql.NVarChar, value: a });
            });
            const areaConds = areas2.map((_: string, i: number) => `区域 = @mgrAreaB${i}`).join(' OR ');
            clauses.push(`supervisor IN (SELECT DISTINCT 督导 FROM 店仓全 WHERE (${areaConds}) AND ${DEFAULT_WAREHOUSE_FILTER})`);
          } else {
            clauses.push(`userName = @userCode OR supervisor = @userCode`);
            params.push({ name: 'userCode', type: sql.NVarChar, value: userCode });
          }
        } catch {
          clauses.push(`userName = @userCode OR supervisor = @userCode`);
          params.push({ name: 'userCode', type: sql.NVarChar, value: userCode });
        }
      }
    } else {
      const supervisorName = extractSupervisorName(groupName || '');
      if (supervisorName) {
        clauses.push(`supervisor = @supervisor OR userName = @supervisor`);
        params.push({ name: 'supervisor', type: sql.NVarChar, value: supervisorName });
      } else {
        clauses.push(`userName = @userCode OR supervisor = @userCode`);
        params.push({ name: 'userCode', type: sql.NVarChar, value: userCode });
      }
    }
  }

  console.log('返回:', clauses.join(' AND '));
  return { filter: clauses.join(' AND '), params };
}

export function getMenuItems(isAdmin: boolean): MenuItem[] {
  const baseMenuItems: MenuItem[] = [
    { icon: 'LayoutDashboard', label: '仪表盘', path: '/dashboard' },
    { icon: 'BarChart3', label: '销售报表', path: '/reports' },
    { icon: 'BarChart3', label: '对比报表', path: '/comparison' },
    { icon: 'FileText', label: '巡店日志', path: '/logs' },
    { icon: 'ClipboardList', label: '巡店任务', path: '/tasks' },
    { icon: 'Award', label: '评分体系', path: '/scores' },
  ];

  const adminMenuItems: MenuItem[] = [
    { icon: 'Settings', label: '系统维护', path: '/maintenance' },
    { icon: 'Database', label: '数据库连接', path: '/database' },
    { icon: 'Shield', label: '权限管理', path: '/permissions' },
    { icon: 'Store', label: '店铺档案', path: '/shops' },
    { icon: 'Users', label: '用户管理', path: '/users' },
  ];

  if (isAdmin) {
    return [...adminMenuItems, ...baseMenuItems];
  }

  return baseMenuItems;
}

export function getUserGroupType(groupName: string): 'admin' | 'manager' | 'supervisor' | 'other' {
  if (isAdminGroup(groupName)) return 'admin';
  if (isManagerGroup(groupName)) return 'manager';
  if (isSupervisorGroup(groupName)) return 'supervisor';
  return 'other';
}