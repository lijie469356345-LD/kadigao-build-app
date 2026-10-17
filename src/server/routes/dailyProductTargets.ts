import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';

const router = Router();

const PRODUCT_FIELDS = ['monthTarget','springTarget','summerTarget','autumnTarget','winterTarget','newProductTarget','oldProductTarget','mainProductTarget','menShoesTarget','womenShoesTarget','kidsShoesTarget','bagTarget'];

function decomposeTarget(monthlyTarget: number, year: number, month: number) {
  if (monthlyTarget <= 0) return [];
  const coeffs: Record<string, number> = { '周日': 1.2, '周一': 1.0, '周二': 1.0, '周三': 1.0, '周四': 1.0, '周五': 1.1, '周六': 1.5 };
  const dim = new Date(year, month, 0).getDate();
  const weekDayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const days: { dayIndex: number; date: string; dayOfWeek: string; coefficient: number }[] = [];
  for (let d = 1; d <= dim; d++) {
    const dt = new Date(year, month - 1, d);
    const dow = weekDayNames[dt.getDay()];
    days.push({ dayIndex: d, date: `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`, dayOfWeek: dow, coefficient: coeffs[dow] || 1.0 });
  }
  const result: { date: string; dayIndex: number; dayOfWeek: string; coefficient: number; dailyTarget: number }[] = [];
  const segs: { days: typeof days; ratio: number }[] = [
    { days: days.filter(d => d.dayIndex <= 15), ratio: 0.6 },
    { days: days.filter(d => d.dayIndex > 15 && d.dayIndex <= 28), ratio: 0.4 },
    { days: days.filter(d => d.dayIndex > 28), ratio: 0 },
  ];
  segs.forEach(seg => {
    const totalWeight = seg.days.reduce((s, d) => s + d.coefficient, 0);
    if (totalWeight === 0 || seg.ratio === 0) { seg.days.forEach(d => result.push({ ...d, dailyTarget: 0 })); return; }
    const segTotal = Math.round(monthlyTarget * seg.ratio);
    let allocated = 0;
    seg.days.forEach((d, i) => {
      const v = i < seg.days.length - 1 ? Math.round(d.coefficient * segTotal / totalWeight) : segTotal - allocated;
      allocated += v;
      result.push({ ...d, dailyTarget: v });
    });
  });
  return result;
}

async function ensureTable(pool: sql.ConnectionPool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DailyProductTargets')
    CREATE TABLE DailyProductTargets (
      id INT IDENTITY(1,1) PRIMARY KEY,
      shopName NVARCHAR(200) NOT NULL,
      product NVARCHAR(100),
      productLeader NVARCHAR(100),
      monthYear NVARCHAR(7) NOT NULL,
      monthTarget DECIMAL(18,2) DEFAULT 0,
      springTarget DECIMAL(18,2) DEFAULT 0,
      summerTarget DECIMAL(18,2) DEFAULT 0,
      autumnTarget DECIMAL(18,2) DEFAULT 0,
      winterTarget DECIMAL(18,2) DEFAULT 0,
      newProductTarget DECIMAL(18,2) DEFAULT 0,
      oldProductTarget DECIMAL(18,2) DEFAULT 0,
      mainProductTarget DECIMAL(18,2) DEFAULT 0,
      menShoesTarget DECIMAL(18,2) DEFAULT 0,
      womenShoesTarget DECIMAL(18,2) DEFAULT 0,
      kidsShoesTarget DECIMAL(18,2) DEFAULT 0,
      bagTarget DECIMAL(18,2) DEFAULT 0,
      userCode NVARCHAR(100),
      status NVARCHAR(50) DEFAULT 'editing',
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE(),
      CONSTRAINT UK_DPT_ShopMonth UNIQUE (shopName, monthYear)
    )
  `);

  // 日分解表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DailyProductTargetDaily')
    CREATE TABLE DailyProductTargetDaily (
      id INT IDENTITY(1,1) PRIMARY KEY,
      shopName NVARCHAR(200) NOT NULL,
      monthYear NVARCHAR(7) NOT NULL,
      fieldName NVARCHAR(50) NOT NULL,
      targetDate DATE NOT NULL,
      dayIndex INT NOT NULL,
      dayOfWeek NVARCHAR(10),
      coefficient DECIMAL(18,4) DEFAULT 1,
      dailyTarget DECIMAL(18,2) DEFAULT 0,
      CONSTRAINT UK_DPTD_ShopMonthFieldDate UNIQUE (shopName, monthYear, fieldName, targetDate)
    )
  `);
}

// DELETE /api/daily-product-targets/clear/:monthYear - 清空当月所有商品指标
router.delete('/clear/:monthYear', async (req, res) => {
  try {
    const pool = await getPool();
    const my = req.params.monthYear;
    await pool.request().input('my', sql.NVarChar, my).query('DELETE FROM DailyProductTargets WHERE monthYear = @my');
    await pool.request().input('my', sql.NVarChar, my).query('DELETE FROM DailyProductTargetDaily WHERE monthYear = @my');
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/daily-product-targets/by-month/:monthYear
router.get('/by-month/:monthYear', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const result = await pool.request()
      .input('monthYear', sql.NVarChar, req.params.monthYear)
      .query('SELECT * FROM DailyProductTargets WHERE monthYear = @monthYear ORDER BY productLeader, product, shopName');
    res.json(result.recordset);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/daily-product-targets/:userCode/:monthYear
router.put('/:userCode/:monthYear', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const { userCode, monthYear } = req.params;
    const { records } = req.body;
    if (!records || !Array.isArray(records)) return res.status(400).json({ error: 'records required' });

    for (const r of records) {
      const request = pool.request()
        .input('shopName', sql.NVarChar, r.shopName)
        .input('product', sql.NVarChar, r.product || '')
        .input('productLeader', sql.NVarChar, r.productLeader || '')
        .input('monthYear', sql.NVarChar, monthYear)
        .input('monthTarget', sql.Decimal, r.monthTarget || 0)
        .input('springTarget', sql.Decimal, r.springTarget || 0)
        .input('summerTarget', sql.Decimal, r.summerTarget || 0)
        .input('autumnTarget', sql.Decimal, r.autumnTarget || 0)
        .input('winterTarget', sql.Decimal, r.winterTarget || 0)
        .input('newProductTarget', sql.Decimal, r.newProductTarget || 0)
        .input('oldProductTarget', sql.Decimal, r.oldProductTarget || 0)
        .input('mainProductTarget', sql.Decimal, r.mainProductTarget || 0)
        .input('menShoesTarget', sql.Decimal, r.menShoesTarget || 0)
        .input('womenShoesTarget', sql.Decimal, r.womenShoesTarget || 0)
        .input('kidsShoesTarget', sql.Decimal, r.kidsShoesTarget || 0)
        .input('bagTarget', sql.Decimal, r.bagTarget || 0)
        .input('userCode', sql.NVarChar, userCode)
        .input('status', sql.NVarChar, r.status || 'editing');

      const check = await pool.request()
        .input('sn', sql.NVarChar, r.shopName)
        .input('my', sql.NVarChar, monthYear)
        .query('SELECT id FROM DailyProductTargets WHERE shopName = @sn AND monthYear = @my');

      if (check.recordset.length > 0) {
        await pool.request()
          .input('id', sql.Int, check.recordset[0].id)
          .input('product', sql.NVarChar, r.product || '')
          .input('productLeader', sql.NVarChar, r.productLeader || '')
          .input('monthTarget', sql.Decimal, r.monthTarget || 0)
          .input('springTarget', sql.Decimal, r.springTarget || 0)
          .input('summerTarget', sql.Decimal, r.summerTarget || 0)
          .input('autumnTarget', sql.Decimal, r.autumnTarget || 0)
          .input('winterTarget', sql.Decimal, r.winterTarget || 0)
          .input('newProductTarget', sql.Decimal, r.newProductTarget || 0)
          .input('oldProductTarget', sql.Decimal, r.oldProductTarget || 0)
          .input('mainProductTarget', sql.Decimal, r.mainProductTarget || 0)
          .input('menShoesTarget', sql.Decimal, r.menShoesTarget || 0)
          .input('womenShoesTarget', sql.Decimal, r.womenShoesTarget || 0)
          .input('kidsShoesTarget', sql.Decimal, r.kidsShoesTarget || 0)
          .input('bagTarget', sql.Decimal, r.bagTarget || 0)
          .input('status', sql.NVarChar, r.status || 'editing')
          .query(`UPDATE DailyProductTargets SET product=@product, productLeader=@productLeader,
            monthTarget=@monthTarget, springTarget=@springTarget, summerTarget=@summerTarget,
            autumnTarget=@autumnTarget, winterTarget=@winterTarget,
            newProductTarget=@newProductTarget, oldProductTarget=@oldProductTarget,
            mainProductTarget=@mainProductTarget, menShoesTarget=@menShoesTarget,
            womenShoesTarget=@womenShoesTarget, kidsShoesTarget=@kidsShoesTarget,
            bagTarget=@bagTarget, status=@status, updatedAt=GETDATE()
            WHERE id=@id`);
      } else {
        await request.query(`INSERT INTO DailyProductTargets
          (shopName, product, productLeader, monthYear, monthTarget, springTarget, summerTarget, autumnTarget, winterTarget,
           newProductTarget, oldProductTarget, mainProductTarget, menShoesTarget, womenShoesTarget, kidsShoesTarget, bagTarget,
           userCode, status)
          VALUES (@shopName, @product, @productLeader, @monthYear, @monthTarget, @springTarget, @summerTarget,
           @autumnTarget, @winterTarget, @newProductTarget, @oldProductTarget, @mainProductTarget,
           @menShoesTarget, @womenShoesTarget, @kidsShoesTarget, @bagTarget, @userCode, @status)`);
      }
    }

    // 保存日分解数据
    const [y, m] = monthYear.split('-').map(Number);
    for (const r of records) {
      if (!r.shopName) continue;
      await pool.request()
        .input('sn', sql.NVarChar, r.shopName)
        .input('my', sql.NVarChar, monthYear)
        .query('DELETE FROM DailyProductTargetDaily WHERE shopName = @sn AND monthYear = @my');
      for (const field of PRODUCT_FIELDS) {
        const val = r[field] || 0;
        if (val <= 0) continue;
        const daily = decomposeTarget(val, y, m);
        for (const d of daily) {
          await pool.request()
            .input('sn', sql.NVarChar, r.shopName)
            .input('my', sql.NVarChar, monthYear)
            .input('fn', sql.NVarChar, field)
            .input('td', sql.Date, d.date)
            .input('di', sql.Int, d.dayIndex)
            .input('dw', sql.NVarChar, d.dayOfWeek)
            .input('co', sql.Decimal(18,4), d.coefficient)
            .input('dt', sql.Decimal(18,2), d.dailyTarget)
            .query(`INSERT INTO DailyProductTargetDaily (shopName, monthYear, fieldName, targetDate, dayIndex, dayOfWeek, coefficient, dailyTarget)
              VALUES (@sn, @my, @fn, @td, @di, @dw, @co, @dt)`);
        }
      }
    }

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/daily-product-targets/daily-sums/:monthYear/:startDate/:endDate
router.get('/daily-sums/:monthYear/:startDate/:endDate', async (req, res) => {
  try {
    const pool = await getPool();
    const { monthYear, startDate, endDate } = req.params;
    const check = await pool.request()
      .input('my', sql.NVarChar, monthYear)
      .query('SELECT COUNT(*) as cnt FROM DailyProductTargetDaily WHERE monthYear = @my');
    if (check.recordset[0].cnt === 0) {
      return res.json([]);
    }
    const result = await pool.request()
      .input('my', sql.NVarChar, monthYear)
      .input('sd', sql.Date, startDate)
      .input('ed', sql.Date, endDate)
      .query(`SELECT shopName, fieldName, SUM(dailyTarget) as weekTarget
        FROM DailyProductTargetDaily
        WHERE monthYear = @my AND targetDate >= @sd AND targetDate <= @ed
        GROUP BY shopName, fieldName
        ORDER BY shopName, fieldName`);
    res.json(result.recordset);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
