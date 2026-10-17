import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { isAdminGroup, extractManagerArea, extractSupervisorName, getStandardShopFilter } from '../services/permissionService';
import { JwtUserPayload } from '../services/jwt';

const router = Router();

// DataExtraction 查询缓存：减少重复 DB 往返
const dxCache = new Map<string, { query: string | null; ts: number }>();
const DX_CACHE_TTL = 5 * 60 * 1000; // 5分钟

// 从数据提取台账读取SQL模板
export async function getQueryFromDX(pool: sql.ConnectionPool, fieldName: string, replacements: Record<string, string>): Promise<string | null> {
  try {
    let cached = dxCache.get(fieldName);
    if (!cached || Date.now() - cached.ts > DX_CACHE_TTL) {
      const result = await pool.request()
        .input('name', sql.NVarChar, fieldName)
        .query('SELECT sqlQuery FROM DataExtraction WHERE fieldName = @name');
      const query = result.recordset.length > 0 ? result.recordset[0].sqlQuery as string : null;
      cached = { query, ts: Date.now() };
      dxCache.set(fieldName, cached);
    }
    if (!cached.query) return null;
    let query = cached.query;
    for (const [key, value] of Object.entries(replacements)) {
      query = query.replace(new RegExp('@' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), value);
    }
    return query;
  } catch {
    return null;
  }
}

const normalizeYMD = (dateStr: string): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${y}-${m}-${d}`;
};

const getTargetDateRange = (dateRange: string, startDate?: string, endDate?: string): { startDate: string; endDate: string } => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const formatYMD = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  switch (dateRange) {
    case 'today':
      return { startDate: formatYMD(now), endDate: formatYMD(now) };
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { startDate: formatYMD(y), endDate: formatYMD(y) };
    }
    case 'week': {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - 6);
      return { startDate: formatYMD(weekStart), endDate: formatYMD(now) };
    }
    case 'month': {
      if (startDate && endDate) {
        return { startDate: normalizeYMD(startDate), endDate: normalizeYMD(endDate) };
      }
      const monthStart = new Date(year, month - 1, 1);
      return { startDate: formatYMD(monthStart), endDate: formatYMD(now) };
    }
    case 'custom':
      if (startDate && endDate) {
        return { startDate: normalizeYMD(startDate), endDate: normalizeYMD(endDate) };
      }
    default: {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { startDate: formatYMD(y), endDate: formatYMD(y) };
    }
  }
};

const getDateConditions = (dateRange: string, startDate?: string, endDate?: string) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  
  switch (dateRange) {
    case 'today':
      return {
        dateCondition: "日期 >= CONVERT(date, GETDATE()) AND 日期 <= CONVERT(date, GETDATE())",
        targetCondition: `年份 = ${year} AND 月份 = ${month} AND 仓库类别 IN ('直营','山东直营','加盟')`
      };
    case 'week':
      return {
        dateCondition: "日期 >= DATEADD(day, -6, CONVERT(date, GETDATE())) AND 日期 <= CONVERT(date, GETDATE())",
        targetCondition: `年份 = ${year} AND 月份 = ${month} AND 仓库类别 IN ('直营','山东直营','加盟')`
      };
    case 'month':
      if (startDate && endDate) {
        return {
          dateCondition: `日期 >= CONVERT(date, '${startDate}') AND 日期 <= CONVERT(date, '${endDate}')`,
          targetCondition: `年份 = ${year} AND 月份 = ${month} AND 仓库类别 IN ('直营','山东直营','加盟')`
        };
      }
      return {
        dateCondition: `日期 >= CONVERT(date, '${year}-${month.toString().padStart(2, '0')}-01') AND 日期 <= CONVERT(date, GETDATE())`,
        targetCondition: `年份 = ${year} AND 月份 = ${month} AND 仓库类别 IN ('直营','山东直营','加盟')`
      };
    case 'custom':
      if (startDate && endDate) {
        return {
          dateCondition: `日期 >= CONVERT(date, '${startDate}') AND 日期 <= CONVERT(date, '${endDate}')`,
          targetCondition: `年份 = ${year} AND 月份 = ${month} AND 仓库类别 IN ('直营','山东直营','加盟')`
        };
      }
      // 无日期参数时使用当前月
      return {
        dateCondition: `日期 >= CONVERT(date, '${year}-${month.toString().padStart(2, '0')}-01') AND 日期 <= CONVERT(date, GETDATE())`,
        targetCondition: `年份 = ${year} AND 月份 = ${month} AND 仓库类别 IN ('直营','山东直营','加盟')`
      };
    case 'yesterday_minus_1':
      return {
        dateCondition: "日期 >= GETDATE() - 3 AND 日期 <= GETDATE() - 2",
        targetCondition: `年份 = ${year} AND 月份 = ${month} AND 仓库类别 IN ('直营','山东直营','加盟')`
      };
    case 'yesterday':
    default:
      return {
        dateCondition: "日期 >= GETDATE() - 2 AND 日期 <= GETDATE() - 1",
        targetCondition: `年份 = ${year} AND 月份 = ${month} AND 仓库类别 IN ('直营','山东直营','加盟')`
      };
  }
};

const getTargetsFromMonthlyTarget = async (pool: sql.ConnectionPool, startDate: string, endDate: string, allowedShops?: Set<string>) => {
  // Try DataExtraction first
  const dxQuery = await getQueryFromDX(pool, '店铺月目标_来自MonthlyTarget', {
    startDate: `'${startDate}'`,
    endDate: `'${endDate}'`
  });
  if (dxQuery) {
    const result = await pool.request().query(dxQuery);
    const targetMap = new Map<string, number>();
    result.recordset.forEach((row: any) => {
      if (!allowedShops || allowedShops.size === 0 || allowedShops.has(row.shopName)) {
        targetMap.set(row.shopName, Math.round(row.target || 0));
      }
    });
    return targetMap;
  }

  let query = `
    SELECT d.shopName, SUM(m.dailyTarget) as target
    FROM MonthlyTargetDaily m
    INNER JOIN MonthlyTargetDecomposition d ON m.targetId = d.id
    WHERE d.status = 'active'
      AND CONVERT(date, m.targetDate) >= CONVERT(date, @startDate) AND CONVERT(date, m.targetDate) <= CONVERT(date, @endDate)
  `;

  if (allowedShops && allowedShops.size > 0) {
    const shopList = Array.from(allowedShops).map(s => `'${s}'`).join(', ');
    query += ` AND d.shopName IN (${shopList})`;
  }

  query += ' GROUP BY d.shopName';

  const result = await pool.request()
    .input('startDate', sql.NVarChar, startDate)
    .input('endDate', sql.NVarChar, endDate)
    .query(query);

  const targetMap = new Map<string, number>();
  result.recordset.forEach((row: any) => {
    targetMap.set(row.shopName, Math.round(row.target || 0));
  });
  return targetMap;
};

const getTargets = async (pool: sql.ConnectionPool, targetCondition: string) => {
  // Try DataExtraction first - extract year/month from targetCondition
  const yearMatch = targetCondition.match(/年份\s*=\s*(\d+)/);
  const monthMatch = targetCondition.match(/月份\s*=\s*(\d+)/);
  const dxQuery = await getQueryFromDX(pool, '店铺年目标_来自年目标表', {
    year: yearMatch ? yearMatch[1] : '',
    month: monthMatch ? monthMatch[1] : ''
  });
  if (dxQuery) {
    const result = await pool.request().query(dxQuery);
    const targetMap = new Map<string, number>();
    result.recordset.forEach((row: any) => {
      targetMap.set(row.店铺名称, row.target || 0);
    });
    return targetMap;
  }

  const query = `SELECT 店铺名称, SUM(目标) as target FROM 年目标 WHERE ${targetCondition} GROUP BY 店铺名称`;
  const result = await pool.request().query(query);
  const targetMap = new Map<string, number>();
  result.recordset.forEach((row: any) => {
    targetMap.set(row.店铺名称, row.target || 0);
  });
  return targetMap;
};

const getAmounts = async (pool: sql.ConnectionPool, dateCondition: string, allowedShops?: Set<string>) => {
  // Try DataExtraction first
  const dxQuery = await getQueryFromDX(pool, '店铺业绩金额', { dateCondition });
  if (dxQuery) {
    const result = await pool.request().query(dxQuery);
    const amountMap = new Map<string, number>();
    result.recordset.forEach((row: any) => {
      if (!allowedShops || allowedShops.size === 0 || allowedShops.has(row.店铺名称)) {
        amountMap.set(row.店铺名称, row.amount || 0);
      }
    });
    return amountMap;
  }

  let query = `
    SELECT 店铺名称, SUM(业绩金额) as amount
    FROM 有效业绩全
    WHERE ${dateCondition} AND 仓库类别 IN ('直营','山东直营','加盟')
  `;

  if (allowedShops && allowedShops.size > 0) {
    const shopList = Array.from(allowedShops).map(s => `'${s}'`).join(', ');
    query += ` AND 店铺名称 IN (${shopList})`;
  }

  query += ' GROUP BY 店铺名称';

  const result = await pool.request().query(query);
  const amountMap = new Map<string, number>();
  result.recordset.forEach((row: any) => {
    amountMap.set(row.店铺名称, row.amount || 0);
  });
  return amountMap;
};

const getQuantities = async (pool: sql.ConnectionPool, dateCondition: string, allowedShops?: Set<string>) => {
  let query = `
    SELECT 店铺名称, SUM(数量) as quantity 
    FROM 有效业绩全 
    WHERE ${dateCondition} AND 仓库类别 IN ('直营','山东直营','加盟') AND 性别 IN ('男鞋', '女鞋', '童鞋', '包') AND 款式 <> '洞洞鞋'
  `;
  
  if (allowedShops && allowedShops.size > 0) {
    const shopList = Array.from(allowedShops).map(s => `'${s}'`).join(', ');
    query += ` AND 店铺名称 IN (${shopList})`;
  }
  
  query += ' GROUP BY 店铺名称';
  
  const result = await pool.request().query(query);
  const quantityMap = new Map<string, number>();
  result.recordset.forEach((row: any) => {
    quantityMap.set(row.店铺名称, row.quantity || 0);
  });
  return quantityMap;
};

const getAvgPrices = async (pool: sql.ConnectionPool, dateCondition: string, allowedShops?: Set<string>) => {
  // Try DataExtraction first
  const dxQuery = await getQueryFromDX(pool, '店铺均价_开单数_连带率', { dateCondition });
  if (dxQuery) {
    const result = await pool.request().query(dxQuery);
    const avgPriceMap = new Map<string, { avgItemPrice: number; avgOrderValue: number; attachmentRate: number; orderCount: number; shoeAmount: number; shoeQuantity: number }>();
    result.recordset.forEach((row: any) => {
      if (allowedShops && allowedShops.size > 0 && !allowedShops.has(row.店铺名称)) return;
      const shoeAmount = row.鞋金额 || 0;
      const shoeQuantity = row.鞋数量 || 0;
      const orderCount = row.开单数 || 0;
      avgPriceMap.set(row.店铺名称, {
        avgItemPrice: shoeQuantity > 0 ? (shoeAmount / shoeQuantity) : 0,
        avgOrderValue: orderCount !== 0 ? (shoeAmount / orderCount) : 0,
        attachmentRate: orderCount !== 0 ? (shoeQuantity / orderCount) : 0,
        orderCount,
        shoeAmount,
        shoeQuantity
      });
    });
    return avgPriceMap;
  }

  let shopFilter = '';
  if (allowedShops && allowedShops.size > 0) {
    const shopList = Array.from(allowedShops).map(s => `'${s}'`).join(', ');
    shopFilter = ` AND 店铺名称 IN (${shopList})`;
  }

  const query = `
    SELECT
      店铺名称,
      SUM(业绩金额) as 鞋金额,
      SUM(数量) as 鞋数量,
      SUM(开单数) as 开单数,
      CASE WHEN SUM(数量) <> 0 THEN SUM(业绩金额) / SUM(数量) ELSE 0 END as unitPrice,
      CASE WHEN SUM(开单数) <> 0 THEN SUM(业绩金额) / SUM(开单数) ELSE 0 END as avgOrderValue,
      CASE WHEN SUM(开单数) <> 0 THEN SUM(数量) / SUM(开单数) ELSE 0 END as attachmentRate
    FROM (
      SELECT 店铺名称, SUM(业绩金额) as 业绩金额, SUM(数量) as 数量,
             CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END as 开单数
      FROM 有效业绩全
      WHERE ${dateCondition} AND 仓库类别 IN ('直营','山东直营','加盟')
        AND 会员代码 <> ''
        AND 性别 IN ('男鞋', '女鞋', '童鞋', '包')
        AND 款式 <> '洞洞鞋'
        ${shopFilter}
      GROUP BY 店铺名称, 会员代码
      HAVING SUM(数量) <> 0
      UNION ALL
      SELECT 店铺名称, SUM(业绩金额) as 业绩金额, SUM(数量) as 数量,
             CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END as 开单数
      FROM 有效业绩全
      WHERE ${dateCondition} AND 仓库类别 IN ('直营','山东直营','加盟')
        AND 会员代码 IS NULL
        AND 性别 IN ('男鞋', '女鞋', '童鞋', '包')
        AND 款式 <> '洞洞鞋'
        ${shopFilter}
      GROUP BY 店铺名称, 单据编号
      HAVING SUM(数量) <> 0
    ) as a
    GROUP BY 店铺名称
  `;

  const result = await pool.request().query(query);
  const avgPriceMap = new Map<string, { avgItemPrice: number; avgOrderValue: number; attachmentRate: number; orderCount: number; shoeAmount: number; shoeQuantity: number }>();
  result.recordset.forEach((row: any) => {
    const shoeAmount = row.鞋金额 || 0;
    const shoeQuantity = row.鞋数量 || 0;
    const orderCount = row.开单数 || 0;
    avgPriceMap.set(row.店铺名称, {
      avgItemPrice: shoeQuantity > 0 ? (shoeAmount / shoeQuantity) : 0,
      avgOrderValue: orderCount !== 0 ? (shoeAmount / orderCount) : 0,
      attachmentRate: orderCount !== 0 ? (shoeQuantity / orderCount) : 0,
      orderCount,
      shoeAmount,
      shoeQuantity
    });
  });
  return avgPriceMap;
};

const getGiftPackages = async (pool: sql.ConnectionPool, dateCondition: string, allowedShops?: Set<string>) => {
  // Try DataExtraction first
  const dxQuery = await getQueryFromDX(pool, '店铺礼包金额数量', { dateCondition });
  if (dxQuery) {
    const result = await pool.request().query(dxQuery);
    const giftMap = new Map<string, { giftPackageCount: number; giftPackageAmount: number }>();
    result.recordset.forEach((row: any) => {
      if (!allowedShops || allowedShops.size === 0 || allowedShops.has(row.店铺名称)) {
        giftMap.set(row.店铺名称, {
          giftPackageCount: row.礼包数量 || 0,
          giftPackageAmount: row.礼包金额 || 0
        });
      }
    });
    return giftMap;
  }

  let shopFilter = '';
  if (allowedShops && allowedShops.size > 0) {
    const shopList = Array.from(allowedShops).map(s => `'${s}'`).join(', ');
    shopFilter = ` AND 店铺名称 IN (${shopList})`;
  }

  const query = `
    SELECT 店铺名称, SUM(金额) as 礼包金额, SUM(数量) as 礼包数量
    FROM (
      SELECT 店铺名称, SUM(业绩金额) as 金额,
             CASE WHEN SUM(业绩金额) > 0 THEN 1 WHEN SUM(业绩金额) < 0 THEN -1 ELSE 0 END as 数量
      FROM 有效业绩全
      WHERE ${dateCondition} AND 仓库类别 IN ('直营','山东直营','加盟') AND 充值类型 = '充值' AND ISNULL(会员代码, '') <> ''
        ${shopFilter}
      GROUP BY 店铺名称, 会员代码, 单据编号
      UNION ALL
      SELECT 店铺名称, SUM(业绩金额) as 金额,
             CASE WHEN SUM(业绩金额) > 0 THEN 1 WHEN SUM(业绩金额) < 0 THEN -1 ELSE 0 END as 数量
      FROM 有效业绩全
      WHERE ${dateCondition} AND 仓库类别 IN ('直营','山东直营','加盟') AND 充值类型 = '充值' AND ISNULL(会员代码, '') = ''
        ${shopFilter}
      GROUP BY 店铺名称, 单据编号
    ) as a
    GROUP BY 店铺名称
  `;

  const result = await pool.request().query(query);
  const giftMap = new Map<string, { giftPackageCount: number; giftPackageAmount: number }>();
  result.recordset.forEach((row: any) => {
    giftMap.set(row.店铺名称, {
      giftPackageCount: row.礼包数量 || 0,
      giftPackageAmount: row.礼包金额 || 0
    });
  });
  return giftMap;
};

const getNewMembers = async (pool: sql.ConnectionPool, startDate: string, endDate: string, allowedShops?: Set<string>) => {
  const dxQuery = await getQueryFromDX(pool, '店铺新增会员人数', { startDate, endDate });
  if (dxQuery) {
    const result = await pool.request().query(dxQuery);
    const map = new Map<string, number>();
    result.recordset.forEach((row: any) => {
      if (!allowedShops || allowedShops.size === 0 || allowedShops.has(row.店铺名称)) {
        map.set(row.店铺名称, row.新增会员人数 || 0);
      }
    });
    return map;
  }
  return new Map<string, number>();
};

const getMainProductCount = async (pool: sql.ConnectionPool, startDate: string, endDate: string, allowedShops?: Set<string>) => {
  const dxQuery = await getQueryFromDX(pool, '店铺主推数量', { startDate, endDate });
  if (dxQuery) {
    const result = await pool.request().query(dxQuery);
    const map = new Map<string, number>();
    result.recordset.forEach((row: any) => {
      if (!allowedShops || allowedShops.size === 0 || allowedShops.has(row.店铺名称)) {
        map.set(row.店铺名称, row.主推数量 || 0);
      }
    });
    return map;
  }
  return new Map<string, number>();
};

const getOldMember = async (pool: sql.ConnectionPool, startDate: string, endDate: string, allowedShops?: Set<string>) => {
  let shopFilter = '';
  if (allowedShops && allowedShops.size > 0) {
    const shopList = Array.from(allowedShops).map(s => `'${s}'`).join(', ');
    shopFilter = ` AND 店铺名称 IN (${shopList})`;
  }
  const query = `
    SELECT 店铺名称, SUM(金额) as 会员贡献金额
    FROM 老会员全
    WHERE 日期 >= '${startDate}' AND 日期 <= '${endDate}'
      ${shopFilter}
    GROUP BY 店铺名称
  `;
  const result = await pool.request().query(query);
  const map = new Map<string, number>();
  result.recordset.forEach((row: any) => {
    map.set(row.店铺名称, row.会员贡献金额 || 0);
  });
  return map;
};

const getBirthdayMember = async (pool: sql.ConnectionPool, startDate: string, endDate: string, allowedShops?: Set<string>) => {
  const dxQuery = await getQueryFromDX(pool, '店铺生日会员贡献金额', { startDate, endDate });
  if (dxQuery) {
    const result = await pool.request().query(dxQuery);
    const map = new Map<string, number>();
    result.recordset.forEach((row: any) => {
      if (!allowedShops || allowedShops.size === 0 || allowedShops.has(row.店铺名称)) {
        map.set(row.店铺名称, row.生日会员贡献金额 || 0);
      }
    });
    return map;
  }
  return new Map<string, number>();
};

// 店铺信息缓存：避免每次请求都分页查询
const shopInfoCache = new Map<string, { data: Map<string, { area: string; districtManager: string; supervisor: string; warehouseType: string }>; ts: number }>();
const SHOP_CACHE_TTL = 2 * 60 * 1000; // 2分钟

const getShopInfo = async (pool: sql.ConnectionPool, groupName?: string, user?: JwtUserPayload | null) => {
  const cacheKey = `${groupName || '__all__'}|${user?.userCode || ''}`;
  const cached = shopInfoCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SHOP_CACHE_TTL) {
    return cached.data;
  }

  // Try DataExtraction first
  const dxQuery = await getQueryFromDX(pool, '店铺信息_区域区经督导', {});
  if (dxQuery) {
    const result = await pool.request().query(dxQuery);

    const permissionResult = await getStandardShopFilter(groupName, user);

    const shopInfoMap = new Map<string, { area: string; districtManager: string; supervisor: string; warehouseType: string }>();
    result.recordset.forEach((row: any) => {
      shopInfoMap.set(row.shopName, {
        area: row.area || '',
        districtManager: row.districtManager || '',
        supervisor: row.supervisor || '',
        warehouseType: row.warehouseType || ''
      });
    });

    // 应用权限过滤
    let filtered: Map<string, { area: string; districtManager: string; supervisor: string; warehouseType: string }>;
    if (!permissionResult.filter) {
      filtered = shopInfoMap;
    } else if (permissionResult.filter === '1=0') {
      filtered = new Map();
    } else {
      // filter 是 SQL WHERE 条件（区经/督导/店铺名称 IN），统一走 SQL 过滤
      filtered = await queryShopInfoFromDB(pool, groupName, permissionResult);
    }
    shopInfoCache.set(cacheKey, { data: filtered, ts: Date.now() });
    return filtered;
  }

  // fallback: 直接从数据库查询
  const permissionResult = await getStandardShopFilter(groupName, user);
  const fallback = await queryShopInfoFromDB(pool, groupName, permissionResult);
  shopInfoCache.set(cacheKey, { data: fallback, ts: Date.now() });
  return fallback;
};

async function queryShopInfoFromDB(pool: sql.ConnectionPool, groupName: string | undefined, permissionResult: any): Promise<Map<string, { area: string; districtManager: string; supervisor: string; warehouseType: string }>> {
  let baseQuery = `
    SELECT 店铺名称 as shopName, 仓库类别 as warehouseType, 区域 as area, 区经 as districtManager, 督导 as supervisor
    FROM 店仓全
  `;

  if (permissionResult.filter) {
    baseQuery += ` WHERE ${permissionResult.filter}`;
  } else {
    baseQuery += ` WHERE (仓库类别 = '直营' OR 仓库类别 = '山东直营' OR 仓库类别 = '加盟')`;
  }

  const allRecords: any[] = [];
  let offset = 0;
  const batchSize = 500;
  let hasMore = true;

  while (hasMore) {
    const query = `${baseQuery} ORDER BY shopName OFFSET ${offset} ROWS FETCH NEXT ${batchSize} ROWS ONLY`;
    const request = pool.request();
    permissionResult.params.forEach((p: any) => request.input(p.name, p.type, p.value));
    const result = await request.query(query);
    
    if (result.recordset.length > 0) {
      allRecords.push(...result.recordset);
      offset += batchSize;
      if (result.recordset.length < batchSize) {
        hasMore = false;
      }
    } else {
      hasMore = false;
    }
  }
  
  const shopInfoMap = new Map<string, { area: string; districtManager: string; supervisor: string; warehouseType: string }>();
  allRecords.forEach((row: any) => {
    shopInfoMap.set(row.shopName, {
      area: row.area || '',
      districtManager: row.districtManager || '',
      supervisor: row.supervisor || '',
      warehouseType: row.warehouseType || ''
    });
  });
  return shopInfoMap;
};

// 经销商映射：店仓全 中的 经销商 字段
const getDealerMap = async (pool: sql.ConnectionPool) => {
  const result = await pool.request().query('SELECT 店铺名称 as shopName, 经销商 as dealer FROM 店仓全');
  const map = new Map<string, string>();
  result.recordset.forEach((row: any) => map.set(row.shopName, row.dealer || ''));
  return map;
};

// 月可比性/年可比性映射：取店铺档案（店仓全）中的可比性字段
const getComparableMap = async (pool: sql.ConnectionPool) => {
  const result = await pool.request().query(`SELECT 店铺名称 as shopName, 月可比性 as monthComparable, 年可比性 as yearComparable FROM 店仓全`);
  const map = new Map<string, { monthComparable: string; yearComparable: string }>();
  result.recordset.forEach((row: any) => {
    if (row.shopName) map.set(String(row.shopName).trim(), { monthComparable: row.monthComparable ?? '', yearComparable: row.yearComparable ?? '' });
  });
  return map;
};

// 销售报表结果缓存（减轻重复刷新压力）
const salesCache = new Map<string, { data: any; ts: number }>();
const SALES_CACHE_TTL = 30 * 1000; // 30秒

router.get('/sales', async (req, res) => {
  try {
    const pool = await getPool();
    const { dateRange = 'yesterday', filterType = 'all', groupName, startDate, endDate } = req.query;
    const groupNameStr = typeof groupName === 'string' ? groupName : undefined;
    const startDateStr = typeof startDate === 'string' ? startDate : undefined;
    const endDateStr = typeof endDate === 'string' ? endDate : undefined;

    // 缓存键：查询参数组合 + 用户身份（防止跨用户/跨权限命中同一缓存泄漏数据）
    const cacheKey = `${dateRange}|${groupNameStr}|${startDateStr}|${endDateStr}|${req.user?.userCode || ''}`;
    const cached = salesCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < SALES_CACHE_TTL) {
      return res.json(cached.data);
    }

    const { dateCondition, targetCondition } = getDateConditions(dateRange as string, startDateStr, endDateStr);
    
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const todayDay = today.getDate();
    const timeProgress = todayDay / daysInMonth;
    
    const shopInfo = await getShopInfo(pool, groupNameStr, req.user || null);
    const allowedShops: Set<string> = new Set(shopInfo.keys());

    const { startDate: targetStartDate, endDate: targetEndDate } = getTargetDateRange(dateRange as string, startDateStr, endDateStr);

    // 计算去年同期（同比）日期间隔：当前报表区间各日期减1年
    const subYear = (d: string) => {
      const p = d.split('-').map(Number);
      return `${p[0] - 1}-${String(p[1]).padStart(2, '0')}-${String(p[2]).padStart(2, '0')}`;
    };
    const sameDateCondition = `日期 >= '${subYear(targetStartDate)}' AND 日期 <= '${subYear(targetEndDate)}'`;

    const [targets, amounts, avgPrices, gifts, newMembers, mainProducts, oldMembers, birthMembers, sameAmounts] = await Promise.all([
      getTargetsFromMonthlyTarget(pool, targetStartDate, targetEndDate, allowedShops),
      getAmounts(pool, dateCondition, allowedShops),
      getAvgPrices(pool, dateCondition, allowedShops),
      getGiftPackages(pool, dateCondition, allowedShops),
      getNewMembers(pool, targetStartDate, targetEndDate, allowedShops),
      getMainProductCount(pool, targetStartDate, targetEndDate, allowedShops),
      getOldMember(pool, targetStartDate, targetEndDate, allowedShops),
      getBirthdayMember(pool, targetStartDate, targetEndDate, allowedShops),
      getAmounts(pool, sameDateCondition, allowedShops)
    ]);

    console.log(`销售报表: ${dateRange} 日期范围, ${allowedShops.size} 店铺`);

    const allShops = new Set([
      ...targets.keys(),
      ...amounts.keys(),
      ...avgPrices.keys(),
      ...gifts.keys(),
      ...newMembers.keys(),
      ...mainProducts.keys(),
      ...oldMembers.keys(),
      ...birthMembers.keys()
    ]);

    const filteredShops = Array.from(allShops).filter(shopName => allowedShops.has(shopName));

    // 店铺 → 经销商 映射（供页面按经销商筛选；取全量店仓全，避免仓库类别过滤遗漏）
    const dealerResult = await pool.request().query(`
      SELECT 店铺名称 as shopName, 经销商 as dealer FROM 店仓全`);
    const dealerMap = new Map<string, string>();
    dealerResult.recordset.forEach((r: any) => { if (r.shopName) dealerMap.set(String(r.shopName).trim(), r.dealer || ''); });

    const comparableMap = await getComparableMap(pool);

    const result = filteredShops.map(shopName => {
      const target = targets.get(shopName) || 0;
      const achieved = amounts.get(shopName) || 0;
      const sameAchieved = sameAmounts.get(shopName) || 0;
      const avgPricesData = avgPrices.get(shopName) || { avgItemPrice: 0, avgOrderValue: 0, attachmentRate: 0, orderCount: 0, shoeAmount: 0, shoeQuantity: 0 };
      const giftData = gifts.get(shopName) || { giftPackageCount: 0, giftPackageAmount: 0 };
      const newMemberCount = newMembers.get(shopName) || 0;
      const mainProductCount = mainProducts.get(shopName) || 0;
      const oldMemberAmount = oldMembers.get(shopName) || 0;
      const birthMemberAmount = birthMembers.get(shopName) || 0;
      const info = shopInfo.get(shopName) || { area: '', districtManager: '', supervisor: '', warehouseType: '' };
      const shoeAmount = avgPricesData.shoeAmount || 0;
      const shoeQuantity = avgPricesData.shoeQuantity || 0;
      const orderCount = avgPricesData.orderCount || 0;

      return {
        shopName,
        warehouseType: info.warehouseType,
        area: info.area, districtManager: info.districtManager,
        supervisor: info.supervisor,
        dealer: dealerMap.get(String(shopName || '').trim()) || '',
        monthComparable: comparableMap.get(String(shopName || '').trim())?.monthComparable || '',
        yearComparable: comparableMap.get(String(shopName || '').trim())?.yearComparable || '',
        target,
        amount: Math.round(achieved),
        sameAmount: Math.round(sameAchieved),
        achievement: target > 0 ? (achieved * 100.0 / target) : 0,
        timeProgress: timeProgress * 100,
        quantity: Math.round(shoeQuantity),
        orderCount,
        avgOrderValue: orderCount !== 0 ? Math.round((shoeAmount / orderCount) * 10) / 10 : 0,
        avgItemPrice: shoeQuantity !== 0 ? Math.round((shoeAmount / shoeQuantity) * 10) / 10 : 0,
        attachmentRate: orderCount !== 0 ? (shoeQuantity / orderCount) : 0,
        giftPackageCount: Math.round(giftData.giftPackageCount),
        giftPackageAmount: Math.round(giftData.giftPackageAmount),
        newMemberCount,
        mainProductCount,
        oldMemberAmount,
        birthMemberAmount
      };
    });
    
    result.sort((a, b) => a.shopName.localeCompare(b.shopName));
    
    if (result.length === 0) {
      console.log('销售报表无数据');
      res.json({ data: [], timeProgress: timeProgress * 100 });
    } else {
      const response = { data: result, timeProgress: timeProgress * 100 };
      salesCache.set(cacheKey, { data: response, ts: Date.now() });
      res.json(response);
    }
  } catch (error: any) {
    console.error('获取销售报表失败:', error.message);
    res.status(500).json({ data: [], timeProgress: 64.5, error: error.message });
  }
});

const getCompareData = async (pool: sql.ConnectionPool, groupName?: string, compareType?: string, currentDate?: string | null, compareDate?: string | null, user?: JwtUserPayload | null) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const targetCondition = `年份 = ${year} AND 月份 = ${month} AND 仓库类别 = '直营'`;
  
  let yesterdayCondition: string;
  let todayCondition: string;
  let lastWeekCondition: string;
  
  if (compareType === 'custom' && currentDate && compareDate) {
    todayCondition = `日期 >= '${currentDate}' AND 日期 <= '${currentDate}'`;
    yesterdayCondition = `日期 >= '${compareDate}' AND 日期 <= '${compareDate}'`;
    const lastWeekDate = new Date(currentDate);
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);
    lastWeekCondition = `日期 >= '${lastWeekDate.toISOString().split('T')[0]}' AND 日期 <= '${lastWeekDate.toISOString().split('T')[0]}'`;
  } else if (compareType === 'month') {
    const lastMonth = month === 1 ? 12 : month - 1;
    const lastYear = month === 1 ? year - 1 : year;
    todayCondition = `日期 >= '${year}-${month.toString().padStart(2, '0')}-01' AND 日期 <= GETDATE()`;
    yesterdayCondition = `日期 >= '${lastYear}-${lastMonth.toString().padStart(2, '0')}-01' AND 日期 <= DATEADD(month, -1, '${year}-${month.toString().padStart(2, '0')}-01')`;
    const lastWeekDate = new Date(now);
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);
    lastWeekCondition = `日期 >= DATEADD(month, -1, '${year}-${month.toString().padStart(2, '0')}-01') AND 日期 <= DATEADD(day, -7, GETDATE())`;
  } else if (compareType === 'quarter') {
    const currentQuarter = Math.ceil(month / 3);
    const lastQuarterStartMonth = (currentQuarter - 2) * 3 + 1 || 10;
    const lastQuarterEndMonth = lastQuarterStartMonth + 2;
    const lastQuarterYear = currentQuarter === 1 ? year - 1 : year;
    const currentQuarterStartMonth = (currentQuarter - 1) * 3 + 1;
    todayCondition = `日期 >= '${year}-${currentQuarterStartMonth.toString().padStart(2, '0')}-01' AND 日期 <= GETDATE()`;
    yesterdayCondition = `日期 >= '${lastQuarterYear}-${lastQuarterStartMonth.toString().padStart(2, '0')}-01' AND 日期 <= '${lastQuarterYear}-${lastQuarterEndMonth.toString().padStart(2, '0')}-01'`;
    const lastWeekDate = new Date(now);
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);
    lastWeekCondition = `日期 >= DATEADD(day, -7, GETDATE()) AND 日期 <= GETDATE()`;
  } else if (compareType === 'year') {
    todayCondition = `日期 >= '${year}-01-01' AND 日期 <= GETDATE()`;
    yesterdayCondition = `日期 >= '${year - 1}-01-01' AND 日期 <= '${year - 1}-12-31'`;
    const lastWeekDate = new Date(now);
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);
    lastWeekCondition = `日期 >= DATEADD(day, -7, GETDATE()) AND 日期 <= GETDATE()`;
  } else {
    yesterdayCondition = "日期 >= GETDATE() - 2 AND 日期 <= GETDATE() - 1";
    todayCondition = "日期 >= GETDATE() - 1 AND 日期 <= GETDATE()";
    lastWeekCondition = "日期 >= DATEADD(day, -8, CONVERT(date, GETDATE())) AND 日期 <= DATEADD(day, -7, CONVERT(date, GETDATE()))";
  }
  
  const [targets, shopInfo] = await Promise.all([
    getTargets(pool, targetCondition),
    getShopInfo(pool, groupName, user || null)
  ]);
  
  const allowedShops: Set<string> = new Set(shopInfo.keys());
  
  const [yesterdayAmounts, yesterdayAvgPrices, yesterdayGifts,
         todayAmounts, todayAvgPrices, todayGifts,
         lastWeekAmounts, lastWeekAvgPrices, lastWeekGifts] = await Promise.all([
    getAmounts(pool, yesterdayCondition, allowedShops),
    getAvgPrices(pool, yesterdayCondition, allowedShops),
    getGiftPackages(pool, yesterdayCondition, allowedShops),
    getAmounts(pool, todayCondition, allowedShops),
    getAvgPrices(pool, todayCondition, allowedShops),
    getGiftPackages(pool, todayCondition, allowedShops),
    getAmounts(pool, lastWeekCondition, allowedShops),
    getAvgPrices(pool, lastWeekCondition, allowedShops),
    getGiftPackages(pool, lastWeekCondition, allowedShops)
  ]);

  const allShops = new Set([
    ...targets.keys(),
    ...yesterdayAmounts.keys(),
    ...yesterdayAvgPrices.keys(),
    ...yesterdayGifts.keys(),
    ...todayAmounts.keys(),
    ...todayAvgPrices.keys(),
    ...todayGifts.keys()
  ]);

  const filteredShops = Array.from(allShops).filter(shopName => allowedShops.has(shopName));

  const dayOfWeekMap = ['日', '一', '二', '三', '四', '五', '六'];
  const todayDay = new Date();
  const todayDayOfWeek = dayOfWeekMap[todayDay.getDay()];
  const lastWeekDay = new Date(todayDay);
  lastWeekDay.setDate(lastWeekDay.getDate() - 7);
  const lastWeekDayOfWeek = dayOfWeekMap[lastWeekDay.getDay()];

  return filteredShops.map(shopName => {
    const target = targets.get(shopName) || 0;

    const yAvgPrices = yesterdayAvgPrices.get(shopName) || { avgItemPrice: 0, avgOrderValue: 0, attachmentRate: 0, orderCount: 0, shoeAmount: 0, shoeQuantity: 0 };
    const yGifts = yesterdayGifts.get(shopName) || { giftPackageCount: 0, giftPackageAmount: 0 };
    const yAmount = yesterdayAmounts.get(shopName) || 0;
    const yQuantity = yAvgPrices.shoeQuantity || 0;
    const yOrderCount = yAvgPrices.orderCount || 0;

    const tAvgPrices = todayAvgPrices.get(shopName) || { avgItemPrice: 0, avgOrderValue: 0, attachmentRate: 0, orderCount: 0, shoeAmount: 0, shoeQuantity: 0 };
    const tGifts = todayGifts.get(shopName) || { giftPackageCount: 0, giftPackageAmount: 0 };
    const tAmount = todayAmounts.get(shopName) || 0;
    const tQuantity = tAvgPrices.shoeQuantity || 0;
    const tOrderCount = tAvgPrices.orderCount || 0;

    const lwAvgPrices = lastWeekAvgPrices.get(shopName) || { avgItemPrice: 0, avgOrderValue: 0, attachmentRate: 0, orderCount: 0, shoeAmount: 0, shoeQuantity: 0 };
    const lwGifts = lastWeekGifts.get(shopName) || { giftPackageCount: 0, giftPackageAmount: 0 };
    const lwAmount = lastWeekAmounts.get(shopName) || 0;
    const lwQuantity = lwAvgPrices.shoeQuantity || 0;
    const lwOrderCount = lwAvgPrices.orderCount || 0;

    const info = shopInfo.get(shopName) || { area: '', districtManager: '', supervisor: '', warehouseType: '' };

    // amount=业绩金额(无过滤)；quantity/orderCount来自鞋部分过滤
    const buildRecord = (amount: number, quantity: number, orderCount: number, shoeAmount: number, shoeQuantity: number, gifts: any) => ({
      target,
      amount: Math.round(amount),
      achievement: target > 0 ? (amount * 100.0 / target) : 0,
      quantity,
      orderCount,
      avgOrderValue: orderCount !== 0 ? Math.round((shoeAmount / orderCount) * 10) / 10 : 0,
      avgItemPrice: shoeQuantity !== 0 ? Math.round((shoeAmount / shoeQuantity) * 10) / 10 : 0,
      attachmentRate: orderCount !== 0 ? (shoeQuantity / orderCount) : 0,
      giftPackageCount: gifts.giftPackageCount,
      giftPackageAmount: Math.round(gifts.giftPackageAmount)
    });

    return {
      shopName,
      area: info.area, districtManager: info.districtManager,
      supervisor: info.supervisor,
        warehouseType: info.warehouseType,      todayDayOfWeek: `星期${todayDayOfWeek}`,
      lastWeekDayOfWeek: `星期${lastWeekDayOfWeek}`,
      yesterday: buildRecord(yAmount, yQuantity, yOrderCount, yAvgPrices.shoeAmount || 0, yQuantity, yGifts),
      today: buildRecord(tAmount, tQuantity, tOrderCount, tAvgPrices.shoeAmount || 0, tQuantity, tGifts),
      lastWeek: buildRecord(lwAmount, lwQuantity, lwOrderCount, lwAvgPrices.shoeAmount || 0, lwQuantity, lwGifts),
      amountGrowth: yAmount > 0 ? ((tAmount - yAmount) / yAmount * 100) : 0,
      quantityGrowth: yQuantity > 0 ? ((tQuantity - yQuantity) / yQuantity * 100) : 0,
      orderCountGrowth: yOrderCount > 0 ? ((tOrderCount - yOrderCount) / yOrderCount * 100) : 0,
      amountWeekGrowth: lwAmount > 0 ? ((tAmount - lwAmount) / lwAmount * 100) : 0,
      quantityWeekGrowth: lwQuantity > 0 ? ((tQuantity - lwQuantity) / lwQuantity * 100) : 0,
      orderCountWeekGrowth: lwOrderCount > 0 ? ((tOrderCount - lwOrderCount) / lwOrderCount * 100) : 0
    };
  });
};

router.get('/compare', async (req, res) => {
  try {
    const pool = await getPool();
    const { groupName, compareType, currentDate, compareDate } = req.query;
    const groupNameStr = typeof groupName === 'string' ? groupName : undefined;
    const compareTypeStr = typeof compareType === 'string' ? compareType : 'custom';
    const currentDateStr = typeof currentDate === 'string' ? currentDate : null;
    const compareDateStr = typeof compareDate === 'string' ? compareDate : null;
    const result = await getCompareData(pool, groupNameStr, compareTypeStr, currentDateStr, compareDateStr, req.user || null);
    
    if (result.length === 0) {
      console.log('对比报表无数据');
      res.json([]);
    } else {
      res.json(result);
    }
  } catch (error) {
    console.error('获取对比报表失败:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

const calculateScore = (data: any): number => {
  let score = 0;
  let totalWeight = 0;
  
  if (data.achievement !== undefined) {
    const achievementScore = Math.min(data.achievement, 100);
    score += achievementScore * 0.4;
    totalWeight += 0.4;
  }
  
  if (data.avgOrderValue !== undefined && data.avgOrderValue > 0) {
    const avgOrderScore = Math.min((data.avgOrderValue / 500) * 100, 100);
    score += avgOrderScore * 0.2;
    totalWeight += 0.2;
  }
  
  if (data.attachmentRate !== undefined) {
    const attachmentScore = Math.min(data.attachmentRate * 50, 100);
    score += attachmentScore * 0.2;
    totalWeight += 0.2;
  }
  
  if (data.giftPackageAmount !== undefined && data.giftPackageAmount > 0) {
    const giftScore = Math.min((data.giftPackageAmount / (data.amount || 1)) * 100 * 10, 100);
    score += giftScore * 0.2;
    totalWeight += 0.2;
  }
  
  return totalWeight > 0 ? Math.round(score / totalWeight) : 0;
};

router.get('/shop/7day-comparison', async (req, res) => {
  console.log('=== 7日对比API被调用 ===');
  console.log('查询参数:', req.query);
  
  const generateMockData = async () => {
    const mock7DayData: any[] = [];
    const today = new Date();
    const { groupName } = req.query;
    const groupNameStr = typeof groupName === 'string' ? groupName : undefined;
    
    let filteredShops: any[] = [];
    
    try {
      const pool = await getPool();
      const permissionResult = await getStandardShopFilter(groupNameStr, req.user || null);
      
      let query = `
        SELECT 店铺名称 as shopName, 区域 as area, 区经 as districtManager, 督导 as supervisor
        FROM 店仓全
      `;
      
      if (permissionResult.filter) {
        query += ` WHERE ${permissionResult.filter}`;
      }
      
      const request = pool.request();
      permissionResult.params.forEach((p: any) => request.input(p.name, p.type, p.value));
      
      const result = await request.query(query);
      filteredShops = result.recordset;
      
      console.log('从店铺档案查询到的店铺数量:', filteredShops.length);
    } catch (error) {
      console.log('从店铺档案获取店铺失败，使用店铺档案中的mock数据');
      filteredShops = [
        { shopName: '郑州东风路同乐店_ZY', area: '郑州', districtManager: '张新淼', supervisor: '刘小丽' },
        { shopName: '郑州丰产路店_ZY', area: '郑州', districtManager: '张新淼', supervisor: '刘小丽' },
        { shopName: '郑州丰乐路店_ZY', area: '郑州', districtManager: '张新淼', supervisor: '刘小丽' },
        { shopName: '郑州高新区长椿路一店_ZY', area: '郑州', districtManager: '张新淼', supervisor: '刘小丽' },
        { shopName: '郑州金水区三全路一店_ZY', area: '郑州', districtManager: '张新淼', supervisor: '刘小丽' },
        { shopName: '郑州惠济万达店_ZY', area: '郑州', districtManager: '张新淼', supervisor: '刘小趁' },
        { shopName: '郑州龙湖万佳广场店_ZY', area: '郑州', districtManager: '张新淼', supervisor: '刘小趁' },
        { shopName: '洛阳宝龙广场店_ZY', area: '洛阳', districtManager: '陈万龙', supervisor: '王娣' },
        { shopName: '洛阳涧东路店_ZY', area: '洛阳', districtManager: '陈万龙', supervisor: '陈会琴' },
        { shopName: '洛阳景华路店_ZY', area: '洛阳', districtManager: '陈万龙', supervisor: '陈会琴' },
        { shopName: '洛阳老城北大街店_ZY', area: '洛阳', districtManager: '陈万龙', supervisor: '郑欢欢' },
        { shopName: '洛阳中州路万达广场店_ZY', area: '洛阳', districtManager: '陈万龙', supervisor: '王娣' },
        { shopName: '南阳邓州店_ZY', area: '南阳', districtManager: '王璐', supervisor: '洪爽爽' },
        { shopName: '南阳方城店_ZY', area: '南阳', districtManager: '秦洁玉', supervisor: '秦洁玉' },
        { shopName: '南阳内乡店_ZY', area: '南阳', districtManager: '王璐', supervisor: '马云' },
        { shopName: '南阳西峡白羽路一店_ZY', area: '南阳', districtManager: '王璐', supervisor: '杨意凝' },
        { shopName: '南阳淅川步行街店_ZY', area: '南阳', districtManager: '王璐', supervisor: '杨意凝' },
        { shopName: '南阳镇平店_ZY', area: '南阳', districtManager: '王璐', supervisor: '马云' },
        { shopName: '焦作万达广场店_ZY', area: '焦作', districtManager: '宋姣龙', supervisor: '刘艳伟' },
        { shopName: '焦作博爱台北街二店_ZY', area: '焦作', districtManager: '宋姣龙', supervisor: '刘艳伟' },
        { shopName: '焦作恒兴店_ZY', area: '焦作', districtManager: '宋姣龙', supervisor: '刘艳伟' },
        { shopName: '焦作温县胖发祥店_ZY', area: '焦作', districtManager: '宋姣龙', supervisor: '刘艳伟' },
        { shopName: '焦作武陟和平路店_ZY', area: '焦作', districtManager: '宋姣龙', supervisor: '刘艳伟' },
        { shopName: '安阳龙安万达店_ZY', area: '焦作', districtManager: '宋姣龙', supervisor: '王卫军' },
        { shopName: '巩义宏发商城店_ZY', area: '焦作', districtManager: '宋姣龙', supervisor: '王卫军' },
      ];
    }
    
    console.log('使用店铺档案数据，店铺数量:', filteredShops.length);
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayOfWeek = date.getDay();
      
      const lastWeekSameDay = new Date(date);
      lastWeekSameDay.setDate(lastWeekSameDay.getDate() - 7);
      
      filteredShops.forEach(shop => {
        const baseAmount = 30000 + Math.random() * 20000;
        const amount = Math.round(baseAmount * (0.8 + Math.random() * 0.4));
        const lastWeekAmount = Math.round(baseAmount * (0.7 + Math.random() * 0.4));
        const quantity = Math.round(100 + Math.random() * 80);
        const orderCount = Math.round(50 + Math.random() * 40);
        
        const data = {
          date: dateStr,
          dayOfWeek: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dayOfWeek],
          shopName: shop.shopName,
          districtManager: shop.districtManager,
          supervisor: shop.supervisor,
          amount,
          quantity,
          orderCount,
          avgOrderValue: Math.round(300 + Math.random() * 100),
          avgItemPrice: Math.round(280 + Math.random() * 80),
          attachmentRate: Math.round((1.5 + Math.random() * 0.8) * 100) / 100,
          giftPackageCount: Math.round(5 + Math.random() * 10),
          giftPackageAmount: Math.round(1500 + Math.random() * 2000),
          target: 50000,
          achievement: Math.round((Math.random() * 30 + 70) * 10) / 10,
          score: Math.floor(75 + Math.random() * 25),
          amountGrowth: (Math.random() - 0.5) * 20,
          quantityGrowth: (Math.random() - 0.5) * 20,
          scoreGrowth: (Math.random() - 0.5) * 20,
          lastWeekAmount,
          lastWeekQuantity: Math.round(quantity * (0.7 + Math.random() * 0.4)),
          lastWeekOrderCount: Math.round(orderCount * (0.7 + Math.random() * 0.4)),
          lastWeekAttachmentRate: Math.round((1.4 + Math.random() * 0.6) * 100) / 100,
          lastWeekGiftPackageCount: Math.round(4 + Math.random() * 8),
          amountWeekGrowth: lastWeekAmount > 0 ? ((amount - lastWeekAmount) / lastWeekAmount * 100) : 0,
          quantityWeekGrowth: (Math.random() - 0.5) * 25,
          orderCountWeekGrowth: (Math.random() - 0.5) * 25,
          attachmentRateWeekGrowth: (Math.random() - 0.5) * 15,
          giftCountWeekGrowth: (Math.random() - 0.5) * 25
        };
        mock7DayData.push(data);
      });
    }
    return mock7DayData;
  };
  
  try {
    const pool = await getPool();
    const { shopName, groupName } = req.query;
    const groupNameStr = typeof groupName === 'string' ? groupName : undefined;
    const shopNameStr = typeof shopName === 'string' ? shopName : undefined;
    
    const [shopInfo, targets] = await Promise.all([
      getShopInfo(pool, groupNameStr, req.user || null),
      getTargets(pool, `年份 = ${new Date().getFullYear()} AND 月份 = ${new Date().getMonth() + 1} AND 仓库类别 IN ('直营','山东直营','加盟')`)
    ]);
    
    const allowedShops: Set<string> = new Set(shopInfo.keys());
    console.log('允许访问的店铺数量:', allowedShops.size);
    
    if (shopNameStr && !allowedShops.has(shopNameStr)) {
      return res.status(403).json({ message: '无权访问该店铺数据' });
    }
      
    const result: any[] = [];
    const today = new Date();
    
    for (let i = 2; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayOfWeek = date.getDay();
      const prevDay = new Date(date);
      prevDay.setDate(prevDay.getDate() - 1);
      const prevDayDateStr = prevDay.toISOString().split('T')[0];
      
      const dateCondition = `日期 >= '${dateStr}' AND 日期 <= '${dateStr}'`;
      const prevDayCondition = `日期 >= '${prevDayDateStr}' AND 日期 <= '${prevDayDateStr}'`;
      
      const [amounts, avgPrices, gifts, prevDayAmounts, prevDayAvgPrices, prevDayGifts] = await Promise.all([
        getAmounts(pool, dateCondition, allowedShops),
        getAvgPrices(pool, dateCondition, allowedShops),
        getGiftPackages(pool, dateCondition, allowedShops),
        getAmounts(pool, prevDayCondition, allowedShops),
        getAvgPrices(pool, prevDayCondition, allowedShops),
        getGiftPackages(pool, prevDayCondition, allowedShops)
      ]);

      const shopsToProcess = shopNameStr ? [shopNameStr] : Array.from(allowedShops);

      shopsToProcess.forEach(shop => {
        const avgPricesData = avgPrices.get(shop) || { avgItemPrice: 0, avgOrderValue: 0, attachmentRate: 0, orderCount: 0, shoeAmount: 0, shoeQuantity: 0 };
        const giftData = gifts.get(shop) || { giftPackageCount: 0, giftPackageAmount: 0 };
        const amount = amounts.get(shop) || 0;
        const shoeAmount = avgPricesData.shoeAmount || 0;
        const quantity = avgPricesData.shoeQuantity || 0;
        const orderCount = avgPricesData.orderCount || 0;

        const prevDayAvgPricesData = prevDayAvgPrices.get(shop) || { avgItemPrice: 0, avgOrderValue: 0, attachmentRate: 0, orderCount: 0, shoeAmount: 0, shoeQuantity: 0 };
        const prevDayGiftData = prevDayGifts.get(shop) || { giftPackageCount: 0, giftPackageAmount: 0 };
        const prevDayAmount = prevDayAmounts.get(shop) || 0;
        const prevDayShoeAmount = prevDayAvgPricesData.shoeAmount || 0;
        const prevDayQuantity = prevDayAvgPricesData.shoeQuantity || 0;
        const prevDayOrderCount = prevDayAvgPricesData.orderCount || 0;

        const target = targets.get(shop) || 0;
        const info = shopInfo.get(shop) || { area: '', districtManager: '', supervisor: '', warehouseType: '' };

        const dailyData: any = {
          date: dateStr,
          dayOfWeek: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dayOfWeek],
          shopName: shop,
          area: info.area, districtManager: info.districtManager,
          supervisor: info.supervisor,
        warehouseType: info.warehouseType,          amount: Math.round(amount),
          quantity,
          orderCount,
          avgOrderValue: orderCount !== 0 ? Math.round((shoeAmount / orderCount) * 10) / 10 : 0,
          avgItemPrice: quantity !== 0 ? Math.round((shoeAmount / quantity) * 10) / 10 : 0,
          attachmentRate: orderCount !== 0 ? (quantity / orderCount) : 0,
          giftPackageCount: giftData.giftPackageCount,
          giftPackageAmount: Math.round(giftData.giftPackageAmount),
          target,
          achievement: target > 0 ? (amount * 100.0 / target) : 0,
          prevDayAmount: Math.round(prevDayAmount),
          prevDayQuantity,
          prevDayOrderCount,
          prevDayAttachmentRate: prevDayOrderCount !== 0 ? (prevDayQuantity / prevDayOrderCount) : 0,
          prevDayGiftPackageCount: prevDayGiftData.giftPackageCount
        };

        dailyData.score = calculateScore(dailyData);

        if (i > 0 && result.length > 0) {
          const prevDay = result.find(r => r.shopName === shop && r.date === result[result.length - 1].date);
          if (prevDay) {
            dailyData.amountGrowth = prevDay.amount > 0 ? ((dailyData.amount - prevDay.amount) / prevDay.amount * 100) : 0;
            dailyData.quantityGrowth = prevDay.quantity > 0 ? ((dailyData.quantity - prevDay.quantity) / prevDay.quantity * 100) : 0;
            dailyData.scoreGrowth = prevDay.score > 0 ? ((dailyData.score - prevDay.score) / prevDay.score * 100) : 0;
          }
        }

        dailyData.amountWeekGrowth = prevDayShoeAmount > 0 ? ((shoeAmount - prevDayShoeAmount) / prevDayShoeAmount * 100) : 0;
        dailyData.quantityWeekGrowth = prevDayQuantity > 0 ? ((quantity - prevDayQuantity) / prevDayQuantity * 100) : 0;
        dailyData.orderCountWeekGrowth = prevDayOrderCount > 0 ? ((orderCount - prevDayOrderCount) / prevDayOrderCount * 100) : 0;
        dailyData.attachmentRateWeekGrowth = (prevDayAvgPricesData.attachmentRate || 0) > 0
          ? (((avgPricesData.attachmentRate || 0) - (prevDayAvgPricesData.attachmentRate || 0)) / (prevDayAvgPricesData.attachmentRate || 0) * 100) : 0;
        dailyData.giftCountWeekGrowth = prevDayGiftData.giftPackageCount > 0 ? ((giftData.giftPackageCount - prevDayGiftData.giftPackageCount) / prevDayGiftData.giftPackageCount * 100) : 0;

        result.push(dailyData);
      });
    }
    
    if (result.length === 0) {
      console.log('7日对比无数据');
      res.json([]);
    } else {
      console.log('返回7日对比数据，条数:', result.length);
      res.json(result);
    }
  } catch (error) {
    console.error('获取7日对比数据失败:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/staff-sales-target', async (req, res) => {
  try {
    const pool = await getPool();
    const { dateRange = 'month', groupName, startDate, endDate } = req.query;
    const groupNameStr = typeof groupName === 'string' ? groupName : undefined;
    const startDateStr = typeof startDate === 'string' ? startDate : undefined;
    const endDateStr = typeof endDate === 'string' ? endDate : undefined;
    
    console.log('=== 店员销售指标API被调用 ===');
    console.log('dateRange:', dateRange);
    console.log('groupName:', groupNameStr);
    console.log('startDate:', startDateStr);
    console.log('endDate:', endDateStr);
    
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const todayDay = today.getDate();
    const timeProgress = todayDay / daysInMonth;
    
    const { dateCondition } = getDateConditions(dateRange as string, startDateStr, endDateStr);
    
    const [shopInfo, permissionResult] = await Promise.all([
      getShopInfo(pool, groupNameStr, req.user || null),
      getStandardShopFilter(groupNameStr, req.user || null)
    ]);
    
    const allowedShops: Set<string> = new Set(shopInfo.keys());
    console.log('允许访问的店铺数量:', allowedShops.size);
    
    // Try DataExtraction first for shoe detail query
    const dxShoeQuery = await getQueryFromDX(pool, '店员鞋包销售明细', { dateCondition });
    const query = dxShoeQuery ? (console.log('staff-sales-target shoe query using DX'), dxShoeQuery) : `
      SELECT
        店铺名称,
        店员名称,
        SUM(业绩金额) as shoeAmount,
        SUM(数量) as quantity,
        SUM(开单数) as orderCount
      FROM (
        SELECT 店铺名称, ISNULL(店员名称, '') as 店员名称, SUM(业绩金额) as 业绩金额, SUM(数量) as 数量,
               CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END as 开单数
        FROM 有效业绩全
        WHERE ${dateCondition} AND 仓库类别 IN ('直营','山东直营','加盟')
          AND 会员代码 <> ''
          AND 性别 IN ('男鞋', '女鞋', '童鞋', '包')
          AND 款式 <> '洞洞鞋'
          AND ISNULL(店员名称, '') <> ''
        GROUP BY 店铺名称, ISNULL(店员名称, ''), 会员代码
        HAVING SUM(数量) <> 0
        UNION ALL
        SELECT 店铺名称, ISNULL(店员名称, '') as 店员名称, SUM(业绩金额) as 业绩金额, SUM(数量) as 数量,
               CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END as 开单数
        FROM 有效业绩全
        WHERE ${dateCondition} AND 仓库类别 IN ('直营','山东直营','加盟')
          AND 会员代码 IS NULL
          AND 性别 IN ('男鞋', '女鞋', '童鞋', '包')
          AND 款式 <> '洞洞鞋'
          AND ISNULL(店员名称, '') <> ''
        GROUP BY 店铺名称, ISNULL(店员名称, ''), 单据编号
        HAVING SUM(数量) <> 0
      ) as a
      GROUP BY 店铺名称, 店员名称
    `;

    // 业绩金额单独查询(无款式/性别过滤)，保证与其他报表一致
    const dxAchievedQuery = await getQueryFromDX(pool, '店员业绩金额', { dateCondition });
    const achievedQuery = dxAchievedQuery ? (console.log('staff-sales-target achieved using DX'), dxAchievedQuery) : `
      SELECT 店铺名称, ISNULL(店员名称, '') as 店员名称, SUM(业绩金额) as achieved
      FROM 有效业绩全
      WHERE ${dateCondition} AND 仓库类别 IN ('直营','山东直营','加盟')
        AND ISNULL(店员名称, '') <> ''
      GROUP BY 店铺名称, ISNULL(店员名称, '')
    `;
    
    const shoeResult = await pool.request().query(query);
    const allRecords = shoeResult.recordset;
    console.log('店员销售查询返回条数:', allRecords.length);
    console.log('允许访问的店铺数量:', allowedShops.size);
    
    const dxGiftQuery = await getQueryFromDX(pool, '店员礼包业绩', { dateCondition });
    const giftQuery = dxGiftQuery ? (console.log('staff-sales-target gift using DX'), dxGiftQuery) : `
      SELECT
        店铺名称,
        店员名称,
        SUM(礼包金额) as giftPackageAmount,
        SUM(礼包数量) as giftPackageCount
      FROM (
        SELECT
          店铺名称,
          店员名称,
          SUM(业绩金额) as 礼包金额,
          CASE WHEN SUM(业绩金额) > 0 THEN 1 WHEN SUM(业绩金额) < 0 THEN -1 ELSE 0 END as 礼包数量
        FROM 有效业绩全
        WHERE ${dateCondition} AND 仓库类别 IN ('直营','山东直营','加盟')
          AND 充值类型 = '充值' AND ISNULL(会员代码, '') <> ''
          AND 性别 IN ('男鞋', '女鞋', '童鞋', '包')
          AND ISNULL(店员名称, '') <> ''
        GROUP BY 店铺名称, 店员名称, 单据编号
      ) as temp
      GROUP BY 店铺名称, 店员名称
    `;
    
    const giftResult = await pool.request().query(giftQuery);
    const achievedResult = await pool.request().query(achievedQuery);

    const giftMap = new Map<string, { giftPackageCount: number; giftPackageAmount: number }>();
    giftResult.recordset.forEach((row: any) => {
      const key = `${row.店铺名称}_${row.店员名称}`;
      giftMap.set(key, {
        giftPackageCount: Math.abs(row.giftPackageCount || 0),
        giftPackageAmount: Math.round(row.giftPackageAmount || 0)
      });
    });

    const achievedMap = new Map<string, number>();
    achievedResult.recordset.forEach((row: any) => {
      const key = `${row.店铺名称}_${row.店员名称}`;
      achievedMap.set(key, row.achieved || 0);
    });
    
    console.log('Gift records found:', giftResult.recordset.length);
    console.log('Gift map keys:', Array.from(giftMap.keys()));
    console.log('Achieved records found:', achievedResult.recordset.length);
    
    const dxTargetQuery = await getQueryFromDX(pool, '店员目标_来自落地121', { dateCondition });
    const targetQuery = dxTargetQuery ? (console.log('staff-sales-target target using DX'), dxTargetQuery) : `
      SELECT
        店铺名称,
        店员名称,
        SUM(业绩目标) as target
      FROM 落地121
      WHERE ${dateCondition}
      GROUP BY 店铺名称, 店员名称
    `;
    
    const targetResult = await pool.request().query(targetQuery);
    console.log('落地121表查询到的店员数量:', targetResult.recordset.length);
    
    const targetMap = new Map<string, number>();
    targetResult.recordset.forEach((row: any) => {
      const key = `${row.店铺名称}_${row.店员名称}`;
      targetMap.set(key, (targetMap.get(key) || 0) + (row.target || 0));
    });

    // 店铺 → 经销商 映射（供页面按经销商筛选；取全量店仓全，避免仓库类别过滤遗漏）
    const dealerResult = await pool.request().query(`
      SELECT 店铺名称 as shopName, 经销商 as dealer FROM 店仓全`);
    const dealerMap = new Map<string, string>();
    dealerResult.recordset.forEach((r: any) => { if (r.shopName) dealerMap.set(String(r.shopName).trim(), r.dealer || ''); });

    const comparableMap = await getComparableMap(pool);

    const staffData = allRecords.map((row: any) => {
      const key = `${row.店铺名称}_${row.店员名称}`;
      const target = targetMap.get(key) || 0;
      const achieved = achievedMap.get(key) || 0;
      const quantity = row.quantity || 0;
      const orderCount = row.orderCount || 0;
      const shoeAmount = row.shoeAmount || 0;
      const giftData = giftMap.get(key) || { giftPackageCount: 0, giftPackageAmount: 0 };
      const info = shopInfo.get(row.店铺名称) || { area: '', districtManager: '', supervisor: '', warehouseType: '' };

      return {
        shopName: row.店铺名称,
        staffName: row.店员名称,
        area: info.area, districtManager: info.districtManager,
        supervisor: info.supervisor,
        warehouseType: info.warehouseType,
        dealer: dealerMap.get(String(row.店铺名称 || '').trim()) || '',
        monthComparable: comparableMap.get(String(row.店铺名称 || '').trim())?.monthComparable || '',
        yearComparable: comparableMap.get(String(row.店铺名称 || '').trim())?.yearComparable || '',
        target,
        achieved: Math.round(achieved),
        quantity: Math.round(quantity),
        orderCount,
        avgOrderValue: orderCount !== 0 ? Math.round((shoeAmount / orderCount) * 10) / 10 : 0,
        avgItemPrice: quantity !== 0 ? Math.round((shoeAmount / quantity) * 10) / 10 : 0,
        attachmentRate: orderCount !== 0 ? (quantity / orderCount) : 0,
        giftPackageCount: Math.round(giftData.giftPackageCount),
        giftPackageAmount: Math.round(giftData.giftPackageAmount),
        timeProgress: timeProgress * 100
      };
    }).filter((item: any) => allowedShops.has(item.shopName));
    
    staffData.sort((a: any, b: any) => {
      const shopCompare = a.shopName.localeCompare(b.shopName);
      return shopCompare !== 0 ? shopCompare : a.staffName.localeCompare(b.staffName);
    });
    
    res.json({ data: staffData, timeProgress: timeProgress * 100 });
  } catch (error) {
    console.error('获取店员销售指标失败:', error);
    res.status(500).json({ data: [], timeProgress: 0, error: (error as Error).message });
  }
});

const ALLOWED_LANDING_SHOPS = ['河南辉县时代广场六店_JM', '郑州惠济万达店_ZY'];

router.get('/landing121', async (req, res) => {
  try {
    const pool = await getPool();
    const { startDate = '2026-06-09', endDate = '2026-06-28' } = req.query;
    const dateCondition = `日期 >= CONVERT(date, '${startDate}') AND 日期 <= CONVERT(date, '${endDate}')`;
    const shopInList = `'河南辉县时代广场六店_JM', '郑州惠济万达店_ZY'`;
    const shopNames = "'河南辉县时代广场六店_JM','郑州惠济万达店_ZY'";
    const LANDING_WAREHOUSE_TYPE = "仓库类别 IN ('直营', '山东直营','加盟')";

    // ========== 1. 业绩金额（无款式/性别过滤，按店铺+店员汇总）==========
    const dxLandingAchieved = await getQueryFromDX(pool, '落地店员业绩金额', { startDate: String(startDate), endDate: String(endDate), shopNames });
    const achievedQuery = dxLandingAchieved ? (console.log('landing121 achieved using DX'), dxLandingAchieved) : `
      SELECT
        店铺名称,
        ISNULL(店员名称, '') as 店员名称,
        SUM(业绩金额) as achieved
      FROM 有效业绩全
      WHERE ${dateCondition} AND ${LANDING_WAREHOUSE_TYPE}
        AND 店铺名称 IN (${shopInList})
        AND ISNULL(店员名称, '') <> ''
      GROUP BY 店铺名称, ISNULL(店员名称, '')
    `;

    // ========== 2. 鞋金额/数量/开单数（带款式洞洞鞋+性别过滤，会员+非会员UNION ALL，按店铺+店员汇总）==========
    const dxLandingQuantity = await getQueryFromDX(pool, '落地店员鞋包销售明细', { startDate: String(startDate), endDate: String(endDate), shopNames });
    const quantityQuery = dxLandingQuantity ? (console.log('landing121 quantity using DX'), dxLandingQuantity) : `
      SELECT
        店铺名称,
        店员名称,
        SUM(业绩金额) as shoeAmount,
        SUM(数量) as quantity,
        SUM(开单数) as orderCount
      FROM (
        SELECT 店铺名称, ISNULL(店员名称, '') as 店员名称, SUM(业绩金额) as 业绩金额, SUM(数量) as 数量,
               CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END as 开单数
        FROM 有效业绩全
        WHERE ${dateCondition} AND ${LANDING_WAREHOUSE_TYPE}
          AND 会员代码 <> ''
          AND 性别 IN ('男鞋', '女鞋', '童鞋', '包')
          AND 款式 <> '洞洞鞋'
          AND 店铺名称 IN (${shopInList})
          AND ISNULL(店员名称, '') <> ''
        GROUP BY 店铺名称, ISNULL(店员名称, ''), 会员代码
        HAVING SUM(数量) <> 0
        UNION ALL
        SELECT 店铺名称, ISNULL(店员名称, '') as 店员名称, SUM(业绩金额) as 业绩金额, SUM(数量) as 数量,
               CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END as 开单数
        FROM 有效业绩全
        WHERE ${dateCondition} AND ${LANDING_WAREHOUSE_TYPE}
          AND 会员代码 IS NULL
          AND 性别 IN ('男鞋', '女鞋', '童鞋', '包')
          AND 款式 <> '洞洞鞋'
          AND 店铺名称 IN (${shopInList})
          AND ISNULL(店员名称, '') <> ''
        GROUP BY 店铺名称, ISNULL(店员名称, ''), 单据编号
        HAVING SUM(数量) <> 0
      ) as a
      GROUP BY 店铺名称, 店员名称
    `;

    // ========== 3. 消费会员数（按店铺+店员）==========
    const dxLandingCustomer = await getQueryFromDX(pool, '落地店员消费会员数', { startDate: String(startDate), endDate: String(endDate), shopNames });
    const customerCountQuery = dxLandingCustomer ? (console.log('landing121 customerCount using DX'), dxLandingCustomer) : `
      SELECT
        店铺名称,
        ISNULL(店员名称, '') as 店员名称,
        SUM(消费会员数) as customerCount
      FROM (
        SELECT 店铺名称, ISNULL(店员名称, '') as 店员名称, 会员代码,
               CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END as 消费会员数
        FROM 有效业绩全
        WHERE ${dateCondition} AND ${LANDING_WAREHOUSE_TYPE}
          AND 款式 <> '洞洞鞋'
          AND 会员代码 <> ''
          AND 店铺名称 IN (${shopInList})
          AND ISNULL(店员名称, '') <> ''
        GROUP BY 店铺名称, ISNULL(店员名称, ''), 会员代码
        HAVING SUM(数量) <> 0
      ) as a
      GROUP BY 店铺名称, ISNULL(店员名称, '')
    `;

    // ========== 4. 礼包数/礼包额（按店铺+店员）==========
    const dxLandingGift = await getQueryFromDX(pool, '落地店员礼包业绩', { startDate: String(startDate), endDate: String(endDate), shopNames });
    const giftPackageQuery = dxLandingGift ? (console.log('landing121 giftPackage using DX'), dxLandingGift) : `
      SELECT
        店铺名称,
        ISNULL(店员名称, '') as 店员名称,
        SUM(礼包数量) as giftPackageCount,
        SUM(礼包金额) as giftPackageAmount
      FROM (
        SELECT
          店铺名称,
          ISNULL(店员名称, '') as 店员名称,
          SUM(业绩金额) as 礼包金额,
          CASE WHEN SUM(业绩金额) > 0 THEN 1 WHEN SUM(业绩金额) < 0 THEN -1 ELSE 0 END as 礼包数量
        FROM 有效业绩全
        WHERE ${dateCondition} AND ${LANDING_WAREHOUSE_TYPE}
          AND 充值类型 = '充值'
          AND 会员代码 <> ''
          AND ISNULL(店员名称, '') <> ''
          AND 店铺名称 IN (${shopInList})
        GROUP BY 店铺名称, ISNULL(店员名称, ''), 单据编号
      ) as temp
      GROUP BY 店铺名称, ISNULL(店员名称, '')
    `;

    // ========== 5. 目标（从落地121表取，按店铺+店员）==========
    const dxLandingTarget = await getQueryFromDX(pool, '落地店员全目标_来自落地121', { startDate: String(startDate), endDate: String(endDate), shopNames });
    const targetQuery = dxLandingTarget ? (console.log('landing121 target using DX'), dxLandingTarget) : `
      SELECT
        店铺名称,
        ISNULL(店员名称, '') as 店员名称,
        SUM(业绩目标) as salesTarget,
        AVG(客单价目标) as avgOrderValueTarget,
        AVG(ISNULL(件单价目标, 0)) as unitPriceTarget,
        SUM(开单数目标) as orderCountTarget,
        AVG(连带率目标) as attachmentRateTarget,
        SUM(消费人数目标) as customerCountTarget,
        SUM(礼包数目标) as giftPackageCountTarget,
        SUM(礼包额目标) as giftPackageAmountTarget
      FROM 落地121
      WHERE ${dateCondition}
        AND 店铺名称 IN (${shopInList})
        AND ISNULL(店员名称, '') <> ''
      GROUP BY 店铺名称, ISNULL(店员名称, '')
    `;

    // ========== 执行查询 ==========
    const [achievedResult, quantityResult, customerCountResult, giftPackageResult, targetResult] =
      await Promise.all([
        pool.request().query(achievedQuery),
        pool.request().query(quantityQuery),
        pool.request().query(customerCountQuery),
        pool.request().query(giftPackageQuery),
        pool.request().query(targetQuery),
      ]);

    // ========== 构建结果（按店铺+店员合并）==========
    // 先从所有查询中收集所有出现过的(店铺名称, 店员名称)组合
    const staffKeySet = new Set<string>();
    const allStaff: { shopName: string; staffName: string }[] = [];
    const addStaff = (shop: string, staff: string) => {
      const key = `${shop}_${staff}`;
      if (!staffKeySet.has(key)) {
        staffKeySet.add(key);
        allStaff.push({ shopName: shop, staffName: staff });
      }
    };
    achievedResult.recordset.forEach((r: any) => addStaff(r.店铺名称, r.店员名称));
    quantityResult.recordset.forEach((r: any) => addStaff(r.店铺名称, r.店员名称));
    targetResult.recordset.forEach((r: any) => addStaff(r.店铺名称, r.店员名称));

    // Map化各个结果
    const achievedMap = new Map<string, number>();
    achievedResult.recordset.forEach((r: any) => achievedMap.set(`${r.店铺名称}_${r.店员名称}`, r.achieved || 0));

    const quantityMap = new Map<string, { shoeAmount: number; quantity: number; orderCount: number }>();
    quantityResult.recordset.forEach((r: any) => quantityMap.set(`${r.店铺名称}_${r.店员名称}`, {
      shoeAmount: r.shoeAmount || 0,
      quantity: r.quantity || 0,
      orderCount: r.orderCount || 0
    }));

    const customerMap = new Map<string, number>();
    customerCountResult.recordset.forEach((r: any) => customerMap.set(`${r.店铺名称}_${r.店员名称}`, r.customerCount || 0));

    const giftMap = new Map<string, { count: number; amount: number }>();
    giftPackageResult.recordset.forEach((r: any) => giftMap.set(`${r.店铺名称}_${r.店员名称}`, {
      count: Math.abs(r.giftPackageCount || 0),
      amount: r.giftPackageAmount || 0
    }));

    const targetMap = new Map<string, any>();
    targetResult.recordset.forEach((r: any) => targetMap.set(`${r.店铺名称}_${r.店员名称}`, {
      salesTarget: r.salesTarget || 0,
      avgOrderValueTarget: r.avgOrderValueTarget || 0,
      unitPriceTarget: r.unitPriceTarget || 0,
      orderCountTarget: r.orderCountTarget || 0,
      attachmentRateTarget: r.attachmentRateTarget || 0,
      customerCountTarget: r.customerCountTarget || 0,
      giftPackageCountTarget: r.giftPackageCountTarget || 0,
      giftPackageAmountTarget: r.giftPackageAmountTarget || 0
    }));

    // ========== 组装最终结果 ==========
    const result = allStaff.map(({ shopName, staffName }) => {
      const key = `${shopName}_${staffName}`;
      const achieved = achievedMap.get(key) || 0;
      const qData = quantityMap.get(key) || { shoeAmount: 0, quantity: 0, orderCount: 0 };
      const customerCount = customerMap.get(key) || 0;
      const gift = giftMap.get(key) || { count: 0, amount: 0 };
      const target = targetMap.get(key) || {};

      const shoeAmount = qData.shoeAmount;
      const quantity = qData.quantity;
      const orderCount = qData.orderCount;
      const unitPrice = quantity !== 0 ? shoeAmount / quantity : 0;
      const avgOrderValue = orderCount !== 0 ? shoeAmount / orderCount : 0;
      const attachmentRate = orderCount !== 0 ? quantity / orderCount : 0;

      return {
        date: endDate,
        shopName,
        staffName,
        salesTarget: target.salesTarget || 0,
        salesAmount: Math.round(achieved),
        shoeSalesAmount: Math.round(shoeAmount),
        avgOrderValueTarget: target.avgOrderValueTarget || 0,
        avgOrderValue: Math.round(avgOrderValue * 10) / 10,
        unitPriceTarget: target.unitPriceTarget || 0,
        unitPrice: Math.round(unitPrice * 10) / 10,
        orderCountTarget: target.orderCountTarget || 0,
        orderCount: Math.abs(orderCount),
        memberOrderCount: 0,
        nonMemberOrderCount: 0,
        attachmentRateTarget: target.attachmentRateTarget || 0,
        attachmentRate: Math.round(attachmentRate * 100) / 100,
        quantityTarget: 0,
        quantity,
        customerCountTarget: target.customerCountTarget || 0,
        customerCount,
        giftPackageCountTarget: target.giftPackageCountTarget || 0,
        giftPackageCount: gift.count,
        giftPackageAmountTarget: target.giftPackageAmountTarget || 0,
        giftPackageAmount: gift.amount,
      };
    });

    result.sort((a, b) => {
      const rateA = a.salesTarget > 0 ? (a.salesAmount / a.salesTarget) : 0;
      const rateB = b.salesTarget > 0 ? (b.salesAmount / b.salesTarget) : 0;
      return rateB - rateA;
    });

    res.json(result);
  } catch (error) {
    console.error('获取落地121数据失败:', error);
    res.status(500).json({ error: String(error) });
  }
});

router.get('/landing-detail', async (req, res) => {
  try {
    const pool = await getPool();
    const { startDate = '2026-06-11', endDate = '2026-06-11', shopName = '郑州惠济万达店_ZY' } = req.query;
    
    const dxDetailQuery = await getQueryFromDX(pool, '店铺订单级别明细', { startDate: String(startDate), endDate: String(endDate), shopName: String(shopName) });
    const detailQuery = dxDetailQuery ? (console.log('landing-detail using DX'), dxDetailQuery) : `
      SELECT
        店铺名称,
        店员名称,
        会员代码,
        单据编号,
        SUM(业绩金额) as 业绩金额,
        SUM(数量) as 数量,
        CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END as 开单数
      FROM 有效业绩全
      WHERE 日期 >= CONVERT(date, '${startDate}') AND 日期 <= CONVERT(date, '${endDate}')
        AND 店铺名称 = '${shopName}'
        AND 性别 IN ('男鞋', '女鞋', '童鞋', '包')
        AND 款式 <> '洞洞鞋'
        AND 会员代码 <> ''
      GROUP BY 店铺名称, 店员名称, 会员代码, 单据编号
      HAVING SUM(数量) <> 0
      UNION ALL
      SELECT
        店铺名称,
        店员名称,
        '非会员' as 会员代码,
        单据编号,
        SUM(业绩金额) as 业绩金额,
        SUM(数量) as 数量,
        CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END as 开单数
      FROM 有效业绩全
      WHERE 日期 >= CONVERT(date, '${startDate}') AND 日期 <= CONVERT(date, '${endDate}')
        AND 店铺名称 = '${shopName}'
        AND 性别 IN ('男鞋', '女鞋', '童鞋', '包')
        AND 款式 <> '洞洞鞋'
        AND 会员代码 IS NULL
      GROUP BY 店铺名称, 店员名称, 单据编号
      HAVING SUM(数量) <> 0
      ORDER BY 店铺名称, 店员名称, 会员代码, 单据编号
    `;
    
    const result = await pool.request().query(detailQuery);
    console.log('=== 开单数详细数据 ===');
    console.log(JSON.stringify(result.recordset, null, 2));
    
    res.json({
      startDate,
      endDate,
      shopName,
      totalRecords: result.recordset.length,
      totalOrderCount: result.recordset.reduce((sum, row) => sum + row.开单数, 0),
      totalAmount: result.recordset.reduce((sum, row) => sum + row.业绩金额, 0),
      totalQuantity: result.recordset.reduce((sum, row) => sum + row.数量, 0),
      details: result.recordset
    });
  } catch (error) {
    console.error('获取开单数详细数据失败:', error);
    res.status(500).json({ error: '获取数据失败' });
  }
});

router.get('/shop-diagnosis', async (req, res) => {
  try {
    const pool = await getPool();
    const {
      currentStartDate,
      currentEndDate,
      momStartDate,
      momEndDate,
      yearStartDate,
      yearEndDate,
      shopName,
      area,
      supervisor,
      districtManager,
      groupName
    } = req.query;

    const groupNameStr = typeof groupName === 'string' ? groupName : undefined;

    const [shopInfo] = await Promise.all([
      getShopInfo(pool, groupNameStr, req.user || null)
    ]);

    const allowedShops: Set<string> = new Set(shopInfo.keys());
    console.log('[shop-diagnosis] 权限内店铺数:', allowedShops.size, 'groupName:', groupNameStr);

    const currentDateCondition = `日期 >= '${currentStartDate}' AND 日期 <= '${currentEndDate}'`;
    const momDateCondition = momStartDate && momEndDate
      ? `日期 >= '${momStartDate}' AND 日期 <= '${momEndDate}'`
      : null;
    const yearDateCondition = yearStartDate && yearEndDate
      ? `日期 >= '${yearStartDate}' AND 日期 <= '${yearEndDate}'`
      : null;

    // 本环同三期数据
    const [currentAmounts, currentQuantities, currentAvgPrices, currentGifts, currentNewMembers, currentOldMembers] = await Promise.all([
      getAmounts(pool, currentDateCondition, allowedShops),
      getQuantities(pool, currentDateCondition, allowedShops),
      getAvgPrices(pool, currentDateCondition, allowedShops),
      getGiftPackages(pool, currentDateCondition, allowedShops),
      getNewMembers(pool, String(currentStartDate), String(currentEndDate), allowedShops),
      getOldMember(pool, String(currentStartDate), String(currentEndDate), allowedShops),
    ]);

    const [momAmounts, momQuantities, momAvgPrices, momGifts, momNewMembers, momOldMembers] = momDateCondition ? await Promise.all([
      getAmounts(pool, momDateCondition, allowedShops),
      getQuantities(pool, momDateCondition, allowedShops),
      getAvgPrices(pool, momDateCondition, allowedShops),
      getGiftPackages(pool, momDateCondition, allowedShops),
      getNewMembers(pool, String(momStartDate), String(momEndDate), allowedShops),
      getOldMember(pool, String(momStartDate), String(momEndDate), allowedShops),
    ]) : [new Map(), new Map(), new Map(), new Map(), new Map(), new Map()];

    const [yearAmounts, yearQuantities, yearAvgPrices, yearGifts, yearNewMembers, yearOldMembers] = yearDateCondition ? await Promise.all([
      getAmounts(pool, yearDateCondition, allowedShops),
      getQuantities(pool, yearDateCondition, allowedShops),
      getAvgPrices(pool, yearDateCondition, allowedShops),
      getGiftPackages(pool, yearDateCondition, allowedShops),
      getNewMembers(pool, String(yearStartDate), String(yearEndDate), allowedShops),
      getOldMember(pool, String(yearStartDate), String(yearEndDate), allowedShops),
    ]) : [new Map(), new Map(), new Map(), new Map(), new Map(), new Map()];

    const dealerMap = await getDealerMap(pool);
    const comparableMap = await getComparableMap(pool);

    const allShops = new Set([
      ...currentAmounts.keys(),
      ...currentQuantities.keys(),
      ...currentAvgPrices.keys(),
      ...currentGifts.keys(),
      ...momAmounts.keys(),
      ...momQuantities.keys(),
      ...momAvgPrices.keys(),
      ...momGifts.keys(),
      ...yearAmounts.keys(),
      ...yearQuantities.keys(),
      ...yearAvgPrices.keys(),
      ...yearGifts.keys(),
    ]);

    const filteredShops = Array.from(allShops).filter(shopName => allowedShops.has(shopName));
    console.log('[shop-diagnosis] allShops:', allShops.size, '过滤后:', filteredShops.length, '日期:', currentStartDate, '~', currentEndDate);

    const result = filteredShops.map(shop => {
      const info = shopInfo.get(shop) || { area: '', districtManager: '', supervisor: '', warehouseType: '' };
      const dealer = dealerMap.get(shop) || '';

      const amount = currentAmounts.get(shop) || 0;
      const momAmount = momAmounts.get(shop) || 0;
      const yearAmount = yearAmounts.get(shop) || 0;
      const quantity = currentQuantities.get(shop) || 0;
      const momQuantity = momQuantities.get(shop) || 0;
      const yearQuantity = yearQuantities.get(shop) || 0;

      const avg = currentAvgPrices.get(shop);
      const avgMom = momAvgPrices.get(shop);
      const avgYear = yearAvgPrices.get(shop);
      const orderCount = avg?.orderCount || 0;
      const momOrderCount = avgMom?.orderCount || 0;
      const yearOrderCount = avgYear?.orderCount || 0;

      const gift = currentGifts.get(shop);
      const giftMom = momGifts.get(shop);
      const giftYear = yearGifts.get(shop);
      const giftCount = gift?.giftPackageCount || 0;
      const momGiftCount = giftMom?.giftPackageCount || 0;
      const yearGiftCount = giftYear?.giftPackageCount || 0;
      const giftAmount = gift?.giftPackageAmount || 0;
      const momGiftAmount = giftMom?.giftPackageAmount || 0;
      const yearGiftAmount = giftYear?.giftPackageAmount || 0;

      const newMember = currentNewMembers.get(shop) || 0;
      const momNewMember = momNewMembers.get(shop) || 0;
      const yearNewMember = yearNewMembers.get(shop) || 0;
      const memberContribution = currentOldMembers.get(shop) || 0;
      const momMemberContribution = momOldMembers.get(shop) || 0;
      const yearMemberContribution = yearOldMembers.get(shop) || 0;

      const giftRatio = amount > 0 ? (giftAmount / amount) * 100 : 0;
      const momGiftRatio = momAmount > 0 ? (momGiftAmount / momAmount) * 100 : 0;
      const yearGiftRatio = yearAmount > 0 ? (yearGiftAmount / yearAmount) * 100 : 0;

      const memberContributionRatio = amount > 0 ? (memberContribution / amount) * 100 : 0;
      const momMemberContributionRatio = momAmount > 0 ? (momMemberContribution / momAmount) * 100 : 0;
      const yearMemberContributionRatio = yearAmount > 0 ? (yearMemberContribution / yearAmount) * 100 : 0;

      return {
        supervisor: info.supervisor,
        districtManager: info.districtManager,
        dealer,
        area: info.area,
        warehouseType: info.warehouseType,
        monthComparable: comparableMap.get(String(shop || '').trim())?.monthComparable || '',
        yearComparable: comparableMap.get(String(shop || '').trim())?.yearComparable || '',
        shopName: shop,
        currentAmount: amount, momAmount, yearAmount,
        currentQuantity: quantity, momQuantity, yearQuantity,
        currentAttachmentRate: avg?.attachmentRate || 0, momAttachmentRate: avgMom?.attachmentRate || 0, yearAttachmentRate: avgYear?.attachmentRate || 0,
        currentOrderCount: orderCount, momOrderCount, yearOrderCount,
        currentAvgItemPrice: avg?.avgItemPrice || 0, momAvgItemPrice: avgMom?.avgItemPrice || 0, yearAvgItemPrice: avgYear?.avgItemPrice || 0,
        currentAvgOrderValue: avg?.avgOrderValue || 0, momAvgOrderValue: avgMom?.avgOrderValue || 0, yearAvgOrderValue: avgYear?.avgOrderValue || 0,
        currentGiftCount: giftCount, momGiftCount, yearGiftCount,
        currentGiftAmount: giftAmount, momGiftAmount, yearGiftAmount,
        currentGiftRatio: giftRatio, momGiftRatio, yearGiftRatio,
        currentNewMember: newMember, momNewMember, yearNewMember,
        currentMemberContribution: memberContribution, momMemberContribution, yearMemberContribution,
        currentMemberContributionRatio: memberContributionRatio, momMemberContributionRatio, yearMemberContributionRatio,
      };
    });

    result.sort((a, b) => a.shopName.localeCompare(b.shopName));

    res.json({ data: result });
  } catch (error) {
    console.error('获取店铺诊断数据失败:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ===== 调试专用：按店铺输出 会员与非会员的开单明细 + 汇总
router.get('/debug-ordercount', async (req, res) => {
  try {
    const pool = await getPool();
    const { shopName = '安阳市林州卡迪高-店_ZY', startDate, endDate, includeZero } = req.query;
    const shop = typeof shopName === 'string' && shopName.length > 0 ? shopName : '安阳市林州卡迪高-店_ZY';

    let dateCondition: string;
    if (startDate && endDate) {
      dateCondition = `日期 >= '${startDate}' AND 日期 <= '${endDate}'`;
    } else {
      dateCondition = `DATENAME(YEAR, 日期) = DATENAME(YEAR, GETDATE()) AND DATENAME(MONTH, 日期) = DATENAME(MONTH, GETDATE())`;
    }

    const includeZeroBool = typeof includeZero === 'string' && (includeZero === '1' || includeZero.toLowerCase() === 'true');

    const havingClause = includeZeroBool ? '' : 'HAVING SUM(数量) <> 0';

    const memberDetailQuery = `
      SELECT
        店铺名称, SUM(业绩金额) as 业绩金额, SUM(数量) as 数量,
        CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END as 开单数
      FROM 有效业绩全
      WHERE ${dateCondition}
        AND 店铺名称 = '${shop}'
        AND 性别 IN ('男鞋', '女鞋', '童鞋', '包')
        AND 款式 <> '洞洞鞋'
        AND 会员代码 <> ''
      GROUP BY 店铺名称, 店员名称, 会员代码
      ${havingClause}
      ORDER BY 店铺名称
    `;

    const nonMemberDetailQuery = `
      SELECT
        店铺名称, SUM(业绩金额) as 业绩金额, SUM(数量) as 数量,
        CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END as 开单数
      FROM 有效业绩全
      WHERE ${dateCondition}
        AND 店铺名称 = '${shop}'
        AND 性别 IN ('男鞋', '女鞋', '童鞋', '包')
        AND 款式 <> '洞洞鞋'
        AND 会员代码 IS NULL
      GROUP BY 店铺名称, 店员名称, 单据编号
      ${havingClause}
      ORDER BY 店铺名称
    `;

    console.log('=== /reports/debug-ordercount ===');
    console.log('dateCondition:', dateCondition);
    console.log('shopName:', shop);
    console.log('includeZero:', includeZeroBool);

    // 第一步：基础检查，先确认该店铺是否有记录以及会员代码的分布
    const basicCheckQuery = `
      SELECT
        店铺名称,
        COUNT(*) as 总记录数,
        SUM(CASE WHEN 会员代码 = '' THEN 1 ELSE 0 END) as 会员代码_空字符串,
        SUM(CASE WHEN 会员代码 IS NULL THEN 1 ELSE 0 END) as 会员代码_NULL,
        SUM(CASE WHEN 会员代码 IS NULL OR 会员代码 = '' THEN 0 ELSE 1 END) as 会员代码_有值,
        SUM(CASE WHEN ISNULL(店员名称, '') = '' THEN 1 ELSE 0 END) as 店员名称_空,
        SUM(CASE WHEN 款式 = '洞洞鞋' THEN 1 ELSE 0 END) as 款式_洞洞鞋,
        SUM(CASE WHEN 性别 IN ('男鞋','女鞋','童鞋','包') THEN 1 ELSE 0 END) as 性别_鞋包,
        SUM(数量) as 总数量,
        SUM(业绩金额) as 总金额
      FROM 有效业绩全
      WHERE ${dateCondition}
        AND 店铺名称 = '${shop}'
      GROUP BY 店铺名称
    `;

    const shopListQuery = `
      SELECT TOP 30 店铺名称, COUNT(*) as 记录数
      FROM 有效业绩全
      WHERE ${dateCondition}
      GROUP BY 店铺名称
      HAVING COUNT(*) > 0
      ORDER BY COUNT(*) DESC
    `;

    const memberCodeDistQuery = `
      SELECT
        LEN(会员代码) as 会员代码长度,
        COUNT(*) as 记录数,
        SUM(数量) as 总数量
      FROM 有效业绩全
      WHERE ${dateCondition}
        AND 店铺名称 = '${shop}'
      GROUP BY LEN(会员代码)
      ORDER BY LEN(会员代码)
    `;

    const [basicResult, shopListResult, memberCodeDistResult] = await Promise.all([
      pool.request().query(basicCheckQuery),
      pool.request().query(shopListQuery),
      pool.request().query(memberCodeDistQuery),
    ]);

    // 公用工具：汇总函数，需在其他地方用到，先声明
    const getSum = (rows: any[], key: string) =>
      rows.reduce((sum: number, r: any) => sum + (r[key] || 0), 0);

    // 第二步：如果精确匹配不到，用关键字模糊搜索
    let finalShopName: string = shop;
    let fuzzyShopList: any[] = [];
    let keyword: string = shop;
    if (!basicResult.recordset || basicResult.recordset.length === 0) {
      // 从请求参数中的店铺名中抽取关键字（用中文/下划线拆分）
      const keywordMatch = shop.match(/[\u4e00-\u9fa5a-zA-Z]+/g);
      const keywords: string[] = keywordMatch || [shop];
      keyword = keywords[0];
      const fuzzyQuery = `
        SELECT TOP 20 店铺名称, COUNT(*) as 记录数, SUM(业绩金额) as 总金额, SUM(数量) as 总数量
        FROM 有效业绩全
        WHERE ${dateCondition}
          AND 店铺名称 LIKE '%${keyword}%'
        GROUP BY 店铺名称
        ORDER BY COUNT(*) DESC
      `;
      const fuzzyResult = await pool.request().query(fuzzyQuery);
      fuzzyShopList = fuzzyResult.recordset || [];
      console.log('模糊搜索结果:', fuzzyShopList);

      // 如果只找到一条匹配的，自动用它作为目标店铺
      if (fuzzyShopList.length === 1) {
        finalShopName = fuzzyShopList[0].店铺名称;
      }
    }

    // 如果自动找到目标店铺，重新用它跑后续查询
    if (finalShopName !== shop) {
      const buildMember = (name: string) => `
        SELECT SUM(业绩金额) as 业绩金额, SUM(数量) as 数量,
               CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END as 开单数
        FROM 有效业绩全
        WHERE ${dateCondition}
          AND 店铺名称 = '${name}'
          AND 会员代码 <> ''
          AND 性别 IN ('男鞋', '女鞋', '童鞋', '包')
          AND 款式 <> '洞洞鞋'
        GROUP BY 店员名称, 会员代码
        ${includeZeroBool ? '' : 'HAVING SUM(数量) <> 0'}
      `;
      const buildNonMember = (name: string) => `
        SELECT SUM(业绩金额) as 业绩金额, SUM(数量) as 数量,
               CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END as 开单数
        FROM 有效业绩全
        WHERE ${dateCondition}
          AND 店铺名称 = '${name}'
          AND 会员代码 IS NULL
          AND 性别 IN ('男鞋', '女鞋', '童鞋', '包')
          AND 款式 <> '洞洞鞋'
        GROUP BY 店员名称, 单据编号
        ${includeZeroBool ? '' : 'HAVING SUM(数量) <> 0'}
      `;
      const buildStaffMember = (name: string) => `
        SELECT SUM(业绩金额) as 业绩金额, SUM(数量) as 数量,
               CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END as 开单数
        FROM 有效业绩全
        WHERE ${dateCondition}
          AND 店铺名称 = '${name}'
          AND 会员代码 <> ''
          AND 性别 IN ('男鞋', '女鞋', '童鞋', '包')
          AND 款式 <> '洞洞鞋'
          AND ISNULL(店员名称, '') <> ''
        GROUP BY 店员名称, 会员代码
        ${includeZeroBool ? '' : 'HAVING SUM(数量) <> 0'}
      `;
      const buildStaffNonMember = (name: string) => `
        SELECT SUM(业绩金额) as 业绩金额, SUM(数量) as 数量,
               CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END as 开单数
        FROM 有效业绩全
        WHERE ${dateCondition}
          AND 店铺名称 = '${name}'
          AND 会员代码 IS NULL
          AND 性别 IN ('男鞋', '女鞋', '童鞋', '包')
          AND 款式 <> '洞洞鞋'
          AND ISNULL(店员名称, '') <> ''
        GROUP BY 店员名称, 单据编号
        ${includeZeroBool ? '' : 'HAVING SUM(数量) <> 0'}
      `;

      const [mResult, nResult, smResult, snResult] = await Promise.all([
        pool.request().query(buildMember(finalShopName)),
        pool.request().query(buildNonMember(finalShopName)),
        pool.request().query(buildStaffMember(finalShopName)),
        pool.request().query(buildStaffNonMember(finalShopName)),
      ]);

      const memberRows2 = mResult.recordset || [];
      const nonMemberRows2 = nResult.recordset || [];
      const staffMemberRows2 = smResult.recordset || [];
      const staffNonMemberRows2 = snResult.recordset || [];

      const memberSummary2 = {
        recordCount: memberRows2.length,
        totalAmount: getSum(memberRows2, '业绩金额'),
        totalQuantity: getSum(memberRows2, '数量'),
        totalOrderCount: getSum(memberRows2, '开单数'),
      };

      const nonMemberSummary2 = {
        recordCount: nonMemberRows2.length,
        totalAmount: getSum(nonMemberRows2, '业绩金额'),
        totalQuantity: getSum(nonMemberRows2, '数量'),
        totalOrderCount: getSum(nonMemberRows2, '开单数'),
      };

      const staffMemberSummary2 = {
        recordCount: staffMemberRows2.length,
        totalAmount: getSum(staffMemberRows2, '业绩金额'),
        totalQuantity: getSum(staffMemberRows2, '数量'),
        totalOrderCount: getSum(staffMemberRows2, '开单数'),
      };

      const staffNonMemberSummary2 = {
        recordCount: staffNonMemberRows2.length,
        totalAmount: getSum(staffNonMemberRows2, '业绩金额'),
        totalQuantity: getSum(staffNonMemberRows2, '数量'),
        totalOrderCount: getSum(staffNonMemberRows2, '开单数'),
      };

      console.log(`自动切换店铺为 [${finalShopName}]`);
      console.log('会员汇总:', memberSummary2);
      console.log('非会员汇总:', nonMemberSummary2);

      res.json({
        提示: `你输入的店铺名"${shop}"在表中未找到，已自动切换为 "${finalShopName}"（从关键字"${keyword}"模糊搜索中唯一命中）`,
        真实店铺名: finalShopName,
        dateCondition,
        includeZero: includeZeroBool,
        基础检查_原输入: basicResult.recordset,
        模糊搜索候选列表: fuzzyShopList,
        店铺列表_前30: shopListResult.recordset,
        汇总汇总: {
          不含店员: {
            会员: memberSummary2,
            非会员: nonMemberSummary2,
            合计: memberSummary2.totalOrderCount + nonMemberSummary2.totalOrderCount,
          },
          含店员: {
            会员: staffMemberSummary2,
            非会员: staffNonMemberSummary2,
            合计: staffMemberSummary2.totalOrderCount + staffNonMemberSummary2.totalOrderCount,
          },
        },
        不含店员过滤_会员订单明细: memberRows2,
        不含店员过滤_非会员订单明细: nonMemberRows2,
        含店员过滤_会员订单明细: staffMemberRows2,
        含店员过滤_非会员订单明细: staffNonMemberRows2,
      });
      return;
    }

    console.log('基础检查:', basicResult.recordset);
    console.log('店铺列表(部分):', shopListResult.recordset);
    console.log('会员代码长度分布:', memberCodeDistResult.recordset);

    const [memberResult, nonMemberResult] = await Promise.all([
      pool.request().query(memberDetailQuery),
      pool.request().query(nonMemberDetailQuery),
    ]);

    const memberRows = memberResult.recordset || [];
    const nonMemberRows = nonMemberResult.recordset || [];

    const memberSummary = {
      recordCount: memberRows.length,
      totalAmount: getSum(memberRows, '业绩金额'),
      totalQuantity: getSum(memberRows, '数量'),
      totalOrderCount: getSum(memberRows, '开单数'),
    };

    const nonMemberSummary = {
      recordCount: nonMemberRows.length,
      totalAmount: getSum(nonMemberRows, '业绩金额'),
      totalQuantity: getSum(nonMemberRows, '数量'),
      totalOrderCount: getSum(nonMemberRows, '开单数'),
    };

    const staffMemberDetailQuery = `
      SELECT
        店铺名称, ISNULL(店员名称, '') as 店员名称, SUM(业绩金额) as 业绩金额, SUM(数量) as 数量,
        CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END as 开单数
      FROM 有效业绩全
      WHERE ${dateCondition}
        AND 店铺名称 = '${shop}'
        AND 会员代码 <> ''
        AND 性别 IN ('男鞋', '女鞋', '童鞋', '包')
        AND 款式 <> '洞洞鞋'
        AND ISNULL(店员名称, '') <> ''
      GROUP BY 店铺名称, ISNULL(店员名称, ''), 会员代码
      ${havingClause}
      ORDER BY 店铺名称, ISNULL(店员名称, '')
    `;

    const staffNonMemberDetailQuery = `
      SELECT
        店铺名称, ISNULL(店员名称, '') as 店员名称, SUM(业绩金额) as 业绩金额, SUM(数量) as 数量,
        CASE WHEN SUM(数量) > 0 THEN 1 WHEN SUM(数量) < 0 THEN -1 ELSE 0 END as 开单数
      FROM 有效业绩全
      WHERE ${dateCondition}
        AND 店铺名称 = '${shop}'
        AND 会员代码 IS NULL
        AND 性别 IN ('男鞋', '女鞋', '童鞋', '包')
        AND 款式 <> '洞洞鞋'
        AND ISNULL(店员名称, '') <> ''
      GROUP BY 店铺名称, ISNULL(店员名称, ''), 单据编号
      ${havingClause}
      ORDER BY 店铺名称, ISNULL(店员名称, '')
    `;

    const [staffMemberResult, staffNonMemberResult] = await Promise.all([
      pool.request().query(staffMemberDetailQuery),
      pool.request().query(staffNonMemberDetailQuery),
    ]);

    const staffMemberRows = staffMemberResult.recordset || [];
    const staffNonMemberRows = staffNonMemberResult.recordset || [];

    const staffMemberSummary = {
      recordCount: staffMemberRows.length,
      totalAmount: getSum(staffMemberRows, '业绩金额'),
      totalQuantity: getSum(staffMemberRows, '数量'),
      totalOrderCount: getSum(staffMemberRows, '开单数'),
    };

    const staffNonMemberSummary = {
      recordCount: staffNonMemberRows.length,
      totalAmount: getSum(staffNonMemberRows, '业绩金额'),
      totalQuantity: getSum(staffNonMemberRows, '数量'),
      totalOrderCount: getSum(staffNonMemberRows, '开单数'),
    };

    const totalDebugOrderCount = memberSummary.totalOrderCount + nonMemberSummary.totalOrderCount;
    const totalDebugOrderCountWithStaff = staffMemberSummary.totalOrderCount + staffNonMemberSummary.totalOrderCount;

    console.log('会员汇总:', memberSummary);
    console.log('非会员汇总:', nonMemberSummary);
    console.log('总开单数(含无店员):', totalDebugOrderCount);
    console.log('带店员名称过滤会员汇总:', staffMemberSummary);
    console.log('带店员名称过滤非会员汇总:', staffNonMemberSummary);
    console.log('总开单数(带店员过滤):', totalDebugOrderCountWithStaff);

    res.json({
      shopName: shop,
      dateCondition,
      includeZero: includeZeroBool,
      基础检查: basicResult.recordset,
      店铺列表_前30: shopListResult.recordset,
      会员代码长度分布: memberCodeDistResult.recordset,
      按关键字模糊搜索候选列表: fuzzyShopList,
      汇总汇总: {
        不含店员: {
          会员: memberSummary,
          非会员: nonMemberSummary,
          合计: totalDebugOrderCount,
        },
        含店员: {
          会员: staffMemberSummary,
          非会员: staffNonMemberSummary,
          合计: totalDebugOrderCountWithStaff,
        },
      },
      不含店员过滤_会员订单明细: memberRows,
      不含店员过滤_非会员订单明细: nonMemberRows,
      含店员过滤_会员订单明细: staffMemberRows,
      含店员过滤_非会员订单明细: staffNonMemberRows,
    });
  } catch (error) {
    console.error('调试接口失败:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/reports/product-seasonal-sales - 商品组长季节/性别/新老销量（从数据提取读取SQL）
router.get('/product-seasonal-sales', async (req, res) => {
  try {
    const pool = await getPool();
    const { startDate, endDate } = req.query;
    const sd = typeof startDate === 'string' ? startDate : '';
    const ed = typeof endDate === 'string' ? endDate : '';

    // 直接读数据提取，不缓存，确保用户改SQL后立即生效
    const dxResult = await pool.request()
      .input('name', sql.NVarChar, 'productSeasonalSales')
      .query('SELECT sqlQuery FROM DataExtraction WHERE fieldName = @name');
    if (dxResult.recordset.length === 0) {
      return res.json([]);
    }
    let dxQuery = dxResult.recordset[0].sqlQuery as string;
    dxQuery = dxQuery
      .replace(/@startDate\b/g, `'${sd}'`).replace(/@endDate\b/g, `'${ed}'`)
      .replace(/@sd\b/g, `'${sd}'`).replace(/@ed\b/g, `'${ed}'`);
    const result = await pool.request().query(dxQuery);
    res.json(result.recordset);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/reports/product-main-product - 商品组长主推款完成（复用督导汇报的店铺主推数量）
router.get('/product-main-product', async (req, res) => {
  try {
    const pool = await getPool();
    const { startDate, endDate } = req.query;
    const sd = typeof startDate === 'string' ? startDate : '';
    const ed = typeof endDate === 'string' ? endDate : '';
    const mainProducts = await getMainProductCount(pool, sd, ed);
    const list: any[] = [];
    mainProducts.forEach((qty, shopName) => list.push({ 店铺名称: shopName, 主推数量: qty }));
    res.json(list);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
