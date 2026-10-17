import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { guardLogin } from '../middlewares/authMiddleware';
import { getStandardVisibleShopNames } from '../services/permissionService';

const router = Router();

router.get('/', guardLogin, async (req, res) => {
  try {
    const pool = await getPool();
    const shopName = typeof req.query.shopName === 'string' ? req.query.shopName : '';
    const year = Number(req.query.year) || new Date().getFullYear();

    if (!shopName) return res.json({ data: null });

    // 数据隔离：有登录身份时，shopName 必须落在用户可见店铺范围内
    if (req.user) {
      const visibleShops = await getStandardVisibleShopNames(pool, req.query.groupName as string, req.user);
      if (visibleShops !== null && (!visibleShops.includes(shopName))) {
        return res.json({ data: null });
      }
    }

    // 1. 店铺信息
    const shopResult = await pool.request()
      .input('shopName', sql.NVarChar, shopName)
      .query(`SELECT 店铺代码 as code, 店铺名称 as shopName, 经销商 as dealer, 区经 as districtManager, 督导 as supervisor, 商品 as product, CONVERT(varchar(10), 开业日期, 23) as openDate, 货柜组数 as cabinetCount FROM 店仓全 WHERE 店铺名称 = @shopName`);
    const shopInfo = shopResult.recordset[0] || {};
    const dealer = shopInfo.dealer || '';
    const supervisor = shopInfo.supervisor || '';
    const districtManager = shopInfo.districtManager || '';

    // 2. 店铺年任务 + 已完成（年度业绩）
    const shopStatResult = await pool.request()
      .input('shopName', sql.NVarChar, shopName)
      .input('year', sql.Int, year)
      .query(`
        SELECT
          (SELECT SUM(目标) FROM 年目标 WHERE 店铺名称 = @shopName AND 年份 = @year) as yearTarget,
          (SELECT SUM(业绩金额) FROM 有效业绩全 WHERE 店铺名称 = @shopName AND YEAR(日期) = @year) as completed
      `);
    const shopStat = shopStatResult.recordset[0] || {};
    const shopYearTarget = Number(shopStat.yearTarget || 0);
    const shopCompleted = Number(shopStat.completed || 0);

    // 3. 经销商汇总
    const dealerStat = dealer
      ? await (async () => {
          const r = await pool.request()
            .input('dealer', sql.NVarChar, dealer)
            .input('year', sql.Int, year)
            .query(`
              SELECT
                (SELECT COUNT(DISTINCT 店铺名称) FROM 店仓全 WHERE 经销商 = @dealer) as shopCount,
                (SELECT SUM(目标) FROM 年目标 WHERE 年份 = @year AND 店铺名称 IN (SELECT 店铺名称 FROM 店仓全 WHERE 经销商 = @dealer)) as yearTarget,
                (SELECT SUM(业绩金额) FROM 有效业绩全 WHERE YEAR(日期) = @year AND 经销商 = @dealer) as completed,
                (SELECT SUM(数量) FROM 今日库存全 WHERE 经销商 = @dealer) as stock
            `);
          return r.recordset[0] || {};
        })()
      : {};

    // 4. 督导汇总
    const supervisorStat = supervisor
      ? await (async () => {
          const r = await pool.request()
            .input('supervisor', sql.NVarChar, supervisor)
            .input('year', sql.Int, year)
            .query(`
              SELECT
                (SELECT COUNT(DISTINCT 店铺名称) FROM 店仓全 WHERE 督导 = @supervisor) as shopCount,
                (SELECT SUM(目标) FROM 年目标 WHERE 年份 = @year AND 店铺名称 IN (SELECT 店铺名称 FROM 店仓全 WHERE 督导 = @supervisor)) as yearTarget,
                (SELECT SUM(业绩金额) FROM 有效业绩全 WHERE YEAR(日期) = @year AND 督导 = @supervisor) as completed
            `);
          return r.recordset[0] || {};
        })()
      : {};

    // 4.5 区经汇总
    const districtManagerStat = districtManager
      ? await (async () => {
          const r = await pool.request()
            .input('dm', sql.NVarChar, districtManager)
            .input('year', sql.Int, year)
            .query(`
              SELECT
                (SELECT COUNT(DISTINCT 店铺名称) FROM 店仓全 WHERE 区经 = @dm) as shopCount,
                (SELECT SUM(目标) FROM 年目标 WHERE 年份 = @year AND 店铺名称 IN (SELECT 店铺名称 FROM 店仓全 WHERE 区经 = @dm)) as yearTarget,
                (SELECT SUM(业绩金额) FROM 有效业绩全 WHERE YEAR(日期) = @year AND 区经 = @dm) as completed
            `);
          return r.recordset[0] || {};
        })()
      : {};

    // 5. 月度目标 / 本期业绩 / 同期业绩
    const [targetRows, currentRows, sameRows] = await Promise.all([
      pool.request().input('shopName', sql.NVarChar, shopName).input('year', sql.Int, year)
        .query(`SELECT month as m, SUM(monthlyTarget) as v FROM MonthlyTargetDecomposition WHERE shopName = @shopName AND year = @year AND status = 'active' GROUP BY month`),
      pool.request().input('shopName', sql.NVarChar, shopName).input('year', sql.Int, year)
        .query(`SELECT MONTH(日期) as m, SUM(业绩金额) as v FROM 有效业绩全 WHERE 店铺名称 = @shopName AND YEAR(日期) = @year GROUP BY MONTH(日期)`),
      pool.request().input('shopName', sql.NVarChar, shopName).input('year', sql.Int, year - 1)
        .query(`SELECT MONTH(日期) as m, SUM(业绩金额) as v FROM 有效业绩全 WHERE 店铺名称 = @shopName AND YEAR(日期) = @year GROUP BY MONTH(日期)`),
    ]);

    const toArr = (rows: any[]) => {
      const map = new Map<number, number>();
      rows.forEach(r => map.set(Number(r.m), Number(r.v || 0)));
      return Array.from({ length: 12 }, (_, i) => map.get(i + 1) || 0);
    };
    const targets = toArr(targetRows.recordset);
    const currentPeriod = toArr(currentRows.recordset);
    const samePeriod = toArr(sameRows.recordset);

    const data = {
      shop: {
        code: shopInfo.code || '',
        name: shopInfo.shopName || shopName,
        dealer,
        supervisor,
        product: shopInfo.product || '',
        yearTarget: shopYearTarget,
        completed: shopCompleted,
        rate: shopYearTarget > 0 ? (shopCompleted / shopYearTarget) * 100 : 0,
        gap: shopYearTarget - shopCompleted,
        openDate: shopInfo.openDate ? String(shopInfo.openDate).slice(0, 10) : '',
        cabinetCount: Number(shopInfo.cabinetCount || 0),
      },
      dealer: {
        name: dealer,
        yearTarget: Number(dealerStat.yearTarget || 0),
        completed: Number(dealerStat.completed || 0),
        rate: Number(dealerStat.yearTarget || 0) > 0 ? (Number(dealerStat.completed || 0) / Number(dealerStat.yearTarget || 0)) * 100 : 0,
        shopCount: Number(dealerStat.shopCount || 0),
        stock: Number(dealerStat.stock || 0),
      },
      supervisor: {
        name: supervisor,
        yearTarget: Number(supervisorStat.yearTarget || 0),
        completed: Number(supervisorStat.completed || 0),
        rate: Number(supervisorStat.yearTarget || 0) > 0 ? (Number(supervisorStat.completed || 0) / Number(supervisorStat.yearTarget || 0)) * 100 : 0,
        shopCount: Number(supervisorStat.shopCount || 0),
        product: shopInfo.product || '',
      },
      districtManager: {
        name: districtManager,
        yearTarget: Number(districtManagerStat.yearTarget || 0),
        completed: Number(districtManagerStat.completed || 0),
        rate: Number(districtManagerStat.yearTarget || 0) > 0 ? (Number(districtManagerStat.completed || 0) / Number(districtManagerStat.yearTarget || 0)) * 100 : 0,
        shopCount: Number(districtManagerStat.shopCount || 0),
      },
      monthly: { targets, currentPeriod, samePeriod },
    };

    res.json({ data });
  } catch (error) {
    console.error('[annual-operation-dashboard] 查询失败:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
