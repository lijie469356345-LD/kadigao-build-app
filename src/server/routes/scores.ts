import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';

const router = Router();

function calculateScore(growthRate: number): number {
  if (growthRate >= 100) return 10;
  if (growthRate >= 75) return 9;
  if (growthRate >= 50) return 8;
  if (growthRate >= 25) return 7;
  if (growthRate >= 10) return 6;
  if (growthRate >= 0) return 5;
  if (growthRate >= -25) return 4;
  if (growthRate >= -50) return 3;
  if (growthRate >= -75) return 2;
  return 1;
}

router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    
    const result = await pool.request().query(`
      SELECT 
        id, userId, userName, date, 
        salesGrowthScore, quantityGrowthScore, orderCountGrowthScore,
        avgOrderValueGrowthScore, avgItemPriceGrowthScore, attachmentRateGrowthScore,
        giftPackageCountGrowthScore, giftPackageAmountGrowthScore,
        totalScore, finalScore, createdAt
      FROM DailyScores
      ORDER BY date DESC, finalScore DESC
    `);
    
    if (result.recordset.length === 0) {
      console.log('DailyScores 表为空，自动生成最近7天评分...');
      await calculateLast7DaysScores();
      const newResult = await pool.request().query(`
        SELECT 
          id, userId, userName, date, 
          salesGrowthScore, quantityGrowthScore, orderCountGrowthScore,
          avgOrderValueGrowthScore, avgItemPriceGrowthScore, attachmentRateGrowthScore,
          giftPackageCountGrowthScore, giftPackageAmountGrowthScore,
          totalScore, finalScore, createdAt
        FROM DailyScores
        ORDER BY date DESC, finalScore DESC
      `);
      res.json(newResult.recordset);
    } else {
      res.json(result.recordset);
    }
  } catch (error) {
    console.error('获取评分数据失败:', error);
    res.status(500).json({ message: '获取评分数据失败', error });
  }
});

router.get('/ranking', async (req, res) => {
  try {
    const { type } = req.query;
    const pool = await getPool();
    
    const checkResult = await pool.request().query('SELECT COUNT(*) as count FROM DailyScores');
    
    if (checkResult.recordset[0].count === 0) {
      console.log('DailyScores 表为空，自动生成最近7天评分...');
      await calculateLast7DaysScores();
    }
    
    const orderBy = type === 'bottom' ? 'finalScore ASC' : 'finalScore DESC';
    
    const result = await pool.request().query(`
      SELECT TOP 20
        id, userId, userName, date, finalScore
      FROM DailyScores
      ORDER BY ${orderBy}
    `);
    
    res.json(result.recordset);
  } catch (error) {
    console.error('获取评分排名失败:', error);
    res.status(500).json({ message: '获取评分排名失败', error });
  }
});

router.get('/average', async (req, res) => {
  try {
    const pool = await getPool();
    
    const checkResult = await pool.request().query('SELECT COUNT(*) as count FROM DailyScores');
    
    if (checkResult.recordset[0].count === 0) {
      console.log('DailyScores 表为空，自动生成最近7天评分...');
      await calculateLast7DaysScores();
    }
    
    const result = await pool.request().query(`
      SELECT AVG(finalScore) as averageScore
      FROM DailyScores
    `);
    
    const averageScore = result.recordset[0]?.averageScore || 0;
    res.json({ averageScore: Number(averageScore).toFixed(1) });
  } catch (error) {
    console.error('获取平均得分失败:', error);
    res.status(500).json({ message: '获取平均得分失败', error });
  }
});

router.post('/calculate', async (req, res) => {
  try {
    await calculateDailyScores();
    res.json({ message: '评分计算完成' });
  } catch (error) {
    console.error('计算评分失败:', error);
    res.status(500).json({ message: '计算评分失败', error });
  }
});

router.post('/calculateLast7Days', async (req, res) => {
  try {
    await calculateLast7DaysScores();
    res.json({ message: '最近7天评分计算完成' });
  } catch (error) {
    console.error('计算最近7天评分失败:', error);
    res.status(500).json({ message: '计算最近7天评分失败', error });
  }
});

export async function calculateDailyScores() {
  try {
    const pool = await getPool();
    
    const today = new Date().toISOString().split('T')[0];
    
    const existingResult = await pool.request()
      .input('date', sql.NVarChar, today)
      .query('SELECT COUNT(*) as count FROM DailyScores WHERE date = @date');
    
    if (existingResult.recordset[0].count > 0) {
      console.log(`今日(${today})评分已计算过`);
      return;
    }
    
    const compareResult = await pool.request().query(`
      SELECT * FROM SalesComparison WHERE date = @date
    `);
    
    const compareData = compareResult.recordset;
    
    interface GrowthData {
      salesGrowth: number;
      quantityGrowth: number;
      orderCountGrowth: number;
      avgOrderValueGrowth: number;
      avgItemPriceGrowth: number;
      attachmentRateGrowth: number;
      giftPackageCountGrowth: number;
      giftPackageAmountGrowth: number;
    }
    
    const userScores: Record<string, GrowthData[]> = {};
    
    compareData.forEach((row: any) => {
      const supervisor = row.supervisor;
      if (!userScores[supervisor]) {
        userScores[supervisor] = [];
      }
      
      userScores[supervisor].push({
        salesGrowth: row.salesGrowth || 0,
        quantityGrowth: row.quantityGrowth || 0,
        orderCountGrowth: row.orderCountGrowth || 0,
        avgOrderValueGrowth: row.avgOrderValueGrowth || 0,
        avgItemPriceGrowth: row.avgItemPriceGrowth || 0,
        attachmentRateGrowth: row.attachmentRateGrowth || 0,
        giftPackageCountGrowth: row.giftPackageCountGrowth || 0,
        giftPackageAmountGrowth: row.giftPackageAmountGrowth || 0
      });
    });
    
    for (const [userName, scores] of Object.entries(userScores)) {
      const count = scores.length;
      const avgScores: GrowthData = {
        salesGrowth: scores.reduce((sum, s) => sum + s.salesGrowth, 0) / count,
        quantityGrowth: scores.reduce((sum, s) => sum + s.quantityGrowth, 0) / count,
        orderCountGrowth: scores.reduce((sum, s) => sum + s.orderCountGrowth, 0) / count,
        avgOrderValueGrowth: scores.reduce((sum, s) => sum + s.avgOrderValueGrowth, 0) / count,
        avgItemPriceGrowth: scores.reduce((sum, s) => sum + s.avgItemPriceGrowth, 0) / count,
        attachmentRateGrowth: scores.reduce((sum, s) => sum + s.attachmentRateGrowth, 0) / count,
        giftPackageCountGrowth: scores.reduce((sum, s) => sum + s.giftPackageCountGrowth, 0) / count,
        giftPackageAmountGrowth: scores.reduce((sum, s) => sum + s.giftPackageAmountGrowth, 0) / count
      };
      
      const salesGrowthScore = calculateScore(avgScores.salesGrowth);
      const quantityGrowthScore = calculateScore(avgScores.quantityGrowth);
      const orderCountGrowthScore = calculateScore(avgScores.orderCountGrowth);
      const avgOrderValueGrowthScore = calculateScore(avgScores.avgOrderValueGrowth);
      const avgItemPriceGrowthScore = calculateScore(avgScores.avgItemPriceGrowth);
      const attachmentRateGrowthScore = calculateScore(avgScores.attachmentRateGrowth);
      const giftPackageCountGrowthScore = calculateScore(avgScores.giftPackageCountGrowth);
      const giftPackageAmountGrowthScore = calculateScore(avgScores.giftPackageAmountGrowth);
      
      const totalScore = salesGrowthScore + quantityGrowthScore + orderCountGrowthScore +
        avgOrderValueGrowthScore + avgItemPriceGrowthScore + attachmentRateGrowthScore +
        giftPackageCountGrowthScore + giftPackageAmountGrowthScore;
      
      const finalScore = totalScore / 0.8;
      
      const userResult = await pool.request()
        .input('userName', sql.NVarChar, userName)
        .query('SELECT userCode FROM 用户全 WHERE 用户名称 = @userName');
      
      const userId = userResult.recordset[0]?.userCode || userName;
      
      await pool.request()
        .input('userId', sql.NVarChar, userId)
        .input('userName', sql.NVarChar, userName)
        .input('date', sql.NVarChar, today)
        .input('salesGrowthScore', sql.Int, salesGrowthScore)
        .input('quantityGrowthScore', sql.Int, quantityGrowthScore)
        .input('orderCountGrowthScore', sql.Int, orderCountGrowthScore)
        .input('avgOrderValueGrowthScore', sql.Int, avgOrderValueGrowthScore)
        .input('avgItemPriceGrowthScore', sql.Int, avgItemPriceGrowthScore)
        .input('attachmentRateGrowthScore', sql.Int, attachmentRateGrowthScore)
        .input('giftPackageCountGrowthScore', sql.Int, giftPackageCountGrowthScore)
        .input('giftPackageAmountGrowthScore', sql.Int, giftPackageAmountGrowthScore)
        .input('totalScore', sql.Decimal, totalScore)
        .input('finalScore', sql.Decimal, finalScore)
        .query(`
          INSERT INTO DailyScores (
            userId, userName, date,
            salesGrowthScore, quantityGrowthScore, orderCountGrowthScore,
            avgOrderValueGrowthScore, avgItemPriceGrowthScore, attachmentRateGrowthScore,
            giftPackageCountGrowthScore, giftPackageAmountGrowthScore,
            totalScore, finalScore, createdAt
          ) VALUES (
            @userId, @userName, @date,
            @salesGrowthScore, @quantityGrowthScore, @orderCountGrowthScore,
            @avgOrderValueGrowthScore, @avgItemPriceGrowthScore, @attachmentRateGrowthScore,
            @giftPackageCountGrowthScore, @giftPackageAmountGrowthScore,
            @totalScore, @finalScore, GETDATE()
          )
        `);
    }
    
    console.log(`每日评分计算完成，日期: ${today}`);
  } catch (error) {
    console.error('计算每日评分失败:', error);
  }
}

export async function calculateLast7DaysScores() {
  try {
    const pool = await getPool();
    
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const existingResult = await pool.request()
        .input('date', sql.NVarChar, dateStr)
        .query('SELECT COUNT(*) as count FROM DailyScores WHERE date = @date');
      
      if (existingResult.recordset[0].count > 0) {
        console.log(`日期(${dateStr})评分已存在，跳过`);
        continue;
      }
      
      console.log(`计算日期(${dateStr})的评分...`);
      
      const yesterday = new Date(date);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      const todayCondition = `日期 >= '${dateStr}' AND 日期 <= '${dateStr}'`;
      const yesterdayCondition = `日期 >= '${yesterdayStr}' AND 日期 <= '${yesterdayStr}'`;
      
      const [todayAmounts, yesterdayAmounts, todayQuantities, yesterdayQuantities, todayOrders, yesterdayOrders, todayAvgPrices, yesterdayAvgPrices, todayGifts, yesterdayGifts, shopInfo] = await Promise.all([
        getAmounts(pool, todayCondition),
        getAmounts(pool, yesterdayCondition),
        getQuantities(pool, todayCondition),
        getQuantities(pool, yesterdayCondition),
        getOrderCounts(pool, todayCondition),
        getOrderCounts(pool, yesterdayCondition),
        getAvgPrices(pool, todayCondition),
        getAvgPrices(pool, yesterdayCondition),
        getGiftPackages(pool, todayCondition),
        getGiftPackages(pool, yesterdayCondition),
        getShopInfo(pool)
      ]);
      
      const allShops = new Set([
        ...todayAmounts.keys(),
        ...yesterdayAmounts.keys(),
        ...todayQuantities.keys(),
        ...yesterdayQuantities.keys()
      ]);
      
      const supervisorData: Record<string, { sales: number; quantity: number; orders: number; avgOrderValue: number; avgItemPrice: number; attachmentRate: number; giftCount: number; giftAmount: number }[]> = {};
      
      allShops.forEach(shopName => {
        const info = shopInfo.get(shopName);
        const supervisor = info?.supervisor || '未知';
        
        if (!supervisorData[supervisor]) {
          supervisorData[supervisor] = [];
        }
        
        supervisorData[supervisor].push({
          sales: todayAmounts.get(shopName) || 0,
          quantity: todayQuantities.get(shopName) || 0,
          orders: todayOrders.get(shopName) || 0,
          avgOrderValue: todayAvgPrices.get(shopName)?.avgOrderValue || 0,
          avgItemPrice: todayAvgPrices.get(shopName)?.avgItemPrice || 0,
          attachmentRate: todayAvgPrices.get(shopName)?.attachmentRate || 0,
          giftCount: todayGifts.get(shopName)?.giftPackageCount || 0,
          giftAmount: todayGifts.get(shopName)?.giftPackageAmount || 0
        });
      });
      
      for (const [userName, data] of Object.entries(supervisorData)) {
        const count = data.length;
        
        const avgTodaySales = data.reduce((sum, d) => sum + d.sales, 0) / count;
        const avgYesterdaySales = data.reduce((sum, d) => {
          const shopName = Array.from(allShops).find(() => true);
          return sum + (yesterdayAmounts.get(shopName || '') || 0);
        }, 0) / count;
        
        const avgTodayQuantity = data.reduce((sum, d) => sum + d.quantity, 0) / count;
        const avgYesterdayQuantity = data.reduce((sum, d) => {
          const shopName = Array.from(allShops).find(() => true);
          return sum + (yesterdayQuantities.get(shopName || '') || 0);
        }, 0) / count;
        
        const salesGrowth = avgYesterdaySales > 0 ? ((avgTodaySales - avgYesterdaySales) / avgYesterdaySales) * 100 : 0;
        const quantityGrowth = avgYesterdayQuantity > 0 ? ((avgTodayQuantity - avgYesterdayQuantity) / avgYesterdayQuantity) * 100 : 0;
        
        const avgOrders = data.reduce((sum, d) => sum + d.orders, 0) / count;
        const avgOrderValue = data.reduce((sum, d) => sum + d.avgOrderValue, 0) / count;
        const avgItemPrice = data.reduce((sum, d) => sum + d.avgItemPrice, 0) / count;
        const avgAttachmentRate = data.reduce((sum, d) => sum + d.attachmentRate, 0) / count;
        const avgGiftCount = data.reduce((sum, d) => sum + d.giftCount, 0) / count;
        const avgGiftAmount = data.reduce((sum, d) => sum + d.giftAmount, 0) / count;
        
        const salesGrowthScore = calculateScore(salesGrowth);
        const quantityGrowthScore = calculateScore(quantityGrowth);
        const orderCountGrowthScore = calculateScore(0);
        const avgOrderValueGrowthScore = calculateScore(0);
        const avgItemPriceGrowthScore = calculateScore(0);
        const attachmentRateGrowthScore = calculateScore(0);
        const giftPackageCountGrowthScore = calculateScore(0);
        const giftPackageAmountGrowthScore = calculateScore(0);
        
        const totalScore = salesGrowthScore + quantityGrowthScore + orderCountGrowthScore +
          avgOrderValueGrowthScore + avgItemPriceGrowthScore + attachmentRateGrowthScore +
          giftPackageCountGrowthScore + giftPackageAmountGrowthScore;
        
        const finalScore = totalScore / 0.8;
        
        await pool.request()
          .input('userId', sql.NVarChar, userName)
          .input('userName', sql.NVarChar, userName)
          .input('date', sql.NVarChar, dateStr)
          .input('salesGrowthScore', sql.Int, salesGrowthScore)
          .input('quantityGrowthScore', sql.Int, quantityGrowthScore)
          .input('orderCountGrowthScore', sql.Int, orderCountGrowthScore)
          .input('avgOrderValueGrowthScore', sql.Int, avgOrderValueGrowthScore)
          .input('avgItemPriceGrowthScore', sql.Int, avgItemPriceGrowthScore)
          .input('attachmentRateGrowthScore', sql.Int, attachmentRateGrowthScore)
          .input('giftPackageCountGrowthScore', sql.Int, giftPackageCountGrowthScore)
          .input('giftPackageAmountGrowthScore', sql.Int, giftPackageAmountGrowthScore)
          .input('totalScore', sql.Decimal, totalScore)
          .input('finalScore', sql.Decimal, finalScore)
          .query(`
            INSERT INTO DailyScores (
              userId, userName, date,
              salesGrowthScore, quantityGrowthScore, orderCountGrowthScore,
              avgOrderValueGrowthScore, avgItemPriceGrowthScore, attachmentRateGrowthScore,
              giftPackageCountGrowthScore, giftPackageAmountGrowthScore,
              totalScore, finalScore, createdAt
            ) VALUES (
              @userId, @userName, @date,
              @salesGrowthScore, @quantityGrowthScore, @orderCountGrowthScore,
              @avgOrderValueGrowthScore, @avgItemPriceGrowthScore, @attachmentRateGrowthScore,
              @giftPackageCountGrowthScore, @giftPackageAmountGrowthScore,
              @totalScore, @finalScore, GETDATE()
            )
          `);
      }
      
      console.log(`日期(${dateStr})评分计算完成`);
    }
    
    console.log('最近7天评分计算完成');
  } catch (error) {
    console.error('计算最近7天评分失败:', error);
  }
}

const WAREHOUSE_TYPE = "(仓库类别 = '直营' OR 仓库类别 = '山东直营' OR 仓库类别 = '加盟')";

const getAmounts = async (pool: sql.ConnectionPool, dateCondition: string) => {
  const query = `
    SELECT 店铺名称, SUM(业绩金额) as amount 
    FROM 有效业绩全 
    WHERE ${dateCondition} AND ${WAREHOUSE_TYPE}
    GROUP BY 店铺名称
  `;
  const result = await pool.request().query(query);
  const amountMap = new Map<string, number>();
  result.recordset.forEach((row: any) => {
    amountMap.set(row.店铺名称, row.amount || 0);
  });
  return amountMap;
};

const getQuantities = async (pool: sql.ConnectionPool, dateCondition: string) => {
  const query = `
    SELECT 店铺名称, SUM(数量) as quantity 
    FROM 有效业绩全 
    WHERE ${dateCondition} AND ${WAREHOUSE_TYPE} AND 性别 IN ('男鞋', '女鞋', '童鞋', '包')
    GROUP BY 店铺名称
  `;
  const result = await pool.request().query(query);
  const quantityMap = new Map<string, number>();
  result.recordset.forEach((row: any) => {
    quantityMap.set(row.店铺名称, row.quantity || 0);
  });
  return quantityMap;
};

const getOrderCounts = async (pool: sql.ConnectionPool, dateCondition: string) => {
  const query = `
    SELECT 店铺名称, COUNT(DISTINCT 会员代码) as orders 
    FROM 有效业绩全 
    WHERE ${dateCondition} AND ${WAREHOUSE_TYPE} AND 会员代码 <> ''
    GROUP BY 店铺名称
  `;
  const result = await pool.request().query(query);
  const orderMap = new Map<string, number>();
  result.recordset.forEach((row: any) => {
    orderMap.set(row.店铺名称, row.orders || 0);
  });
  return orderMap;
};

const getAvgPrices = async (pool: sql.ConnectionPool, dateCondition: string) => {
  const query = `
    SELECT 店铺名称, SUM(业绩金额) as 鞋金额, SUM(数量) as 鞋数量, SUM(开单数) as 开单数
    FROM (
      SELECT 店铺名称, 会员代码, SUM(业绩金额) as 业绩金额, SUM(数量) as 数量,
             CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END as 开单数
      FROM 有效业绩全 
      WHERE ${dateCondition} AND ${WAREHOUSE_TYPE} 
        AND 性别 IN ('男鞋', '女鞋', '童鞋', '包') AND 会员代码 <> ''
      GROUP BY 店铺名称, 会员代码
      HAVING SUM(数量) <> 0
    ) t
    GROUP BY 店铺名称
  `;
  const result = await pool.request().query(query);
  const priceMap = new Map<string, { avgOrderValue: number; avgItemPrice: number; attachmentRate: number }>();
  result.recordset.forEach((row: any) => {
    const orders = row.开单数 || 1;
    priceMap.set(row.店铺名称, {
      avgOrderValue: (row.鞋金额 || 0) / orders,
      avgItemPrice: row.鞋数量 > 0 ? (row.鞋金额 || 0) / row.鞋数量 : 0,
      attachmentRate: 0
    });
  });
  return priceMap;
};

const getGiftPackages = async (pool: sql.ConnectionPool, dateCondition: string) => {
  const query = `
    SELECT 店铺名称, SUM(礼包数量) as giftPackageCount, SUM(礼包金额) as giftPackageAmount 
    FROM 礼包全 
    WHERE ${dateCondition}
    GROUP BY 店铺名称
  `;
  const result = await pool.request().query(query);
  const giftMap = new Map<string, { giftPackageCount: number; giftPackageAmount: number }>();
  result.recordset.forEach((row: any) => {
    giftMap.set(row.店铺名称, {
      giftPackageCount: row.giftPackageCount || 0,
      giftPackageAmount: row.giftPackageAmount || 0
    });
  });
  return giftMap;
};

const getShopInfo = async (pool: sql.ConnectionPool) => {
  const query = `
    SELECT 店铺名称, 督导 as supervisor
    FROM 店仓全
    WHERE ${WAREHOUSE_TYPE}
  `;
  const result = await pool.request().query(query);
  const shopInfoMap = new Map<string, { supervisor: string }>();
  result.recordset.forEach((row: any) => {
    shopInfoMap.set(row.店铺名称, { supervisor: row.supervisor || '' });
  });
  return shopInfoMap;
};

export default router;