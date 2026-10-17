import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { getStandardShopFilter, isAdminGroup } from '../services/permissionService';

const router = Router();

async function ensureTable(pool: sql.ConnectionPool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'CoachingStores')
    CREATE TABLE CoachingStores (
      id INT IDENTITY(1,1) PRIMARY KEY,
      shopName NVARCHAR(200) NOT NULL,
      monthYear NVARCHAR(7) NOT NULL DEFAULT '',
      warehouseType NVARCHAR(50),
      area NVARCHAR(100),
      districtManager NVARCHAR(100),
      supervisor NVARCHAR(100),
      product NVARCHAR(100),
      contactPerson NVARCHAR(100),
      phone NVARCHAR(50),
      dealer NVARCHAR(100),
      openDate NVARCHAR(50),
      createdAt DATETIME DEFAULT GETDATE(),
      CONSTRAINT UQ_CoachingStore UNIQUE (shopName, monthYear)
    )
  `);
  // 补充旧表缺少的 monthYear 列
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE name = 'monthYear' AND object_id = OBJECT_ID('CoachingStores'))
    ALTER TABLE CoachingStores ADD monthYear NVARCHAR(7) NOT NULL DEFAULT ''
  `);
  // 修复旧的单列唯一约束 → 改为 shopName+monthYear 联合唯一
  try {
    await pool.request().query(`
      IF EXISTS (SELECT * FROM sys.indexes WHERE name = 'UQ_CoachingStore' AND object_id = OBJECT_ID('CoachingStores'))
      DROP INDEX UQ_CoachingStore ON CoachingStores
    `);
  } catch { /* 约束可能已不存在 */ }
  // 确保联合唯一约束存在
  try {
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'UQ_CoachingStore' AND object_id = OBJECT_ID('CoachingStores'))
      CREATE UNIQUE INDEX UQ_CoachingStore ON CoachingStores(shopName, monthYear)
    `);
  } catch { /* 已存在 */ }
}

// GET /api/coaching-stores - 获取陪跑店铺列表（按权限过滤）
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const { monthYear, groupName } = req.query;
    const gn = typeof groupName === 'string' ? groupName : '';
    let query = 'SELECT * FROM CoachingStores';
    const conditions: string[] = [];
    if (monthYear && typeof monthYear === 'string') {
      conditions.push('monthYear = @my');
    }
    // 按用户权限过滤
    if (!isAdminGroup(gn)) {
      const permFilter = await getStandardShopFilter(gn, req.user || null);
      if (permFilter.filter === '1=0') {
        return res.json([]);
      }
      if (permFilter.filter) {
        // 直接过滤陪跑店铺：检查店铺是否在权限范围内
        const shopCheck = pool.request();
        permFilter.params.forEach((p: any) => shopCheck.input(p.name, p.type, p.value));
        const shopResult = await shopCheck.query(`SELECT DISTINCT 店铺名称 as sn FROM 店仓全 WHERE ${permFilter.filter}`);
        const allowedShops = shopResult.recordset.map((r: any) => r.sn?.trim()).filter(Boolean);
        if (allowedShops.length === 0) return res.json([]);
        const shopList = allowedShops.map(s => `'${s}'`).join(',');
        conditions.push(`shopName IN (${shopList})`);
      }
    }
    if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY area, districtManager, supervisor, shopName';
    const request = pool.request();
    if (monthYear && typeof monthYear === 'string') {
      request.input('my', sql.NVarChar, monthYear);
    }
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/coaching-stores - 新增陪跑店铺（从店铺档案同步）
router.post('/', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const { shopName, monthYear, warehouseType, area, districtManager, supervisor, product, contactPerson, phone, dealer, openDate } = req.body;
    if (!shopName) return res.status(400).json({ error: '店铺名称必填' });
    const my = monthYear || '';
    const result = await pool.request()
      .input('sn', sql.NVarChar, shopName).input('my', sql.NVarChar, my)
      .query('SELECT id FROM CoachingStores WHERE shopName = @sn AND monthYear = @my');
    if (result.recordset.length > 0) return res.status(400).json({ error: '该店铺本月已是陪跑店铺' });
    // 自动从店仓全补全信息
    const infoResult = await pool.request().input('sn', sql.NVarChar, shopName)
      .query('SELECT TOP 1 仓库类别 as wt, 区域 as ar, 区经 as dm, 督导 as sv, 商品 as pd, 联系人 as cp, 手机 as ph, 经销商 as dl, 开业日期 as od FROM 店仓全 WHERE 店铺名称 = @sn');
    const info = infoResult.recordset[0] || {};
    const safeStr = (v: any) => (v != null ? String(v) : '');
    await pool.request()
      .input('sn', sql.NVarChar, shopName).input('my', sql.NVarChar, my)
      .input('wt', sql.NVarChar, safeStr(warehouseType || info.wt))
      .input('ar', sql.NVarChar, safeStr(area || info.ar))
      .input('dm', sql.NVarChar, safeStr(districtManager || info.dm))
      .input('sv', sql.NVarChar, safeStr(supervisor || info.sv))
      .input('pd', sql.NVarChar, safeStr(product || info.pd))
      .input('cp', sql.NVarChar, safeStr(contactPerson || info.cp))
      .input('ph', sql.NVarChar, safeStr(phone || info.ph))
      .input('dl', sql.NVarChar, safeStr(dealer || info.dl))
      .input('od', sql.NVarChar, safeStr(openDate || info.od))
      .query(`INSERT INTO CoachingStores (shopName, monthYear, warehouseType, area, districtManager, supervisor, product, contactPerson, phone, dealer, openDate)
        VALUES (@sn, @my, @wt, @ar, @dm, @sv, @pd, @cp, @ph, @dl, @od)`);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/coaching-stores/batch - 批量导入陪跑店铺（只需店铺名称，系统自动补全）
router.post('/batch', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const { shopNames, monthYear } = req.body;
    if (!Array.isArray(shopNames) || shopNames.length === 0) return res.status(400).json({ error: '无数据' });
    const my = monthYear || '';
    const shopInfoMap = new Map<string, any>();
    const allShops = await pool.request().query('SELECT 店铺名称 as sn, 仓库类别 as wt, 区域 as ar, 区经 as dm, 督导 as sv, 商品 as pd, 联系人 as cp, 手机 as ph, 经销商 as dl, 开业日期 as od FROM 店仓全');
    allShops.recordset.forEach((r: any) => shopInfoMap.set(r.sn, r));
    let count = 0;
    const errors: string[] = [];
    for (const shopName of shopNames) {
      try {
        if (!shopName) continue;
        const exist = await pool.request().input('sn', sql.NVarChar, shopName).input('my', sql.NVarChar, my)
          .query('SELECT id FROM CoachingStores WHERE shopName = @sn AND monthYear = @my');
        if (exist.recordset.length > 0) continue;
        const info = shopInfoMap.get(shopName) || {};
        const safeStr = (v: any) => (v != null ? String(v) : '');
        await pool.request()
          .input('sn', sql.NVarChar, shopName).input('my', sql.NVarChar, my)
          .input('wt', sql.NVarChar, safeStr(info.wt)).input('ar', sql.NVarChar, safeStr(info.ar))
          .input('dm', sql.NVarChar, safeStr(info.dm)).input('sv', sql.NVarChar, safeStr(info.sv))
          .input('pd', sql.NVarChar, safeStr(info.pd)).input('cp', sql.NVarChar, safeStr(info.cp))
          .input('ph', sql.NVarChar, safeStr(info.ph)).input('dl', sql.NVarChar, safeStr(info.dl))
          .input('od', sql.NVarChar, safeStr(info.od))
          .query(`INSERT INTO CoachingStores (shopName, monthYear, warehouseType, area, districtManager, supervisor, product, contactPerson, phone, dealer, openDate)
            VALUES (@sn, @my, @wt, @ar, @dm, @sv, @pd, @cp, @ph, @dl, @od)`);
        count++;
      } catch (e: any) {
        errors.push(`${shopName}: ${e.message}`);
      }
    }
    res.json({ success: true, count, errors });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/coaching-stores/clear/:monthYear - 清空当月陪跑店铺
router.delete('/clear/:monthYear', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('my', sql.NVarChar, req.params.monthYear)
      .query('DELETE FROM CoachingStores WHERE monthYear = @my');
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/coaching-stores/:id
router.delete('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.Int, parseInt(req.params.id)).query('DELETE FROM CoachingStores WHERE id = @id');
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
