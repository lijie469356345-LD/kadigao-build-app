import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { JwtUserPayload } from '../services/jwt';
import { getStandardVisibleShopNames } from '../services/permissionService';
import { requireMenuPerm } from '../middlewares/menuPermMiddleware';

const requireCostPerm = requireMenuPerm('xixie', 'xixieCostUpload');

const router = Router();

async function ensureTable(pool: sql.ConnectionPool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'XixieCost')
    CREATE TABLE XixieCost (
      id INT IDENTITY(1,1) PRIMARY KEY,
      monthYear NVARCHAR(7) NOT NULL,
      区经 NVARCHAR(100),
      仓库类别 NVARCHAR(50),
      区域 NVARCHAR(100),
      督导 NVARCHAR(100),
      店铺名称 NVARCHAR(200) NOT NULL,
      双数 INT DEFAULT 0,
      费用 DECIMAL(18,2) DEFAULT 0,
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);
}

// 从店仓全补全店铺的区经/仓库类别/区域/督导
async function enrichShopInfo(pool: sql.ConnectionPool, shopName: string) {
  const result = await pool.request()
    .input('sn', sql.NVarChar, shopName)
    .query(`SELECT TOP 1 区经, 仓库类别, 区域, 督导 FROM 店仓全 WHERE 店铺名称 = @sn`);
  return result.recordset[0] || {};
}

// 依据用户身份返回店铺过滤条件（'' = 全部可见（管理员），'1=0' = 无权限，其它 = 授权店铺 IN 列表）
async function buildShopCond(pool: sql.ConnectionPool, groupName?: string, user?: JwtUserPayload | null): Promise<string> {
  const shops = await getStandardVisibleShopNames(pool, typeof groupName === 'string' ? groupName : '', user);
  if (shops === null) return '';
  if (shops.length === 0) return '1=0';
  const list = shops.map(s => `'${String(s).replace(/'/g, "''")}'`).join(', ');
  return `店铺名称 IN (${list})`;
}

// 统一月份为 YYYY-MM 格式（兼容 7月 / 2026年7月 / 2026/07 / 202607 / Excel 日期序列号 46204 等）
function normalizeMonth(v: any): string {
  const s = String(v ?? '').trim();
  if (!s) return s;
  let m = s.match(/^(\d{4})[-/年.](\d{1,2})月?$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}`;
  m = s.match(/^(\d{4})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/^(\d{1,2})月?$/);
  if (m) {
    const now = new Date();
    return `${now.getFullYear()}-${String(m[1]).padStart(2, '0')}`;
  }
  // Excel 日期序列号（如 46204 → 2026-07），可能带小数（46204.5），常见于日期格式单元格被 XLSX 读出为数字
  m = s.match(/^(\d{5,6})(?:\.\d+)?$/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 15000 && n <= 70000) {
      const d = new Date((Math.floor(n) - 25569) * 86400000);
      if (!isNaN(d.getTime())) {
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      }
    }
  }
  return s;
}

// GET /api/xixie/cost?monthYear=2026-08 - 查询洗鞋费用
router.get('/cost', requireCostPerm, async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const monthYear = typeof req.query.monthYear === 'string' ? req.query.monthYear : '';
    const groupName = typeof req.query.groupName === 'string' ? req.query.groupName : '';
    const shopCond = await buildShopCond(pool, groupName, req.user || null);
    let query = 'SELECT * FROM XixieCost';
    const request = pool.request();
    const conds: string[] = [];
    if (monthYear) { conds.push('monthYear = @my'); request.input('my', sql.NVarChar, monthYear); }
    if (shopCond) conds.push(shopCond);
    if (conds.length) query += ' WHERE ' + conds.join(' AND ');
    query += ' ORDER BY 区经, 督导, 店铺名称';
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (e: any) {
    console.error('查询洗鞋费用失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/xixie/cost - 新增单条
router.post('/cost', requireCostPerm, async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const { monthYear, 督导, 店铺名称, 双数, 费用 } = req.body || {};
    if (!店铺名称) return res.status(400).json({ error: '店铺名称不能为空' });
    const info = await enrichShopInfo(pool, String(店铺名称));
    const safeStr = (v: any) => (v != null ? String(v) : '');
    await pool.request()
      .input('my', sql.NVarChar, safeStr(normalizeMonth(monthYear)))
      .input('dm', sql.NVarChar, safeStr(info.区经))
      .input('wh', sql.NVarChar, safeStr(info.仓库类别))
      .input('ar', sql.NVarChar, safeStr(info.区域))
      .input('sv', sql.NVarChar, safeStr(督导 || info.督导))
      .input('sn', sql.NVarChar, String(店铺名称))
      .input('cnt', sql.Int, parseInt(双数) || 0)
      .input('cost', sql.Decimal(18, 2), parseFloat(费用) || 0)
      .query(`INSERT INTO XixieCost (monthYear, 区经, 仓库类别, 区域, 督导, 店铺名称, 双数, 费用)
        VALUES (@my, @dm, @wh, @ar, @sv, @sn, @cnt, @cost)`);
    res.json({ success: true });
  } catch (e: any) {
    console.error('新增洗鞋费用失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/xixie/cost/bulk - 批量导入
router.post('/cost/bulk', requireCostPerm, async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const { rows } = req.body || {};
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: '没有导入数据' });

    // 预加载店仓全信息
    const shopMap = new Map<string, any>();
    const allShops = await pool.request().query('SELECT 店铺名称 as sn, 区经, 仓库类别, 区域, 督导 FROM 店仓全');
    allShops.recordset.forEach((r: any) => shopMap.set(r.sn, r));

    const transaction = pool.transaction();
    await transaction.begin();
    try {
      let count = 0;
      for (const row of rows) {
        const shopName = String(row['店铺名称'] || '').trim();
        if (!shopName) continue;
        const monthYear = normalizeMonth(row['月份'] || row['monthYear'] || '');
        const 督导 = String(row['督导'] || '').trim();
        const 双数 = parseInt(row['双数']) || 0;
        const 费用 = parseFloat(row['费用']) || 0;
        const info = shopMap.get(shopName) || {};
        const safeStr = (v: any) => (v != null ? String(v) : '');
        await transaction.request()
          .input('my', sql.NVarChar, monthYear)
          .input('dm', sql.NVarChar, safeStr(info.区经))
          .input('wh', sql.NVarChar, safeStr(info.仓库类别))
          .input('ar', sql.NVarChar, safeStr(info.区域))
          .input('sv', sql.NVarChar, 督导 || safeStr(info.督导))
          .input('sn', sql.NVarChar, shopName)
          .input('cnt', sql.Int, 双数)
          .input('cost', sql.Decimal(18, 2), 费用)
          .query(`INSERT INTO XixieCost (monthYear, 区经, 仓库类别, 区域, 督导, 店铺名称, 双数, 费用)
            VALUES (@my, @dm, @wh, @ar, @sv, @sn, @cnt, @cost)`);
        count++;
      }
      await transaction.commit();
      res.json({ success: true, count });
    } catch (e: any) {
      await transaction.rollback();
      throw e;
    }
  } catch (e: any) {
    console.error('批量导入洗鞋费用失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/xixie/cost/clear - 清空
router.delete('/cost/clear', requireCostPerm, async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    await pool.request().query('DELETE FROM XixieCost');
    res.json({ success: true });
  } catch (e: any) {
    console.error('清空洗鞋费用失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/xixie/cost/:id - 删除单条
router.delete('/cost/:id', requireCostPerm, async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.Int, parseInt(req.params.id)).query('DELETE FROM XixieCost WHERE id = @id');
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 洗鞋转化 ====================

async function ensureConvertTable(pool: sql.ConnectionPool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'XixieConvert')
    CREATE TABLE XixieConvert (
      id INT IDENTITY(1,1) PRIMARY KEY,
      monthYear NVARCHAR(7) NOT NULL,
      区经 NVARCHAR(100),
      仓库类别 NVARCHAR(50),
      督导 NVARCHAR(100),
      店铺名称 NVARCHAR(200) NOT NULL,
      会员手机 NVARCHAR(50),
      发放张数 INT DEFAULT 0,
      使用张数 INT DEFAULT 0,
      转化业绩 DECIMAL(18,2) DEFAULT 0,
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);
  // 兼容已存在的表：补充缺失列
  await pool.request().query(`
    IF COL_LENGTH('dbo.XixieConvert', '区经') IS NULL ALTER TABLE XixieConvert ADD 区经 NVARCHAR(100)
    IF COL_LENGTH('dbo.XixieConvert', '仓库类别') IS NULL ALTER TABLE XixieConvert ADD 仓库类别 NVARCHAR(50)
  `);
}

// GET /api/xixie/convert?monthYear=2026-08 - 查询洗鞋转化
router.get('/convert', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureConvertTable(pool);
    const monthYear = typeof req.query.monthYear === 'string' ? req.query.monthYear : '';
    let query = 'SELECT * FROM XixieConvert';
    const request = pool.request();
    if (monthYear) {
      query += ' WHERE monthYear = @my';
      request.input('my', sql.NVarChar, monthYear);
    }
    query += ' ORDER BY 督导, 店铺名称, 会员手机';
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (e: any) {
    console.error('查询洗鞋转化失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/xixie/convert - 新增单条
router.post('/convert', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureConvertTable(pool);
    const { monthYear, 督导, 店铺名称, 会员手机, 发放张数, 使用张数, 转化业绩 } = req.body || {};
    if (!店铺名称) return res.status(400).json({ error: '店铺名称不能为空' });
    const info = await enrichShopInfo(pool, String(店铺名称));
    const safeStr = (v: any) => (v != null ? String(v) : '');
    await pool.request()
      .input('my', sql.NVarChar, safeStr(monthYear))
      .input('dm', sql.NVarChar, safeStr(info.区经))
      .input('wh', sql.NVarChar, safeStr(info.仓库类别))
      .input('sv', sql.NVarChar, safeStr(督导 || info.督导))
      .input('sn', sql.NVarChar, String(店铺名称))
      .input('mp', sql.NVarChar, safeStr(会员手机))
      .input('issued', sql.Int, parseInt(发放张数) || 0)
      .input('used', sql.Int, parseInt(使用张数) || 0)
      .input('rev', sql.Decimal(18, 2), parseFloat(转化业绩) || 0)
      .query(`INSERT INTO XixieConvert (monthYear, 区经, 仓库类别, 督导, 店铺名称, 会员手机, 发放张数, 使用张数, 转化业绩)
        VALUES (@my, @dm, @wh, @sv, @sn, @mp, @issued, @used, @rev)`);
    res.json({ success: true });
  } catch (e: any) {
    console.error('新增洗鞋转化失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/xixie/convert/bulk - 批量导入
router.post('/convert/bulk', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureConvertTable(pool);
    const { rows } = req.body || {};
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: '没有导入数据' });

    // 预加载店仓全信息用于区经/仓库类别/督导补全
    const shopMap = new Map<string, any>();
    const allShops = await pool.request().query('SELECT 店铺名称 as sn, 区经, 仓库类别, 督导 FROM 店仓全');
    allShops.recordset.forEach((r: any) => shopMap.set(r.sn, r));

    const transaction = pool.transaction();
    await transaction.begin();
    try {
      let count = 0;
      for (const row of rows) {
        const shopName = String(row['店铺名称'] || '').trim();
        if (!shopName) continue;
        const monthYear = normalizeMonth(row['月份'] || row['monthYear'] || '');
        const 督导 = String(row['督导'] || '').trim();
        const 会员手机 = String(row['会员手机'] || '').trim();
        const 发放张数 = parseInt(row['发放张数']) || 0;
        const 使用张数 = parseInt(row['使用张数']) || 0;
        const 转化业绩 = parseFloat(row['转化业绩']) || 0;
        const info = shopMap.get(shopName) || {};
        const safeStr = (v: any) => (v != null ? String(v) : '');
        await transaction.request()
          .input('my', sql.NVarChar, monthYear)
          .input('dm', sql.NVarChar, safeStr(info.区经))
          .input('wh', sql.NVarChar, safeStr(info.仓库类别))
          .input('sv', sql.NVarChar, 督导 || safeStr(info.督导))
          .input('sn', sql.NVarChar, shopName)
          .input('mp', sql.NVarChar, 会员手机)
          .input('issued', sql.Int, 发放张数)
          .input('used', sql.Int, 使用张数)
          .input('rev', sql.Decimal(18, 2), 转化业绩)
          .query(`INSERT INTO XixieConvert (monthYear, 区经, 仓库类别, 督导, 店铺名称, 会员手机, 发放张数, 使用张数, 转化业绩)
            VALUES (@my, @dm, @wh, @sv, @sn, @mp, @issued, @used, @rev)`);
        count++;
      }
      await transaction.commit();
      res.json({ success: true, count });
    } catch (e: any) {
      await transaction.rollback();
      throw e;
    }
  } catch (e: any) {
    console.error('批量导入洗鞋转化失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/xixie/convert/clear - 清空
router.delete('/convert/clear', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureConvertTable(pool);
    await pool.request().query('DELETE FROM XixieConvert');
    res.json({ success: true });
  } catch (e: any) {
    console.error('清空洗鞋转化失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/xixie/summary?monthYear=2026-08 - 洗鞋汇总报表（费用+投发+核销，按月份+店铺聚合）
router.get('/summary', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    await ensureInvestTable(pool);
    await ensureWriteoffTable(pool);
    const monthYear = typeof req.query.monthYear === 'string' ? req.query.monthYear : '';
    const groupName = typeof req.query.groupName === 'string' ? req.query.groupName : '';
    const shopCond = await buildShopCond(pool, groupName, req.user || null);
    let query = `
      SELECT COALESCE(c.monthYear, i.monthYear, w.monthYear) AS monthYear,
             COALESCE(NULLIF(c.区经, ''), NULLIF(i.区经, ''), w.区经) AS 区经,
             COALESCE(NULLIF(c.仓库类别, ''), NULLIF(i.仓库类别, ''), w.仓库类别) AS 仓库类别,
             COALESCE(NULLIF(c.督导, ''), NULLIF(i.督导, ''), w.督导) AS 督导,
             COALESCE(c.店铺名称, i.店铺名称, w.店铺名称) AS 店铺名称,
             ISNULL(c.双数, 0) AS 双数,
             ISNULL(c.费用, 0) AS 费用,
             ISNULL(i.发放人数, 0) AS 发放人数,
             ISNULL(i.发放张数, 0) AS 发放张数,
             ISNULL(w.核销人数, 0) AS 核销人数,
             ISNULL(w.核销张数, 0) AS 核销张数,
             ISNULL(w.转化人数, 0) AS 转化人数,
             ISNULL(w.转化业绩, 0) AS 转化业绩
      FROM (
        SELECT monthYear, 店铺名称, MAX(区经) AS 区经, MAX(仓库类别) AS 仓库类别, MAX(督导) AS 督导,
               SUM(双数) AS 双数, SUM(费用) AS 费用
        FROM XixieCost
        GROUP BY monthYear, 店铺名称
      ) c
      FULL OUTER JOIN (
        SELECT monthYear, 店铺名称, MAX(区经) AS 区经, MAX(仓库类别) AS 仓库类别, MAX(督导) AS 督导,
               SUM(发放人数) AS 发放人数, SUM(发放张数) AS 发放张数
        FROM XixieInvest
        GROUP BY monthYear, 店铺名称
      ) i
      ON c.monthYear = i.monthYear AND c.店铺名称 = i.店铺名称
      FULL OUTER JOIN (
        SELECT monthYear, 店铺名称, MAX(区经) AS 区经, MAX(仓库类别) AS 仓库类别, MAX(督导) AS 督导,
               SUM(核销人数) AS 核销人数, SUM(核销张数) AS 核销张数, SUM(转化人数) AS 转化人数, SUM(转化业绩) AS 转化业绩
        FROM XixieWriteoff
        GROUP BY monthYear, 店铺名称
      ) w
      ON COALESCE(c.monthYear, i.monthYear) = w.monthYear AND COALESCE(c.店铺名称, i.店铺名称) = w.店铺名称
    `;
    const request = pool.request();
    const conds: string[] = [];
    if (monthYear) { conds.push('COALESCE(c.monthYear, i.monthYear, w.monthYear) = @my'); request.input('my', sql.NVarChar, monthYear); }
    if (shopCond) conds.push(shopCond.replace('店铺名称', 'COALESCE(c.店铺名称, i.店铺名称, w.店铺名称)'));
    if (conds.length) query += ' WHERE ' + conds.join(' AND ');
    query += ' ORDER BY 督导, 店铺名称';
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (e: any) {
    console.error('查询洗鞋汇总失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/xixie/convert/:id - 删除单条
router.delete('/convert/:id', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.Int, parseInt(req.params.id)).query('DELETE FROM XixieConvert WHERE id = @id');
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 洗鞋投发 / 核销 ====================

async function ensureInvestTable(pool: sql.ConnectionPool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'XixieInvest')
    CREATE TABLE XixieInvest (
      id INT IDENTITY(1,1) PRIMARY KEY,
      monthYear NVARCHAR(7) NOT NULL,
      区经 NVARCHAR(100),
      仓库类别 NVARCHAR(50),
      督导 NVARCHAR(100),
      店铺名称 NVARCHAR(200) NOT NULL,
      会员手机 NVARCHAR(50),
      发放人数 INT DEFAULT 0,
      发放张数 INT DEFAULT 0,
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);
}

async function ensureWriteoffTable(pool: sql.ConnectionPool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'XixieWriteoff')
    CREATE TABLE XixieWriteoff (
      id INT IDENTITY(1,1) PRIMARY KEY,
      monthYear NVARCHAR(7) NOT NULL,
      区经 NVARCHAR(100),
      仓库类别 NVARCHAR(50),
      督导 NVARCHAR(100),
      店铺名称 NVARCHAR(200) NOT NULL,
      会员手机 NVARCHAR(50),
      核销人数 INT DEFAULT 0,
      核销张数 INT DEFAULT 0,
      转化人数 INT DEFAULT 0,
      转化业绩 DECIMAL(18,2) DEFAULT 0,
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);
  // 兼容已存在的表：补充缺失列
  await pool.request().query(`
    IF COL_LENGTH('dbo.XixieWriteoff', '转化人数') IS NULL ALTER TABLE XixieWriteoff ADD 转化人数 INT DEFAULT 0
  `);
}

interface XixieModuleDef {
  table: string;
  base: string;      // '/invest' | '/writeoff'
  logName: string;
  ensure: (pool: sql.ConnectionPool) => Promise<void>;
  orderBy: string;
  strCols: string[]; // 字符串业务列（如 会员手机）
  intCols: string[]; // 整数列（如 发放人数/发放张数）
  decCols: string[]; // 金额列（如 转化业绩）
}

function registerXixieModule(def: XixieModuleDef) {
  const allCols = ['monthYear', '区经', '仓库类别', '督导', '店铺名称', ...def.strCols, ...def.intCols, ...def.decCols];
  const safeStr = (v: any) => (v != null ? String(v) : '');

  // 构造 INSERT 参数（按 allCols 顺序编号）
  function buildParams(pool: sql.ConnectionPool, row: Record<string, any>, info: any) {
    const inputs: { n: string; t: any; v: any }[] = [];
    let pi = 0;
    const add = (t: any, v: any) => inputs.push({ n: 'p' + (pi++), t, v });
    add(sql.NVarChar, safeStr(normalizeMonth(row['月份'] || row['monthYear'])));
    add(sql.NVarChar, safeStr(info.区经));
    add(sql.NVarChar, safeStr(info.仓库类别));
    add(sql.NVarChar, safeStr(row['督导'] || info.督导));
    add(sql.NVarChar, safeStr(row['店铺名称']));
    for (const c of def.strCols) add(sql.NVarChar, safeStr(row[c]));
    for (const c of def.intCols) add(sql.Int, parseInt(row[c]) || 0);
    for (const c of def.decCols) add(sql.Decimal(18, 2), parseFloat(row[c]) || 0);
    return inputs;
  }

  function insertSql(inputs: { n: string; t: any; v: any }[]) {
    const cols = allCols.join(', ');
    const params = inputs.map(x => '@' + x.n).join(', ');
    return `INSERT INTO ${def.table} (${cols}) VALUES (${params})`;
  }

  // GET /api/xixie/invest?monthYear=2026-08
  router.get(def.base, async (req, res) => {
    try {
      const pool = await getPool();
      await def.ensure(pool);
      const monthYear = typeof req.query.monthYear === 'string' ? req.query.monthYear : '';
      const page = parseInt(String(req.query.page || '')) || 0;
      const pageSize = parseInt(String(req.query.pageSize || '')) || 0;

      // 用户权限：按授权店铺过滤
      const groupName = typeof req.query.groupName === 'string' ? req.query.groupName : '';
      const shopCond = await buildShopCond(pool, groupName, req.user || null);

      // 构建 WHERE 与参数列表
      const conds: string[] = [];
      const params: { name: string; type: any; value: any }[] = [];
      const addParam = (name: string, type: any, value: any) => params.push({ name, type, value });
      if (monthYear) { conds.push('monthYear = @my'); addParam('my', sql.NVarChar, monthYear); }
      if (shopCond) conds.push(shopCond);
      const addIn = (col: string, param: string, val: any) => {
        let vals: any[];
        if (Array.isArray(val)) vals = val;
        else if (typeof val === 'string' && val.includes(',')) vals = val.split(',').filter(Boolean);
        else if (val != null && val !== '') vals = [val];
        else vals = [];
        if (vals.length === 0) return;
        conds.push(`${col} IN (${vals.map((_, i) => '@' + param + i).join(',')})`);
        vals.forEach((v, i) => addParam(param + i, sql.NVarChar, String(v)));
      };
      addIn('督导', 'sv', req.query.sv);
      addIn('店铺名称', 'sh', req.query.sh);
      addIn('仓库类别', 'wh', req.query.wh);
      addIn('区经', 'dm', req.query.dm);
      const kw = String(req.query.kw || '').trim();
      if (kw) { conds.push('(店铺名称 LIKE @kw0 OR 会员手机 LIKE @kw1)'); addParam('kw0', sql.NVarChar, `%${kw}%`); addParam('kw1', sql.NVarChar, `%${kw}%`); }
      const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';

      const sumCols = [...def.intCols, ...def.decCols];
      const sumExpr = sumCols.map(c => `ISNULL(SUM(${c}), 0) AS [${c}]`).join(', ');

      if (page > 0 && pageSize > 0) {
        const countReq = pool.request();
        params.forEach(p => countReq.input(p.name, p.type, p.value));
        const agg = await countReq.query(`SELECT COUNT(*) AS total, ${sumExpr} FROM ${def.table}${where}`);
        const dataReq = pool.request();
        params.forEach(p => dataReq.input(p.name, p.type, p.value));
        dataReq.input('off', sql.Int, (page - 1) * pageSize);
        dataReq.input('size', sql.Int, pageSize);
        const data = await dataReq.query(`SELECT * FROM ${def.table}${where} ORDER BY ${def.orderBy} OFFSET @off ROWS FETCH NEXT @size ROWS ONLY`);
        res.json({ rows: data.recordset, total: agg.recordset[0].total, aggregates: agg.recordset[0] });
      } else {
        const req2 = pool.request();
        params.forEach(p => req2.input(p.name, p.type, p.value));
        const result = await req2.query(`SELECT * FROM ${def.table}${where} ORDER BY ${def.orderBy}`);
        res.json(result.recordset);
      }
    } catch (e: any) {
      console.error(`查询${def.logName}失败:`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/xixie/invest - 新增单条
  router.post(def.base, async (req, res) => {
    try {
      const pool = await getPool();
      await def.ensure(pool);
      const b = req.body || {};
      const 店铺名称 = String(b['店铺名称'] || '').trim();
      if (!店铺名称) return res.status(400).json({ error: '店铺名称不能为空' });
      const info = await enrichShopInfo(pool, 店铺名称);
      const inputs = buildParams(pool, { ...b, 店铺名称 }, info);
      const q = pool.request();
      inputs.forEach(x => q.input(x.n, x.t, x.v));
      await q.query(insertSql(inputs));
      res.json({ success: true });
    } catch (e: any) {
      console.error(`新增${def.logName}失败:`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/xixie/invest/bulk - 批量导入
  router.post(`${def.base}/bulk`, async (req, res) => {
    try {
      const pool = await getPool();
      await def.ensure(pool);
      const { rows } = req.body || {};
      if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: '没有导入数据' });

      const shopMap = new Map<string, any>();
      const allShops = await pool.request().query('SELECT 店铺名称 as sn, 区经, 仓库类别, 督导 FROM 店仓全');
      allShops.recordset.forEach((r: any) => shopMap.set(r.sn, r));

      const transaction = pool.transaction();
      await transaction.begin();
      try {
        let count = 0;
        for (const row of rows) {
          const shopName = String(row['店铺名称'] || '').trim();
          if (!shopName) continue;
          const info = shopMap.get(shopName) || {};
          const inputs = buildParams(pool, row, info);
          const q = transaction.request();
          inputs.forEach(x => q.input(x.n, x.t, x.v));
          await q.query(insertSql(inputs));
          count++;
        }
        await transaction.commit();
        res.json({ success: true, count });
      } catch (e: any) {
        await transaction.rollback();
        throw e;
      }
    } catch (e: any) {
      console.error(`批量导入${def.logName}失败:`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/xixie/invest/clear - 清空
  router.delete(`${def.base}/clear`, async (req, res) => {
    try {
      const pool = await getPool();
      await def.ensure(pool);
      await pool.request().query(`DELETE FROM ${def.table}`);
      res.json({ success: true });
    } catch (e: any) {
      console.error(`清空${def.logName}失败:`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/xixie/invest/:id - 删除单条
  router.delete(`${def.base}/:id`, async (req, res) => {
    try {
      const pool = await getPool();
      await pool.request().input('id', sql.Int, parseInt(req.params.id)).query(`DELETE FROM ${def.table} WHERE id = @id`);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}

registerXixieModule({
  table: 'XixieInvest',
  base: '/invest',
  logName: '洗鞋投放',
  ensure: ensureInvestTable,
  orderBy: '督导, 店铺名称, 会员手机',
  strCols: ['会员手机'],
  intCols: ['发放人数', '发放张数'],
  decCols: [],
});

// GET /api/xixie/invest/meta?monthYear=2026-07 - 投放筛选项（该月去重店铺/督导/仓库/区经）
router.get('/invest/meta', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureInvestTable(pool);
    const monthYear = typeof req.query.monthYear === 'string' ? req.query.monthYear : '';
    const groupName = typeof req.query.groupName === 'string' ? req.query.groupName : '';
    const shopCond = await buildShopCond(pool, groupName, req.user || null);
    let query = 'SELECT DISTINCT 店铺名称, 督导, 仓库类别, 区经 FROM XixieInvest';
    const request = pool.request();
    const conds: string[] = [];
    if (monthYear) { conds.push('monthYear = @my'); request.input('my', sql.NVarChar, monthYear); }
    if (shopCond) conds.push(shopCond);
    if (conds.length) query += ' WHERE ' + conds.join(' AND ');
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (e: any) {
    console.error('查询投放筛选项失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

registerXixieModule({
  table: 'XixieWriteoff',
  base: '/writeoff',
  logName: '洗鞋核销',
  ensure: ensureWriteoffTable,
  orderBy: '督导, 店铺名称, 会员手机',
  strCols: ['会员手机'],
  intCols: ['核销人数', '核销张数', '转化人数'],
  decCols: ['转化业绩'],
});

export default router;
