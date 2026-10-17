import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';

const router = Router();

async function ensureTable(pool: sql.ConnectionPool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DailyShopTargets')
    CREATE TABLE DailyShopTargets (
      id INT IDENTITY(1,1) PRIMARY KEY,
      userCode NVARCHAR(100) NOT NULL,
      monthYear NVARCHAR(7) NOT NULL,
      shopName NVARCHAR(200) NOT NULL,
      districtManager NVARCHAR(100),
      supervisor NVARCHAR(100),
      orderCountTarget INT DEFAULT 0,
      giftRatioTarget DECIMAL(18,2) DEFAULT 0,
      newMemberTarget INT DEFAULT 0,
      attachmentRateTarget DECIMAL(18,2) DEFAULT 0,
      mainProductTarget INT DEFAULT 0,
      oldMemberTarget INT DEFAULT 0,
      birthdayTarget INT DEFAULT 0,
      status NVARCHAR(20) DEFAULT 'editing',
      changeData NVARCHAR(MAX),
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE(),
      CONSTRAINT UK_DST_UserMonthShop UNIQUE (userCode, monthYear, shopName)
    )
  `);
  // 兼容旧表：补充 changeData 列
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE name = 'changeData' AND object_id = OBJECT_ID('DailyShopTargets'))
    ALTER TABLE DailyShopTargets ADD changeData NVARCHAR(MAX)
  `);

  // 日分解表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DailyShopTargetDaily')
    CREATE TABLE DailyShopTargetDaily (
      id INT IDENTITY(1,1) PRIMARY KEY,
      shopName NVARCHAR(200) NOT NULL,
      monthYear NVARCHAR(7) NOT NULL,
      fieldName NVARCHAR(50) NOT NULL,
      targetDate DATE NOT NULL,
      dayIndex INT NOT NULL,
      dayOfWeek NVARCHAR(10),
      coefficient DECIMAL(18,4) DEFAULT 1,
      dailyTarget DECIMAL(18,2) DEFAULT 0,
      CONSTRAINT UK_DSTD_ShopMonthFieldDate UNIQUE (shopName, monthYear, fieldName, targetDate)
    )
  `);
}

// 需要分解到日的字段（礼包量按开单数逻辑分解）
const DAILY_FIELDS = ['orderCountTarget','giftRatioTarget','newMemberTarget','mainProductTarget','oldMemberTarget','birthdayTarget'];
// 比率型字段（不分解，始终取月度值）
const RATIO_FIELDS = ['attachmentRateTarget'];

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

// GET /api/daily-shop-targets/by-month/:monthYear - 获取该月全部指标（管理/总监用）
router.get('/by-month/:monthYear', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const result = await pool.request()
      .input('monthYear', sql.NVarChar, req.params.monthYear)
      .query('SELECT * FROM DailyShopTargets WHERE monthYear = @monthYear ORDER BY districtManager, supervisor, shopName');
    res.json(result.recordset);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/daily-shop-targets/:userCode/:monthYear
router.get('/:userCode/:monthYear', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const result = await pool.request()
      .input('userCode', sql.NVarChar, req.params.userCode)
      .input('monthYear', sql.NVarChar, req.params.monthYear)
      .query('SELECT * FROM DailyShopTargets WHERE userCode = @userCode AND monthYear = @monthYear ORDER BY districtManager, supervisor, shopName');
    res.json(result.recordset);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PUT /api/daily-shop-targets/:userCode/:monthYear - batch save
router.put('/:userCode/:monthYear', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const { userCode, monthYear } = req.params;
    const records: any[] = req.body.records || [];

    const t = pool.transaction();
    await t.begin();

    // Delete existing for this user+month
    await t.request()
      .input('uc', sql.NVarChar, userCode)
      .input('my', sql.NVarChar, monthYear)
      .query('DELETE FROM DailyShopTargets WHERE userCode = @uc AND monthYear = @my');

    // Insert new records
    for (const r of records) {
      if (!r.shopName) continue;
      await t.request()
        .input('userCode', sql.NVarChar, userCode)
        .input('monthYear', sql.NVarChar, monthYear)
        .input('shopName', sql.NVarChar, r.shopName)
        .input('districtManager', sql.NVarChar, r.districtManager || '')
        .input('supervisor', sql.NVarChar, r.supervisor || '')
        .input('orderCountTarget', sql.Int, r.orderCountTarget || 0)
        .input('giftRatioTarget', sql.Decimal(18, 2), r.giftRatioTarget || 0)
        .input('newMemberTarget', sql.Int, r.newMemberTarget || 0)
        .input('attachmentRateTarget', sql.Decimal(18, 2), r.attachmentRateTarget || 0)
        .input('mainProductTarget', sql.Int, r.mainProductTarget || 0)
        .input('oldMemberTarget', sql.Int, r.oldMemberTarget || 0)
        .input('birthdayTarget', sql.Int, r.birthdayTarget || 0)
        .input('status', sql.NVarChar, r.status || 'editing')
        .query(`INSERT INTO DailyShopTargets (userCode, monthYear, shopName, districtManager, supervisor,
          orderCountTarget, giftRatioTarget, newMemberTarget, attachmentRateTarget, mainProductTarget, oldMemberTarget, birthdayTarget, status)
          VALUES (@userCode, @monthYear, @shopName, @districtManager, @supervisor,
          @orderCountTarget, @giftRatioTarget, @newMemberTarget, @attachmentRateTarget, @mainProductTarget, @oldMemberTarget, @birthdayTarget, @status)`);
    }

    await t.commit();

    // 保存日分解数据
    const [y, m] = monthYear.split('-').map(Number);
    for (const r of records) {
      if (!r.shopName) continue;
      // Delete existing daily for this shop+month
      await pool.request()
        .input('sn', sql.NVarChar, r.shopName)
        .input('my', sql.NVarChar, monthYear)
        .query('DELETE FROM DailyShopTargetDaily WHERE shopName = @sn AND monthYear = @my');
      // Decompose and insert daily targets
      for (const field of DAILY_FIELDS) {
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
            .query(`INSERT INTO DailyShopTargetDaily (shopName, monthYear, fieldName, targetDate, dayIndex, dayOfWeek, coefficient, dailyTarget)
              VALUES (@sn, @my, @fn, @td, @di, @dw, @co, @dt)`);
        }
      }
    }

    res.json({ success: true, count: records.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/daily-shop-targets/daily-sums/:monthYear/:startDate/:endDate
router.get('/daily-sums/:monthYear/:startDate/:endDate', async (req, res) => {
  try {
    const pool = await getPool();
    const { monthYear, startDate, endDate } = req.params;
    const list: any[] = [];

    // 分解到日的字段：按日期范围汇总
    const result = await pool.request()
      .input('my', sql.NVarChar, monthYear)
      .input('sd', sql.Date, startDate)
      .input('ed', sql.Date, endDate)
      .query(`SELECT shopName, fieldName, SUM(dailyTarget) as weekTarget
        FROM DailyShopTargetDaily
        WHERE monthYear = @my AND targetDate >= @sd AND targetDate <= @ed
          AND fieldName IN ('orderCountTarget','giftRatioTarget','newMemberTarget','mainProductTarget','oldMemberTarget','birthdayTarget')
        GROUP BY shopName, fieldName
        ORDER BY shopName, fieldName`);
    list.push(...result.recordset);

    // 比率型字段（连带率）：取月度原值，不汇总不分解
    const ratioResult = await pool.request()
      .input('my', sql.NVarChar, monthYear)
      .query(`SELECT shopName, ${RATIO_FIELDS.map(f => 'MAX(' + f + ') as ' + f).join(',')}
        FROM DailyShopTargets WHERE monthYear = @my GROUP BY shopName`);
    for (const row of ratioResult.recordset) {
      for (const field of RATIO_FIELDS) {
        if (row[field] != null && row[field] > 0) {
          list.push({ shopName: row.shopName, fieldName: field, weekTarget: parseFloat(row[field]) });
        }
      }
    }
    res.json(list);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/daily-shop-targets/clear/:monthYear - 清空当月所有日常指标
router.delete('/clear/:monthYear', async (req, res) => {
  try {
    const pool = await getPool();
    const my = req.params.monthYear;
    await pool.request().input('my', sql.NVarChar, my).query('DELETE FROM DailyShopTargets WHERE monthYear = @my');
    await pool.request().input('my', sql.NVarChar, my).query('DELETE FROM DailyShopTargetDaily WHERE monthYear = @my');
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/daily-shop-targets/:userCode/:monthYear
router.delete('/:userCode/:monthYear', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('uc', sql.NVarChar, req.params.userCode)
      .input('my', sql.NVarChar, req.params.monthYear)
      .query('DELETE FROM DailyShopTargets WHERE userCode = @uc AND monthYear = @my');
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/daily-shop-targets/approve/:monthYear/:shopName - 审批通过（管理/总监专用，无需userCode）
router.patch('/approve/:monthYear/:shopName', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const { monthYear, shopName } = req.params;
    const sn = decodeURIComponent(shopName);

    // 查找该店铺的变更数据
    const result = await pool.request()
      .input('my', sql.NVarChar, monthYear)
      .input('sn', sql.NVarChar, sn)
      .query('SELECT changeData FROM DailyShopTargets WHERE monthYear = @my AND shopName = @sn AND status = \'pending_change\'');

    if (result.recordset.length === 0) return res.status(404).json({ error: '未找到待审批记录' });

    const cdStr = result.recordset[0]?.changeData;
    if (cdStr) {
      const cd = JSON.parse(cdStr);
      await pool.request()
        .input('my', sql.NVarChar, monthYear)
        .input('sn', sql.NVarChar, sn)
        .input('o', sql.Int, cd.orderCountTarget ?? 0)
        .input('g', sql.Decimal(18, 2), cd.giftRatioTarget ?? 0)
        .input('n', sql.Int, cd.newMemberTarget ?? 0)
        .input('a', sql.Decimal(18, 2), cd.attachmentRateTarget ?? 0)
        .input('m', sql.Int, cd.mainProductTarget ?? 0)
        .input('om', sql.Int, cd.oldMemberTarget ?? 0)
        .input('b', sql.Int, cd.birthdayTarget ?? 0)
        .query(`UPDATE DailyShopTargets SET
          orderCountTarget = @o, giftRatioTarget = @g, newMemberTarget = @n,
          attachmentRateTarget = @a, mainProductTarget = @m, oldMemberTarget = @om, birthdayTarget = @b,
          status = 'locked', updatedAt = GETDATE()
          WHERE monthYear = @my AND shopName = @sn AND status = 'pending_change'`);
    }
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/daily-shop-targets/request-change/:monthYear/:shopName - 提交变更申请（无需userCode）
router.patch('/request-change/:monthYear/:shopName', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const { monthYear, shopName } = req.params;
    const { changeData } = req.body;
    const sn = decodeURIComponent(shopName);
    await pool.request()
      .input('my', sql.NVarChar, monthYear)
      .input('sn', sql.NVarChar, sn)
      .input('st', sql.NVarChar, 'pending_change')
      .input('cd', sql.NVarChar, JSON.stringify(changeData || {}))
      .query(`UPDATE DailyShopTargets SET status = @st, changeData = @cd, updatedAt = GETDATE()
        WHERE monthYear = @my AND shopName = @sn AND status IN ('locked','approved')`);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/daily-shop-targets/reject/:monthYear/:shopName - 拒绝变更（管理/总监专用）
router.patch('/reject/:monthYear/:shopName', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const { monthYear, shopName } = req.params;
    await pool.request()
      .input('my', sql.NVarChar, monthYear)
      .input('sn', sql.NVarChar, decodeURIComponent(shopName))
      .query(`UPDATE DailyShopTargets SET status = 'locked', changeData = NULL, updatedAt = GETDATE()
        WHERE monthYear = @my AND shopName = @sn AND status = 'pending_change'`);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/daily-shop-targets/:userCode/:monthYear/:shopName - 更新状态
router.patch('/:userCode/:monthYear/:shopName', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const { userCode, monthYear, shopName } = req.params;
    const { status, changeData } = req.body;
    const validStatuses = ['editing', 'locked', 'pending_change', 'approved'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: '无效状态' });

    const sn = decodeURIComponent(shopName);

    if (status === 'pending_change' && changeData) {
      // 存储变更申请数据
      await pool.request()
        .input('uc', sql.NVarChar, userCode)
        .input('my', sql.NVarChar, monthYear)
        .input('sn', sql.NVarChar, sn)
        .input('st', sql.NVarChar, status)
        .input('cd', sql.NVarChar, JSON.stringify(changeData))
        .query(`UPDATE DailyShopTargets SET status = @st, changeData = @cd, updatedAt = GETDATE()
          WHERE userCode = @uc AND monthYear = @my AND shopName = @sn`);
    } else if (status === 'approved') {
      // 审批通过：读取变更数据并写入实际列
      const result = await pool.request()
        .input('uc', sql.NVarChar, userCode)
        .input('my', sql.NVarChar, monthYear)
        .input('sn', sql.NVarChar, sn)
        .query('SELECT changeData FROM DailyShopTargets WHERE userCode = @uc AND monthYear = @my AND shopName = @sn');

      const cdStr = result.recordset[0]?.changeData;
      if (cdStr) {
        const cd = JSON.parse(cdStr);
        await pool.request()
          .input('uc', sql.NVarChar, userCode)
          .input('my', sql.NVarChar, monthYear)
          .input('sn', sql.NVarChar, sn)
          .input('o', sql.Int, cd.orderCountTarget ?? 0)
          .input('g', sql.Decimal(18, 2), cd.giftRatioTarget ?? 0)
          .input('n', sql.Int, cd.newMemberTarget ?? 0)
          .input('a', sql.Decimal(18, 2), cd.attachmentRateTarget ?? 0)
          .input('m', sql.Int, cd.mainProductTarget ?? 0)
          .input('om', sql.Int, cd.oldMemberTarget ?? 0)
          .input('b', sql.Int, cd.birthdayTarget ?? 0)
          .query(`UPDATE DailyShopTargets SET
            orderCountTarget = @o, giftRatioTarget = @g, newMemberTarget = @n,
            attachmentRateTarget = @a, mainProductTarget = @m, oldMemberTarget = @om, birthdayTarget = @b,
            status = 'locked', changeData = NULL, updatedAt = GETDATE()
            WHERE userCode = @uc AND monthYear = @my AND shopName = @sn`);
      } else {
        // 无变更数据，仅更新状态
        await pool.request()
          .input('uc', sql.NVarChar, userCode)
          .input('my', sql.NVarChar, monthYear)
          .input('sn', sql.NVarChar, sn)
          .query(`UPDATE DailyShopTargets SET status = 'locked', updatedAt = GETDATE()
            WHERE userCode = @uc AND monthYear = @my AND shopName = @sn`);
      }
    } else {
      // 其他状态更新
      await pool.request()
        .input('uc', sql.NVarChar, userCode)
        .input('my', sql.NVarChar, monthYear)
        .input('sn', sql.NVarChar, sn)
        .input('st', sql.NVarChar, status)
        .query(`UPDATE DailyShopTargets SET status = @st, updatedAt = GETDATE()
          WHERE userCode = @uc AND monthYear = @my AND shopName = @sn`);
    }

    res.json({ success: true, status });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
