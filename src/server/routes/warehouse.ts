import { Router } from 'express';
import sql from 'mssql';
import axios from 'axios';
import https from 'https';
import { getPool } from '../../config/db';
import { guardHighRiskWrite, guardLogin } from '../middlewares/authMiddleware';

const router = Router();

// 仓库域为管理域：enforce=true 时所有接口强制登录（前端适配 JWT 后自动收紧）
router.use(guardLogin);

// 外部订单查询接口
const SCAN_API = 'https://www.gzhaharen.com:7321/order/AccordingToUuidGetDetail';
const AGENT = new https.Agent({ rejectUnauthorized: false });

// 尺码列（31~45 每个尺码单独成一列）
const SIZES = [31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45];
const SIZE_COL_DDL = SIZES.map(s => `[${s}] INT`).join(', ');

// 客户名称 → 仓库映射：从数据库表 WarehouseCustomerMap 读取（不再硬编码，可在库中维护）
const WAREHOUSE_MAP_SEEDS: [string, string, string][] = [
  ['郑州-刘勇', '加盟仓库', 'JMC01'],
  ['SD郑州-陈希文', '山东仓库', 'SDC01'],
  ['直营-陈黎', '河南仓库', 'ZYC01'],
];

async function ensureWarehouseCustomerMap(pool: sql.ConnectionPool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'WarehouseCustomerMap')
    CREATE TABLE WarehouseCustomerMap (
      id INT IDENTITY(1,1) PRIMARY KEY,
      customName NVARCHAR(200) NOT NULL,
      warehouseName NVARCHAR(100) NOT NULL,
      warehouseCode NVARCHAR(100) NOT NULL,
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);
  // 种子数据（仅表为空时写入，保留历史映射）
  const cnt = await pool.request().query('SELECT COUNT(*) as n FROM WarehouseCustomerMap');
  if (cnt.recordset[0].n === 0) {
    for (const [customName, warehouseName, warehouseCode] of WAREHOUSE_MAP_SEEDS) {
      await pool.request()
        .input('customName', sql.NVarChar, customName)
        .input('warehouseName', sql.NVarChar, warehouseName)
        .input('warehouseCode', sql.NVarChar, warehouseCode)
        .query(`INSERT INTO WarehouseCustomerMap (customName, warehouseName, warehouseCode) VALUES (@customName, @warehouseName, @warehouseCode)`);
    }
  }
}

async function warehouseOf(pool: sql.ConnectionPool, customName: string): Promise<{ name: string; code: string }> {
  try {
    const result = await pool.request()
      .input('customName', sql.NVarChar, customName)
      .query('SELECT TOP 1 warehouseName, warehouseCode FROM WarehouseCustomerMap WHERE customName = @customName');
    const row = result.recordset[0];
    return row ? { name: row.warehouseName, code: row.warehouseCode } : { name: '', code: '' };
  } catch (e: any) {
    console.error('WarehouseCustomerMap 查询失败，回退空仓库:', e.message);
    return { name: '', code: '' };
  }
}

// 把值安全转成字符串（Infinity/undefined 都会变成空串）
function s(v: any): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

async function ensureTable(pool: sql.ConnectionPool) {
  // 建表（含每个尺码一列）
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'WarehouseScanRecords')
    CREATE TABLE WarehouseScanRecords (
      id INT IDENTITY(1,1) PRIMARY KEY,
      uuid NVARCHAR(200) NOT NULL,
      客户名称 NVARCHAR(200),
      货号 NVARCHAR(200),
      商品名称 NVARCHAR(200),
      颜色编号 NVARCHAR(100),
      颜色名称 NVARCHAR(100),
      供应商编号 NVARCHAR(100),
      单据编号 NVARCHAR(200),
      单据日期 NVARCHAR(100),
      ${SIZE_COL_DDL},
      数量 INT,
      件数 INT,
      仓库名称 NVARCHAR(100),
      仓库代码 NVARCHAR(100),
      完整数据 NVARCHAR(MAX),
      原始返回 NVARCHAR(MAX),
      入库单号 NVARCHAR(50),
      入库日期 NVARCHAR(20),
      入库时间 NVARCHAR(20),
      操作人 NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);
  // 旧表兼容：逐列补建缺失的尺码列（不毁已有数据）
  for (const sz of SIZES) {
    await pool.request().query(
      `IF COL_LENGTH('WarehouseScanRecords', '${sz}') IS NULL EXEC('ALTER TABLE WarehouseScanRecords ADD [${sz}] INT')`
    );
  }
  // 旧表兼容：补建缺失的入库单号/日期/时间/件数/仓库/操作人列
  for (const col of ['入库单号 NVARCHAR(50)', '入库日期 NVARCHAR(20)', '入库时间 NVARCHAR(20)', '件数 INT', '仓库名称 NVARCHAR(100)', '仓库代码 NVARCHAR(100)', '操作人 NVARCHAR(100)']) {
    const [name, ddl] = col.split(' ');
    await pool.request().query(
      `IF COL_LENGTH('WarehouseScanRecords', '${name}') IS NULL EXEC('ALTER TABLE WarehouseScanRecords ADD ${name} ${ddl}')`
    );
  }
}

// 生成自建入库信息
function buildEntryMeta(id: number) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const 入库单号 = `RK${ymd}${String(id).padStart(4, '0')}`;
  return { 入库单号, 入库日期: dateStr, 入库时间: timeStr };
}

// POST /api/warehouse/scan - 仓库扫码入库
router.post('/scan', async (req, res) => {
  try {
    const { uuid: rawUuid, authorization } = req.body || {};
    if (!rawUuid) return res.status(400).json({ error: 'uuid 不能为空' });
    const uuid = String(rawUuid).trim();

    const url = `${SCAN_API}?uuid=${encodeURIComponent(uuid)}`;
    const headers: Record<string, string> = {};
    if (authorization) headers.Authorization = String(authorization);

    let response;
    try {
      response = await axios.get(url, { headers, httpsAgent: AGENT, timeout: 10000 });
    } catch (e: any) {
      if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') return res.status(500).json({ error: '网络超时，请稍后重试' });
      if (e.response) {
        if (e.response.status === 401 || e.response.status === 403) return res.status(500).json({ error: '鉴权失败' });
        if (e.response.status === 404) return res.status(500).json({ error: 'uuid 不存在' });
        return res.status(500).json({ error: `服务报错（HTTP ${e.response.status}）` });
      }
      return res.status(500).json({ error: '服务异常：' + e.message });
    }

    // 解析响应体，无论 HTTP 状态码是否 200
    const data = response.data;
    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
    let parsed: any = null;
    try { parsed = typeof data === 'string' ? JSON.parse(data) : data; } catch { parsed = null; }

    // 外部接口业务失败：HTTP 200 + body.code != 200，要如实上报，不能当成功记
    if (!parsed || parsed.code !== 200 || !parsed.data || typeof parsed.data !== 'object') {
      const msg = (parsed && parsed.message) ? parsed.message : '未获取到订单数据';
      return res.status(500).json({ error: msg });
    }

    const d = parsed.data;

    const sizeObj: Record<string, number> = (d.size && typeof d.size === 'object') ? d.size : {};
    function szVal(sz: number): number | null {
      const v = Number(sizeObj[sz]);
      return Number.isFinite(v) ? v : null;
    }

    const qty = Number(d.number);
    const orderNo = s(d.orderNo) || s(d.code);

    const pool = await getPool();
    await ensureWarehouseCustomerMap(pool);
    const wh = await warehouseOf(pool, s(d.customName));
    await ensureTable(pool);
    const stmt = pool.request();
    stmt.input('uuid', sql.NVarChar, uuid);
    stmt.input('customer', sql.NVarChar, s(d.customName));
    stmt.input('item', sql.NVarChar, s(d.itemName));
    stmt.input('code', sql.NVarChar, s(d.code));
    stmt.input('colorNo', sql.NVarChar, s(d.colorNo));
    stmt.input('colorName', sql.NVarChar, s(d.colorName));
    stmt.input('supplier', sql.NVarChar, s(d.supplierNo));
    stmt.input('orderNo', sql.NVarChar, s(d.orderNo));
    stmt.input('orderDate', sql.NVarChar, s(d.orderDate));
    for (const sz of SIZES) stmt.input(`sz${sz}`, sql.Int, szVal(sz));
    stmt.input('qty', sql.Int, Number.isFinite(qty) ? qty : null);
    stmt.input('pkgNum', sql.Int, 1); // 扫一个记一件
    stmt.input('whName', sql.NVarChar, wh.name);
    stmt.input('whCode', sql.NVarChar, wh.code);
    stmt.input('dataJson', sql.NVarChar, JSON.stringify(d));
    stmt.input('rawJson', sql.NVarChar, jsonStr);

    const ins = await stmt.query(`
      INSERT INTO WarehouseScanRecords
        (uuid, 客户名称, 货号, 商品名称, 颜色编号, 颜色名称, 供应商编号, 单据编号, 单据日期, ${SIZES.map(sz => `[${sz}]`).join(', ')}, 数量, 件数, 仓库名称, 仓库代码, 完整数据, 原始返回)
      OUTPUT INSERTED.id
      VALUES
        (@uuid, @customer, @code, @item, @colorNo, @colorName, @supplier, @orderNo, @orderDate, ${SIZES.map(sz => `@sz${sz}`).join(', ')}, @qty, @pkgNum, @whName, @whCode, @dataJson, @rawJson)
    `);

    const newId = ins.recordset[0].id;
    const meta = buildEntryMeta(newId);
    const upd = await pool.request();
    upd.input('rkNo', sql.NVarChar, meta.入库单号);
    upd.input('rkDate', sql.NVarChar, meta.入库日期);
    upd.input('rkTime', sql.NVarChar, meta.入库时间);
    upd.input('id', sql.Int, newId);
    upd.input('operator', sql.NVarChar, (req.user?.userName || req.user?.userCode || ''));
    await upd.query(`UPDATE WarehouseScanRecords SET 入库单号=@rkNo, 入库日期=@rkDate, 入库时间=@rkTime, 操作人=@operator WHERE id=@id`);

    const finalize = await pool.request().input('id', sql.Int, newId)
      .query('SELECT * FROM WarehouseScanRecords WHERE id=@id');
    const record = finalize.recordset[0];
    res.json({ success: true, orderNo, record });
  } catch (e: any) {
    console.error('仓库扫码入库失败:', e.message);
    res.status(500).json({ error: '服务异常：' + (e.message || '未知错误') });
  }
});

// GET /api/warehouse/records
router.get('/records', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const result = await pool.request().query('SELECT * FROM WarehouseScanRecords ORDER BY id DESC');
    res.json(result.recordset);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/warehouse/export - 导出当天入库记录（按 sku 展开为一行一条）
router.get('/export', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const recRes = await pool.request().input('d', sql.NVarChar, today)
      .query('SELECT * FROM WarehouseScanRecords WHERE 入库日期=@d ORDER BY id DESC');
    const recs: any[] = recRes.recordset;

    // 供应商映射：供货商代码 -> 供货商名称
    const supRes = await pool.request().query(
      `SELECT 供货商代码, 供货商 FROM 商品全 WHERE 性别 IN ('女鞋','男鞋','童鞋') AND 年份>=2024 GROUP BY 供货商代码, 供货商`
    );
    const supMap: Record<string, string> = {};
    for (const r of supRes.recordset) supMap[String(r.供货商代码)] = r.供货商;

    // 去重 (商品代码,颜色代码) 对，批量查 sku
    const pairs = new Map<string, { code: string; color: string }>();
    for (const rc of recs) {
      const k = `${rc.商品名称 || ''}|${rc.颜色编号 || ''}`;
      if (!pairs.has(k)) pairs.set(k, { code: rc.商品名称 || '', color: rc.颜色编号 || '' });
    }
    const skuMaps = new Map<string, Record<string, string>>();
    for (const [k, info] of pairs) {
      if (!info.code) continue;
      const q = await pool.request()
        .input('c', sql.NVarChar, info.code)
        .input('col', sql.NVarChar, info.color)
        .query(`SELECT 尺码代码, sku FROM 商品全 WHERE 商品代码=@c AND 颜色代码=@col AND 性别 IN ('女鞋','男鞋','童鞋') AND 年份>=2024`);
      const m: Record<string, string> = {};
      for (const r of q.recordset) m[String(r.尺码代码)] = r.sku;
      skuMaps.set(k, m);
    }

    // 组装导出行：一个 (记录, 尺码) 一行，一个 sku 一行，数量取该尺码数量
    const rows: any[] = [];
    for (const rc of recs) {
      const supplier = supMap[String(rc.供应商编号 || '')] || '';
      const itemKey = `${rc.商品名称 || ''}|${rc.颜色编号 || ''}`;
      const skuMap = skuMaps.get(itemKey) || {};
      for (const sz of SIZES) {
        const qty = Number(rc[sz]) || 0;
        if (qty <= 0) continue;
        rows.push({
          单据编号: '',
          单据日期: rc.入库日期 || '',
          采购店仓: rc.仓库名称 || '',
          供应商: supplier,
          备注: '',
          品牌: '卡迪高',
          条码或国标码: skuMap[String(sz)] || '',
          采购价: '',
          数量: qty,
          入库日期: '',
        });
      }
    }
    res.json({ success: true, date: today, rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/warehouse/clear-today - 今日清空（删除入库日期为今天的记录）
router.delete('/clear-today', guardHighRiskWrite, async (req, res) => {
  try {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const pool = await getPool();
    await ensureTable(pool);
    const r = await pool.request().input('d', sql.NVarChar, today)
      .query('DELETE FROM WarehouseScanRecords WHERE 入库日期=@d');
    res.json({ success: true, deleted: r.rowsAffected[0] || 0, date: today });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/warehouse/records/:id - 删除一条入库记录
router.delete('/records/:id', guardHighRiskWrite, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '记录 id 无效' });
    const pool = await getPool();
    await ensureTable(pool);
    const r = await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM WarehouseScanRecords WHERE id=@id');
    res.json({ success: true, deleted: r.rowsAffected[0] || 0 });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;