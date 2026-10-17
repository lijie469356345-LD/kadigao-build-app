import { Router } from 'express';
import multer from 'multer';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { authMiddleware } from '../middlewares/authMiddleware';
import { JwtUserPayload } from '../services/jwt';
import { PORTAL_MENU_ENTRIES, PORTAL_MASTERS, PORTAL_DEFAULT_ROUTES, expandLegacyMenuKeys } from '../services/portalRegistry';
import { loadShopArchiveBaseSQL } from '../services/shopArchiveSource';
import { syncOrgFromArchive, syncFunctionGroupShops } from '../services/orgArchiveSync';
import { exportOrgToXlsx, importOrgFromXlsx } from '../services/orgImportExport';
import { fillOrgFromRoleBindings } from '../services/userStoreBind';
import { syncShopScopeFromTree } from '../services/orgShopScopeSync';
import { exportPermRolesToXlsx, exportPermUsersToXlsx } from '../services/permExport';

const router = Router();

// ============================================================
// 权限管理 CRUD（页面化操作 v3 四表，仅 super_admin/data_admin 可操作）
//  - 组织树增删改/移动、店铺归属绑定
//  - 角色增删改、菜单授权（sys_role_menu）
//  - 用户角色-组织-数据范围分配（sys_user_role）
// 写操作持久化到数据库，重启不会被种子覆盖（种子策略见 permissionSchema）
// ============================================================

/** 权限管理操作者：super_admin / data_admin / it(IT系统维护) / 管理员=是 */
export function isPermAdmin(user?: JwtUserPayload | null): boolean {
  if (!user) return false;
  const codes = user.roleCodes || [];
  if (codes.includes('super_admin') || codes.includes('data_admin') || codes.includes('it')) return true;
  return user.isAdmin === '是';
}

/** 权限管理中间件：全部接口强制鉴权；读接口需管理身份，写接口再行校验 */
export function requirePermAdmin(req: any, res: any, next: any) {
  if (!req.user) {
    return res.status(401).json({ code: 'UNAUTHORIZED', message: '未登录或登录已过期' });
  }
  if (!isPermAdmin(req.user)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: '仅超级管理员/数据管理员可操作权限管理' });
  }
  next();
}

// 仅写操作额外校验；读操作如上
export const requireWrite = requirePermAdmin;

async function computePath(pool: sql.ConnectionPool, orgId: number): Promise<{ level: number; ancestors: string } | null> {
  const r = await pool.request().input('oid', sql.Int, orgId)
    .query(`SELECT org_id, org_level, ancestors FROM sys_org WHERE org_id = @oid`);
  const row = r.recordset[0];
  if (!row) return null;
  return { level: row.org_level || 1, ancestors: row.ancestors || '/' };
}

// ============================================================
// 组织管理
// ============================================================

// 从组织节点推断业务线仓库类别（门店组聚合用）：优先取祖先链上的 director（总监）节点名，
// 门店组直营→直营、门店组加盟→加盟、门店组山东→山东直营；祖先缺失时退回按节点名关键字判断。
function resolveWarehouseTypeFromName(name: string): string {
  if (!name) return '';
  if (name.includes('山东')) return '山东直营';
  if (name.includes('加盟')) return '加盟';
  if (name.includes('直营')) return '直营';
  return '';
}

// 门店组（shop_group）节点聚合归属用户数：取该业务线全部 shop 组织名（去重）与 用户全.组织 精确匹配
async function countShopGroupUsers(pool: sql.ConnectionPool, node: any, allById: Map<number, any>): Promise<number> {
  // 祖先链 director 节点名
  let lineageName = '';
  const ids = String(node.ancestors || '').split('/').filter(Boolean).map(Number);
  for (const id of ids) {
    const n = allById.get(id);
    if (n && n.org_type === 'director') { lineageName = n.org_name || ''; break; }
  }
  const wt = resolveWarehouseTypeFromName(lineageName) || resolveWarehouseTypeFromName(node.org_name || '');
  if (!wt) return 0;
  const r = await pool.request().input('wt', sql.NVarChar, wt).query(`
    SELECT COUNT(*) AS n FROM 用户全
    WHERE ISNULL(组织,'') <> '' AND 组织 <> '公司'
      AND 组织 IN (SELECT DISTINCT org_name FROM sys_org WHERE del_flag = 0 AND org_type = 'shop' AND warehouse_type = @wt)
  `);
  return r.recordset[0]?.n || 0;
}

// 组织树全量（含已绑定的 shop 叶子）
router.get('/org/tree', authMiddleware, requirePermAdmin, async (_req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT org_id, parent_org_id, org_name, org_type, org_level, ancestors,
             area_name, warehouse_type, business_line, function_line,
             org_code, shop_code, shop_name, status, del_flag
      FROM sys_org WHERE del_flag = 0 ORDER BY org_level, org_id
    `);
    // 附带用户计数
    const userCnt = await pool.request().query(`
      SELECT org_id, COUNT(*) AS n FROM sys_user_role WHERE org_id IS NOT NULL GROUP BY org_id
    `);
    const userCntMap: Record<number, number> = {};
    for (const row of userCnt.recordset) userCntMap[row.org_id] = row.n;
    // 店铺（shop）节点：userCount 按组织名精确匹配 用户全.组织 的用户数（与 /org/:id/users 组织口径一致，聚合展示层）
    const shopCountMap: Record<string, number> = {};
    {
      const sr = await pool.request().query(`
        SELECT 组织, COUNT(*) AS n FROM 用户全
        WHERE ISNULL(组织, '') <> '' AND 组织 <> '公司'
        GROUP BY 组织
      `);
      for (const row of sr.recordset) shopCountMap[String(row['组织']).trim()] = row.n;
    }
    for (const row of r.recordset) {
      if (row.org_type === 'shop') {
        userCntMap[row.org_id] = shopCountMap[String(row.org_name).trim()] || 0;
      }
    }
    // 门店组（shop_group）节点：按业务线店铺名↔用户店铺 聚合归属用户数（只读聚合，不落库）
    const allById = new Map<number, any>(r.recordset.map((row: any) => [row.org_id, row]));
    const shopGroupNodes = r.recordset.filter((row: any) => row.org_type === 'shop_group');
    for (const node of shopGroupNodes) {
      try {
        userCntMap[node.org_id] = await countShopGroupUsers(pool, node, allById);
      } catch { /* 单节点聚合失败不阻塞整树 */ }
    }
    const nodes = r.recordset.map((row: any) => ({
      ...row,
      userCount: userCntMap[row.org_id] || 0,
    }));
    res.json({ nodes });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 新增组织节点
router.post('/org', authMiddleware, requireWrite, async (req, res) => {
  try {
    const { parentId, name, orgType, businessLine, functionLine, warehouseType, orgCode } = req.body || {};
    if (!parentId || !name || !orgType) {
      return res.status(400).json({ message: 'parentId/name/orgType 必填' });
    }
    const pool = await getPool();
    const parentMeta = await computePath(pool, Number(parentId));
    if (!parentMeta) return res.status(404).json({ message: '父组织不存在' });

    // 同名保护（同父下不允许重名）
    const dup = await pool.request()
      .input('pp', sql.Int, Number(parentId))
      .input('nm', sql.NVarChar, name)
      .query(`SELECT org_id FROM sys_org WHERE parent_org_id = @pp AND org_name = @nm AND del_flag = 0`);
    if (dup.recordset.length > 0) return res.status(400).json({ message: '同层级已存在同名组织' });

    const level = parentMeta.level + 1;
    const ancestors = parentMeta.ancestors + String(Number(parentId)) + '/';
    const r = await pool.request()
      .input('pp', sql.Int, Number(parentId))
      .input('nm', sql.NVarChar, name)
      .input('typ', sql.NVarChar, orgType)
      .input('lvl', sql.Int, level)
      .input('anc', sql.NVarChar, ancestors)
      .input('bl', sql.NVarChar, businessLine || null)
      .input('fl', sql.NVarChar, functionLine || null)
      .input('wt', sql.NVarChar, warehouseType || null)
      .input('oc', sql.NVarChar, orgCode || null)
      .query(`
        INSERT INTO sys_org (parent_org_id, org_name, org_type, org_level, ancestors,
                             business_line, function_line, warehouse_type, org_code)
        OUTPUT INSERTED.org_id
        VALUES (@pp, @nm, @typ, @lvl, @anc, @bl, @fl, @wt, @oc)
      `);
    res.json({ orgId: r.recordset[0].org_id, level, ancestors });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 更新组织节点（名称/类型/业务线/职能线/仓库类别）
router.put('/org/:id', authMiddleware, requireWrite, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, orgType, businessLine, functionLine, warehouseType, orgCode } = req.body || {};
    const pool = await getPool();
    const cur = await pool.request().input('oid', sql.Int, id)
      .query(`SELECT org_id, parent_org_id, org_name, org_type FROM sys_org WHERE org_id = @oid AND del_flag = 0`);
    if (cur.recordset.length === 0) return res.status(404).json({ message: '组织不存在' });
    const node = cur.recordset[0];

    // 换名防重（同父）
    if (name && name !== node.org_name) {
      const dup = await pool.request()
        .input('oid', sql.Int, id)
        .input('pp', sql.Int, node.parent_org_id)
        .input('nm', sql.NVarChar, name)
        .query(`SELECT org_id FROM sys_org WHERE parent_org_id = @pp AND org_name = @nm AND org_id <> @oid AND del_flag = 0`);
      if (dup.recordset.length > 0) return res.status(400).json({ message: '同层级已存在同名组织' });
    }

    await pool.request()
      .input('oid', sql.Int, id)
      .input('nm', sql.NVarChar, name ?? node.org_name)
      .input('typ', sql.NVarChar, orgType ?? node.org_type)
      .input('bl', sql.NVarChar, businessLine ?? null)
      .input('fl', sql.NVarChar, functionLine ?? null)
      .input('wt', sql.NVarChar, warehouseType ?? null)
      .input('oc', sql.NVarChar, orgCode ?? null)
      .query(`
        UPDATE sys_org SET org_name = @nm, org_type = @typ,
          business_line = ISNULL(@bl, business_line), function_line = ISNULL(@fl, function_line),
          warehouse_type = ISNULL(@wt, warehouse_type), org_code = ISNULL(@oc, org_code),
          update_time = GETDATE()
        WHERE org_id = @oid
      `);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 移动组织节点（换父级，级联重算子树 ancestors/level）
router.put('/org/:id/move', authMiddleware, requireWrite, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const newParentId = Number(req.body?.parentId);
    if (!newParentId) return res.status(400).json({ message: 'parentId 必填' });
    if (id === newParentId) return res.status(400).json({ message: '不能移动到自身' });
    const pool = await getPool();

    const self = await computePath(pool, id);
    if (!self) return res.status(404).json({ message: '组织不存在' });
    const newParent = await computePath(pool, newParentId);
    if (!newParent) return res.status(404).json({ message: '目标父组织不存在' });

    const selfPath = self.ancestors + String(id) + '/';
    const targetPath = newParent.ancestors + String(newParentId) + '/';
    // 目标父节点是否在本节点子树内（环路检测）
    if (targetPath.startsWith(selfPath)) {
      return res.status(400).json({ message: '不能移动到自己的下级' });
    }

    // 同父保护：同名检查
    const dup = await pool.request()
      .input('oid', sql.Int, id)
      .input('pp', sql.Int, newParentId)
      .input('nm', sql.NVarChar, (await pool.request().input('oid2', sql.Int, id).query(`SELECT org_name FROM sys_org WHERE org_id = @oid2`)).recordset[0]?.org_name ?? '')
      .query(`SELECT org_id FROM sys_org WHERE parent_org_id = @pp AND org_name = @nm AND org_id <> @oid AND del_flag = 0`);
    if (dup.recordset.length > 0) return res.status(400).json({ message: '目标层级已存在同名组织' });

    const oldPath = self.ancestors + String(id) + '/';
    const newPath = newParent.ancestors + String(newParentId) + '/';
    const levelDelta = (newParent.level + 1) - self.level;

    // 事务：更新自身 + 级联更新子树（descendants 替换前缀）
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await tx.request()
        .input('oid', sql.Int, id)
        .input('anc', sql.NVarChar, newPath)
        .input('pp', sql.Int, newParentId)
        .input('lvl', sql.Int, newParent.level + 1)
        .query(`UPDATE sys_org SET ancestors = @anc, parent_org_id = @pp, org_level = @lvl, update_time = GETDATE() WHERE org_id = @oid`);

      await tx.request()
        .input('old', sql.NVarChar, oldPath)
        .input('new', sql.NVarChar, newPath)
        .input('ld', sql.Int, levelDelta)
        .query(`
          UPDATE sys_org SET ancestors = @new + SUBSTRING(ancestors, LEN(@old) + 1, 8000),
                             org_level = org_level + @ld, update_time = GETDATE()
          WHERE ancestors LIKE @old + '%'
        `);
      await tx.commit();
    } catch (txErr) {
      await tx.rollback();
      throw txErr;
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 删除组织节点（软删；有子节点/用户绑定/店铺范围/审批流/组织列引用则拒绝）
router.delete('/org/:id', authMiddleware, requireWrite, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const pool = await getPool();
    const cur = await pool.request().input('oid', sql.Int, id)
      .query(`SELECT org_id, org_name, org_type FROM sys_org WHERE org_id = @oid AND del_flag = 0`);
    if (cur.recordset.length === 0) return res.status(404).json({ message: '组织不存在' });
    const node = cur.recordset[0];
    if (node.org_type === 'company') return res.status(400).json({ message: '公司根节点不可删除' });

    const child = await pool.request().input('oid', sql.Int, id)
      .query(`SELECT TOP 1 org_id FROM sys_org WHERE parent_org_id = @oid AND del_flag = 0`);
    if (child.recordset.length > 0) return res.status(400).json({ message: '存在子组织，请先移动或删除子组织' });

    const usage = await pool.request().input('oid', sql.Int, id)
      .query(`SELECT TOP 1 id FROM sys_user_role WHERE org_id = @oid`);
    if (usage.recordset.length > 0) return res.status(400).json({ message: '该组织下存在用户角色绑定，请先调整用户归属' });

    // 店铺范围绑定引用（org_shop_bind：本组织可见绑定，与树挂载解耦）
    const scopeBind = await pool.request().input('oid', sql.Int, id)
      .query(`SELECT TOP 1 shop_code FROM org_shop_bind WHERE org_id = @oid`);
    if (scopeBind.recordset.length > 0) {
      return res.status(400).json({ message: `该组织存在店铺范围绑定（${scopeBind.recordset[0].shop_code}），请先在「店铺管理」中解除绑定` });
    }

    // 审批流适用范围引用（org_id/org_name 单组织 + org_ids/org_names/cc_orgs 列表字段）
    const flowRef = await pool.request()
      .input('oid', sql.Int, id)
      .input('nm', sql.NVarChar, node.org_name)
      .query(`
        SELECT TOP 1 id FROM ApprovalFlow WHERE
          org_id = @oid OR org_name = @nm
          OR (',' + ISNULL(org_ids, '') + ',') LIKE '%,' + CAST(@oid AS VARCHAR(20)) + ',%'
          OR org_ids LIKE '%"' + CAST(@oid AS VARCHAR(20)) + '"%'
          OR (',' + ISNULL(org_names, '') + ',') LIKE '%,' + @nm + ',%'
          OR org_names LIKE '%"' + @nm + '"%'
          OR (',' + ISNULL(cc_orgs, '') + ',') LIKE '%,' + @nm + ',%'
      `);
    if (flowRef.recordset.length > 0) return res.status(400).json({ message: '该组织被审批流「适用范围」引用，请先在审批流中调整' });

    // 用户「组织」列按组织名引用
    const userRef = await pool.request().input('nm', sql.NVarChar, node.org_name)
      .query(`SELECT TOP 1 用户代码 FROM 用户全 WHERE 组织 = @nm`);
    if (userRef.recordset.length > 0) {
      return res.status(400).json({ message: `仍有用户的「组织」列指向「${node.org_name}」，请先在用户管理中调整归属` });
    }

    await pool.request().input('oid', sql.Int, id)
      .query(`UPDATE sys_org SET del_flag = 1, status = 0, update_time = GETDATE() WHERE org_id = @oid`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 店铺归属（店仓全 ↔ org_type='shop' 叶子节点）
// ============================================================

// 店仓全源数据列表 + 已绑定状态
// 数据口径与店铺档案一致（DataExtraction 配置 SQL + 只保留直营/山东直营/加盟），
// 另注入绑定所需业务列（店铺ID/店铺代码/可用状态）
router.get('/shops/source', authMiddleware, requirePermAdmin, async (req, res) => {
  try {
    const pool = await getPool();
    const kw = String(req.query.kw || '').trim();
    const supervisor = String(req.query.supervisor || '').trim();
    const areaManager = String(req.query.areaManager || '').trim();
    const dealer = String(req.query.dealer || '').trim();
    const area = String(req.query.area || '').trim();
    const warehouseType = String(req.query.warehouseType || '').trim();
    // 本组织可见绑定（org_shop_bind 多对多：组织人眼可见店铺的绑定，与树挂载解耦）
    const targetOrgId = req.query.orgId ? Number(req.query.orgId) : NaN;
    const baseSQL = await loadShopArchiveBaseSQL(pool);
    const fromMatch = baseSQL.match(/\bFROM\b/i);
    const bizCols = ', 店铺ID as shopId, 店铺代码 as shopCode, 可用状态 as available';
    const fullSQL = fromMatch && fromMatch.index
      ? baseSQL.slice(0, fromMatch.index) + bizCols + ' ' + baseSQL.slice(fromMatch.index)
      : baseSQL;
    const r = await pool.request()
      .input('kw', sql.NVarChar, `%${kw}%`)
      .input('sup', sql.NVarChar, supervisor)
      .input('am', sql.NVarChar, areaManager)
      .input('dl', sql.NVarChar, dealer)
      .input('ar', sql.NVarChar, area)
      .input('wt', sql.NVarChar, warehouseType)
      .query(`
        SELECT TOP 500 shopId, shopName, shopCode, available, warehouseType, area, districtManager, supervisor, dealer
        FROM ( ${fullSQL} ) t
        WHERE (@kw = '%%' OR shopCode LIKE @kw OR shopName LIKE @kw)
          AND (@sup = '' OR supervisor = @sup)
          AND (@am = '' OR districtManager = @am)
          AND (@dl = '' OR dealer = @dl)
          AND (@ar = '' OR area = @ar)
          AND (@wt = '' OR warehouseType = @wt)
        ORDER BY shopCode
      `);
    // 已绑定映射（树挂载）：shop_code -> orgId
    const bound = await pool.request().query(`
      SELECT shop_code, org_id, org_name FROM sys_org WHERE org_type = 'shop' AND del_flag = 0 AND shop_code IS NOT NULL
    `);
    const boundMap: Record<string, { orgId: number; orgName: string }> = {};
    for (const b of bound.recordset) {
      const code = String(b.shop_code || '').trim();
      if (code) boundMap[code] = { orgId: b.org_id, orgName: b.org_name || '' };
    }
    // 本组织可见绑定集合（org_shop_bind）
    let visibleBoundSet = new Set<string>();
    if (Number.isInteger(targetOrgId) && targetOrgId > 0) {
      const vb = await pool.request().input('oid', sql.Int, targetOrgId)
        .query(`SELECT shop_code FROM org_shop_bind WHERE org_id = @oid`);
      for (const v of vb.recordset) {
        const code = String(v.shop_code || '').trim();
        if (code) visibleBoundSet.add(code);
      }
    }
    const shops = r.recordset.map((row: any) => {
      const code = String(row.shopCode || '').trim();
      return {
        shopId: row.shopId,
        shopName: row.shopName,
        shopCode: row.shopCode,
        available: row.available,
        warehouseType: row.warehouseType || '',
        areaManager: row.districtManager || '',
        supervisor: row.supervisor || '',
        dealer: row.dealer || '',
        area: row.area || '',
        boundOrgId: boundMap[code]?.orgId ?? null,
        boundOrgName: boundMap[code]?.orgName ?? null,
        visibleBound: visibleBoundSet.has(code), // 本组织已可见绑定（禁止重复绑）
      };
    });
    res.json({ shops, total: shops.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 店仓筛选器取值（督导/区经/经销商/区域/仓库类别），口径与店铺档案一致
router.get('/shops/filters', authMiddleware, requirePermAdmin, async (_req, res) => {
  try {
    const pool = await getPool();
    const baseSQL = await loadShopArchiveBaseSQL(pool);
    const loadDistinct = async (col: string) => {
      const r = await pool.request().query(
        `SELECT DISTINCT [${col}] AS v FROM ( ${baseSQL} ) t WHERE ISNULL([${col}], '') <> '' ORDER BY [${col}]`
      );
      return r.recordset.map((x: any) => x.v);
    };
    const [supervisors, areaManagers, dealers, areas, warehouseTypes] = await Promise.all([
      loadDistinct('supervisor'),
      loadDistinct('districtManager'),
      loadDistinct('dealer'),
      loadDistinct('area'),
      loadDistinct('warehouseType'),
    ]);
    res.json({ filters: { supervisors, areaManagers, dealers, areas, warehouseTypes } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 店铺档案轻量列表（供用户管理新增/编辑弹窗「店铺」下拉 + 模糊搜索）
// storeName 保留档案原始店名（含 _ZY/_JM 后缀），与店铺档案 shopName、用户全.组织 列取值口径一致
router.get('/shops/options', authMiddleware, requirePermAdmin, async (req, res) => {
  try {
    const pool = await getPool();
    const kw = String(req.query.kw || '').trim();
    const warehouseType = String(req.query.warehouseType || '').trim();
    const baseSQL = await loadShopArchiveBaseSQL(pool);
    const fromMatch = baseSQL.match(/\bFROM\b/i);
    const bizCols = ', 店铺ID as shopId, 店铺代码 as shopCode, 可用状态 as available';
    const fullSQL = fromMatch && fromMatch.index
      ? baseSQL.slice(0, fromMatch.index) + bizCols + ' ' + baseSQL.slice(fromMatch.index)
      : baseSQL;
    const r = await pool.request()
      .input('kw', sql.NVarChar, `%${kw}%`)
      .input('wt', sql.NVarChar, warehouseType)
      .query(`
        SELECT TOP 500 shopId, shopName, shopCode, available, warehouseType, area, districtManager, supervisor, dealer
        FROM ( ${fullSQL} ) t
        WHERE (@kw = '%%' OR shopCode LIKE @kw OR shopName LIKE @kw)
          AND (@wt = '' OR warehouseType = @wt)
        ORDER BY shopName
      `);
    const shops = r.recordset.map((row: any) => ({
      shopId: row.shopId,
      storeName: String(row.shopName || '').trim(), // 保留 _ZY/_JM 后缀，与档案 shopName 一致
      shopCode: row.shopCode,
      available: row.available,
      warehouseType: row.warehouseType || '',
      area: row.area || '',
      districtManager: row.districtManager || '',
      supervisor: row.supervisor || '',
      dealer: row.dealer || '',
    }));
    res.json({ shops });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 从店铺档案自动同步组织架构（dryRun 预览 / 正式执行；支持直营/加盟/山东直营多业务线）
router.post('/org/sync-archive', authMiddleware, requireWrite, async (req, res) => {
  try {
    const pool = await getPool();
    const dryRun = req.body?.dryRun !== false; // 默认预览，不落库
    const parentOrgId = req.body?.parentOrgId ? Number(req.body.parentOrgId) : null;
    const warehouseType = req.body?.warehouseType || '直营';
    const dealerLevel = req.body?.dealerLevel !== false; // 默认 True：加盟等业务线启用经销商层级
    // dealerGroupPrefix 已废弃（用户组列已删，经销商识别改走 dealer 角色+组织反推），保留传参兼容前端
    const result = await syncOrgFromArchive(pool, { dryRun, parentOrgId, warehouseType, dealerLevel });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 组织架构导出（xlsx 文件流，可直接回导）
router.get('/org/export', authMiddleware, requirePermAdmin, async (_req, res) => {
  try {
    const pool = await getPool();
    const out = await exportOrgToXlsx(pool);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(out.filename)}`);
    res.send(out.buffer);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 组织架构导入（multipart 文件 + mode: diff差异调整/replace清除重建 + dryRun 预览，
// 校验/幂等/事务回滚/层级重建；导入后组织架构与最新文件保持一致，文件外节点软删并清理悬空绑定）
const orgImportUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.post('/org/import', authMiddleware, requireWrite, orgImportUpload.single('file'), async (req: any, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ message: '缺少上传文件（字段名 file）' });
    const name = (file.originalname || '').toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      return res.status(400).json({ message: '仅支持 .xlsx / .xls 文件' });
    }
    const dryRun = req.body?.dryRun === 'true' || req.body?.dryRun === true;
    const mode = req.body?.mode === 'replace' ? 'replace' : 'diff';
    const pool = await getPool();
    const result = await importOrgFromXlsx(pool, file.buffer, { dryRun, mode });
    if (!result.ok && result.errors.length === 0) {
      return res.status(500).json({ ...result, message: '导入失败' });
    }
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 职能组门店镜像：把某仓库类别全部店铺按档案口径绑定到指定职能组（如会员组直营/商品组直营），幂等可反复执行
router.post('/org/mirror-shops', authMiddleware, requireWrite, async (req, res) => {
  try {
    const pool = await getPool();
    const dryRun = req.body?.dryRun !== false; // 默认预览，不落库
    const warehouseType = req.body?.warehouseType || '直营';
    const groupOrgIds: number[] = Array.isArray(req.body?.groupOrgIds) ? req.body.groupOrgIds.map(Number) : [];
    const result = await syncFunctionGroupShops(pool, { dryRun, warehouseType, groupOrgIds });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 绑定一批店铺到组织节点（在该节点下创建 org_type='shop' 叶子）
router.post('/org/:id/shops', authMiddleware, requireWrite, async (req, res) => {
  try {
    const orgId = Number(req.params.id);
    const shopCodes: string[] = Array.isArray(req.body?.shopCodes) ? req.body.shopCodes.map(String) : [];
    if (shopCodes.length === 0) return res.status(400).json({ message: 'shopCodes 必填' });
    const pool = await getPool();

    const orgMeta = await computePath(pool, orgId);
    if (!orgMeta) return res.status(404).json({ message: '组织不存在' });
    // 仅允许挂到非 shop 组织下（organization/shop_group 等）
    const orgInfo = await pool.request().input('oid', sql.Int, orgId)
      .query(`SELECT org_name, org_type FROM sys_org WHERE org_id = @oid AND del_flag = 0`);
    if (orgInfo.recordset.length === 0) return res.status(404).json({ message: '组织不存在' });
    if (orgInfo.recordset[0].org_type === 'shop') return res.status(400).json({ message: '不能挂到店铺节点下' });

    // 批量取店仓信息
    let inserted = 0; let skipped = 0;
    for (const code of shopCodes) {
      // 是否已绑定到其他组织
      const exists = await pool.request().input('sc', sql.NVarChar, code)
        .query(`SELECT org_id FROM sys_org WHERE shop_code = @sc AND del_flag = 0 AND org_type = 'shop'`);
      if (exists.recordset.length > 0) { skipped++; continue; }
      const shop = await pool.request().input('sc', sql.NVarChar, code)
        .query(`SELECT TOP 1 店铺名称, 仓库类别 FROM 店仓全 WHERE 店铺代码 = @sc`);
      const s = shop.recordset[0];
      const shopName = s ? s['店铺名称'] : code;
      const wh = s ? s['仓库类别'] : null;
      const level = orgMeta.level + 1;
      const ancestors = orgMeta.ancestors + String(orgId) + '/';
      await pool.request()
        .input('pp', sql.Int, orgId)
        .input('nm', sql.NVarChar, shopName)
        .input('typ', sql.NVarChar, 'shop')
        .input('lvl', sql.Int, level)
        .input('anc', sql.NVarChar, ancestors)
        .input('sc', sql.NVarChar, code)
        .input('sn', sql.NVarChar, shopName)
        .input('wt', sql.NVarChar, wh || null)
        .query(`
          INSERT INTO sys_org (parent_org_id, org_name, org_type, org_level, ancestors, shop_code, shop_name, warehouse_type, business_line, function_line)
          VALUES (@pp, @nm, @typ, @lvl, @anc, @sc, @sn, @wt, NULL, NULL)
        `);
      inserted++;
    }
    res.json({ ok: true, inserted, skipped });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 解绑店铺（软删 shop 叶子；该组织下有用户引用则拒绝）
router.delete('/org/shops/:shopOrgId', authMiddleware, requireWrite, async (req, res) => {
  try {
    const shopOrgId = Number(req.params.shopOrgId);
    const pool = await getPool();
    const cur = await pool.request().input('oid', sql.Int, shopOrgId)
      .query(`SELECT org_id, org_type FROM sys_org WHERE org_id = @oid AND del_flag = 0`);
    if (cur.recordset.length === 0) return res.status(404).json({ message: '店铺节点不存在' });
    if (cur.recordset[0].org_type !== 'shop') return res.status(400).json({ message: '非店铺节点' });

    const usage = await pool.request().input('oid', sql.Int, shopOrgId)
      .query(`SELECT TOP 1 id FROM sys_user_role WHERE org_id = @oid`);
    if (usage.recordset.length > 0) return res.status(400).json({ message: '该店铺下存在用户角色绑定，请先调整用户归属' });

    await pool.request().input('oid', sql.Int, shopOrgId)
      .query(`UPDATE sys_org SET del_flag = 1, status = 0, update_time = GETDATE() WHERE org_id = @oid`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 组织可见店铺（org_shop_bind 多对多）：与树挂载解耦，支持给同一组织多次绑定多家店
// 绑定后该组织（scope=2/3 时含其下级）的用户在销售/报表等按店铺过滤的接口中可见这些店
// ============================================================

// 本组织已绑定的可见店铺列表
router.get('/org/:id/visible-shops', authMiddleware, requirePermAdmin, async (req, res) => {
  try {
    const orgId = Number(req.params.id);
    if (!Number.isInteger(orgId) || orgId <= 0) return res.status(400).json({ message: 'orgId 无效' });
    const pool = await getPool();
    const r = await pool.request().input('oid', sql.Int, orgId)
      .query(`SELECT org_id, shop_code, shop_name, create_time FROM org_shop_bind WHERE org_id = @oid ORDER BY create_time DESC, shop_code`);
    res.json({ shops: r.recordset.map((x: any) => ({ orgId: x.org_id, shopCode: String(x.shop_code || '').trim(), shopName: x.shop_name || '' })) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 给组织绑定一批可见店铺（允许同一店绑定到多个组织 = 多对多；本组织内重复自动跳过）
router.post('/org/:id/visible-shops', authMiddleware, requireWrite, async (req, res) => {
  try {
    const orgId = Number(req.params.id);
    const shopCodes: string[] = Array.isArray(req.body?.shopCodes) ? req.body.shopCodes.map(String) : [];
    if (!Number.isInteger(orgId) || orgId <= 0) return res.status(400).json({ message: 'orgId 无效' });
    if (shopCodes.length === 0) return res.status(400).json({ message: 'shopCodes 必填' });
    const pool = await getPool();
    const orgInfo = await pool.request().input('oid', sql.Int, orgId)
      .query(`SELECT org_name, org_type FROM sys_org WHERE org_id = @oid AND del_flag = 0`);
    if (orgInfo.recordset.length === 0) return res.status(404).json({ message: '组织不存在' });

    // 批量取店仓信息（店铺名称口径与档案一致，保留 _ZY/_JM 后缀）
    const uniqueCodes = Array.from(new Set(shopCodes));
    let inserted = 0; let skipped = 0;
    for (const code of uniqueCodes) {
      const exists = await pool.request().input('oid', sql.Int, orgId).input('sc', sql.NVarChar, code)
        .query(`SELECT CASE WHEN EXISTS (SELECT 1 FROM org_shop_bind WHERE org_id = @oid AND shop_code = @sc) THEN 1 ELSE 0 END AS hit`);
      if (exists.recordset[0]?.hit === 1) { skipped++; continue; }
      const shop = await pool.request().input('sc', sql.NVarChar, code)
        .query(`SELECT TOP 1 店铺名称 FROM 店仓全 WHERE 店铺代码 = @sc`);
      const shopName = shop.recordset[0] ? String(shop.recordset[0]['店铺名称'] || '').trim() : code;
      await pool.request()
        .input('oid', sql.Int, orgId)
        .input('sc', sql.NVarChar, code)
        .input('sn', sql.NVarChar, shopName)
        .query(`INSERT INTO org_shop_bind (org_id, shop_code, shop_name) VALUES (@oid, @sc, @sn)`);
      inserted++;
    }
    res.json({ ok: true, inserted, skipped });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 解除组织对一批可见店铺的绑定
router.delete('/org/:id/visible-shops', authMiddleware, requireWrite, async (req, res) => {
  try {
    const orgId = Number(req.params.id);
    const raw = req.query?.shopCodes;
    const shopCodes: string[] = Array.isArray(raw) ? raw.map(String) : (typeof raw === 'string' && raw ? raw.split(',') : []);
    if (!Number.isInteger(orgId) || orgId <= 0) return res.status(400).json({ message: 'orgId 无效' });
    if (shopCodes.length === 0) return res.status(400).json({ message: 'shopCodes 必填' });
    const pool = await getPool();
    let removed = 0;
    for (const code of shopCodes) {
      const del = await pool.request().input('oid', sql.Int, orgId).input('sc', sql.NVarChar, code)
        .query(`DELETE FROM org_shop_bind WHERE org_id = @oid AND shop_code = @sc`);
      removed += del.rowsAffected[0] || 0;
    }
    res.json({ ok: true, removed });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 店铺范围同步：把组织架构树的直属挂载店铺固化为店铺范围（org_shop_bind）
// 组织架构只解决管理层级；查看权限走后端 buildDataScopePlan 的店铺范围绑定，
// 因此在组织架构新增/调整店铺挂载后，需执行本接口把挂载店铺同步进店铺范围。
// 幂等（主键判重，仅新增不改不删），可反复执行。
// ============================================================

// 预览：将新增哪些店铺范围绑定（dryRun，不落库）
router.post('/org/shop-scope/preview', authMiddleware, requirePermAdmin, async (_req, res) => {
  try {
    const pool = await getPool();
    const r = await syncShopScopeFromTree(pool, { dryRun: true });
    res.json(r.ok ? { ok: true, plan: { directPlanned: r.directPlanned, selfPlanned: r.selfPlanned, skipped: r.skipped }, warnings: r.warnings } : { ok: false, error: r.warnings.join('; ') });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 执行同步：将组织树直属挂载店铺固化/补齐为店铺范围绑定
router.post('/org/shop-scope/sync', authMiddleware, requireWrite, async (_req, res) => {
  try {
    const pool = await getPool();
    const r = await syncShopScopeFromTree(pool, { dryRun: false });
    res.json(r.ok ? { ok: true, result: { directInserted: r.directInserted, selfInserted: r.selfInserted, skipped: r.skipped }, warnings: r.warnings } : { ok: false, error: r.warnings.join('; ') });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 组织用户归属（组织框架“人头/人数”穿透：只调整 sys_user_role 的 org_id 归属，不改用户表）
// ============================================================

// 某组织下已归属的用户列表（含角色与用户信息）
// 门店组（shop_group）节点：按业务线（直营/加盟/山东直营）组织名 ↔ 用户全.组织 自动聚合归属用户（只读，不落库）
router.get('/org/:id/users', authMiddleware, requirePermAdmin, async (req, res) => {
  try {
    const orgId = Number(req.params.id);
    const pool = await getPool();
    const org = await pool.request().input('oid', sql.Int, orgId)
      .query(`SELECT org_id, org_name, org_type, ancestors FROM sys_org WHERE org_id = @oid AND del_flag = 0`);
    if (org.recordset.length === 0) return res.status(404).json({ message: '组织不存在' });
    const orgRow = org.recordset[0];

    if (orgRow.org_type === 'shop_group') {
      // 祖先链上找 director（总监）节点判定业务线
      const ancIds = String(orgRow.ancestors || '').split('/').filter(Boolean).map(Number);
      let wt = '';
      if (ancIds.length > 0) {
        const dir = await pool.request().query(`
          SELECT TOP 1 org_name FROM sys_org
          WHERE del_flag = 0 AND org_type = 'director' AND org_id IN (${ancIds.join(',')})
        `);
        wt = resolveWarehouseTypeFromName(String(dir.recordset[0]?.org_name || ''));
      }
      if (!wt) wt = resolveWarehouseTypeFromName(String(orgRow.org_name || ''));
      if (!wt) {
        return res.json({ orgId, orgName: orgRow.org_name, userCount: 0, entries: [], autoAggregated: true, reason: '无法判定门店组业务线' });
      }
      const ur = await pool.request().input('wt', sql.NVarChar, wt).query(`
        SELECT DISTINCT u.用户代码 AS user_code, u.用户名称 AS user_name, u.手机号 AS phone,
                        u.组织 AS store_name
        FROM 用户全 u
        WHERE ISNULL(u.组织, '') <> '' AND u.组织 <> '公司'
          AND u.组织 IN (
            SELECT DISTINCT org_name FROM sys_org
            WHERE del_flag = 0 AND org_type = 'shop' AND warehouse_type = @wt
          )
        ORDER BY u.用户名称, u.用户代码
      `);
      const entries = ur.recordset.map((row: any, i: number) => ({
        id: -(i + 1), // 虚拟 id，禁止写库
        user_code: row.user_code, role_id: null, data_scope: null, data_scope_org_ids: null,
        update_time: null, role_name: '按门店自动匹配', role_code: '', default_data_scope: null,
        user_name: row.user_name, phone: row.phone, store_name: row.store_name,
        autoAggregated: true,
      }));
      res.json({
        orgId, orgName: orgRow.org_name, orgType: 'shop_group',
        userCount: entries.length, entries, autoAggregated: true, warehouseType: wt,
      });
      return;
    }

    // 店铺（shop）节点：按 org_name 精确匹配 用户全.组织 聚合归属用户（只读，不落库）
    if (orgRow.org_type === 'shop') {
      const shopName = String(orgRow.org_name || '').trim();
      if (!shopName) {
        return res.json({ orgId, orgName: orgRow.org_name, orgType: 'shop', userCount: 0, entries: [], autoAggregated: true, reason: '店铺组织无名称' });
      }
      const ur = await pool.request().input('nm', sql.NVarChar, shopName).query(`
        SELECT DISTINCT u.用户代码 AS user_code, u.用户名称 AS user_name, u.手机号 AS phone,
                        u.组织 AS store_name
        FROM 用户全 u
        WHERE ISNULL(u.组织, '') <> '' AND u.组织 <> '公司'
          AND u.组织 = @nm
        ORDER BY u.用户名称, u.用户代码
      `);
      const entries = ur.recordset.map((row: any, i: number) => ({
        id: -(i + 1), // 虚拟 id，禁止写库
        user_code: row.user_code, role_id: null, data_scope: null, data_scope_org_ids: null,
        update_time: null, role_name: '按门店自动匹配', role_code: '', default_data_scope: null,
        user_name: row.user_name, phone: row.phone, store_name: row.store_name,
        autoAggregated: true,
      }));
      res.json({
        orgId, orgName: orgRow.org_name, orgType: 'shop',
        userCount: entries.length, entries, autoAggregated: true, matchedStore: shopName,
      });
      return;
    }

    const r = await pool.request().input('oid', sql.Int, orgId).query(`
      SELECT ur.id, ur.user_code, ur.role_id, ur.data_scope, ur.data_scope_org_ids, ur.update_time,
             r.role_name, r.role_code, r.default_data_scope,
             u.用户名称 AS user_name, u.手机号 AS phone, u.组织 AS store_name
      FROM sys_user_role ur
      LEFT JOIN sys_role r ON ur.role_id = r.role_id AND r.del_flag = 0
      LEFT JOIN 用户全 u ON u.用户代码 = ur.user_code
      WHERE ur.org_id = @oid
      ORDER BY ISNULL(u.用户名称, '') , ur.id
    `);
    const userSet = new Set<string>();
    r.recordset.forEach((row: any) => userSet.add(String(row.user_code || '').trim()));
    res.json({
      orgId,
      orgName: orgRow.org_name,
      userCount: userSet.size,
      entries: r.recordset,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 将用户（连同角色）归属到本组织：已存在同用户+角色则挪归属，否则新增记录
router.post('/org/:id/users', authMiddleware, requireWrite, async (req, res) => {
  try {
    const orgId = Number(req.params.id);
    const userCode = String(req.body?.userCode || '').trim();
    const roleId = Number(req.body?.roleId);
    if (!userCode || !roleId) return res.status(400).json({ message: 'userCode/roleId 必填' });
    const pool = await getPool();
    const org = await pool.request().input('oid', sql.Int, orgId)
      .query(`SELECT org_id FROM sys_org WHERE org_id = @oid AND del_flag = 0`);
    if (org.recordset.length === 0) return res.status(404).json({ message: '组织不存在' });
    const role = await pool.request().input('rid', sql.Int, roleId)
      .query(`SELECT role_id FROM sys_role WHERE role_id = @rid AND del_flag = 0`);
    if (role.recordset.length === 0) return res.status(400).json({ message: '角色不存在' });

    const dup = await pool.request()
      .input('uc', sql.NVarChar, userCode)
      .input('rid', sql.Int, roleId)
      .query(`SELECT id, org_id FROM sys_user_role WHERE user_code = @uc AND role_id = @rid`);
    if (dup.recordset.length > 0) {
      const prevOrgId = dup.recordset[0].org_id;
      await pool.request()
        .input('uc', sql.NVarChar, userCode)
        .input('rid', sql.Int, roleId)
        .input('oid', sql.Int, orgId)
        .query(`UPDATE sys_user_role SET org_id = @oid, update_time = GETDATE() WHERE user_code = @uc AND role_id = @rid`);
      return res.json({ ok: true, action: 'moved', prevOrgId: prevOrgId ?? null });
    }
    await pool.request()
      .input('uc', sql.NVarChar, userCode)
      .input('rid', sql.Int, roleId)
      .input('oid', sql.Int, orgId)
      .query(`INSERT INTO sys_user_role (user_code, role_id, org_id) VALUES (@uc, @rid, @oid)`);
    res.json({ ok: true, action: 'inserted' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 调整/移出归属：orgId 传 null 或 '' 表示移出本组织（保留角色，不删记录）
router.put('/org/:id/users/:entryId', authMiddleware, requireWrite, async (req, res) => {
  try {
    const orgId = Number(req.params.id);
    const entryId = Number(req.params.entryId);
    const raw = req.body?.orgId;
    const targetOrgId = raw == null || raw === '' ? null : Number(raw);
    if (targetOrgId !== null && !Number.isFinite(targetOrgId)) {
      return res.status(400).json({ message: 'orgId 无效' });
    }
    const pool = await getPool();
    const cur = await pool.request()
      .input('id', sql.Int, entryId)
      .input('oid', sql.Int, orgId)
      .query(`SELECT id FROM sys_user_role WHERE id = @id AND org_id = @oid`);
    if (cur.recordset.length === 0) return res.status(404).json({ message: '归属记录不存在或不在本组织下' });
    if (targetOrgId !== null && targetOrgId !== orgId) {
      const org = await pool.request().input('oid2', sql.Int, targetOrgId)
        .query(`SELECT org_id FROM sys_org WHERE org_id = @oid2 AND del_flag = 0`);
      if (org.recordset.length === 0) return res.status(400).json({ message: '目标组织不存在' });
    }
    await pool.request()
      .input('id', sql.Int, entryId)
      .input('oid', sql.Int, targetOrgId)
      .query(`UPDATE sys_user_role SET org_id = @oid, update_time = GETDATE() WHERE id = @id`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 彻底删除归属记录（该用户-角色绑定一并移除）
router.delete('/org/:id/users/:entryId', authMiddleware, requireWrite, async (req, res) => {
  try {
    const orgId = Number(req.params.id);
    const entryId = Number(req.params.entryId);
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, entryId)
      .input('oid', sql.Int, orgId)
      .query(`DELETE FROM sys_user_role WHERE id = @id AND org_id = @oid`);
    res.json({ ok: true, deleted: r.rowsAffected[0] > 0 });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 角色管理
// ============================================================

// 角色列表
router.get('/roles', authMiddleware, requirePermAdmin, async (_req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT role_id, role_name, role_code, default_data_scope, status, del_flag,
             (SELECT COUNT(*) FROM sys_user_role ur WHERE ur.role_id = r.role_id) AS userCount,
             (SELECT COUNT(*) FROM sys_role_menu rm WHERE rm.role_id = r.role_id) AS menuCount
      FROM sys_role r WHERE del_flag = 0 ORDER BY role_id
    `);
    res.json({ roles: r.recordset });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 新增角色
router.post('/roles', authMiddleware, requireWrite, async (req, res) => {
  try {
    const { roleName, roleCode, dataScope } = req.body || {};
    if (!roleName || !roleCode) return res.status(400).json({ message: 'roleName/roleCode 必填' });
    if (![1, 2, 3, 4, 5].includes(Number(dataScope))) return res.status(400).json({ message: 'dataScope 必须为 1-5' });
    const pool = await getPool();
    const dup = await pool.request().input('rc', sql.NVarChar, roleCode)
      .query(`SELECT role_id FROM sys_role WHERE role_code = @rc`);
    if (dup.recordset.length > 0) return res.status(400).json({ message: '角色编码已存在' });
    const r = await pool.request()
      .input('rn', sql.NVarChar, roleName)
      .input('rc', sql.NVarChar, roleCode)
      .input('ds', sql.Int, Number(dataScope))
      .query(`INSERT INTO sys_role (role_name, role_code, default_data_scope) OUTPUT INSERTED.role_id VALUES (@rn, @rc, @ds)`);
    res.json({ roleId: r.recordset[0].role_id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 更新角色
router.put('/roles/:id', authMiddleware, requireWrite, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { roleName, roleCode, dataScope, status } = req.body || {};
    const pool = await getPool();
    const cur = await pool.request().input('rid', sql.Int, id)
      .query(`SELECT role_id FROM sys_role WHERE role_id = @rid AND del_flag = 0`);
    if (cur.recordset.length === 0) return res.status(404).json({ message: '角色不存在' });
    if (roleCode) {
      const dup = await pool.request().input('rid', sql.Int, id).input('rc', sql.NVarChar, roleCode)
        .query(`SELECT role_id FROM sys_role WHERE role_code = @rc AND role_id <> @rid`);
      if (dup.recordset.length > 0) return res.status(400).json({ message: '角色编码已存在' });
    }
    await pool.request()
      .input('rid', sql.Int, id)
      .input('rn', sql.NVarChar, roleName ?? null)
      .input('rc', sql.NVarChar, roleCode ?? null)
      .input('ds', sql.Int, dataScope !== undefined && dataScope !== null ? Number(dataScope) : null)
      .input('st', sql.Int, status !== undefined && status !== null ? Number(status) : null)
      .query(`
        UPDATE sys_role SET
          role_name = ISNULL(@rn, role_name),
          role_code = ISNULL(@rc, role_code),
          default_data_scope = ISNULL(@ds, default_data_scope),
          status = ISNULL(@st, status),
          update_time = GETDATE()
        WHERE role_id = @rid
      `);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 删除角色（软删；有用户引用则拒绝）
router.delete('/roles/:id', authMiddleware, requireWrite, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const pool = await getPool();
    const cur = await pool.request().input('rid', sql.Int, id)
      .query(`SELECT role_id, role_code FROM sys_role WHERE role_id = @rid AND del_flag = 0`);
    if (cur.recordset.length === 0) return res.status(404).json({ message: '角色不存在' });
    const role = cur.recordset[0];
    if (['super_admin', 'data_admin', 'boss', 'it'].includes(role.role_code)) {
      return res.status(400).json({ message: '内置角色不可删除' });
    }
    const usage = await pool.request().input('rid', sql.Int, id)
      .query(`SELECT TOP 1 id FROM sys_user_role WHERE role_id = @rid`);
    if (usage.recordset.length > 0) return res.status(400).json({ message: '该角色存在用户绑定，请先调整用户角色' });

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await tx.request().input('rid', sql.Int, id)
        .query(`UPDATE sys_role SET del_flag = 1, status = 0, update_time = GETDATE() WHERE role_id = @rid`);
      await tx.request().input('rid', sql.Int, id)
        .query(`DELETE FROM sys_role_menu WHERE role_id = @rid`);
      await tx.commit();
    } catch (txErr) {
      await tx.rollback();
      throw txErr;
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 菜单目录（主门户→门户+菜单，供授权勾选）
router.get('/menu-catalog', authMiddleware, requirePermAdmin, async (_req, res) => {
  const portals = new Map<string, { portalEn: string; portalCn: string; masterPortalEn: string; masterPortalCn: string; menus: { menuEn: string; menuCn: string; routePath: string }[] }>();
  for (const entry of PORTAL_MENU_ENTRIES) {
    if (entry.isMenu === false) continue; // 跳过子表/明细表
    let p = portals.get(entry.portalEn);
    if (!p) {
      p = {
        portalEn: entry.portalEn, portalCn: entry.portalCn,
        masterPortalEn: entry.masterPortalEn || '', masterPortalCn: entry.masterPortalCn || '',
        menus: [],
      };
      portals.set(entry.portalEn, p);
    }
    p.menus.push({ menuEn: entry.menuEn, menuCn: entry.menuCn, routePath: entry.routePath || '' });
  }
  const portalList = Array.from(portals.values()).map(p => ({ ...p, defaultRoute: PORTAL_DEFAULT_ROUTES[p.portalEn] || '' }));
  // 按主门户分组（保持主门户顺序，组内门户按注册顺序）
  const masters = PORTAL_MASTERS.map(m => ({
    masterPortalEn: m.masterPortalEn,
    masterPortalCn: m.masterPortalCn,
    portals: portalList.filter(p => p.masterPortalEn === m.masterPortalEn),
  })).filter(m => m.portals.length > 0);
  res.json({ portals: portalList, masters });
});

// 角色已有菜单授权（旧版成长课堂整体授权键自动展开为 8 个分类，保证授权页正确显示已全选）
router.get('/roles/:id/menus', authMiddleware, requirePermAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const pool = await getPool();
    const r = await pool.request().input('rid', sql.Int, id)
      .query(`SELECT portal_en, menu_en FROM sys_role_menu WHERE role_id = @rid`);
    // 前端约定字段为下划线 portal_en/menu_en（见 client/api/adminPerm.ts），展开后转回下划线命名
    res.json({
      grants: expandLegacyMenuKeys(r.recordset.map((row: any) => ({ portalEn: row.portal_en, menuEn: row.menu_en })))
        .map((g) => ({ portal_en: g.portalEn, menu_en: g.menuEn })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 全量替换角色菜单授权（delta：删除旧 + 插入新；页面传完整勾选集合）
router.put('/roles/:id/menus', authMiddleware, requireWrite, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const grants: { portalEn: string; menuEn: string }[] = Array.isArray(req.body?.grants) ? req.body.grants : [];
    // 旧版整体授权键展开为 8 个分类，避免脏数据再次落库
    const expanded = expandLegacyMenuKeys(grants);
    const pool = await getPool();
    const cur = await pool.request().input('rid', sql.Int, id)
      .query(`SELECT role_id FROM sys_role WHERE role_id = @rid AND del_flag = 0`);
    if (cur.recordset.length === 0) return res.status(404).json({ message: '角色不存在' });

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await tx.request().input('rid', sql.Int, id)
        .query(`DELETE FROM sys_role_menu WHERE role_id = @rid`);
      let inserted = 0;
      for (const g of expanded) {
        await tx.request()
          .input('rid', sql.Int, id)
          .input('pe', sql.NVarChar, g.portalEn)
          .input('me', sql.NVarChar, g.menuEn)
          .query(`INSERT INTO sys_role_menu (role_id, portal_en, menu_en) VALUES (@rid, @pe, @me)`);
        inserted++;
      }
      await tx.commit();
      res.json({ ok: true, inserted });
    } catch (txErr) {
      await tx.rollback();
      throw txErr;
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 用户角色-组织-数据范围分配
// ============================================================

// 用户列表（用户全 + sys_user_role 聚合）
router.get('/users', authMiddleware, requirePermAdmin, async (req, res) => {
  try {
    const pool = await getPool();
    const kw = String(req.query.kw || '').trim();
    const r = await pool.request().input('kw', sql.NVarChar, `%${kw}%`)
      .query(`
        SELECT 用户代码, 用户名称, 手机号, 仓库类别, 管理员
        FROM 用户全
        WHERE (@kw = '%%' OR 用户代码 LIKE @kw OR 用户名称 LIKE @kw OR 手机号 LIKE @kw
               OR EXISTS (
                 SELECT 1
                 FROM sys_user_role ur2
                 LEFT JOIN sys_role r2 ON ur2.role_id = r2.role_id AND r2.del_flag = 0
                 LEFT JOIN sys_org o2 ON ur2.org_id = o2.org_id AND o2.del_flag = 0
                 WHERE ur2.user_code = 用户全.用户代码
                   AND (r2.role_name LIKE @kw OR r2.role_code LIKE @kw OR o2.org_name LIKE @kw
                        OR CAST(COALESCE(ur2.data_scope, r2.default_data_scope) AS NVARCHAR(10)) LIKE @kw
                        OR CASE COALESCE(ur2.data_scope, r2.default_data_scope)
                             WHEN 1 THEN '本人数据' WHEN 2 THEN '本组织' WHEN 3 THEN '本组织及下级'
                             WHEN 4 THEN '指定组织' WHEN 5 THEN '全局数据' ELSE '' END LIKE @kw)
               ))
          AND 用户代码 IS NOT NULL AND 用户代码 <> ''
        ORDER BY 用户名称
      `);
    const codes = r.recordset.map((row: any) => String(row['用户代码']).trim()).filter(Boolean);
    const roleMap: Record<string, any[]> = {};
    if (codes.length > 0) {
      for (let i = 0; i < codes.length; i += 200) {
        const chunk = codes.slice(i, i + 200);
        const placeholders = chunk.map((_, j) => `@c${j}`).join(', ');
        const req2 = pool.request();
        chunk.forEach((c, j) => req2.input(`c${j}`, sql.NVarChar, c));
        const ur = await req2.query(`
          SELECT ur.user_code, ur.role_id, ur.org_id, ur.data_scope, ur.data_scope_org_ids,
                 r.role_name, r.role_code, o.org_name AS org_name
          FROM sys_user_role ur
          LEFT JOIN sys_role r ON ur.role_id = r.role_id AND r.del_flag = 0
          LEFT JOIN sys_org o ON ur.org_id = o.org_id AND o.del_flag = 0
          WHERE ur.user_code IN (${placeholders})
          ORDER BY ur.user_code, ur.id
        `);
        for (const row of ur.recordset) {
          const uc = String(row.user_code).trim();
          if (!roleMap[uc]) roleMap[uc] = [];
          roleMap[uc].push({
            roleId: row.role_id, roleName: row.role_name || '', roleCode: row.role_code || '',
            orgId: row.org_id, orgName: row.org_name || '',
            dataScope: row.data_scope, dataScopeOrgIds: row.data_scope_org_ids,
          });
        }
      }
    }
    const users = r.recordset.map((row: any) => {
      const code = String(row['用户代码']).trim();
      return {
        userCode: code,
        userName: row['用户名称'] || '',
        phone: row['手机号'] || '',
        warehouseType: row['仓库类别'] || '',
        isAdmin: row['管理员'] === '是' || row['管理员'] === 1 || row['管理员'] === true,
        roles: roleMap[code] || [],
      };
    });
    res.json({ users });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 【2026-09 下线】按用户组自动回填「店铺」列：用户组列已物理删除，店铺列也随「组织」列方案一并移除。

// 按 sys_user_role 主行绑定同步「用户全.组织」列（保证用户全 ↔ 用户管理组织展示一致；dryRun=true 预览）
router.post('/users/bind-store', authMiddleware, requireWrite, async (req, res) => {
  try {
    const pool = await getPool();
    const dryRun = req.body?.dryRun !== false;
    res.json(await fillOrgFromRoleBindings(pool, { dryRun }));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 全量替换用户角色-组织-数据范围（sys_user_role）
router.put('/users/:code/roles', authMiddleware, requireWrite, async (req, res) => {
  try {
    const userCode = String(req.params.code).trim();
    const roles: { roleId: number; orgId?: number | null; dataScope?: number | null; dataScopeOrgIds?: string | null }[] =
      Array.isArray(req.body?.roles) ? req.body.roles : [];
    if (!userCode) return res.status(400).json({ message: '用户代码不能为空' });
    const pool = await getPool();

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await tx.request().input('uc', sql.NVarChar, userCode)
        .query(`DELETE FROM sys_user_role WHERE user_code = @uc`);
      let inserted = 0;
      for (const role of roles) {
        const rid = Number(role.roleId);
        if (!rid) continue;
        await tx.request()
          .input('uc', sql.NVarChar, userCode)
          .input('rid', sql.Int, rid)
          .input('oid', sql.Int, role.orgId ?? null)
          .input('ds', sql.Int, role.dataScope ?? null)
          .input('dsids', sql.NVarChar, role.dataScopeOrgIds ?? null)
          .query(`
            INSERT INTO sys_user_role (user_code, role_id, org_id, data_scope, data_scope_org_ids)
            VALUES (@uc, @rid, @oid, @ds, @dsids)
          `);
        inserted++;
      }
      await tx.commit();
      res.json({ ok: true, inserted });
    } catch (txErr) {
      await tx.rollback();
      throw txErr;
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 权限管理导出（xlsx 文件流；tab=roles 角色+菜单授权 / tab=users 用户角色分配）
// ============================================================
router.get('/export', authMiddleware, requirePermAdmin, async (req, res) => {
  try {
    const tab = String(req.query.tab || 'roles');
    const kw = String(req.query.kw || '').trim();
    const pool = await getPool();
    const out = tab === 'users'
      ? await exportPermUsersToXlsx(pool, kw)
      : await exportPermRolesToXlsx(pool);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(out.filename)}`);
    res.send(out.buffer);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;