import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { getStandardVisibleShopNames } from '../services/permissionService';

const router = Router();

// 毛利/费用/净利暂无成本数据源，先占位 null，前端显示 '-'；后续接成本表后回填真值
const NO_META = { 毛利率: null, 毛利: null, 费用额: null, 净利: null };

// 解析逗号分隔数组参数
function list(v: unknown): string[] {
  return (typeof v === 'string' && v) ? v.split(',').filter(Boolean) : [];
}

router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const year = Number(req.query.year) || new Date().getFullYear();
    const now = new Date();
    const cutoff = Math.min(12, Math.max(1, Number(req.query.month) || now.getMonth() + 1));
    const groupName = typeof req.query.groupName === 'string' ? req.query.groupName : '';

    // 联动筛选维度（全部/本区/本店/仓库/区经/经销商）
    const filter = {
      area: list(req.query.area),        // 区域
      sup: list(req.query.supervisor),   // 本区（督导）
      shop: list(req.query.shop),        // 本店
      dm: list(req.query.dm),            // 区经
      dealer: list(req.query.dealer),    // 经销商
      wh: list(req.query.warehouse),     // 仓库类别
    };

    // 权限收敛：当前用户可见店铺（null=全部可见，[]=无权，[names]=可见店铺）
    const visibleShops = groupName
      ? await getStandardVisibleShopNames(pool, groupName, req.user || null)
      : null;

    // 每期查询：筛选 + 权限 => 按店铺聚合营收
    const revByYear = (targetYear: number) => {
      const r = pool.request();
      r.input('fy', sql.Int, targetYear);
      r.input('fc', sql.Int, cutoff);
      const conds: string[] = [`YEAR(日期)=@fy`, `MONTH(日期)<=@fc`, `业绩金额 IS NOT NULL`];
      const addIn = (col: string, vals: string[], tag: string) => {
        if (!vals.length) return;
        conds.push(`${col} IN (${vals.map((_, i) => '@fi_' + tag + i).join(',')})`);
        vals.forEach((v, i) => r.input('fi_' + tag + i, sql.NVarChar, v));
      };
      addIn('区域', filter.area, 'ar');
      addIn('督导', filter.sup, 'sp');
      addIn('店铺名称', filter.shop, 'sh');
      addIn('区经', filter.dm, 'dm');
      addIn('经销商', filter.dealer, 'dl');
      addIn('仓库类别', filter.wh, 'wh');
      if (visibleShops !== null) {
        if (visibleShops.length === 0) {
          conds.push('1=0'); // 无权查看任何店铺
        } else {
          addIn('店铺名称', visibleShops, 'vp');
        }
      }
      return r.query(`
        SELECT 店铺名称, MAX(区域) AS 区域, MAX(督导) AS 督导, SUM(业绩金额) AS 营收
        FROM 有效业绩全
        WHERE ${conds.join(' AND ')}
        GROUP BY 店铺名称
      `);
    };

    const [curR, sameR] = await Promise.all([revByYear(year), revByYear(year - 1)]);

    const curArr = curR.recordset || [];
    const sameArr = sameR.recordset || [];

    const curMap = new Map(curArr.map(x => [x['店铺名称'], x]));
    const sameMap = new Map(sameArr.map(x => [x['店铺名称'], x]));

    const shopNames = Array.from(new Set([...curMap.keys(), ...sameMap.keys()])).sort();

    const buildRow = (shopName: string) => {
      const c = curMap.get(shopName);
      const s = sameMap.get(shopName);
      return {
        area: c?.区域 || s?.区域 || '',
        supervisor: c?.督导 || s?.督导 || '',
        shopName,
        rent: null,
        shopCount: 1,
        本期: { 营收: Number(c?.营收 || 0), ...NO_META },
        同期: { 营收: Number(s?.营收 || 0), ...NO_META },
      };
    };

    const rawRows = shopNames.map(buildRow);

    const detail = [...rawRows]
      .sort((a, b) => String(a.area).localeCompare(String(b.area)) || String(a.shopName).localeCompare(String(b.shopName)));

    const areaMap = new Map<string, { sum: number; same: number; count: number }>();
    rawRows.forEach(r => {
      const key = r.area || '(未划分)';
      const e = areaMap.get(key) || { sum: 0, same: 0, count: 0 };
      e.sum += r.本期.营收;
      e.same += r.同期.营收;
      e.count += 1;
      areaMap.set(key, e);
    });
    const summary = Array.from(areaMap.entries())
      .map(([area, v]) => ({
        area,
        rent: null,
        shopCount: v.count,
        本期: { 营收: v.sum, ...NO_META },
        同期: { 营收: v.same, ...NO_META },
      }))
      .sort((a, b) => String(a.area).localeCompare(String(b.area)));

    res.json({
      data: {
        year,
        cutoffMonth: cutoff,
        summary,
        detail,
      },
    });
  } catch (error) {
    console.error('[financial-revenue-profit] 查询失败:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;