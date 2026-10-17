import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { getStandardVisibleShopNames, getUserGroupRole } from '../services/permissionService';

import { JwtUserPayload } from '../services/jwt';

const router = Router();

// 判断请求人是否属于"领导"（可审批店员目标变更：管理/区经/总监）
// 用户组列已删除：按标准角色体系判定，groupName 旧逻辑仅作兼容参考
async function isAuthorizedLeader(pool: sql.ConnectionPool, groupName: string, user?: JwtUserPayload | null): Promise<boolean> {
  const gn = (typeof groupName === 'string' ? groupName : '').trim();
  const role = await getUserGroupRole(pool, gn, user);
  if (role === 'admin' || role === 'districtManager') return true;
  return /管理|总监|总|经理|区经/.test(gn);
}

async function ensureTablesExist(pool: sql.ConnectionPool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'StaffMonthlyTarget')
    CREATE TABLE StaffMonthlyTarget (
      id INT IDENTITY(1,1) PRIMARY KEY,
      year INT NOT NULL,
      month INT NOT NULL,
      shopName NVARCHAR(200) NOT NULL,
      districtManager NVARCHAR(100),
      supervisor NVARCHAR(100),
      staffName NVARCHAR(100) NOT NULL,
      monthlyTarget INT NOT NULL DEFAULT 0,
      status NVARCHAR(20) DEFAULT 'active',
      createdBy NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE()
    )
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'StaffMonthlyTargetDaily')
    CREATE TABLE StaffMonthlyTargetDaily (
      id INT IDENTITY(1,1) PRIMARY KEY,
      targetId INT NOT NULL,
      targetDate NVARCHAR(20),
      year INT NOT NULL,
      month INT NOT NULL,
      dayIndex INT NOT NULL,
      dayOfWeek NVARCHAR(10),
      coefficient FLOAT,
      dailyTarget INT NOT NULL,
      groupName NVARCHAR(20),
      FOREIGN KEY (targetId) REFERENCES StaffMonthlyTarget(id) ON DELETE CASCADE
    )
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'StaffMonthlyTargetChangeRequest')
    CREATE TABLE StaffMonthlyTargetChangeRequest (
      id INT IDENTITY(1,1) PRIMARY KEY,
      targetId INT,
      year INT NOT NULL,
      month INT NOT NULL,
      shopName NVARCHAR(200) NOT NULL,
      districtManager NVARCHAR(100),
      supervisor NVARCHAR(100),
      staffName NVARCHAR(100) NOT NULL,
      oldTarget INT,
      newTarget INT NOT NULL,
      reason NVARCHAR(500),
      status NVARCHAR(20) DEFAULT 'pending',
      applicant NVARCHAR(100) NOT NULL,
      applicantGroup NVARCHAR(100),
      applicantRole NVARCHAR(20),
      approver NVARCHAR(100),
      approverRole NVARCHAR(20),
      approvalComment NVARCHAR(500),
      approvedAt DATETIME,
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);
}

// 读取该年月的分解配置（与「月目标分解」的 MonthlyTargetRatio 保持一致），取不到则用默认 60% / 15号 / 26号
async function loadTargetRatio(year: number, month: number): Promise<{ ratio: number; firstEnd: number; secondEnd: number }> {
  try {
    const pool = await getPool();
    const res = await pool.request()
      .input('y', sql.Int, year).input('m', sql.Int, month)
      .query(`SELECT ratio, firstEnd, secondEnd FROM MonthlyTargetRatio WHERE year=@y AND month=@m`);
    if (res.recordset.length > 0) {
      const r = res.recordset[0];
      return {
        ratio: Number(r.ratio) || 0.6,
        firstEnd: Number(r.firstEnd) || 15,
        secondEnd: Number(r.secondEnd) || 26,
      };
    }
  } catch { /* ignore */ }
  return { ratio: 0.6, firstEnd: 15, secondEnd: 26 };
}

function decomposeMonthlyTarget(monthlyTarget: number, year: number, month: number, coefficients?: Record<string, number>, cfg?: { ratio?: number; firstEnd?: number; secondEnd?: number }) {
  const defaultCoeffs: Record<string, number> = { '周一': 1.0, '周二': 1.0, '周三': 1.0, '周四': 1.0, '周五': 1.1, '周六': 1.5, '周日': 1.2 };
  const coeffs = coefficients || defaultCoeffs;
  const ratio = Math.max(0.01, Math.min(0.99, cfg?.ratio ?? 0.6));
  const firstEnd = Math.min(Math.max(1, Math.floor(cfg?.firstEnd ?? 15)), 30);
  const secondEnd = Math.min(Math.max(firstEnd + 1, Math.floor(cfg?.secondEnd ?? 26)), 31);
  const dim = new Date(year, month, 0).getDate();
  const weekDayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const days: { date: string; dayOfWeek: string; dayIndex: number; coefficient: number }[] = [];
  for (let d = 1; d <= dim; d++) {
    const dt = new Date(year, month - 1, d);
    const dow = weekDayNames[dt.getDay()];
    days.push({ date: `${year}-${month}-${d}`, dayOfWeek: dow, dayIndex: d, coefficient: coeffs[dow] || 1.0 });
  }
  const firstSeg = days.filter(d => d.dayIndex <= firstEnd);
  const middle = days.filter(d => d.dayIndex > firstEnd && d.dayIndex <= secondEnd);
  const last = days.filter(d => d.dayIndex > secondEnd);
  const result: { date: string; dayOfWeek: string; dayIndex: number; coefficient: number; dailyTarget: number; groupName: string }[] = [];
  const allocate = (seg: typeof days, totalWeight: number, groupName: string, segRatio: number) => {
    const segTotal = monthlyTarget * segRatio;
    let allocated = 0;
    const weighted = seg.map(d => ({ ...d, weight: d.coefficient * segTotal / totalWeight }));
    weighted.forEach((d, i) => {
      const v = i < weighted.length - 1 ? Math.round(d.weight) : Math.round(segTotal - allocated);
      allocated += v;
      result.push({ ...d, dailyTarget: v, groupName });
    });
  };
  const fWeight = firstSeg.reduce((s, d) => s + d.coefficient, 0);
  const mWeight = middle.reduce((s, d) => s + d.coefficient, 0);
  if (fWeight > 0) allocate(firstSeg, fWeight, 'first15', ratio);
  if (mWeight > 0) allocate(middle, mWeight, 'middle', 1 - ratio);
  last.forEach(d => result.push({ ...d, dailyTarget: 0, groupName: 'last2' }));
  return result.sort((a, b) => a.dayIndex - b.dayIndex);
}

// GET /api/staff-monthly-target/list
router.get('/list', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTablesExist(pool);
    const { year, month, groupName } = req.query;
    const y = parseInt(year as string) || new Date().getFullYear();
    const m = parseInt(month as string) || (new Date().getMonth() + 1);
    const gn = typeof groupName === 'string' ? groupName : '';
    const visibleShops = await getStandardVisibleShopNames(pool, gn, req.user);
    if (visibleShops !== null && visibleShops.length === 0) {
      return res.json([]);
    }
    let query = `SELECT * FROM StaffMonthlyTarget WHERE year = @year AND month = @month`;
    if (visibleShops && visibleShops.length > 0) {
      const shopList = visibleShops.map(s => `'${s}'`).join(',');
      query += ` AND shopName IN (${shopList})`;
    }
    query += ` ORDER BY districtManager, supervisor, shopName, staffName`;
    const result = await pool.request()
      .input('year', sql.Int, y)
      .input('month', sql.Int, m)
      .query(query);

    // 变更申请：按同样店铺可见性过滤
    let reqQuery = `SELECT * FROM StaffMonthlyTargetChangeRequest WHERE year = @ry AND month = @rm`;
    const reqRequest = pool.request()
      .input('ry', sql.Int, y)
      .input('rm', sql.Int, m);
    if (visibleShops && visibleShops.length > 0) {
      const shopList = visibleShops.map(s => `'${s}'`).join(',');
      reqQuery += ` AND shopName IN (${shopList})`;
    }
    reqQuery += ' ORDER BY createdAt DESC';
    const reqResult = await reqRequest.query(reqQuery);

    res.json({ targets: result.recordset, changeRequests: reqResult.recordset });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/staff-monthly-target/daily/:targetId
router.get('/daily/:targetId', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTablesExist(pool);
    const result = await pool.request()
      .input('tid', sql.Int, parseInt(req.params.targetId))
      .query('SELECT * FROM StaffMonthlyTargetDaily WHERE targetId = @tid ORDER BY dayIndex');
    res.json(result.recordset);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/staff-monthly-target/staff-list - 获取店员列表（从有效业绩全提取）
router.get('/staff-list', async (req, res) => {
  try {
    const pool = await getPool();
    const { groupName } = req.query;
    const gn = typeof groupName === 'string' ? groupName : '';
    const visibleShops = await getStandardVisibleShopNames(pool, gn, req.user);
    if (visibleShops !== null && visibleShops.length === 0) {
      return res.json([]);
    }
    let query = `SELECT 店铺名称 as shopName, ISNULL(店员名称,'') as staffName FROM 有效业绩全 WHERE ISNULL(店员名称,'') <> '' AND 仓库类别 IN ('直营','山东直营','加盟')`;
    if (visibleShops && visibleShops.length > 0) {
      const shopList = visibleShops.map(s => `'${s}'`).join(',');
      query += ` AND 店铺名称 IN (${shopList})`;
    }
    query += ` GROUP BY 店铺名称, ISNULL(店员名称,'') ORDER BY 店铺名称`;
    const result = await pool.request().query(query);
    res.json(result.recordset);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/staff-monthly-target/last-month-staff - 上月有销售的店员明细（供下载模板预填）
router.get('/last-month-staff', async (req, res) => {
  try {
    const pool = await getPool();
    const { year, month, groupName } = req.query;
    let y = parseInt(year as string) || new Date().getFullYear();
    let m = parseInt(month as string) || (new Date().getMonth() + 1);
    m -= 1;
    if (m < 1) { m = 12; y -= 1; }
    const gn = typeof groupName === 'string' ? groupName : '';
    const visibleShops = await getStandardVisibleShopNames(pool, gn, req.user);
    if (visibleShops !== null && visibleShops.length === 0) {
      return res.json([]);
    }
    let query = `SELECT 店铺名称 as shopName, ISNULL(店员名称,'') as staffName
      FROM 有效业绩全
      WHERE YEAR(日期)=@y AND MONTH(日期)=@m AND ISNULL(店员名称,'') <> ''
        AND 仓库类别 IN ('直营','山东直营','加盟')`;
    if (visibleShops && visibleShops.length > 0) {
      const shopList = visibleShops.map(s => `'${s}'`).join(',');
      query += ` AND 店铺名称 IN (${shopList})`;
    }
    query += ` GROUP BY 店铺名称, ISNULL(店员名称,'') ORDER BY 店铺名称, ISNULL(店员名称,'')`;
    const result = await pool.request()
      .input('y', sql.Int, y).input('m', sql.Int, m)
      .query(query);
    res.json(result.recordset);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/staff-monthly-target/save
router.post('/save', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTablesExist(pool);
    const { year, month, items, operator, groupName } = req.body;
    const gn = typeof groupName === 'string' ? groupName : '';
    const visibleShops = await getStandardVisibleShopNames(pool, gn, req.user);
    const ratioCfg = await loadTargetRatio(year, month);
    const t = pool.transaction();
    await t.begin();
    for (const item of items || []) {
      if (!item.shopName || !item.staffName) continue;
      if (visibleShops !== null && !visibleShops.includes(item.shopName)) continue;
      // 检查是否已存在：存在则更新月目标并重建日明细（确保重新导入可刷新切分）
      const existCheck = await t.request()
        .input('y', sql.Int, year).input('m', sql.Int, month)
        .input('sn', sql.NVarChar, item.shopName).input('sf', sql.NVarChar, item.staffName)
        .query(`SELECT id FROM StaffMonthlyTarget WHERE year=@y AND month=@m AND shopName=@sn AND staffName=@sf`);
      let targetId: number;
      if (existCheck.recordset.length > 0) {
        targetId = existCheck.recordset[0].id;
        await t.request()
          .input('tid', sql.Int, targetId).input('mt', sql.Int, item.monthlyTarget || 0)
          .input('dm', sql.NVarChar, item.districtManager || '').input('sv', sql.NVarChar, item.supervisor || '')
          .input('st', sql.NVarChar, item.status || 'active')
          .query(`UPDATE StaffMonthlyTarget SET monthlyTarget=@mt, districtManager=@dm, supervisor=@sv, status=@st, updatedAt=GETDATE() WHERE id=@tid`);
        // 删除旧日明细再重建
        await t.request().input('tid', sql.Int, targetId).query('DELETE FROM StaffMonthlyTargetDaily WHERE targetId=@tid');
      } else {
        const targetResult = await t.request()
          .input('y', sql.Int, year).input('m', sql.Int, month)
          .input('sn', sql.NVarChar, item.shopName).input('dm', sql.NVarChar, item.districtManager || '')
          .input('sv', sql.NVarChar, item.supervisor || '').input('sf', sql.NVarChar, item.staffName)
          .input('mt', sql.Int, item.monthlyTarget || 0).input('st', sql.NVarChar, item.status || 'active')
          .input('cb', sql.NVarChar, operator || '')
          .query(`INSERT INTO StaffMonthlyTarget (year, month, shopName, districtManager, supervisor, staffName, monthlyTarget, status, createdBy)
            OUTPUT INSERTED.id VALUES (@y, @m, @sn, @dm, @sv, @sf, @mt, @st, @cb)`);
        targetId = targetResult.recordset[0].id;
      }
      // 写入每日明细（与「月目标分解」一致的占比/截止日）
      const dailies = decomposeMonthlyTarget(item.monthlyTarget || 0, year, month, undefined, ratioCfg);
      for (const d of dailies) {
        await t.request()
          .input('tid', sql.Int, targetId).input('td', sql.NVarChar, d.date)
          .input('y', sql.Int, year).input('m', sql.Int, month)
          .input('di', sql.Int, d.dayIndex).input('dw', sql.NVarChar, d.dayOfWeek)
          .input('co', sql.Float, d.coefficient).input('dt', sql.Int, d.dailyTarget)
          .input('gn', sql.NVarChar, d.groupName)
          .query(`INSERT INTO StaffMonthlyTargetDaily (targetId, targetDate, year, month, dayIndex, dayOfWeek, coefficient, dailyTarget, groupName)
            VALUES (@tid, @td, @y, @m, @di, @dw, @co, @dt, @gn)`);
      }
    }
    await t.commit();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/staff-monthly-target/daily-targets - 聚合日指标（供店员销售指标使用）
router.get('/daily-targets', async (req, res) => {
  try {
    const pool = await getPool();
    const { startDate, endDate, groupName } = req.query;
    const gn = typeof groupName === 'string' ? groupName : '';
    const visibleShops = await getStandardVisibleShopNames(pool, gn, req.user);
    if (visibleShops !== null && visibleShops.length === 0) {
      return res.json({});
    }
    let query = `SELECT t.shopName, t.staffName, SUM(d.dailyTarget) as target
      FROM StaffMonthlyTargetDaily d
      INNER JOIN StaffMonthlyTarget t ON d.targetId = t.id
      WHERE t.status = 'active'
        AND CONVERT(date, d.targetDate) >= CONVERT(date, @startDate)
        AND CONVERT(date, d.targetDate) <= CONVERT(date, @endDate)`;
    if (visibleShops && visibleShops.length > 0) {
      const shopList = visibleShops.map(s => `'${s}'`).join(',');
      query += ` AND t.shopName IN (${shopList})`;
    }
    query += ` GROUP BY t.shopName, t.staffName`;
    const result = await pool.request()
      .input('startDate', sql.NVarChar, startDate as string)
      .input('endDate', sql.NVarChar, endDate as string)
      .query(query);
    const map: Record<string, number> = {};
    result.recordset.forEach((r: any) => { map[`${r.shopName.trim()}|${r.staffName.trim()}`] = Math.round(r.target || 0); });
    res.json(map);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/staff-monthly-target/clear
router.post('/clear', async (req, res) => {
  try {
    const pool = await getPool();
    const { year, month, groupName } = req.body;
    const gn = typeof groupName === 'string' ? groupName : '';
    const visibleShops = await getStandardVisibleShopNames(pool, gn, req.user);
    if (visibleShops !== null && visibleShops.length === 0) {
      return res.json({ success: true, message: '无权限清空' });
    }
    if (visibleShops && visibleShops.length > 0) {
      const shopList = visibleShops.map(s => `'${s}'`).join(',');
      await pool.request().input('y', sql.Int, year).input('m', sql.Int, month)
        .query(`DELETE FROM StaffMonthlyTarget WHERE year=@y AND month=@m AND shopName IN (${shopList})`);
    } else {
      await pool.request().input('y', sql.Int, year).input('m', sql.Int, month)
        .query(`DELETE FROM StaffMonthlyTarget WHERE year=@y AND month=@m`);
    }
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/staff-monthly-target/change-request - 提交店员目标变更申请（任何登录用户）
router.post('/change-request', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTablesExist(pool);
    const { targetId, year, month, shopName, staffName, districtManager, supervisor, oldTarget, newTarget, reason, applicant, applicantGroup } = req.body;

    if (!shopName || !staffName || !newTarget || !applicant) {
      return res.status(400).json({ error: '参数不完整' });
    }

    // 同一店员一个月只能有一条进行中/已通过的申请，避免重复提交
    const dupCheck = await pool.request()
      .input('y', sql.Int, Number(year)).input('m', sql.Int, Number(month))
      .input('sn', sql.NVarChar, shopName).input('sf', sql.NVarChar, staffName)
      .query(`SELECT id FROM StaffMonthlyTargetChangeRequest WHERE year=@y AND month=@m AND shopName=@sn AND staffName=@sf AND status IN ('pending','approved')`);
    if (dupCheck.recordset.length > 0) {
      return res.status(409).json({ message: '该店员本月已存在进行中或已通过的变更申请，不能重复申请' });
    }

    const gn = typeof applicantGroup === 'string' ? applicantGroup : '';
    const role = await getUserGroupRole(pool, gn, req.user);

    const result = await pool.request()
      .input('tid', sql.Int, targetId || 0)
      .input('y', sql.Int, Number(year)).input('m', sql.Int, Number(month))
      .input('sn', sql.NVarChar, shopName).input('dm', sql.NVarChar, districtManager || '')
      .input('sv', sql.NVarChar, supervisor || '').input('sf', sql.NVarChar, staffName)
      .input('oldT', sql.Int, oldTarget || 0).input('newT', sql.Int, newTarget)
      .input('reason', sql.NVarChar, reason || '')
      .input('ap', sql.NVarChar, applicant).input('ag', sql.NVarChar, gn).input('ar', sql.NVarChar, role)
      .query(`INSERT INTO StaffMonthlyTargetChangeRequest (targetId, year, month, shopName, districtManager, supervisor, staffName, oldTarget, newTarget, reason, status, applicant, applicantGroup, applicantRole)
        VALUES (@tid, @y, @m, @sn, @dm, @sv, @sf, @oldT, @newT, @reason, 'pending', @ap, @ag, @ar)`);

    // 将原目标标记为 pending_change
    if (targetId) {
      await pool.request()
        .input('tid', sql.Int, targetId)
        .query(`UPDATE StaffMonthlyTarget SET status='pending_change' WHERE id=@tid`);
    }

    res.json({ success: true, message: '变更申请已提交，等待领导审批' });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

// POST /api/staff-monthly-target/approve - 领导审批变更申请
router.post('/approve', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTablesExist(pool);
    const { requestId, action, approver, approverGroup, comment } = req.body;

    if (!requestId || !action || !approver) {
      return res.status(400).json({ message: '参数不完整' });
    }
    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({ message: 'action 必须是 approve 或 reject' });
    }

    const gn = typeof approverGroup === 'string' ? approverGroup : '';
    const approveRole = await getUserGroupRole(pool, gn, req.user);
    if (!(await isAuthorizedLeader(pool, gn, req.user))) {
      return res.status(403).json({ message: '只有领导（管理/区经/总监）可以审批变更申请' });
    }

    // 查询申请详情
    const reqResult = await pool.request()
      .input('rid', sql.Int, requestId)
      .query(`SELECT * FROM StaffMonthlyTargetChangeRequest WHERE id=@rid AND status='pending'`);
    if (reqResult.recordset.length === 0) {
      return res.status(404).json({ message: '未找到待审批的变更申请' });
    }
    const reqData = reqResult.recordset[0];

    // 审批人可见店铺检查
    const visibleShops = await getStandardVisibleShopNames(pool, gn, req.user);
    if (visibleShops !== null && !visibleShops.includes(reqData.shopName)) {
      return res.status(403).json({ message: '您没有权限审批该店铺的变更申请' });
    }

    const t = pool.transaction();
    await t.begin();
    try {
      // 更新申请状态
      await t.request()
        .input('rid', sql.Int, requestId)
        .input('status', sql.NVarChar, action === 'approve' ? 'approved' : 'rejected')
        .input('ap', sql.NVarChar, approver).input('ar', sql.NVarChar, approveRole)
        .input('cm', sql.NVarChar, comment || '').input('at', sql.DateTime, new Date())
        .query(`UPDATE StaffMonthlyTargetChangeRequest SET status=@status, approver=@ap, approverRole=@ar, approvalComment=@cm, approvedAt=@at WHERE id=@rid`);

      if (action === 'approve' && reqData.targetId) {
        // 更新目标金额 + 重新生成日明细（与「月目标分解」一致的占比/截止日）
        const ratioCfg = await loadTargetRatio(reqData.year, reqData.month);
        const newDailies = decomposeMonthlyTarget(reqData.newTarget, reqData.year, reqData.month, undefined, ratioCfg);
        await t.request()
          .input('tid', sql.Int, reqData.targetId).input('nt', sql.Int, reqData.newTarget)
          .query(`UPDATE StaffMonthlyTarget SET monthlyTarget=@nt, status='active', updatedAt=GETDATE() WHERE id=@tid`);
        await t.request()
          .input('tid', sql.Int, reqData.targetId)
          .query('DELETE FROM StaffMonthlyTargetDaily WHERE targetId=@tid');
        for (const d of newDailies) {
          await t.request()
            .input('tid', sql.Int, reqData.targetId).input('td', sql.NVarChar, d.date)
            .input('y', sql.Int, reqData.year).input('m', sql.Int, reqData.month)
            .input('di', sql.Int, d.dayIndex).input('dw', sql.NVarChar, d.dayOfWeek)
            .input('co', sql.Float, d.coefficient).input('dt', sql.Int, d.dailyTarget)
            .input('gn', sql.NVarChar, d.groupName)
            .query(`INSERT INTO StaffMonthlyTargetDaily (targetId, targetDate, year, month, dayIndex, dayOfWeek, coefficient, dailyTarget, groupName)
              VALUES (@tid, @td, @y, @m, @di, @dw, @co, @dt, @gn)`);
        }
      } else if (action === 'reject' && reqData.targetId) {
        await t.request()
          .input('tid', sql.Int, reqData.targetId)
          .query(`UPDATE StaffMonthlyTarget SET status='active' WHERE id=@tid`);
      }

      await t.commit();
      res.json({ success: true, message: action === 'approve' ? '变更申请已通过' : '变更申请已驳回' });
    } catch (e) {
      await t.rollback();
      throw e;
    }
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

export default router;
