import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { isAdminGroup, isDirectorGroup, getStandardVisibleShopNames, getUserGroupRole } from '../services/permissionService';
import { getSettings, pushToSingleRecipient } from '../services/wechatPushService';

const router = Router();

// ============================================================
// 自动建表（如果表不存在）
// ============================================================
async function ensureTablesExist() {
  try {
    const pool = await getPool();

    // 月目标分解主表
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='MonthlyTargetDecomposition' AND xtype='U')
      CREATE TABLE MonthlyTargetDecomposition (
        id INT IDENTITY(1,1) PRIMARY KEY,
        year INT NOT NULL,
        month INT NOT NULL,
        shopName NVARCHAR(200) NOT NULL,
        districtManager NVARCHAR(100),
        supervisor NVARCHAR(100),
        monthlyTarget INT NOT NULL,
        status NVARCHAR(20) DEFAULT 'active',
        createdBy NVARCHAR(100),
        createdAt DATETIME DEFAULT GETDATE(),
        updatedBy NVARCHAR(100),
        updatedAt DATETIME DEFAULT GETDATE()
      )
    `);

    // 日目标明细表
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='MonthlyTargetDaily' AND xtype='U')
      CREATE TABLE MonthlyTargetDaily (
        id INT IDENTITY(1,1) PRIMARY KEY,
        targetId INT NOT NULL,
        targetDate NVARCHAR(20) NOT NULL,
        year INT NOT NULL,
        month INT NOT NULL,
        dayIndex INT NOT NULL,
        dayOfWeek NVARCHAR(10),
        coefficient FLOAT,
        dailyTarget INT NOT NULL,
        groupName NVARCHAR(20),
        FOREIGN KEY (targetId) REFERENCES MonthlyTargetDecomposition(id) ON DELETE CASCADE
      )
    `);

    // 为已有表补加 targetDate 列
    await pool.request().query(`
      IF EXISTS (SELECT * FROM sysobjects WHERE name='MonthlyTargetDaily' AND xtype='U')
        AND NOT EXISTS (SELECT * FROM syscolumns WHERE id=OBJECT_ID('MonthlyTargetDaily') AND name='targetDate')
      ALTER TABLE MonthlyTargetDaily ADD targetDate NVARCHAR(20) NULL
    `);

    // 变更申请表
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='MonthlyTargetChangeRequest' AND xtype='U')
      CREATE TABLE MonthlyTargetChangeRequest (
        id INT IDENTITY(1,1) PRIMARY KEY,
        targetId INT NOT NULL,
        year INT NOT NULL,
        month INT NOT NULL,
        shopName NVARCHAR(200) NOT NULL,
        districtManager NVARCHAR(100),
        supervisor NVARCHAR(100),
        oldTarget INT,
        newTarget INT NOT NULL,
        reason NVARCHAR(500),
        status NVARCHAR(20) DEFAULT 'pending',
        applicant NVARCHAR(100) NOT NULL,
        applicantGroup NVARCHAR(100),
        applicantRole NVARCHAR(20),
        approver NVARCHAR(100),
        approverRole NVARCHAR(20),
        approvedAt DATETIME,
        approvalComment NVARCHAR(500),
        createdAt DATETIME DEFAULT GETDATE()
      )
    `);

    // 分解比例配置表（前段占比+截止日，可每月调整）
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='MonthlyTargetRatio' AND xtype='U')
      CREATE TABLE MonthlyTargetRatio (
        id INT IDENTITY(1,1) PRIMARY KEY,
        year INT NOT NULL,
        month INT NOT NULL,
        ratio NUMERIC(5,4) NOT NULL DEFAULT 0.6,
        firstEnd INT NOT NULL DEFAULT 15,
        secondEnd INT NOT NULL DEFAULT 26,
        updatedBy NVARCHAR(100),
        updatedAt DATETIME DEFAULT GETDATE(),
        CONSTRAINT UQ_MonthlyRatio UNIQUE (year, month)
      )
    `);
    // 兼容旧表，补加截止日字段
    await pool.request().query(`IF COL_LENGTH('MonthlyTargetRatio','firstEnd') IS NULL ALTER TABLE MonthlyTargetRatio ADD firstEnd INT NOT NULL DEFAULT 15`);
    await pool.request().query(`IF COL_LENGTH('MonthlyTargetRatio','secondEnd') IS NULL ALTER TABLE MonthlyTargetRatio ADD secondEnd INT NOT NULL DEFAULT 26`);

    console.log('MonthlyTarget tables checked/created');
  } catch (err) {
    console.error('Failed to create MonthlyTarget tables:', err);
  }
}

// ============================================================
// 路由
// ============================================================

// GET /api/monthly-target/list — 查询当前用户权限范围内的已分解目标
router.get('/list', async (req, res) => {
  const { year, month, groupName } = req.query;
  if (!year || !month) {
    return res.status(400).json({ error: 'year and month are required' });
  }

  try {
    await ensureTablesExist();
    const pool = await getPool();
    const gn = typeof groupName === 'string' ? groupName : '';

    // 获取用户可见的店铺列表（null=全部可见，[]=无权限）
    const visibleShops = await getStandardVisibleShopNames(pool, gn, req.user);
    if (visibleShops !== null && visibleShops.length === 0) {
      return res.json([]);
    }

    let query = `
      SELECT m.id, m.year, m.month, m.shopName, m.districtManager, m.supervisor,
             m.monthlyTarget, m.status, m.createdBy, m.createdAt, m.updatedBy, m.updatedAt
      FROM MonthlyTargetDecomposition m
      WHERE m.year = @year AND m.month = @month
    `;
    const request = pool.request().input('year', sql.Int, Number(year)).input('month', sql.Int, Number(month));

    // 非管理员：按可见店铺列表过滤
    if (visibleShops && visibleShops.length > 0) {
      const placeholders = visibleShops.map((_, i) => `@shop${i}`);
      visibleShops.forEach((s, i) => request.input(`shop${i}`, sql.NVarChar, s));
      query += ` AND m.shopName IN (${placeholders.join(',')})`;
    }
    // visibleShops 为 null = 管理员 = 不做店铺级过滤

    query += ' ORDER BY m.districtManager, m.supervisor, m.shopName';
    const result = await request.query(query);
    let records = result.recordset;

    // 对非管理员的可见店铺，补充无记录店铺的空占位行
    if (visibleShops && visibleShops.length > 0) {
      const existingShops = new Set(records.map((r: any) => r.shopName));
      for (const shop of visibleShops) {
        if (!existingShops.has(shop)) {
          records.push({
            id: 0, year: Number(year), month: Number(month),
            shopName: shop, districtManager: '', supervisor: '',
            monthlyTarget: 0, status: 'editing', createdBy: '', createdAt: null,
            updatedBy: '', updatedAt: null
          });
        }
      }
    }

    // 变更申请：按同样店铺可见性过滤
    let reqQuery = `SELECT * FROM MonthlyTargetChangeRequest WHERE year = @year2 AND month = @month2`;
    const reqRequest = pool.request()
      .input('year2', sql.Int, Number(year))
      .input('month2', sql.Int, Number(month));
    if (visibleShops && visibleShops.length > 0) {
      const reqPlaceholders = visibleShops.map((_, i) => `@cs${i}`);
      visibleShops.forEach((s, i) => reqRequest.input(`cs${i}`, sql.NVarChar, s));
      reqQuery += ` AND shopName IN (${reqPlaceholders.join(',')})`;
    }
    reqQuery += ' ORDER BY createdAt DESC';
    const reqResult = await reqRequest.query(reqQuery);

    res.json({
      targets: records,
      changeRequests: reqResult.recordset,
    });
  } catch (error: any) {
    console.error('查询月目标分解失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/monthly-target/daily/:targetId — 查询某店铺的日目标明细
router.get('/daily/:targetId', async (req, res) => {
  const targetId = Number(req.params.targetId);
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('targetId', sql.Int, targetId)
      .query('SELECT * FROM MonthlyTargetDaily WHERE targetId = @targetId ORDER BY dayIndex');
    res.json(result.recordset);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/monthly-target/save — 批量保存分解结果
router.post('/save', async (req, res) => {
  const { year, month, items, operator, groupName } = req.body;
  if (!year || !month || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '参数不完整' });
  }

  try {
    await ensureTablesExist();
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      for (const item of items) {
        const { shopName, districtManager, supervisor, monthlyTarget, dailyTargets } = item;

        // 检查是否已存在
        const existing = await new sql.Request(transaction)
          .input('year', sql.Int, year)
          .input('month', sql.Int, month)
          .input('shopName', sql.NVarChar, shopName)
          .query('SELECT id, status FROM MonthlyTargetDecomposition WHERE year=@year AND month=@month AND shopName=@shopName');

        // 导入(daily 空)=待分解 pending，分解(daily 非空)=active
        const hasDailyTargetsStatus = Array.isArray(dailyTargets) && dailyTargets.length > 0 ? 'active' : 'pending';

        let targetId: number;

        if (existing.recordset.length > 0) {
          // 已有月目标 → 复用 id，仅更新日目标（不重复建月）
          targetId = existing.recordset[0].id;
          await new sql.Request(transaction)
            .input('targetId', sql.Int, targetId)
            .query('DELETE FROM MonthlyTargetDaily WHERE targetId=@targetId');
          if (monthlyTarget > 0) {
            await new sql.Request(transaction)
              .input('targetId', sql.Int, targetId)
              .input('monthlyTarget', sql.Int, monthlyTarget)
              .input('status', sql.NVarChar, hasDailyTargetsStatus)
              .input('updatedBy', sql.NVarChar, operator || '')
              .query('UPDATE MonthlyTargetDecomposition SET monthlyTarget=@monthlyTarget, status=@status, updatedBy=@updatedBy, updatedAt=GETDATE() WHERE id=@targetId');
          }
        } else {
          // 新增月目标记录
          const insResult = await new sql.Request(transaction)
            .input('year', sql.Int, year)
            .input('month', sql.Int, month)
            .input('shopName', sql.NVarChar, shopName)
            .input('districtManager', sql.NVarChar, districtManager || '')
            .input('supervisor', sql.NVarChar, supervisor || '')
            .input('monthlyTarget', sql.Int, monthlyTarget)
            .input('status', sql.NVarChar, hasDailyTargetsStatus)
            .input('createdBy', sql.NVarChar, operator || '')
            .query(`INSERT INTO MonthlyTargetDecomposition (year, month, shopName, districtManager, supervisor, monthlyTarget, status, createdBy)
              VALUES (@year, @month, @shopName, @districtManager, @supervisor, @monthlyTarget, @status, @createdBy); SELECT SCOPE_IDENTITY() AS id;`);
          targetId = insResult.recordset[0].id;
        }

        // 插入日明细
        const dailies = dailyTargets || [];
        for (const d of dailies) {
          await new sql.Request(transaction)
            .input('targetId', sql.Int, targetId)
            .input('targetDate', sql.NVarChar, `${year}-${month}-${d.dayIndex}`)
            .input('year', sql.Int, year)
            .input('month', sql.Int, month)
            .input('dayIndex', sql.Int, d.dayIndex)
            .input('dayOfWeek', sql.NVarChar, d.dayOfWeek)
            .input('coefficient', sql.Float, d.coefficient)
            .input('dailyTarget', sql.Int, d.target)
            .input('groupName', sql.NVarChar, d.group)
            .query(`INSERT INTO MonthlyTargetDaily (targetId, targetDate, year, month, dayIndex, dayOfWeek, coefficient, dailyTarget, groupName)
                    VALUES (@targetId, @targetDate, @year, @month, @dayIndex, @dayOfWeek, @coefficient, @dailyTarget, @groupName)`);
        }
      }

      await transaction.commit();
      res.json({ success: true, message: `成功保存 ${items.length} 个店铺的月目标分解` });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (error: any) {
    console.error('保存月目标分解失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/monthly-target/clear — 清空某年某月的目标分解（仅区经/管理员）
router.post('/clear', async (req, res) => {
  const { year, month, operator, groupName } = req.body;
  if (!year || !month) {
    return res.status(400).json({ error: 'year and month are required' });
  }

  const gn = typeof groupName === 'string' ? groupName : '';

  try {
    await ensureTablesExist();
    const pool = await getPool();

    const userRole = await getUserGroupRole(pool, gn, req.user);
    if (!isDirectorGroup(gn) && userRole !== 'admin' && userRole !== 'districtManager') {
      return res.status(403).json({ error: '只有区经或管理员可以清空月目标' });
    }

    const visibleShops = await getStandardVisibleShopNames(pool, gn, req.user);
    const request = pool.request()
      .input('year', sql.Int, Number(year))
      .input('month', sql.Int, Number(month));

    let shopFilter = '';
    if (visibleShops && visibleShops.length > 0) {
      const places = visibleShops.map((_, i) => `@cl${i}`);
      visibleShops.forEach((s, i) => request.input(`cl${i}`, sql.NVarChar, s));
      shopFilter = ` AND shopName IN (${places.join(',')})`;
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      await request.query(`DELETE FROM MonthlyTargetChangeRequest WHERE year=@year AND month=@month ${shopFilter}`);
      await request.query(`DELETE FROM MonthlyTargetDecomposition WHERE year=@year AND month=@month ${shopFilter}`);
      await transaction.commit();
      res.json({ success: true, message: `已清空 ${Number(year)}年${Number(month)}月 的目标分解` });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (error: any) {
    console.error('清空月目标失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/monthly-target/change-request — 提交变更申请
router.post('/change-request', async (req, res) => {
  const { targetId, year, month, shopName, districtManager, supervisor, oldTarget, newTarget, reason, applicant, applicantGroup } = req.body;

  if (!shopName || !newTarget || !applicant) {
    return res.status(400).json({ error: '参数不完整' });
  }

  try {
    await ensureTablesExist();
    const pool = await getPool();

    // 一个店一个月只能有一条进行中/已通过的变更申请，避免重复提交
    const dupCheck = await pool.request()
      .input('year', sql.Int, Number(year))
      .input('month', sql.Int, Number(month))
      .input('shopName', sql.NVarChar, shopName)
      .query(`SELECT id, status FROM MonthlyTargetChangeRequest WHERE year=@year AND month=@month AND shopName=@shopName AND status IN ('pending','approved')`);
    if (dupCheck.recordset.length > 0) {
      return res.status(409).json({ error: '该店铺本月已存在进行中或已通过的变更申请，不能重复申请' });
    }

    // 用户组列已删除，申请人角色按标准角色体系判定（super_admin/data_admin→admin；区经/运营总→districtManager；其余→supervisor）
    const role = await getUserGroupRole(pool, '', req.user);

    const result = await pool.request()
      .input('targetId', sql.Int, targetId || 0)
      .input('year', sql.Int, year)
      .input('month', sql.Int, month)
      .input('shopName', sql.NVarChar, shopName)
      .input('districtManager', sql.NVarChar, districtManager || '')
      .input('supervisor', sql.NVarChar, supervisor || '')
      .input('oldTarget', sql.Int, oldTarget || 0)
      .input('newTarget', sql.Int, newTarget)
      .input('reason', sql.NVarChar, reason || '')
      .input('status', sql.NVarChar, 'pending')
      .input('applicant', sql.NVarChar, applicant)
      .input('applicantGroup', sql.NVarChar, applicantGroup || '')
      .input('applicantRole', sql.NVarChar, role)
      .query(`INSERT INTO MonthlyTargetChangeRequest (targetId, year, month, shopName, districtManager, supervisor, oldTarget, newTarget, reason, status, applicant, applicantGroup, applicantRole)
              VALUES (@targetId, @year, @month, @shopName, @districtManager, @supervisor, @oldTarget, @newTarget, @reason, @status, @applicant, @applicantGroup, @applicantRole);
              SELECT SCOPE_IDENTITY() AS id;`);

    // 将原目标标记为 pending_change
    if (targetId) {
      await pool.request()
        .input('targetId', sql.Int, targetId)
        .query(`UPDATE MonthlyTargetDecomposition SET status='pending_change' WHERE id=@targetId`);
    }

    res.json({ success: true, requestId: result.recordset[0].id, message: '变更申请已提交，等待区经/管理员审批' });
  } catch (error: any) {
    console.error('提交变更申请失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/monthly-target/approve — 审批变更申请
router.post('/approve', async (req, res) => {
  const { requestId, action, approver, approverGroup, comment, newDailyTargets } = req.body;

  if (!requestId || !action || !approver) {
    return res.status(400).json({ error: '参数不完整' });
  }

  if (action !== 'approve' && action !== 'reject') {
    return res.status(400).json({ error: 'action 必须是 approve 或 reject' });
  }

  try {
    await ensureTablesExist();
    const pool = await getPool();
    const gn = approverGroup || '';
    const approveRole = await getUserGroupRole(pool, gn, req.user);
    if (!isDirectorGroup(gn) && approveRole !== 'admin' && approveRole !== 'districtManager') {
      return res.status(403).json({ error: '只有区经或管理员可以审批变更申请' });
    }

    // 查询申请详情
    const reqResult = await pool.request()
      .input('requestId', sql.Int, requestId)
      .query(`SELECT * FROM MonthlyTargetChangeRequest WHERE id=@requestId AND status='pending'`);
    if (reqResult.recordset.length === 0) {
      return res.status(404).json({ error: '未找到待审批的变更申请' });
    }
    const reqData = reqResult.recordset[0];

    // 审批人可见店铺检查
    const visibleShops = await getStandardVisibleShopNames(pool, gn, req.user);
    if (visibleShops !== null && !visibleShops.includes(reqData.shopName)) {
      return res.status(403).json({ error: '您没有权限审批该店铺的变更申请' });
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    const approverRole = approveRole;

    try {
      // 更新申请状态
      await new sql.Request(transaction)
        .input('requestId', sql.Int, requestId)
        .input('status', sql.NVarChar, action === 'approve' ? 'approved' : 'rejected')
        .input('approver', sql.NVarChar, approver)
        .input('approverRole', sql.NVarChar, approverRole)
        .input('comment', sql.NVarChar, comment || '')
        .input('approvedAt', sql.DateTime, new Date())
        .query(`UPDATE MonthlyTargetChangeRequest SET status=@status, approver=@approver, approverRole=@approverRole, approvalComment=@comment, approvedAt=@approvedAt WHERE id=@requestId`);

      if (action === 'approve') {
        // 审批通过：更新目标金额和日明细
        if (reqData.targetId) {
          await new sql.Request(transaction)
            .input('targetId', sql.Int, reqData.targetId)
            .input('monthlyTarget', sql.Int, reqData.newTarget)
            .input('updatedBy', sql.NVarChar, approver)
            .query(`UPDATE MonthlyTargetDecomposition SET monthlyTarget=@monthlyTarget, status='active', updatedBy=@updatedBy, updatedAt=GETDATE() WHERE id=@targetId`);

          // 删除旧日明细
          await new sql.Request(transaction)
            .input('targetId', sql.Int, reqData.targetId)
            .query('DELETE FROM MonthlyTargetDaily WHERE targetId=@targetId');

          // 插入新日明细
          if (Array.isArray(newDailyTargets)) {
            for (const d of newDailyTargets) {
              await new sql.Request(transaction)
                .input('targetId', sql.Int, reqData.targetId)
                .input('targetDate', sql.NVarChar, `${reqData.year}-${reqData.month}-${d.dayIndex}`)
                .input('year', sql.Int, reqData.year)
                .input('month', sql.Int, reqData.month)
                .input('dayIndex', sql.Int, d.dayIndex)
                .input('dayOfWeek', sql.NVarChar, d.dayOfWeek)
                .input('coefficient', sql.Float, d.coefficient)
                .input('dailyTarget', sql.Int, d.target)
                .input('groupName', sql.NVarChar, d.group)
                .query(`INSERT INTO MonthlyTargetDaily (targetId, targetDate, year, month, dayIndex, dayOfWeek, coefficient, dailyTarget, groupName)
                        VALUES (@targetId, @targetDate, @year, @month, @dayIndex, @dayOfWeek, @coefficient, @dailyTarget, @groupName)`);
            }
          }
        }
      } else {
        // 驳回：恢复目标状态为 active
        if (reqData.targetId) {
          await new sql.Request(transaction)
            .input('targetId', sql.Int, reqData.targetId)
            .query(`UPDATE MonthlyTargetDecomposition SET status='active' WHERE id=@targetId`);
        }
      }

      await transaction.commit();

      // 审批通过后，企业微信推送指定人员（马曼丽）
      if (action === 'approve') {
        void (async () => {
          try {
            const pushSettings = await getSettings();
            const notifyContent = [
              '【月目标指标变更通知】',
              `店铺：${reqData.shopName}`,
              `月份：${reqData.year}年${reqData.month}月`,
              `指标金额：${reqData.oldTarget} → ${reqData.newTarget}`,
              `审批人：${approver}`,
              `审批结果：已通过`,
            ].join('\n');
            const pushResult = await pushToSingleRecipient(pushSettings, 'MaManLi', notifyContent);
            if (!pushResult.success) {
              console.warn('[monthlyTarget] 审批通过通知推送失败:', pushResult.error);
            }
          } catch (pushErr) {
            console.warn('[monthlyTarget] 审批通过通知推送异常:', (pushErr as Error).message);
          }
        })();
      }

      res.json({ success: true, message: action === 'approve' ? '变更申请已通过' : '变更申请已驳回' });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (error: any) {
    console.error('审批变更申请失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/monthly-target/daily-targets — 按日期范围查询日目标汇总（供销售报表用）
router.get('/daily-targets', async (req, res) => {
  const { startDate, endDate, groupName, shopNames } = req.query;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required' });
  }

  try {
    await ensureTablesExist();
    const pool = await getPool();
    const gn = typeof groupName === 'string' ? groupName : '';
    const visibleShops = await getStandardVisibleShopNames(pool, gn, req.user);
    if (visibleShops !== null && visibleShops.length === 0) {
      return res.json([]);
    }

    let query = `
      SELECT d.shopName, SUM(m.dailyTarget) AS totalTarget
      FROM MonthlyTargetDaily m
      INNER JOIN MonthlyTargetDecomposition d ON m.targetId = d.id
      WHERE d.status = 'active'
        AND CONVERT(date, m.targetDate) >= CONVERT(date, @startDate) AND CONVERT(date, m.targetDate) <= CONVERT(date, @endDate)
    `;

    const request = pool.request()
      .input('startDate', sql.NVarChar, startDate as string)
      .input('endDate', sql.NVarChar, endDate as string);

    // 优先用传入的 shopNames，否则用可见店铺
    if (typeof shopNames === 'string' && shopNames) {
      const names = shopNames.split(',').map(n => n.trim()).filter(Boolean);
      if (names.length > 0) {
        const ph = names.map((_, i) => `@sn${i}`);
        names.forEach((n, i) => request.input(`sn${i}`, sql.NVarChar, n));
        query += ` AND d.shopName IN (${ph.join(',')})`;
      }
    } else if (visibleShops && visibleShops.length > 0) {
      const ph = visibleShops.map((_, i) => `@vs${i}`);
      visibleShops.forEach((s, i) => request.input(`vs${i}`, sql.NVarChar, s));
      query += ` AND d.shopName IN (${ph.join(',')})`;
    }

    query += ' GROUP BY d.shopName ORDER BY d.shopName';
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (error: any) {
    console.error('查询日目标汇总失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/monthly-target/change-requests
router.get('/change-requests', async (req, res) => {
  const { year, month, groupName, status } = req.query;
  try {
    await ensureTablesExist();
    const pool = await getPool();
    const visibleShops = await getStandardVisibleShopNames(pool, groupName as string, req.user);
    if (visibleShops !== null && visibleShops.length === 0) {
      return res.json([]);
    }

    let query = 'SELECT * FROM MonthlyTargetChangeRequest WHERE 1=1';
    const request = pool.request();

    if (year) { query += ' AND year=@year'; request.input('year', sql.Int, Number(year)); }
    if (month) { query += ' AND month=@month'; request.input('month', sql.Int, Number(month)); }
    if (status) { query += ' AND status=@status'; request.input('status', sql.NVarChar, status); }
    if (visibleShops && visibleShops.length > 0) {
      const places = visibleShops.map((_, i) => `@rq${i}`);
      visibleShops.forEach((s, i) => request.input(`rq${i}`, sql.NVarChar, s));
      query += ` AND shopName IN (${places.join(',')})`;
    }

    query += ' ORDER BY createdAt DESC';
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/monthly-target/ratio — 查询某年月的分解配置（前段占比+截止日）
router.get('/ratio', async (req, res) => {
  const { year, month } = req.query;
  if (!year || !month) return res.status(400).json({ error: 'year and month are required' });
  try {
    await ensureTablesExist();
    const pool = await getPool();
    const result = await pool.request()
      .input('year', sql.Int, Number(year))
      .input('month', sql.Int, Number(month))
      .query('SELECT ratio, firstEnd, secondEnd FROM MonthlyTargetRatio WHERE year=@year AND month=@month');
    if (result.recordset.length > 0) {
      const row = result.recordset[0];
      res.json({ ratio: Number(row.ratio), firstEnd: Number(row.firstEnd), secondEnd: Number(row.secondEnd) });
    } else {
      res.json({ ratio: 0.6, firstEnd: 15, secondEnd: 26 });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/monthly-target/ratio — 保存某年月的比例（前段占比+截止日）
router.post('/ratio', async (req, res) => {
  const { year, month, ratio, firstEnd, secondEnd } = req.body;
  if (!year || !month) return res.status(400).json({ error: 'year and month are required' });
  let r = Number(ratio);
  if (isNaN(r) || r <= 0 || r >= 1) r = 0.6;
  let fe = Number(firstEnd);
  if (isNaN(fe) || fe < 1) fe = 15;
  let se = Number(secondEnd);
  if (isNaN(se) || se < fe + 1) se = fe + 1;
  try {
    await ensureTablesExist();
    const pool = await getPool();
    const existing = await pool.request()
      .input('year', sql.Int, Number(year)).input('month', sql.Int, Number(month))
      .query('SELECT id FROM MonthlyTargetRatio WHERE year=@year AND month=@month');
    if (existing.recordset.length > 0) {
      await pool.request()
        .input('year', sql.Int, Number(year)).input('month', sql.Int, Number(month))
        .input('ratio', sql.Float, r)
        .input('firstEnd', sql.Int, fe)
        .input('secondEnd', sql.Int, se)
        .query("UPDATE MonthlyTargetRatio SET ratio=@ratio, firstEnd=@firstEnd, secondEnd=@secondEnd, updatedAt=GETDATE() WHERE year=@year AND month=@month");
    } else {
      await pool.request()
        .input('year', sql.Int, Number(year)).input('month', sql.Int, Number(month))
        .input('ratio', sql.Float, r)
        .input('firstEnd', sql.Int, fe)
        .input('secondEnd', sql.Int, se)
        .query("INSERT INTO MonthlyTargetRatio (year, month, ratio, firstEnd, secondEnd) VALUES (@year, @month, @ratio, @firstEnd, @secondEnd)");
    }
    res.json({ success: true, ratio: r, firstEnd: fe, secondEnd: se });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
