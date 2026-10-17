import { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { getPkTaskOrders, PkTaskOrder, getPkNames, getPkDataTable, PkDataTableResult, PkScopeMeta, getPkScopeMeta, PkDataDimFilter } from '../../api/pk';
import PkScopeFilterBar from '../components/PkScopeFilterBar';
import { RefreshCw, CalendarDays, Search, Store, ClipboardList, TrendingUp, X, Warehouse, UserCog, Users, MapPin, Package, ArrowUp, ArrowDown, ChevronsUpDown, Download, Clock, Filter } from 'lucide-react';
import * as XLSX from 'xlsx';

function fmtRate(rate: number | null): string {
  if (rate == null || !isFinite(Number(rate))) return '∞';
  if (rate === 0) return '0%';
  return `${(rate * 100).toFixed(2)}%`;
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null || !isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2, useGrouping: false });
}

/** 达成率高亮：>=100% 绿、0 灰、否则玫红（与报表冠军色呼应） */
function rateClass(rate: number): string {
  if (rate >= 1) return 'text-emerald-600 font-bold';
  if (rate <= 0) return 'text-gray-400';
  return 'text-red-600 font-bold';
}

/** 时间进度：PK已过时间 / PK总时间（按天计算，含起止两端） */
function calcTimeProgress(pkStartDate?: string, pkEndDate?: string): { percent: number; elapsedDays: number; totalDays: number } | null {
  if (!pkStartDate || !pkEndDate) return null;
  const start = new Date(pkStartDate + 'T00:00:00');
  const end = new Date(pkEndDate + 'T00:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  const totalDays = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  if (totalDays <= 0) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const elapsedDays = Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86400000));
  const percent = Math.max(0, Math.min(100, (elapsedDays / totalDays) * 100));
  return { percent, elapsedDays: Math.min(elapsedDays, totalDays), totalDays };
}

function sumOf<T>(rows: T[], pick: (r: T) => number): number {
  return rows.reduce((s, r) => s + (Number(pick(r)) || 0), 0);
}

// ---------- 通用排序 ----------
export type SortDir = 'asc' | 'desc';
export interface ZoneSort { key: string; dir: SortDir }

/** 仓库类别的自然顺序：直营 → 加盟 → 其他 */
function wtRank(v: string): number {
  if (v === '直营') return 0;
  if (v === '加盟') return 1;
  return 2;
}

/**
 * 对指定分区行排序。
 * @param rows 原始行
 * @param sort 当前排序状态（key: 列字段，dir: 方向）
 * @param numericKeys 数值列集合（其余按文本比较；仓库类别按直营/加盟优先级）
 */
function sortRows<T extends Record<string, any>>(rows: T[], sort: ZoneSort | null, numericKeys: string[]): T[] {
  if (!sort || !sort.key) return rows;
  const { key, dir } = sort;
  const sign = dir === 'asc' ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (key === 'warehouseType') {
      const c = wtRank(String(av ?? '')) - wtRank(String(bv ?? ''));
      return c !== 0 ? c * sign : 0;
    }
    if (numericKeys.includes(key)) {
      const an = Number(av) || 0;
      const bn = Number(bv) || 0;
      if (an === bn) return 0;
      return (an > bn ? 1 : -1) * sign;
    }
    const as = String(av ?? '').trim();
    const bs = String(bv ?? '').trim();
    if (!as && !bs) return 0;
    if (!as) return 1 * sign; // 空值置底
    if (!bs) return -1 * sign;
    return as.localeCompare(bs, 'zh-CN') * sign;
  });
  return sorted;
}

/** 点击表头：同列切换方向，新列设置默认方向（文本 asc / 数值 desc） */
function nextSort(current: ZoneSort | null, key: string, numeric: boolean): ZoneSort {
  if (current && current.key === key) {
    return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key, dir: numeric ? 'desc' : 'asc' };
}

/** 表头排序图标：当前列+升序→▲，当前列+降序→▼，否则↕ */
function SortIcon({ sort, colKey }: { sort: ZoneSort | null; colKey: string }) {
  if (!sort || sort.key !== colKey) return <ChevronsUpDown size={12} className="inline-block ml-1 opacity-40" />;
  return sort.dir === 'asc'
    ? <ArrowUp size={12} className="inline-block ml-1 text-blue-600" />
    : <ArrowDown size={12} className="inline-block ml-1 text-blue-600" />;
}

function PkDataTablePage() {
  const [taskOrders, setTaskOrders] = useState<PkTaskOrder[]>([]);
  const [orderId, setOrderId] = useState<number | ''>('');
  const [pkNames, setPkNames] = useState<string[]>([]);
  const [pkName, setPkName] = useState<string>('');
  const [table, setTable] = useState<PkDataTableResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 快速搜索：本地即时过滤（匹配 仓库类别/区经/督导/店铺名称）
  const [quickSearch, setQuickSearch] = useState<string>('');
  // 范围筛选（全部/本区/本店，服务端过滤）
  const [scopeMeta, setScopeMeta] = useState<PkScopeMeta | null>(null);
  const [scopeFilter, setScopeFilter] = useState<string>('');
// 五维筛选（仓库类别/督导/区经/经销商/店铺名称/月可比/年可比，服务端过滤）
  const [dimFilter, setDimFilter] = useState<PkDataDimFilter>({ warehouse: [], supervisor: [], districtManager: [], dealer: [], shopName: [], monthComparables: [], yearComparables: [] });
  // 月可比/年可比 多选弹窗状态
  const [compPicker, setCompPicker] = useState<'' | 'month' | 'year'>('');
  const [compDraft, setCompDraft] = useState<string[]>([]);
// 是否参与英雄招募（服务端过滤）：''=全部 | yes=参与（英雄标≠0） | no=不参与（英雄标=0）
  const [announced, setAnnounced] = useState<string>('');
  // 时间段筛选器（服务端过滤）：业绩统计起始/截止日期，均空=按任务单自动口径
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  // 各分区独立排序：z1/z2/z3/z4/z5
  const [sort, setSort] = useState<{ z1: ZoneSort | null; z2: ZoneSort | null; z3: ZoneSort | null; z4: ZoneSort | null; z5: ZoneSort | null }>({ z1: null, z2: null, z3: null, z4: null, z5: null });
  const autoLoadedRef = useRef(false);

  // 数值列集合（按 数字 排序；其余按文本）
  const NUMERIC_KEYS = ['target', 'actual', 'rate', 'shops', 'heroMark', 'heroAchieveRate'];

  const currentOrder = taskOrders.find(o => o.id === orderId) || null;

  useEffect(() => {
    getPkTaskOrders().then(res => {
      const list: PkTaskOrder[] = Array.isArray(res.data) ? res.data : [];
      setTaskOrders(list);
      if (list.length > 0) setOrderId(list[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setPkName('');
    setTable(null);
    setError('');
    setQuickSearch('');
    setScopeFilter('');
setDimFilter({ warehouse: [], supervisor: [], districtManager: [], dealer: [], shopName: [], monthComparables: [], yearComparables: [] });
    setAnnounced('');
    setDateFrom('');
    setDateTo('');
    setScopeMeta(null);
    setSort({ z1: null, z2: null, z3: null, z4: null, z5: null });
    if (orderId === '') { setPkNames([]); return; }
    getPkScopeMeta({ taskOrderId: Number(orderId) }).then(res => setScopeMeta(res.data)).catch(() => {});
    getPkNames({ taskOrderId: orderId }).then(res => {
      const names: string[] = Array.isArray(res.data) ? res.data : [];
      setPkNames(names);
      if (names.length > 0) setPkName(names[names.length - 1]);
    }).catch(() => {});
  }, [orderId]);

  // 多选模式下各维度取值（兼容单选字符串场景）
  const dimArr = (v: string | string[] | undefined): string[] =>
    Array.isArray(v) ? v : (v && v !== '' ? [v] : []);

  const loadTable = async () => {
    if (orderId === '') { alert('请先选择 PK任务单'); return; }
    if (!pkName) { alert('该任务单下暂无店铺目标，请先在「PK店铺目标」录入'); return; }
    setLoading(true);
    setError('');
    try {
const res = await getPkDataTable({
        taskOrderId: orderId,
        pkName,
        startDate: dateFrom || undefined,
        endDate: dateTo || undefined,
        filter: scopeFilter || undefined,
        warehouse: dimArr(dimFilter.warehouse).join(',') || undefined,
        supervisor: dimArr(dimFilter.supervisor).join(',') || undefined,
        districtManager: dimArr(dimFilter.districtManager).join(',') || undefined,
        dealer: dimArr(dimFilter.dealer).join(',') || undefined,
        shopName: dimArr(dimFilter.shopName).join(',') || undefined,
        monthComparable: dimArr(dimFilter.monthComparables).join(',') || undefined,
        yearComparable: dimArr(dimFilter.yearComparables).join(',') || undefined,
        announced: announced || undefined,
      });
      setTable(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || '数据表加载失败');
      setTable(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoLoadedRef.current) return;
    if (orderId === '') return;
    if (pkName === '') return;
    autoLoadedRef.current = true;
    loadTable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, pkName]);

// 范围筛选 / 五维筛选 / 时间段筛选变化：重新从服务端拉取过滤后的数据表（首次自动加载由上方 effect 负责）
  const dimFilterKey = JSON.stringify(dimFilter);
  useEffect(() => {
    if (orderId === '') return;
    if (pkName === '') return;
    if (!autoLoadedRef.current) return;
    loadTable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeFilter, dimFilterKey, announced, dateFrom, dateTo]);

  // 快速搜索：本地即时过滤四个区域。命中 仓库类别 → 第一区整行保留；
  // 命中 区经/督导/仓库类别 → 第二区对应行保留；命中 商品/仓库类别 → 第三区行保留；
  // 命中 经销商/督导/仓库类别 → 第四区行保留；命中 仓库类别/区经/督导/店铺名称 → 第五区店铺行保留
  const filtered = useMemo(() => {
    if (!table) return null;
    const q = quickSearch.trim().toLowerCase();
    if (!q) return table;
    const zone1 = (table.zone1 || []).filter(r => String(r.warehouseType || '').toLowerCase().includes(q));
    const zone2 = (table.zone2 || []).filter(r =>
      String(r.warehouseType || '').toLowerCase().includes(q) ||
      String(r.districtManager || '').toLowerCase().includes(q) ||
      String(r.supervisor || '').toLowerCase().includes(q));
    const zone3 = (table.zone3 || []).filter(r =>
      String(r.warehouseType || '').toLowerCase().includes(q) ||
      String(r.product || '').toLowerCase().includes(q));
    const zone4 = (table.zone4 || []).filter(r =>
      String(r.warehouseType || '').toLowerCase().includes(q) ||
      String(r.supervisor || '').toLowerCase().includes(q) ||
      String(r.dealer || '').toLowerCase().includes(q));
    const zone5 = (table.zone5 || []).filter(r =>
      String(r.warehouseType || '').toLowerCase().includes(q) ||
      String(r.districtManager || '').toLowerCase().includes(q) ||
      String(r.supervisor || '').toLowerCase().includes(q) ||
      String(r.shopName || '').toLowerCase().includes(q));
    return { ...table, zone1, zone2, zone3, zone4, zone5 };
  }, [table, quickSearch]);

  // 每个分区独立应用排序（搜索过滤后的行）
  const display = useMemo(() => {
    if (!filtered) return null;
    return {
      ...filtered,
      zone1: sortRows(filtered.zone1 || [], sort.z1, NUMERIC_KEYS),
      zone2: sortRows(filtered.zone2 || [], sort.z2, NUMERIC_KEYS),
      zone3: sortRows(filtered.zone3 || [], sort.z3, NUMERIC_KEYS),
      zone4: sortRows(filtered.zone4 || [], sort.z4, NUMERIC_KEYS),
      zone5: sortRows(filtered.zone5 || [], sort.z5, NUMERIC_KEYS),
    };
  }, [filtered, sort]);

  const zone1 = display?.zone1 ?? [];
  const zone2 = display?.zone2 ?? [];
  const zone3 = display?.zone3 ?? [];
  const zone4 = display?.zone4 ?? [];
  const zone5 = display?.zone5 ?? [];
  const noMatchBySearch = !!table && !!quickSearch.trim() && zone1.length === 0 && zone2.length === 0 && zone3.length === 0 && zone4.length === 0 && zone5.length === 0;
  const hasAny = zone1.length > 0 || zone2.length > 0 || zone3.length > 0 || zone4.length > 0 || zone5.length > 0;

  const timeProgress = table ? calcTimeProgress(table.pkStartDate, table.pkEndDate) : null;

  /** 导出当前数据表为 xlsx（数据已按用户权限过滤，导出范围 = 当前PK全部数据） */
  const handleExport = () => {
    if (!table) return;
    const wb = XLSX.utils.book_new();
    const orderName = currentOrder?.orderName || '';
    const z1 = table.zone1 || [];
    const z2 = table.zone2 || [];
    const z3 = table.zone3 || [];
    const z4 = table.zone4 || [];
    const z5 = table.zone5 || [];
    // 概要 sheet
    const wsSummary = XLSX.utils.aoa_to_sheet([
      ['PK数据表导出'],
      ['任务单', orderName],
      ['PK名称', table.pkName],
['PK开始时间', table.pkStartDate || '—'],
      ['PK结束时间', table.pkEndDate || '—'],
      ['业绩起始', table.startDate || '—'],
      ['业绩统计至', table.endDate],
      ['参与店铺数', table.storeCount],
      ['数据模式', table.isMock ? '模拟数据（PK尚未开始）' : '真实业绩'],
      ['时间进度', timeProgress ? `${timeProgress.percent.toFixed(1)}%（${timeProgress.elapsedDays}/${timeProgress.totalDays}天）` : '—'],
      ['导出时间', new Date().toLocaleString('zh-CN')],
    ]);
    XLSX.utils.book_append_sheet(wb, wsSummary, '概要');
    // 第一区 直营/加盟
    const ws1 = XLSX.utils.aoa_to_sheet([
      ['仓库类别', '目标', '英雄标', '业绩金额', '达成率', '英雄达成率', '店铺数'],
      ...z1.map(r => [r.warehouseType, r.target, r.heroMark ?? 0, r.actual, r.rate, r.heroAchieveRate ?? '', r.shops]),
      ['合计', sumOf(z1, r => r.target), sumOf(z1, r => r.heroMark ?? 0), sumOf(z1, r => r.actual),
        sumOf(z1, r => r.target) > 0 ? sumOf(z1, r => r.actual) / sumOf(z1, r => r.target) : 0,
        sumOf(z1, r => r.heroMark ?? 0) > 0 ? sumOf(z1, r => r.actual) / sumOf(z1, r => r.heroMark ?? 0) : '',
        sumOf(z1, r => r.shops)],
    ]);
    XLSX.utils.book_append_sheet(wb, ws1, '第一区-直营加盟');
    // 第二区 督导
    const ws2 = XLSX.utils.aoa_to_sheet([
      ['仓库类别', '区经', '督导', '目标', '英雄标', '业绩金额', '达成率', '英雄达成率', '店铺数'],
      ...z2.map(r => [r.warehouseType, r.districtManager, r.supervisor, r.target, r.heroMark ?? 0, r.actual, r.rate, r.heroAchieveRate ?? '', r.shops]),
      ['合计', '', '', sumOf(z2, r => r.target), sumOf(z2, r => r.heroMark ?? 0), sumOf(z2, r => r.actual),
        sumOf(z2, r => r.target) > 0 ? sumOf(z2, r => r.actual) / sumOf(z2, r => r.target) : 0,
        sumOf(z2, r => r.heroMark ?? 0) > 0 ? sumOf(z2, r => r.actual) / sumOf(z2, r => r.heroMark ?? 0) : '',
        sumOf(z2, r => r.shops)],
    ]);
    XLSX.utils.book_append_sheet(wb, ws2, '第二区-督导');
    // 第三区 商品
    const ws3 = XLSX.utils.aoa_to_sheet([
      ['仓库类别', '商品', '目标', '英雄标', '业绩金额', '达成率', '英雄达成率', '店铺数'],
      ...z3.map(r => [r.warehouseType, r.product, r.target, r.heroMark ?? 0, r.actual, r.rate, r.heroAchieveRate ?? '', r.shops]),
      ['合计', '', sumOf(z3, r => r.target), sumOf(z3, r => r.heroMark ?? 0), sumOf(z3, r => r.actual),
        sumOf(z3, r => r.target) > 0 ? sumOf(z3, r => r.actual) / sumOf(z3, r => r.target) : 0,
        sumOf(z3, r => r.heroMark ?? 0) > 0 ? sumOf(z3, r => r.actual) / sumOf(z3, r => r.heroMark ?? 0) : '',
        sumOf(z3, r => r.shops)],
    ]);
    XLSX.utils.book_append_sheet(wb, ws3, '第三区-商品');
    // 第四区 经销商
    const ws4 = XLSX.utils.aoa_to_sheet([
      ['仓库类别', '督导', '经销商', '目标', '英雄标', '业绩金额', '达成率', '英雄达成率', '店铺数'],
      ...z4.map(r => [r.warehouseType, r.supervisor, r.dealer, r.target, r.heroMark ?? 0, r.actual, r.rate, r.heroAchieveRate ?? '', r.shops]),
      ['合计', '', '', sumOf(z4, r => r.target), sumOf(z4, r => r.heroMark ?? 0), sumOf(z4, r => r.actual),
        sumOf(z4, r => r.target) > 0 ? sumOf(z4, r => r.actual) / sumOf(z4, r => r.target) : 0,
        sumOf(z4, r => r.heroMark ?? 0) > 0 ? sumOf(z4, r => r.actual) / sumOf(z4, r => r.heroMark ?? 0) : '',
        sumOf(z4, r => r.shops)],
    ]);
    XLSX.utils.book_append_sheet(wb, ws4, '第四区-经销商');
    // 第五区 门店
    const heroSum = sumOf(z5, r => r.heroMark ?? 0);
    const ws5 = XLSX.utils.aoa_to_sheet([
      ['仓库类别', '区经', '督导', '店铺名称', '目标', '英雄标', '业绩金额', '达成率', '英雄达成率'],
      ...z5.map(r => [r.warehouseType, r.districtManager, r.supervisor, r.shopName, r.target, r.heroMark ?? 0, r.actual, r.rate, r.heroAchieveRate ?? '']),
      ['合计', '', '', `（${z5.length}店）`, sumOf(z5, r => r.target), heroSum, sumOf(z5, r => r.actual),
        sumOf(z5, r => r.target) > 0 ? sumOf(z5, r => r.actual) / sumOf(z5, r => r.target) : 0,
        heroSum > 0 ? sumOf(z5, r => r.actual) / heroSum : ''],
    ]);
    XLSX.utils.book_append_sheet(wb, ws5, '第五区-门店');
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `PK数据表_${orderName}_${table.endDate || dateStr}.xlsx`);
  };

  const thSort = (zone: 'z1' | 'z2' | 'z3' | 'z4' | 'z5', key: string, numeric = false) => () =>
    setSort(prev => ({ ...prev, [zone]: nextSort(prev[zone], key, numeric) }));

  const thCls = 'px-3 py-2.5 text-left text-sm font-bold text-gray-900 whitespace-nowrap cursor-pointer select-none hover:bg-gray-100';
  const tdCls = 'px-3 py-2.5 text-sm text-gray-800';
  const numTd = 'px-3 py-2.5 text-sm text-right tabular-nums text-gray-800';
  const numTh = 'px-3 py-2.5 text-right text-sm font-bold text-gray-900 whitespace-nowrap cursor-pointer select-none hover:bg-gray-100';

  /** 维度列固定宽（与 PK日目标跟进 一致）：锁定列必须固定列宽 */
  const LEAD_W = { warehouse: 110, districtManager: 120, supervisor: 120, product: 160, dealer: 160, shopName: 190 } as const;
  /** 生成维度列的累计左偏移与总宽 */
  const leadSeq = (...ws: number[]) => {
    const lefts: number[] = [];
    let acc = 0;
    for (const w of ws) { lefts.push(acc); acc += w; }
    return { lefts, total: acc };
  };
  const z1Lead = leadSeq(LEAD_W.warehouse);
  const z2Lead = leadSeq(LEAD_W.warehouse, LEAD_W.districtManager, LEAD_W.supervisor);
  const z3Lead = leadSeq(LEAD_W.warehouse, LEAD_W.product);
  const z4Lead = leadSeq(LEAD_W.warehouse, LEAD_W.supervisor, LEAD_W.dealer);
  const z5Lead = leadSeq(LEAD_W.warehouse, LEAD_W.districtManager, LEAD_W.supervisor, LEAD_W.shopName);
  const stickyThS = (left: number, w: number) => ({ position: 'sticky' as const, left, zIndex: 20, minWidth: w, width: w, background: '#f9fafb', boxShadow: '2px 0 4px rgba(0,0,0,0.08)' });
  const stickyTdS = (left: number, w: number) => ({ position: 'sticky' as const, left, zIndex: 2, minWidth: w, width: w, background: '#ffffff', boxShadow: '2px 0 4px rgba(0,0,0,0.08)' });
  const stickyTotalS = (total: number) => ({ position: 'sticky' as const, left: 0, zIndex: 2, minWidth: total, width: total, background: '#f9fafb' });
  const dimTdCls = `${tdCls} bg-white group-hover:bg-gray-50`;

  /** 门框卡片：白底黑框 + 金色外环（与 PK 报表风格一致） */
  const sectionCard = 'rounded-2xl bg-white border-2 border-black ring-2 ring-[#D4AF37] shadow-sm overflow-hidden';
  const sectionTitle = 'px-4 py-3 bg-white border-b-2 border-black flex items-center gap-2 text-base font-black text-gray-900';

  return (
    <Layout title="PK数据表" subtitle="按 直营/加盟 → 督导 → 商品 → 经销商 → 门店 五级展示 PK 业绩达成：目标 / 英雄标 / 业绩金额 / 达成率 / 英雄达成率">
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
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">PK名称</span>
            <select value={pkName} onChange={e => setPkName(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 min-w-40">
              {pkNames.length === 0 && <option value="">该任务单暂无PK</option>}
              {pkNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <PkScopeFilterBar meta={scopeMeta} filter={scopeFilter} onChange={setScopeFilter} disabled={loading || orderId === '' || table == null} dims={{ value: dimFilter, onChange: setDimFilter }} multiSelect hideScope />
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 flex items-center gap-1"><TrendingUp size={14} /> 是否参与英雄招募</span>
            <select
              value={announced}
              onChange={e => setAnnounced(e.target.value)}
              disabled={loading || orderId === '' || table == null}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
<option value="">全部</option>
              <option value="yes">参与</option>
              <option value="no">不参与</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            {(['month', 'year'] as const).map(k => {
              const sel = dimFilter[k === 'month' ? 'monthComparables' : 'yearComparables'] || [];
              return (
                <button
                  key={k}
                  onClick={() => { setCompDraft(sel); setCompPicker(k); }}
                  disabled={loading || orderId === '' || table == null}
                  className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 border disabled:opacity-40 ${sel.length > 0 ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  title={k === 'month' ? '月可比性筛选（多选）' : '年可比性筛选（多选）'}
                >
                  <Filter size={13} />
                  {k === 'month' ? '月可比' : '年可比'}
                  {sel.length > 0 && <span className="text-xs bg-indigo-100 rounded-full px-1.5">{sel.join('/')}</span>}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 flex items-center gap-1"><CalendarDays size={14} /> 业绩时间段</span>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              disabled={loading || orderId === '' || table == null}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <span className="text-gray-400 text-sm">至</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              disabled={loading || orderId === '' || table == null}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg flex items-center gap-1"
                title="清除时间段，恢复自动统计口径"
              >
                <X size={12} /> 清除
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 flex items-center gap-1"><CalendarDays size={14} /> 业绩统计至</span>
            <span className={`px-3 py-1.5 text-sm font-bold rounded-lg border min-w-32 text-center ${
              table ? (table.isMock ? 'bg-red-50 text-red-600 border-red-300' : 'bg-emerald-50 text-emerald-700 border-emerald-300') : 'bg-gray-50 text-gray-400 border-gray-200'
            }`}>
              {table ? table.endDate : '按任务单自动计算'}
            </span>
            {table && (table.isMock ? (
              <span className="px-2 py-1 rounded-md text-xs font-bold bg-red-100 text-red-600 border border-red-300 flex items-center gap-1">
                <TrendingUp size={11} /> 模拟数据
              </span>
            ) : (
              <span className="px-2 py-1 rounded-md text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-300 flex items-center gap-1">
                <TrendingUp size={11} /> 真实业绩
              </span>
            ))}
          </div>
          {timeProgress && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 flex items-center gap-1"><Clock size={14} /> 时间进度</span>
              <div className="flex items-center gap-2">
                <div className="w-32 h-6 bg-gray-200 rounded-full overflow-hidden border border-gray-300 relative">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${timeProgress.percent >= 100 ? 'bg-red-500' : timeProgress.percent >= 75 ? 'bg-orange-500' : 'bg-blue-500'}`}
                    style={{ width: `${Math.max(2, timeProgress.percent)}%` }}
                  />
                </div>
                <span className={`text-sm font-bold ${timeProgress.percent >= 100 ? 'text-red-600' : 'text-gray-700'}`}>
                  {timeProgress.percent.toFixed(1)}%
                </span>
                <span className="text-xs text-gray-400">({timeProgress.elapsedDays}/{timeProgress.totalDays}天)</span>
              </div>
            </div>
          )}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={quickSearch}
              onChange={e => setQuickSearch(e.target.value)}
              placeholder="快速搜索：仓库类别/区经/督导/经销商/店铺"
              className="pl-8 pr-7 py-1.5 border border-gray-200 rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            {quickSearch && (
              <button onClick={() => setQuickSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" title="清除搜索">
                <X size={14} />
              </button>
            )}
          </div>
          <button onClick={loadTable} disabled={loading || orderId === ''} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-blue-700 disabled:opacity-40">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 生成数据表
          </button>
          {table && (
            <button
              onClick={handleExport}
              className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-green-700"
            >
              <Download size={14} /> 导出Excel
            </button>
          )}
          {table && (
            <span className="text-xs text-gray-400 ml-auto flex items-center gap-1">
              <Store size={13} /> {table.storeCount} 家店铺参与 · 业绩区间 {table.startDate || '—'} ~ {table.endDate}
            </span>
          )}
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

        {table && table.isMock && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-300 px-4 py-3 flex items-start gap-3">
            <div className="mt-0.5 text-red-500 text-sm">🎯</div>
            <div className="text-sm text-red-600">
              <span className="font-bold text-red-600">PK 尚未开始 · 模拟数据预览</span>
              <span className="ml-2 text-red-500">
                {table.pkStartDate ? `开始时间 ${table.pkStartDate}` : ''}
                {table.pkEndDate ? ` · 结束时间 ${table.pkEndDate}` : ''} · 业绩统计至 {table.endDate}
              </span>
              <div className="text-xs text-red-500 mt-1">
                PK 未开始时默认统计昨日数据并展示模拟业绩；PK 开始后将自动每天统计真实业绩（业绩统计至当日，{table.statusText || ''}）。
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 text-sm">{error}</div>
        )}

        {!table && !error && (
          <div className="bg-white rounded-3xl p-16 text-center border-2 border-black ring-2 ring-[#D4AF37]">
            <div className="text-6xl mb-4">📊</div>
            <div className="text-gray-900 text-lg font-bold mb-2">PK 数据表</div>
            <div className="text-gray-500 text-sm">选择 PK任务单与 PK名称并点击「生成数据表」，按 直营/加盟 → 督导 → 商品 → 经销商 → 门店 展示目标与业绩达成</div>
          </div>
        )}

        {table && (
          <div className="space-y-5">
            {noMatchBySearch && (
              <div className="rounded-2xl bg-white border-2 border-black ring-2 ring-[#D4AF37] p-10 text-center text-gray-600 text-sm">
                没有匹配「{quickSearch.trim()}」的仓库类别、区经、督导、商品、经销商或店铺，换个关键词试试
              </div>
            )}
            {!noMatchBySearch && !hasAny && (
              <div className="rounded-2xl bg-white border-2 border-black ring-2 ring-[#D4AF37] p-10 text-center text-gray-600 text-sm">
                {table.scoped
                  ? '当前账号与本次 PK 无相关店铺（未参与该 PK），暂无数据展示'
                  : '该任务单暂无店铺目标，请先在「PK店铺目标」录入'}
              </div>
            )}

            {/* 第一区 直营/加盟 业绩达成 */}
            {zone1.length > 0 && (
              <section className={sectionCard}>
                <div className={sectionTitle}>
                  <Warehouse size={16} className="text-gray-900" /> 第一区 · 直营/加盟 业绩达成
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse" style={{ minWidth: z1Lead.total + 640 }}>
                    <thead>
                      <tr className="bg-gray-50 border-b-2 border-black">
                        <th className={thCls} onClick={thSort('z1', 'warehouseType')} title="点击排序" style={stickyThS(z1Lead.lefts[0], LEAD_W.warehouse)}>
                          仓库类别 <SortIcon sort={sort.z1} colKey="warehouseType" />
                        </th>
                        <th className={numTh} onClick={thSort('z1', 'target', true)} title="点击排序">
                          目标 <SortIcon sort={sort.z1} colKey="target" />
                        </th>
                        <th className={numTh} onClick={thSort('z1', 'heroMark', true)} title="点击排序">
                          英雄标 <SortIcon sort={sort.z1} colKey="heroMark" />
                        </th>
                        <th className={numTh} onClick={thSort('z1', 'actual', true)} title="点击排序">
                          业绩金额 <SortIcon sort={sort.z1} colKey="actual" />
                        </th>
                        <th className={numTh} onClick={thSort('z1', 'rate', true)} title="点击排序">
                          达成率 <SortIcon sort={sort.z1} colKey="rate" />
                        </th>
                        <th className={numTh} onClick={thSort('z1', 'heroAchieveRate', true)} title="点击排序">
                          英雄达成率 <SortIcon sort={sort.z1} colKey="heroAchieveRate" />
                        </th>
                        <th className={numTh} onClick={thSort('z1', 'shops', true)} title="点击排序">
                          店铺数 <SortIcon sort={sort.z1} colKey="shops" />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {zone1.map(r => (
                        <tr key={r.warehouseType} className="border-b border-gray-100 hover:bg-gray-50 group">
                          <td className={dimTdCls} style={stickyTdS(z1Lead.lefts[0], LEAD_W.warehouse)}>
                            <span className="inline-block px-2.5 py-0.5 rounded-full bg-white border border-black ring-1 ring-[#D4AF37] text-xs font-bold">
                              {r.warehouseType}
                            </span>
                          </td>
                          <td className={numTd}>{fmtMoney(r.target)}</td>
                          <td className={numTd}>{fmtMoney(r.heroMark ?? 0)}</td>
                          <td className={numTd}>{fmtMoney(r.actual)}</td>
                          <td className={`${numTd} ${rateClass(r.rate)}`}>{fmtRate(r.rate)}</td>
                          <td className={`${numTd} ${r.heroAchieveRate == null ? 'text-gray-400' : rateClass(r.heroAchieveRate)}`}>
                            {r.heroAchieveRate == null ? '—' : fmtRate(r.heroAchieveRate)}
                          </td>
                          <td className={numTd}>{r.shops}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 font-bold">
                        <td className={`${tdCls} font-black`} style={stickyTotalS(z1Lead.total)}>合计</td>
                        <td className={`${numTd} font-black`}>{fmtMoney(sumOf(zone1, r => r.target))}</td>
                        <td className={`${numTd} font-black`}>{fmtMoney(sumOf(zone1, r => r.heroMark ?? 0))}</td>
                        <td className={`${numTd} font-black`}>{fmtMoney(sumOf(zone1, r => r.actual))}</td>
                        <td className={`${numTd} font-black`}>{fmtRate(sumOf(zone1, r => r.target) > 0 ? sumOf(zone1, r => r.actual) / sumOf(zone1, r => r.target) : 0)}</td>
                        <td className={`${numTd} font-black`}>
                          {sumOf(zone1, r => r.heroMark ?? 0) > 0
                            ? fmtRate(sumOf(zone1, r => r.actual) / sumOf(zone1, r => r.heroMark ?? 0))
                            : '—'}
                        </td>
                        <td className={`${numTd} font-black`}>{sumOf(zone1, r => r.shops)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* 第二区 督导 业绩达成 */}
            {zone2.length > 0 && (
              <section className={sectionCard}>
                <div className={sectionTitle}>
                  <UserCog size={16} className="text-gray-900" /> 第二区 · 督导 业绩达成
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse" style={{ minWidth: z2Lead.total + 640 }}>
                    <thead>
                      <tr className="bg-gray-50 border-b-2 border-black">
                        <th className={thCls} onClick={thSort('z2', 'warehouseType')} title="点击排序" style={stickyThS(z2Lead.lefts[0], LEAD_W.warehouse)}>
                          仓库类别 <SortIcon sort={sort.z2} colKey="warehouseType" />
                        </th>
                        <th className={thCls} onClick={thSort('z2', 'districtManager')} title="点击排序" style={stickyThS(z2Lead.lefts[1], LEAD_W.districtManager)}>
                          区经 <SortIcon sort={sort.z2} colKey="districtManager" />
                        </th>
                        <th className={thCls} onClick={thSort('z2', 'supervisor')} title="点击排序" style={stickyThS(z2Lead.lefts[2], LEAD_W.supervisor)}>
                          督导 <SortIcon sort={sort.z2} colKey="supervisor" />
                        </th>
                        <th className={numTh} onClick={thSort('z2', 'target', true)} title="点击排序">
                          目标 <SortIcon sort={sort.z2} colKey="target" />
                        </th>
                        <th className={numTh} onClick={thSort('z2', 'heroMark', true)} title="点击排序">
                          英雄标 <SortIcon sort={sort.z2} colKey="heroMark" />
                        </th>
                        <th className={numTh} onClick={thSort('z2', 'actual', true)} title="点击排序">
                          业绩金额 <SortIcon sort={sort.z2} colKey="actual" />
                        </th>
                        <th className={numTh} onClick={thSort('z2', 'rate', true)} title="点击排序">
                          达成率 <SortIcon sort={sort.z2} colKey="rate" />
                        </th>
                        <th className={numTh} onClick={thSort('z2', 'heroAchieveRate', true)} title="点击排序">
                          英雄达成率 <SortIcon sort={sort.z2} colKey="heroAchieveRate" />
                        </th>
                        <th className={numTh} onClick={thSort('z2', 'shops', true)} title="点击排序">
                          店铺数 <SortIcon sort={sort.z2} colKey="shops" />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {zone2.map(r => (
                        <tr key={`${r.warehouseType}||${r.districtManager}||${r.supervisor}`} className="border-b border-gray-100 hover:bg-gray-50 group">
                          <td className={dimTdCls} style={stickyTdS(z2Lead.lefts[0], LEAD_W.warehouse)}>
                            <span className="inline-block px-2.5 py-0.5 rounded-full bg-white border border-black ring-1 ring-[#D4AF37] text-xs font-bold">
                              {r.warehouseType || '—'}
                            </span>
                          </td>
                          <td className={dimTdCls} style={stickyTdS(z2Lead.lefts[1], LEAD_W.districtManager)}>{r.districtManager || '—'}</td>
                          <td className={dimTdCls} style={stickyTdS(z2Lead.lefts[2], LEAD_W.supervisor)}>{r.supervisor || '—'}</td>
                          <td className={numTd}>{fmtMoney(r.target)}</td>
                          <td className={numTd}>{fmtMoney(r.heroMark ?? 0)}</td>
                          <td className={numTd}>{fmtMoney(r.actual)}</td>
                          <td className={`${numTd} ${rateClass(r.rate)}`}>{fmtRate(r.rate)}</td>
                          <td className={`${numTd} ${r.heroAchieveRate == null ? 'text-gray-400' : rateClass(r.heroAchieveRate)}`}>
                            {r.heroAchieveRate == null ? '—' : fmtRate(r.heroAchieveRate)}
                          </td>
                          <td className={numTd}>{r.shops}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 font-bold">
                        <td className={`${tdCls} font-black`} colSpan={3} style={stickyTotalS(z2Lead.total)}>合计</td>
                        <td className={`${numTd} font-black`}>{fmtMoney(sumOf(zone2, r => r.target))}</td>
                        <td className={`${numTd} font-black`}>{fmtMoney(sumOf(zone2, r => r.heroMark ?? 0))}</td>
                        <td className={`${numTd} font-black`}>{fmtMoney(sumOf(zone2, r => r.actual))}</td>
                        <td className={`${numTd} font-black`}>{fmtRate(sumOf(zone2, r => r.target) > 0 ? sumOf(zone2, r => r.actual) / sumOf(zone2, r => r.target) : 0)}</td>
                        <td className={`${numTd} font-black`}>
                          {sumOf(zone2, r => r.heroMark ?? 0) > 0
                            ? fmtRate(sumOf(zone2, r => r.actual) / sumOf(zone2, r => r.heroMark ?? 0))
                            : '—'}
                        </td>
                        <td className={`${numTd} font-black`}>{sumOf(zone2, r => r.shops)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* 第三区 商品 业绩达成 */}
            {zone3.length > 0 && (
              <section className={sectionCard}>
                <div className={sectionTitle}>
                  <Package size={16} className="text-gray-900" /> 第三区 · 商品 业绩达成
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse" style={{ minWidth: z3Lead.total + 640 }}>
                    <thead>
                      <tr className="bg-gray-50 border-b-2 border-black">
                        <th className={thCls} onClick={thSort('z3', 'warehouseType')} title="点击排序" style={stickyThS(z3Lead.lefts[0], LEAD_W.warehouse)}>
                          仓库类别 <SortIcon sort={sort.z3} colKey="warehouseType" />
                        </th>
                        <th className={thCls} onClick={thSort('z3', 'product')} title="点击排序" style={stickyThS(z3Lead.lefts[1], LEAD_W.product)}>
                          商品 <SortIcon sort={sort.z3} colKey="product" />
                        </th>
                        <th className={numTh} onClick={thSort('z3', 'target', true)} title="点击排序">
                          目标 <SortIcon sort={sort.z3} colKey="target" />
                        </th>
                        <th className={numTh} onClick={thSort('z3', 'heroMark', true)} title="点击排序">
                          英雄标 <SortIcon sort={sort.z3} colKey="heroMark" />
                        </th>
                        <th className={numTh} onClick={thSort('z3', 'actual', true)} title="点击排序">
                          业绩金额 <SortIcon sort={sort.z3} colKey="actual" />
                        </th>
                        <th className={numTh} onClick={thSort('z3', 'rate', true)} title="点击排序">
                          达成率 <SortIcon sort={sort.z3} colKey="rate" />
                        </th>
                        <th className={numTh} onClick={thSort('z3', 'heroAchieveRate', true)} title="点击排序">
                          英雄达成率 <SortIcon sort={sort.z3} colKey="heroAchieveRate" />
                        </th>
                        <th className={numTh} onClick={thSort('z3', 'shops', true)} title="点击排序">
                          店铺数 <SortIcon sort={sort.z3} colKey="shops" />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {zone3.map(r => (
                        <tr key={`${r.warehouseType}||${r.product}`} className="border-b border-gray-100 hover:bg-gray-50 group">
                          <td className={dimTdCls} style={stickyTdS(z3Lead.lefts[0], LEAD_W.warehouse)}>
                            <span className="inline-block px-2.5 py-0.5 rounded-full bg-white border border-black ring-1 ring-[#D4AF37] text-xs font-bold">
                              {r.warehouseType || '—'}
                            </span>
                          </td>
                          <td className={dimTdCls} style={stickyTdS(z3Lead.lefts[1], LEAD_W.product)}>{r.product || '—'}</td>
                          <td className={numTd}>{fmtMoney(r.target)}</td>
                          <td className={numTd}>{fmtMoney(r.heroMark ?? 0)}</td>
                          <td className={numTd}>{fmtMoney(r.actual)}</td>
                          <td className={`${numTd} ${rateClass(r.rate)}`}>{fmtRate(r.rate)}</td>
                          <td className={`${numTd} ${r.heroAchieveRate == null ? 'text-gray-400' : rateClass(r.heroAchieveRate)}`}>
                            {r.heroAchieveRate == null ? '—' : fmtRate(r.heroAchieveRate)}
                          </td>
                          <td className={numTd}>{r.shops}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 font-bold">
                        <td className={`${tdCls} font-black`} colSpan={2} style={stickyTotalS(z3Lead.total)}>合计</td>
                        <td className={`${numTd} font-black`}>{fmtMoney(sumOf(zone3, r => r.target))}</td>
                        <td className={`${numTd} font-black`}>{fmtMoney(sumOf(zone3, r => r.heroMark ?? 0))}</td>
                        <td className={`${numTd} font-black`}>{fmtMoney(sumOf(zone3, r => r.actual))}</td>
                        <td className={`${numTd} font-black`}>{fmtRate(sumOf(zone3, r => r.target) > 0 ? sumOf(zone3, r => r.actual) / sumOf(zone3, r => r.target) : 0)}</td>
                        <td className={`${numTd} font-black`}>
                          {sumOf(zone3, r => r.heroMark ?? 0) > 0
                            ? fmtRate(sumOf(zone3, r => r.actual) / sumOf(zone3, r => r.heroMark ?? 0))
                            : '—'}
                        </td>
                        <td className={`${numTd} font-black`}>{sumOf(zone3, r => r.shops)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* 第四区 经销商 业绩达成 */}
            {zone4.length > 0 && (
              <section className={sectionCard}>
                <div className={sectionTitle}>
                  <Users size={16} className="text-gray-900" /> 第四区 · 经销商 业绩达成
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse" style={{ minWidth: z4Lead.total + 640 }}>
                    <thead>
                      <tr className="bg-gray-50 border-b-2 border-black">
                        <th className={thCls} onClick={thSort('z4', 'warehouseType')} title="点击排序" style={stickyThS(z4Lead.lefts[0], LEAD_W.warehouse)}>
                          仓库类别 <SortIcon sort={sort.z4} colKey="warehouseType" />
                        </th>
                        <th className={thCls} onClick={thSort('z4', 'supervisor')} title="点击排序" style={stickyThS(z4Lead.lefts[1], LEAD_W.supervisor)}>
                          督导 <SortIcon sort={sort.z4} colKey="supervisor" />
                        </th>
                        <th className={thCls} onClick={thSort('z4', 'dealer')} title="点击排序" style={stickyThS(z4Lead.lefts[2], LEAD_W.dealer)}>
                          经销商 <SortIcon sort={sort.z4} colKey="dealer" />
                        </th>
                        <th className={numTh} onClick={thSort('z4', 'target', true)} title="点击排序">
                          目标 <SortIcon sort={sort.z4} colKey="target" />
                        </th>
                        <th className={numTh} onClick={thSort('z4', 'heroMark', true)} title="点击排序">
                          英雄标 <SortIcon sort={sort.z4} colKey="heroMark" />
                        </th>
                        <th className={numTh} onClick={thSort('z4', 'actual', true)} title="点击排序">
                          业绩金额 <SortIcon sort={sort.z4} colKey="actual" />
                        </th>
                        <th className={numTh} onClick={thSort('z4', 'rate', true)} title="点击排序">
                          达成率 <SortIcon sort={sort.z4} colKey="rate" />
                        </th>
                        <th className={numTh} onClick={thSort('z4', 'heroAchieveRate', true)} title="点击排序">
                          英雄达成率 <SortIcon sort={sort.z4} colKey="heroAchieveRate" />
                        </th>
                        <th className={numTh} onClick={thSort('z4', 'shops', true)} title="点击排序">
                          店铺数 <SortIcon sort={sort.z4} colKey="shops" />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {zone4.map(r => (
                        <tr key={`${r.warehouseType}||${r.supervisor}||${r.dealer}`} className="border-b border-gray-100 hover:bg-gray-50 group">
                          <td className={dimTdCls} style={stickyTdS(z4Lead.lefts[0], LEAD_W.warehouse)}>
                            <span className="inline-block px-2.5 py-0.5 rounded-full bg-white border border-black ring-1 ring-[#D4AF37] text-xs font-bold">
                              {r.warehouseType || '—'}
                            </span>
                          </td>
                          <td className={dimTdCls} style={stickyTdS(z4Lead.lefts[1], LEAD_W.supervisor)}>{r.supervisor || '—'}</td>
                          <td className={dimTdCls} style={stickyTdS(z4Lead.lefts[2], LEAD_W.dealer)}>{r.dealer || '—'}</td>
                          <td className={numTd}>{fmtMoney(r.target)}</td>
                          <td className={numTd}>{fmtMoney(r.heroMark ?? 0)}</td>
                          <td className={numTd}>{fmtMoney(r.actual)}</td>
                          <td className={`${numTd} ${rateClass(r.rate)}`}>{fmtRate(r.rate)}</td>
                          <td className={`${numTd} ${r.heroAchieveRate == null ? 'text-gray-400' : rateClass(r.heroAchieveRate)}`}>
                            {r.heroAchieveRate == null ? '—' : fmtRate(r.heroAchieveRate)}
                          </td>
                          <td className={numTd}>{r.shops}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 font-bold">
                        <td className={`${tdCls} font-black`} colSpan={3} style={stickyTotalS(z4Lead.total)}>合计</td>
                        <td className={`${numTd} font-black`}>{fmtMoney(sumOf(zone4, r => r.target))}</td>
                        <td className={`${numTd} font-black`}>{fmtMoney(sumOf(zone4, r => r.heroMark ?? 0))}</td>
                        <td className={`${numTd} font-black`}>{fmtMoney(sumOf(zone4, r => r.actual))}</td>
                        <td className={`${numTd} font-black`}>{fmtRate(sumOf(zone4, r => r.target) > 0 ? sumOf(zone4, r => r.actual) / sumOf(zone4, r => r.target) : 0)}</td>
                        <td className={`${numTd} font-black`}>
                          {sumOf(zone4, r => r.heroMark ?? 0) > 0
                            ? fmtRate(sumOf(zone4, r => r.actual) / sumOf(zone4, r => r.heroMark ?? 0))
                            : '—'}
                        </td>
                        <td className={`${numTd} font-black`}>{sumOf(zone4, r => r.shops)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* 第五区 门店 业绩达成 */}
            {zone5.length > 0 && (
              <section className={sectionCard}>
                <div className={sectionTitle}>
                  <MapPin size={16} className="text-gray-900" /> 第五区 · 门店 业绩达成
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse" style={{ minWidth: z5Lead.total + 640 }}>
                    <thead>
                      <tr className="bg-gray-50 border-b-2 border-black">
                        <th className={thCls} onClick={thSort('z5', 'warehouseType')} title="点击排序" style={stickyThS(z5Lead.lefts[0], LEAD_W.warehouse)}>
                          仓库类别 <SortIcon sort={sort.z5} colKey="warehouseType" />
                        </th>
                        <th className={thCls} onClick={thSort('z5', 'districtManager')} title="点击排序" style={stickyThS(z5Lead.lefts[1], LEAD_W.districtManager)}>
                          区经 <SortIcon sort={sort.z5} colKey="districtManager" />
                        </th>
                        <th className={thCls} onClick={thSort('z5', 'supervisor')} title="点击排序" style={stickyThS(z5Lead.lefts[2], LEAD_W.supervisor)}>
                          督导 <SortIcon sort={sort.z5} colKey="supervisor" />
                        </th>
                        <th className={thCls} onClick={thSort('z5', 'shopName')} title="点击排序" style={stickyThS(z5Lead.lefts[3], LEAD_W.shopName)}>
                          店铺名称 <SortIcon sort={sort.z5} colKey="shopName" />
                        </th>
                        <th className={numTh} onClick={thSort('z5', 'target', true)} title="点击排序">
                          目标 <SortIcon sort={sort.z5} colKey="target" />
                        </th>
                        <th className={numTh} onClick={thSort('z5', 'heroMark', true)} title="点击排序">
                          英雄标 <SortIcon sort={sort.z5} colKey="heroMark" />
                        </th>
                        <th className={numTh} onClick={thSort('z5', 'actual', true)} title="点击排序">
                          业绩金额 <SortIcon sort={sort.z5} colKey="actual" />
                        </th>
                        <th className={numTh} onClick={thSort('z5', 'rate', true)} title="点击排序">
                          达成率 <SortIcon sort={sort.z5} colKey="rate" />
                        </th>
                        <th className={numTh} onClick={thSort('z5', 'heroAchieveRate', true)} title="点击排序">
                          英雄达成率 <SortIcon sort={sort.z5} colKey="heroAchieveRate" />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {zone5.map(r => (
                        <tr key={r.shopName} className="border-b border-gray-100 hover:bg-gray-50 group">
                          <td className={dimTdCls} style={stickyTdS(z5Lead.lefts[0], LEAD_W.warehouse)}>
                            <span className="inline-block px-2.5 py-0.5 rounded-full bg-white border border-black ring-1 ring-[#D4AF37] text-xs font-bold">
                              {r.warehouseType || '—'}
                            </span>
                          </td>
                          <td className={dimTdCls} style={stickyTdS(z5Lead.lefts[1], LEAD_W.districtManager)}>{r.districtManager || '—'}</td>
                          <td className={dimTdCls} style={stickyTdS(z5Lead.lefts[2], LEAD_W.supervisor)}>{r.supervisor || '—'}</td>
                          <td className={`${dimTdCls} max-w-72`} style={stickyTdS(z5Lead.lefts[3], LEAD_W.shopName)}>
                            <span className="inline-block align-middle truncate max-w-full" title={r.shopName}>{r.shopName}</span>
                          </td>
                          <td className={numTd}>{fmtMoney(r.target)}</td>
                          <td className={numTd}>{fmtMoney(r.heroMark ?? 0)}</td>
                          <td className={numTd}>{fmtMoney(r.actual)}</td>
                          <td className={`${numTd} ${rateClass(r.rate)}`}>{fmtRate(r.rate)}</td>
                          <td className={`${numTd} ${r.heroAchieveRate == null ? 'text-gray-400' : rateClass(r.heroAchieveRate)}`}>
                            {r.heroAchieveRate == null ? '—' : fmtRate(r.heroAchieveRate)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 font-bold">
                        <td className={`${tdCls} font-black`} colSpan={4} style={stickyTotalS(z5Lead.total)}>合计（{zone5.length} 店）</td>
                        <td className={`${numTd} font-black`}>{fmtMoney(sumOf(zone5, r => r.target))}</td>
                        <td className={`${numTd} font-black`}>{fmtMoney(sumOf(zone5, r => r.heroMark ?? 0))}</td>
                        <td className={`${numTd} font-black`}>{fmtMoney(sumOf(zone5, r => r.actual))}</td>
                        <td className={`${numTd} font-black`}>{fmtRate(sumOf(zone5, r => r.target) > 0 ? sumOf(zone5, r => r.actual) / sumOf(zone5, r => r.target) : 0)}</td>
                        <td className={`${numTd} font-black`}>
                          {sumOf(zone5, r => r.heroMark ?? 0) > 0
                            ? fmtRate(sumOf(zone5, r => r.actual) / sumOf(zone5, r => r.heroMark ?? 0))
                            : '—'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}

export default PkDataTablePage;