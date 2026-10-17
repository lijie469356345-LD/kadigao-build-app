import { ReactNode, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { getPkTaskOrders, PkTaskOrder, getPkDailyFollowup, PkDailyFollowupResult, PkDailyFollowupRow, PkScopeMeta, getPkScopeMeta, PkDataDimFilter } from '../../api/pk';
import PkScopeFilterBar from '../components/PkScopeFilterBar';
import { RefreshCw, ClipboardList, CalendarDays, Search, X, Store, UserCog, MapPin, TrendingUp, AlertTriangle, ArrowUp, ArrowDown, ArrowUpDown, Filter, Download, Package } from 'lucide-react';
import * as XLSX from 'xlsx';

function fmtRate(rate: number | null): string {
  if (rate == null || !isFinite(Number(rate))) return '∞';
  if (rate === 0) return '0%';
  return `${(rate * 100).toFixed(3)}%`;
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null || !isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2, useGrouping: false });
}

function fmtInt(v: number | null | undefined): string {
  if (v == null || !isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 0, useGrouping: false });
}

function fmtShowDate(d: string): string {
  const m = /^(\d{4})-0?(\d{1,2})-0?(\d{1,2})$/.exec(d);
  return m ? `${m[1]}-${Number(m[2])}-${Number(m[3])}` : d;
}

/** 达成率高亮：>=100% 绿、0 灰、否则玫红（与 PK 系列一致） */
function rateClass(rate: number): string {
  if (rate >= 1) return 'text-emerald-600 font-bold';
  if (rate <= 0) return 'text-gray-400';
  return 'text-red-600 font-bold';
}

/** 同比着色：正增长红、负增长绿、无同比灰 */
function yoyClass(v: number | null): string {
  if (v == null) return 'text-gray-400';
  if (v > 0) return 'text-red-600 font-bold';
  if (v < 0) return 'text-emerald-600 font-bold';
  return 'text-gray-400';
}

function sumOf<T>(rows: T[], pick: (r: T) => number): number {
  return rows.reduce((s, r) => s + (Number(pick(r)) || 0), 0);
}

type Row = PkDailyFollowupRow & Record<string, any>;

/** 数值列键：排序时按数值比较（Infinity/NaN 排末尾） */
const NUMERIC_KEYS = new Set([
  'totalTarget', 'totalActual', 'totalRate', 'yoy',
  'salesQty', 'orderCount', 'attachmentRate', 'giftAmount', 'giftRatio',
  'avgItemPrice', 'avgOrderValue', 'shops', 'activeShops', 'lyActiveShops',
  'storeSales', 'lyStoreSales', 'storeSalesYoy',
  'lyTotalActual', 'lySalesQty', 'lyOrderCount', 'lyAttachmentRate',
  'lyGiftAmount', 'lyGiftRatio', 'lyAvgItemPrice', 'lyAvgOrderValue',
  'dxAmount', 'dxQty', 'dxOrder', 'lyDxAmount', 'lyDxQty', 'lyDxOrder',
]);
/** 每日列键：dailyTarget_2026-09-18 / dailyActual_... / dailyRate_... */
const DAILY_KEY_RE = /^daily(Target|Actual|Rate)_(\d{4}-\d{2}-\d{2})$/;

function isNumericKey(key: string): boolean {
  return NUMERIC_KEYS.has(key) || DAILY_KEY_RE.test(key);
}

interface SortState { key: string; dir: 1 | -1; }

function cmpByKey(a: Row, b: Row, key: string): number {
  if (isNumericKey(key)) {
    const va = a[key]; const vb = b[key];
    const na = Number(va); const nb = Number(vb);
    const aBad = va == null || va === '' || isNaN(na);
    const bBad = vb == null || vb === '' || isNaN(nb);
    if (aBad && bBad) return 0;
    if (aBad) return 1;   // 缺失值排最后（升序）
    if (bBad) return -1;
    if (!isFinite(na)) return 1;  // Infinity（∞ 达成率）排最后
    if (!isFinite(nb)) return -1;
    return na - nb;
  }
  return String(a[key] ?? '').localeCompare(String(b[key] ?? ''), 'zh-CN');
}

function applySort(rows: Row[], s: SortState | null): Row[] {
  if (!s) return rows;
  return rows.slice().sort((x, y) => s.dir * cmpByKey(x, y, s.key));
}

function sortArrow(s: SortState | null, key: string): ReactNode {
  if (!s || s.key !== key) return <ArrowUpDown size={12} className="text-gray-300" />;
return s.dir === 1 ? <ArrowUp size={12} className="text-blue-600" /> : <ArrowDown size={12} className="text-blue-600" />;
}

/** 销售等级徽标颜色：S=金、A=蓝、B=橙、C=灰 */
function gradeCls(grade: string): string {
  switch (grade) {
    case 'S': return 'bg-gradient-to-br from-amber-400 to-yellow-500 shadow-sm';
    case 'A': return 'bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm';
    case 'B': return 'bg-gradient-to-br from-orange-400 to-amber-600 shadow-sm';
    default: return 'bg-gradient-to-br from-gray-400 to-gray-500 shadow-sm';
  }
}

function PkDailyFollowupPage() {
  const [taskOrders, setTaskOrders] = useState<PkTaskOrder[]>([]);
  const [orderId, setOrderId] = useState<number | ''>('');
  // 日期筛选器：控制区间指标（总目标/业绩金额/同比/达成率/销售数量/开单数/连带率/礼包/客单价/件单价）时间范围
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  // 展示日期筛选器：控制每日 目标/业绩/达成 列的展示范围
  const [showFrom, setShowFrom] = useState<string>('');
  const [showTo, setShowTo] = useState<string>('');
  const [table, setTable] = useState<PkDailyFollowupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [quickSearch, setQuickSearch] = useState<string>('');
  // 七维筛选（仓库类别/督导/区经/经销商/店铺名称/月可比/年可比，服务端过滤）
  const [scopeMeta, setScopeMeta] = useState<PkScopeMeta | null>(null);
  const [scopeFilter, setScopeFilter] = useState<string>('');
  const [dimFilter, setDimFilter] = useState<PkDataDimFilter>({ warehouse: '', supervisor: '', districtManager: '', dealer: '', shopName: '', monthComparables: [], yearComparables: [] });
  // 月可比/年可比 多选弹窗开关
  const [compPicker, setCompPicker] = useState<'' | 'month' | 'year'>('');
  const [compDraft, setCompDraft] = useState<string[]>([]);
  const [sort1, setSort1] = useState<SortState | null>(null);
  const [sort2, setSort2] = useState<SortState | null>(null);
  const [sort3, setSort3] = useState<SortState | null>(null);
  const [sort4, setSort4] = useState<SortState | null>(null);
  const sorts = [sort1, sort2, sort3, sort4];
  const setSorts = [setSort1, setSort2, setSort3, setSort4];

  const onSort = (zoneIdx: number, key: string) => {
    const cur = sorts[zoneIdx];
    const next: SortState = cur && cur.key === key ? { key, dir: cur.dir === 1 ? -1 : 1 } : { key, dir: 1 };
    setSorts[zoneIdx](next);
  };

  const currentOrder = taskOrders.find(o => o.id === orderId) || null;

  useEffect(() => {
    getPkTaskOrders().then(res => {
      const list: PkTaskOrder[] = Array.isArray(res.data) ? res.data : [];
      setTaskOrders(list);
      if (list.length > 0) setOrderId(list[0].id);
    }).catch(() => {});
  }, []);

  // 任务单切换：日期筛选器/展示日期筛选器默认取任务单 PK 开始日 ~ 统计日
  useEffect(() => {
    const start = currentOrder?.pkStartDate || '';
    setDateFrom(start);
    setDateTo('');
    setShowFrom(start);
    setShowTo('');
    setTable(null);
    setError('');
    setQuickSearch('');
    setScopeFilter('');
    setDimFilter({ warehouse: '', supervisor: '', districtManager: '', dealer: '', shopName: '', monthComparables: [], yearComparables: [] });
    setScopeMeta(null);
    if (orderId === '') return;
    getPkScopeMeta({ taskOrderId: Number(orderId) }).then(res => setScopeMeta(res.data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const loadFollowup = async () => {
    if (orderId === '') { alert('请先选择 PK任务单'); return; }
    setLoading(true);
    setError('');
    try {
      // 单选页窄化：string | string[] -> string（取首个选值）
      const dimStr = (v: string | string[] | undefined): string | undefined =>
        Array.isArray(v) ? (v.length ? v[0] : undefined) : (v || undefined);
      const res = await getPkDailyFollowup({
        taskOrderId: Number(orderId),
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        showFrom: showFrom || undefined,
        showTo: showTo || undefined,
        filter: scopeFilter || undefined,
        warehouse: dimStr(dimFilter.warehouse),
        supervisor: dimStr(dimFilter.supervisor),
        districtManager: dimStr(dimFilter.districtManager),
        dealer: dimStr(dimFilter.dealer),
        shopName: dimStr(dimFilter.shopName),
        monthComparable: dimFilter.monthComparables?.length ? dimFilter.monthComparables.join(',') : undefined,
        yearComparable: dimFilter.yearComparables?.length ? dimFilter.yearComparables.join(',') : undefined,
      });
      setTable(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || '日目标跟进加载失败');
      setTable(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (orderId === '') return;
    loadFollowup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, dateFrom, dateTo, showFrom, showTo]);

  // 范围筛选 / 五维筛选变化：重新从服务端拉取过滤后的四区数据
  const dimFilterKey = JSON.stringify(dimFilter);
  useEffect(() => {
    if (orderId === '') return;
    loadFollowup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeFilter, dimFilterKey]);

  // 快速搜索：本地即时过滤四个区域（支持仓库类别/督导/商品/经销商/店铺名）
  const filtered = useMemo(() => {
    if (!table) return null;
    const q = quickSearch.trim().toLowerCase();
    if (!q) return table;
    return {
      ...table,
      zone1: (table.zone1 || []).filter(r =>
        String(r.supervisor || '').toLowerCase().includes(q) ||
        String(r.warehouseType || '').toLowerCase().includes(q)),
      zoneProduct: (table.zoneProduct || []).filter(r =>
        String(r.product || '').toLowerCase().includes(q) ||
        String(r.warehouseType || '').toLowerCase().includes(q)),
      zone2: (table.zone2 || []).filter(r =>
        String(r.supervisor || '').toLowerCase().includes(q) ||
        String(r.product || '').toLowerCase().includes(q) ||
        String(r.dealer || '').toLowerCase().includes(q) ||
        String(r.warehouseType || '').toLowerCase().includes(q)),
      zone3: (table.zone3 || []).filter(r =>
        String(r.supervisor || '').toLowerCase().includes(q) ||
        String(r.product || '').toLowerCase().includes(q) ||
        String(r.dealer || '').toLowerCase().includes(q) ||
        String(r.shopName || '').toLowerCase().includes(q) ||
        String(r.warehouseType || '').toLowerCase().includes(q)),
    };
  }, [table, quickSearch]);

  // 前端展示顺序：第一区=督导(zone1) → 第二区=商品(zoneProduct) → 第三区=经销商(zone2) → 第四区=督导-店铺(zone3)
  const zone1 = applySort(filtered?.zone1 ?? [], sort1);
  const zone2 = applySort(filtered?.zoneProduct ?? [], sort2);
  const zone3 = applySort(filtered?.zone2 ?? [], sort3);
  const zone4 = applySort(filtered?.zone3 ?? [], sort4);
  const noMatchBySearch = !!table && !!quickSearch.trim() && zone1.length === 0 && zone2.length === 0 && zone3.length === 0 && zone4.length === 0;
  const hasAny = zone1.length > 0 || zone2.length > 0 || zone3.length > 0 || zone4.length > 0;

  /** 导出当前日跟进报表为 xlsx（数据已按用户权限过滤，导出范围 = 当前页面四区全部数据） */
  const handleExport = () => {
    if (!table) return;
    const wb = XLSX.utils.book_new();
    const orderName = currentOrder?.orderName || '';
    const dates = table.showDates || [];
    // 概要 sheet
    const wsSummary = XLSX.utils.aoa_to_sheet([
      ['PK日跟进报表导出'],
      ['任务单', orderName],
      ['统计区间', `${table.dateFrom || '—'} ~ ${table.dateTo || table.endDate}`],
      ['每日列展示', `${table.showFrom || '—'} ~ ${table.showTo || table.endDate}`],
      ['参与店铺数', table.storeCount],
      ['数据模式', table.isMock ? '模拟数据（PK尚未开始）' : '真实业绩'],
      ['导出时间', new Date().toLocaleString('zh-CN')],
    ]);
    XLSX.utils.book_append_sheet(wb, wsSummary, '概要');

    // 构建指标列标题（与页面表头一致）
    const metricHeaderRow = (leadLabels: string[]): string[] => {
      const heads = [...leadLabels, '总目标'];
      for (const d of dates) heads.push(`${fmtShowDate(d)}目标`);
      heads.push('业绩金额', '同比');
      for (const d of dates) heads.push(`${fmtShowDate(d)}业绩`);
      heads.push('达成率');
      for (const d of dates) heads.push(`${fmtShowDate(d)}达成`);
      heads.push('本期店效', '同期店效', '店效同比');
      heads.push('销售数量', '同期销售数量', '开单数', '同期开单数', '连带率', '同期连带率', '礼包金额', '同期礼包金额', '礼包占比', '同期礼包占比', '客单价', '同期客单价', '件单价', '同期件单价');
      return heads;
    };

    // 构建数据行
    const buildDataRow = (r: Row, leads: string[]): (string | number)[] => {
      const dailyMap = new Map((r.daily || []).map(d => [d.date, d]));
      const row: (string | number)[] = [...leads, r.totalTarget ?? 0];
      for (const d of dates) row.push(dailyMap.get(d)?.target ?? 0);
      row.push(r.totalActual ?? 0);
      row.push(r.yoy != null ? `${(r.yoy * 100).toFixed(2)}%` : '—');
      for (const d of dates) row.push(dailyMap.get(d)?.actual ?? 0);
      row.push(r.totalRate ?? 0);
      for (const d of dates) row.push(dailyMap.get(d)?.rate ?? 0);
      row.push(r.storeSales ?? '—', r.lyStoreSales ?? '—');
      row.push(r.storeSalesYoy != null ? `${(r.storeSalesYoy * 100).toFixed(2)}%` : '—');
      row.push(r.salesQty ?? 0, r.lySalesQty ?? 0);
      row.push(r.orderCount ?? 0, r.lyOrderCount ?? 0);
      row.push(r.attachmentRate != null ? Number(r.attachmentRate).toFixed(2) : '—');
      row.push(r.lyAttachmentRate != null ? Number(r.lyAttachmentRate).toFixed(2) : '—');
      row.push(r.giftAmount ?? 0, r.lyGiftAmount ?? 0);
      row.push(r.giftRatio != null ? `${(Number(r.giftRatio) * 100).toFixed(2)}%` : '—');
      row.push(r.lyGiftRatio != null ? `${(Number(r.lyGiftRatio) * 100).toFixed(2)}%` : '—');
      row.push(r.avgOrderValue ?? 0, r.lyAvgOrderValue ?? 0);
      row.push(r.avgItemPrice ?? 0, r.lyAvgItemPrice ?? 0);
      return row;
    };

    // 构建合计行
    const buildTotalRow = (rows: Row[], leadCount: number): (string | number)[] => {
      const sumT = (d: string) => sumOf(rows, r => (r.daily || []).find(x => x.date === d)?.target || 0);
      const sumA = (d: string) => sumOf(rows, r => (r.daily || []).find(x => x.date === d)?.actual || 0);
      const totalTarget = sumOf(rows, r => r.totalTarget);
      const totalActual = sumOf(rows, r => r.totalActual);
      const lastYearAmt = sumOf(rows, r => r.lastYearAmt);
      const salesQty = sumOf(rows, r => r.salesQty);
      const orderCount = sumOf(rows, r => r.orderCount);
      const giftAmount = sumOf(rows, r => r.giftAmount);
      const lyTotalActual = sumOf(rows, r => r.lyTotalActual);
      const lySalesQty = sumOf(rows, r => r.lySalesQty);
      const lyOrderCount = sumOf(rows, r => r.lyOrderCount);
      const lyGiftAmount = sumOf(rows, r => r.lyGiftAmount);
      const totalRow: (string | number)[] = [`合计（${rows.length} 行）`];
      for (let i = 1; i < leadCount; i++) totalRow.push('');
      totalRow.push(totalTarget);
      for (const d of dates) totalRow.push(sumT(d));
      totalRow.push(totalActual);
      totalRow.push(lastYearAmt > 0 ? `${((totalActual / lastYearAmt - 1) * 100).toFixed(2)}%` : '—');
      for (const d of dates) totalRow.push(sumA(d));
      totalRow.push(totalTarget > 0 ? totalActual / totalTarget : 0);
      for (const d of dates) {
        const t = sumT(d); const a = sumA(d);
        totalRow.push(t > 0 ? a / t : 0);
      }
      // 店效 本期+同期+同比（合计 = 业绩合计 / 活跃店铺数合计）
      const activeShops = sumOf(rows, r => r.activeShops);
      const lyActiveShops = sumOf(rows, r => r.lyActiveShops);
      const storeSales = activeShops > 0 ? Math.round(totalActual / activeShops) : null;
      const lyStoreSales = lyActiveShops > 0 ? Math.round(lyTotalActual / lyActiveShops) : null;
      const storeSalesYoy = (lyStoreSales != null && lyStoreSales > 0) ? (storeSales ?? 0) / lyStoreSales - 1 : null;
      totalRow.push(storeSales ?? '—', lyStoreSales ?? '—');
      totalRow.push(storeSalesYoy == null ? '—' : `${(storeSalesYoy * 100).toFixed(2)}%`);
      // 销售数量 本期+同期
      totalRow.push(salesQty, lySalesQty);
      // 开单数 本期+同期
      totalRow.push(orderCount, lyOrderCount);
      // 连带率 本期+同期：完全按「店铺均价_开单数_连带率」台账分子分母（合计=台账覆盖店铺的鞋数量/开单数累加）
      const dxAmount = sumOf(rows, r => r.dxAmount);
      const dxQty = sumOf(rows, r => r.dxQty);
      const dxOrder = sumOf(rows, r => r.dxOrder);
      const lyDxAmount = sumOf(rows, r => r.lyDxAmount);
      const lyDxQty = sumOf(rows, r => r.lyDxQty);
      const lyDxOrder = sumOf(rows, r => r.lyDxOrder);
      const hasDx = dxOrder !== 0 || dxQty !== 0 || dxAmount !== 0;
      const hasLyDx = lyDxOrder !== 0 || lyDxQty !== 0 || lyDxAmount !== 0;
      totalRow.push(hasDx ? (dxOrder !== 0 ? (dxQty / dxOrder).toFixed(2) : '—') : (orderCount > 0 ? (salesQty / orderCount).toFixed(2) : '—'));
      totalRow.push(hasLyDx ? (lyDxOrder !== 0 ? (lyDxQty / lyDxOrder).toFixed(2) : '—') : (lyOrderCount > 0 ? (lySalesQty / lyOrderCount).toFixed(2) : '—'));
      // 礼包金额 本期+同期
      totalRow.push(giftAmount, lyGiftAmount);
      // 礼包占比 本期+同期
      totalRow.push(totalActual > 0 ? `${(giftAmount / totalActual * 100).toFixed(2)}%` : '—');
      totalRow.push(lyTotalActual > 0 ? `${(lyGiftAmount / lyTotalActual * 100).toFixed(2)}%` : '—');
      // 客单价 本期+同期（台账口径）
      totalRow.push(hasDx ? (dxOrder !== 0 ? dxAmount / dxOrder : 0) : (orderCount > 0 ? totalActual / orderCount : 0));
      totalRow.push(hasLyDx ? (lyDxOrder !== 0 ? lyDxAmount / lyDxOrder : 0) : (lyOrderCount > 0 ? lyTotalActual / lyOrderCount : 0));
      // 件单价 本期+同期（台账口径）
      totalRow.push(hasDx ? (dxQty > 0 ? dxAmount / dxQty : 0) : (salesQty > 0 ? totalActual / salesQty : 0));
      totalRow.push(hasLyDx ? (lyDxQty > 0 ? lyDxAmount / lyDxQty : 0) : (lySalesQty > 0 ? lyTotalActual / lySalesQty : 0));
      return totalRow;
    };

    // 第一区 督导
    if ((table.zone1 || []).length > 0) {
      const leadLabels = ['仓库类别', '督导'];
      const dataRows = (table.zone1 || []).map(r => buildDataRow(r, [r.warehouseType || '—', r.supervisor || '—']));
      const aoa = [metricHeaderRow(leadLabels), ...dataRows, buildTotalRow(table.zone1 || [], leadLabels.length)];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '第一区-督导');
    }
    // 第二区 商品
    if ((table.zoneProduct || []).length > 0) {
      const leadLabels = ['仓库类别', '商品'];
      const dataRows = (table.zoneProduct || []).map(r => buildDataRow(r, [r.warehouseType || '—', r.product || '—']));
      const aoa = [metricHeaderRow(leadLabels), ...dataRows, buildTotalRow(table.zoneProduct || [], leadLabels.length)];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '第二区-商品');
    }
// 第三区 经销商（含商品列）
    if ((table.zone2 || []).length > 0) {
      const leadLabels = ['仓库类别', '督导', '商品', '经销商', '销售等级'];
      const dataRows = (table.zone2 || []).map(r => buildDataRow(r, [r.warehouseType || '—', r.supervisor || '—', r.product || '—', r.dealer || '—', r.dealerGrade || '—']));
      const aoa = [metricHeaderRow(leadLabels), ...dataRows, buildTotalRow(table.zone2 || [], leadLabels.length)];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '第三区-经销商');
    }
    // 第四区 督导-店铺（含商品列）
    if ((table.zone3 || []).length > 0) {
      const leadLabels = ['仓库类别', '督导', '商品', '经销商', '店铺销售等级', '店铺名称'];
      const dataRows = (table.zone3 || []).map(r => buildDataRow(r, [r.warehouseType || '—', r.supervisor || '—', r.product || '—', r.dealer || '—', r.shopGrade || '—', r.shopName || '—']));
      const aoa = [metricHeaderRow(leadLabels), ...dataRows, buildTotalRow(table.zone3 || [], leadLabels.length)];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '第四区-店铺');
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `PK日跟进报表_${orderName}_${table.endDate || dateStr}.xlsx`);
  };


  const thCls = 'px-2.5 py-2.5 text-left text-sm font-bold text-gray-900 whitespace-nowrap border-b-2 border-black bg-gray-50';
  const numTh = 'px-2.5 py-2.5 text-right text-sm font-bold text-gray-900 whitespace-nowrap border-b-2 border-black bg-gray-50';
  const tdCls = 'px-2.5 py-2 text-sm text-gray-800 whitespace-nowrap';
  const numTd = 'px-2.5 py-2 text-sm text-right tabular-nums text-gray-800 whitespace-nowrap';

  const sectionCard = 'rounded-2xl bg-white border-2 border-black ring-2 ring-[#D4AF37] shadow-sm overflow-hidden';
  const sectionTitle = 'px-4 py-3 bg-white border-b-2 border-black flex items-center gap-2 text-base font-black text-gray-900';

  if (error) {
    return (
      <Layout title="PK日目标跟进" subtitle="督导 / 商品 / 经销商 / 店铺四区滚动跟进：目标、业绩、达成率与销售过程指标">
        <div className="p-4">
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 text-sm">{error}</div>
        </div>
      </Layout>
    );
  }

  /** 指标列定义：总目标 + 每日目标列（按展示日期）+ 业绩金额 + 每日业绩列 + 达成率 + 每日达成列 + 过程指标列 */
  const metricHeaders = (td: string, sortState: SortState | null, handleSort: (key: string) => void): ReactNode[] => {
    if (!table) return [];
    const dates = table.showDates || [];
    const heads: ReactNode[] = [];
    const pushTh = (key: string, label: string) => {
      heads.push(
        <th key={key} className={`${td} cursor-pointer select-none hover:bg-indigo-50`} onClick={() => handleSort(key)} title={`按${label}排序`}>
          <span className="inline-flex items-center gap-1 justify-end">{label}{sortArrow(sortState, key)}</span>
        </th>
      );
    };
    pushTh('totalTarget', '总目标');
    for (const d of dates) pushTh(`dailyTarget_${d}`, `${fmtShowDate(d)}目标`);
    pushTh('totalActual', '业绩金额');
    pushTh('yoy', '同比');
    for (const d of dates) pushTh(`dailyActual_${d}`, `${fmtShowDate(d)}业绩`);
    pushTh('totalRate', '达成率');
    for (const d of dates) pushTh(`dailyRate_${d}`, `${fmtShowDate(d)}达成`);
    // 店效：本期店效 + 同期店效 + 店效同比
    pushTh('storeSales', '本期店效');
    pushTh('lyStoreSales', '同期店效');
    pushTh('storeSalesYoy', '店效同比');
    // 销售数量：本期 + 同期
    pushTh('salesQty', '销售数量');
    pushTh('lySalesQty', '同期销售数量');
    // 开单数：本期 + 同期
    pushTh('orderCount', '开单数');
    pushTh('lyOrderCount', '同期开单数');
    // 连带率：本期 + 同期
    pushTh('attachmentRate', '连带率');
    pushTh('lyAttachmentRate', '同期连带率');
    // 礼包金额：本期 + 同期
    pushTh('giftAmount', '礼包金额');
    pushTh('lyGiftAmount', '同期礼包金额');
    // 礼包占比：本期 + 同期
    pushTh('giftRatio', '礼包占比');
    pushTh('lyGiftRatio', '同期礼包占比');
    // 客单价：本期 + 同期
    pushTh('avgOrderValue', '客单价');
    pushTh('lyAvgOrderValue', '同期客单价');
    // 件单价：本期 + 同期
    pushTh('avgItemPrice', '件单价');
    pushTh('lyAvgItemPrice', '同期件单价');
    return heads;
  };

  /** 将行内 daily 数组展平为 dailyTarget_日期 / dailyActual_日期 / dailyRate_日期 键，供排序比较 */
  const flatRow = (r: Row): Row => {
    const out: Row = { ...r };
    for (const d of (r.daily || [])) {
      out[`dailyTarget_${d.date}`] = d.target;
      out[`dailyActual_${d.date}`] = d.actual;
      out[`dailyRate_${d.date}`] = d.rate;
    }
    return out;
  };

  const metricCells = (rIn: Row): ReactNode[] => {
    const r = flatRow(rIn);
    const dates = table?.showDates || [];
    const dailyMap = new Map((rIn.daily || []).map(d => [d.date, d]));
    const cells: ReactNode[] = [];
    const pushTd = (key: string, node: ReactNode, cls: string = numTd) => cells.push(<td key={key} className={cls}>{node}</td>);
    pushTd('t', fmtMoney(r.totalTarget));
    for (const d of dates) pushTd(`dt_${d}`, fmtMoney(dailyMap.get(d)?.target));
    pushTd('a', fmtMoney(r.totalActual));
    pushTd('yoy', r.yoy == null ? '—' : `${(r.yoy * 100).toFixed(2)}%`, `${numTd} ${yoyClass(r.yoy)}`);
    for (const d of dates) pushTd(`da_${d}`, fmtMoney(dailyMap.get(d)?.actual));
    pushTd('r', fmtRate(r.totalRate), `${numTd} ${rateClass(r.totalRate)}`);
    for (const d of dates) {
      const day = dailyMap.get(d);
      pushTd(`dr_${d}`, fmtRate(day?.rate ?? 0), `${numTd} ${rateClass(day?.rate ?? 0)}`);
    }
    pushTd('ss', fmtInt(r.storeSales));
    pushTd('lyss', fmtInt(r.lyStoreSales));
    pushTd('ssy', r.storeSalesYoy == null ? '—' : `${(r.storeSalesYoy * 100).toFixed(2)}%`, `${numTd} ${yoyClass(r.storeSalesYoy)}`);
    pushTd('q', fmtInt(r.salesQty));
    pushTd('lyq', fmtInt(r.lySalesQty));
    pushTd('o', fmtInt(r.orderCount));
    pushTd('lyo', fmtInt(r.lyOrderCount));
    pushTd('att', r.attachmentRate ? Number(r.attachmentRate).toFixed(2) : '—');
    pushTd('lyatt', r.lyAttachmentRate ? Number(r.lyAttachmentRate).toFixed(2) : '—');
    pushTd('g', fmtMoney(r.giftAmount));
    pushTd('lyg', fmtMoney(r.lyGiftAmount));
    pushTd('gr', r.giftRatio ? `${(Number(r.giftRatio) * 100).toFixed(2)}%` : '—');
    pushTd('lygr', r.lyGiftRatio ? `${(Number(r.lyGiftRatio) * 100).toFixed(2)}%` : '—');
    pushTd('ao', fmtMoney(r.avgOrderValue));
    pushTd('lyao', fmtMoney(r.lyAvgOrderValue));
    pushTd('p', fmtMoney(r.avgItemPrice));
    pushTd('lyp', fmtMoney(r.lyAvgItemPrice));
    return cells;
  };

  interface LeadDef {
    header: string;
    sortKey: string;
    width: number;   // 维度列固定列宽（px），锁定列必须固定宽度
    cell: (r: Row) => ReactNode;
  }

  interface ZoneSpec {
    title: string;
    icon: ReactNode;
    leads: LeadDef[];
    keyOf: (r: Row) => string;
  }

  const buildZone = (rowsIn: Row[], spec: ZoneSpec, zoneIdx: number) => {
    const rows = rowsIn.map(flatRow);
    const leadCount = spec.leads.length;
    const showDates = table?.showDates || [];
    const totalCols = leadCount + 21 + showDates.length * 3;
    const sortState = sorts[zoneIdx];
    const handleSort = (key: string) => onSort(zoneIdx, key);
    // 维度列锁定：按各 lead 固定列宽累计 left 偏移（px）
    const leadLefts: number[] = [];
    let acc = 0;
    for (const l of spec.leads) { leadLefts.push(acc); acc += l.width; }
    const totalLeadWidth = acc;
    // sticky 列统一样式：定位 + 层级 + 右侧分隔阴影，保证滚动时上层覆盖与视觉区分
    const stickyThStyle = (i: number) => ({ position: 'sticky' as const, left: leadLefts[i], zIndex: 20, minWidth: spec.leads[i].width, width: spec.leads[i].width, boxShadow: '2px 0 4px rgba(0,0,0,0.08)' });
    const stickyTdStyle = (i: number) => ({ position: 'sticky' as const, left: leadLefts[i], zIndex: 2, minWidth: spec.leads[i].width, width: spec.leads[i].width, boxShadow: '2px 0 4px rgba(0,0,0,0.08)' });
    // 合计行单元格：与表头/明细列顺序一致（每日三组列动态生成）
    const totalCells = (): ReactNode[] => {
      const sumT = (d: string) => sumOf(rows, r => (r.daily || []).find(x => x.date === d)?.target || 0);
      const sumA = (d: string) => sumOf(rows, r => (r.daily || []).find(x => x.date === d)?.actual || 0);
      const totalTarget = sumOf(rows, r => r.totalTarget);
      const totalActual = sumOf(rows, r => r.totalActual);
      const lastYearAmt = sumOf(rows, r => r.lastYearAmt);
      const salesQty = sumOf(rows, r => r.salesQty);
      const orderCount = sumOf(rows, r => r.orderCount);
      const giftAmount = sumOf(rows, r => r.giftAmount);
      // 去年同期合计
      const lyTotalActual = sumOf(rows, r => r.lyTotalActual);
      const lySalesQty = sumOf(rows, r => r.lySalesQty);
      const lyOrderCount = sumOf(rows, r => r.lyOrderCount);
      const lyGiftAmount = sumOf(rows, r => r.lyGiftAmount);
      const cells: ReactNode[] = [];
      const pushTd = (node: ReactNode, key: string) => cells.push(<td key={key} className={numTd + ' font-black'}>{node}</td>);
      pushTd(fmtMoney(totalTarget), 'ct');
      for (const d of showDates) pushTd(fmtMoney(sumT(d)), `ct_${d}`);
      pushTd(fmtMoney(totalActual), 'ca');
      pushTd(lastYearAmt > 0 ? `${((totalActual / lastYearAmt - 1) * 100).toFixed(2)}%` : '—', 'cyoy');
      for (const d of showDates) pushTd(fmtMoney(sumA(d)), `ca_${d}`);
      pushTd(fmtRate(totalTarget > 0 ? totalActual / totalTarget : 0), 'cr');
      for (const d of showDates) {
        const t = sumT(d); const a = sumA(d);
        pushTd(fmtRate(t > 0 ? a / t : 0), `cr_${d}`);
      }
      // 店效 本期+同期+同比（合计 = 业绩合计 / 活跃店铺数合计）
      const activeShops = sumOf(rows, r => r.activeShops);
      const lyActiveShops = sumOf(rows, r => r.lyActiveShops);
      const storeSales = activeShops > 0 ? Math.round(totalActual / activeShops) : null;
      const lyStoreSales = lyActiveShops > 0 ? Math.round(lyTotalActual / lyActiveShops) : null;
      const storeSalesYoy = (lyStoreSales != null && lyStoreSales > 0) ? (storeSales ?? 0) / lyStoreSales - 1 : null;
      pushTd(fmtInt(storeSales), 'css');
      pushTd(fmtInt(lyStoreSales), 'clyss');
      pushTd(storeSalesYoy == null ? '—' : `${(storeSalesYoy * 100).toFixed(2)}%`, 'cssy');
      // 销售数量 本期+同期
      pushTd(fmtInt(salesQty), 'cq');
      pushTd(fmtInt(lySalesQty), 'clyq');
      // 开单数 本期+同期
      pushTd(fmtInt(orderCount), 'co');
      pushTd(fmtInt(lyOrderCount), 'clyo');
      // 连带率 本期+同期：完全按「店铺均价_开单数_连带率」台账分子分母
      const dxAmount = sumOf(rows, r => r.dxAmount);
      const dxQty = sumOf(rows, r => r.dxQty);
      const dxOrder = sumOf(rows, r => r.dxOrder);
      const lyDxAmount = sumOf(rows, r => r.lyDxAmount);
      const lyDxQty = sumOf(rows, r => r.lyDxQty);
      const lyDxOrder = sumOf(rows, r => r.lyDxOrder);
      const hasDx = dxOrder !== 0 || dxQty !== 0 || dxAmount !== 0;
      const hasLyDx = lyDxOrder !== 0 || lyDxQty !== 0 || lyDxAmount !== 0;
      pushTd(hasDx ? (dxOrder !== 0 ? (dxQty / dxOrder).toFixed(2) : '—') : (orderCount > 0 ? (salesQty / orderCount).toFixed(2) : '—'), 'catt');
      pushTd(hasLyDx ? (lyDxOrder !== 0 ? (lyDxQty / lyDxOrder).toFixed(2) : '—') : (lyOrderCount > 0 ? (lySalesQty / lyOrderCount).toFixed(2) : '—'), 'clyatt');
      // 礼包金额 本期+同期
      pushTd(fmtMoney(giftAmount), 'cg');
      pushTd(fmtMoney(lyGiftAmount), 'clyg');
      // 礼包占比 本期+同期
      pushTd(totalActual > 0 ? `${(giftAmount / totalActual * 100).toFixed(2)}%` : '—', 'cgr');
      pushTd(lyTotalActual > 0 ? `${(lyGiftAmount / lyTotalActual * 100).toFixed(2)}%` : '—', 'clygr');
      // 客单价 本期+同期（台账口径）
      pushTd(hasDx ? (dxOrder !== 0 ? fmtMoney(dxAmount / dxOrder) : '—') : (orderCount > 0 ? fmtMoney(totalActual / orderCount) : '—'), 'cao');
      pushTd(hasLyDx ? (lyDxOrder !== 0 ? fmtMoney(lyDxAmount / lyDxOrder) : '—') : (lyOrderCount > 0 ? fmtMoney(lyTotalActual / lyOrderCount) : '—'), 'clyao');
      // 件单价 本期+同期（台账口径）
      pushTd(hasDx ? (dxQty > 0 ? fmtMoney(dxAmount / dxQty) : '—') : (salesQty > 0 ? fmtMoney(totalActual / salesQty) : '—'), 'cp');
      pushTd(hasLyDx ? (lyDxQty > 0 ? fmtMoney(lyDxAmount / lyDxQty) : '—') : (lySalesQty > 0 ? fmtMoney(lyTotalActual / lySalesQty) : '—'), 'clyp');
      return cells;
    };
    return (
      <section className={sectionCard}>
        <div className={sectionTitle}>{spec.icon} {spec.title}</div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: totalLeadWidth + 2100 + showDates.length * 170 }}>
            <thead>
              <tr>
                {spec.leads.map((l, i) => (
                  <th key={i} className={`${thCls} cursor-pointer select-none hover:bg-indigo-50`} onClick={() => handleSort(l.sortKey)} title={`按${l.header}排序`} style={stickyThStyle(i)}>
                    <span className="inline-flex items-center gap-1">{l.header}{sortArrow(sortState, l.sortKey)}</span>
                  </th>
                ))}
                {metricHeaders(numTh, sortState, handleSort)}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={totalCols} className="px-3 py-8 text-center text-gray-400 text-sm">暂无数据</td></tr>
              ) : rows.map(r => (
                <tr key={spec.keyOf(r)} className="border-b border-gray-100 hover:bg-gray-50 group">
                  {spec.leads.map((l, i) => <td key={i} className={`${l.sortKey === 'shopName' ? 'px-2.5 py-2 text-sm text-gray-800 max-w-64' : tdCls} bg-white group-hover:bg-gray-50`} style={stickyTdStyle(i)}>{l.cell(r)}</td>)}
                  {metricCells(r)}
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="bg-gray-50 font-bold">
                  <td className={tdCls + ' font-black'} colSpan={leadCount} style={{ position: 'sticky', left: 0, zIndex: 2, minWidth: totalLeadWidth, width: totalLeadWidth, background: '#f9fafb', boxShadow: '2px 0 4px rgba(0,0,0,0.08)' }}>合计（{rows.length} 行）</td>
                  {totalCells()}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  const zones: ZoneSpec[] = [
    {
      title: '第一区 · 督导 日目标跟进', icon: <UserCog size={16} className="text-gray-900" />,
      leads: [
        { header: '仓库类别', sortKey: 'warehouseType', width: 110, cell: r => r.warehouseType || '—' },
        { header: '督导', sortKey: 'supervisor', width: 120, cell: r => r.supervisor || '—' },
      ],
      keyOf: r => `${r.supervisor || ''}`,
    },
    {
      title: '第二区 · 商品 日目标跟进', icon: <Package size={16} className="text-gray-900" />,
      leads: [
        { header: '仓库类别', sortKey: 'warehouseType', width: 110, cell: r => r.warehouseType || '—' },
        { header: '商品', sortKey: 'product', width: 160, cell: r => r.product || '—' },
      ],
      keyOf: r => `${r.product || ''}`,
    },
{
      title: '第三区 · 经销商 日目标跟进', icon: <TrendingUp size={16} className="text-gray-900" />,
      leads: [
        { header: '仓库类别', sortKey: 'warehouseType', width: 110, cell: r => r.warehouseType || '—' },
        { header: '督导', sortKey: 'supervisor', width: 120, cell: r => r.supervisor || '—' },
        { header: '商品', sortKey: 'product', width: 160, cell: r => r.product || '—' },
        { header: '经销商', sortKey: 'dealer', width: 160, cell: r => r.dealer || '—' },
        { header: '销售等级', sortKey: 'dealerGrade', width: 90, cell: r => (
          r.dealerGrade ? <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg font-black text-white ${gradeCls(r.dealerGrade)}`}>{r.dealerGrade}</span> : '—'
        ) },
      ],
      keyOf: r => `${r.supervisor || ''}||${r.product || ''}||${r.dealer || ''}`,
    },
    {
      title: '第四区 · 督导-店铺 日目标跟进', icon: <MapPin size={16} className="text-gray-900" />,
      leads: [
        { header: '仓库类别', sortKey: 'warehouseType', width: 110, cell: r => r.warehouseType || '—' },
        { header: '督导', sortKey: 'supervisor', width: 120, cell: r => r.supervisor || '—' },
        { header: '商品', sortKey: 'product', width: 160, cell: r => r.product || '—' },
        { header: '经销商', sortKey: 'dealer', width: 160, cell: r => r.dealer || '—' },
        { header: '店铺销售等级', sortKey: 'shopGrade', width: 90, cell: r => (
          r.shopGrade ? <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg font-black text-white ${gradeCls(r.shopGrade)}`}>{r.shopGrade}</span> : '—'
        ) },
        { header: '店铺名称', sortKey: 'shopName', width: 190, cell: r => (
          <span className="inline-block align-middle truncate max-w-full" title={r.shopName || ''}>{r.shopName || '—'}</span>
        ) },
      ],
      keyOf: r => `${r.supervisor || ''}||${r.dealer || ''}||${r.shopName || ''}`,
    },
  ];

  return (
    <Layout title="PK日目标跟进" subtitle={`督导 / 商品 / 经销商 / 店铺四区滚动跟进：目标、业绩、达成率与销售过程指标（统计至${table?.endDate || '今日'}）`}>
      <div className="p-4">
        {/* 工具栏 */}
        <div className="flex items-center gap-3 mb-4 flex-wrap bg-white rounded-xl shadow-sm border border-gray-100 p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 flex items-center gap-1"><ClipboardList size={14} /> PK任务单</span>
            <select value={orderId} onChange={e => setOrderId(e.target.value ? Number(e.target.value) : '')} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 min-w-44">
              <option value="">请选择任务单</option>
              {taskOrders.map(o => (
                <option key={o.id} value={o.id}>{o.orderName}{o.pkStartDate ? `（${o.pkStartDate} 起）` : ''}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-gray-500 flex items-center gap-1" title="总目标/业绩金额/达成率/销售数量/开单数/连带率/礼包/客单价/件单价 的时间范围"><CalendarDays size={14} /> 日期</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" />
            <span className="text-gray-400 text-xs">~</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-gray-500 flex items-center gap-1" title="每日 目标/业绩/达成 列的展示范围"><CalendarDays size={14} /> 展示日期</span>
            <input type="date" value={showFrom} onChange={e => setShowFrom(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" />
            <span className="text-gray-400 text-xs">~</span>
            <input type="date" value={showTo} onChange={e => setShowTo(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <PkScopeFilterBar meta={scopeMeta} filter={scopeFilter} onChange={setScopeFilter} disabled={loading || orderId === ''} dims={{ value: dimFilter, onChange: setDimFilter }} hideScope />
          <div className="flex items-center gap-1.5">
            {(['month', 'year'] as const).map(k => {
              const sel = dimFilter[k === 'month' ? 'monthComparables' : 'yearComparables'];
              return (
                <button
                  key={k}
                  onClick={() => { setCompDraft(sel || []); setCompPicker(k); }}
                  disabled={loading || orderId === ''}
                  className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 border disabled:opacity-40 ${(sel?.length || 0) > 0 ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  title={k === 'month' ? '月可比性筛选（多选）' : '年可比性筛选（多选）'}
                >
                  <Filter size={13} />
                  {k === 'month' ? '月可比' : '年可比'}
                  {(sel?.length || 0) > 0 && <span className="text-xs bg-indigo-100 rounded-full px-1.5">{sel!.join('/')}</span>}
                </button>
              );
            })}
          </div>
          <button onClick={loadFollowup} disabled={loading || orderId === ''} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-blue-700 disabled:opacity-40">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 刷新
          </button>
          {table && hasAny && (
            <button
              onClick={handleExport}
              className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-green-700"
            >
              <Download size={14} /> 导出Excel
            </button>
          )}
          {table && (
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Store size={13} /> {table.storeCount} 家店铺 · 区间指标 {table.dateFrom || '—'} ~ {table.dateTo || table.endDate} · 每日列 {table.showFrom || '—'} ~ {table.showTo || table.endDate}
            </span>
          )}
          <div className="relative ml-auto">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={quickSearch}
              onChange={e => setQuickSearch(e.target.value)}
              placeholder="快速搜索：仓库类别/督导/商品/经销商/店铺"
              className="pl-8 pr-7 py-1.5 border border-gray-200 rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            {quickSearch && (
              <button onClick={() => setQuickSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" title="清除搜索">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {compPicker && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setCompPicker('')}>
            <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-80 p-4" onClick={e => e.stopPropagation()}>
              <div className="text-sm font-semibold text-gray-800 mb-1">{compPicker === 'month' ? '月可比' : '年可比'}（多选）</div>
              <div className="text-xs text-gray-400 mb-3">候选随当前可见店铺收敛，与销售报表联动口径一致</div>
              <div className="space-y-1.5 max-h-60 overflow-y-auto mb-4">
                {(compPicker === 'month' ? (table?.comparableOptions?.month || []) : (table?.comparableOptions?.year || [])).map(opt => (
                  <label key={opt} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 rounded-lg px-2 py-1">
                    <input
                      type="checkbox"
                      checked={compDraft.includes(opt)}
                      onChange={e => {
                        const v = e.target.checked
                          ? [...compDraft, opt]
                          : compDraft.filter(x => x !== opt);
                        setCompDraft(v);
                      }}
                      className="accent-indigo-600"
                    />
                    {opt}
                  </label>
                ))}
              </div>
              <div className="flex justify-between items-center gap-2">
                <button
                  onClick={() => {
                    const next = { ...dimFilter };
                    if (compPicker === 'month') next.monthComparables = [];
                    else next.yearComparables = [];
                    setDimFilter(next);
                    setCompPicker('');
                  }}
                  className="px-3 py-1.5 rounded-lg text-sm text-gray-500 hover:bg-gray-100"
                >清空</button>
                <div className="flex items-center gap-2">
                  <button onClick={() => setCompPicker('')} className="px-3 py-1.5 rounded-lg text-sm text-gray-600 border border-gray-200 hover:bg-gray-50">取消</button>
                  <button
                    onClick={() => {
                      const next = { ...dimFilter };
                      if (compPicker === 'month') next.monthComparables = compDraft;
                      else next.yearComparables = compDraft;
                      setDimFilter(next);
                      setCompPicker('');
                    }}
                    className="px-4 py-1.5 rounded-lg text-sm bg-indigo-600 text-white hover:bg-indigo-700"
                  >确定</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {table?.isMock && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-300 px-4 py-3 flex items-start gap-3">
            <div className="mt-0.5 text-red-500 text-sm">🎯</div>
            <div className="text-sm text-red-600">
              <span className="font-bold text-red-600">PK 尚未开始</span>
              <span className="ml-2 text-red-500">{table.startDate ? `开始时间 ${table.startDate}` : ''} · 业绩统计至 {table.endDate}</span>
            </div>
          </div>
        )}
        {table?.statusText && !table.isMock && (
          <div className="mb-4 rounded-xl bg-amber-50 border border-amber-300 px-4 py-3 flex items-start gap-3">
            <AlertTriangle size={15} className="mt-0.5 text-amber-500 flex-shrink-0" />
            <div className="text-sm text-amber-700">{table.statusText}</div>
          </div>
        )}

        {!table && (
          <div className="bg-white rounded-3xl p-16 text-center border-2 border-black ring-2 ring-[#D4AF37]">
            <div className="text-6xl mb-4">📈</div>
            <div className="text-gray-900 text-lg font-bold mb-2">PK 日目标跟进</div>
            <div className="text-gray-500 text-sm">选择 PK任务单、日期（区间指标）与展示日期（每日列），按 督导 → 商品 → 经销商 → 店铺 四区查看目标达成与过程指标</div>
          </div>
        )}

        {table && (
          <div className="space-y-5">
            {noMatchBySearch && (
              <div className="rounded-2xl bg-white border-2 border-black ring-2 ring-[#D4AF37] p-10 text-center text-gray-600 text-sm">
                没有匹配「{quickSearch.trim()}」的仓库类别、督导、商品、经销商或店铺，换个关键词试试
              </div>
            )}
            {!noMatchBySearch && !hasAny && (
              <div className="rounded-2xl bg-white border-2 border-black ring-2 ring-[#D4AF37] p-10 text-center text-gray-600 text-sm">
                {table.scoped
                  ? '当前账号与本次 PK 无相关店铺（未参与该 PK），暂无数据展示'
                  : '该任务单暂无店铺目标或日目标，请先在「PK日目标上传」录入'}
              </div>
            )}

            {zone1.length > 0 && buildZone(zone1, zones[0], 0)}
            {zone2.length > 0 && buildZone(zone2, zones[1], 1)}
            {zone3.length > 0 && buildZone(zone3, zones[2], 2)}
            {zone4.length > 0 && buildZone(zone4, zones[3], 3)}
          </div>
        )}
      </div>
    </Layout>
  );
}

export default PkDailyFollowupPage;