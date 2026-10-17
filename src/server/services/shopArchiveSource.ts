import sql from 'mssql';
import { getPool } from '../../config/db';

// ============================================================
// 店仓数据源（与店铺档案 /api/shops/archive 同口径）
//  - 数据源：DataExtraction 表「店铺信息_区域区经督导」配置的 SQL，缺失时用内置 SQL
//  - 口径：只保留正常经营店铺（仓库类别 直营/山东直营/加盟）
// 组织管理-店仓选择、店铺档案等页面应统一使用本模块，保证取值一致
// ============================================================

export const FALLBACK_SQL = `SELECT 店铺名称 as shopName, 仓库类别 as warehouseType, 区域 as area,
  区经 as districtManager, 督导 as supervisor, 商品 as product, 商品组长 as productLeader,
  联系人 as contactPerson, 手机 as phone, 经销商 as dealer, 开业日期 as openDate,
  月可比性 as monthComparable, 年可比性 as yearComparable
FROM 店仓全 WHERE 仓库类别 IN ('直营','山东直营','加盟') ORDER BY 区域, 店铺名称`;

/** 向 SQL 注入仓库类别过滤（只保留正常经营店铺），兼容有/无 WHERE 的情况 */
export function injectWarehouseFilter(sqlText: string): string {
  const filter = `仓库类别 IN ('直营','山东直营','加盟')`;
  const orderIdx = sqlText.toUpperCase().lastIndexOf('ORDER BY');
  const hasWhere = /\bWHERE\b/i.test(sqlText);
  const prefix = hasWhere ? ' AND ' : ' WHERE ';
  if (orderIdx > 0) {
    return sqlText.substring(0, orderIdx) + prefix + filter + ' ' + sqlText.substring(orderIdx);
  }
  return sqlText + prefix + filter;
}

/** 去掉 ORDER BY 子句（供外层再包筛选/排序） */
export function stripOrderBy(sqlText: string): string {
  const orderIdx = sqlText.toUpperCase().lastIndexOf('ORDER BY');
  return orderIdx > 0 ? sqlText.slice(0, orderIdx) : sqlText;
}

// 档案/店仓选择共同依赖的列；DataExtraction SQL 缺失时自动补入（在 FROM 前插入）
const REQUIRED_COLS: { col: string; alias: string }[] = [
  { col: '商品组长', alias: 'productLeader' },
  { col: '月可比性', alias: 'monthComparable' },
  { col: '年可比性', alias: 'yearComparable' },
  { col: '经销商', alias: 'dealer' },
  { col: '仓库类别', alias: 'warehouseType' },
  { col: '区域', alias: 'area' },
  { col: '区经', alias: 'districtManager' },
  { col: '督导', alias: 'supervisor' },
  { col: '商品', alias: 'product' },
  { col: '联系人', alias: 'contactPerson' },
  { col: '手机', alias: 'phone' },
  { col: '开业日期', alias: 'openDate' },
];

/**
 * 加载基础 SQL：DataExtraction 配置 SQL（补全必选列 + 注入仓库类别过滤），缺失时用 FALLBACK_SQL。
 * 返回不含 ORDER BY 的 SELECT ... FROM 店仓全 [WHERE ...]（列名为 shopName/warehouseType/... 等英文别名）
 */
export async function loadShopArchiveBaseSQL(pool?: sql.ConnectionPool): Promise<string> {
  const p = pool || await getPool();
  let baseSQL = '';
  try {
    const dxResult = await p.request()
      .input('name', sql.NVarChar, '店铺信息_区域区经督导')
      .query(`SELECT sqlQuery FROM DataExtraction WHERE fieldName = @name`);
    if (dxResult.recordset.length > 0) {
      baseSQL = dxResult.recordset[0].sqlQuery;
      const missing = REQUIRED_COLS.filter(c => !new RegExp(c.col).test(baseSQL));
      if (missing.length > 0) {
        const m = baseSQL.match(/\bFROM\b/i);
        if (m && m.index) {
          const cols = missing.map(c => `, ${c.col} as ${c.alias}`).join(' ');
          baseSQL = baseSQL.slice(0, m.index) + cols + ' ' + baseSQL.slice(m.index);
        }
      }
    }
  } catch (e: any) {
    console.log('[ShopSource] DataExtraction 读取失败:', e.message);
  }
  if (!baseSQL) {
    baseSQL = FALLBACK_SQL;
  } else {
    baseSQL = injectWarehouseFilter(baseSQL);
  }
  return stripOrderBy(baseSQL);
}