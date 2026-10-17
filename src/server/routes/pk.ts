import { Router } from 'express';
import multer from 'multer';
import sql from 'mssql';
import * as XLSX from 'xlsx';
import { getPool } from '../../config/db';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireMenuPerm, requireAnyMenuPerm } from '../middlewares/menuPermMiddleware';
import { getQueryFromDX } from './reports';

// ============================================================
// PK管理 模块
//  - PK_TaskOrders    PK任务单：任务单名称/制单日期/PK日期/PK截止/备注
//                     删除任务单时级联删除其下店铺目标与维度
//  - PK_Dimensions    维度设定：按任务单隔离，维度一行 + values(候选值 JSON) + groups(PK组别 JSON)
//  - PK_StoreTargets  店铺目标：必须关联任务单（taskOrderId），PK名称/开始时间由任务单带出
//  - PK报表           按任务单选择，维度取自该任务单，业绩取 有效业绩全
// ============================================================

const router = Router();

// ============================================================
// 组织视角可见店铺：非特权用户可见店铺 = 其绑定组织及其全部下级组织
//  在 org_shop_bind 中绑定的店铺（上级继承下级的绑定，与 permissionService
//  appendOrgVisibleBinds 语义一致）。登录 userCode → sys_user_role.org_id
//  （该用户全部绑定组织，del_flag=0）→ 每个绑定组织自身 + 组织树子树下
//  全部 org_shop_bind.shop_name 并集去重。
//  注意：不依赖组织树下挂载的 shop 节点是否 del_flag=0（商品线组织树下
//  店铺节点 del_flag=1 但 org_shop_bind 有绑定，旧查询会漏），
//  店铺可见性完全由 org_shop_bind 授权表决定。
// ============================================================
async function getScopeShopNamesByBind(pool: sql.ConnectionPool, userCode: string): Promise<string[]> {
  const ur = await pool.request()
    .input('uc', sql.NVarChar, String(userCode))
    .query(`
      SELECT DISTINCT ro.org_id, ro.ancestors
      FROM sys_user_role ur
      JOIN sys_org ro ON ro.org_id = ur.org_id AND ro.del_flag = 0
      WHERE ur.user_code = @uc
    `);
  const shopSet = new Set<string>();
  for (const row of ur.recordset) {
    const nodePath = (row.ancestors || '') + String(row.org_id) + '/';
    const binds = await pool.request()
      .input('root', sql.Int, row.org_id)
      .input('p', sql.NVarChar, nodePath)
      .query(`
        SELECT DISTINCT shop_name FROM org_shop_bind b
        WHERE b.org_id = @root
           OR b.org_id IN (
                SELECT org_id FROM sys_org
                WHERE del_flag = 0 AND (ancestors LIKE @p + '%' OR org_id = @root)
              )
      `);
    for (const b of binds.recordset) {
      const sn = String(b.shop_name || '').trim();
      if (sn) shopSet.add(sn);
    }
  }
  return Array.from(shopSet);
}

// ============================================================
// PK 范围筛选：全部 / 本区 / 本店 / 仓库 / 经销商
//  filter 参数格式：'' | 'all' | 'area' | 'shop' | 'warehouse:xx' | 'dealer:xx'
//   - all       全部（当前用户可见店铺，即 getScopeShopNamesByBind 结果）
//   - area      本区：当前登录用户名称命中 店仓全.区经 → 该区经名下全部店铺
//   - shop      本店：当前登录用户绑定组织在 org_shop_bind 中直接绑定的店铺（不含下级子树）
//   - warehouse 仓库：店铺属性 仓库类别 等于指定值
//   - dealer    经销商：店铺属性 经销商 等于指定值
//  所有过滤均叠加在 getScopeShopNamesByBind 可见店铺之上，不改变权限边界
// ============================================================
interface PkScopeFilter { scope: string; value: string }

function parsePkScopeFilter(raw: any): PkScopeFilter {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || s === 'all') return { scope: '', value: '' };
  const idx = s.indexOf(':');
  if (idx > 0) return { scope: s.slice(0, idx), value: s.slice(idx + 1) };
  return { scope: s, value: '' };
}

/** 「本区」：登录用户名匹配 店仓全.区经（与 permissionService 历史口径一致）→ 该区经名下店铺 */
async function resolveAreaShopsByUser(pool: sql.ConnectionPool, authUser: any): Promise<Set<string>> {
  const out = new Set<string>();
  const nm = String(authUser?.userName || '').trim();
  if (!nm) return out;
  try {
    const r = await pool.request().input('nm', sql.NVarChar, nm)
      .query(`SELECT DISTINCT 店铺名称 AS shopName FROM 店仓全
              WHERE 区经 = @nm AND ISNULL(店铺名称, '') <> ''`);
    for (const row of r.recordset) {
      const sn = String(row.shopName || '').trim();
      if (sn) out.add(sn);
    }
  } catch (e: any) {
    console.warn('[PK filter] resolveAreaShopsByUser 失败:', e?.message);
  }
  return out;
}

/** 「本店」：当前用户绑定组织在 org_shop_bind 中直接绑定的店铺（不含下级子树绑定） */
async function resolveDirectShopsByUser(pool: sql.ConnectionPool, authUser: any): Promise<Set<string>> {
  const out = new Set<string>();
  const uc = String(authUser?.userCode || '').trim();
  if (!uc) return out;
  try {
    const r = await pool.request().input('uc', sql.NVarChar, uc)
      .query(`
        SELECT DISTINCT b.shop_name AS shopName
        FROM sys_user_role ur
        JOIN org_shop_bind b ON b.org_id = ur.org_id
        WHERE ur.user_code = @uc
      `);
    for (const row of r.recordset) {
      const sn = String(row.shopName || '').trim();
      if (sn) out.add(sn);
    }
  } catch (e: any) {
    console.warn('[PK filter] resolveDirectShopsByUser 失败:', e?.message);
  }
  return out;
}

/** 对已通过组织范围过滤的行按 filter 二次过滤（attrs 提供 仓库类别/经销商 等属性） */
function applyPkScopeFilter<T extends { shopName: string }>(
  rows: T[],
  filter: PkScopeFilter,
  attrs: Record<string, any>,
  areaShops: Set<string>,
  directShops: Set<string>,
): T[] {
  if (!filter.scope) return rows;
  return rows.filter(row => {
    const a = attrs[row.shopName] || {};
    switch (filter.scope) {
      case 'area': return areaShops.has(row.shopName);
      case 'shop': return directShops.has(row.shopName);
      case 'warehouse': return (a.warehouseType || '未分类') === filter.value;
      case 'dealer': return (a.dealer || '') === filter.value;
      default: return true;
    }
  });
}

// 店铺目标默认维度列模板（店铺目标先确定维度列与取值 → 维度设定从中确认"谁PK谁"）
const DEFAULT_DIM_COLUMNS = ['维度一', '维度二', '维度三', '维度四', '维度五'];

function safeJson(value: any, fallback: any = []) {
  if (value == null || value === '') return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// 读取 DATE/DATETIME 列 → 本地日期 YYYY-MM-DD（useUTC=false 下驱动返回本地 Date，
// 若用 toISOString 会被回拨 8 小时显示成前一天）
function fmtDate(value: any): string {
  if (value == null) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// 读取 DATETIME 列 → 本地 YYYY-MM-DD HH:MM
function fmtDateTime(value: any): string {
  if (value == null) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// 本地日期字符串 YYYY-MM-DD（含 JS Date 输入）
function toDateStr(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ============================================================
// 表结构确保 + 存量数据迁移
// ============================================================
async function ensureTables(pool: sql.ConnectionPool) {
  // 基础表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PK_Dimensions')
    CREATE TABLE PK_Dimensions (
      id INT IDENTITY(1,1) PRIMARY KEY,
      dimName NVARCHAR(100) NOT NULL,
      [values] NVARCHAR(MAX) NOT NULL,
      sortOrder INT DEFAULT 0,
      taskOrderId INT NULL,
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE()
    )
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PK_StoreTargets')
    CREATE TABLE PK_StoreTargets (
      id INT IDENTITY(1,1) PRIMARY KEY,
      pkName NVARCHAR(200) NOT NULL,
      pkStartTime DATETIME NULL,
      shopName NVARCHAR(200) NOT NULL,
      target DECIMAL(18,2) DEFAULT 0,
      heroMark NVARCHAR(200) NULL,
      dims NVARCHAR(MAX),
      taskOrderId INT NULL,
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE()
    )
  `);
  // 任务单表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PK_TaskOrders')
    CREATE TABLE PK_TaskOrders (
      id INT IDENTITY(1,1) PRIMARY KEY,
      orderName NVARCHAR(100) NOT NULL UNIQUE,
      docDate DATE NULL,
      pkStartDate DATE NULL,
      pkEndDate DATE NULL,
      remark NVARCHAR(500) NULL,
      dimColumns NVARCHAR(MAX) NULL,
      createdBy NVARCHAR(100) NULL,
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE()
    )
  `);
  // PK 日目标表：日期 × 督导 × 店铺名称 × 日目标（按任务单 + 日期 + 店铺唯一，上传 upsert）
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PK_StoreDailyTargets')
    CREATE TABLE PK_StoreDailyTargets (
      id INT IDENTITY(1,1) PRIMARY KEY,
      taskOrderId INT NOT NULL,
      targetDate DATE NOT NULL,
      supervisor NVARCHAR(200) NULL,
      shopName NVARCHAR(200) NOT NULL,
      dailyTarget DECIMAL(18,2) DEFAULT 0,
      createdBy NVARCHAR(100) NULL,
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE()
    )
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'UQ_PK_StoreDailyTargets' AND object_id = OBJECT_ID('PK_StoreDailyTargets'))
    CREATE UNIQUE INDEX UQ_PK_StoreDailyTargets ON PK_StoreDailyTargets (taskOrderId, targetDate, shopName)
  `);
  await pool.request().query(
    "IF COL_LENGTH('PK_StoreTargets','taskOrderId') IS NULL ALTER TABLE PK_StoreTargets ADD taskOrderId INT NULL"
  );
  await pool.request().query(
    "IF COL_LENGTH('PK_StoreTargets','heroMark') IS NULL ALTER TABLE PK_StoreTargets ADD heroMark NVARCHAR(200) NULL"
  );
  await pool.request().query(
    "IF COL_LENGTH('PK_Dimensions','taskOrderId') IS NULL ALTER TABLE PK_Dimensions ADD taskOrderId INT NULL"
  );
  await pool.request().query(
    "IF COL_LENGTH('PK_Dimensions','groups') IS NULL ALTER TABLE PK_Dimensions ADD groups NVARCHAR(MAX) NULL"
  );
  await pool.request().query(
    "IF COL_LENGTH('PK_Dimensions','displayName') IS NULL ALTER TABLE PK_Dimensions ADD displayName NVARCHAR(200) NULL"
  );
  await pool.request().query(
    "IF COL_LENGTH('PK_TaskOrders','dimColumns') IS NULL ALTER TABLE PK_TaskOrders ADD dimColumns NVARCHAR(MAX) NULL"
  );
  // 存量迁移：无任务单的目标按 pkName 自动建任务单并回填（日期用字符串直传避免时区偏移）
  const orphans = await pool.request().query(`
    SELECT pkName, MIN(CONVERT(varchar(10), pkStartTime, 23)) AS s
    FROM PK_StoreTargets
    WHERE pkName IS NOT NULL AND pkName <> '' AND taskOrderId IS NULL
    GROUP BY pkName
  `);
  for (const o of orphans.recordset) {
    const r = await pool.request()
      .input('orderName', sql.NVarChar, String(o.pkName))
      .input('docDate', sql.Date, toDateStr(new Date()))
      .input('pkStartDate', sql.Date, o.s ? String(o.s) : null)
      .query(`INSERT INTO PK_TaskOrders (orderName, docDate, pkStartDate) VALUES (@orderName, @docDate, @pkStartDate);
              SELECT SCOPE_IDENTITY() AS id`);
    const tid = r.recordset[0].id;
    await pool.request()
      .input('tid', sql.Int, tid)
      .input('pkName', sql.NVarChar, String(o.pkName))
      .query('UPDATE PK_StoreTargets SET taskOrderId = @tid WHERE pkName = @pkName AND taskOrderId IS NULL');
  }
  // 存量迁移：无任务单的维度归入第一个任务单（尽可能保留历史数据）
  const first = await pool.request().query('SELECT TOP 1 id FROM PK_TaskOrders ORDER BY id');
  if (first.recordset.length > 0) {
    await pool.request().input('tid', sql.Int, first.recordset[0].id)
      .query('UPDATE PK_Dimensions SET taskOrderId = @tid WHERE taskOrderId IS NULL');
  }
}

async function taskOrderExists(pool: sql.ConnectionPool, id: number): Promise<boolean> {
  const r = await pool.request().input('id', sql.Int, id)
    .query('SELECT TOP 1 id FROM PK_TaskOrders WHERE id = @id');
  return r.recordset.length > 0;
}

// ============================================================
// PK任务单
// ============================================================

// 任务单列表（含目标数/维度数统计）
// 报表页下拉也需要读取：持有 pkReport 或 pkTaskOrder 任一即可（写操作仍要求 pkTaskOrder）
router.get('/task-orders', authMiddleware, requireAnyMenuPerm('pk', ['pkTaskOrder', 'pkReport']), async (_req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const result = await pool.request().query(`
      SELECT o.id, o.orderName, o.docDate, o.pkStartDate, o.pkEndDate, o.remark, o.dimColumns, o.createdBy, o.createdAt,
        (SELECT COUNT(*) FROM PK_StoreTargets t WHERE t.taskOrderId = o.id) AS targetCount,
        (SELECT COUNT(*) FROM PK_Dimensions d WHERE d.taskOrderId = o.id) AS dimCount
      FROM PK_TaskOrders o
      ORDER BY o.id DESC
    `);
    res.json(result.recordset.map((r: any) => ({
      id: r.id,
      orderName: r.orderName || '',
      docDate: fmtDate(r.docDate),
      pkStartDate: fmtDate(r.pkStartDate),
      pkEndDate: fmtDate(r.pkEndDate),
      remark: r.remark || '',
      dimColumns: safeJson(r.dimColumns, DEFAULT_DIM_COLUMNS),
      createdBy: r.createdBy || '',
      createdAt: r.createdAt ? fmtDateTime(r.createdAt) : '',
      targetCount: Number(r.targetCount) || 0,
      dimCount: Number(r.dimCount) || 0,
    })));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 新增任务单（维度列由店铺目标确定，不再预生成维度骨架）
router.post('/task-orders', authMiddleware, requireMenuPerm('pk', 'pkTaskOrder'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const { orderName, docDate, pkStartDate, pkEndDate, remark, dimColumns } = req.body || {};
    const name = String(orderName || '').trim();
    if (!name) return res.status(400).json({ error: '任务单名称必填' });
    const dup = await pool.request().input('orderName', sql.NVarChar, name)
      .query('SELECT TOP 1 id FROM PK_TaskOrders WHERE orderName = @orderName');
    if (dup.recordset.length > 0) return res.status(400).json({ error: '任务单名称已存在' });

    const cols = Array.isArray(dimColumns) && dimColumns.length > 0
      ? dimColumns.map((c: any) => String(c).trim()).filter(Boolean)
      : DEFAULT_DIM_COLUMNS;
    const createdBy = (req as any).user ? ((req as any).user.userName || (req as any).user.userCode || '') : '';
    const r = await pool.request()
      .input('orderName', sql.NVarChar, name)
      .input('docDate', sql.Date, docDate ? String(docDate) : null)
      .input('pkStartDate', sql.Date, pkStartDate ? String(pkStartDate) : null)
      .input('pkEndDate', sql.Date, pkEndDate ? String(pkEndDate) : null)
      .input('remark', sql.NVarChar, String(remark || ''))
      .input('dimColumns', sql.NVarChar, JSON.stringify(cols))
      .input('createdBy', sql.NVarChar, createdBy)
      .query(`INSERT INTO PK_TaskOrders (orderName, docDate, pkStartDate, pkEndDate, remark, dimColumns, createdBy)
              VALUES (@orderName, @docDate, @pkStartDate, @pkEndDate, @remark, @dimColumns, @createdBy);
              SELECT SCOPE_IDENTITY() AS id`);
    const tid = r.recordset[0].id;
    res.json({ ok: true, id: tid, orderName: name, dimColumns: cols });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 编辑任务单
router.put('/task-orders/:id', authMiddleware, requireMenuPerm('pk', 'pkTaskOrder'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const id = Number(req.params.id);
    const { orderName, docDate, pkStartDate, pkEndDate, remark, dimColumns } = req.body || {};
    const cur = await pool.request().input('id', sql.Int, id)
      .query('SELECT TOP 1 * FROM PK_TaskOrders WHERE id = @id');
    if (cur.recordset.length === 0) return res.status(404).json({ error: '任务单不存在' });
    const old = cur.recordset[0];
    const newName = orderName != null && String(orderName).trim() !== '' ? String(orderName).trim() : old.orderName;
    if (newName !== old.orderName) {
      const dup = await pool.request().input('orderName', sql.NVarChar, newName)
        .input('id', sql.Int, id)
        .query('SELECT TOP 1 id FROM PK_TaskOrders WHERE orderName = @orderName AND id <> @id');
      if (dup.recordset.length > 0) return res.status(400).json({ error: '任务单名称已存在' });
    }
    const newCols = Array.isArray(dimColumns)
      ? dimColumns.map((c: any) => String(c).trim()).filter(Boolean)
      : safeJson(old.dimColumns, DEFAULT_DIM_COLUMNS);
    // 未传入的字段保持原值，避免局部更新（如仅改维度列）清空其它字段
    const keep = (v: any, cur: any) => (v != null && String(v).trim() !== '' ? String(v).trim() : cur);
    const newDocDate = keep(docDate, old.docDate);
    const newPkStart = keep(pkStartDate, old.pkStartDate);
    const newPkEnd = keep(pkEndDate, old.pkEndDate);
    const newRemark = remark != null ? String(remark) : (old.remark || '');
    await pool.request()
      .input('id', sql.Int, id)
      .input('orderName', sql.NVarChar, newName)
      .input('docDate', sql.Date, newDocDate)
      .input('pkStartDate', sql.Date, newPkStart)
      .input('pkEndDate', sql.Date, newPkEnd)
      .input('remark', sql.NVarChar, newRemark)
      .input('dimColumns', sql.NVarChar, JSON.stringify(newCols))
      .query(`UPDATE PK_TaskOrders SET orderName = @orderName, docDate = @docDate, pkStartDate = @pkStartDate,
              pkEndDate = @pkEndDate, remark = @remark, dimColumns = @dimColumns, updatedAt = GETDATE() WHERE id = @id`);
    // 同步其下店铺目标的 PK名称/开始时间（目标字段一律取任务单值）
    await pool.request()
      .input('tid', sql.Int, id)
      .input('orderName', sql.NVarChar, newName)
      .input('pkStartTime', sql.DateTime, newPkStart ? new Date(newPkStart) : null)
      .query('UPDATE PK_StoreTargets SET pkName = @orderName, pkStartTime = @pkStartTime WHERE taskOrderId = @tid');
    res.json({ ok: true, id });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 删除任务单（级联删除其下店铺目标与维度）
router.delete('/task-orders/:id', authMiddleware, requireMenuPerm('pk', 'pkTaskOrder'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const id = Number(req.params.id);
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const order = await tx.request().input('id', sql.Int, id)
        .query('SELECT TOP 1 id, orderName FROM PK_TaskOrders WHERE id = @id');
      if (order.recordset.length === 0) {
        await tx.rollback();
        return res.status(404).json({ error: '任务单不存在' });
      }
      const tDel = await tx.request().input('id', sql.Int, id)
        .query('DELETE FROM PK_StoreTargets WHERE taskOrderId = @id');
      const dDel = await tx.request().input('id', sql.Int, id)
        .query('DELETE FROM PK_Dimensions WHERE taskOrderId = @id');
      await tx.request().input('id', sql.Int, id)
        .query('DELETE FROM PK_TaskOrders WHERE id = @id');
      await tx.commit();
      res.json({ ok: true, deletedTargets: tDel.rowsAffected[0], deletedDims: dDel.rowsAffected[0] });
    } catch (e: any) {
      await tx.rollback();
      res.status(500).json({ error: e.message });
    }
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// PK维度设定（按任务单隔离）
// ============================================================

// 维度列表（可按任务单过滤；不传 taskOrderId 返回全部）
router.get('/dimensions', authMiddleware, requireMenuPerm('pk', 'pkDimensionConfig'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const taskOrderId = Number(req.query.taskOrderId) || 0;
    const request = pool.request().input('tid', sql.Int, taskOrderId);
    const result = await request.query(`
      SELECT id, dimName, [values], groups, sortOrder, displayName, taskOrderId FROM PK_Dimensions
      WHERE (@tid = 0 OR taskOrderId = @tid)
      ORDER BY sortOrder, id
    `);
    res.json(result.recordset.map((r: any) => {
      const vals = safeJson(r.values, []);
      let groups = safeJson(r.groups, []);
      // 旧数据平滑迁移：无 groups 时把每值转为一个默认组，保证报表内容不丢失
      if (groups.length === 0 && vals.length > 0) {
        groups = vals.map((v: string) => ({ groupName: String(v), values: [String(v)] }));
      }
      return {
        id: r.id,
        dimName: r.dimName || '',
        displayName: r.displayName || '',
        values: vals,
        groups,
        sortOrder: r.sortOrder || 0,
        taskOrderId: r.taskOrderId != null ? Number(r.taskOrderId) : null,
      };
    }));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 新增维度（必须关联任务单；未指定名称时自动命名"维度N"）
router.post('/dimensions', authMiddleware, requireMenuPerm('pk', 'pkDimensionConfig'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const { dimName, values, taskOrderId } = req.body || {};
    const tid = Number(taskOrderId) || 0;
    const displayName = String((req.body as any)?.displayName || '').trim();
    if (!tid) return res.status(400).json({ error: '请先创建并选择 PK任务单' });
    if (!(await taskOrderExists(pool, tid))) return res.status(400).json({ error: 'PK任务单不存在' });
    const valuesArr = Array.isArray(values) ? values.filter((v: any) => String(v).trim() !== '') : [];
    let name = String(dimName || '').trim();
    if (!name) {
      const cnt = await pool.request().input('tid', sql.Int, tid)
        .query('SELECT COUNT(*) AS n FROM PK_Dimensions WHERE taskOrderId = @tid');
      name = `维度${cnt.recordset[0].n + 1}`;
    }
    const maxSort = await pool.request().input('tid', sql.Int, tid)
      .query('SELECT ISNULL(MAX(sortOrder),0) AS m FROM PK_Dimensions WHERE taskOrderId = @tid');
    const groupsArr = Array.isArray((req.body as any)?.groups)
      ? (req.body as any).groups
          .map((g: any) => {
            const gv = Array.isArray(g?.values) ? g.values.map((v: any) => String(v).trim()).filter(Boolean) : [];
            return { groupName: String(g?.groupName || '').trim(), values: gv, colorMap: sanitizeColorMap(g, gv) };
          })
          .filter((g: any) => g.groupName !== '' && g.values.length > 0)
      : [];
    const result = await pool.request()
      .input('dimName', sql.NVarChar, name)
      .input('displayName', sql.NVarChar, displayName)
      .input('values', sql.NVarChar, JSON.stringify(groupsArr.length > 0 ? Array.from(new Set(groupsArr.flatMap((g: any) => g.values))) : valuesArr))
      .input('groups', sql.NVarChar, JSON.stringify(groupsArr))
      .input('sortOrder', sql.Int, (maxSort.recordset[0].m || 0) + 1)
      .input('tid', sql.Int, tid)
      .query('INSERT INTO PK_Dimensions (dimName, displayName, [values], groups, sortOrder, taskOrderId) VALUES (@dimName, @displayName, @values, @groups, @sortOrder, @tid); SELECT SCOPE_IDENTITY() AS id');
    res.json({ ok: true, id: result.recordset[0].id, dimName: name, displayName, values: valuesArr, groups: groupsArr });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 更新维度（改名 / 增删值 / 排序）
router.put('/dimensions/:id', authMiddleware, requireMenuPerm('pk', 'pkDimensionConfig'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const id = Number(req.params.id);
    const { dimName, values, sortOrder } = req.body || {};
    const cur = await pool.request().input('id', sql.Int, id)
      .query('SELECT TOP 1 * FROM PK_Dimensions WHERE id = @id');
    if (cur.recordset.length === 0) return res.status(404).json({ error: '维度不存在' });
    const old = cur.recordset[0];
    const newName = dimName != null && String(dimName).trim() !== '' ? String(dimName).trim() : (old.dimName || '');
    const newDisplayName = (req.body as any)?.displayName != null
      ? String((req.body as any).displayName || '').trim()
      : (old.displayName || '');
    const newValues = values != null && Array.isArray(values) ? values.filter((v: any) => String(v).trim() !== '') : safeJson(old.values);
    const newGroups = Array.isArray((req.body as any)?.groups)
      ? (req.body as any).groups
          .map((g: any) => {
            const gv = Array.isArray(g?.values) ? g.values.map((v: any) => String(v).trim()).filter(Boolean) : [];
            return { groupName: String(g?.groupName || '').trim(), values: gv, colorMap: sanitizeColorMap(g, gv) };
          })
          .filter((g: any) => g.groupName !== '' && g.values.length > 0)
      : safeJson(old.groups, []);
    const newSort = sortOrder != null ? Number(sortOrder) : (old.sortOrder || 0);
    await pool.request()
      .input('id', sql.Int, id)
      .input('dimName', sql.NVarChar, newName)
      .input('displayName', sql.NVarChar, newDisplayName)
      .input('values', sql.NVarChar, JSON.stringify(newValues))
      .input('groups', sql.NVarChar, JSON.stringify(newGroups))
      .input('sortOrder', sql.Int, newSort)
      .query('UPDATE PK_Dimensions SET dimName = @dimName, displayName = @displayName, [values] = @values, groups = @groups, sortOrder = @sortOrder, updatedAt = GETDATE() WHERE id = @id');
    res.json({ ok: true, id, dimName: newName, displayName: newDisplayName, values: newValues, groups: newGroups, sortOrder: newSort });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 删除维度（删除后 PK店铺目标/报表不再展示该维度列；历史 dims 数据保留）
router.delete('/dimensions/:id', authMiddleware, requireMenuPerm('pk', 'pkDimensionConfig'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const result = await pool.request().input('id', sql.Int, Number(req.params.id))
      .query('DELETE FROM PK_Dimensions WHERE id = @id');
    res.json({ ok: true, deleted: result.rowsAffected[0] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 维度确认（数据流：店铺目标 → 维度设定 → PK组别）：先清后插，全量覆盖该任务单已确认的PK维度组别
// body: { taskOrderId, dims: [{ dimName, groups: [{ groupName, values: string[] }] }] }  仅保留至少含一个组的维度
router.post('/dimensions/confirm', authMiddleware, requireMenuPerm('pk', 'pkDimensionConfig'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const { taskOrderId, dims } = req.body || {};
    const tid = Number(taskOrderId) || 0;
    if (!tid) return res.status(400).json({ error: '请先选择 PK任务单' });
    if (!(await taskOrderExists(pool, tid))) return res.status(400).json({ error: 'PK任务单不存在' });
    const dimsArr = Array.isArray(dims) ? dims : [];
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const { saved, savedDims } = await saveDimensionGroups(tx, tid, dimsArr);
      await tx.commit();
      res.json({ ok: true, saved, dims: savedDims });
    } catch (e: any) {
      await tx.rollback();
      res.status(500).json({ error: e.message });
    }
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 规范化组别颜色映射：值→hex 色（仅保留组内真实值，非法值剔除；无颜色返回 undefined，序列化时自动省略）
function sanitizeColorMap(g: any, values: string[]): Record<string, string> | undefined {
  const cm = g && (g as any).colorMap;
  if (!cm || typeof cm !== 'object' || Array.isArray(cm)) return undefined;
  const out: Record<string, string> = {};
  for (const v of values) {
    const hex = (cm as any)[v];
    if (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)) out[v] = hex.toUpperCase();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// 事务内全量覆盖某任务单的维度组别（confirm 与 import 共用）
// dimsArr 元素：{ dimName, displayName?, groups: [{ groupName, values }] }
//  - displayName 缺省时沿用该任务单中同名维度的旧值（避免全量覆盖丢失报表展示名称）
async function saveDimensionGroups(tx: sql.Transaction, tid: number, dimsArr: any[]) {
  // 删除前先读取现有维度 displayName，供未显式指定的维度沿用
  const existing = await tx.request().input('tid', sql.Int, tid)
    .query('SELECT dimName, displayName FROM PK_Dimensions WHERE taskOrderId = @tid');
  const keepDisplay: Record<string, string> = {};
  for (const e of existing.recordset) {
    const n = String(e.dimName || '').trim();
    if (n && e.displayName) keepDisplay[n] = String(e.displayName);
  }
  await tx.request().input('tid', sql.Int, tid)
    .query('DELETE FROM PK_Dimensions WHERE taskOrderId = @tid');
  let sort = 0;
  let saved = 0;
  const savedDims: any[] = [];
  for (const d of dimsArr) {
    const name = String((d as any).dimName || '').trim();
    const displayName = String((d as any).displayName || '').trim() || keepDisplay[name] || '';
    const groups = Array.isArray((d as any).groups)
      ? (d as any).groups
          .map((g: any) => {
            const gv = Array.isArray(g && g.values)
              ? (g.values as any[]).map((v: any) => String(v).trim()).filter(Boolean)
              : [];
            return { groupName: String(g && g.groupName || '').trim(), values: gv, colorMap: sanitizeColorMap(g, gv) };
          })
          .filter((g: any) => g.groupName !== '' && g.values.length > 0)
      : [];
    if (!name || groups.length === 0) continue;
    // values 列保留该维度全部候选值（各组 values 并集，供兼容旧逻辑）
    const allVals = Array.from(new Set(groups.flatMap((g: any) => g.values)));
    sort++;
    saved++;
    savedDims.push({ dimName: name, displayName, groups });
    await tx.request()
      .input('dimName', sql.NVarChar, name)
      .input('displayName', sql.NVarChar, displayName)
      .input('values', sql.NVarChar, JSON.stringify(allVals))
      .input('groups', sql.NVarChar, JSON.stringify(groups))
      .input('sortOrder', sql.Int, sort)
      .input('tid', sql.Int, tid)
      .query('INSERT INTO PK_Dimensions (dimName, displayName, [values], groups, sortOrder, taskOrderId) VALUES (@dimName, @displayName, @values, @groups, @sortOrder, @tid)');
  }
  return { saved, savedDims };
}

// ============================================================
// 导入自动协调配色：导入文件不包含颜色列，导入后按 10 色高对比度色板
// 自动为每组的值分配协调配色（与前端 VALUE_COLORS 一致）
//  原则：
//   - 同一维度内按组与值出现顺序轮转取色，相邻值尽量不同色（协调）
//   - 同一值跨组复用同色（一致、可辨识），值轮转完则循环取色（10 色足够组内区分）
// 手动 confirm（用户已选色）不受影响；仅对 colorMap 缺失的组自动补齐
// ============================================================
const AUTO_PK_COLORS = ['#E53935', '#FB8C00', '#FDD835', '#43A047', '#00ACC1', '#1E88E5', '#8E24AA', '#D81B60', '#3949AB', '#546E7A'];

/** 为 dimsArr 中未指定颜色的组自动补协调配色（原地修改并返回 dimsArr） */
function autoColorizeDims(dimsArr: any[]): any[] {
  for (const d of dimsArr) {
    const groups = Array.isArray(d && d.groups) ? d.groups : [];
    // 收集该维度全部组的值（保序、去重），建立 值 → 色 的协调映射
    const valueColor: Record<string, string> = {};
    const order: string[] = [];
    for (const g of groups) {
      const hasCm = g && typeof g.colorMap === 'object' && g.colorMap != null && !Array.isArray(g.colorMap);
      if (hasCm) continue;
      const gv = Array.isArray(g && g.values) ? (g.values as any[]).map((v: any) => String(v).trim()).filter(Boolean) : [];
      for (const v of gv) {
        if (!(v in valueColor)) {
          valueColor[v] = AUTO_PK_COLORS[order.length % AUTO_PK_COLORS.length];
          order.push(v);
        }
      }
    }
    for (const g of groups) {
      const hasCm = g && typeof g.colorMap === 'object' && g.colorMap != null && !Array.isArray(g.colorMap);
      if (hasCm) continue;
      const gv = Array.isArray(g && g.values) ? (g.values as any[]).map((v: any) => String(v).trim()).filter(Boolean) : [];
      const cm: Record<string, string> = {};
      for (const v of gv) if (valueColor[v]) cm[v] = valueColor[v];
      if (Object.keys(cm).length > 0) g.colorMap = cm;
    }
  }
  return dimsArr;
}

// 聚合某任务单店铺目标中各维度的候选值（导入校验用：组内值必须是店铺目标中真实存在的值）
async function getDimensionCandidates(pool: sql.ConnectionPool, tid: number): Promise<Record<string, Set<string>>> {
  const result = await pool.request().input('tid', sql.Int, tid)
    .query('SELECT dims FROM PK_StoreTargets WHERE taskOrderId = @tid');
  const candidates: Record<string, Set<string>> = {};
  for (const r of result.recordset) {
    const dimsArr = safeJson(r.dims, []);
    for (const d of dimsArr) {
      const name = String(d && d.name || '').trim();
      const value = String(d && d.value || '').trim();
      if (!name || !value) continue;
      if (!candidates[name]) candidates[name] = new Set();
      candidates[name].add(value);
    }
  }
  return candidates;
}

// ============================================================
// PK维度组别 批量导出 / 导入（xlsx）
//  Excel 列结构（与导入同名同格式，可直接回导）：
//    维度名称 | 组别名称 | 值1 | 值2 | ... | 值N
//  一行 = 一个 PK组别；值1..N 为该组内的成员值（可横向扩展）
// ============================================================

// 导出当前任务单的维度组别为 xlsx 文件流
router.get('/dimensions/export', authMiddleware, requireMenuPerm('pk', 'pkDimensionConfig'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const tid = Number(req.query.taskOrderId) || 0;
    if (!tid) return res.status(400).json({ error: '请先选择 PK任务单' });
    const dimRows = await loadDimensionGroups(pool, tid);
    // 列头：维度名称 | 组别名称 | 值1..值N（N = 最大组内值数）
    const maxValues = dimRows.reduce((m, d) => Math.max(m, ...d.groups.map((g: any) => (g.values || []).length)), 0);
    const header = ['维度名称', '组别名称', ...Array.from({ length: maxValues }, (_, i) => `值${i + 1}`)];
    const body = dimRows.flatMap((d: any) =>
      d.groups.map((g: any) => [d.dimName, g.groupName || '', ...(g.values || []).slice(0, maxValues)])
    );
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws['!cols'] = [{ wch: 14 }, { wch: 18 }, ...Array.from({ length: maxValues }, () => ({ wch: 12 }))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PK维度组别');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const order = await pool.request().input('tid', sql.Int, tid)
      .query('SELECT TOP 1 orderName FROM PK_TaskOrders WHERE id = @tid');
    const filename = `PK维度组别_${(order.recordset[0]?.orderName || '')}_${toDateStr(new Date())}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buf);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 读取某任务单的维度组别（含旧数据迁移：无 groups 时每值转一组）
async function loadDimensionGroups(pool: sql.ConnectionPool, tid: number) {
  const result = await pool.request().input('tid', sql.Int, tid)
    .query('SELECT id, dimName, [values], groups, sortOrder FROM PK_Dimensions WHERE taskOrderId = @tid ORDER BY sortOrder, id');
  return result.recordset
    .map((r: any) => {
      const vals = safeJson(r.values, []);
      let groups = safeJson(r.groups, []);
      if (groups.length === 0 && vals.length > 0) {
        groups = vals.map((v: string) => ({ groupName: String(v), values: [String(v)] }));
      }
      return { dimName: r.dimName || '', groups };
    })
    .filter((d: any) => d.groups.length > 0);
}

// 导入 xlsx（multipart 字段名 file；taskOrderId 指明导入到哪个任务单；全量覆盖该任务单组别）
const dimImportUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.post('/dimensions/import', authMiddleware, requireMenuPerm('pk', 'pkDimensionConfig'), dimImportUpload.single('file'), async (req: any, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const tid = Number(req.body?.taskOrderId) || 0;
    if (!tid) return res.status(400).json({ error: '请先选择 PK任务单' });
    if (!(await taskOrderExists(pool, tid))) return res.status(400).json({ error: 'PK任务单不存在' });
    const file = req.file;
    if (!file) return res.status(400).json({ error: '缺少上传文件（字段名 file）' });
    const fname = String(file.originalname || '').toLowerCase();
    if (!fname.endsWith('.xlsx') && !fname.endsWith('.xls')) {
      return res.status(400).json({ error: '仅支持 .xlsx / .xls 文件' });
    }
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(file.buffer, { type: 'buffer' });
    } catch (e: any) {
      return res.status(400).json({ error: 'Excel 解析失败：' + String(e?.message || e) });
    }
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return res.status(400).json({ error: 'Excel 中没有工作表' });
    const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (rawRows.length === 0) return res.status(400).json({ error: 'Excel 中没有数据行' });

    // 预聚合候选值（店铺目标中真实存在的维度值）
    const candidates = await getDimensionCandidates(pool, tid);

    // 按行解析：维度名称 | 组别名称 | 值1..N（跳过空行 / 缺名称行）
    const dimMap: Record<string, { groups: Record<string, string[]> }> = {};
    const warnings: string[] = [];
    let rowNo = 1;
    for (const row of rawRows) {
      rowNo++;
      const dimName = String(row['维度名称'] ?? '').trim();
      const groupName = String(row['组别名称'] ?? '').trim();
      if (!dimName && !groupName) continue; // 空行
      if (!dimName) { warnings.push(`第 ${rowNo} 行：缺少「维度名称」，已跳过`); continue; }
      if (!groupName) { warnings.push(`第 ${rowNo} 行：缺少「组别名称」，已跳过`); continue; }
      const values: string[] = [];
      for (let i = 1; ; i++) {
        const cell = row[`值${i}`];
        if (cell === undefined) break; // 遇到第一个缺失的列即停止（xlsx defval 只对存在列生效，稀疏列会中断）
        const v = String(cell ?? '').trim();
        if (v) values.push(v);
      }
      // 列头不完整时会中断，改用扫描全部键兜底
      if (values.length === 0) {
        for (const key of Object.keys(row)) {
          const m = /^值(\d+)$/.exec(String(key).trim());
          if (!m) continue;
          const v = String(row[key] ?? '').trim();
          if (v) values.push(v);
        }
      }
      if (values.length === 0) { warnings.push(`第 ${rowNo} 行：「${dimName} / ${groupName}」没有可识别的组内值，已跳过`); continue; }
      const dim = candidates[dimName];
      if (!dim) {
        warnings.push(`第 ${rowNo} 行：「${dimName}」在店铺目标中不存在维度，已跳过`);
        continue;
      }
      const valid = values.filter((v) => dim.has(v));
      const invalid = values.filter((v) => !dim.has(v));
      if (invalid.length > 0) warnings.push(`第 ${rowNo} 行：「${groupName}」包含不在店铺目标中的值 ${invalid.map((v) => `「${v}」`).join('、')}，已剔除`);
      if (valid.length === 0) { warnings.push(`第 ${rowNo} 行：「${dimName} / ${groupName}」没有有效组内值，已跳过`); continue; }
      if (!dimMap[dimName]) dimMap[dimName] = { groups: {} };
      dimMap[dimName].groups[groupName] = valid;
    }

    const dimsArr = Object.entries(dimMap).map(([dimName, { groups }]) => ({
      dimName,
      groups: Object.entries(groups).map(([groupName, values]) => ({ groupName, values })),
    }));
    // 导入配置自动协调配色：文件不含颜色列，按 10 色高对比度色板自动匹配选色
    autoColorizeDims(dimsArr);
    if (dimsArr.length === 0) {
      return res.status(400).json({ ok: false, saved: 0, warnings, message: '未解析到任何有效维度组别，已中止导入' });
    }

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const { saved, savedDims } = await saveDimensionGroups(tx, tid, dimsArr);
      await tx.commit();
      res.json({
        ok: true,
        saved,
        dims: savedDims,
        warnings,
        skippedDims: 0,
        covered: true, // 全量覆盖该任务单已确认组别
      });
    } catch (e: any) {
      await tx.rollback();
      res.status(500).json({ error: e.message });
    }
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// PK店铺目标（必须关联任务单）
// ============================================================

// 所有 PK 名称（去重，可按任务单过滤）
// 报表页下拉也需要读取：持有 pkStoreTarget 或 pkReport 任一即可（目标管理其它接口仍要求 pkStoreTarget）
router.get('/targets/pk-names', authMiddleware, requireAnyMenuPerm('pk', ['pkStoreTarget', 'pkReport']), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const tid = Number(req.query.taskOrderId) || 0;
    const result = await pool.request().input('tid', sql.Int, tid).query(
      "SELECT DISTINCT pkName FROM PK_StoreTargets WHERE pkName IS NOT NULL AND pkName <> '' AND (@tid = 0 OR taskOrderId = @tid) ORDER BY pkName"
    );
    res.json(result.recordset.map((r: any) => r.pkName));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 店铺目标列表（可按任务单 或 PK 名称过滤）
router.get('/targets', authMiddleware, requireMenuPerm('pk', 'pkStoreTarget'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const taskOrderId = Number(req.query.taskOrderId) || 0;
    const pkName = typeof req.query.pkName === 'string' ? req.query.pkName.trim() : '';
    const request = pool.request()
      .input('tid', sql.Int, taskOrderId)
      .input('pkName', sql.NVarChar, pkName);
    const result = await request.query(`
      SELECT id, pkName, pkStartTime, shopName, target, heroMark, dims, taskOrderId
      FROM PK_StoreTargets
      WHERE (@tid = 0 OR taskOrderId = @tid) AND (@pkName = '' OR pkName = @pkName)
      ORDER BY pkStartTime, shopName
    `);
    res.json(result.recordset.map((r: any) => ({
      id: r.id,
      pkName: r.pkName || '',
      pkStartTime: fmtDate(r.pkStartTime),
      shopName: r.shopName || '',
      target: r.target != null ? Number(r.target) : 0,
      heroMark: r.heroMark || '',
      dims: safeJson(r.dims, []),
      taskOrderId: r.taskOrderId != null ? Number(r.taskOrderId) : null,
    })));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 新增店铺目标（taskOrderId 必填；PK名称/开始时间由任务单自动带出，忽略前端传入值）
router.post('/targets', authMiddleware, requireMenuPerm('pk', 'pkStoreTarget'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const { taskOrderId, shopName, target, heroMark, dims } = req.body || {};
    const tid = Number(taskOrderId) || 0;
    if (!tid) return res.status(400).json({ error: '请先创建并选择 PK任务单' });
    if (!shopName) return res.status(400).json({ error: '店铺名称必填' });
    const order = await pool.request().input('tid', sql.Int, tid)
      .query('SELECT TOP 1 orderName, pkStartDate FROM PK_TaskOrders WHERE id = @tid');
    if (order.recordset.length === 0) return res.status(400).json({ error: 'PK任务单不存在' });
    const pkName = order.recordset[0].orderName;
    const pkStartTime = order.recordset[0].pkStartDate;
    const dimsArr = Array.isArray(dims) ? dims : [];
    const result = await pool.request()
      .input('pkName', sql.NVarChar, String(pkName).trim())
      .input('pkStartTime', sql.DateTime, pkStartTime ? new Date(pkStartTime) : null)
      .input('shopName', sql.NVarChar, String(shopName).trim())
      .input('target', sql.Decimal(18, 2), parseFloat(target) || 0)
      .input('heroMark', sql.NVarChar, heroMark == null ? '' : String(heroMark).trim())
      .input('dims', sql.NVarChar, JSON.stringify(dimsArr))
      .input('tid', sql.Int, tid)
      .query('INSERT INTO PK_StoreTargets (pkName, pkStartTime, shopName, target, heroMark, dims, taskOrderId) VALUES (@pkName, @pkStartTime, @shopName, @target, @heroMark, @dims, @tid); SELECT SCOPE_IDENTITY() AS id');
    res.json({ ok: true, id: result.recordset[0].id });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 更新店铺目标（保持原任务单关联）
router.put('/targets/:id', authMiddleware, requireMenuPerm('pk', 'pkStoreTarget'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const id = Number(req.params.id);
    const { shopName, target, heroMark, dims } = req.body || {};
    if (!shopName) return res.status(400).json({ error: '店铺名称必填' });
    const cur = await pool.request().input('id', sql.Int, id)
      .query('SELECT TOP 1 * FROM PK_StoreTargets WHERE id = @id');
    if (cur.recordset.length === 0) return res.status(404).json({ error: '目标不存在' });
    const row = cur.recordset[0];
    const dimsArr = Array.isArray(dims) ? dims : [];
    await pool.request()
      .input('id', sql.Int, id)
      .input('shopName', sql.NVarChar, String(shopName).trim())
      .input('target', sql.Decimal(18, 2), parseFloat(target) || 0)
      .input('heroMark', sql.NVarChar, heroMark == null ? '' : String(heroMark).trim())
      .input('dims', sql.NVarChar, JSON.stringify(dimsArr))
      .query('UPDATE PK_StoreTargets SET shopName = @shopName, target = @target, heroMark = @heroMark, dims = @dims, updatedAt = GETDATE() WHERE id = @id');
    res.json({ ok: true, pkName: row.pkName, pkStartTime: fmtDate(row.pkStartTime) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 清空店铺目标：带 taskOrderId 清空该任务单；不带则清空全部任务单
router.delete('/targets/clear', authMiddleware, requireMenuPerm('pk', 'pkStoreTarget'), async (_req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const tid = Number(_req.query.taskOrderId) || 0;
    const result = await pool.request().input('tid', sql.Int, tid)
      .query('DELETE FROM PK_StoreTargets WHERE (@tid = 0 OR taskOrderId = @tid)');
    res.json({ ok: true, deleted: result.rowsAffected[0] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 删除店铺目标
router.delete('/targets/:id', authMiddleware, requireMenuPerm('pk', 'pkStoreTarget'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const result = await pool.request().input('id', sql.Int, Number(req.params.id))
      .query('DELETE FROM PK_StoreTargets WHERE id = @id');
    res.json({ ok: true, deleted: result.rowsAffected[0] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// PK报表：按任务单选择，每个启用维度一个展示区，区内按 PK组别对拼
//  业绩来源：有效业绩全（店铺名称 + 日期区间 SUM(业绩金额)）
//  组业绩 = 该组 values 对应店铺的目标合计 / 业绩合计
//  胜方判定：组业绩最高 → 达成率最高 → 目标最高
// ============================================================
// ============================================================
// PK报表数据计算（/report 与 /report/export 共用，保证页面与导出同参数同口径）
// ============================================================
async function buildPkReportData(pool: sql.ConnectionPool, req: any): Promise<any> {
  const pkName = typeof req.query.pkName === 'string' ? req.query.pkName.trim() : '';
  const taskOrderId = Number(req.query.taskOrderId) || 0;
  if (!pkName && !taskOrderId) throw Object.assign(new Error('请选择 PK任务单'), { status: 400 });

    const targets = await pool.request()
      .input('pkName', sql.NVarChar, pkName)
      .input('tid', sql.Int, taskOrderId)
      .query(`SELECT id, pkStartTime, shopName, target, dims FROM PK_StoreTargets
              WHERE (@pkName = '' OR pkName = @pkName) AND (@tid = 0 OR taskOrderId = @tid)`);
    // 维度按任务单（taskOrderId=0 时全部）
    const dims = await pool.request().input('tid', sql.Int, taskOrderId)
      .query('SELECT id, dimName, [values], groups, sortOrder, displayName FROM PK_Dimensions WHERE (@tid = 0 OR taskOrderId = @tid) ORDER BY sortOrder, id');
    const dimRows = dims.recordset
      .map((r: any) => {
        const vals = safeJson(r.values, []);
        let groups = safeJson(r.groups, []);
        // 旧数据平滑迁移：无 groups 时把每值转为一个默认组
        if (groups.length === 0 && vals.length > 0) {
          groups = vals.map((v: string) => ({ groupName: String(v), values: [String(v)] }));
        }
        return { id: r.id, dimName: r.dimName || '', displayName: r.displayName || '', groups, sortOrder: r.sortOrder || 0 };
      })
      .filter((d: any) => d.groups.length > 0);

    // ============================================================
    // 「业绩统计至」(endDate) 口径：按任务单 PK开始/结束时间自动计算
    //   - 未开始（今天 < PK开始时间）→ 业绩统计至 = 昨天，页面展示模拟数据（isMock=true）
    //   - 已开始 → 真实数据：进行中默认统计至今日（含当天业绩）；已结束统计至 PK结束时间；
    //     手动传入的 endDate 上限钳制为 PK结束时间
    // ============================================================
    const todayStr = toDateStr(new Date());
    const yDate = new Date();
    yDate.setDate(yDate.getDate() - 1);
    const yesterdayStr = toDateStr(yDate);

    // 任务单 PK 开始/结束时间（taskOrderId 优先，兼容仅传 pkName 的历史调用）
    let orderStart = '';
    let orderEnd = '';
    if (taskOrderId) {
      const ord = await pool.request().input('tid', sql.Int, taskOrderId)
        .query('SELECT TOP 1 pkStartDate, pkEndDate FROM PK_TaskOrders WHERE id = @tid');
      if (ord.recordset.length > 0) {
        orderStart = fmtDate(ord.recordset[0].pkStartDate);
        orderEnd = fmtDate(ord.recordset[0].pkEndDate);
      }
    } else if (pkName) {
      const ord = await pool.request().input('pn', sql.NVarChar, pkName)
        .query('SELECT TOP 1 pkStartDate, pkEndDate FROM PK_TaskOrders WHERE orderName = @pn');
      if (ord.recordset.length > 0) {
        orderStart = fmtDate(ord.recordset[0].pkStartDate);
        orderEnd = fmtDate(ord.recordset[0].pkEndDate);
      }
    }

    let isMock = false;
    let statusText = '';
    let endDate = String(req.query.endDate || '');
    if (orderStart && todayStr < orderStart) {
      // PK 尚未开始：业绩统计至默认昨天，页面展示模拟数据
      isMock = true;
      endDate = yesterdayStr;
      statusText = `PK 尚未开始（${orderStart} 开始），当前展示模拟数据，PK 开始后将自动统计真实业绩`;
    } else {
      // 已开始：真实数据；默认进行中统计至今日（含当天业绩），已结束统计至 PK结束时间
      if (!endDate) {
        endDate = orderEnd && orderEnd < todayStr ? orderEnd : todayStr;
      }
      if (orderEnd && String(endDate) > orderEnd) endDate = orderEnd;
      if (orderEnd && orderEnd < todayStr) statusText = `PK 已结束（${orderEnd} 结束）`;
    }
    let endDateObj: Date | null = null;
    try { endDateObj = new Date(String(endDate)); } catch { endDateObj = null; }
    if (!endDateObj || isNaN(endDateObj.getTime())) endDate = todayStr;

    let startDate = '';
    // 生效店铺集合 + 开始时间（取最早的 PK 开始时间）
    const storeRows: any[] = targets.recordset.map((r: any) => ({
      id: r.id,
      pkStartTime: fmtDate(r.pkStartTime),
      shopName: r.shopName || '',
      target: r.target != null ? Number(r.target) : 0,
      dims: safeJson(r.dims, []),
    }));
    const starts = storeRows.map((r: any) => r.pkStartTime).filter(Boolean);
    startDate = starts.length > 0 ? starts.sort()[0] : '';
    if (startDate && String(endDate) < startDate) startDate = String(endDate);

    // 模拟数据（PK 未开始）：按「店铺+维度+值」确定性生成模拟业绩，
    // 保证多次刷新结果稳定，且组内各值之间产生可对比的胜负差异
    const simActual: Record<string, number> = {};
    if (isMock) {
      const seedHash = (s: string) => {
        let h = 0;
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return h;
      };
      const seedRate = (s: string, min: number, max: number) => {
        const r = (seedHash(s) % 1000) / 1000;
        return min + r * (max - min);
      };
      for (const row of storeRows) {
        for (const d of (row.dims || [])) {
          const name = String(d.name || '');
          const value = String(d.value ?? '');
          if (!name || !value) continue;
          const key = `${row.shopName}||${name}||${value}`;
          const base = seedRate(row.shopName, 0.5, 1.5);                         // 店铺基础达成率
          const delta = seedRate(row.shopName + '|' + name + '|' + value, 0, 1); // 值间差异
          const rate = base * (0.75 + delta * 0.5);                              // 0.375 ~ 1.875
          simActual[key] = Math.round((row.target || 0) * rate * 100) / 100;
        }
      }
    }

    // 业绩聚合：按店铺统计区间内业绩（模拟模式用值级模拟业绩）
    const shopNames = Array.from(new Set(storeRows.map((r: any) => r.shopName)));
    const actualByShop: Record<string, number> = {};
    if (shopNames.length > 0 && startDate) {
      const req2 = pool.request();
      shopNames.forEach((s, i) => req2.input(`s${i}`, sql.NVarChar, s));
      const placeholders = shopNames.map((_, i) => `@s${i}`).join(',');
      const actual = await req2.input('sd', sql.Date, new Date(startDate))
        .input('ed', sql.Date, new Date(endDate))
        .query(`
          SELECT 店铺名称 AS shopName, SUM(ISNULL(业绩金额, 0)) AS amt
          FROM 有效业绩全
          WHERE 日期 >= @sd AND 日期 <= @ed AND 店铺名称 IN (${placeholders})
          GROUP BY 店铺名称
        `);
      actual.recordset.forEach((r: any) => { actualByShop[r.shopName] = Number(r.amt) || 0; });
    }

    // ============================================================
    // 组织视角过滤：PK 报表为全角色统一视图，所有登录用户仅展示与其取值相关组别的对决
    //  链路：登录用户 userCode → sys_user_role.org_id → 绑定组织及全部下级在
    //  org_shop_bind 中绑定的店铺（上级继承下级绑定）→ 目标行 dims 该维度取值 → 含该值的组。
    //  系统无特权角色：财务/商品/运营等全部按绑定过滤（super_admin 因总公司绑定
    //  全部店铺而自然看到全量）。仅未登录（无 userCode）时兜底展示全量。
    // ============================================================
    let scoped = false;
    let scopeShops: string[] = [];
    let scopeValues: string[] = [];
    let userDimVals: Record<string, string[]> = {};

    const authUser = req.user || null;
    if (authUser?.userCode) {
      try {
        // 【2026-09-18 修正】组织视角过滤改用 org_shop_bind 授权（本组织及全部下级绑定）
        //  旧链路：登录 userCode → sys_user_role.org_id → 组织树子树下 del_flag=0 的
        //  shop 组织 org_name → 与 storeRows.shopName 匹配。缺陷：商品总监/商品组等
        //  组织树下的店铺节点 del_flag=1（已停用标记），但其店铺仍在 org_shop_bind
        //  绑定表中授权，导致这些角色可见店铺为 0、报表空白。
        //  新链路：与系统标准权限模型 appendOrgVisibleBinds 语义一致——绑定组织及其
        //  全部下级在 org_shop_bind 中绑定的店铺即可见（上级继承下级），不依赖
        //  sys_org 树下 shop 节点的 del_flag，店长/店员绑定 shop 节点 → bind 表自身绑定。
        const shops = await getScopeShopNamesByBind(pool, String(authUser.userCode));
        scopeShops = shops;
        if (shops.length > 0) {
          const myRows = storeRows.filter((r: any) => shops.includes(r.shopName));
          for (const row of myRows) {
            for (const d of (row.dims || [])) {
              const name = String(d.name || '');
              const value = String(d.value ?? '');
              if (!name || !value) continue;
              if (!userDimVals[name]) userDimVals[name] = [];
              if (!userDimVals[name].includes(value)) userDimVals[name].push(value);
            }
          }
        }
        // 用户始终按相关组展示（无店铺归属或未参与该 PK 时展示为空，不越权看全量）
        const dimNames = Object.keys(userDimVals);
        scoped = true;
        scopeValues = Array.from(new Set(dimNames.flatMap(n => userDimVals[n])));
      } catch (filterErr: any) {
        console.warn('[PK report] 组织视角过滤失败，按全量展示:', filterErr?.message);
      }
    }

    // 组级汇总：对每个维度，按组聚合 target/actual（店铺 dims 中该维度取值 ∈ 组 values）
    const rateRank = (r: number) => (Number.isFinite(r) ? r : Number.MAX_VALUE);
    const dimsResult = dimRows.map((dim: any) => {
      // 组织视角过滤：仅保留含有用户取值的组；用户无该维度取值或过滤后无相关组 → 该维度不展示
      const userVals = scoped ? (userDimVals[dim.dimName] || []) : null;
      if (scoped && userVals && userVals.length === 0) return null;
      const groups = dim.groups
        .map((g: any) => {
        const gValues: string[] = Array.from(new Set((g.values || []).map((v: any) => String(v))));
        let target = 0;
        let actual = 0;
        let shops = 0;
        // 值级明细：每个值单独统计达成情况（组内值对决、展示各值达成率）
        const valuesDetail = gValues.map(v => {
          let vt = 0;
          let va = 0;
          let vs = 0;
          for (const row of storeRows) {
            const found = (row.dims || []).find((d: any) => d.name === dim.dimName && String(d.value) === v);
            if (found) {
              vt += row.target || 0;
              va += isMock ? (simActual[`${row.shopName}||${dim.dimName}||${v}`] ?? 0) : (actualByShop[row.shopName] || 0);
              vs++;
            }
          }
          const vrate = vt > 0 ? va / vt : (va > 0 ? Infinity : 0);
          return { value: v, target: vt, actual: va, rate: vrate, shops: vs };
        });
        // 组级汇总
        for (const row of storeRows) {
          const found = (row.dims || []).find((d: any) => d.name === dim.dimName && gValues.includes(String(d.value)));
          if (found) {
            target += row.target || 0;
            actual += isMock ? (simActual[`${row.shopName}||${dim.dimName}||${String(found.value)}`] ?? 0) : (actualByShop[row.shopName] || 0);
            shops++;
          }
        }
        const rate = target > 0 ? actual / target : (actual > 0 ? Infinity : 0);
        // 组内胜出值：达成率最高的值
        const vTop = [...valuesDetail].sort((a, b) =>
          (rateRank(b.rate) - rateRank(a.rate)) ||
          (b.actual - a.actual) ||
          (b.target - a.target)
        )[0];
        const valueWinner = vTop && (vTop.actual > 0 || vTop.rate === Infinity) ? vTop.value : '';
        return { groupName: g.groupName || '', values: gValues, target, actual, rate, shops, colorMap: sanitizeColorMap(g, gValues), valuesDetail, valueWinner };
      });
      // 组织视角过滤：仅保留含用户取值的组（组合展示整场对决——本组值 + 对手值）
      const visibleGroups = scoped
        ? groups.filter((g: any) => (g.values || []).some((v: string) => userVals!.includes(v)))
        : groups;
      if (visibleGroups.length === 0) return null; // 该维度无相关组 → 不展示
      // 维度胜方：达成率最高的组（达成率口径）
      const top = [...visibleGroups].sort((a, b) =>
        (rateRank(b.rate) - rateRank(a.rate)) ||
        (b.actual - a.actual) ||
        (b.target - a.target)
      )[0];
      const winner = top && (top.actual > 0 || top.rate === Infinity) ? top.groupName : '';
      return {
        dimName: dim.dimName,
        displayName: dim.displayName || '',
        groups: visibleGroups,
        winner,
      };
    }).filter(Boolean);

return {
      pkName,
      startDate,
      endDate,
      dims: dimsResult,
      storeCount: storeRows.length,
      // 模拟/真实数据标记：PK 未开始时 isMock=true（业绩统计至昨日、展示模拟数据）
      isMock,
      pkStartDate: orderStart,
      pkEndDate: orderEnd,
      statusText,
      // 组织视角过滤信息（前端提示用）：scoped=true 时仅返回当前用户相关组
      scoped,
      scopeShops,
      scopeValues,
    };
}

router.get('/report', authMiddleware, requireMenuPerm('pk', 'pkReport'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const data = await buildPkReportData(pool, req);
    res.json(data);
  } catch (e: any) { res.status(e?.status || 500).json({ error: e.message }); }
});

// ============================================================
// PK报表导出（xlsx）：与页面 /report 同参数同口径
//  总览 sheet：PK名称/统计区间/店铺数/数据状态 + 各赛区胜方汇总
//  每个维度一个 sheet：组别小计行 + 组内各值明细行（达成率/店铺数/组内胜出/赛区胜方）
// ============================================================
router.get('/report/export', authMiddleware, requireMenuPerm('pk', 'pkReport'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const taskOrderId = Number(req.query.taskOrderId) || 0;
    const data = await buildPkReportData(pool, req);

    const fmtPercent = (rate: number | null): string => {
      if (rate == null || !isFinite(Number(rate))) return '∞';
      if (rate === 0) return '0%';
      return `${(rate * 100).toFixed(3)}%`;
    };

    const wb = XLSX.utils.book_new();

    // 总览 sheet
    const meta: any[][] = [
      ['PK名称', data.pkName],
      ['统计区间', `${data.startDate || '—'} ~ ${data.endDate}`],
      ['参与店铺数', data.storeCount],
      ['数据状态', data.isMock ? '模拟数据（PK 尚未开始）' : '真实业绩'],
      ['PK开始时间', data.pkStartDate || '—'],
      ['PK结束时间', data.pkEndDate || '—'],
    ];
    if (data.statusText) meta.push(['状态说明', data.statusText]);
    meta.push([], ['赛区', '展示名称', '组别数', '赛区胜方']);
    for (const d of data.dims) meta.push([d.dimName, d.displayName || '', d.groups.length, d.winner || '—']);
    const wsMeta = XLSX.utils.aoa_to_sheet(meta);
    wsMeta['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 10 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, wsMeta, '总览');

    // 每个维度一个赛区 sheet
    const header = ['组别', '值', '目标', '业绩', '达成率', '店铺数', '组内胜出', '赛区胜方'];
    const usedNames = new Set<string>();
    for (const dim of data.dims) {
      const displayName = dim.displayName?.trim() || `${dim.dimName || ''} 对决`;
      let sheetName = (displayName || '赛区').slice(0, 31);
      let n = 2;
      while (usedNames.has(sheetName)) sheetName = `${(displayName || '赛区').slice(0, 28)}(${n++})`;
      usedNames.add(sheetName);

      const rows: any[][] = [
        [`${displayName}（赛区胜方：${dim.winner || '—'}）`],
        header,
      ];
      for (const g of dim.groups) {
        rows.push([
          g.groupName,
          '组别小计',
          round2(g.target),
          round2(g.actual),
          fmtPercent(g.rate),
          g.shops,
          g.valueWinner || '—',
          dim.winner === g.groupName ? '✓ 胜出' : '',
        ]);
        for (const vd of g.valuesDetail || []) {
          rows.push([
            '',
            vd.value,
            round2(vd.target),
            round2(vd.actual),
            fmtPercent(vd.rate),
            vd.shops,
            vd.value === g.valueWinner ? '✓ 胜出' : '',
            dim.winner === g.groupName ? '✓ 胜出' : '',
          ]);
        }
      }
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 10 }];
      ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }];
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const orderName = taskOrderId
      ? (((await pool.request().input('tid', sql.Int, taskOrderId)
          .query('SELECT TOP 1 orderName FROM PK_TaskOrders WHERE id = @tid')).recordset[0]?.orderName) || '')
      : '';
    const filename = `PK报表_${orderName || data.pkName}_${data.endDate}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buf);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// PK 范围筛选元数据：按当前登录用户可见店铺（org_shop_bind 链路）返回
//  - warehouses / dealers：可见 ∩ 任务单店铺 的 DISTINCT 仓库类别 / 经销商
//  - areaName / areaShopCount：「本区」可用时区经名（用户名命中店仓全.区经）及区下店铺数
//  - myShops：「本店」用户直接绑定店铺列表
// ============================================================
router.get('/scope-meta', authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const tid = Number(req.query.taskOrderId) || 0;
    const authUser: any = req.user || null;
    // 任务单参与店铺
    let taskShops: string[] = [];
    if (tid) {
      const t = await pool.request().input('tid', sql.Int, tid)
        .query('SELECT DISTINCT shopName FROM PK_StoreTargets WHERE taskOrderId = @tid');
      taskShops = t.recordset.map((r: any) => String(r.shopName || '').trim()).filter(Boolean);
    }
    // 可见店铺（与 /data-table /daily-followup 同链路）
    let scopeShopSet: Set<string> | null = null;
    if (authUser?.userCode) {
      try {
        const shops = await getScopeShopNamesByBind(pool, String(authUser.userCode));
        scopeShopSet = new Set(shops);
      } catch (e: any) { console.warn('[PK scope-meta] 组织过滤失败:', e?.message); }
    }
    const candidates = scopeShopSet ? taskShops.filter(s => scopeShopSet!.has(s)) : taskShops;
    // DISTINCT 仓库类别 / 经销商 / 督导 / 区经（5 维筛选项数据源）
    let warehouses: string[] = [];
    let dealers: string[] = [];
    let supervisors: string[] = [];
    let districtManagers: string[] = [];
    if (candidates.length > 0) {
      const reqA = pool.request();
      candidates.forEach((s, i) => reqA.input(`s${i}`, sql.NVarChar, s));
      const ph = candidates.map((_, i) => `@s${i}`).join(',');
      const attrs = await reqA.query(`SELECT DISTINCT 仓库类别 AS w, 经销商 AS d, 督导 AS s, 区经 AS dm FROM 店仓全 WHERE 店铺名称 IN (${ph})`);
      const wSet = new Set<string>();
      const dSet = new Set<string>();
      const sSet = new Set<string>();
      const dmSet = new Set<string>();
      for (const r of attrs.recordset) {
        if (String(r.w || '').trim()) wSet.add(String(r.w).trim());
        if (String(r.d || '').trim()) dSet.add(String(r.d).trim());
        if (String(r.s || '').trim()) sSet.add(String(r.s).trim());
        if (String(r.dm || '').trim()) dmSet.add(String(r.dm).trim());
      }
      warehouses = Array.from(wSet).sort((a, b) => a.localeCompare(b, 'zh-CN'));
      dealers = Array.from(dSet).sort((a, b) => a.localeCompare(b, 'zh-CN'));
      supervisors = Array.from(sSet).sort((a, b) => a.localeCompare(b, 'zh-CN'));
      districtManagers = Array.from(dmSet).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    }
    // 「本区」可用性：用户名命中区经
    const areaShops = await resolveAreaShopsByUser(pool, authUser);
    const areaName = areaShops.size > 0 ? String(authUser?.userName || '').trim() : '';
    // 「本店」列表
    const directShops = await resolveDirectShopsByUser(pool, authUser);
    res.json({
      warehouses,
      dealers,
      supervisors,
      districtManagers,
      shops: candidates,
      areaName,
      areaShopCount: areaShops.size,
      myShopCount: directShops.size,
      myShops: Array.from(directShops),
      scopeShopCount: candidates.length,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// PK数据表：按 直营/加盟 → 督导 → 经销商 → 门店 四级展示 目标/业绩/达成率
//   - 目标   ：PK_StoreTargets.target（按任务单/PK名称过滤）
//   - 属性   ：店仓全（仓库类别/区经/督导/经销商，按店铺名称关联）
//   - 业绩   ：有效业绩全（按店铺名称 + 日期区间 SUM 业绩金额）
//   - 日期口径：与 /report 完全一致（未开始→昨日+模拟；进行中→昨日；已结束→PK结束时间）
//   - 组织视角：非特权用户仅展示其组织树子树下店铺（与报表 scoped 链路一致）
// 第一区 直营/加盟 业绩达成：仓库类别 / 目标 / 业绩金额 / 达成率
// 第二区 督导 业绩达成   ：区经 / 督导 / 目标 / 业绩金额 / 达成率
// 第三区 经销商 业绩达成 ：督导 / 经销商 / 目标 / 业绩金额 / 达成率 / 店铺数
// 第四区 门店 业绩达成   ：区经 / 督导 / 店铺名称 / 目标 / 业绩金额 / 达成率
// 五维筛选（仓库类别/督导/区经/经销商/店铺名称）：warehouse=&supervisor=&districtManager=&dealer=&shopName=
//   叠加在 getScopeShopNamesByBind 可见店铺之上行级 AND 过滤，过滤后四区联动重聚合，不改变权限边界
// 时间段筛选（业绩统计区间）：startDate=&endDate= 传入时按所选区间统计真实业绩（缺省沿用自动口径）
// ============================================================
router.get('/data-table', authMiddleware, requireMenuPerm('pk', 'pkReport'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const pkName = typeof req.query.pkName === 'string' ? req.query.pkName.trim() : '';
    const taskOrderId = Number(req.query.taskOrderId) || 0;
    if (!pkName && !taskOrderId) return res.status(400).json({ error: '请选择 PK任务单' });

    const targets = await pool.request()
      .input('pkName', sql.NVarChar, pkName)
      .input('tid', sql.Int, taskOrderId)
      .query(`SELECT id, pkStartTime, shopName, target, heroMark FROM PK_StoreTargets
              WHERE (@pkName = '' OR pkName = @pkName) AND (@tid = 0 OR taskOrderId = @tid)`);

// ============================================================
    // 「业绩统计至」(endDate) 口径：与 /report 完全一致
    //   - 未开始 → 昨日 + 模拟数据；已开始 → 进行中统计至今日（含当天），已结束统计至 PK结束时间
    //   - 时间段筛选器：显式传 startDate/endDate 时按所选区间统计真实业绩（不自动推导/模拟）
    // ============================================================
    const todayStr = toDateStr(new Date());
    const yDate = new Date();
    yDate.setDate(yDate.getDate() - 1);
    const yesterdayStr = toDateStr(yDate);

    let orderStart = '';
    let orderEnd = '';
    if (taskOrderId) {
      const ord = await pool.request().input('tid', sql.Int, taskOrderId)
        .query('SELECT TOP 1 pkStartDate, pkEndDate FROM PK_TaskOrders WHERE id = @tid');
      if (ord.recordset.length > 0) {
        orderStart = fmtDate(ord.recordset[0].pkStartDate);
        orderEnd = fmtDate(ord.recordset[0].pkEndDate);
      }
    } else if (pkName) {
      const ord = await pool.request().input('pn', sql.NVarChar, pkName)
        .query('SELECT TOP 1 pkStartDate, pkEndDate FROM PK_TaskOrders WHERE orderName = @pn');
      if (ord.recordset.length > 0) {
        orderStart = fmtDate(ord.recordset[0].pkStartDate);
        orderEnd = fmtDate(ord.recordset[0].pkEndDate);
      }
    }

    let isMock = false;
    let statusText = '';
    // 时间段筛选器：用户可指定 业绩统计起始(startDate)/截止(endDate)，二者均缺省时沿用自动口径
    const userStart = typeof req.query.startDate === 'string' ? req.query.startDate.trim() : '';
    const userEnd = typeof req.query.endDate === 'string' ? req.query.endDate.trim() : '';
    const hasUserRange = !!(userStart || userEnd);
    let endDate = userEnd;
    if (hasUserRange) {
      // 用户指定时间段：按所选区间统计真实业绩（不再自动推导/模拟）
      isMock = false;
      if (!userEnd) {
        endDate = orderEnd && orderEnd < todayStr ? orderEnd : todayStr;
        if (orderEnd && String(endDate) > orderEnd) endDate = orderEnd;
      }
    } else if (orderStart && todayStr < orderStart) {
      // PK 尚未开始：业绩统计至默认昨天，页面展示模拟数据
      isMock = true;
      endDate = yesterdayStr;
      statusText = `PK 尚未开始（${orderStart} 开始），当前展示模拟数据，PK 开始后将自动统计真实业绩`;
    } else {
      // 已开始：真实数据；默认进行中统计至今日（含当天业绩），已结束统计至 PK结束时间
      if (!endDate) {
        endDate = orderEnd && orderEnd < todayStr ? orderEnd : todayStr;
      }
      if (orderEnd && String(endDate) > orderEnd) endDate = orderEnd;
      if (orderEnd && orderEnd < todayStr) statusText = `PK 已结束（${orderEnd} 结束）`;
    }
    let endDateObj: Date | null = null;
    try { endDateObj = new Date(String(endDate)); } catch { endDateObj = null; }
    if (!endDateObj || isNaN(endDateObj.getTime())) endDate = todayStr;

    const storeRows = targets.recordset.map((r: any) => ({
      id: r.id,
      pkStartTime: fmtDate(r.pkStartTime),
      shopName: r.shopName || '',
      target: r.target != null ? Number(r.target) : 0,
      heroMark: r.heroMark != null ? String(r.heroMark).trim() : '',
    }));
const starts = storeRows.map((r: any) => r.pkStartTime).filter(Boolean);
    let startDate = userStart || (starts.length > 0 ? starts.sort()[0] : '');
    if (startDate) {
      const sdObj = new Date(String(startDate));
      if (isNaN(sdObj.getTime())) startDate = starts.length > 0 ? starts.sort()[0] : '';
    }
    if (startDate && String(endDate) < startDate) startDate = String(endDate);

    // 模拟数据（PK 未开始）：按店铺生成确定性模拟业绩（与报表同 seed 算法，保证刷新稳定）
    const simActual: Record<string, number> = {};
    if (isMock) {
      const seedHash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
      const seedRate = (s: string, min: number, max: number) => { const r = (seedHash(s) % 1000) / 1000; return min + r * (max - min); };
      for (const row of storeRows) {
        const base = seedRate(row.shopName, 0.5, 1.5); // 店铺基础达成率
        const rate = base * 0.5; // 单一店铺：0.25 ~ 0.75
        simActual[row.shopName] = Math.round((row.target || 0) * rate * 100) / 100;
      }
    }

    // 业绩聚合：按店铺统计区间内业绩
    const shopNames = Array.from(new Set(storeRows.map((r: any) => r.shopName)));
    const actualByShop: Record<string, number> = {};
    if (shopNames.length > 0 && startDate) {
      const req2 = pool.request();
      shopNames.forEach((s, i) => req2.input(`s${i}`, sql.NVarChar, s));
      const placeholders = shopNames.map((_, i) => `@s${i}`).join(',');
      const actual = await req2.input('sd', sql.Date, new Date(startDate))
        .input('ed', sql.Date, new Date(endDate))
        .query(`
          SELECT 店铺名称 AS shopName, SUM(ISNULL(业绩金额, 0)) AS amt
          FROM 有效业绩全
          WHERE 日期 >= @sd AND 日期 <= @ed AND 店铺名称 IN (${placeholders})
          GROUP BY 店铺名称
        `);
      actual.recordset.forEach((r: any) => { actualByShop[r.shopName] = Number(r.amt) || 0; });
    }

// 店铺属性：仓库类别 / 区经 / 督导 / 经销商 / 商品 / 月可比性 / 年可比性（店仓全）
    const shopAttrs: Record<string, { warehouseType: string; districtManager: string; supervisor: string; dealer: string; product: string; monthComparable: string; yearComparable: string }> = {};
    if (shopNames.length > 0) {
      const req3 = pool.request();
      shopNames.forEach((s, i) => req3.input(`a${i}`, sql.NVarChar, s));
      const placeholders = shopNames.map((_, i) => `@a${i}`).join(',');
const attrs = await req3.query(`
        SELECT 店铺名称 AS shopName, 仓库类别 AS warehouseType, 区经 AS districtManager, 督导 AS supervisor, 经销商 AS dealer, 商品 AS product, 月可比性 AS monthComparable, 年可比性 AS yearComparable
        FROM 店仓全 WHERE 店铺名称 IN (${placeholders})
      `);
      attrs.recordset.forEach((r: any) => {
        shopAttrs[r.shopName] = {
          warehouseType: r.warehouseType || '',
          districtManager: r.districtManager || '',
          supervisor: r.supervisor || '',
          dealer: r.dealer || '',
          product: r.product || '',
          monthComparable: r.monthComparable || '',
          yearComparable: r.yearComparable || '',
        };
      });
    }

    // 组织视角过滤（与 /report 同链路）：所有登录用户统一按 org_shop_bind 绑定店铺过滤
    //  （绑定组织及全部下级组织的绑定，上级继承可见；不依赖组织树下 shop 节点 del_flag；
    //   系统无特权角色，财务/商品/运营等一律走绑定，super_admin 因总公司绑定全部店铺
    //   而自然看到全量）。仅未登录（无 userCode）时兜底全量。
    let scopeShopSet: Set<string> | null = null;
    const authUser = req.user || null;
    if (authUser?.userCode) {
      try {
        const shops = await getScopeShopNamesByBind(pool, String(authUser.userCode));
        scopeShopSet = new Set(shops); // 绑定为空 → 空集合 → 不展示任何店铺（不退回全量）
      } catch (filterErr: any) {
        console.warn('[PK data-table] 组织视角过滤失败，按全量展示:', filterErr?.message);
      }
    }
    const visibleRows = scopeShopSet ? storeRows.filter((r: any) => scopeShopSet!.has(r.shopName)) : storeRows;

    // 范围筛选（全部/本区/本店）：叠加在可见店铺之上
    const pkFilter = parsePkScopeFilter(req.query.filter);
    let areaShops = new Set<string>();
    let directShops = new Set<string>();
    if (pkFilter.scope === 'area') areaShops = await resolveAreaShopsByUser(pool, authUser);
    if (pkFilter.scope === 'shop') directShops = await resolveDirectShopsByUser(pool, authUser);

    // 五维筛选（仓库类别/督导/区经/经销商/店铺名称）：支持逗号分隔多选，
    //   语义为 维度间 AND、维度内任一命中（OR）即通过；空数组 = 该维度不过滤
    const dimToArr = (v: unknown): string[] =>
      typeof v === 'string' && v.trim() !== '' ? v.split(',').map(s => s.trim()).filter(Boolean) : [];
const dimFilter = {
      warehouse: dimToArr(req.query.warehouse),
      supervisor: dimToArr(req.query.supervisor),
      districtManager: dimToArr(req.query.districtManager),
      dealer: dimToArr(req.query.dealer),
      shopName: dimToArr(req.query.shopName),
      monthComparables: dimToArr(req.query.monthComparable),
      yearComparables: dimToArr(req.query.yearComparable),
    };
    // 英雄标数值解析（文本可能是 "300000"、"0" 或空）
    const heroNum = (v: unknown): number => {
      const n = Number(String(v ?? '').trim());
      return isFinite(n) ? n : 0;
    };
    // 是否参与英雄招募筛选（英雄标 ≠ 0 即参与）：yes=仅参与，no=仅不参与，其他=不限
    const announced = typeof req.query.announced === 'string' ? req.query.announced.trim() : '';
    const filteredRows = visibleRows.filter(row => {
      const a = shopAttrs[row.shopName] || {};
      if (pkFilter.scope === 'area' && !areaShops.has(row.shopName)) return false;
      if (pkFilter.scope === 'shop' && !directShops.has(row.shopName)) return false;
      if (dimFilter.warehouse.length > 0 && !dimFilter.warehouse.includes(a.warehouseType || '未分类')) return false;
      if (dimFilter.supervisor.length > 0 && !dimFilter.supervisor.includes(a.supervisor || '')) return false;
      if (dimFilter.districtManager.length > 0 && !dimFilter.districtManager.includes(a.districtManager || '')) return false;
if (dimFilter.dealer.length > 0 && !dimFilter.dealer.includes(a.dealer || '')) return false;
      if (dimFilter.shopName.length > 0 && !dimFilter.shopName.some(k => String(row.shopName || '').includes(k))) return false;
      if (dimFilter.monthComparables.length > 0 && !dimFilter.monthComparables.includes(a.monthComparable || '')) return false;
      if (dimFilter.yearComparables.length > 0 && !dimFilter.yearComparables.includes(a.yearComparable || '')) return false;
      if (announced === 'yes' && heroNum(row.heroMark) === 0) return false;
      if (announced === 'no' && heroNum(row.heroMark) !== 0) return false;
      return true;
    });

    // ============================================================
    // 四级聚合
    // ============================================================
    const rateOf = (target: number, actual: number) => target > 0 ? actual / target : (actual > 0 ? Infinity : 0);

    // 第一区：仓库类别（直营/加盟）聚合
    const zone1Map = new Map<string, { target: number; actual: number; heroMark: number; shops: number }>();
    // 第二区：督导聚合（仓库类别 + 区经 + 督导）
    const zone2Map = new Map<string, { warehouseType: string; districtManager: string; supervisor: string; target: number; actual: number; heroMark: number; shops: number }>();
    // 第三区：商品聚合（仓库类别 + 商品）
    const zone3Map = new Map<string, { warehouseType: string; product: string; target: number; actual: number; heroMark: number; shops: number }>();
    // 第四区：经销商聚合（仓库类别 + 督导 + 经销商）
    const zone4Map = new Map<string, { warehouseType: string; supervisor: string; dealer: string; target: number; actual: number; heroMark: number; shops: number }>();
    // 第五区：门店明细（仓库类别 + 区经 + 督导 + 店铺名称）
    const zone5Rows: any[] = [];

    const addTo = (map: Map<string, any>, key: string, target: number, actual: number, heroMark: number, ext?: any) => {
      const cur = map.get(key) || { target: 0, actual: 0, shops: 0, heroMark: 0, ...ext };
      cur.target += target;
      cur.actual += actual;
      cur.heroMark += heroMark;
      cur.shops += 1;
      map.set(key, cur);
    };

    for (const row of filteredRows) {
      const attrs = shopAttrs[row.shopName] || { warehouseType: '', districtManager: '', supervisor: '', dealer: '', product: '' };
      const wt = attrs.warehouseType || '未分类';
      const dm = attrs.districtManager || '';
      const su = attrs.supervisor || '';
      const de = attrs.dealer || '';
      const pd = attrs.product || '未分类';
      const actual = isMock ? (simActual[row.shopName] ?? 0) : (actualByShop[row.shopName] || 0);
      const target = row.target || 0;
      const heroMark = heroNum(row.heroMark);

      addTo(zone1Map, wt, target, actual, heroMark);
      addTo(zone2Map, `${wt}||${dm}||${su}`, target, actual, heroMark, { warehouseType: wt, districtManager: dm, supervisor: su });
      addTo(zone3Map, `${wt}||${pd}`, target, actual, heroMark, { warehouseType: wt, product: pd });
      addTo(zone4Map, `${wt}||${su}||${de}`, target, actual, heroMark, { warehouseType: wt, supervisor: su, dealer: de });
      zone5Rows.push({
        warehouseType: wt,
        districtManager: dm,
        supervisor: su,
        shopName: row.shopName,
        target,
        actual,
        rate: rateOf(target, actual),
        heroMark,
        // 英雄达成率 = 实际业绩 / 英雄标（英雄标 > 0 时才有意义；未参与时返回 null）
        heroAchieveRate: heroMark > 0 ? rateOf(heroMark, actual) : null,
      });
    }

    const zone1 = Array.from(zone1Map.entries()).map(([warehouseType, v]) => ({
      warehouseType,
      target: v.target,
      actual: v.actual,
      rate: rateOf(v.target, v.actual),
      heroMark: v.heroMark || 0,
      // 英雄达成率 = 实际业绩 / 英雄标（英雄标 > 0 时才有意义；未参与时返回 null）
      heroAchieveRate: (v.heroMark || 0) > 0 ? rateOf(v.heroMark, v.actual) : null,
      shops: v.shops,
    })).sort((a, b) => {
      const order = (w: string) => (w === '直营' ? 0 : w === '加盟' ? 1 : 2);
      return order(a.warehouseType) - order(b.warehouseType);
    });

    const zone2 = Array.from(zone2Map.values()).map(v => ({
      warehouseType: v.warehouseType,
      districtManager: v.districtManager,
      supervisor: v.supervisor,
      target: v.target,
      actual: v.actual,
      rate: rateOf(v.target, v.actual),
      heroMark: v.heroMark || 0,
      heroAchieveRate: (v.heroMark || 0) > 0 ? rateOf(v.heroMark, v.actual) : null,
      shops: v.shops,
    })).sort((a, b) =>
      (a.warehouseType.localeCompare(b.warehouseType, 'zh-CN')) ||
      (a.districtManager.localeCompare(b.districtManager, 'zh-CN')) ||
      (a.supervisor.localeCompare(b.supervisor, 'zh-CN')));

    const zone3 = Array.from(zone3Map.values()).map(v => ({
      warehouseType: v.warehouseType,
      product: v.product,
      target: v.target,
      actual: v.actual,
      rate: rateOf(v.target, v.actual),
      heroMark: v.heroMark || 0,
      heroAchieveRate: (v.heroMark || 0) > 0 ? rateOf(v.heroMark, v.actual) : null,
      shops: v.shops,
    })).sort((a: any, b: any) =>
      (a.warehouseType.localeCompare(b.warehouseType, 'zh-CN')) ||
      (a.product.localeCompare(b.product, 'zh-CN')));

    const zone4 = Array.from(zone4Map.values()).map(v => ({
      warehouseType: v.warehouseType,
      supervisor: v.supervisor,
      dealer: v.dealer,
      target: v.target,
      actual: v.actual,
      rate: rateOf(v.target, v.actual),
      heroMark: v.heroMark || 0,
      heroAchieveRate: (v.heroMark || 0) > 0 ? rateOf(v.heroMark, v.actual) : null,
      shops: v.shops,
    })).sort((a: any, b: any) =>
      (a.warehouseType.localeCompare(b.warehouseType, 'zh-CN')) ||
      (a.supervisor.localeCompare(b.supervisor, 'zh-CN')) ||
      (a.dealer.localeCompare(b.dealer, 'zh-CN')));

zone5Rows.sort((a: any, b: any) =>
      (a.warehouseType.localeCompare(b.warehouseType, 'zh-CN')) ||
      (a.districtManager.localeCompare(b.districtManager, 'zh-CN')) ||
      (a.supervisor.localeCompare(b.supervisor, 'zh-CN')) ||
      (a.shopName.localeCompare(b.shopName, 'zh-CN')));

    // 月可比/年可比 候选值：当前可见店铺（范围筛选后）的档案可比性去重，随其他维度收敛（与 PK日目标跟进 联动一致）
    const comparableOptions = (() => {
      const mc = new Set<string>();
      const yc = new Set<string>();
      for (const r of filteredRows) {
        const a = shopAttrs[r.shopName];
        if (a && a.monthComparable) mc.add(a.monthComparable);
        if (a && a.yearComparable) yc.add(a.yearComparable);
      }
      return {
        month: Array.from(mc).sort((x, y) => x.localeCompare(y, 'zh-CN')),
        year: Array.from(yc).sort((x, y) => x.localeCompare(y, 'zh-CN')),
      };
    })();

    res.json({
      pkName,
      startDate,
      endDate,
      isMock,
      pkStartDate: orderStart,
      pkEndDate: orderEnd,
      statusText,
      storeCount: storeRows.length,
      scoped: !!scopeShopSet,
      scopeShops: scopeShopSet ? Array.from(scopeShopSet) : [],
filter: pkFilter,
      dimFilter,
      comparableOptions,
      zone1,
      zone2,
      zone3,
      zone4,
      zone5: zone5Rows,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// 日目标（PK_StoreDailyTargets）：日期 × 督导 × 店铺名称 × 日目标
//  上传按 (taskOrderId, targetDate, shopName) upsert；督导以 店仓全 为准
//  （店仓全不存在该店铺或督导为空时回退文件内督导）。
// ============================================================

// 解析 Excel 单元格日期（支持 Date / Excel 序列号 / 文本 YYYY[-/.年]M[-/.月]D）
function parseDateCell(v: any): string {
  if (v == null || v === '') return '';
  if (v instanceof Date && !isNaN(v.getTime())) return toDateStr(v);
  const s = String(v).trim();
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const days = Number(s);
    if (days > 20000 && days < 60000) {
      const d = new Date(Math.round((days - 25569) * 86400000));
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    }
  }
  const m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(s);
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
  return '';
}

// 日目标列表（taskOrderId 必填；targetDate 可选）
router.get('/daily-targets', authMiddleware, requireMenuPerm('pk', 'pkDailyTarget'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const tid = Number(req.query.taskOrderId) || 0;
    if (!tid) return res.status(400).json({ error: '请先选择 PK任务单' });
    const targetDate = typeof req.query.targetDate === 'string' ? req.query.targetDate.trim() : '';
    const result = await pool.request()
      .input('tid', sql.Int, tid)
      .input('td', sql.Date, targetDate || null)
      .query(`
        SELECT id, CONVERT(varchar(10), targetDate, 23) AS targetDate, supervisor, shopName, dailyTarget
        FROM PK_StoreDailyTargets
        WHERE taskOrderId = @tid AND (@td IS NULL OR targetDate = @td)
        ORDER BY targetDate, shopName
      `);
    let rows = result.recordset.map((r: any) => ({
      id: r.id,
      targetDate: r.targetDate || '',
      supervisor: r.supervisor || '',
      shopName: r.shopName || '',
      dailyTarget: r.dailyTarget != null ? Number(r.dailyTarget) : 0,
    }));

    // 组织视角过滤（与 /report /data-table /daily-followup 同链路）：所有登录用户
    //  统一按 org_shop_bind 绑定店铺过滤；仅未登录（无 userCode）时兜底全量
    {
      let scopeShopSet: Set<string> | null = null;
      const mu = req.user || null;
      if (mu?.userCode) {
        try {
          scopeShopSet = new Set(await getScopeShopNamesByBind(pool, String(mu.userCode)));
        } catch (filterErr: any) {
          console.warn('[PK daily-targets] 组织视角过滤失败，按全量展示:', filterErr?.message);
        }
      }
      if (scopeShopSet) {
        rows = rows.filter((r: any) => scopeShopSet!.has(r.shopName));
      }
    }

    // 范围筛选（全部/本区/本店/仓库/经销商）+ 五维筛选（仓库类别/督导/区经/经销商/店铺名称）
    const pkFilter = parsePkScopeFilter(req.query.filter);
    const dimFilter = {
      warehouse: typeof req.query.warehouse === 'string' ? req.query.warehouse.trim() : '',
      supervisor: typeof req.query.supervisor === 'string' ? req.query.supervisor.trim() : '',
      districtManager: typeof req.query.districtManager === 'string' ? req.query.districtManager.trim() : '',
      dealer: typeof req.query.dealer === 'string' ? req.query.dealer.trim() : '',
      shopName: typeof req.query.shopName === 'string' ? req.query.shopName.trim() : '',
    };
    const hasDim = dimFilter.warehouse || dimFilter.supervisor || dimFilter.districtManager || dimFilter.dealer || dimFilter.shopName;
    if (pkFilter.scope || hasDim) {
      const authUser: any = req.user || null;
      let areaShops = new Set<string>();
      let directShops = new Set<string>();
      if (pkFilter.scope === 'area') areaShops = await resolveAreaShopsByUser(pool, authUser);
      if (pkFilter.scope === 'shop') directShops = await resolveDirectShopsByUser(pool, authUser);
      let needAttrs = pkFilter.scope === 'warehouse' || pkFilter.scope === 'dealer' || hasDim;
      let attrsMap: Record<string, { warehouseType: string; districtManager: string; supervisor: string; dealer: string }> = {};
      if (needAttrs) {
        const names = Array.from(new Set(rows.map(r => r.shopName).filter(Boolean)));
        if (names.length > 0) {
          const reqA = pool.request();
          names.forEach((s, i) => reqA.input(`s${i}`, sql.NVarChar, s));
          const ph = names.map((_, i) => `@s${i}`).join(',');
          const attrs = await reqA.query(`SELECT 店铺名称 AS shopName, 仓库类别 AS warehouseType, 区经 AS districtManager, 督导 AS supervisor, 经销商 AS dealer FROM 店仓全 WHERE 店铺名称 IN (${ph})`);
          attrs.recordset.forEach((r: any) => {
            attrsMap[r.shopName] = { warehouseType: r.warehouseType || '', districtManager: r.districtManager || '', supervisor: r.supervisor || '', dealer: r.dealer || '' };
          });
        }
      }
      rows = rows.filter(row => {
        const a = attrsMap[row.shopName] || { warehouseType: '未分类', districtManager: '', supervisor: '', dealer: '' };
        if (pkFilter.scope === 'area' && !areaShops.has(row.shopName)) return false;
        if (pkFilter.scope === 'shop' && !directShops.has(row.shopName)) return false;
        if (pkFilter.scope === 'warehouse' && a.warehouseType !== pkFilter.value) return false;
        if (pkFilter.scope === 'dealer' && a.dealer !== pkFilter.value) return false;
        if (dimFilter.warehouse && a.warehouseType !== dimFilter.warehouse) return false;
        if (dimFilter.supervisor && a.supervisor !== dimFilter.supervisor) return false;
        if (dimFilter.districtManager && a.districtManager !== dimFilter.districtManager) return false;
        if (dimFilter.dealer && a.dealer !== dimFilter.dealer) return false;
        if (dimFilter.shopName && !String(row.shopName || '').includes(dimFilter.shopName)) return false;
        return true;
      });
    }
    res.json({ rows, filter: pkFilter, dimFilter });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 日目标上传（xlsx/xls，列：日期 | 督导 | 店铺名称 | 日目标；同 任务单+日期+店铺 upsert）
const dailyTargetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.post('/daily-targets/upload', authMiddleware, requireMenuPerm('pk', 'pkDailyTarget'), dailyTargetUpload.single('file'), async (req: any, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const tid = Number(req.body?.taskOrderId) || 0;
    if (!tid) return res.status(400).json({ error: '请先选择 PK任务单' });
    if (!(await taskOrderExists(pool, tid))) return res.status(400).json({ error: 'PK任务单不存在' });
    const file = req.file;
    if (!file) return res.status(400).json({ error: '缺少上传文件（字段名 file）' });
    const fname = String(file.originalname || '').toLowerCase();
    if (!fname.endsWith('.xlsx') && !fname.endsWith('.xls')) {
      return res.status(400).json({ error: '仅支持 .xlsx / .xls 文件' });
    }
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(file.buffer, { type: 'buffer' });
    } catch (e: any) {
      return res.status(400).json({ error: 'Excel 解析失败：' + String(e?.message || e) });
    }
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return res.status(400).json({ error: 'Excel 中没有工作表' });
    const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (rawRows.length === 0) return res.status(400).json({ error: 'Excel 中没有数据行' });

    // 该任务单参与 PK 的店铺（用于校验 + 自动带出督导）
    const pkShops = await pool.request().input('tid', sql.Int, tid)
      .query('SELECT DISTINCT shopName FROM PK_StoreTargets WHERE taskOrderId = @tid');
    const shopSet = new Set(pkShops.recordset.map((r: any) => String(r.shopName || '').trim()));
    // 店仓全 店铺 → 督导
    const supRows = await pool.request().query('SELECT DISTINCT 店铺名称 AS shopName, 督导 AS supervisor FROM 店仓全 WHERE ISNULL(店铺名称, \'\') <> \'\'');
    const supByShop = new Map<string, string>();
    supRows.recordset.forEach((r: any) => {
      const sn = String(r.shopName || '').trim();
      if (sn && String(r.supervisor || '').trim()) supByShop.set(sn, String(r.supervisor).trim());
    });

    // 组织视角过滤（与 /daily-targets 列表/导出同链路）：仅允许写入当前用户可见店铺的数据，
    //  范围外店铺跳过并 warning；仅未登录（无 userCode）时兜底全量
    let scopeShopSet: Set<string> | null = null;
    const au = req.user || null;
    if (au?.userCode) {
      try {
        scopeShopSet = new Set(await getScopeShopNamesByBind(pool, String(au.userCode)));
      } catch (filterErr: any) {
        console.warn('[PK daily-targets/upload] 组织视角过滤失败，按全量写入:', filterErr?.message);
      }
    }

    const warnings: string[] = [];
    let rowNo = 1;
    // 源列键（兼容中英文列名）
    const pick = (row: any, keys: string[]): any => {
      for (const k of keys) {
        if (row[k] !== undefined && String(row[k] ?? '').trim() !== '') return row[k];
      }
      return undefined;
    };
    const upserts: { targetDate: string; supervisor: string; shopName: string; dailyTarget: number; rowNo: number }[] = [];
    for (const row of rawRows) {
      rowNo++;
      const targetDate = parseDateCell(pick(row, ['日期', 'targetDate', 'Date']));
      const shopName = String(pick(row, ['店铺名称', '店铺', 'shopName', 'ShopName']) ?? '').trim();
      const fileSup = String(pick(row, ['督导', 'supervisor', 'Supervisor']) ?? '').trim();
      const rawTarget = pick(row, ['日目标', '日目标金额', 'dailyTarget', 'DailyTarget', '目标']);
      const dailyTarget = Number(String(rawTarget ?? '').replace(/[,，\s]/g, '')) || 0;
      if (!targetDate) { warnings.push(`第 ${rowNo} 行：日期无效，已跳过`); continue; }
      if (!shopName) { warnings.push(`第 ${rowNo} 行：缺少店铺名称，已跳过`); continue; }
      if (!shopSet.has(shopName)) { warnings.push(`第 ${rowNo} 行：「${shopName}」不在此 PK 任务单的店铺目标中，已跳过`); continue; }
      if (scopeShopSet && !scopeShopSet.has(shopName)) { warnings.push(`第 ${rowNo} 行：「${shopName}」不在你的可管理店铺范围内，已跳过`); continue; }
      if (dailyTarget < 0) { warnings.push(`第 ${rowNo} 行：「${shopName}」日目标为负数，已跳过`); continue; }
      upserts.push({
        targetDate,
        supervisor: supByShop.get(shopName) || fileSup,
        shopName,
        dailyTarget,
        rowNo,
      });
    }
    if (upserts.length === 0) {
      return res.status(400).json({ ok: false, saved: 0, updated: 0, skipped: rawRows.length, warnings, message: '未解析到任何有效行，已中止导入' });
    }

    // 批量 upsert（同一 任务单+日期+店铺 更新，否则插入）
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      let saved = 0, updated = 0;
      for (const u of upserts) {
        const r = await tx.request()
          .input('tid', sql.Int, tid)
          .input('td', sql.Date, u.targetDate)
          .input('sup', sql.NVarChar, u.supervisor)
          .input('sn', sql.NVarChar, u.shopName)
          .input('dt', sql.Decimal(18, 2), u.dailyTarget)
          .input('by', sql.NVarChar, req.user?.userCode || '')
          .query(`
            UPDATE PK_StoreDailyTargets SET supervisor = @sup, dailyTarget = @dt, updatedAt = GETDATE()
            WHERE taskOrderId = @tid AND targetDate = @td AND shopName = @sn;
            IF @@ROWCOUNT = 0
              INSERT INTO PK_StoreDailyTargets (taskOrderId, targetDate, supervisor, shopName, dailyTarget, createdBy)
              VALUES (@tid, @td, @sup, @sn, @dt, @by)
          `);
        if (r.rowsAffected[1] === 1) saved++; else updated++;
      }
      await tx.commit();
      res.json({ ok: true, saved, updated, skipped: rawRows.length - upserts.length, warnings, message: `导入成功：新增 ${saved}、更新 ${updated}、跳过 ${rawRows.length - upserts.length}` });
    } catch (e: any) {
      await tx.rollback();
      res.status(500).json({ error: e.message });
    }
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 清空日目标：taskOrderId 必填；targetDate 可选（不传清空该任务单全部日期）。
// 权限：仅删除当前用户可见店铺（org_shop_bind 绑定范围）内的记录，范围外数据不受影响；
//  仅未登录（无 userCode）时兜底全量清空。
router.delete('/daily-targets/clear', authMiddleware, requireMenuPerm('pk', 'pkDailyTarget'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const tid = Number(req.query.taskOrderId) || 0;
    if (!tid) return res.status(400).json({ error: '请先选择 PK任务单' });
    const targetDate = typeof req.query.targetDate === 'string' ? req.query.targetDate.trim() : '';

    let scopeShops: string[] | null = null;
    const au = req.user || null;
    if (au?.userCode) {
      try {
        scopeShops = await getScopeShopNamesByBind(pool, String(au.userCode));
      } catch (filterErr: any) {
        console.warn('[PK daily-targets/clear] 组织视角过滤失败，按全量清空:', filterErr?.message);
      }
    }
    // 有可见店铺范围但为空（用户无任何可见店铺）→ 无可删除数据
    if (scopeShops !== null && scopeShops.length === 0) {
      return res.json({ ok: true, deleted: 0 });
    }

    const reqQ = pool.request()
      .input('tid', sql.Int, tid)
      .input('td', sql.Date, targetDate || null);
    let scopeSql = '';
    if (scopeShops !== null && scopeShops.length > 0) {
      const ph = scopeShops.map((_, i) => `@sn${i}`).join(',');
      scopeShops.forEach((s, i) => reqQ.input(`sn${i}`, sql.NVarChar, s));
      scopeSql = ` AND shopName IN (${ph})`;
    }
    const result = await reqQ.query(`DELETE FROM PK_StoreDailyTargets WHERE taskOrderId = @tid AND (@td IS NULL OR targetDate = @td)${scopeSql}`);
    res.json({ ok: true, deleted: result.rowsAffected[0] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 导出日目标 CSV（UTF-8 BOM，Excel 可直接打开）
router.get('/daily-targets/export', authMiddleware, requireMenuPerm('pk', 'pkDailyTarget'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const tid = Number(req.query.taskOrderId) || 0;
    if (!tid) return res.status(400).json({ error: '请先选择 PK任务单' });
    const targetDate = typeof req.query.targetDate === 'string' ? req.query.targetDate.trim() : '';
    const result = await pool.request()
      .input('tid', sql.Int, tid)
      .input('td', sql.Date, targetDate || null)
      .query(`
        SELECT CONVERT(varchar(10), targetDate, 23) AS targetDate, supervisor, shopName, dailyTarget
        FROM PK_StoreDailyTargets
        WHERE taskOrderId = @tid AND (@td IS NULL OR targetDate = @td)
        ORDER BY targetDate, shopName
      `);
    const esc = (v: any) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };

    // 组织视角过滤（与 /daily-targets 列表同链路）：导出只含当前用户可见店铺的数据，
    //  不再全量导出；仅未登录（无 userCode）时兜底全量
    let recs: any[] = result.recordset;
    const au = req.user || null;
    if (au?.userCode) {
      try {
        const scopeSet = new Set(await getScopeShopNamesByBind(pool, String(au.userCode)));
        recs = recs.filter((r: any) => scopeSet.has(r.shopName));
      } catch (filterErr: any) {
        console.warn('[PK daily-targets/export] 组织视角过滤失败，按全量导出:', filterErr?.message);
      }
    }

    const lines = ['日期,督导,店铺名称,日目标'];
    for (const r of recs) {
      lines.push([esc(r.targetDate), esc(r.supervisor), esc(r.shopName), esc(r.dailyTarget)].join(','));
    }
    const csv = '\uFEFF' + lines.join('\r\n');
    const order = await pool.request().input('tid', sql.Int, tid)
      .query('SELECT TOP 1 orderName FROM PK_TaskOrders WHERE id = @tid');
    const filename = `PK日目标_${(order.recordset[0]?.orderName || '')}_${toDateStr(new Date())}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(csv);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// 日目标跟进：三区聚合
//  第一区 督导维度 | 第二区 经销商维度 | 第三区 督导-店铺明细
//  每行指标： 总目标(圈战 target) / <日期>目标(日目标) / 业绩金额(圈战累计至统计日)
//  / <日期>业绩金额 / 达成率 / <日期>达成率 / 销售数量 / 开单数 / 连带率
//  / 礼包金额 / 礼包占比 / 件单价
//  业绩口径与 /report /data-table 一致（统计至今日；未开始→昨日；已结束→PK结束日）
//  权限：所有登录用户按 org_shop_bind 绑定店铺过滤（无 userCode 兜底全量）
// ============================================================
router.get('/daily-followup', authMiddleware, requireMenuPerm('pk', 'pkDailyFollowup'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const taskOrderId = Number(req.query.taskOrderId) || 0;
    if (!taskOrderId) return res.status(400).json({ error: '请选择 PK任务单' });

    const targets = await pool.request()
      .input('tid', sql.Int, taskOrderId)
      .query('SELECT shopName, target FROM PK_StoreTargets WHERE taskOrderId = @tid');

    // 任务单 PK 开始/结束时间 + 「业绩统计至」口径（与 /report 完全一致，不做模拟数据）
    const todayStr = toDateStr(new Date());
    const yDate = new Date();
    yDate.setDate(yDate.getDate() - 1);
    const yesterdayStr = toDateStr(yDate);
    let orderStart = '';
    let orderEnd = '';
    const ord = await pool.request().input('tid', sql.Int, taskOrderId)
      .query('SELECT TOP 1 orderName, pkStartDate, pkEndDate FROM PK_TaskOrders WHERE id = @tid');
    if (ord.recordset.length > 0) {
      orderStart = fmtDate(ord.recordset[0].pkStartDate);
      orderEnd = fmtDate(ord.recordset[0].pkEndDate);
    }
    let isMock = false;
    let statusText = '';
    let endDate = '';
    if (orderStart && todayStr < orderStart) {
      isMock = true;
      endDate = yesterdayStr;
      statusText = `PK 尚未开始（${orderStart} 开始），业绩统计至昨日`;
    } else {
      endDate = orderEnd && orderEnd < todayStr ? orderEnd : todayStr;
      if (orderEnd && orderEnd < todayStr) statusText = `PK 已结束（${orderEnd} 结束）`;
    }
    // 「日期筛选器」：控制区间指标（总目标/业绩金额/达成率/销售数量/开单数/连带率/礼包/客单价/件单价）的时间范围
    let dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom.trim() : '';
    let dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo.trim() : '';
    if (!dateFrom || !dateTo || dateFrom > dateTo) { dateFrom = orderStart || todayStr; dateTo = endDate; }
    // 「同比」同期区间：去年同期（日期各减 1 年）
    const prevYearStr = (d: string, n: number): string => {
      const dt = new Date(`${d}T00:00:00`);
      if (isNaN(dt.getTime())) return d;
      dt.setFullYear(dt.getFullYear() + n);
      return toDateStr(dt);
    };
    const lyFrom = prevYearStr(dateFrom, -1);
    const lyTo = prevYearStr(dateTo, -1);
    // 「展示日期筛选器」：控制每日 目标/业绩/达成 列的展示日期（默认逐日叠加至统计日）
    let showFrom = typeof req.query.showFrom === 'string' ? req.query.showFrom.trim() : '';
    let showTo = typeof req.query.showTo === 'string' ? req.query.showTo.trim() : '';
    if (!showFrom || !showTo || showFrom > showTo) { showFrom = orderStart || todayStr; showTo = endDate; }
    // 展示日期序列（升序；上限保护，避免一次性生成过多列）
    const showDates: string[] = [];
    {
      const sCur = new Date(`${showFrom}T00:00:00`);
      const sEnd = new Date(`${showTo}T00:00:00`);
      let guard = 0;
      while (!isNaN(sCur.getTime()) && sCur.getTime() <= sEnd.getTime() && guard < 400) {
        showDates.push(toDateStr(sCur));
        sCur.setDate(sCur.getDate() + 1);
        guard += 1;
      }
    }

    const storeRows = targets.recordset.map((r: any) => ({
      shopName: String(r.shopName || '').trim(),
      target: r.target != null ? Number(r.target) : 0,
    })).filter((r: any) => r.shopName);
    const shopNames = Array.from(new Set(storeRows.map((r: any) => r.shopName)));

    // 权限过滤（与 /report /data-table 同链路）
    let scopeShopSet: Set<string> | null = null;
    const authUser = req.user || null;
    if (authUser?.userCode) {
      try {
        const shops = await getScopeShopNamesByBind(pool, String(authUser.userCode));
        scopeShopSet = new Set(shops);
      } catch (filterErr: any) {
        console.warn('[PK daily-followup] 组织视角过滤失败，按全量展示:', filterErr?.message);
      }
    }
    const scoped = !!scopeShopSet;
    const scopeShops = scopeShopSet ? Array.from(scopeShopSet) : [];
    const visibleRows = scopeShopSet ? storeRows.filter((r: any) => scopeShopSet!.has(r.shopName)) : storeRows;
    const visibleNames = visibleRows.map((r: any) => r.shopName);

    // 范围筛选（全部/本区/本店/仓库/经销商）：叠加在可见店铺之上，聚合前应用
    const pkFilter = parsePkScopeFilter(req.query.filter);
    let areaShops = new Set<string>();
    let directShops = new Set<string>();
    if (pkFilter.scope === 'area') areaShops = await resolveAreaShopsByUser(pool, authUser);
    if (pkFilter.scope === 'shop') directShops = await resolveDirectShopsByUser(pool, authUser);

    // 五维筛选（仓库类别/督导/区经/经销商/店铺名称）+ 月可比/年可比（店仓全档案，多值逗号分隔）：行级 AND 过滤，叠加在范围筛选之上
    const dimFilter = {
      warehouse: typeof req.query.warehouse === 'string' ? req.query.warehouse.trim() : '',
      supervisor: typeof req.query.supervisor === 'string' ? req.query.supervisor.trim() : '',
      districtManager: typeof req.query.districtManager === 'string' ? req.query.districtManager.trim() : '',
      dealer: typeof req.query.dealer === 'string' ? req.query.dealer.trim() : '',
      shopName: typeof req.query.shopName === 'string' ? req.query.shopName.trim() : '',
      monthComparables: typeof req.query.monthComparable === 'string' ? req.query.monthComparable.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      yearComparables: typeof req.query.yearComparable === 'string' ? req.query.yearComparable.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
    };

    const placeholders = visibleNames.length > 0 ? visibleNames.map((_: string, i: number) => `@s${i}`).join(',') : '';
    const addShops = (q: any) => {
      visibleNames.forEach((s, i) => q.input(`s${i}`, sql.NVarChar, s));
      return q;
    };

    // 静态指标：区间业绩/数量/开单数、区间礼包金额、当日业绩/数量、日目标
    // 取值口径（2026-09-19 更新）：业绩金额 为 直营/山东直营/加盟 统一取值，不做过滤；
    //   销售数量 从数据提取台账「店铺销售数量」读取（过滤仓库类别/性别/款式，含 @dateCondition），
    //   台账读取失败或未覆盖的店铺直接输出 0，不回退内嵌数量逻辑；
    //   开单数/件单价/客单价/连带率 从数据提取台账「店铺均价_开单数_连带率」读取
    //   （与销售管理 getAvgPrices 同源，用户可在系统管理-数据提取中维护 SQL），
    //   开单数台账读取失败时回退内嵌 会员/单据 UNION 开单数逻辑。
    const ctx: Record<string, any> = {};
    if (visibleNames.length > 0 && orderStart) {
      const dxPromise = (async () => {
        try {
          const dxQuery = await getQueryFromDX(pool, '店铺均价_开单数_连带率', {
            dateCondition: `日期 >= '${dateFrom}' AND 日期 <= '${dateTo}'`,
          });
          return dxQuery ? await pool.request().query(dxQuery) : null;
        } catch (e: any) {
          console.warn('[PK daily-followup] 台账读取失败，回退内嵌开单数逻辑:', e?.message);
          return null;
        }
      })();
      // 「店铺销售数量」台账：销售数量（区间）以数据提取口径为准，失败直接输出 0（不回退内嵌）
      const qtyPromise = (async () => {
        try {
          const qtyQuery = await getQueryFromDX(pool, '店铺销售数量', {
            dateCondition: `日期 >= '${dateFrom}' AND 日期 <= '${dateTo}'`,
          });
          return qtyQuery ? await pool.request().query(qtyQuery) : null;
        } catch (e: any) {
          console.warn('[PK daily-followup] 销售数量台账读取失败，销售数量输出 0:', e?.message);
          return null;
        }
      })();
      // 去年同期 DX 台账：开单数/件单价/客单价/连带率
      const lyDxPromise = (async () => {
        try {
          const dxQuery = await getQueryFromDX(pool, '店铺均价_开单数_连带率', {
            dateCondition: `日期 >= '${lyFrom}' AND 日期 <= '${lyTo}'`,
          });
          return dxQuery ? await pool.request().query(dxQuery) : null;
        } catch (e: any) {
          console.warn('[PK daily-followup] 去年同期台账读取失败，回退内嵌开单数逻辑:', e?.message);
          return null;
        }
      })();
      // 去年同期「店铺销售数量」台账
      const lyQtyPromise = (async () => {
        try {
          const qtyQuery = await getQueryFromDX(pool, '店铺销售数量', {
            dateCondition: `日期 >= '${lyFrom}' AND 日期 <= '${lyTo}'`,
          });
          return qtyQuery ? await pool.request().query(qtyQuery) : null;
        } catch (e: any) {
          console.warn('[PK daily-followup] 去年同期销售数量台账读取失败:', e?.message);
          return null;
        }
      })();
      const [totalRes, lyRes, dailyActualRes, orderRes, giftRes, dailyTargetRes, totalTargetRes, dxResult, qtyResult, lyOrderRes, lyGiftRes, lyDxResult, lyQtyResult] = await Promise.all([
        // 区间业绩/数量：日期筛选器 dateFrom~dateTo
        addShops(pool.request())
          .input('sd', sql.Date, new Date(dateFrom))
          .input('ed', sql.Date, new Date(dateTo))
          .query(`SELECT 店铺名称 AS shopName, SUM(业绩金额) AS amt, SUM(数量) AS qty
                  FROM 有效业绩全
                  WHERE 日期 >= @sd AND 日期 <= @ed AND 店铺名称 IN (${placeholders})
                  GROUP BY 店铺名称`),
        // 去年同期区间业绩+数量：同比 同期金额/数量（dateFrom~dateTo 各减 1 年，同无过滤口径）
        addShops(pool.request())
          .input('lsd', sql.Date, new Date(lyFrom + 'T00:00:00'))
          .input('led', sql.Date, new Date(lyTo + 'T00:00:00'))
          .query(`SELECT 店铺名称 AS shopName, SUM(业绩金额) AS amt, SUM(数量) AS qty
                  FROM 有效业绩全
                  WHERE 日期 >= @lsd AND 日期 <= @led AND 店铺名称 IN (${placeholders})
                  GROUP BY 店铺名称`),
        // 每日业绩金额：展示日期筛选器 showFrom~showTo，按天分组
        addShops(pool.request())
          .input('sdf', sql.Date, new Date(showFrom))
          .input('sdt', sql.Date, new Date(showTo))
          .query(`SELECT 店铺名称 AS shopName, CONVERT(varchar(10), 日期, 23) AS d, SUM(业绩金额) AS amt
                  FROM 有效业绩全
                  WHERE 日期 >= @sdf AND 日期 <= @sdt AND 店铺名称 IN (${placeholders})
                  GROUP BY 店铺名称, CONVERT(varchar(10), 日期, 23)`),
        // 区间开单数：日期筛选器（台账优先，此为兜底，与DX台账口径一致：直营/山东直营按会员代码拆分，加盟按单据编号）
        addShops(pool.request())
          .input('sd', sql.Date, new Date(dateFrom))
          .input('ed', sql.Date, new Date(dateTo))
          .query(`SELECT shopName, SUM(开单数) AS orderCount FROM (
                    SELECT 店铺名称 AS shopName, SUM(业绩金额) AS 业绩金额, SUM(数量) AS 数量,
                           CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END AS 开单数
                    FROM 有效业绩全
                    WHERE 日期 >= @sd AND 日期 <= @ed AND 店铺名称 IN (${placeholders})
                      AND 仓库类别 IN ('直营','山东直营') AND 会员代码 <> ''
                      AND 性别 IN ('男鞋','女鞋','童鞋','包') AND 款式 <> '洞洞鞋'
                    GROUP BY 店铺名称, 会员代码
                    HAVING SUM(数量) <> 0 AND SUM(业绩金额) <> 0
                    UNION ALL
                    SELECT 店铺名称 AS shopName, SUM(业绩金额) AS 业绩金额, SUM(数量) AS 数量,
                           CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END AS 开单数
                    FROM 有效业绩全
                    WHERE 日期 >= @sd AND 日期 <= @ed AND 店铺名称 IN (${placeholders})
                      AND 仓库类别 IN ('直营','山东直营') AND 会员代码 IS NULL
                      AND 性别 IN ('男鞋','女鞋','童鞋','包') AND 款式 <> '洞洞鞋'
                    GROUP BY 店铺名称, 单据编号
                    HAVING SUM(数量) <> 0 AND SUM(业绩金额) <> 0
                    UNION ALL
                    SELECT 店铺名称 AS shopName, SUM(业绩金额) AS 业绩金额, SUM(数量) AS 数量,
                           CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END AS 开单数
                    FROM 有效业绩全
                    WHERE 日期 >= @sd AND 日期 <= @ed AND 店铺名称 IN (${placeholders})
                      AND 仓库类别 IN ('加盟')
                      AND 性别 IN ('男鞋','女鞋','童鞋','包') AND 款式 <> '洞洞鞋'
                    GROUP BY 店铺名称, 单据编号
                    HAVING SUM(数量) <> 0 AND SUM(业绩金额) <> 0
                  ) t GROUP BY shopName`),
        // 区间礼包金额：日期筛选器
        addShops(pool.request())
          .input('sd', sql.Date, new Date(dateFrom))
          .input('ed', sql.Date, new Date(dateTo))
          .query(`SELECT shopName, SUM(礼包金额) AS giftAmount FROM (
                    SELECT 店铺名称 AS shopName, 会员代码, SUM(业绩金额) AS 礼包金额
                    FROM 有效业绩全
                    WHERE 日期 >= @sd AND 日期 <= @ed AND 店铺名称 IN (${placeholders}) AND 充值类型 = '充值' AND 会员代码 <> ''
                    GROUP BY 店铺名称, 会员代码, 单据编号
                    UNION ALL
                    SELECT 店铺名称 AS shopName, '' AS 会员代码, SUM(业绩金额) AS 礼包金额
                    FROM 有效业绩全
                    WHERE 日期 >= @sd AND 日期 <= @ed AND 店铺名称 IN (${placeholders}) AND 充值类型 = '充值' AND ISNULL(会员代码,'') = ''
                    GROUP BY 店铺名称, 单据编号
                  ) t GROUP BY shopName`),
        // 每日目标：展示日期筛选器，按天分组
        addShops(pool.request())
          .input('tid', sql.Int, taskOrderId)
          .input('sdf', sql.Date, new Date(showFrom))
          .input('sdt', sql.Date, new Date(showTo))
          .query(`SELECT shopName, CONVERT(varchar(10), targetDate, 23) AS d, SUM(ISNULL(dailyTarget,0)) AS dayTarget
                  FROM PK_StoreDailyTargets
                  WHERE taskOrderId = @tid AND targetDate >= @sdf AND targetDate <= @sdt AND shopName IN (${placeholders})
                  GROUP BY shopName, CONVERT(varchar(10), targetDate, 23)`),
        // 总目标：日期筛选器区间内每日目标之和；无记录回退 PK_StoreTargets.target
        addShops(pool.request())
          .input('tid', sql.Int, taskOrderId)
          .input('sdf', sql.Date, new Date(dateFrom))
          .input('sdt', sql.Date, new Date(dateTo))
          .query(`SELECT shopName, SUM(ISNULL(dailyTarget,0)) AS totalTarget
                  FROM PK_StoreDailyTargets
                  WHERE taskOrderId = @tid AND targetDate >= @sdf AND targetDate <= @sdt AND shopName IN (${placeholders})
                  GROUP BY shopName`),
        dxPromise,
        qtyPromise,
        // 去年同期开单数（兜底，与DX台账口径一致：直营/山东直营按会员代码拆分，加盟按单据编号）
        addShops(pool.request())
          .input('lsd', sql.Date, new Date(lyFrom + 'T00:00:00'))
          .input('led', sql.Date, new Date(lyTo + 'T00:00:00'))
          .query(`SELECT shopName, SUM(开单数) AS orderCount FROM (
                    SELECT 店铺名称 AS shopName, SUM(业绩金额) AS 业绩金额, SUM(数量) AS 数量,
                           CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END AS 开单数
                    FROM 有效业绩全
                    WHERE 日期 >= @lsd AND 日期 <= @led AND 店铺名称 IN (${placeholders})
                      AND 仓库类别 IN ('直营','山东直营') AND 会员代码 <> ''
                      AND 性别 IN ('男鞋','女鞋','童鞋','包') AND 款式 <> '洞洞鞋'
                    GROUP BY 店铺名称, 会员代码
                    HAVING SUM(数量) <> 0 AND SUM(业绩金额) <> 0
                    UNION ALL
                    SELECT 店铺名称 AS shopName, SUM(业绩金额) AS 业绩金额, SUM(数量) AS 数量,
                           CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END AS 开单数
                    FROM 有效业绩全
                    WHERE 日期 >= @lsd AND 日期 <= @led AND 店铺名称 IN (${placeholders})
                      AND 仓库类别 IN ('直营','山东直营') AND 会员代码 IS NULL
                      AND 性别 IN ('男鞋','女鞋','童鞋','包') AND 款式 <> '洞洞鞋'
                    GROUP BY 店铺名称, 单据编号
                    HAVING SUM(数量) <> 0 AND SUM(业绩金额) <> 0
                    UNION ALL
                    SELECT 店铺名称 AS shopName, SUM(业绩金额) AS 业绩金额, SUM(数量) AS 数量,
                           CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END AS 开单数
                    FROM 有效业绩全
                    WHERE 日期 >= @lsd AND 日期 <= @led AND 店铺名称 IN (${placeholders})
                      AND 仓库类别 IN ('加盟')
                      AND 性别 IN ('男鞋','女鞋','童鞋','包') AND 款式 <> '洞洞鞋'
                    GROUP BY 店铺名称, 单据编号
                    HAVING SUM(数量) <> 0 AND SUM(业绩金额) <> 0
                  ) t GROUP BY shopName`),
        // 去年同期礼包金额
        addShops(pool.request())
          .input('lsd', sql.Date, new Date(lyFrom + 'T00:00:00'))
          .input('led', sql.Date, new Date(lyTo + 'T00:00:00'))
          .query(`SELECT shopName, SUM(礼包金额) AS giftAmount FROM (
                    SELECT 店铺名称 AS shopName, 会员代码, SUM(业绩金额) AS 礼包金额
                    FROM 有效业绩全
                    WHERE 日期 >= @lsd AND 日期 <= @led AND 店铺名称 IN (${placeholders}) AND 充值类型 = '充值' AND 会员代码 <> ''
                    GROUP BY 店铺名称, 会员代码, 单据编号
                    UNION ALL
                    SELECT 店铺名称 AS shopName, '' AS 会员代码, SUM(业绩金额) AS 礼包金额
                    FROM 有效业绩全
                    WHERE 日期 >= @lsd AND 日期 <= @led AND 店铺名称 IN (${placeholders}) AND 充值类型 = '充值' AND ISNULL(会员代码,'') = ''
                    GROUP BY 店铺名称, 单据编号
                  ) t GROUP BY shopName`),
        lyDxPromise,
        lyQtyPromise,
      ]);
      ctx.total = new Map(totalRes.recordset.map((r: any) => [r.shopName, { amt: Number(r.amt) || 0, qty: 0 }]));
      // 销售数量以数据提取「店铺销售数量」台账为准（不回退内嵌）：台账成功时覆盖命中店铺，失败或未覆盖店铺输出 0
      if (qtyResult && qtyResult.recordset) {
        for (const r of qtyResult.recordset) {
          const shop = String(r.店铺名称 || '').trim();
          if (!shop) continue;
          const cur = ctx.total.get(shop);
          if (cur) cur.qty = Number(r.quantity) || 0;
        }
      }
      // 去年同期业绩金额：同比 同期基数（店铺无同期数据时保持缺省 0）
      ctx.lastYearAmt = new Map<string, number>(lyRes.recordset.map((r: any) => [r.shopName, Number(r.amt) || 0]));
      // 每日业绩金额：shop -> date -> amt
      ctx.dailyActual = new Map<string, Map<string, number>>();
      for (const r of dailyActualRes.recordset) {
        const shop = String(r.shopName || '').trim();
        if (!shop || r.d == null) continue;
        if (!ctx.dailyActual.has(shop)) ctx.dailyActual.set(shop, new Map<string, number>());
        ctx.dailyActual.get(shop)!.set(String(r.d), Number(r.amt) || 0);
      }
      // 每日目标：shop -> date -> target
      ctx.dailyTarget = new Map<string, Map<string, number>>();
      for (const r of dailyTargetRes.recordset) {
        const shop = String(r.shopName || '').trim();
        if (!shop || r.d == null) continue;
        if (!ctx.dailyTarget.has(shop)) ctx.dailyTarget.set(shop, new Map<string, number>());
        ctx.dailyTarget.get(shop)!.set(String(r.d), Number(r.dayTarget) || 0);
      }
      // 总目标：日期筛选器区间日目标之和；该店无日目标记录时回退 PK_StoreTargets.target
      ctx.totalTarget = new Map<string, number>();
      {
        const ttMap = new Map<string, number>(totalTargetRes.recordset.map((r: any) => [String(r.shopName || '').trim(), Number(r.totalTarget) || 0]));
        for (const r of storeRows) {
          const v = ttMap.get(r.shopName);
          ctx.totalTarget.set(r.shopName, v != null && v > 0 ? v : (r.target || 0));
        }
      }
      ctx.order = new Map(orderRes.recordset.map((r: any) => [r.shopName, Number(r.orderCount) || 0]));
      // 台账「店铺均价_开单数_连带率」：保留 鞋金额/鞋数量/开单数 原始分子分母，
      // 件单价/客单价/连带率 一律由分子分母计算（与销售管理 getAvgPrices 同源，保证与台账数值一致）
      ctx.dx = new Map<string, { orderCount: number; shoeAmount: number; shoeQuantity: number }>();
      if (dxResult && dxResult.recordset) {
        for (const r of dxResult.recordset) {
          const shop = String(r.店铺名称 || '').trim();
          if (!shop) continue;
          ctx.dx.set(shop, {
            orderCount: Number(r.开单数) || 0,
            shoeAmount: Number(r.鞋金额) || 0,
            shoeQuantity: Number(r.鞋数量) || 0,
          });
        }
      }
      // 台账开单数优先；台账未覆盖的店铺回退内嵌 orderRes
      if (ctx.dx.size > 0) {
        for (const [shop, v] of ctx.dx.entries()) ctx.order.set(shop, v.orderCount);
      }
      ctx.gift = new Map(giftRes.recordset.map((r: any) => [r.shopName, Number(r.giftAmount) || 0]));
      // 去年同期指标：lyTotal(amt+qty)、lyOrder、lyDx、lyGift
      // lyRes 已查 SUM(数量) AS qty，直接用作同期销售数量初始值；DX 台账命中时覆盖
      ctx.lyTotal = new Map(lyRes.recordset.map((r: any) => [r.shopName, { amt: Number(r.amt) || 0, qty: Number(r.qty) || 0 }]));
      if (lyQtyResult && lyQtyResult.recordset) {
        for (const r of lyQtyResult.recordset) {
          const shop = String(r.店铺名称 || '').trim();
          if (!shop) continue;
          const cur = ctx.lyTotal.get(shop);
          if (cur) cur.qty = Number(r.quantity) || 0;
        }
      }
      ctx.lyOrder = new Map(lyOrderRes.recordset.map((r: any) => [r.shopName, Number(r.orderCount) || 0]));
      ctx.lyDx = new Map<string, { orderCount: number; shoeAmount: number; shoeQuantity: number }>();
      if (lyDxResult && lyDxResult.recordset) {
        for (const r of lyDxResult.recordset) {
          const shop = String(r.店铺名称 || '').trim();
          if (!shop) continue;
          ctx.lyDx.set(shop, {
            orderCount: Number(r.开单数) || 0,
            shoeAmount: Number(r.鞋金额) || 0,
            shoeQuantity: Number(r.鞋数量) || 0,
          });
        }
      }
      if (ctx.lyDx.size > 0) {
        for (const [shop, v] of ctx.lyDx.entries()) ctx.lyOrder.set(shop, v.orderCount);
      }
      ctx.lyGift = new Map(lyGiftRes.recordset.map((r: any) => [r.shopName, Number(r.giftAmount) || 0]));
    } else {
      ctx.total = new Map(); ctx.dailyActual = new Map(); ctx.dailyTarget = new Map(); ctx.totalTarget = new Map();
      ctx.order = new Map(); ctx.gift = new Map(); ctx.dx = new Map(); ctx.lastYearAmt = new Map();
      ctx.lyTotal = new Map(); ctx.lyOrder = new Map(); ctx.lyGift = new Map(); ctx.lyDx = new Map();
    }

    // 店铺属性：仓库类别 / 区经 / 督导 / 经销商 / 商品 / 月可比性 / 年可比性（店仓全）
    const shopAttrs: Record<string, { warehouseType: string; districtManager: string; supervisor: string; dealer: string; product: string; monthComparable: string; yearComparable: string }> = {};
    if (visibleNames.length > 0) {
      const reqA = addShops(pool.request());
      const attrs = await reqA.query(`
        SELECT 店铺名称 AS shopName, 仓库类别 AS warehouseType, 区经 AS districtManager, 督导 AS supervisor, 经销商 AS dealer,
               商品 AS product, 月可比性 AS monthComparable, 年可比性 AS yearComparable
        FROM 店仓全 WHERE 店铺名称 IN (${placeholders})
      `);
      attrs.recordset.forEach((r: any) => {
        shopAttrs[r.shopName] = {
          warehouseType: r.warehouseType || '',
          districtManager: r.districtManager || '',
          supervisor: r.supervisor || '',
          dealer: r.dealer || '',
          product: r.product || '',
          monthComparable: r.monthComparable || '',
          yearComparable: r.yearComparable || '',
        };
      });
    }

    // 三区聚合
    const rateOf = (target: number, actual: number) => target > 0 ? actual / target : (actual > 0 ? Infinity : 0);
    interface RowAgg {
      totalTarget: number; totalActual: number;
      salesQty: number; orderCount: number; giftAmount: number; shops: number;
      /** 本期店铺数：本期业绩 > 0 的店铺才计数；同期店铺数：同期业绩 > 0 的店铺才计数 */
      activeShops: number; lyActiveShops: number;
      lastYearAmt: number;
      lyTotalActual: number; lySalesQty: number; lyOrderCount: number; lyGiftAmount: number;
      dailyTarget: Map<string, number>; dailyActual: Map<string, number>;
      // 「店铺均价_开单数_连带率」台账分子分母（本期/同期；仅台账覆盖店铺计入）
      dxAmount: number; dxQty: number; dxOrder: number;
      lyDxAmount: number; lyDxQty: number; lyDxOrder: number;
    }
    const filteredRows = applyPkScopeFilter(visibleRows, pkFilter, shopAttrs, areaShops, directShops);
    // 七维筛选：行级 AND 过滤（叠加在范围筛选之上；权限边界由 visibleRows 保证）
    const dimmedRows = filteredRows.filter((row: any) => {
      const a = shopAttrs[row.shopName] || { warehouseType: '', districtManager: '', supervisor: '', dealer: '', monthComparable: '', yearComparable: '' };
      if (dimFilter.warehouse && (a.warehouseType || '未分类') !== dimFilter.warehouse) return false;
      if (dimFilter.supervisor && (a.supervisor || '') !== dimFilter.supervisor) return false;
      if (dimFilter.districtManager && (a.districtManager || '') !== dimFilter.districtManager) return false;
      if (dimFilter.dealer && (a.dealer || '') !== dimFilter.dealer) return false;
      if (dimFilter.shopName && !String(row.shopName || '').includes(dimFilter.shopName)) return false;
      if (dimFilter.monthComparables.length > 0 && !dimFilter.monthComparables.includes(a.monthComparable || '')) return false;
      if (dimFilter.yearComparables.length > 0 && !dimFilter.yearComparables.includes(a.yearComparable || '')) return false;
      return true;
    });
    const zone1Map = new Map<string, RowAgg>();
    const zone2Map = new Map<string, RowAgg>();
    const zone3Map = new Map<string, RowAgg>();
    const zoneProductMap = new Map<string, RowAgg>();
    // 聚合区仓库类别集合：同一督导/经销商/商品可能覆盖多个仓库类别，去重合并展示
    const zone1Types = new Map<string, Set<string>>();
    const zone2Types = new Map<string, Set<string>>();
    const zoneProductTypes = new Map<string, Set<string>>();
    const collectType = (map: Map<string, Set<string>>, key: string, wt: string) => {
      if (!map.has(key)) map.set(key, new Set<string>());
      map.get(key)!.add(wt);
    };
    const mergeTypes = (types?: Set<string>): string =>
      types ? Array.from(types).sort((a, b) => a.localeCompare(b, 'zh-CN')).join(', ') : '';
    const addTo = (map: Map<string, RowAgg>, key: string, row: {
      totalTarget: number; totalActual: number;
      salesQty: number; orderCount: number; giftAmount: number;
      lastYearAmt: number;
      lyTotalActual: number; lySalesQty: number; lyOrderCount: number; lyGiftAmount: number;
      dailyTarget: Map<string, number>; dailyActual: Map<string, number>;
      dxAmount: number; dxQty: number; dxOrder: number;
      lyDxAmount: number; lyDxQty: number; lyDxOrder: number;
    }) => {
      const cur = map.get(key) || {
        totalTarget: 0, totalActual: 0, salesQty: 0, orderCount: 0, giftAmount: 0, shops: 0, activeShops: 0, lyActiveShops: 0, lastYearAmt: 0,
        lyTotalActual: 0, lySalesQty: 0, lyOrderCount: 0, lyGiftAmount: 0,
        dailyTarget: new Map<string, number>(), dailyActual: new Map<string, number>(),
        dxAmount: 0, dxQty: 0, dxOrder: 0,
        lyDxAmount: 0, lyDxQty: 0, lyDxOrder: 0,
      };
      cur.totalTarget += row.totalTarget;
      cur.totalActual += row.totalActual;
      cur.salesQty += row.salesQty;
      cur.orderCount += row.orderCount;
      cur.giftAmount += row.giftAmount;
      cur.lastYearAmt += row.lastYearAmt;
      cur.lyTotalActual += row.lyTotalActual;
      cur.lySalesQty += row.lySalesQty;
      cur.lyOrderCount += row.lyOrderCount;
      cur.lyGiftAmount += row.lyGiftAmount;
      cur.dxAmount += row.dxAmount;
      cur.dxQty += row.dxQty;
      cur.dxOrder += row.dxOrder;
      cur.lyDxAmount += row.lyDxAmount;
      cur.lyDxQty += row.lyDxQty;
      cur.lyDxOrder += row.lyDxOrder;
      for (const [d, v] of row.dailyTarget.entries()) cur.dailyTarget.set(d, (cur.dailyTarget.get(d) || 0) + v);
      for (const [d, v] of row.dailyActual.entries()) cur.dailyActual.set(d, (cur.dailyActual.get(d) || 0) + v);
      cur.shops += 1;
      if (row.totalActual > 0) cur.activeShops += 1;
      if (row.lyTotalActual > 0) cur.lyActiveShops += 1;
      map.set(key, cur);
    };
    for (const r of dimmedRows) {
      const a = shopAttrs[r.shopName] || { warehouseType: '', districtManager: '', supervisor: '', dealer: '', product: '' };
      const wt = a.warehouseType || '未分类';
      const sup = a.supervisor || '(未分配督导)';
      const dealer = a.dealer || '(未关联经销商)';
      const pd = a.product || '(未分配商品)';
      const t = ctx.total.get(r.shopName) || { amt: 0, qty: 0 };
      const lyT = ctx.lyTotal.get(r.shopName) || { amt: 0, qty: 0 };
      const dx = ctx.dx.get(r.shopName);
      const lyDx = ctx.lyDx.get(r.shopName);
      const metrics = {
        totalTarget: ctx.totalTarget.get(r.shopName) || 0,
        totalActual: t.amt,
        salesQty: t.qty,
        orderCount: ctx.order.get(r.shopName) || 0,
        giftAmount: ctx.gift.get(r.shopName) || 0,
        lastYearAmt: ctx.lastYearAmt.get(r.shopName) || 0,
        lyTotalActual: lyT.amt,
        lySalesQty: lyT.qty,
        lyOrderCount: lyDx ? lyDx.orderCount : (ctx.lyOrder.get(r.shopName) || 0),
        lyGiftAmount: ctx.lyGift.get(r.shopName) || 0,
        dailyTarget: new Map<string, number>(ctx.dailyTarget.get(r.shopName) || []),
        dailyActual: new Map<string, number>(ctx.dailyActual.get(r.shopName) || []),
        // 台账分子分母：单店命中即该店台账值，未命中记 0（汇总口径只含台账覆盖店铺）
        dxAmount: dx ? dx.shoeAmount : 0,
        dxQty: dx ? dx.shoeQuantity : 0,
        dxOrder: dx ? dx.orderCount : 0,
        lyDxAmount: lyDx ? lyDx.shoeAmount : 0,
        lyDxQty: lyDx ? lyDx.shoeQuantity : 0,
        lyDxOrder: lyDx ? lyDx.orderCount : 0,
      };
      collectType(zone1Types, sup, wt);
      collectType(zone2Types, `${sup}||${dealer}||${pd}`, wt);
      collectType(zoneProductTypes, pd, wt);
      addTo(zone1Map, sup, metrics);
      addTo(zone2Map, `${sup}||${dealer}||${pd}`, metrics);
      addTo(zoneProductMap, pd, metrics);
addTo(zone3Map, `${sup}||${r.shopName}`, metrics);
    }

    // —— 销售等级（经销商级 / 店铺级）——
    // 规则：加盟/山东直营/直营（warehouseType）各自分组，组内按时间段业绩（dateFrom~dateTo 业绩金额）
    //   从高到低排序，逐行累计占比 ≤25% → S、≤50% → A、≤75% → B、其余 → C。
    // 经销商维度：该经销商名下所有可见店铺业绩金额之和（同一经销商在 zone2 各组合行等级一致）；
    // 店铺维度：单店区间业绩。等级基于七维筛选后的 dimmedRows 计算，与页面展示业绩口径一致。
    const gradeRank: Record<string, number> = { S: 4, A: 3, B: 2, C: 1 };
    const gradeOfRatio = (ratio: number): string => ratio <= 0.25 ? 'S' : ratio <= 0.5 ? 'A' : ratio <= 0.75 ? 'B' : 'C';
    const computeGrades = (groupAmt: Map<string, Map<string, number>>): Map<string, Map<string, string>> => {
      const grades = new Map<string, Map<string, string>>();
      for (const [wt, items] of groupAmt.entries()) {
        const sorted = Array.from(items.entries()).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'zh-CN'));
        const total = sorted.reduce((s, e) => s + e[1], 0);
        const g = new Map<string, string>();
        if (total > 0) {
          let cum = 0;
          for (const [name, amt] of sorted) {
            cum += amt;
            g.set(name, gradeOfRatio(cum / total));
          }
        } else {
          for (const [name] of sorted) g.set(name, 'C');
        }
        grades.set(wt, g);
      }
      return grades;
    };
    const dealerGroupAmt = new Map<string, Map<string, number>>();
    const shopGroupAmt = new Map<string, Map<string, number>>();
    for (const r of dimmedRows) {
      const a = shopAttrs[r.shopName] || {};
      const wt = a.warehouseType || '未分类';
      const amt = (ctx.total.get(r.shopName) || { amt: 0 }).amt;
      const dealer = a.dealer || '(未关联经销商)';
      if (!dealerGroupAmt.has(wt)) dealerGroupAmt.set(wt, new Map());
      const dm = dealerGroupAmt.get(wt)!;
      dm.set(dealer, (dm.get(dealer) || 0) + amt);
      if (!shopGroupAmt.has(wt)) shopGroupAmt.set(wt, new Map());
      const sm = shopGroupAmt.get(wt)!;
      sm.set(r.shopName, (sm.get(r.shopName) || 0) + amt);
    }
    const dealerGrades = computeGrades(dealerGroupAmt);
    const shopGrades = computeGrades(shopGroupAmt);
    const dealerGradeOf = (wt: string, dealer: string): string => dealerGrades.get(wt)?.get(dealer) || '';
    const shopGradeOf = (wt: string, shopName: string): string => shopGrades.get(wt)?.get(shopName) || '';
    const bestDealerGrade = (types: Set<string> | undefined, dealer: string): string => {
      if (!types) return '';
      const found = Array.from(types).map(wt => dealerGradeOf(wt, dealer)).filter(Boolean);
      if (found.length === 0) return '';
      return found.slice().sort((a, b) => gradeRank[b] - gradeRank[a])[0];
    };

    const toRow = (agg: RowAgg, ext: Record<string, any>): any => {
      const totalRate = rateOf(agg.totalTarget, agg.totalActual);
      // 件单价/客单价/连带率 完全按「店铺均价_开单数_连带率」台账取值：
      // 单店行 = 该店台账 鞋金额/鞋数量/开单数 计算；汇总/合计 = 所属店铺台账分子分母累加后重新计算
      // （与销售管理 getAvgPrices 同源，用户可在系统管理-数据提取维护台账 SQL）；台账未覆盖（分子分母全 0）时回退聚合派生
      const orderCount = agg.orderCount;
      const hasDx = agg.dxOrder !== 0 || agg.dxQty !== 0 || agg.dxAmount !== 0;
      const attachmentRate = hasDx
        ? (agg.dxOrder !== 0 ? round2(agg.dxQty / agg.dxOrder) : 0)
        : (agg.orderCount > 0 ? round2(agg.salesQty / agg.orderCount) : 0);
      const avgItemPrice = hasDx
        ? (agg.dxQty > 0 ? round2(agg.dxAmount / agg.dxQty) : 0)
        : (agg.salesQty > 0 ? round2(agg.totalActual / agg.salesQty) : 0);
      const avgOrderValue = hasDx
        ? (agg.dxOrder !== 0 ? round2(agg.dxAmount / agg.dxOrder) : 0)
        : (agg.orderCount > 0 ? round2(agg.totalActual / agg.orderCount) : 0);
      // 每日列：展示日期序列内 目标/业绩/达成 逐日数据（前端按 showDates 渲染列）
      const daily = showDates.map((d) => {
        const target = agg.dailyTarget.get(d) || 0;
        const actual = agg.dailyActual.get(d) || 0;
        const rate = rateOf(target, actual);
        return { date: d, target: round2(target), actual: round2(actual), rate: rate === Infinity ? Infinity : rate };
      });
      // 去年同期：与本期同口径，完全按同期台账分子分母
      const lyOrderCount = agg.lyOrderCount;
      const hasLyDx = agg.lyDxOrder !== 0 || agg.lyDxQty !== 0 || agg.lyDxAmount !== 0;
      const lyAttachmentRate = hasLyDx
        ? (agg.lyDxOrder !== 0 ? round2(agg.lyDxQty / agg.lyDxOrder) : 0)
        : (agg.lyOrderCount > 0 ? round2(agg.lySalesQty / agg.lyOrderCount) : 0);
      const lyAvgItemPrice = hasLyDx
        ? (agg.lyDxQty > 0 ? round2(agg.lyDxAmount / agg.lyDxQty) : 0)
        : (agg.lySalesQty > 0 ? round2(agg.lyTotalActual / agg.lySalesQty) : 0);
      const lyAvgOrderValue = hasLyDx
        ? (agg.lyDxOrder !== 0 ? round2(agg.lyDxAmount / agg.lyDxOrder) : 0)
        : (agg.lyOrderCount > 0 ? round2(agg.lyTotalActual / agg.lyOrderCount) : 0);
      // 店效（店均业绩）：本期店效 = 本期业绩 / 本期店铺数（本期业绩 > 0 才记）；同期店效 = 同期业绩 / 同期店铺数（同期业绩 > 0 才记）；保留整数
      const storeSales = agg.activeShops > 0 ? Math.round(agg.totalActual / agg.activeShops) : null;
      const lyStoreSales = agg.lyActiveShops > 0 ? Math.round(agg.lyTotalActual / agg.lyActiveShops) : null;
      const storeSalesYoy = (lyStoreSales != null && lyStoreSales > 0) ? round4((storeSales ?? 0) / lyStoreSales - 1) : null;
      return {
        ...ext,
        totalTarget: round2(agg.totalTarget),
        daily,
        totalActual: round2(agg.totalActual),
        totalRate: totalRate === Infinity ? Infinity : totalRate,
        // 同比 = 业绩金额/同期金额-1；同期金额（去年同期）为 0 或缺省时输出 null（前端显示 —）
        yoy: agg.lastYearAmt > 0 ? round4(agg.totalActual / agg.lastYearAmt - 1) : null,
        lastYearAmt: round2(agg.lastYearAmt),
        salesQty: agg.salesQty,
        orderCount,
        attachmentRate,
        giftAmount: round2(agg.giftAmount),
        giftRatio: agg.totalActual > 0 ? round2(agg.giftAmount / agg.totalActual) : 0,
        avgItemPrice,
        avgOrderValue,
        // 去年同期指标
        lyTotalActual: round2(agg.lyTotalActual),
        lySalesQty: agg.lySalesQty,
        lyOrderCount,
        lyAttachmentRate,
        lyGiftAmount: round2(agg.lyGiftAmount),
        lyGiftRatio: agg.lyTotalActual > 0 ? round2(agg.lyGiftAmount / agg.lyTotalActual) : 0,
        lyAvgItemPrice,
        lyAvgOrderValue,
        // 台账口径分子分母（单店行=该店台账值，汇总行=所属店铺台账累加；供前端合计行按台账口径重算）
        dxAmount: round2(agg.dxAmount),
        dxQty: agg.dxQty,
        dxOrder: agg.dxOrder,
        lyDxAmount: round2(agg.lyDxAmount),
        lyDxQty: agg.lyDxQty,
        lyDxOrder: agg.lyDxOrder,
        shops: agg.shops,
        activeShops: agg.activeShops,
        lyActiveShops: agg.lyActiveShops,
        storeSales,
        lyStoreSales,
        storeSalesYoy,
      };
    };
    const zone1 = Array.from(zone1Map.entries()).map(([key, v]) => toRow(v, { supervisor: key, warehouseType: mergeTypes(zone1Types.get(key)) }))
      .sort((a, b) => a.supervisor.localeCompare(b.supervisor, 'zh-CN'));
    const zoneProduct = Array.from(zoneProductMap.entries()).map(([key, v]) => toRow(v, { product: key, warehouseType: mergeTypes(zoneProductTypes.get(key)) }))
      .sort((a, b) => a.product.localeCompare(b.product, 'zh-CN'));
const zone2 = Array.from(zone2Map.entries()).map(([key, v]) => {
      const [sup, dealer, product] = key.split('||');
      return toRow(v, {
        supervisor: sup, dealer, product, warehouseType: mergeTypes(zone2Types.get(key)),
        dealerGrade: bestDealerGrade(zone2Types.get(key), dealer),
      });
    }).sort((a, b) =>
      a.supervisor.localeCompare(b.supervisor, 'zh-CN') ||
      a.dealer.localeCompare(b.dealer, 'zh-CN') ||
      a.product.localeCompare(b.product, 'zh-CN'));
    const zone3 = Array.from(zone3Map.entries()).map(([key, v]) => {
      const [sup, shopName] = key.split('||');
      const attrs = shopAttrs[shopName];
      const wt = (attrs && attrs.warehouseType) || '未分类';
      return toRow(v, { supervisor: sup, shopName, product: (attrs && attrs.product) || '(未分配商品)', dealer: (attrs && attrs.dealer) || '(未关联经销商)', warehouseType: wt, shopGrade: shopGradeOf(wt, shopName) });
    }).sort((a, b) =>
      a.supervisor.localeCompare(b.supervisor, 'zh-CN') ||
      a.dealer.localeCompare(b.dealer, 'zh-CN') ||
      a.product.localeCompare(b.product, 'zh-CN') ||
      a.shopName.localeCompare(b.shopName, 'zh-CN'));

    // 月可比/年可比 候选值：当前可见店铺（范围筛选后）的档案可比性去重，随其他维度收敛（与销售报表联动一致）
    const comparableOptions = (() => {
      const mc = new Set<string>();
      const yc = new Set<string>();
      for (const r of filteredRows) {
        const a = shopAttrs[r.shopName];
        if (a && a.monthComparable) mc.add(a.monthComparable);
        if (a && a.yearComparable) yc.add(a.yearComparable);
      }
      return {
        month: Array.from(mc).sort((x, y) => x.localeCompare(y, 'zh-CN')),
        year: Array.from(yc).sort((x, y) => x.localeCompare(y, 'zh-CN')),
      };
    })();

    res.json({
      pkName: ord.recordset[0]?.orderName || '',
      startDate: orderStart,
      endDate,
      dateFrom,
      dateTo,
      showFrom,
      showTo,
      showDates,
      isMock,
      statusText,
      storeCount: dimmedRows.length,
      scoped,
      scopeShops,
      filter: pkFilter,
      dimFilter,
      comparableOptions,
      zone1,
      zoneProduct,
      zone2,
      zone3,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

function round2(v: number): number {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function round4(v: number): number {
  return Math.round((Number(v) || 0) * 10000) / 10000;
}

export default router;