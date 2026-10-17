import { useState, useMemo, useEffect } from 'react';
import { BarChart3, Calendar, Download, TrendingUp, RefreshCw, ArrowUp, ArrowDown, ChevronsUpDown, Search } from 'lucide-react';
import { getStaffSalesTarget } from '../../api/reports';
import { getShops } from '../../api/shops';
import { getStaffMonthlyTargets, fetchStaffDailyTargetsByRange } from '../../api/staffMonthlyTarget';
import type { StaffSalesTarget } from '../../types';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { useFilterStore } from '../../store/filterStore';
import { useDataCacheStore } from '../../store/dataCacheStore';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';
import * as XLSX from 'xlsx';

const PAGE_KEY = 'staffSalesTargetPage';

function StaffSalesTargetPage() {
  const { user } = useAuthStore();
  const { staffSalesFilter, setStaffSalesFilter } = useFilterStore();
  const { pageCache, setPageCache, clearPageCache } = useDataCacheStore();
  const cached = pageCache[PAGE_KEY];
  
  const [targets, setTargets] = useState<StaffSalesTarget[]>(cached?.targets || []);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState(staffSalesFilter.dateRange);
  const [filterType, setFilterType] = useState(staffSalesFilter.filterType);
  const [timeProgress, setTimeProgress] = useState(cached?.timeProgress || 0);
  const [error, setError] = useState<string | null>(null);
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [hasData, setHasData] = useState(!!cached);
  const [staffTargetMap, setStaffTargetMap] = useState<Record<string, number>>({});
  const [searchText, setSearchText] = useState('');

  // 排序状态
  type SortKey = 'districtManager' | 'supervisor' | 'shopName' | 'staffName' | 'achieved' | 'quantity' | 'orderCount' | 'avgOrderValue' | 'avgItemPrice' | 'attachmentRate' | 'giftPackageCount' | 'giftPackageAmount';
  type SortDirection = 'asc' | 'desc';
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  };

  const getSortIcon = (key: SortKey) => {
    if (sortKey !== key) {
      return <ChevronsUpDown size={14} className="text-gray-300" />;
    }
    return sortDirection === 'asc'
      ? <ArrowUp size={14} className="text-primary" />
      : <ArrowDown size={14} className="text-primary" />;
  };

  useEffect(() => {
    if (!cached) {
      loadTargets();
    }
  }, []);

  const loadTargets = async (newDateRange?: string) => {
    try {
      setLoading(true);
      setError(null);
      const range = newDateRange || dateRange;
      console.log('Loading staff sales targets with dateRange:', range);
      
      let params: Record<string, string> = {};
      if (range === 'custom' && customStartDate && customEndDate) {
        params.startDate = customStartDate;
        params.endDate = customEndDate;
      }
      
      const result = await getStaffSalesTarget(range, filterType, user?.groupName || undefined, undefined, undefined, params);
      console.log('Staff sales target data received:', result.data.length, 'records');
      setTargets(result.data);
      setTimeProgress(result.timeProgress);
      setHasData(true);
      setPageCache(PAGE_KEY, { targets: result.data, timeProgress: result.timeProgress });
      // 根据选中的日期范围加载店员日目标
      let sd = '', ed = '';
      const td = new Date();
      if (range === 'today') { const s = `${td.getFullYear()}-${String(td.getMonth()+1).padStart(2,'0')}-${String(td.getDate()).padStart(2,'0')}`; sd = s; ed = s; }
      else if (range === 'yesterday') { const d = new Date(td); d.setDate(d.getDate()-1); const s = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; sd = s; ed = s; }
      else if (range === 'week') { const d = new Date(td); d.setDate(d.getDate()-6); sd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; ed = `${td.getFullYear()}-${String(td.getMonth()+1).padStart(2,'0')}-${String(td.getDate()).padStart(2,'0')}`; }
      else if (range === 'custom' && customStartDate && customEndDate) { sd = customStartDate; ed = customEndDate; }
      else { sd = `${td.getFullYear()}-${String(td.getMonth()+1).padStart(2,'0')}-01`; ed = `${td.getFullYear()}-${String(td.getMonth()+1).padStart(2,'0')}-${new Date(td.getFullYear(), td.getMonth()+1, 0).getDate()}`; }
      if (sd && ed) {
        const staffTargets = await fetchStaffDailyTargetsByRange(sd, ed, user?.groupName);
        setStaffTargetMap(staffTargets || {});
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '加载数据失败';
      console.error('Failed to load staff sales targets:', errorMessage);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const getStaffTarget = (t: StaffSalesTarget) => staffTargetMap[`${t.shopName.trim()}|${t.staffName.trim()}`] || 0;

  const [currentPage, setCurrentPage] = useState(1);

  // 从店铺档案加载可比性候选值（月/年可比性直接取自店铺档案，key=店铺名）
  const [comparableOptions, setComparableOptions] = useState<{ month: string[]; year: string[] }>({ month: [], year: [] });
  const [shopComparableMap, setShopComparableMap] = useState<Record<string, { mc: string; yc: string }>>({});
  useEffect(() => {
    (async () => {
      try {
        const shops = await getShops(user?.groupName);
        if (Array.isArray(shops)) {
          const map: Record<string, { mc: string; yc: string }> = {};
          (shops as any[]).forEach(s => { if (s.shopName) map[String(s.shopName).trim()] = { mc: s.monthComparable || '', yc: s.yearComparable || '' }; });
          setShopComparableMap(map);
          const mc = Array.from(new Set(Object.values(map).map(v => v.mc).filter(Boolean)));
          const yc = Array.from(new Set(Object.values(map).map(v => v.yc).filter(Boolean)));
          setComparableOptions({ month: mc, year: yc });
        }
      } catch { /* 忽略失败 */ }
    })();
  }, [user?.groupName]);

  const shopCmp = (t: { shopName?: string }) => shopComparableMap[String(t?.shopName || '').trim()] || { mc: '', yc: '' };

  // 三级联动多选筛选
  const areaSupervisorShopFilter = useAreaSupervisorShopFilter<StaffSalesTarget>(targets, {
    getArea: (t) => t.area,
    getSupervisor: (t) => t.supervisor,
    getShopName: (t) => t.shopName,
    getWarehouseType: (t: any) => (t as any).warehouseType,
    getDistrictManager: (t) => t.districtManager,
    getDealer: (t) => (t as any).dealer,
    getMonthComparable: (t) => shopCmp(t).mc,
    getYearComparable: (t) => shopCmp(t).yc,
    monthComparableOptions: comparableOptions.month,
    yearComparableOptions: comparableOptions.year,
    onChange: () => setCurrentPage(1),
  });

  // 在筛选结果上叠加排序
  const filteredTargets = useMemo(() => {
    let result = [...areaSupervisorShopFilter.filteredData];
    if (searchText.trim()) {
      const kw = searchText.trim().toLowerCase();
      result = result.filter(t =>
        (t.supervisor || '').toLowerCase().includes(kw) ||
        (t.districtManager || '').toLowerCase().includes(kw) ||
        (t.shopName || '').toLowerCase().includes(kw)
      );
    }
    if (sortKey) {
      result.sort((a, b) => {
        const valA = a[sortKey] ?? 0;
        const valB = b[sortKey] ?? 0;
        if (typeof valA === 'string' && typeof valB === 'string') {
          return sortDirection === 'asc' ? valA.localeCompare(valB, 'zh-CN') : valB.localeCompare(valA, 'zh-CN');
        }
        const numA = Number(valA);
        const numB = Number(valB);
        return sortDirection === 'asc' ? numA - numB : numB - numA;
      });
    }
    return result;
  }, [areaSupervisorShopFilter.filteredData, sortKey, sortDirection, searchText]);
  const pageSize = 50;
  const totalPages = Math.ceil(filteredTargets.length / pageSize);
  const paginatedTargets = filteredTargets.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleRefresh = () => {
    setCurrentPage(1);
    clearPageCache(PAGE_KEY);
    loadTargets();
  };

  const getDateRangeText = (): string => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const formatDate = (date: Date): string => {
      return `${date.getMonth() + 1}/${date.getDate()}`;
    };

    switch (dateRange) {
      case 'today':
        return `${formatDate(today)}`;
      case 'yesterday':
        return `${formatDate(yesterday)}`;
      case 'week':
        const weekStart = new Date(today);
        weekStart.setDate(weekStart.getDate() - 6);
        return `${formatDate(weekStart)} - ${formatDate(today)}`;
      case 'month':
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        return `${formatDate(monthStart)} - ${formatDate(today)}`;
      case 'custom':
        return `${customStartDate} - ${customEndDate}`;
      default:
        return '';
    }
  };

  const handleDateRangeChange = (newDateRange: string) => {
    console.log('Date range changed to:', newDateRange);
    setDateRange(newDateRange);
    setStaffSalesFilter({ dateRange: newDateRange });
    setCurrentPage(1);
    loadTargets(newDateRange);
  };

  const handleCustomDateChange = () => {
    if (customStartDate && customEndDate) {
      setDateRange('custom');
      setStaffSalesFilter({ dateRange: 'custom' });
      setCurrentPage(1);
      loadTargets('custom');
    }
  };

  const totalAmount = filteredTargets.reduce((sum, t) => sum + (t.achieved || 0), 0);
  const totalStaffTarget = filteredTargets.reduce((sum, t) => sum + (staffTargetMap[`${t.shopName}|${t.staffName}`] || 0), 0);
  const totalQuantity = filteredTargets.reduce((sum, t) => sum + (t.quantity || 0), 0);
  const totalOrderCount = filteredTargets.reduce((sum, t) => sum + (t.orderCount || 0), 0);
  const totalGiftPackageCount = filteredTargets.reduce((sum, t) => sum + (t.giftPackageCount || 0), 0);
  const totalGiftPackageAmount = filteredTargets.reduce((sum, t) => sum + (t.giftPackageAmount || 0), 0);

  const formatCurrency = (value: number): string => {
    return `${value.toLocaleString('zh-CN', { useGrouping: false })}`;
  };

  const exportExcel = () => {
    const rows: any[][] = [[
      '区经', '督导', '店铺名称', '店员', '店员业绩目标', '业绩金额', '达成率',
      '销售数量', '开单数', '客单价', '件单价', '连带率', '礼包数', '礼包额'
    ]];
    filteredTargets.forEach(t => {
      const target = getStaffTarget(t);
      rows.push([
        t.districtManager, t.supervisor, t.shopName, t.staffName,
        target > 0 ? target : '-',
        Math.round(t.achieved),
        target > 0 ? ((t.achieved / target) * 100).toFixed(1) + '%' : '-', Math.round(t.quantity), t.orderCount,
        t.avgOrderValue.toFixed(1), t.avgItemPrice.toFixed(1),
        t.attachmentRate.toFixed(2), t.giftPackageCount,
        Math.round(t.giftPackageAmount)
      ]);
    });
    rows.push([
      '合计', '', `${new Set(filteredTargets.map(t => t.shopName)).size}家店铺`,
      `${filteredTargets.length}名店员`, totalStaffTarget > 0 ? totalStaffTarget : '-',
      Math.round(totalAmount),
      totalStaffTarget > 0 ? ((totalAmount / totalStaffTarget) * 100).toFixed(1) + '%' : '-', totalQuantity, totalOrderCount,
      (totalOrderCount > 0 ? (totalAmount / totalOrderCount) : 0).toFixed(1),
      (totalQuantity > 0 ? (totalAmount / totalQuantity) : 0).toFixed(1),
      (totalOrderCount > 0 ? (totalQuantity / totalOrderCount) : 0).toFixed(2),
      totalGiftPackageCount, Math.round(totalGiftPackageAmount)
    ]);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '店员销售指标');
    XLSX.writeFile(wb, `店员销售指标_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <Layout title="店员销售指标" subtitle="查看各店员销售数据">
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <p className="text-red-600">数据加载失败: {error}</p>
            <button
              onClick={() => loadTargets()}
              className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
            >
              重新加载
            </button>
          </div>
        </div>
      )}
      <div className="w-full">
        <div className="sticky top-0 z-30 bg-white shadow-sm px-6 py-3 border-b">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-gray-400" />
                <button
                  onClick={() => handleDateRangeChange('today')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${dateRange === 'today' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
                >
                  今日
                </button>
                <button
                  onClick={() => handleDateRangeChange('yesterday')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${dateRange === 'yesterday' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
                >
                  昨日
                </button>
                <button
                  onClick={() => handleDateRangeChange('week')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${dateRange === 'week' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
                >
                  本周
                </button>
                <button
                  onClick={() => handleDateRangeChange('month')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${dateRange === 'month' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
                >
                  本月
                </button>
                <div className="flex items-center gap-2 ml-2">
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
                  />
                  <span className="text-gray-400 text-sm">至</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
                  />
                  <button
                    onClick={handleCustomDateChange}
                    disabled={!customStartDate || !customEndDate}
                    className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    确定
                  </button>
                </div>
                <span className="text-sm text-gray-400 ml-2">
                  ({getDateRangeText()})
                </span>
              </div>
              <AreaSupervisorShopFilter filter={areaSupervisorShopFilter} />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRefresh}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-1.5 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
              >
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                <span className="text-sm">刷新数据</span>
              </button>
              <button onClick={exportExcel} className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                <Download size={18} />
                <span className="text-sm">导出Excel</span>
              </button>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  placeholder="搜索督导/区经/店铺..."
                  className="pl-9 pr-3 py-1.5 w-56 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : targets.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[400px]">
            <p className="text-xl text-gray-500">暂无数据，请点击"刷新数据"按钮加载数据</p>
          </div>
        ) : (
          <div className="w-full">

            <div className="grid grid-cols-6 gap-4 mb-6 mt-4 px-6">
              <div className="bg-white rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">销售金额</p>
                    <p className="text-2xl font-bold text-gray-800 mt-1">
                      ¥{(totalAmount / 10000).toFixed(1)}万
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-primary" />
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">销售数量</p>
                    <p className="text-2xl font-bold text-gray-800 mt-1">{totalQuantity}件</p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Calendar className="w-6 h-6 text-blue-500" />
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">销售笔数</p>
                    <p className="text-2xl font-bold text-gray-800 mt-1">{totalOrderCount}</p>
                  </div>
                  <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center">
                    <BarChart3 className="w-6 h-6 text-indigo-500" />
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">平均店效</p>
                    <p className="text-2xl font-bold text-gray-800 mt-1">
                      ¥{filteredTargets.length > 0 ? Math.round(totalAmount / filteredTargets.length).toLocaleString('zh-CN', { useGrouping: false }) : 0}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-cyan-100 rounded-lg flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-cyan-500" />
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">店铺数量</p>
                    <p className="text-2xl font-bold text-gray-800 mt-1">{new Set(filteredTargets.map(t => t.shopName)).size}</p>
                  </div>
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                    <BarChart3 className="w-6 h-6 text-purple-500" />
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">时间进度</p>
                    <p className="text-2xl font-bold text-gray-800 mt-1">{timeProgress.toFixed(1)}%</p>
                  </div>
                  <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                    <Calendar className="w-6 h-6 text-orange-500" />
                  </div>
                </div>
              </div>
            </div>

            <div className="mx-6 bg-white rounded-xl shadow-sm overflow-hidden table-row-compact">
              <div className="max-h-[140vh] overflow-auto">
                <table className="w-full">
                  <thead className="sticky top-0 z-20">
                    <tr className="bg-gray-50">
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 sticky left-0 z-30 bg-gray-50 whitespace-nowrap">
                        <button onClick={() => handleSort('districtManager')} className="flex items-center gap-1 hover:text-primary transition-colors">
                          区经 {getSortIcon('districtManager')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 sticky left-[90px] z-30 bg-gray-50 whitespace-nowrap">
                        <button onClick={() => handleSort('supervisor')} className="flex items-center gap-1 hover:text-primary transition-colors">
                          督导 {getSortIcon('supervisor')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 sticky left-[170px] z-30 bg-gray-50 whitespace-nowrap">
                        <button onClick={() => handleSort('shopName')} className="flex items-center gap-1 hover:text-primary transition-colors">
                          店铺名称 {getSortIcon('shopName')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 sticky left-[260px] z-30 bg-gray-50 whitespace-nowrap">
                        <button onClick={() => handleSort('staffName')} className="flex items-center gap-1 hover:text-primary transition-colors">
                          店员 {getSortIcon('staffName')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 whitespace-nowrap">
                        店员业绩目标
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 whitespace-nowrap">
                        <button onClick={() => handleSort('achieved')} className="inline-flex items-center gap-1 hover:text-primary transition-colors ml-auto">
                          业绩金额 {getSortIcon('achieved')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 whitespace-nowrap">
                        达成率
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 whitespace-nowrap">
                        <button onClick={() => handleSort('quantity')} className="inline-flex items-center gap-1 hover:text-primary transition-colors ml-auto">
                          销售数量 {getSortIcon('quantity')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 whitespace-nowrap">
                        <button onClick={() => handleSort('orderCount')} className="inline-flex items-center gap-1 hover:text-primary transition-colors ml-auto">
                          开单数 {getSortIcon('orderCount')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 whitespace-nowrap">
                        <button onClick={() => handleSort('avgOrderValue')} className="inline-flex items-center gap-1 hover:text-primary transition-colors ml-auto">
                          客单价 {getSortIcon('avgOrderValue')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 whitespace-nowrap">
                        <button onClick={() => handleSort('avgItemPrice')} className="inline-flex items-center gap-1 hover:text-primary transition-colors ml-auto">
                          件单价 {getSortIcon('avgItemPrice')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 whitespace-nowrap">
                        <button onClick={() => handleSort('attachmentRate')} className="inline-flex items-center gap-1 hover:text-primary transition-colors ml-auto">
                          连带率 {getSortIcon('attachmentRate')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 whitespace-nowrap">
                        <button onClick={() => handleSort('giftPackageCount')} className="inline-flex items-center gap-1 hover:text-primary transition-colors ml-auto">
                          礼包数 {getSortIcon('giftPackageCount')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 whitespace-nowrap">
                        <button onClick={() => handleSort('giftPackageAmount')} className="inline-flex items-center gap-1 hover:text-primary transition-colors ml-auto">
                          礼包额 {getSortIcon('giftPackageAmount')}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredTargets.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="px-6 py-8 text-center text-gray-400">
                          暂无数据
                        </td>
                      </tr>
                    ) : (
                      <>
                        {paginatedTargets.map((target, index) => (
                          <tr key={index} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 text-gray-600 sticky left-0 z-10 bg-white hover:bg-gray-50 whitespace-nowrap">{target.districtManager}</td>
                            <td className="px-4 py-3 text-gray-600 sticky left-[90px] z-10 bg-white hover:bg-gray-50 whitespace-nowrap">{target.supervisor}</td>
                            <td className="px-4 py-3 text-gray-800 font-medium sticky left-[170px] z-10 bg-white hover:bg-gray-50 whitespace-nowrap">{target.shopName}</td>
                            <td className="px-4 py-3 text-gray-600 sticky left-[260px] z-10 bg-white hover:bg-gray-50 whitespace-nowrap">{target.staffName}</td>
                            <td className="px-4 py-3 text-right text-blue-600 font-bold">{formatCurrency(getStaffTarget(target))}</td>
                            <td className="px-4 py-3 text-right text-gray-800 font-medium">{formatCurrency(target.achieved)}</td>
                            <td className="px-4 py-3 text-right">
                              {(() => { const tgt = getStaffTarget(target); const ach = target.achieved || 0;
                                return <span style={{fontWeight:'bold',color:tgt>0&&ach>=tgt?'#16a34a':'#dc2626'}}>{tgt>0?((ach/tgt)*100).toFixed(1)+'%':'-'}</span>;
                              })()}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-600">{Math.round(target.quantity)}件</td>
                            <td className="px-4 py-3 text-right text-gray-600">{target.orderCount}</td>
                            <td className="px-4 py-3 text-right text-gray-600">¥{target.avgOrderValue.toFixed(1)}</td>
                            <td className="px-4 py-3 text-right text-gray-600">¥{target.avgItemPrice.toFixed(1)}</td>
                            <td className="px-4 py-3 text-right text-gray-600">{target.attachmentRate.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right text-gray-600">{target.giftPackageCount}个</td>
                            <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(target.giftPackageAmount)}</td>
                          </tr>
                        ))}
                        <tr className="bg-gray-50 font-bold">
                          <td className="px-4 py-3 text-gray-800 sticky left-0 z-10 bg-gray-50 whitespace-nowrap">总计</td>
                          <td className="px-4 py-3 text-gray-800 sticky left-[90px] z-10 bg-gray-50 whitespace-nowrap">-</td>
                          <td className="px-4 py-3 text-gray-800 sticky left-[170px] z-10 bg-gray-50 whitespace-nowrap">{new Set(filteredTargets.map(t => t.shopName)).size}家店铺</td>
                          <td className="px-4 py-3 text-gray-800 sticky left-[260px] z-10 bg-gray-50 whitespace-nowrap">{filteredTargets.length}名店员</td>
                          <td className="px-4 py-3 text-right text-blue-600 font-bold">{formatCurrency(totalStaffTarget)}</td>
                          <td className="px-4 py-3 text-right text-gray-800">{formatCurrency(totalAmount)}</td>
                          <td className="px-4 py-3 text-right font-bold" style={{color: totalStaffTarget>0&&totalAmount>=totalStaffTarget?'#16a34a':'#dc2626'}}>
                            {totalStaffTarget > 0 ? ((totalAmount / totalStaffTarget) * 100).toFixed(1) + '%' : '-'}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-800">{formatCurrency(totalAmount)}</td>
                          <td className="px-4 py-3 text-right text-gray-800">{totalQuantity}件</td>
                          <td className="px-4 py-3 text-right text-gray-800">{totalOrderCount}</td>
                          <td className="px-4 py-3 text-right text-gray-800">¥{(totalOrderCount > 0 ? (totalAmount / totalOrderCount).toFixed(1) : '0.0')}</td>
                          <td className="px-4 py-3 text-right text-gray-800">¥{(totalQuantity > 0 ? (totalAmount / totalQuantity).toFixed(1) : '0.0')}</td>
                          <td className="px-4 py-3 text-right text-gray-800">{(totalQuantity / totalOrderCount).toFixed(2)}</td>
                          <td className="px-4 py-3 text-right text-gray-800">{totalGiftPackageCount}个</td>
                          <td className="px-4 py-3 text-right text-gray-800">{formatCurrency(totalGiftPackageAmount)}</td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 mx-6">
                <p className="text-sm text-gray-500">
                  显示 {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, filteredTargets.length)} 条，共 {filteredTargets.length} 条
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    上一页
                  </button>
                  {(() => {
                    const pages: (number | string)[] = [];
                    if (totalPages <= 7) {
                      for (let i = 1; i <= totalPages; i++) pages.push(i);
                    } else {
                      pages.push(1);
                      if (currentPage > 3) pages.push('...');
                      const s = Math.max(2, currentPage - 1);
                      const e = Math.min(totalPages - 1, currentPage + 1);
                      for (let i = s; i <= e; i++) pages.push(i);
                      if (currentPage < totalPages - 2) pages.push('...');
                      pages.push(totalPages);
                    }
                    return pages.map((p, i) =>
                      p === '...' ? <span key={'d'+i} className="px-2 text-gray-400">...</span> :
                      <button key={p} onClick={() => setCurrentPage(p as number)}
                        className={`px-3 py-1 text-sm rounded-lg ${p === currentPage ? 'bg-primary text-white' : 'border border-gray-200 hover:bg-gray-50'}`}>{p}</button>
                    );
                  })()}
                  <button
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    下一页
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}

export default StaffSalesTargetPage;