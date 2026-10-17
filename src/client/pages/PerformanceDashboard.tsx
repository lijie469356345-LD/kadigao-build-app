import { useState, useEffect, useMemo, useCallback } from 'react';
import { Calendar, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';
import { getSalesReport } from '../../api/reports';
import { getShops } from '../../api/shops';
import type { SalesReport } from '../../types';

const fmt = (v: number) => Math.round(v || 0).toLocaleString('zh-CN', { useGrouping: false });
const pct = (done: number, target: number) => (target > 0 ? ((done / target) * 100).toFixed(1) + '%' : '-');

function getDateRangeText(range: string, customStart?: string, customEnd?: string): string {
  const now = new Date();
  const fmtD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  switch (range) {
    case 'today': return fmtD(now);
    case 'yesterday': { const d = new Date(now); d.setDate(d.getDate()-1); return fmtD(d); }
    case 'week': { const start = new Date(now); start.setDate(start.getDate()-6); return `${fmtD(start)} ~ ${fmtD(now)}`; }
    case 'month': { const m1 = new Date(now.getFullYear(), now.getMonth(), 1); return `${fmtD(m1)} ~ ${fmtD(now)}`; }
    case 'custom': return customStart && customEnd ? `${customStart} ~ ${customEnd}` : '';
    default: return '';
  }
}

function getPrevPeriodParams(range: string, customStart?: string, customEnd?: string): { dateRange: string; params: Record<string, string> } {
  const now = new Date();
  const fmtD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  switch (range) {
    case 'today': { const d = new Date(now); d.setDate(d.getDate()-1); return { dateRange: 'custom', params: { startDate: fmtD(d), endDate: fmtD(d) } }; }
    case 'yesterday': { const d = new Date(now); d.setDate(d.getDate()-2); return { dateRange: 'custom', params: { startDate: fmtD(d), endDate: fmtD(d) } }; }
    case 'week': {
      // 本期=过去7天(today-6~today)，环期=上7天(today-13~today-7)
      const start = new Date(now); start.setDate(start.getDate()-13);
      const end = new Date(now); end.setDate(end.getDate()-7);
      return { dateRange: 'custom', params: { startDate: fmtD(start), endDate: fmtD(end) } };
    }
    case 'month': {
      // 本月=1号到今天，环期=上月1号到上月同一天
      const m = new Date(now.getFullYear(), now.getMonth()-1, 1);
      const me = new Date(now.getFullYear(), now.getMonth()-1, now.getDate());
      return { dateRange: 'custom', params: { startDate: fmtD(m), endDate: fmtD(me) } };
    }
    case 'custom': {
      if (!customStart || !customEnd) return { dateRange: 'custom', params: {} };
      const s = new Date(customStart), e = new Date(customEnd);
      const days = Math.round((e.getTime()-s.getTime())/86400000) + 1;
      const ps = new Date(s); ps.setDate(ps.getDate()-days);
      const pe = new Date(s); pe.setDate(pe.getDate()-1);
      return { dateRange: 'custom', params: { startDate: fmtD(ps), endDate: fmtD(pe) } };
    }
    default: return { dateRange: 'custom', params: {} };
  }
}

function getSamePeriodLastYearParams(range: string, customStart?: string, customEnd?: string): { dateRange: string; params: Record<string, string> } {
  const now = new Date();
  const fmtD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  switch (range) {
    case 'today': { const d = new Date(now); d.setFullYear(d.getFullYear()-1); return { dateRange: 'custom', params: { startDate: fmtD(d), endDate: fmtD(d) } }; }
    case 'yesterday': { const d = new Date(now); d.setDate(d.getDate()-1); d.setFullYear(d.getFullYear()-1); return { dateRange: 'custom', params: { startDate: fmtD(d), endDate: fmtD(d) } }; }
    case 'week': {
      // 本期=过去7天，同期=去年同7天(today-6~today，年份-1)
      const start = new Date(now); start.setDate(start.getDate()-6); start.setFullYear(start.getFullYear()-1);
      const end = new Date(now); end.setFullYear(end.getFullYear()-1);
      return { dateRange: 'custom', params: { startDate: fmtD(start), endDate: fmtD(end) } };
    }
    case 'month': {
      // 本月=1号到今天，同期=去年1号到去年同一天
      const m = new Date(now.getFullYear()-1, now.getMonth(), 1);
      const me = new Date(now.getFullYear()-1, now.getMonth(), now.getDate());
      return { dateRange: 'custom', params: { startDate: fmtD(m), endDate: fmtD(me) } };
    }
    case 'custom': {
      if (!customStart || !customEnd) return { dateRange: 'custom', params: {} };
      const s = new Date(customStart); s.setFullYear(s.getFullYear()-1);
      const e = new Date(customEnd); e.setFullYear(e.getFullYear()-1);
      return { dateRange: 'custom', params: { startDate: fmtD(s), endDate: fmtD(e) } };
    }
    default: return { dateRange: 'custom', params: {} };
  }
}

function CircularProgress({ value, label, color }: { value: number; label: string; color: string }) {
  const r = 52, c = 2 * Math.PI * r;
  const offset = c - (Math.min(value, 100) / 100) * c;
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-32 h-32">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={r} fill="none" stroke="#e5e7eb" strokeWidth="10" />
          <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-gray-800">{value.toFixed(1)}%</span>
        </div>
      </div>
      <span className="text-sm text-gray-500 mt-2">{label}</span>
    </div>
  );
}

function BarProgress({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(value, 100)}%`, background: color }} />
      </div>
      <span className="text-sm font-semibold text-gray-700 min-w-[50px] text-right">{value.toFixed(1)}%</span>
    </div>
  );
}

const METRICS = [
  { key: 'quantity', label: '销量', fmt: fmt },
  { key: 'orderCount', label: '开单数', fmt: fmt },
  { key: 'avgOrderValue', label: '客单价', fmt: fmt },
  { key: 'avgItemPrice', label: '件单价', fmt: fmt },
  { key: 'attachmentRate', label: '连带率', fmt: (v:number) => (v||0).toFixed(2) },
  { key: 'giftPackageCount', label: '礼包数', fmt: fmt },
  { key: 'giftPackageAmount', label: '礼包额', fmt: fmt },
  { key: 'newMemberCount', label: '新增会员', fmt: fmt },
  { key: 'mainProductCount', label: '主推数量', fmt: fmt },
  { key: 'oldMemberAmount', label: '老会员贡献', fmt: fmt },
  { key: 'birthMemberAmount', label: '生日会员贡献', fmt: fmt },
] as const;

function aggregate(rows: SalesReport[]) {
  return {
    amount: rows.reduce((s,r) => s + (r.amount||0), 0),
    target: rows.reduce((s,r) => s + (r.target||0), 0),
    sameAmount: rows.reduce((s,r) => s + (r.sameAmount||0), 0),
    quantity: rows.reduce((s,r) => s + (r.quantity||0), 0),
    orderCount: rows.reduce((s,r) => s + (r.orderCount||0), 0),
    avgOrderValue: 0, avgItemPrice: 0, attachmentRate: 0,
    giftPackageCount: rows.reduce((s,r) => s + (r.giftPackageCount||0), 0),
    giftPackageAmount: rows.reduce((s,r) => s + (r.giftPackageAmount||0), 0),
    newMemberCount: rows.reduce((s,r) => s + (r.newMemberCount||0), 0),
    mainProductCount: rows.reduce((s,r) => s + (r.mainProductCount||0), 0),
    oldMemberAmount: rows.reduce((s,r) => s + (r.oldMemberAmount||0), 0),
    birthMemberAmount: rows.reduce((s,r) => s + (r.birthMemberAmount||0), 0),
  };
}

function computeDerived(agg: ReturnType<typeof aggregate>) {
  return {
    ...agg,
    avgOrderValue: agg.orderCount > 0 ? agg.amount / agg.orderCount : 0,
    avgItemPrice: agg.quantity > 0 ? agg.amount / agg.quantity : 0,
    attachmentRate: agg.orderCount > 0 ? agg.quantity / agg.orderCount : 0,
  };
}

function PerformanceDashboard() {
  const { user } = useAuthStore();
  const now = new Date();
  const [dateRange, setDateRange] = useState('month');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [reports, setReports] = useState<SalesReport[]>([]);
  const [prevReports, setPrevReports] = useState<SalesReport[]>([]);
  const [sameYearReports, setSameYearReports] = useState<SalesReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shopList, setShopList] = useState<any[]>([]);

  const loadShops = useCallback(async () => {
    try {
      const shops = await getShops(user?.groupName);
      setShopList(Array.isArray(shops) ? shops : []);
    } catch {}
  }, [user?.groupName]);

  useEffect(() => { loadShops(); }, [loadShops]);

  const comparableOptions = useMemo(() => {
    const month = Array.from(new Set(shopList.map(s => s.monthComparable).filter(Boolean) as string[]));
    const year = Array.from(new Set(shopList.map(s => s.yearComparable).filter(Boolean) as string[]));
    return { month, year };
  }, [shopList]);

  const loadReports = async (range?: string) => {
    const r = range || dateRange;
    setLoading(true); setError(null);
    try {
      const params: Record<string, string> = {};
      if (r === 'custom' && customStartDate && customEndDate) {
        params.startDate = customStartDate; params.endDate = customEndDate;
      }
      const prevP = getPrevPeriodParams(r, customStartDate, customEndDate);
      const sameP = getSamePeriodLastYearParams(r, customStartDate, customEndDate);
      const [curRes, prevRes, sameRes] = await Promise.all([
        getSalesReport(r, 'all', user?.groupName || undefined, params),
        getSalesReport(prevP.dateRange, 'all', user?.groupName || undefined, prevP.params),
        getSalesReport(sameP.dateRange, 'all', user?.groupName || undefined, sameP.params),
      ]);
      setReports(curRes.data);
      setPrevReports(prevRes.data);
      setSameYearReports(sameRes.data);
    } catch (e: any) { setError(e?.message || '加载失败'); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadReports(); }, []);

  const handleDateRangeChange = (r: string) => { setDateRange(r); if (r !== 'custom') loadReports(r); };
  const handleCustomDateChange = () => { if (customStartDate && customEndDate) { setDateRange('custom'); loadReports('custom'); } };

  const mcOf = (r: SalesReport) => (shopList.find(s => String(s.shopName).trim() === String(r.shopName).trim()) as any)?.monthComparable || '';
  const ycOf = (r: SalesReport) => (shopList.find(s => String(s.shopName).trim() === String(r.shopName).trim()) as any)?.yearComparable || '';

  const filter = useAreaSupervisorShopFilter<SalesReport>(reports, {
    getArea: (r) => r.area, getSupervisor: (r) => r.supervisor, getShopName: (r) => r.shopName,
    getWarehouseType: (r) => r.warehouseType, onChange: () => {},
    getMonthComparable: (r) => mcOf(r), getYearComparable: (r) => ycOf(r),
    monthComparableOptions: comparableOptions.month, yearComparableOptions: comparableOptions.year,
  });

  const filteredData = filter.filteredData;
  const current = useMemo(() => computeDerived(aggregate(filteredData)), [filteredData]);

  // 按 filteredData 中的店铺名过滤同期和环期数据
  const filteredShopNames = useMemo(() => new Set(filteredData.map(r => String(r.shopName).trim())), [filteredData]);
  const filteredPrev = useMemo(() => prevReports.filter(r => filteredShopNames.has(String(r.shopName).trim())), [prevReports, filteredShopNames]);
  const filteredSameYear = useMemo(() => sameYearReports.filter(r => filteredShopNames.has(String(r.shopName).trim())), [sameYearReports, filteredShopNames]);

  const yoyData = useMemo(() => computeDerived(aggregate(filteredSameYear)), [filteredSameYear]);
  const momData = useMemo(() => computeDerived(aggregate(filteredPrev)), [filteredPrev]);

  const achievementRate = current.target > 0 ? (current.amount / current.target) * 100 : 0;
  const remaining = current.target - current.amount;
  const yoyChange = yoyData.amount > 0 ? ((current.amount - yoyData.amount) / yoyData.amount) * 100 : 0;
  const momChange = momData.amount > 0 ? ((current.amount - momData.amount) / momData.amount) * 100 : 0;

  // 时间进度：根据筛选日期范围的总天数和已过天数计算
  const calculatedTimeProgress = useMemo(() => {
    const now = new Date();
    const fmtD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const todayStr = fmtD(now);
    const today = new Date(todayStr + 'T00:00:00');
    switch (dateRange) {
      case 'today': {
        // 今日 = 8:00~22:00 营业时段，按当前时间算进度
        const h = now.getHours() + now.getMinutes() / 60;
        if (h <= 8) return 0;
        if (h >= 22) return 100;
        return Math.min(((h - 8) / 14) * 100, 100);
      }
      case 'yesterday':
        return 100; // 昨日已过
      case 'week': {
        // 本周 = 周一到今天，进度 = 已过天数 / 本周总天数(7)
        const dayOfWeek = now.getDay(); // 0=周日
        const passedThisWeek = dayOfWeek === 0 ? 7 : dayOfWeek; // 周一=1 … 周日=7
        return Math.min((passedThisWeek / 7) * 100, 100);
      }
      case 'month': {
        // 本月 = 1号到今天，进度 = 已过天数(今日日期) / 本月实际天数
        const passedThisMonth = now.getDate();
        const totalThisMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        return Math.min((passedThisMonth / totalThisMonth) * 100, 100);
      }
      case 'custom': {
        if (!customStartDate || !customEndDate) return 0;
        const s = new Date(customStartDate + 'T00:00:00');
        const e = new Date(customEndDate + 'T00:00:00');
        if (today < s) return 0;
        if (today > e) return 100;
        const totalDays = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
        const passedDays = Math.round((today.getTime() - s.getTime()) / 86400000) + 1;
        return Math.min((passedDays / totalDays) * 100, 100);
      }
      default:
        return 0;
    }
  }, [dateRange, customStartDate, customEndDate]);

  // 按仓库类别分组（本期/同期/环期）
  const warehouseGroups = useMemo(() => {
    const groups: Record<string, SalesReport[]> = {};
    filteredData.forEach(r => {
      const wt = r.warehouseType || '其他';
      if (!groups[wt]) groups[wt] = [];
      groups[wt].push(r);
    });
    return groups;
  }, [filteredData]);

  const warehouseGroupsYoy = useMemo(() => {
    const groups: Record<string, SalesReport[]> = {};
    filteredSameYear.forEach(r => {
      const wt = r.warehouseType || '其他';
      if (!groups[wt]) groups[wt] = [];
      groups[wt].push(r);
    });
    return groups;
  }, [filteredSameYear]);

  const warehouseGroupsMom = useMemo(() => {
    const groups: Record<string, SalesReport[]> = {};
    filteredPrev.forEach(r => {
      const wt = r.warehouseType || '其他';
      if (!groups[wt]) groups[wt] = [];
      groups[wt].push(r);
    });
    return groups;
  }, [filteredPrev]);

  const warehouseOrder = ['直营', '山东直营', '加盟'];

  const calcChange = (curVal: number, baseVal: number): { pct: number; up: boolean | null } => {
    if (baseVal === 0) {
      if (curVal === 0) return { pct: 0, up: null };
      return { pct: 100, up: true }; // 基数为0、本期有值，视为新增(上升)
    }
    const v = ((curVal - baseVal) / Math.abs(baseVal)) * 100;
    return { pct: v, up: v > 0 ? true : v < 0 ? false : null };
  };

  const renderChangeCell = (curVal: number, baseVal: number) => {
    const { pct, up } = calcChange(curVal, baseVal);
    if (up === null) {
      return <span className="text-gray-400">—</span>;
    }
    const color = up ? 'text-green-600' : 'text-red-600';
    const arrow = up ? '↑' : '↓';
    return (
      <span className={`font-medium ${color}`}>
        {arrow} {Math.abs(pct).toFixed(1)}%
      </span>
    );
  };

  const renderMetricsTable = (cur: ReturnType<typeof computeDerived>, yoy: ReturnType<typeof computeDerived>, mom: ReturnType<typeof computeDerived>) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-3 py-2 text-left text-gray-500 font-medium border border-gray-200">指标</th>
            {METRICS.map(m => (
              <th key={m.key} className="px-3 py-2 text-right text-gray-500 font-medium border border-gray-200 whitespace-nowrap">{m.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* 本期：显示具体值 */}
          <tr className="hover:bg-gray-50">
            <td className="px-3 py-2 font-medium border border-gray-200 text-gray-900">本期</td>
            {METRICS.map(m => (
              <td key={m.key} className="px-3 py-2 text-right border border-gray-200 whitespace-nowrap text-gray-900">
                {m.fmt((cur as any)[m.key] || 0)}
              </td>
            ))}
          </tr>
          {/* 同比：(本期-同期)/同期 */}
          <tr className="hover:bg-gray-50 bg-blue-50/30">
            <td className="px-3 py-2 font-medium border border-gray-200 text-blue-600">同比</td>
            {METRICS.map(m => (
              <td key={m.key} className="px-3 py-2 text-right border border-gray-200 whitespace-nowrap">
                {renderChangeCell((cur as any)[m.key] || 0, (yoy as any)[m.key] || 0)}
              </td>
            ))}
          </tr>
          {/* 环比：(本期-环期)/环期 */}
          <tr className="hover:bg-gray-50 bg-orange-50/30">
            <td className="px-3 py-2 font-medium border border-gray-200 text-orange-600">环比</td>
            {METRICS.map(m => (
              <td key={m.key} className="px-3 py-2 text-right border border-gray-200 whitespace-nowrap">
                {renderChangeCell((cur as any)[m.key] || 0, (mom as any)[m.key] || 0)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );

  return (
    <Layout title="业绩看板" subtitle={`业绩数据分析 (${getDateRangeText(dateRange, customStartDate, customEndDate)})`}>
      <div className="p-4 space-y-4">
        {/* 时间筛选器 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar className="w-5 h-5 text-gray-400" />
            {['today','yesterday','week','month'].map(r => (
              <button key={r} onClick={() => handleDateRangeChange(r)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${dateRange === r ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}>
                {{today:'今日',yesterday:'昨日',week:'本周',month:'本月'}[r]}
              </button>
            ))}
            <div className="flex items-center gap-2 ml-2">
              <input type="date" value={customStartDate} onChange={e=>setCustomStartDate(e.target.value)}
                className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none" />
              <span className="text-gray-400 text-sm">至</span>
              <input type="date" value={customEndDate} onChange={e=>setCustomEndDate(e.target.value)}
                className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none" />
              <button onClick={handleCustomDateChange} disabled={!customStartDate||!customEndDate}
                className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">确定</button>
            </div>
            <span className="text-sm text-gray-400 ml-2">({getDateRangeText(dateRange, customStartDate, customEndDate)})</span>
            <button onClick={() => loadReports()} disabled={loading}
              className="ml-auto flex items-center gap-1 px-3 py-1.5 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 transition-colors disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`} />刷新
            </button>
          </div>
        </div>

        {/* 筛选器 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 relative">
          <AreaSupervisorShopFilter filter={filter as any} />
        </div>

        {error && <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm">{error}</div>}

        {/* 第一区：大卡片 */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl shadow-lg p-6 text-white">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <div className="text-blue-100 text-sm mb-1">本期完成金额</div>
              <div className="text-3xl font-bold">{fmt(current.amount)}</div>
              <div className="flex items-center gap-3 mt-2 text-sm">
                <span className="text-blue-100">同比:</span>
                <span className={yoyChange >= 0 ? 'text-green-300' : 'text-red-300'}>
                  {yoyChange >= 0 ? <TrendingUp className="w-3 h-3 inline" /> : <TrendingDown className="w-3 h-3 inline" />}
                  {Math.abs(yoyChange).toFixed(1)}%
                </span>
                <span className="text-blue-100">环比:</span>
                <span className={momChange >= 0 ? 'text-green-300' : 'text-red-300'}>
                  {momChange >= 0 ? <TrendingUp className="w-3 h-3 inline" /> : <TrendingDown className="w-3 h-3 inline" />}
                  {Math.abs(momChange).toFixed(1)}%
                </span>
              </div>
            </div>
            <div>
              <div className="text-blue-100 text-sm mb-1">本期目标</div>
              <div className="text-3xl font-bold">{fmt(current.target)}</div>
            </div>
            <div>
              <div className="text-blue-100 text-sm mb-1">本期达成率</div>
              <div className="text-3xl font-bold">{achievementRate.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-blue-100 text-sm mb-1">剩余金额</div>
              <div className={`text-3xl font-bold ${remaining >= 0 ? 'text-yellow-300' : 'text-red-300'}`}>{fmt(remaining)}</div>
            </div>
          </div>
        </div>

        {/* 第二区：进度条 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <div className="text-sm text-gray-500 mb-2 font-medium">时间进度</div>
              <BarProgress value={calculatedTimeProgress} color="#3b82f6" />
            </div>
            <div className="flex flex-col items-center">
              <CircularProgress value={achievementRate} label="业绩达成" color="#10b981" />
            </div>
            <div className="flex flex-col items-center">
              <CircularProgress value={calculatedTimeProgress > 0 ? (achievementRate / calculatedTimeProgress) * 100 : 0} label="预计达成" color="#f59e0b" />
            </div>
          </div>
        </div>

        {/* 第三区：各项指标表格 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h3 className="text-base font-semibold text-gray-700 mb-3">各项指标</h3>
          {renderMetricsTable(current, yoyData, momData)}
        </div>

        {/* 第四区：仓库类别指标表格 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h3 className="text-base font-semibold text-gray-700 mb-3">仓库类别指标</h3>
          <div className="space-y-4">
            {warehouseOrder.map(wt => {
              const rows = warehouseGroups[wt] || [];
              const cur = computeDerived(aggregate(rows));
              const yoy = computeDerived(aggregate(warehouseGroupsYoy[wt] || []));
              const mom = computeDerived(aggregate(warehouseGroupsMom[wt] || []));
              return (
                <div key={wt}>
                  <h4 className="text-sm font-medium text-gray-600 mb-2">{wt}（{rows.length}家）</h4>
                  {rows.length > 0 ? renderMetricsTable(cur, yoy, mom) : (
                    <div className="text-sm text-gray-400 py-3 text-center bg-gray-50 rounded-lg">暂无数据</div>
                  )}
                </div>
              );
            })}
            {/* 其他仓库类别 */}
            {Object.keys(warehouseGroups).filter(wt => !warehouseOrder.includes(wt)).map(wt => {
              const rows = warehouseGroups[wt];
              const cur = computeDerived(aggregate(rows));
              const yoy = computeDerived(aggregate(warehouseGroupsYoy[wt] || []));
              const mom = computeDerived(aggregate(warehouseGroupsMom[wt] || []));
              return (
                <div key={wt}>
                  <h4 className="text-sm font-medium text-gray-600 mb-2">{wt}（{rows.length}家）</h4>
                  {renderMetricsTable(cur, yoy, mom)}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default PerformanceDashboard;
