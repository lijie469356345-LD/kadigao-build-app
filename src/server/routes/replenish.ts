import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { guardHighRiskWrite, guardLogin } from '../middlewares/authMiddleware';
import {
  runEngine, defaultParams, MAIN_SIZES, num, round1,
  EngineInput, ReplenishParams, ResultRow,
} from '../services/replenishEngine';

const router = Router();

// 补货为运营管理域：enforce=true 时所有接口强制登录；写/删操作需特权身份
router.use(guardLogin);

function clamp0to9(v: number): number {
  return Math.max(0, Math.min(0.9, num(v)));
}

const WAREHOUSE_CODES = ['JM001', 'JM006', 'JM010', 'JMC01', 'SDC01', 'ZYC01'];
const WAREHOUSE_IN = `'${WAREHOUSE_CODES.join("','")}'`;

// 内存结果缓存：batchId → 透视结果行
const resultCache = new Map<string, ResultRow[]>();

// ==================== 建表 ====================

async function ensureTables(pool: sql.ConnectionPool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ReplenishParams')
    CREATE TABLE [dbo].[ReplenishParams] (
      [id] INT NOT NULL PRIMARY KEY DEFAULT 1,
      [计划销售天数] INT NOT NULL DEFAULT 7,
      [日均销统计天数] INT NOT NULL DEFAULT 7,
      [单码最大深度] INT NOT NULL DEFAULT 3,
      [总仓留仓比例] DECIMAL(6,4) NOT NULL DEFAULT 0,
      [是否节假日放大] BIT NOT NULL DEFAULT 0,
      [节假日前开始] DATE NULL, [节假日前结束] DATE NULL,
      [节假日后开始] DATE NULL, [节假日后结束] DATE NULL,
      [新品判定天数] INT NOT NULL DEFAULT 15,
      [滞销冻结天数] INT NOT NULL DEFAULT 14,
      [本店权重] DECIMAL(6,4) NOT NULL DEFAULT 0.7,
      [区域权重] DECIMAL(6,4) NOT NULL DEFAULT 0.3,
      [更新时间] DATETIME NOT NULL DEFAULT GETDATE(),
      [更新人] NVARCHAR(50) NULL
    )
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ReplenishSelectedSku')
    CREATE TABLE [dbo].[ReplenishSelectedSku] (
      [id] INT IDENTITY(1,1) PRIMARY KEY,
      [商品代码] NVARCHAR(50) NOT NULL,
      [颜色名称] NVARCHAR(50) NOT NULL,
      [颜色代码] NVARCHAR(50) NULL,
      [尺码组] NVARCHAR(200) NULL,
      [性别] NVARCHAR(20) NULL,
      [添加时间] DATETIME NOT NULL DEFAULT GETDATE(),
      CONSTRAINT UK_ReplenishSku UNIQUE ([商品代码],[颜色名称])
    )
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ReplenishResult')
    CREATE TABLE [dbo].[ReplenishResult] (
      [id] INT IDENTITY(1,1) PRIMARY KEY,
      [batchId] NVARCHAR(36) NOT NULL,
      [计算时间] DATETIME NOT NULL DEFAULT GETDATE(),
      [店铺名称] NVARCHAR(100) NOT NULL,
      [店铺等级] NVARCHAR(20) NULL,
      [小区域] NVARCHAR(100) NULL,
      [商品代码] NVARCHAR(50) NOT NULL,
      [颜色名称] NVARCHAR(50) NOT NULL,
      [颜色代码] NVARCHAR(50) NULL,
      [尺码代码] NVARCHAR(10) NOT NULL,
      [性别] NVARCHAR(20) NULL,
      [现库存] INT NOT NULL DEFAULT 0, [在途数] INT NOT NULL DEFAULT 0,
      [可用库存] INT NOT NULL DEFAULT 0, [目标库存] INT NOT NULL DEFAULT 0,
      [理论补货] INT NOT NULL DEFAULT 0, [实际补货] INT NOT NULL DEFAULT 0,
      [日均销量] DECIMAL(12,4) NOT NULL DEFAULT 0, [预测日均] DECIMAL(12,4) NOT NULL DEFAULT 0,
      [存销比] DECIMAL(12,4) NULL, [齐码率] DECIMAL(6,4) NULL,
      [是否新品] NVARCHAR(10) NULL, [是否滞销] NVARCHAR(10) NULL, [是否季末] NVARCHAR(10) NULL,
      [补货状态] NVARCHAR(20) NULL, [参数快照] NVARCHAR(MAX) NULL
    )
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ReplenishResult_Batch' AND object_id = OBJECT_ID('ReplenishResult'))
    CREATE INDEX IX_ReplenishResult_Batch ON [dbo].[ReplenishResult]([batchId])
  `);
}

async function execQuery(pool: sql.ConnectionPool, sqlText: string): Promise<any[]> {
  try {
    const result = await pool.request().query(sqlText);
    return result.recordset || [];
  } catch (err: any) {
    console.error('SQL执行失败:', err.message);
    return [];
  }
}

// ==================== 参数 ====================

function rowToParams(row: any): ReplenishParams {
  const d = defaultParams();
  if (!row) return d;
  return {
    计划销售天数: num(row.计划销售天数) || d.计划销售天数,
    日均销统计天数: num(row.日均销统计天数) || d.日均销统计天数,
    单码最大深度: num(row.单码最大深度) || d.单码最大深度,
    总仓留仓比例: row.总仓留仓比例 != null ? num(row.总仓留仓比例) : d.总仓留仓比例,
    是否节假日放大: !!row.是否节假日放大,
    节假日前开始: row.节假日前开始 || '', 节假日前结束: row.节假日前结束 || '',
    节假日后开始: row.节假日后开始 || '', 节假日后结束: row.节假日后结束 || '',
    新品判定天数: num(row.新品判定天数) || d.新品判定天数,
    滞销冻结天数: num(row.滞销冻结天数) || d.滞销冻结天数,
    本店权重: row.本店权重 != null ? num(row.本店权重) : d.本店权重,
    区域权重: row.区域权重 != null ? num(row.区域权重) : d.区域权重,
  };
}

async function loadParams(pool: sql.ConnectionPool): Promise<ReplenishParams> {
  const r = await pool.request().query('SELECT TOP 1 * FROM ReplenishParams WHERE id = 1');
  return rowToParams(r.recordset[0]);
}

// GET /api/replenish/params
router.get('/params', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const params = await loadParams(pool);
    res.json({ success: true, data: params });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || '读取参数失败' });
  }
});

// POST /api/replenish/params
router.post('/params', guardHighRiskWrite, async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const p = { ...defaultParams(), ...(req.body || {}) };
    // 权重和归一
    let w1 = num(p.本店权重), w2 = num(p.区域权重);
    if (w1 <= 0 && w2 <= 0) { w1 = 0.7; w2 = 0.3; }
    if (w1 + w2 > 0) { const s = w1 + w2; w1 = round1(w1 / s); w2 = round1(w2 / s); }
    const base = {
      计划销售天数: Math.max(1, Math.round(num(p.计划销售天数))),
      日均销统计天数: Math.max(1, Math.round(num(p.日均销统计天数))),
      单码最大深度: Math.max(1, Math.round(num(p.单码最大深度))),
      总仓留仓比例: clamp0to9(num(p.总仓留仓比例)),
      是否节假日放大: !!p.是否节假日放大,
      节假日前开始: p.节假日前开始 || '', 节假日前结束: p.节假日前结束 || '',
      节假日后开始: p.节假日后开始 || '', 节假日后结束: p.节假日后结束 || '',
      新品判定天数: Math.max(1, Math.round(num(p.新品判定天数))),
      滞销冻结天数: Math.max(1, Math.round(num(p.滞销冻结天数))),
      本店权重: w1, 区域权重: w2,
      更新时间: new Date(), 更新人: String(p.更新人 || ''),
    };
    const chk = await pool.request().query('SELECT COUNT(*) n FROM ReplenishParams WHERE id = 1');
    if ((chk.recordset[0]?.n || 0) > 0) {
      await pool.request().query(`
        UPDATE ReplenishParams SET
          计划销售天数 = ${base.计划销售天数}, 日均销统计天数 = ${base.日均销统计天数}, 单码最大深度 = ${base.单码最大深度},
          总仓留仓比例 = ${base.总仓留仓比例}, 是否节假日放大 = ${base.是否节假日放大 ? 1 : 0},
          节假日前开始 = ${base.节假日前开始 ? `'${base.节假日前开始}'` : 'NULL'},
          节假日前结束 = ${base.节假日前结束 ? `'${base.节假日前结束}'` : 'NULL'},
          节假日后开始 = ${base.节假日后开始 ? `'${base.节假日后开始}'` : 'NULL'},
          节假日后结束 = ${base.节假日后结束 ? `'${base.节假日后结束}'` : 'NULL'},
          新品判定天数 = ${base.新品判定天数}, 滞销冻结天数 = ${base.滞销冻结天数},
          本店权重 = ${base.本店权重}, 区域权重 = ${base.区域权重},
          更新时间 = GETDATE(), 更新人 = N'${String(base.更新人).replace(/'/g, "''")}'
        WHERE id = 1
      `);
    } else {
      await pool.request().query(`
        INSERT INTO ReplenishParams
          (id, 计划销售天数, 日均销统计天数, 单码最大深度, 总仓留仓比例, 是否节假日放大,
           节假日前开始, 节假日前结束, 节假日后开始, 节假日后结束, 新品判定天数, 滞销冻结天数,
           本店权重, 区域权重, 更新时间, 更新人)
        VALUES (1, ${base.计划销售天数}, ${base.日均销统计天数}, ${base.单码最大深度}, ${base.总仓留仓比例}, ${base.是否节假日放大 ? 1 : 0},
           ${base.节假日前开始 ? `'${base.节假日前开始}'` : 'NULL'}, ${base.节假日前结束 ? `'${base.节假日前结束}'` : 'NULL'},
           ${base.节假日后开始 ? `'${base.节假日后开始}'` : 'NULL'}, ${base.节假日后结束 ? `'${base.节假日后结束}'` : 'NULL'},
           ${base.新品判定天数}, ${base.滞销冻结天数}, ${base.本店权重}, ${base.区域权重}, GETDATE(), N'${String(base.更新人).replace(/'/g, "''")}')
      `);
    }
    res.json({ success: true, data: rowToParams(base) });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || '保存参数失败' });
  }
});

// ==================== 款色候选（商品全） ====================

// GET /api/replenish/sku-options?keyword=&gender=&category=&season=&year=&style=&type=&page=1&pageSize=50
router.get('/sku-options', async (req, res) => {
  try {
    const pool = await getPool();
    const { keyword = '', gender = '', category = '', season = '', year = '', style = '', type = '', page = '1', pageSize = '50' } = req.query as any;
    const r = pool.request();
    // 候选商品仅限 男鞋/女鞋/童鞋，其余品类（包/物料/配饰/赠品等）一律不参与
    const conds: string[] = [`性别 IN ('男鞋','女鞋','童鞋')`];
    if (keyword) {
      r.input('kw', sql.NVarChar, `%${keyword}%`);
      conds.push('(商品代码 LIKE @kw OR 颜色名称 LIKE @kw)');
    }
    if (gender) { r.input('gd', sql.NVarChar, gender); conds.push('性别 = @gd'); }
    if (category) { r.input('ct', sql.NVarChar, category); conds.push('大类 = @ct'); }
    if (season) { r.input('sn', sql.NVarChar, season); conds.push('季节 = @sn'); }
    if (year) { r.input('yr', sql.NVarChar, year); conds.push('年份 = @yr'); }
    if (style) { r.input('st', sql.NVarChar, style); conds.push('风格 = @st'); }
    if (type) { r.input('tp', sql.NVarChar, type); conds.push('款式 = @tp'); }
    const where = 'WHERE ' + conds.join(' AND ');
    const pg = Math.max(1, parseInt(page) || 1);
    const ps = Math.min(200, Math.max(1, parseInt(pageSize) || 50));
    r.input('off', sql.Int, (pg - 1) * ps);
    r.input('lim', sql.Int, ps);

    const data = await r.query(`
      SELECT 商品代码, ISNULL(颜色名称,'') 颜色名称, ISNULL(颜色代码,'') 颜色代码,
        ISNULL(尺码组,'') 尺码组, ISNULL(性别,'') 性别, ISNULL(大类,'') 大类,
        ISNULL(季节,'') 季节, ISNULL(年份,'') 年份, ISNULL(风格,'') 风格, ISNULL(款式,'') 款式
      FROM (
        SELECT 商品代码, 颜色名称, MAX(颜色代码) 颜色代码, MAX(尺码组) 尺码组, MAX(性别) 性别,
          MAX(大类) 大类, MAX(季节) 季节, MAX(年份) 年份, MAX(风格) 风格, MAX(款式) 款式
        FROM [dbo].[商品全]
        ${where}
        GROUP BY 商品代码, 颜色名称
      ) a
      ORDER BY 商品代码, 颜色名称
      OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY
    `);

    // 去重：同商品代码+颜色名称
    const seen = new Set<string>();
    const list = data.recordset.filter((row: any) => {
      const k = row.商品代码 + '\x1f' + row.颜色名称;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const cnt = await r.query(`SELECT COUNT(*) n FROM (SELECT 商品代码, 颜色名称 FROM [dbo].[商品全] ${where} GROUP BY 商品代码, 颜色名称) a`);
    res.json({ success: true, data: { list, total: cnt.recordset[0]?.n || 0 } });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || '查询款色失败' });
  }
});

// GET /api/replenish/sku-options/all?keyword=&gender=&year=&season=&style=&type=
// 返回当前筛选条件下全部款色（不翻页），用于"全选当前筛选结果"
router.get('/sku-options/all', async (req, res) => {
  try {
    const pool = await getPool();
    const { keyword = '', gender = '', year = '', season = '', style = '', type = '' } = req.query as any;
    const r = pool.request();
    const conds: string[] = [`性别 IN ('男鞋','女鞋','童鞋')`];
    if (keyword) {
      r.input('kw', sql.NVarChar, `%${keyword}%`);
      conds.push('(商品代码 LIKE @kw OR 颜色名称 LIKE @kw)');
    }
    if (gender) { r.input('gd', sql.NVarChar, gender); conds.push('性别 = @gd'); }
    if (year) { r.input('yr', sql.NVarChar, year); conds.push('年份 = @yr'); }
    if (season) { r.input('sn', sql.NVarChar, season); conds.push('季节 = @sn'); }
    if (style) { r.input('st', sql.NVarChar, style); conds.push('风格 = @st'); }
    if (type) { r.input('tp', sql.NVarChar, type); conds.push('款式 = @tp'); }
    const where = 'WHERE ' + conds.join(' AND ');
    const data = await r.query(`
      SELECT 商品代码, ISNULL(颜色名称,'') 颜色名称
      FROM (SELECT 商品代码, 颜色名称 FROM [dbo].[商品全] ${where} GROUP BY 商品代码, 颜色名称) a
      ORDER BY 商品代码, 颜色名称
    `);
    res.json({ success: true, data: { list: data.recordset, total: data.recordset.length } });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || '查询全部款色失败' });
  }
});

// GET /api/replenish/sku-filter-options
// 返回候选款色的筛选下拉选项（年份/季节/性别/风格/款式），仅限男女童鞋
router.get('/sku-filter-options', async (req, res) => {
  try {
    const pool = await getPool();
    const colQ = (col: string) =>
      `SELECT DISTINCT ${col} v FROM [dbo].[商品全] WHERE ${col} IS NOT NULL AND ${col} <> '' AND 性别 IN ('男鞋','女鞋','童鞋') ORDER BY ${col}`;
    const [years, seasons, genders, styles, types] = await Promise.all([
      pool.request().query(colQ('年份')),
      pool.request().query(colQ('季节')),
      pool.request().query(colQ('性别')),
      pool.request().query(colQ('风格')),
      pool.request().query(colQ('款式')),
    ]);
    const map = (rs: any) => rs.recordset.map((x: any) => x.v);
    res.json({
      success: true,
      data: {
        years: map(years), seasons: map(seasons), genders: map(genders),
        styles: map(styles), types: map(types),
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || '查询筛选选项失败' });
  }
});

// ==================== 选中款色 ====================

// GET /api/replenish/selected-skus
router.get('/selected-skus', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const r = await pool.request().query('SELECT * FROM ReplenishSelectedSku ORDER BY id');
    res.json({ success: true, data: r.recordset });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || '查询选中款色失败' });
  }
});

function esc(v: any): string {
  return String(v ?? '').replace(/'/g, "''");
}

// 批量加入选中款色（去重 + 批量补全元数据 + 批量插入，避免逐条查询导致大批量卡顿）
async function enrichAndInsert(pool: sql.ConnectionPool, items: any[]): Promise<{ inserted: number; skipped: number }> {
  // 1. 归一化 + 去重
  const seen = new Set<string>();
  const clean: { code: string; color: string }[] = [];
  for (const it of items || []) {
    const code = String(it.商品代码 ?? it.code ?? '').trim();
    const color = String(it.颜色名称 ?? it.color ?? '').trim();
    if (!code || !color) continue;
    const k = code + '\x1f' + color;
    if (seen.has(k)) continue;
    seen.add(k);
    clean.push({ code, color });
  }
  if (clean.length === 0) return { inserted: 0, skipped: (items || []).length };

  // 2. 已存在的不重复插入
  const existing = await pool.request().query('SELECT 商品代码, 颜色名称 FROM ReplenishSelectedSku');
  const existingSet = new Set(existing.recordset.map((r: any) => (r.商品代码 + '\x1f' + r.颜色名称)));
  const newItems = clean.filter(i => !existingSet.has(i.code + '\x1f' + i.color));
  const skipped = clean.length - newItems.length;
  if (newItems.length === 0) return { inserted: 0, skipped };

  // 3. 批量补全元数据（商品全），按 SKC 取尺码组/性别/颜色代码
  const meta = new Map<string, any>();
  for (let i = 0; i < newItems.length; i += 500) {
    const chunk = newItems.slice(i, i + 500);
    // 用 OR 连接条件（库兼容级别不支持行值 IN，用 INSERT VALUES 已确认可用）
    const orCond = chunk.map(x => `(商品代码 = N'${esc(x.code)}' AND 颜色名称 = N'${esc(x.color)}')`).join(' OR ');
    const mr = await pool.request().query(`
      SELECT 商品代码, 颜色名称, ISNULL(MAX(尺码组),'') 尺码组, ISNULL(MAX(性别),'') 性别, ISNULL(MAX(颜色代码),'') 颜色代码
      FROM [dbo].[商品全]
      WHERE ${orCond}
      GROUP BY 商品代码, 颜色名称
    `);
    for (const row of mr.recordset) meta.set(row.商品代码 + '\x1f' + row.颜色名称, row);
  }

  // 4. 批量插入（500 行/批）
  let inserted = 0;
  for (let i = 0; i < newItems.length; i += 500) {
    const chunk = newItems.slice(i, i + 500);
    const values = chunk.map(x => {
      const m = meta.get(x.code + '\x1f' + x.color) || {};
      return `(N'${esc(x.code)}',N'${esc(x.color)}',N'${esc(m.颜色代码)}',N'${esc(m.尺码组)}',N'${esc(m.性别)}')`;
    }).join(',');
    const r = await pool.request().query(`INSERT INTO ReplenishSelectedSku (商品代码, 颜色名称, 颜色代码, 尺码组, 性别) VALUES ${values}`);
    inserted += (r.rowsAffected?.[0] || chunk.length);
  }
  return { inserted, skipped };
}

// POST /api/replenish/selected-skus  body: { items: [{商品代码, 颜色名称}] }
router.post('/selected-skus', guardHighRiskWrite, async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const items = req.body?.items || req.body?.skuList || [];
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: '请提供款色清单' });
    }
    const result = await enrichAndInsert(pool, items);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || '添加款色失败' });
  }
});

// POST /api/replenish/selected-skus/import  body: { items: [...] }（Excel 解析后）
router.post('/selected-skus/import', guardHighRiskWrite, async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const items = req.body?.items || [];
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: '请先上传 Excel 文件' });
    }
    const result = await enrichAndInsert(pool, items);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || '导入款色失败' });
  }
});

// DELETE /api/replenish/selected-skus/:id
router.delete('/selected-skus/:id', guardHighRiskWrite, async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    await pool.request().input('id', sql.Int, parseInt(req.params.id)).query('DELETE FROM ReplenishSelectedSku WHERE id = @id');
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || '删除失败' });
  }
});

// POST /api/replenish/selected-skus/clear
router.post('/selected-skus/clear', guardHighRiskWrite, async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    await pool.request().query('DELETE FROM ReplenishSelectedSku');
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || '清空失败' });
  }
});

// ==================== 计算 ====================

const SELECTED_JOIN = `AND EXISTS (SELECT 1 FROM [dbo].[ReplenishSelectedSku] s WHERE s.商品代码 = t.商品代码 AND ISNULL(s.颜色名称,'') = ISNULL(t.颜色名称,''))`;

// POST /api/replenish/compute
router.post('/compute', guardHighRiskWrite, async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const params = await loadParams(pool);
    const warnings: string[] = [];

    // 必须已选款色
    const sel = await pool.request().query('SELECT COUNT(*) n FROM ReplenishSelectedSku');
    if ((sel.recordset[0]?.n || 0) === 0) {
      return res.status(400).json({ success: false, message: '请先在【款色管理】中选定参与补货的款色' });
    }

    const statDays = Math.max(1, num(params.日均销统计天数));

    // 标准尺码组探测：商品全 按 SKC 去重尺码代码（商品全.尺码组 为"均码/女"等标签，不可靠）
    let sizeGroups = new Map<string, string[]>();
    try {
      const zg = await pool.request().query(`
        SELECT t.商品代码, ISNULL(t.颜色名称,'') 颜色名称, t.尺码代码
        FROM [dbo].[商品全] t
        WHERE EXISTS (SELECT 1 FROM [dbo].[ReplenishSelectedSku] s WHERE s.商品代码 = t.商品代码 AND ISNULL(s.颜色名称,'') = ISNULL(t.颜色名称,''))
        GROUP BY t.商品代码, t.颜色名称, t.尺码代码
      `);
      const skuSizes = new Map<string, Set<string>>();
      for (const row of zg.recordset) {
        const sku = row.商品代码 + '\x1f' + row.颜色名称;
        if (!skuSizes.has(sku)) skuSizes.set(sku, new Set());
        skuSizes.get(sku)!.add(String(row.尺码代码).trim());
      }
      for (const [sku, set] of skuSizes) {
        const sizes = Array.from(set).filter(Boolean);
        if (sizes.length > 0) sizeGroups.set(sku, sizes);
      }
      if (sizeGroups.size === 0) warnings.push('未读取到标准尺码组，已回退标准尺码 31-46');
    } catch (e: any) {
      warnings.push('读取标准尺码组失败，已回退标准尺码 31-46');
    }

    // 并行加载数据源
    const [warehouses, storeStock, storeSales, areaSales, sizeRatios, firstShip, storeArchive] = await Promise.all([
      execQuery(pool, `
        SELECT t.商品代码, ISNULL(t.颜色名称,'') 颜色名称, ISNULL(t.颜色代码,'') 颜色代码, t.尺码代码, SUM(ISNULL(t.可配,0)) 可配
        FROM [dbo].[今日库存全] t
        WHERE t.店铺代码 IN (${WAREHOUSE_IN}) AND t.性别 IN ('男鞋','女鞋','童鞋')
          ${SELECTED_JOIN}
        GROUP BY t.商品代码, t.颜色名称, t.颜色代码, t.尺码代码
        HAVING SUM(ISNULL(t.可配,0)) <> 0
      `),
      execQuery(pool, `
        SELECT t.店铺名称, t.商品代码, ISNULL(t.颜色名称,'') 颜色名称, ISNULL(t.颜色代码,'') 颜色代码, ISNULL(t.性别,'') 性别, t.尺码代码,
          SUM(ISNULL(t.数量,0)) 现库存, SUM(ISNULL(t.在途数,0)) 在途数
        FROM [dbo].[今日库存全] t
        WHERE t.仓库类别 = '直营' AND t.店铺代码 NOT IN (${WAREHOUSE_IN}) AND t.性别 IN ('男鞋','女鞋','童鞋')
          ${SELECTED_JOIN}
        GROUP BY t.店铺名称, t.商品代码, t.颜色名称, t.颜色代码, t.性别, t.尺码代码
        HAVING SUM(ISNULL(t.数量,0)) + SUM(ISNULL(t.在途数,0)) <> 0
      `),
      execQuery(pool, `
        SELECT t.店铺名称, t.商品代码, ISNULL(t.颜色名称,'') 颜色名称, ISNULL(t.颜色代码,'') 颜色代码, ISNULL(t.性别,'') 性别, t.尺码代码,
          SUM(ISNULL(t.数量,0)) 销量, CONVERT(varchar(10), MAX(t.日期), 120) 最近销售日期
        FROM [dbo].[有效业绩全] t
        WHERE t.仓库类别 = '直营' AND t.性别 IN ('男鞋','女鞋','童鞋')
          AND t.日期 >= CONVERT(date, DATEADD(day, -${statDays}, GETDATE()))
          ${SELECTED_JOIN}
        GROUP BY t.店铺名称, t.商品代码, t.颜色名称, t.颜色代码, t.性别, t.尺码代码
        HAVING SUM(ISNULL(t.数量,0)) <> 0
      `),
      execQuery(pool, `
        SELECT t.小区域, t.商品代码, ISNULL(t.颜色名称,'') 颜色名称, ISNULL(t.性别,'') 性别, t.尺码代码,
          SUM(ISNULL(t.数量,0)) 区域销量, COUNT(DISTINCT t.店铺名称) 有销店数
        FROM [dbo].[有效业绩全] t
        WHERE t.仓库类别 = '直营' AND t.性别 IN ('男鞋','女鞋','童鞋')
          AND t.日期 >= CONVERT(date, DATEADD(day, -${statDays}, GETDATE()))
          ${SELECTED_JOIN}
        GROUP BY t.小区域, t.商品代码, t.颜色名称, t.性别, t.尺码代码
        HAVING SUM(ISNULL(t.数量,0)) <> 0
      `),
      execQuery(pool, `
        SELECT t.店铺名称, ISNULL(t.性别,'') 性别, t.尺码代码, SUM(ISNULL(t.数量,0)) 销量
        FROM [dbo].[有效业绩全] t
        WHERE t.仓库类别 = '直营' AND t.性别 IN ('男鞋','女鞋','童鞋')
          AND t.日期 >= CONVERT(date, DATEADD(day, -${statDays}, GETDATE()))
        GROUP BY t.店铺名称, t.性别, t.尺码代码
        HAVING SUM(ISNULL(t.数量,0)) <> 0
      `),
      execQuery(pool, `
        SELECT t.商品代码, ISNULL(t.颜色名称,'') 颜色名称, CONVERT(varchar(10), MIN(t.日期), 120) 首配日期
        FROM [dbo].[配货全] t
        WHERE t.收货店类别 = '直营' AND t.性别 IN ('男鞋','女鞋','童鞋')
          ${SELECTED_JOIN}
        GROUP BY t.商品代码, t.颜色名称
      `),
      execQuery(pool, `
        SELECT 店铺名称, ISNULL(店铺代码,'') 店铺代码, ISNULL(店铺等级,'') 店铺等级, ISNULL(区域,'') 区域,
          ISNULL(大区域,'') 大区域, ISNULL(小区域,'') 小区域, ISNULL(最大库存,0) 最大库存, ISNULL(最大SKU,0) 最大SKU,
          CONVERT(varchar(10), 开业日期, 120) 开业日期, ISNULL(店铺状态,'') 店铺状态, ISNULL(可用状态,'') 可用状态
        FROM [dbo].[店仓全]
        WHERE 仓库类别 = '直营'
      `),
    ]);

    // 节假日放大
    let holidayBefore: any[] = [], holidayAfter: any[] = [];
    if (params.是否节假日放大 && params.节假日前开始 && params.节假日后开始) {
      const q = (start: string, end: string) => `
        SELECT t.小区域, t.商品代码, ISNULL(t.颜色名称,'') 颜色名称, SUM(ISNULL(t.数量,0)) 销量
        FROM [dbo].[有效业绩全] t
        WHERE t.仓库类别 = '直营' AND t.性别 IN ('男鞋','女鞋','童鞋')
          AND t.日期 >= '${start}' AND t.日期 <= '${end}'
          ${SELECTED_JOIN}
        GROUP BY t.小区域, t.商品代码, t.颜色名称
        HAVING SUM(ISNULL(t.数量,0)) <> 0
      `;
      holidayBefore = await execQuery(pool, q(String(params.节假日前开始), String(params.节假日前结束 || params.节假日前开始)));
      holidayAfter = await execQuery(pool, q(String(params.节假日后开始), String(params.节假日后结束 || params.节假日后开始)));
    }

    const input: EngineInput = {
      params,
      warehouses, storeStock, storeSales, areaSales, sizeRatios, firstShip, storeArchive,
      sizeGroups, holidayBefore, holidayAfter, warnings,
    };

    const result = runEngine(input);
    const batchId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    resultCache.set(batchId, result.rows);

    // 持久化留档（尺码粒度，仅理论补货 > 0）
    try {
      const paramJson = JSON.stringify(params);
      const rq = pool.request();
      for (let i = 0; i < result.detailRows.length; i += 500) {
        const batch = result.detailRows.slice(i, i + 500);
        for (const d of batch) {
          await rq.query(`
            INSERT INTO [dbo].[ReplenishResult]
              ([batchId],[计算时间],[店铺名称],[店铺等级],[小区域],[商品代码],[颜色名称],[颜色代码],[尺码代码],[性别],
               [现库存],[在途数],[可用库存],[目标库存],[理论补货],[实际补货],[日均销量],[预测日均],[存销比],[齐码率],
               [是否新品],[是否滞销],[是否季末],[补货状态],[参数快照])
            VALUES (N'${batchId}', GETDATE(), N'${d.店铺名称}', N'${(d.店铺等级||'').replace(/'/g,"''")}', N'${(d.小区域||'').replace(/'/g,"''")}',
                    N'${d.商品代码}', N'${d.颜色名称}', N'${(d.颜色代码||'').replace(/'/g,"''")}', N'${d.尺码代码}', N'${(d.性别||'').replace(/'/g,"''")}',
                    ${d.现库存}, ${d.在途数}, ${d.可用库存}, ${d.目标库存}, ${d.理论补货}, ${d.实际补货},
                    ${d.日均销量}, ${d.预测日均}, ${d.存销比}, ${d.齐码率},
                    N'${d.是否新品}', N'${d.是否滞销}', N'${d.是否季末}', N'${(d.状态||'').replace(/'/g,"''")}', N'${paramJson.replace(/'/g,"''")}')`
          );
        }
      }
    } catch (e: any) {
      console.error('补货结果留档失败:', e.message);
      warnings.push('结果留档失败：' + e.message);
    }

    res.json({
      success: true,
      data: {
        batchId,
        summary: result.summary,
        previewRows: result.rows.slice(0, 2000),
        total: result.rows.length,
        warnings,
      },
    });
  } catch (e: any) {
    console.error('自动补货计算失败:', e);
    res.status(500).json({ success: false, message: e.message || '计算失败' });
  }
});

// ==================== 结果读取 / 导出 / 历史 ====================

// GET /api/replenish/results/:batchId?page=1&pageSize=200
router.get('/results/:batchId', async (req, res) => {
  try {
    const pool = await getPool();
    const batchId = req.params.batchId;
    let rows = resultCache.get(batchId);
    if (!rows) {
      // 从 DB 重建
      const r = await pool.request()
        .input('b', sql.NVarChar, batchId)
        .query('SELECT * FROM ReplenishResult WHERE batchId = @b');
      rows = pivotFromDb(r.recordset);
    }
    const pg = Math.max(1, parseInt(String(req.query.page || '1')));
    const ps = Math.min(500, Math.max(1, parseInt(String(req.query.pageSize || '200'))));
    const start = (pg - 1) * ps;
    res.json({
      success: true,
      data: { rows: rows.slice(start, start + ps), total: rows.length },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || '读取结果失败' });
  }
});

// POST /api/replenish/export  body: { batchId }
router.post('/export', async (req, res) => {
  try {
    const pool = await getPool();
    const { batchId } = req.body || {};
    let rows = resultCache.get(batchId);
    if (!rows) {
      const r = await pool.request().input('b', sql.NVarChar, batchId).query('SELECT * FROM ReplenishResult WHERE batchId = @b');
      rows = pivotFromDb(r.recordset);
    }

    const sizeCols = MAIN_SIZES;
    const HEADER = ['店铺名称','商品代码','颜色名称','颜色代码','性别','店铺等级','小区域','齐码率','存销比','周转天数','满足率','是否新品','是否滞销','是否季末','状态','现库存','在途','可用库存','目标库存','理论补货','实际补货', ...sizeCols];

    let csv = '\uFEFF';
    csv += HEADER.map(c => escapeCsv(c)).join(',') + '\n';
    for (const row of rows) {
      const line = HEADER.map(h => {
        if (sizeCols.includes(h)) return String(row.sizes?.[h] ?? 0);
        if (h === '现库存') return String(row.现库存合计 ?? 0);
        if (h === '在途') return String(row.在途合计 ?? 0);
        if (h === '可用库存') return String(row.可用合计 ?? 0);
        if (h === '目标库存') return String(row.目标合计 ?? 0);
        if (h === '理论补货') return String(row.理论补货合计 ?? 0);
        if (h === '实际补货') return String(row.实际补货合计 ?? 0);
        const v = (row as any)[h];
        return v === null || v === undefined ? '' : String(v);
      });
      csv += line.map(cell => escapeCsv(cell)).join(',') + '\n';
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="replenish_${dateStr}.csv"; filename*=UTF-8''${encodeURIComponent('补货明细_' + dateStr + '.csv')}`);
    res.send(csv);
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || '导出失败' });
  }
});

function escapeCsv(cell: string): string {
  if (cell.includes(',') || cell.includes('"') || cell.includes('\n') || cell.includes('\r')) {
    return '"' + cell.replace(/"/g, '""') + '"';
  }
  return cell;
}

function pivotFromDb(dbRows: any[]): ResultRow[] {
  const map = new Map<string, ResultRow>();
  for (const d of dbRows) {
    const k = d.店铺名称 + '\x1f' + d.商品代码 + '\x1f' + d.颜色名称;
    if (!map.has(k)) {
      map.set(k, {
        店铺名称: d.店铺名称, 商品代码: d.商品代码, 颜色名称: d.颜色名称, 颜色代码: d.颜色代码 || '', 性别: d.性别 || '',
        店铺等级: d.店铺等级 || '', 小区域: d.小区域 || '',
        齐码率: num(d.齐码率), 存销比: num(d.存销比), 周转天数: num(d.存销比), 满足率: 1,
        是否新品: d.是否新品 || '否', 是否滞销: d.是否滞销 || '否', 是否季末: d.是否季末 || '否', 状态: d.补货状态 || '',
        现库存合计: 0, 在途合计: 0, 可用合计: 0, 目标合计: 0, 理论补货合计: 0, 实际补货合计: 0,
        sizes: {},
      });
    }
    const row = map.get(k)!;
    row.sizes[d.尺码代码] = num(d.实际补货);
    row.现库存合计 += num(d.现库存);
    row.在途合计 += num(d.在途数);
    row.可用合计 += num(d.可用库存);
    row.目标合计 += num(d.目标库存);
    row.理论补货合计 += num(d.理论补货);
    row.实际补货合计 += num(d.实际补货);
  }
  return Array.from(map.values());
}

// GET /api/replenish/history
router.get('/history', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const r = await pool.request().query(`
      SELECT batchId, MAX(计算时间) 计算时间, COUNT(DISTINCT 店铺名称) 店数,
        COUNT(DISTINCT 商品代码 + 颜色名称) 款色数, SUM(理论补货) 理论补货,
        SUM(实际补货) 实际补货, MAX(参数快照) 参数快照
      FROM ReplenishResult
      GROUP BY batchId
      ORDER BY MAX(计算时间) DESC
    `);
    res.json({ success: true, data: r.recordset });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || '查询历史失败' });
  }
});

// DELETE /api/replenish/history/:batchId
router.delete('/history/:batchId', guardHighRiskWrite, async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('b', sql.NVarChar, req.params.batchId).query('DELETE FROM ReplenishResult WHERE batchId = @b');
    resultCache.delete(req.params.batchId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || '删除历史失败' });
  }
});

export default router;
