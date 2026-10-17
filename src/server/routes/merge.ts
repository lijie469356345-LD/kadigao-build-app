import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';

const router = Router();

/**
 * 执行 SQL 查询，失败返回空数组
 */
async function execQuery(pool: sql.ConnectionPool, sqlText: string): Promise<any[]> {
  try {
    const result = await pool.request().query(sqlText);
    return result.recordset || [];
  } catch (err: any) {
    console.error('SQL执行失败:', err.message);
    return [];
  }
}

/**
 * LEFT JOIN 合并：将 source 的行按 keyCols 匹配到 target，覆盖/追加 valueCols
 */
function mergeByKey(target: any[], source: any[], keyCols: string[], valueCols?: string[]) {
  if (!source || source.length === 0) return;
  const map = new Map<string, any>();
  source.forEach(row => {
    const key = keyCols.map(c => row[c] ?? '').join('\x00');
    if (!map.has(key)) map.set(key, {});
    const cols = valueCols || Object.keys(row).filter(k => !keyCols.includes(k));
    cols.forEach(col => { map.get(key)[col] = row[col]; });
  });
  target.forEach(row => {
    const key = keyCols.map(c => row[c] ?? '').join('\x00');
    const src = map.get(key);
    if (src) Object.keys(src).forEach(col => { row[col] = src[col]; });
  });
}

/**
 * 构建完整合并数据
 * @param year 年份筛选（对应 VBA 的 @year），undefined 表示"所有"
 * @param season 季节筛选（对应 VBA 的 @season），undefined/null 表示全季节，字符串或数组
 */
export async function buildMergedData(year?: number | string, season?: string | string[] | null) {
  const pool = await getPool();

  // 年份处理：year 为 undefined/null/'' 表示"所有"，选中的值表示 >= 该年份
  const hasYear = year !== undefined && year !== null && year !== '' && year !== 0;
  const yearNum = hasYear ? parseInt(String(year)) : new Date().getFullYear();

  // 季节处理：支持单值、逗号分隔字符串、数组；默认全5季（与 VBA 一致）
  const ALL_SEASONS = "春','秋','冬','秋冬','夏";
  let seasonStr: string;
  if (!season || (Array.isArray(season) && season.length === 0)) {
    seasonStr = ALL_SEASONS;
  } else if (Array.isArray(season)) {
    seasonStr = season.join("','");
  } else if (typeof season === 'string' && season.includes(',')) {
    seasonStr = season.split(',').join("','"); // "春,夏" → "春','夏"
  } else {
    seasonStr = String(season);
  }
  const seasonSql = `'${seasonStr}'`;

  // ==================== 1. 库存透视 ====================
  // 只有 t3(SQL5) 和 t4(SQL6) 使用了 @year/@season，其他SQL全部硬编码
  const inventorySql = `
    WITH
    /* t1: 大仓可用库存 — 硬编码所有性别+季节（VBA SQL1） */
    t1 AS (
      SELECT CASE WHEN 店铺代码 IN ('JM001','JM006','JM010') THEN '加盟仓库' ELSE 店铺名称 END AS 店铺名称,
        商品代码, 颜色名称, 尺码代码, SUM(可配) AS 数量
      FROM [dbo].[今日库存全]
      WHERE 店铺代码 IN ('JM001','JM006','JM010','JMC01','SDC01','ZYC01')
        AND 性别 IN ('男鞋','女鞋','童鞋')
        AND 季节 IN ('春','夏','秋','冬','秋冬')
      GROUP BY 店铺代码, 店铺名称, 商品代码, 颜色名称, 尺码代码
      HAVING SUM(可配) <> 0
    ),
    /* t2: 直营可用库存（预计+通知）— 硬编码（VBA SQL2-4） */
    t2 AS (
      SELECT a.店铺名称, a.商品代码, a.颜色名称, a.尺码代码,
        ISNULL(b.预计数,0)+ISNULL(c.通知数量,0) AS 数量
      FROM (
        SELECT 店铺名称, 商品代码, 颜色名称, 尺码代码 FROM [dbo].[今日库存全]
        WHERE 仓库类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬')
        UNION
        SELECT 收货店名称, 商品代码, 颜色名称, 尺码代码 FROM [dbo].[通知全]
        WHERE 收货店类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬')
      ) a
      LEFT JOIN (
        SELECT 店铺名称, 商品代码, 颜色名称, 尺码代码, SUM(预计数) 预计数
        FROM [dbo].[今日库存全]
        WHERE 仓库类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬')
        GROUP BY 店铺名称, 商品代码, 颜色名称, 尺码代码
      ) b ON a.店铺名称+ISNULL(a.商品代码,'')+ISNULL(a.颜色名称,'')+a.尺码代码 = b.店铺名称+ISNULL(b.商品代码,'')+ISNULL(b.颜色名称,'')+b.尺码代码
      LEFT JOIN (
        SELECT 收货店名称 店铺名称, 商品代码, 颜色名称, 尺码代码, SUM(数量) 通知数量
        FROM [dbo].[通知全]
        WHERE 收货店类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬')
        GROUP BY 收货店名称, 商品代码, 颜色名称, 尺码代码
      ) c ON a.店铺名称+ISNULL(a.商品代码,'')+ISNULL(a.颜色名称,'')+a.尺码代码 = c.店铺名称+ISNULL(c.商品代码,'')+ISNULL(c.颜色名称,'')+c.尺码代码
      WHERE ISNULL(b.预计数,0)+ISNULL(c.通知数量,0) <> 0
    ),
    /* t3: 指定年份季节零库存 — 使用参数 year/season（VBA SQL5: @year, @season） */
    t3 AS (
      SELECT 店铺名称, 商品代码, 颜色名称, 尺码代码, 0 AS 数量
      FROM [dbo].[今日库存全]
      WHERE 仓库类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋')
        AND 季节 IN (${seasonSql})
        AND 年份 >= ${hasYear ? yearNum : '2020'}
      GROUP BY 店铺名称, 商品代码, 颜色名称, 尺码代码
      HAVING SUM(数量) = 0
    ),
    /* t4: 近期有销售但库存为0 — 使用参数 year（VBA SQL6: @year） */
    t4 AS (
      SELECT 店铺名称, 商品代码, 颜色名称, 尺码代码, 0 AS 数量
      FROM [dbo].[今日库存全]
      WHERE 店铺名称+商品代码+颜色名称 IN (
        SELECT 店铺名称+商品代码+颜色名称
        FROM [dbo].[有效业绩全]
        WHERE 年份>=2020 AND 年份<${hasYear ? yearNum : new Date().getFullYear() + 1}
          AND 性别 IN ('男鞋','女鞋','童鞋')
          AND 季节 IN ('秋冬','冬','春','秋','夏')
          AND 仓库类别 IN ('直营')
          AND 日期 >= DATEADD(day, -31, GETDATE())
        GROUP BY 店铺名称, 商品代码, 颜色名称
      )
      GROUP BY 店铺名称, 商品代码, 颜色名称, 尺码代码
      HAVING SUM(数量) = 0
    ),
    /* 合并 + 透视 */
    data AS (
      SELECT * FROM t1 UNION ALL SELECT * FROM t2 UNION ALL SELECT * FROM t3 UNION ALL SELECT * FROM t4
    )
    SELECT 店铺名称, 商品代码, 颜色名称,
      SUM(ISNULL([31],0)) '31', SUM(ISNULL([32],0)) '32',
      SUM(ISNULL([33],0)) '33', SUM(ISNULL([34],0)) '34',
      SUM(ISNULL([35],0)) '35', SUM(ISNULL([36],0)) '36',
      SUM(ISNULL([37],0)) '37', SUM(ISNULL([38],0)) '38',
      SUM(ISNULL([39],0)) '39', SUM(ISNULL([40],0)) '40',
      SUM(ISNULL([41],0)) '41', SUM(ISNULL([42],0)) '42',
      SUM(ISNULL([43],0)) '43', SUM(ISNULL([44],0)) '44',
      SUM(ISNULL([45],0)) '45', SUM(ISNULL([46],0)) '46'
    FROM (
      SELECT 店铺名称, 商品代码, 颜色名称, 尺码代码, SUM(数量) 数量
      FROM data GROUP BY 店铺名称, 商品代码, 颜色名称, 尺码代码
    ) a
    PIVOT (SUM(数量) FOR 尺码代码 IN ([31],[32],[33],[34],[35],[36],[37],[38],[39],[40],[41],[42],[43],[44],[45],[46])) p
    GROUP BY 店铺名称, 商品代码, 颜色名称
  `;

  const inventoryData = await execQuery(pool, inventorySql);
  inventoryData.forEach((row: any) => {
    const sizeCols = ['31','32','33','34','35','36','37','38','39','40','41','42','43','44','45','46'];
    row['合计'] = sizeCols.reduce((s, c) => s + (parseInt(row[c]) || 0), 0);
  });

  // ==================== 2. 销量数据（硬编码所有性别+季节） ====================
  const salesSqls: Record<string, string> = {
    '120天累销量': `SELECT 店铺名称,商品代码,颜色名称,SUM(数量) AS [120天累销量] FROM [dbo].[有效业绩全] WHERE 仓库类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬') AND 日期>=DATEADD(day,-120,GETDATE()) GROUP BY 店铺名称,商品代码,颜色名称`,
    '120天累送量': `SELECT 店铺名称,商品代码,颜色名称,SUM(数量) AS [120天累送量] FROM [dbo].[有效业绩全] WHERE 仓库类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬') AND 日期>=DATEADD(day,-120,GETDATE()) AND 充值类型='充值' GROUP BY 店铺名称,商品代码,颜色名称 HAVING SUM(数量)<>0`,
    '月销量': `SELECT 店铺名称,商品代码,颜色名称,SUM(数量) AS [月销量] FROM [dbo].[有效业绩全] WHERE 仓库类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬') AND 日期>=DATEADD(day,-30,GETDATE()) GROUP BY 店铺名称,商品代码,颜色名称 HAVING SUM(数量)<>0`,
    '两周销量': `SELECT 店铺名称,商品代码,颜色名称,SUM(数量) AS [两周销量] FROM [dbo].[有效业绩全] WHERE 仓库类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬') AND 日期>=DATEADD(day,-14,GETDATE()) GROUP BY 店铺名称,商品代码,颜色名称 HAVING SUM(数量)<>0`,
    '周销量': `SELECT 店铺名称,商品代码,颜色名称,SUM(数量) AS [周销量] FROM [dbo].[有效业绩全] WHERE 仓库类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬') AND 日期>=DATEADD(day,-7,GETDATE()) GROUP BY 店铺名称,商品代码,颜色名称 HAVING SUM(数量)<>0`,
    '昨日销量': `SELECT 店铺名称,商品代码,颜色名称,SUM(数量) AS [昨日销量] FROM [dbo].[有效业绩全] WHERE 仓库类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬') AND 日期=CONVERT(date, DATEADD(day,-1,GETDATE())) GROUP BY 店铺名称,商品代码,颜色名称 HAVING SUM(数量)<>0`,
    '今日销量': `SELECT 店铺名称,商品代码,颜色名称,SUM(数量) AS [今日销量] FROM [dbo].[有效业绩全] WHERE 仓库类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬') AND 日期>=CONVERT(date, GETDATE()) GROUP BY 店铺名称,商品代码,颜色名称 HAVING SUM(数量)<>0`,
    '月送量': `SELECT 店铺名称,商品代码,颜色名称,SUM(数量) AS [月送量] FROM [dbo].[有效业绩全] WHERE 仓库类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬') AND 日期>=DATEADD(day,-30,GETDATE()) AND 充值类型='充值' GROUP BY 店铺名称,商品代码,颜色名称 HAVING SUM(数量)<>0`,
    '两周送量': `SELECT 店铺名称,商品代码,颜色名称,SUM(数量) AS [两周送量] FROM [dbo].[有效业绩全] WHERE 仓库类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬') AND 日期>=DATEADD(day,-14,GETDATE()) AND 充值类型='充值' GROUP BY 店铺名称,商品代码,颜色名称 HAVING SUM(数量)<>0`,
    '周送量': `SELECT 店铺名称,商品代码,颜色名称,SUM(数量) AS [周送量] FROM [dbo].[有效业绩全] WHERE 仓库类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬') AND 日期>=DATEADD(day,-7,GETDATE()) AND 充值类型='充值' GROUP BY 店铺名称,商品代码,颜色名称 HAVING SUM(数量)<>0`,
  };

  const salesResults: Record<string, any[]> = {};
  for (const [name, sqlText] of Object.entries(salesSqls)) {
    salesResults[name] = await execQuery(pool, sqlText);
  }

  // ==================== 3-14: 辅助数据（全部硬编码） ====================
  const [在途数据, 配货数据, 移入数据, 移出数据, 店铺信息, 排名数据, 畅销数据, 商品信息, 销量码数数据, 大类数据, 店铺分组, 商品分组, 上市数据] = await Promise.all([
    execQuery(pool, `SELECT 店铺名称,商品代码,颜色名称,SUM(在途数) AS [在途数量] FROM [dbo].[今日库存全] WHERE 仓库类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬') GROUP BY 店铺名称,商品代码,颜色名称 HAVING SUM(在途数)<>0`),
    execQuery(pool, `SELECT 收货店名称 店铺名称,商品代码,颜色名称,SUM(数量) AS [10天配货] FROM [dbo].[配货全] WHERE 收货店类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 日期<=DATEADD(day,-1,GETDATE()) AND 日期>=DATEADD(day,-11,GETDATE()) GROUP BY 收货店名称,商品代码,颜色名称`),
    execQuery(pool, `SELECT 收货店名称 店铺名称,商品代码,颜色名称,SUM(数量) AS [周移入] FROM [dbo].[调拨全] WHERE 日期>=DATEADD(day,-8,GETDATE()) AND 收货店类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬') GROUP BY 收货店名称,商品代码,颜色名称`),
    execQuery(pool, `SELECT 店铺名称,商品代码,颜色名称,SUM(数量) AS [周移出] FROM [dbo].[调拨全] WHERE 日期>=DATEADD(day,-8,GETDATE()) AND 仓库类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬') GROUP BY 店铺名称,商品代码,颜色名称`),
    execQuery(pool, `SELECT 店铺名称,区域,商品,督导 FROM [dbo].[店仓全] WHERE (仓库类别 IN ('直营') OR 店铺代码 IN ('JMC01','SDC01','ZYC01')) AND 店铺名称<>'品氪商城_ZY' AND 店铺名称<>'山东卡迪高_ZY'`),
    execQuery(pool, `SELECT x.店铺名称,x.商品代码,x.颜色名称,x.两周销量,x.单店排名,y.直营排名 FROM (SELECT 店铺名称,商品代码,颜色名称,SUM(数量) AS 两周销量,RANK() OVER(PARTITION BY 店铺名称 ORDER BY SUM(数量) DESC) AS [单店排名] FROM [dbo].[有效业绩全] WHERE 仓库类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬') AND 日期>=DATEADD(day,-15,GETDATE()) AND 日期<=DATEADD(day,-1,GETDATE()) GROUP BY 店铺名称,商品代码,颜色名称 HAVING SUM(数量)<>0) x LEFT JOIN (SELECT 商品代码,颜色名称,SUM(数量) AS 两周销量,RANK() OVER(ORDER BY SUM(数量) DESC) AS [直营排名] FROM [dbo].[有效业绩全] WHERE 仓库类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬') AND 日期>=DATEADD(day,-15,GETDATE()) AND 日期<=DATEADD(day,-1,GETDATE()) GROUP BY 商品代码,颜色名称 HAVING SUM(数量)<>0) y ON x.商品代码+ISNULL(x.颜色名称,'')=y.商品代码+ISNULL(y.颜色名称,'')`),
    execQuery(pool, `SELECT TOP 20 商品代码,颜色名称,SUM(数量) 数量,RANK() OVER(ORDER BY SUM(数量) DESC) 单店大盘畅销 FROM [dbo].[有效业绩全] WHERE 日期>=DATEADD(day,-15,GETDATE()) AND 性别 IN ('男鞋','女鞋','童鞋') AND 年份>=YEAR(GETDATE())-2 AND 仓库类别 IN ('直营') GROUP BY 商品代码,颜色名称 ORDER BY SUM(数量) DESC`),
    execQuery(pool, `SELECT sp.商品代码,sp.颜色名称,ISNULL(sp.颜色代码,'') 颜色代码,ISNULL(sp.大类,'') 大类,ISNULL(sp.季节,'') 季节,ISNULL(CAST(sp.年份 AS VARCHAR),'') 年份,ISNULL(sp.性别,'') 性别,ISNULL(sp.内里,'') 内里,ISNULL(sp.款式,'') 款式,ISNULL(sp.风格,'') 风格,ISNULL(sp.小系列,'') 小系列,ISNULL(sp.俗称,'') 俗称,ISNULL(sp.跟型,'') 跟型,ISNULL(sp.鞋跟,'') 鞋跟,ISNULL(jg.河南零售价,0) 后台价,ISNULL(jg.加盟批发价,0) 批发价,ISNULL(q.清版类型,'正常') 清版类型,ISNULL(bb.并货类型,'正常') 并货类型 FROM [dbo].[商品全] AS sp LEFT JOIN [dbo].[价格全] AS jg ON sp.商品代码=jg.商品代码 LEFT JOIN (SELECT 商品代码+颜色名称 sku,'清版' 清版类型 FROM [dbo].[今日库存全] WHERE 仓库类别 IN ('直营') AND 区域<>'山东' AND 性别 IN ('男鞋','女鞋','童鞋') AND 店铺名称<>'山东直营仓库' AND 店铺名称<>'曲梁大仓' GROUP BY 商品代码,颜色名称 HAVING SUM(数量)<=20 AND SUM(数量)<>0) q ON sp.商品代码+ISNULL(sp.颜色名称,'')=q.sku LEFT JOIN (SELECT 商品代码+颜色名称 sku,'清版' 并货类型 FROM [dbo].[bingban] WHERE 日期>=DATEADD(day,-2,GETDATE())) bb ON sp.商品代码+ISNULL(sp.颜色名称,'')=bb.sku WHERE sp.[性别] IN ('男鞋','女鞋','童鞋')`),
    execQuery(pool, `SELECT 店铺名称,商品代码,颜色名称,SUM(ISNULL([31],0)) '205',SUM(ISNULL([32],0)) '210',SUM(ISNULL([33],0)) '215',SUM(ISNULL([34],0)) '220',SUM(ISNULL([35],0)) '225',SUM(ISNULL([36],0)) '230',SUM(ISNULL([37],0)) '235',SUM(ISNULL([38],0)) '240',SUM(ISNULL([39],0)) '245',SUM(ISNULL([40],0)) '250',SUM(ISNULL([41],0)) '255',SUM(ISNULL([42],0)) '260',SUM(ISNULL([43],0)) '265',SUM(ISNULL([44],0)) '270',SUM(ISNULL([45],0)) '275',SUM(ISNULL([46],0)) '280' FROM (SELECT 店铺名称,商品代码,颜色名称,尺码代码,SUM(数量) 数量 FROM [dbo].[有效业绩全] WHERE 仓库类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') AND 季节 IN ('春','夏','秋','冬','秋冬') AND 日期>=DATEADD(day,-7,GETDATE()) GROUP BY 店铺名称,商品代码,颜色名称,尺码代码 HAVING SUM(数量)<>0) a PIVOT (SUM(数量) FOR 尺码代码 IN ([31],[32],[33],[34],[35],[36],[37],[38],[39],[40],[41],[42],[43],[44],[45],[46])) p GROUP BY 店铺名称,商品代码,颜色名称`),
    execQuery(pool, `SELECT 店铺名称,性别,大类,SUM(数量) 大类库存,SUM(计数) 大类款式 FROM (SELECT 店铺名称,商品代码,颜色名称,性别,大类,SUM(数量) 数量,1 计数 FROM [dbo].[今日库存全] WHERE 仓库类别 IN ('直营') AND 性别 IN ('男鞋','女鞋','童鞋') GROUP BY 店铺名称,商品代码,颜色名称,性别,大类 HAVING SUM(数量)<>0) a GROUP BY 店铺名称,性别,大类`),
    execQuery(pool, `SELECT 店铺名称,B组,C组 FROM [dbo].[店仓全] WHERE 仓库类别 IN ('直营')`),
    execQuery(pool, `SELECT 商品代码,颜色名称,组别 FROM [dbo].[商品分组]`),
    execQuery(pool, `SELECT 商品代码,颜色名称,MIN(日期) 直营上市日期,ISNULL(DATEDIFF(day,MIN(日期),CONVERT(date,GETDATE())),0) 直营上市天数 FROM (SELECT 日期,商品代码+颜色名称 sku,商品代码,颜色名称,COUNT(店铺名称) 铺店数 FROM (SELECT 日期,商品代码,颜色名称,店铺名称,SUM(数量) 数量 FROM [dbo].[配货全] WHERE 收货店类别 IN ('直营') AND 年份>=2025 AND 季节 IN ('春','夏','秋','冬','秋冬') AND 性别 IN ('男鞋','女鞋','童鞋') GROUP BY 日期,商品代码,颜色名称,店铺名称) a GROUP BY 日期,sku,商品代码,颜色名称 HAVING COUNT(店铺名称)>4) a GROUP BY 商品代码,颜色名称`),
  ]);

  // ==================== 数据合并 ====================
  let mergedData = inventoryData.map(row => ({ ...row }));

  Object.entries(salesResults).forEach(([name, data]) => {
    if (!data || data.length === 0) return;
    const cols = Object.keys(data[0]).filter(k => !['店铺名称','商品代码','颜色名称'].includes(k));
    mergeByKey(mergedData, data, ['店铺名称','商品代码','颜色名称'], cols);
  });

  mergeByKey(mergedData, 在途数据, ['店铺名称','商品代码','颜色名称'], ['在途数量']);
  mergeByKey(mergedData, 配货数据, ['店铺名称','商品代码','颜色名称'], ['10天配货']);
  mergeByKey(mergedData, 移入数据, ['店铺名称','商品代码','颜色名称'], ['周移入']);
  mergeByKey(mergedData, 移出数据, ['店铺名称','商品代码','颜色名称'], ['周移出']);
  mergeByKey(mergedData, 店铺信息, ['店铺名称'], ['区域','商品','督导']);
  mergeByKey(mergedData, 排名数据, ['店铺名称','商品代码','颜色名称'], ['单店排名','直营排名']);
  mergeByKey(mergedData, 商品信息, ['商品代码','颜色名称'], ['颜色代码','大类','季节','年份','性别','内里','后台价','批发价','款式','风格','小系列','俗称','跟型','鞋跟','清版类型','并货类型']);
  mergeByKey(mergedData, 销量码数数据, ['店铺名称','商品代码','颜色名称'], ['205','210','215','220','225','230','235','240','245','250','255','260','265','270','275','280','销售合计']);
  mergeByKey(mergedData, 大类数据, ['店铺名称','性别','大类'], ['大类库存','大类款式']);
  mergeByKey(mergedData, 畅销数据, ['商品代码','颜色名称'], ['单店大盘畅销']);
  mergeByKey(mergedData, 店铺分组, ['店铺名称'], ['B组','C组']);
  mergeByKey(mergedData, 商品分组, ['商品代码','颜色名称'], ['组别']);
  mergeByKey(mergedData, 上市数据, ['商品代码','颜色名称'], ['直营上市日期','直营上市天数']);

  // 商品代码颜色名称（拼接字段）
  mergedData.forEach(row => {
    row['商品代码颜色名称'] = `${row['商品代码'] || ''}${row['颜色名称'] || ''}`;
  });

  // 特殊仓库销量固定值
  mergedData.forEach(row => {
    if (row['店铺名称'] === '加盟仓库') {
      row['月销量'] = 2000; row['两周销量'] = 2000; row['周销量'] = 2000;
    }
    if (row['店铺名称'] === '河南仓库') {
      row['月销量'] = 1000; row['两周销量'] = 1000; row['周销量'] = 1000;
    }
  });

  // 计算 销售合计（如果后端没算）
  const priceCols = ['205','210','215','220','225','230','235','240','245','250','255','260','265','270','275','280'];
  mergedData.forEach(row => {
    if (row['销售合计'] === undefined || row['销售合计'] === null) {
      row['销售合计'] = priceCols.reduce((s, c) => s + (parseInt(row[c]) || 0), 0);
    }
  });

  // ===== 年份/季节行级过滤（修复原逻辑漏洞：@year/@season 原本只作用 t3/t4 两个零库存CTE，
  //      主数据（t1/t2 库存 + 全部销量）从未按年份/季节过滤，导致选中"2026年及以后"仍显示全部商品）=====
  // 仅当显式选中 年份(>=) 或 明确选择季节 时生效；默认（年份空/未选季节）保持原有全部数据
  const seasonSet = new Set<string>();
  let filterBySeason = false;
  if (season != null && String(season).trim() !== '' && !(Array.isArray(season) && season.length === 0)) {
    filterBySeason = true;
    const sList = Array.isArray(season) ? season : String(season).split(',').map((s: string) => s.trim()).filter(Boolean);
    sList.forEach(s => seasonSet.add(s));
  }
  if (hasYear || filterBySeason) {
    mergedData = mergedData.filter((row: any) => {
      if (hasYear) {
        const yr = parseInt(String(row['年份'] ?? ''), 10);
        if (!Number.isInteger(yr) || yr < yearNum) return false;
      }
      if (filterBySeason && !seasonSet.has((row['季节'] ?? '').toString().trim())) return false;
      return true;
    });
  }

  // 默认排序：商品代码颜色名称↑ → 周销↓ → 两周销↓ → 月销↓ → 120累销↓
  mergedData.sort((a: any, b: any) => {
    const nameA = (a['商品代码颜色名称'] || '').toString();
    const nameB = (b['商品代码颜色名称'] || '').toString();
    if (nameA !== nameB) return nameA.localeCompare(nameB, 'zh-CN');
    const zA = parseFloat(a['周销量']) || 0, zB = parseFloat(b['周销量']) || 0;
    if (zA !== zB) return zB - zA;
    const lzA = parseFloat(a['两周销量']) || 0, lzB = parseFloat(b['两周销量']) || 0;
    if (lzA !== lzB) return lzB - lzA;
    const mA = parseFloat(a['月销量']) || 0, mB = parseFloat(b['月销量']) || 0;
    if (mA !== mB) return mB - mA;
    return (parseFloat(b['120天累销量']) || 0) - (parseFloat(a['120天累销量']) || 0);
  });

  return mergedData;
}

// 列顺序（与 VBA header 完全一致）
const HEADER = [
  '商品代码颜色名称','区域','商品','督导','店铺名称','商品代码','颜色代码','颜色名称',
  '大类','款式','风格','小系列','俗称','跟型','鞋跟','季节','年份','性别','内里',
  '后台价','批发价','B组','C组','组别','清版类型','并货类型',
  '大类款式','大类库存','单店大盘畅销','单店排名','直营排名',
  '直营上市日期','直营上市天数','10天配货','周移入','周移出',
  '120天累销量','120天累送量','月送量','两周送量','周送量',
  '月销量','两周销量','周销量','昨日销量','今日销量','在途数量',
  '31','32','33','34','35','36','37','38','39','40','41','42','43','44','45','46','合计',
  '205','210','215','220','225','230','235','240','245','250','255','260','265','270','275','280','销售合计'
];

/**
 * POST /api/merge/initial-table
 * 查询初始并货表（返回全量数据，不筛选不翻页）
 * Body: { year?: number, season?: string }
 */
router.post('/initial-table', async (req, res) => {
  try {
    const { year, season } = req.body;
    const allData = await buildMergedData(year, season);

    // 标准化列顺序
    const resultData = allData.map(row => {
      const newRow: any = {};
      HEADER.forEach(h => { newRow[h] = row[h] !== undefined ? row[h] : null; });
      return newRow;
    });

    res.json({
      success: true,
      data: resultData,
      total: resultData.length,
      columns: HEADER,
    });
  } catch (error: any) {
    console.error('初始并货表查询失败:', error);
    res.status(500).json({ success: false, message: error.message || '查询失败' });
  }
});

/**
 * POST /api/merge/export
 * 导出全量数据为 CSV（每个不同商品代码颜色名称间插入空行）
 */
router.post('/export', async (req, res) => {
  try {
    const { year, season } = req.body;
    const allData = await buildMergedData(year, season);

    // BOM for UTF-8 Excel recognition
    let csv = '\uFEFF';
    csv += HEADER.map(h => escapeCsv(h)).join(',') + '\n';

    let prevName = '';
    for (const row of allData) {
      const currentName = (row['商品代码颜色名称'] || '');
      if (prevName && currentName !== prevName) {
        csv += '\n'; // 组间空行
      }
      prevName = currentName;

      const line = HEADER.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        return String(val);
      });
      csv += line.map(cell => escapeCsv(cell)).join(',') + '\n';
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `merge_table_${dateStr}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent('并货表_' + dateStr + '.csv')}`);
    res.send(csv);
  } catch (error: any) {
    console.error('导出失败:', error);
    res.status(500).json({ success: false, message: error.message || '导出失败' });
  }
});

function escapeCsv(cell: string): string {
  if (cell.includes(',') || cell.includes('"') || cell.includes('\n') || cell.includes('\r')) {
    return '"' + cell.replace(/"/g, '""') + '"';
  }
  return cell;
}

/**
 * GET /api/merge/filters
 * 获取筛选选项（年份、季节）
 */
router.get('/filters', async (req, res) => {
  try {
    const pool = await getPool();
    const [r1, r2] = await Promise.all([
      pool.request().query(`SELECT DISTINCT 年份 FROM [dbo].[商品全] WHERE 年份 IS NOT NULL ORDER BY 年份 DESC`),
      pool.request().query(`SELECT DISTINCT 季节 FROM [dbo].[商品全] WHERE 季节 IS NOT NULL AND 季节<>'' ORDER BY 季节`),
    ]);
    res.json({
      success: true,
      data: {
        years: (r1.recordset || []).map((r: any) => r.年份),
        seasons: (r2.recordset || []).map((r: any) => r.季节),
      }
    });
  } catch (error: any) {
    console.error('获取筛选选项失败:', error);
    res.status(500).json({ success: false, message: error.message || '获取筛选选项失败' });
  }
});

export default router;
