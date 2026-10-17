import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';

const router = Router();

async function ensureTable(pool: sql.ConnectionPool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DirectSalesSummary')
    CREATE TABLE DirectSalesSummary (
      id INT IDENTITY(1,1) PRIMARY KEY,
      userCode NVARCHAR(100) NOT NULL,
      monthYear NVARCHAR(7) NOT NULL,
      dealer NVARCHAR(200),
      supervisor NVARCHAR(200),
      monthlyTarget DECIMAL(18,2) DEFAULT 0,
      monthlyAchieved DECIMAL(18,2) DEFAULT 0,
      achievementRate DECIMAL(18,2) DEFAULT 0,
      coefficientRatio DECIMAL(18,2) DEFAULT 0,
      performanceGap DECIMAL(18,2) DEFAULT 0,
      areaTarget DECIMAL(18,2) DEFAULT 0,
      areaAchieved DECIMAL(18,2) DEFAULT 0,
      areaAchievementRate DECIMAL(18,2) DEFAULT 0,
      remainingDailyAvg DECIMAL(18,2) DEFAULT 0,
      orderCountTarget INT DEFAULT 0,
      orderCountDone INT DEFAULT 0,
      giftRatioTarget DECIMAL(18,2) DEFAULT 0,
      giftRatioDone DECIMAL(18,2) DEFAULT 0,
      newMemberTarget INT DEFAULT 0,
      newMemberDone INT DEFAULT 0,
      attachmentRateTarget DECIMAL(18,2) DEFAULT 0,
      attachmentRateDone DECIMAL(18,2) DEFAULT 0,
      mainProductTarget INT DEFAULT 0,
      mainProductDone INT DEFAULT 0,
      oldMemberTarget INT DEFAULT 0,
      oldMemberDone INT DEFAULT 0,
      birthdayTarget INT DEFAULT 0,
      birthdayDone INT DEFAULT 0,
      workItems NVARCHAR(MAX) DEFAULT '[]',
      weeklySnapshot NVARCHAR(MAX) DEFAULT '[]',
      createdBy NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE(),
      CONSTRAINT UK_DSS_UserMonth UNIQUE (userCode, monthYear)
    )
  `);
  // 保证新列存在（兼容旧表）
  const newCols = [
    ['oldMemberTarget', 'INT DEFAULT 0'],
    ['oldMemberDone', 'INT DEFAULT 0'],
    ['birthdayTarget', 'INT DEFAULT 0'],
    ['birthdayDone', 'INT DEFAULT 0'],
    ['weeklySnapshot', 'NVARCHAR(MAX) DEFAULT \'[]\''],
    ['submitted', 'BIT DEFAULT 0'],
  ];
  for (const [col, def] of newCols) {
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE name = '${col}' AND object_id = OBJECT_ID('DirectSalesSummary'))
      ALTER TABLE DirectSalesSummary ADD ${col} ${def}
    `);
  }
}

// GET /api/direct-sales-summary/submitted/:monthYear - 获取某月所有已提交的汇报列表（必须在 /:userCode/:monthYear 之前定义）
router.get('/submitted/:monthYear', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const result = await pool.request()
      .input('monthYear', sql.NVarChar, req.params.monthYear)
      .query(`SELECT d.userCode, d.dealer, d.supervisor, d.monthYear, d.submitted, d.updatedAt, d.workItems, d.createdBy,
              u.用户名称 as userName
              FROM DirectSalesSummary d
              LEFT JOIN 用户全 u ON d.userCode = u.用户代码
              WHERE d.monthYear = @monthYear AND (d.submitted = 1 OR d.workItems LIKE '%"_locked":true%')
              ORDER BY d.updatedAt DESC`);
    const list = result.recordset.map((r: any) => {
      let workItemCount = 0;
      try {
        const items = typeof r.workItems === 'string' ? JSON.parse(r.workItems) : (r.workItems || []);
        workItemCount = Array.isArray(items) ? items.length : 0;
      } catch { /* ignore */ }
      return {
        userCode: r.userCode,
        userName: r.userName || r.supervisor || r.dealer || r.userCode,
        dealer: r.dealer,
        supervisor: r.supervisor,
        monthYear: r.monthYear,
        submitted: r.submitted === true || r.submitted === 1,
        updatedAt: r.updatedAt,
        createdBy: r.createdBy,
        workItemCount,
      };
    });
    res.json(list);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/direct-sales-summary/:userCode/:monthYear
router.get('/:userCode/:monthYear', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const result = await pool.request()
      .input('userCode', sql.NVarChar, req.params.userCode)
      .input('monthYear', sql.NVarChar, req.params.monthYear)
      .query('SELECT * FROM DirectSalesSummary WHERE userCode = @userCode AND monthYear = @monthYear');

    if (result.recordset.length > 0) {
      const r = result.recordset[0];
      r.workItems = typeof r.workItems === 'string' ? JSON.parse(r.workItems) : (r.workItems || []);
      r.weeklySnapshot = typeof r.weeklySnapshot === 'string' ? JSON.parse(r.weeklySnapshot) : (r.weeklySnapshot || []);
      r.submitted = r.submitted === true || r.submitted === 1;
      res.json(r);
    } else {
      res.json({
        userCode: req.params.userCode,
        monthYear: req.params.monthYear,
        dealer: '', supervisor: '',
        monthlyTarget: 0, monthlyAchieved: 0, achievementRate: 0, coefficientRatio: 0, performanceGap: 0,
        areaTarget: 0, areaAchieved: 0, areaAchievementRate: 0, remainingDailyAvg: 0,
        orderCountTarget: 0, orderCountDone: 0,
        giftRatioTarget: 0, giftRatioDone: 0,
        newMemberTarget: 0, newMemberDone: 0,
        oldMemberTarget: 0, oldMemberDone: 0,
        birthdayTarget: 0, birthdayDone: 0,
        attachmentRateTarget: 0, attachmentRateDone: 0,
        mainProductTarget: 0, mainProductDone: 0,
        workItems: [],
        weeklySnapshot: [],
        submitted: false,
      });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/direct-sales-summary/:userCode/:monthYear
router.put('/:userCode/:monthYear', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const { userCode, monthYear } = req.params;
    const body = req.body;

    const request = pool.request()
      .input('userCode', sql.NVarChar, userCode)
      .input('monthYear', sql.NVarChar, monthYear)
      .input('dealer', sql.NVarChar, body.dealer || '')
      .input('supervisor', sql.NVarChar, body.supervisor || '')
      .input('monthlyTarget', sql.Decimal, body.monthlyTarget || 0)
      .input('monthlyAchieved', sql.Decimal, body.monthlyAchieved || 0)
      .input('achievementRate', sql.Decimal, body.achievementRate || 0)
      .input('coefficientRatio', sql.Decimal, body.coefficientRatio || 0)
      .input('performanceGap', sql.Decimal, body.performanceGap || 0)
      .input('areaTarget', sql.Decimal, body.areaTarget || 0)
      .input('areaAchieved', sql.Decimal, body.areaAchieved || 0)
      .input('areaAchievementRate', sql.Decimal, body.areaAchievementRate || 0)
      .input('remainingDailyAvg', sql.Decimal, body.remainingDailyAvg || 0)
      .input('orderCountTarget', sql.Int, body.orderCountTarget || 0)
      .input('orderCountDone', sql.Int, body.orderCountDone || 0)
      .input('giftRatioTarget', sql.Decimal, body.giftRatioTarget || 0)
      .input('giftRatioDone', sql.Decimal, body.giftRatioDone || 0)
      .input('newMemberTarget', sql.Int, body.newMemberTarget || 0)
      .input('newMemberDone', sql.Int, body.newMemberDone || 0)
      .input('attachmentRateTarget', sql.Decimal, body.attachmentRateTarget || 0)
      .input('attachmentRateDone', sql.Decimal, body.attachmentRateDone || 0)
      .input('mainProductTarget', sql.Int, body.mainProductTarget || 0)
      .input('mainProductDone', sql.Int, body.mainProductDone || 0)
      .input('oldMemberTarget', sql.Int, body.oldMemberTarget || 0)
      .input('oldMemberDone', sql.Int, body.oldMemberDone || 0)
      .input('birthdayTarget', sql.Int, body.birthdayTarget || 0)
      .input('birthdayDone', sql.Int, body.birthdayDone || 0)
      .input('workItems', sql.NVarChar, JSON.stringify(body.workItems || []))
      .input('weeklySnapshot', sql.NVarChar, JSON.stringify(body.weeklySnapshot || []))
      .input('createdBy', sql.NVarChar, body.createdBy || userCode);

    const check = await pool.request()
      .input('uc', sql.NVarChar, userCode)
      .input('my', sql.NVarChar, monthYear)
      .query('SELECT id FROM DirectSalesSummary WHERE userCode = @uc AND monthYear = @my');

    if (check.recordset.length > 0) {
      await pool.request()
        .input('id', sql.Int, check.recordset[0].id)
        .input('dealer', sql.NVarChar, body.dealer || '')
        .input('supervisor', sql.NVarChar, body.supervisor || '')
        .input('monthlyTarget', sql.Decimal, body.monthlyTarget || 0)
        .input('monthlyAchieved', sql.Decimal, body.monthlyAchieved || 0)
        .input('achievementRate', sql.Decimal, body.achievementRate || 0)
        .input('coefficientRatio', sql.Decimal, body.coefficientRatio || 0)
        .input('performanceGap', sql.Decimal, body.performanceGap || 0)
        .input('areaTarget', sql.Decimal, body.areaTarget || 0)
        .input('areaAchieved', sql.Decimal, body.areaAchieved || 0)
        .input('areaAchievementRate', sql.Decimal, body.areaAchievementRate || 0)
        .input('remainingDailyAvg', sql.Decimal, body.remainingDailyAvg || 0)
        .input('orderCountTarget', sql.Int, body.orderCountTarget || 0)
        .input('orderCountDone', sql.Int, body.orderCountDone || 0)
        .input('giftRatioTarget', sql.Decimal, body.giftRatioTarget || 0)
        .input('giftRatioDone', sql.Decimal, body.giftRatioDone || 0)
        .input('newMemberTarget', sql.Int, body.newMemberTarget || 0)
        .input('newMemberDone', sql.Int, body.newMemberDone || 0)
        .input('attachmentRateTarget', sql.Decimal, body.attachmentRateTarget || 0)
        .input('attachmentRateDone', sql.Decimal, body.attachmentRateDone || 0)
        .input('mainProductTarget', sql.Int, body.mainProductTarget || 0)
        .input('mainProductDone', sql.Int, body.mainProductDone || 0)
        .input('oldMemberTarget', sql.Int, body.oldMemberTarget || 0)
        .input('oldMemberDone', sql.Int, body.oldMemberDone || 0)
        .input('birthdayTarget', sql.Int, body.birthdayTarget || 0)
        .input('birthdayDone', sql.Int, body.birthdayDone || 0)
        .input('workItems', sql.NVarChar, JSON.stringify(body.workItems || []))
        .input('weeklySnapshot', sql.NVarChar, JSON.stringify(body.weeklySnapshot || []))
        .query(`UPDATE DirectSalesSummary SET dealer=@dealer, supervisor=@supervisor,
          monthlyTarget=@monthlyTarget, monthlyAchieved=@monthlyAchieved, achievementRate=@achievementRate,
          coefficientRatio=@coefficientRatio, performanceGap=@performanceGap,
          areaTarget=@areaTarget, areaAchieved=@areaAchieved, areaAchievementRate=@areaAchievementRate,
          remainingDailyAvg=@remainingDailyAvg, orderCountTarget=@orderCountTarget, orderCountDone=@orderCountDone,
          giftRatioTarget=@giftRatioTarget, giftRatioDone=@giftRatioDone,
          newMemberTarget=@newMemberTarget, newMemberDone=@newMemberDone,
          attachmentRateTarget=@attachmentRateTarget, attachmentRateDone=@attachmentRateDone,
          mainProductTarget=@mainProductTarget, mainProductDone=@mainProductDone,
          oldMemberTarget=@oldMemberTarget, oldMemberDone=@oldMemberDone, birthdayTarget=@birthdayTarget, birthdayDone=@birthdayDone,
          workItems=@workItems, weeklySnapshot=@weeklySnapshot, updatedAt=GETDATE()
          WHERE id=@id`);
    } else {
      await request.query(`INSERT INTO DirectSalesSummary
        (userCode, monthYear, dealer, supervisor, monthlyTarget, monthlyAchieved, achievementRate, coefficientRatio, performanceGap,
         areaTarget, areaAchieved, areaAchievementRate, remainingDailyAvg, orderCountTarget, orderCountDone,
         giftRatioTarget, giftRatioDone, newMemberTarget, newMemberDone,
         attachmentRateTarget, attachmentRateDone, mainProductTarget, mainProductDone, oldMemberTarget, oldMemberDone, birthdayTarget, birthdayDone,
         workItems, weeklySnapshot, createdBy)
        VALUES (@userCode, @monthYear, @dealer, @supervisor, @monthlyTarget, @monthlyAchieved, @achievementRate, @coefficientRatio, @performanceGap,
         @areaTarget, @areaAchieved, @areaAchievementRate, @remainingDailyAvg, @orderCountTarget, @orderCountDone,
         @giftRatioTarget, @giftRatioDone, @newMemberTarget, @newMemberDone,
         @attachmentRateTarget, @attachmentRateDone, @mainProductTarget, @mainProductDone, @oldMemberTarget, @oldMemberDone, @birthdayTarget, @birthdayDone,
         @workItems, @weeklySnapshot, @createdBy)`);
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/direct-sales-summary/submit - 提交月度+周度汇总数据
router.post('/submit', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const body = req.body;
    const { userCode, monthYear, monthlyData, weeklyData, weekStart, weekEnd, workItems } = body;

    if (!userCode || !monthYear) {
      return res.status(400).json({ error: 'userCode 和 monthYear 必填' });
    }

    // 保存月度汇总数据
    const mReq = pool.request()
      .input('userCode', sql.NVarChar, userCode)
      .input('monthYear', sql.NVarChar, monthYear)
      .input('dealer', sql.NVarChar, body.dealer || '')
      .input('supervisor', sql.NVarChar, body.supervisor || '')
      .input('monthlyTarget', sql.Decimal, monthlyData?.totalTarget || 0)
      .input('monthlyAchieved', sql.Decimal, monthlyData?.totalAchieved || 0)
      .input('achievementRate', sql.Decimal, monthlyData?.achievementRate || 0)
      .input('coefficientRatio', sql.Decimal, monthlyData?.coefficientRatio || 0)
      .input('performanceGap', sql.Decimal, monthlyData?.performanceGap || 0)
      .input('areaTarget', sql.Decimal, monthlyData?.areaTarget || 0)
      .input('areaAchieved', sql.Decimal, monthlyData?.areaAchieved || 0)
      .input('areaAchievementRate', sql.Decimal, monthlyData?.areaAchievementRate || 0)
      .input('remainingDailyAvg', sql.Decimal, monthlyData?.remainingDailyAvg || 0)
      .input('orderCountTarget', sql.Int, monthlyData?.orderCountTarget || 0)
      .input('orderCountDone', sql.Int, monthlyData?.orderCountDone || 0)
      .input('giftRatioTarget', sql.Decimal, monthlyData?.giftRatioTarget || 0)
      .input('giftRatioDone', sql.Decimal, monthlyData?.giftRatioDone || 0)
      .input('newMemberTarget', sql.Int, monthlyData?.newMemberTarget || 0)
      .input('newMemberDone', sql.Int, monthlyData?.newMemberDone || 0)
      .input('attachmentRateTarget', sql.Decimal, monthlyData?.attachmentRateTarget || 0)
      .input('attachmentRateDone', sql.Decimal, monthlyData?.attachmentRateDone || 0)
      .input('mainProductTarget', sql.Int, monthlyData?.mainProductTarget || 0)
      .input('mainProductDone', sql.Int, monthlyData?.mainProductDone || 0)
      .input('oldMemberTarget', sql.Int, monthlyData?.oldMemberTarget || 0)
      .input('oldMemberDone', sql.Int, monthlyData?.oldMemberDone || 0)
      .input('birthdayTarget', sql.Int, monthlyData?.birthdayTarget || 0)
      .input('birthdayDone', sql.Int, monthlyData?.birthdayDone || 0)
      .input('workItems', sql.NVarChar, JSON.stringify(workItems || []))
      .input('weeklySnapshot', sql.NVarChar, JSON.stringify({ weekStart, weekEnd, data: weeklyData || [] }))
      .input('createdBy', sql.NVarChar, userCode);

    const check = await pool.request()
      .input('uc', sql.NVarChar, userCode)
      .input('my', sql.NVarChar, monthYear)
      .query('SELECT id FROM DirectSalesSummary WHERE userCode = @uc AND monthYear = @my');

    if (check.recordset.length > 0) {
      await pool.request()
        .input('id', sql.Int, check.recordset[0].id)
        .input('dealer', sql.NVarChar, body.dealer || '')
        .input('supervisor', sql.NVarChar, body.supervisor || '')
        .input('monthlyTarget', sql.Decimal, monthlyData?.totalTarget || 0)
        .input('monthlyAchieved', sql.Decimal, monthlyData?.totalAchieved || 0)
        .input('achievementRate', sql.Decimal, monthlyData?.achievementRate || 0)
        .input('coefficientRatio', sql.Decimal, monthlyData?.coefficientRatio || 0)
        .input('performanceGap', sql.Decimal, monthlyData?.performanceGap || 0)
        .input('areaTarget', sql.Decimal, monthlyData?.areaTarget || 0)
        .input('areaAchieved', sql.Decimal, monthlyData?.areaAchieved || 0)
        .input('areaAchievementRate', sql.Decimal, monthlyData?.areaAchievementRate || 0)
        .input('remainingDailyAvg', sql.Decimal, monthlyData?.remainingDailyAvg || 0)
        .input('orderCountTarget', sql.Int, monthlyData?.orderCountTarget || 0)
        .input('orderCountDone', sql.Int, monthlyData?.orderCountDone || 0)
        .input('giftRatioTarget', sql.Decimal, monthlyData?.giftRatioTarget || 0)
        .input('giftRatioDone', sql.Decimal, monthlyData?.giftRatioDone || 0)
        .input('newMemberTarget', sql.Int, monthlyData?.newMemberTarget || 0)
        .input('newMemberDone', sql.Int, monthlyData?.newMemberDone || 0)
        .input('attachmentRateTarget', sql.Decimal, monthlyData?.attachmentRateTarget || 0)
        .input('attachmentRateDone', sql.Decimal, monthlyData?.attachmentRateDone || 0)
        .input('mainProductTarget', sql.Int, monthlyData?.mainProductTarget || 0)
        .input('mainProductDone', sql.Int, monthlyData?.mainProductDone || 0)
        .input('oldMemberTarget', sql.Int, monthlyData?.oldMemberTarget || 0)
        .input('oldMemberDone', sql.Int, monthlyData?.oldMemberDone || 0)
        .input('birthdayTarget', sql.Int, monthlyData?.birthdayTarget || 0)
        .input('birthdayDone', sql.Int, monthlyData?.birthdayDone || 0)
        .input('workItems', sql.NVarChar, JSON.stringify(workItems || []))
        .input('weeklySnapshot', sql.NVarChar, JSON.stringify({ weekStart, weekEnd, data: weeklyData || [] }))
        .query(`UPDATE DirectSalesSummary SET dealer=@dealer, supervisor=@supervisor,
          monthlyTarget=@monthlyTarget, monthlyAchieved=@monthlyAchieved, achievementRate=@achievementRate,
          coefficientRatio=@coefficientRatio, performanceGap=@performanceGap,
          areaTarget=@areaTarget, areaAchieved=@areaAchieved, areaAchievementRate=@areaAchievementRate,
          remainingDailyAvg=@remainingDailyAvg, orderCountTarget=@orderCountTarget, orderCountDone=@orderCountDone,
          giftRatioTarget=@giftRatioTarget, giftRatioDone=@giftRatioDone,
          newMemberTarget=@newMemberTarget, newMemberDone=@newMemberDone,
          attachmentRateTarget=@attachmentRateTarget, attachmentRateDone=@attachmentRateDone,
          mainProductTarget=@mainProductTarget, mainProductDone=@mainProductDone,
          oldMemberTarget=@oldMemberTarget, oldMemberDone=@oldMemberDone, birthdayTarget=@birthdayTarget, birthdayDone=@birthdayDone,
          workItems=@workItems, weeklySnapshot=@weeklySnapshot, submitted=1, updatedAt=GETDATE()
          WHERE id=@id`);
    } else {
      await mReq.query(`INSERT INTO DirectSalesSummary
        (userCode, monthYear, dealer, supervisor, monthlyTarget, monthlyAchieved, achievementRate, coefficientRatio, performanceGap,
         areaTarget, areaAchieved, areaAchievementRate, remainingDailyAvg, orderCountTarget, orderCountDone,
         giftRatioTarget, giftRatioDone, newMemberTarget, newMemberDone,
         attachmentRateTarget, attachmentRateDone, mainProductTarget, mainProductDone, oldMemberTarget, oldMemberDone, birthdayTarget, birthdayDone,
         workItems, weeklySnapshot, createdBy, submitted)
        VALUES (@userCode, @monthYear, @dealer, @supervisor, @monthlyTarget, @monthlyAchieved, @achievementRate, @coefficientRatio, @performanceGap,
         @areaTarget, @areaAchieved, @areaAchievementRate, @remainingDailyAvg, @orderCountTarget, @orderCountDone,
         @giftRatioTarget, @giftRatioDone, @newMemberTarget, @newMemberDone,
         @attachmentRateTarget, @attachmentRateDone, @mainProductTarget, @mainProductDone, @oldMemberTarget, @oldMemberDone, @birthdayTarget, @birthdayDone,
         @workItems, @weeklySnapshot, @createdBy, 1)`);
    }
    res.json({ success: true, message: '提交成功' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/direct-sales-summary/unsubmit - 管理员反提交（不改变内容，仅解锁）
router.post('/unsubmit', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const { userCode, monthYear } = req.body;
    if (!userCode || !monthYear) {
      return res.status(400).json({ error: 'userCode 和 monthYear 必填' });
    }

    const check = await pool.request()
      .input('uc', sql.NVarChar, userCode)
      .input('my', sql.NVarChar, monthYear)
      .query('SELECT id, workItems FROM DirectSalesSummary WHERE userCode = @uc AND monthYear = @my');

    if (check.recordset.length === 0) {
      return res.status(404).json({ error: '未找到该用户的提交记录' });
    }

    // 解锁 workItems
    let workItems = check.recordset[0].workItems;
    if (typeof workItems === 'string') {
      try { workItems = JSON.parse(workItems); } catch { workItems = []; }
    }
    if (Array.isArray(workItems)) {
      workItems = workItems.map((w: any) => ({ ...w, _locked: false }));
    } else {
      workItems = [];
    }

    await pool.request()
      .input('id', sql.Int, check.recordset[0].id)
      .input('workItems', sql.NVarChar, JSON.stringify(workItems))
      .query('UPDATE DirectSalesSummary SET submitted = 0, workItems = @workItems, updatedAt = GETDATE() WHERE id = @id');

    res.json({ success: true, message: '反提交成功，督导可再次修改' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
