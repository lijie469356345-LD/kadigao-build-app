import { useState, useMemo, useEffect } from 'react';
import { BarChart3, Calendar, Filter, TrendingUp, TrendingDown, RefreshCw, ArrowUp, ArrowDown, ChevronsUpDown, FileSpreadsheet, FileText, Search } from 'lucide-react';
import { getSalesReport } from '../../api/reports';
import { getShops } from '../../api/shops';
import type { SalesReport } from '../../types';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { useDataCacheStore } from '../../store/dataCacheStore';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

const PAGE_KEY = 'reportPage';

function ReportPage() {
  const { user } = useAuthStore();
  const { pageCache, setPageCache, clearPageCache } = useDataCacheStore();
  
  const [reports, setReports] = useState<SalesReport[]>(pageCache[PAGE_KEY]?.reports || []);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState('month');
  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [selectedSupervisors, setSelectedSupervisors] = useState<string[]>([]);
  const [selectedShops, setSelectedShops] = useState<string[]>([]);
  const [selectedWarehouses, setSelectedWarehouses] = useState<string[]>([]);
  const [selectedDistrictManagers, setSelectedDistrictManagers] = useState<string[]>([]);
  const [selectedDealers, setSelectedDealers] = useState<string[]>([]);
  const [showAreaPanel, setShowAreaPanel] = useState(false);
  const [showSupervisorPanel, setShowSupervisorPanel] = useState(false);
  const [showShopPanel, setShowShopPanel] = useState(false);
  const [showWarehousePanel, setShowWarehousePanel] = useState(false);
  const [showDistrictManagerPanel, setShowDistrictManagerPanel] = useState(false);
  const [showDealerPanel, setShowDealerPanel] = useState(false);
  const [selectedMonthComparables, setSelectedMonthComparables] = useState<string[]>([]);
  const [showMonthComparablePanel, setShowMonthComparablePanel] = useState(false);
  const [selectedYearComparables, setSelectedYearComparables] = useState<string[]>([]);
  const [showYearComparablePanel, setShowYearComparablePanel] = useState(false);
  const [timeProgress, setTimeProgress] = useState(pageCache[PAGE_KEY]?.timeProgress || 0);
  const [error, setError] = useState<string | null>(null);
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [hasData, setHasData] = useState(!!pageCache[PAGE_KEY]);
  // 从店铺档案加载可比性（候选值 + 店铺名→可比性映射，key=店铺名）
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

  // 排序状态
  type SortKey = 'districtManager' | 'supervisor' | 'shopName' | 'target' | 'amount' | 'achievement' | 'quantity' | 'orderCount' | 'avgOrderValue' | 'avgItemPrice' | 'attachmentRate' | 'giftPackageCount' | 'newMemberCount' | 'mainProductCount' | 'oldMemberAmount' | 'birthMemberAmount' | 'giftPackageAmount';
  type SortDirection = 'asc' | 'desc';
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      // 同一列：切换方向
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      // 新列：默认降序（数字大的在上面更直观）
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

  const loadReports = async (newDateRange?: string) => {
    try {
      setLoading(true);
      setError(null);
      const range = newDateRange || dateRange;
      console.log('Loading reports with dateRange:', range);
      
      let params: Record<string, string> = {};
      if (range === 'custom' && customStartDate && customEndDate) {
        params.startDate = customStartDate;
        params.endDate = customEndDate;
      }
      
      const result = await getSalesReport(range, 'all', user?.groupName || undefined, params);
      console.log('Report data received:', result.data.length, 'records');
      setReports(result.data);
      setTimeProgress(result.timeProgress);
      setHasData(true);
      setPageCache(PAGE_KEY, { reports: result.data, timeProgress: result.timeProgress });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '加载数据失败';
      console.error('Failed to load reports:', errorMessage);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  // 全部区域、督导和店铺（去重排序）
  const allAreas = useMemo(() => {
    const set = new Set(reports.map(r => r.area).filter((a): a is string => !!a));
    return Array.from(set).sort();
  }, [reports]);

  const allSupervisors = useMemo(() => {
    const set = new Set(reports.map(r => r.supervisor).filter(Boolean));
    return Array.from(set).sort();
  }, [reports]);

  const allShops = useMemo(() => {
    const set = new Set(reports.map(r => r.shopName).filter(Boolean));
    return Array.from(set).sort();
  }, [reports]);

  const allWarehouses = useMemo(() => {
    const set = new Set(reports.map(r => r.warehouseType || '').filter(Boolean));
    return Array.from(set).sort();
  }, [reports]);

  const allDistrictManagers = useMemo(() => {
    const set = new Set(reports.map(r => r.districtManager).filter(Boolean));
    return Array.from(set).sort();
  }, [reports]);

  const allDealers = useMemo(() => {
    const set = new Set(reports.map(r => r.dealer || '').filter(Boolean));
    return Array.from(set).sort();
  }, [reports]);

  // 按店铺名从店铺档案取可比性（不依赖报表行是否带该字段）
  const mcOf = (r: { shopName?: string }) => (shopComparableMap[String(r?.shopName || '').trim()] || { mc: '', yc: '' }).mc;
  const ycOf = (r: { shopName?: string }) => (shopComparableMap[String(r?.shopName || '').trim()] || { mc: '', yc: '' }).yc;

  const allMonthComparables = useMemo(() => {
    if (comparableOptions.month.length > 0) return comparableOptions.month;
    const set = new Set(reports.map(r => mcOf(r)).filter(Boolean));
    return Array.from(set).sort();
  }, [reports, comparableOptions.month, shopComparableMap]);

  const allYearComparables = useMemo(() => {
    if (comparableOptions.year.length > 0) return comparableOptions.year;
    const set = new Set(reports.map(r => ycOf(r)).filter(Boolean));
    return Array.from(set).sort();
  }, [reports, comparableOptions.year, shopComparableMap]);

  const availableMonthComparables = useMemo(() => {
    if (selectedAreas.length === 0 && selectedSupervisors.length === 0 && selectedShops.length === 0 && selectedWarehouses.length === 0 && selectedDistrictManagers.length === 0 && selectedDealers.length === 0) return allMonthComparables;
    const filtered = reports.filter(r =>
      (selectedAreas.length === 0 || selectedAreas.includes(r.area || '')) &&
      (selectedSupervisors.length === 0 || selectedSupervisors.includes(r.supervisor)) &&
      (selectedShops.length === 0 || selectedShops.includes(r.shopName)) &&
      (selectedWarehouses.length === 0 || selectedWarehouses.includes(r.warehouseType || '')) &&
      (selectedDistrictManagers.length === 0 || selectedDistrictManagers.includes(r.districtManager)) &&
      (selectedDealers.length === 0 || selectedDealers.includes(r.dealer || ''))
    );
    const set = new Set(filtered.map(r => mcOf(r)).filter(Boolean));
    return Array.from(set).sort();
  }, [reports, allMonthComparables, selectedAreas, selectedSupervisors, selectedShops, selectedWarehouses, selectedDistrictManagers, selectedDealers]);

  const availableYearComparables = useMemo(() => {
    if (selectedAreas.length === 0 && selectedSupervisors.length === 0 && selectedShops.length === 0 && selectedWarehouses.length === 0 && selectedDistrictManagers.length === 0 && selectedDealers.length === 0) return allYearComparables;
    const filtered = reports.filter(r =>
      (selectedAreas.length === 0 || selectedAreas.includes(r.area || '')) &&
      (selectedSupervisors.length === 0 || selectedSupervisors.includes(r.supervisor)) &&
      (selectedShops.length === 0 || selectedShops.includes(r.shopName)) &&
      (selectedWarehouses.length === 0 || selectedWarehouses.includes(r.warehouseType || '')) &&
      (selectedDistrictManagers.length === 0 || selectedDistrictManagers.includes(r.districtManager)) &&
      (selectedDealers.length === 0 || selectedDealers.includes(r.dealer || ''))
    );
    const set = new Set(filtered.map(r => ycOf(r)).filter(Boolean));
    return Array.from(set).sort();
  }, [reports, allYearComparables, selectedAreas, selectedSupervisors, selectedShops, selectedWarehouses, selectedDistrictManagers, selectedDealers]);

  // 联动可选区域：选了督导/店铺/仓库时，只显示对应的区域
  const availableAreas = useMemo(() => {
    if (selectedSupervisors.length === 0 && selectedShops.length === 0 && selectedWarehouses.length === 0 && selectedMonthComparables.length === 0 && selectedYearComparables.length === 0) return allAreas;
    const filtered = reports.filter(r =>
      (selectedSupervisors.length === 0 || selectedSupervisors.includes(r.supervisor)) &&
      (selectedShops.length === 0 || selectedShops.includes(r.shopName)) &&
      (selectedWarehouses.length === 0 || selectedWarehouses.includes(r.warehouseType || '')) &&
      (selectedMonthComparables.length === 0 || selectedMonthComparables.includes(mcOf(r))) &&
      (selectedYearComparables.length === 0 || selectedYearComparables.includes(ycOf(r)))
    );
    const set = new Set(filtered.map(r => r.area).filter((a): a is string => !!a));
    return Array.from(set).sort();
  }, [reports, allAreas, selectedSupervisors, selectedShops, selectedWarehouses, selectedMonthComparables, selectedYearComparables, shopComparableMap]);

  // 联动可选督导：选了区域/店铺/仓库时，只显示对应的督导
  const availableSupervisors = useMemo(() => {
    if (selectedAreas.length === 0 && selectedShops.length === 0 && selectedWarehouses.length === 0 && selectedMonthComparables.length === 0 && selectedYearComparables.length === 0) return allSupervisors;
    const filtered = reports.filter(r =>
      (selectedAreas.length === 0 || selectedAreas.includes(r.area || '')) &&
      (selectedShops.length === 0 || selectedShops.includes(r.shopName)) &&
      (selectedWarehouses.length === 0 || selectedWarehouses.includes(r.warehouseType || '')) &&
      (selectedMonthComparables.length === 0 || selectedMonthComparables.includes(mcOf(r))) &&
      (selectedYearComparables.length === 0 || selectedYearComparables.includes(ycOf(r)))
    );
    const set = new Set(filtered.map(r => r.supervisor).filter(Boolean));
    return Array.from(set).sort();
  }, [reports, allSupervisors, selectedAreas, selectedShops, selectedWarehouses, selectedMonthComparables, selectedYearComparables, shopComparableMap]);

  // 联动可选店铺：选了区域/督导/仓库时，只显示对应的店铺
  const availableShops = useMemo(() => {
    if (selectedAreas.length === 0 && selectedSupervisors.length === 0 && selectedWarehouses.length === 0 && selectedMonthComparables.length === 0 && selectedYearComparables.length === 0) return allShops;
    const filtered = reports.filter(r =>
      (selectedAreas.length === 0 || selectedAreas.includes(r.area || '')) &&
      (selectedSupervisors.length === 0 || selectedSupervisors.includes(r.supervisor)) &&
      (selectedWarehouses.length === 0 || selectedWarehouses.includes(r.warehouseType || '')) &&
      (selectedMonthComparables.length === 0 || selectedMonthComparables.includes(mcOf(r))) &&
      (selectedYearComparables.length === 0 || selectedYearComparables.includes(ycOf(r)))
    );
    const set = new Set(filtered.map(r => r.shopName).filter(Boolean));
    return Array.from(set).sort();
  }, [reports, allShops, selectedAreas, selectedSupervisors, selectedWarehouses, selectedMonthComparables, selectedYearComparables, shopComparableMap]);

  // 联动可选仓库：选了区域/督导/店铺时，只显示对应的仓库类别
  const availableWarehouses = useMemo(() => {
    if (selectedAreas.length === 0 && selectedSupervisors.length === 0 && selectedShops.length === 0 && selectedMonthComparables.length === 0 && selectedYearComparables.length === 0) return allWarehouses;
    const filtered = reports.filter(r =>
      (selectedAreas.length === 0 || selectedAreas.includes(r.area || '')) &&
      (selectedSupervisors.length === 0 || selectedSupervisors.includes(r.supervisor)) &&
      (selectedShops.length === 0 || selectedShops.includes(r.shopName)) &&
      (selectedMonthComparables.length === 0 || selectedMonthComparables.includes(mcOf(r))) &&
      (selectedYearComparables.length === 0 || selectedYearComparables.includes(ycOf(r)))
    );
    const set = new Set(filtered.map(r => r.warehouseType || '').filter(Boolean));
    return Array.from(set).sort();
  }, [reports, allWarehouses, selectedAreas, selectedSupervisors, selectedShops, selectedMonthComparables, selectedYearComparables, shopComparableMap]);

  // 联动可选区经：按其他已选条件收敛
  const availableDistrictManagers = useMemo(() => {
    const filtered = reports.filter(r =>
      (selectedAreas.length === 0 || selectedAreas.includes(r.area || '')) &&
      (selectedSupervisors.length === 0 || selectedSupervisors.includes(r.supervisor)) &&
      (selectedShops.length === 0 || selectedShops.includes(r.shopName)) &&
      (selectedWarehouses.length === 0 || selectedWarehouses.includes(r.warehouseType || '')) &&
      (selectedDealers.length === 0 || selectedDealers.includes(r.dealer || '')) &&
      (selectedMonthComparables.length === 0 || selectedMonthComparables.includes(mcOf(r))) &&
      (selectedYearComparables.length === 0 || selectedYearComparables.includes(ycOf(r)))
    );
    const set = new Set(filtered.map(r => r.districtManager).filter(Boolean));
    return Array.from(set).sort();
  }, [reports, selectedAreas, selectedSupervisors, selectedShops, selectedWarehouses, selectedDealers, selectedMonthComparables, selectedYearComparables, shopComparableMap]);

  // 联动可选经销商
  const availableDealers = useMemo(() => {
    const filtered = reports.filter(r =>
      (selectedAreas.length === 0 || selectedAreas.includes(r.area || '')) &&
      (selectedSupervisors.length === 0 || selectedSupervisors.includes(r.supervisor)) &&
      (selectedShops.length === 0 || selectedShops.includes(r.shopName)) &&
      (selectedWarehouses.length === 0 || selectedWarehouses.includes(r.warehouseType || '')) &&
      (selectedDistrictManagers.length === 0 || selectedDistrictManagers.includes(r.districtManager)) &&
      (selectedMonthComparables.length === 0 || selectedMonthComparables.includes(mcOf(r))) &&
      (selectedYearComparables.length === 0 || selectedYearComparables.includes(ycOf(r)))
    );
    const set = new Set(filtered.map(r => r.dealer || '').filter(Boolean));
    return Array.from(set).sort();
  }, [reports, selectedAreas, selectedSupervisors, selectedShops, selectedWarehouses, selectedDistrictManagers, selectedMonthComparables, selectedYearComparables, shopComparableMap]);

  const filteredReports = useMemo(() => {
    let result = [...reports];
    
    if (selectedAreas.length > 0) {
      result = result.filter(r => selectedAreas.includes(r.area || ''));
    }
    
    if (selectedSupervisors.length > 0) {
      result = result.filter(r => selectedSupervisors.includes(r.supervisor));
    }
    
    if (selectedShops.length > 0) {
      result = result.filter(r => selectedShops.includes(r.shopName));
    }

    if (selectedWarehouses.length > 0) {
      result = result.filter(r => selectedWarehouses.includes(r.warehouseType || ''));
    }

    if (selectedDistrictManagers.length > 0) {
      result = result.filter(r => selectedDistrictManagers.includes(r.districtManager));
    }

    if (selectedDealers.length > 0) {
      result = result.filter(r => selectedDealers.includes(r.dealer || ''));
    }

    if (selectedMonthComparables.length > 0) {
      result = result.filter(r => selectedMonthComparables.includes(mcOf(r)));
    }

    if (selectedYearComparables.length > 0) {
      result = result.filter(r => selectedYearComparables.includes(ycOf(r)));
    }

    // 搜索：匹配督导/区经/店铺名称关键词
    if (searchText.trim()) {
      const kw = searchText.trim().toLowerCase();
      result = result.filter(r =>
        (r.supervisor || '').toLowerCase().includes(kw) ||
        (r.districtManager || '').toLowerCase().includes(kw) ||
        (r.shopName || '').toLowerCase().includes(kw)
      );
    }

    // 排序
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
  }, [reports, selectedAreas, selectedSupervisors, selectedShops, selectedWarehouses, sortKey, sortDirection, searchText, selectedMonthComparables, selectedYearComparables, shopComparableMap]);

  const handleRefresh = () => {
    clearPageCache(PAGE_KEY);
    loadReports();
  };

  // 切换区域选中（多选），联动清理督导和店铺
  const toggleArea = (area: string) => {
    setSelectedAreas(prev => {
      const next = prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area];
      const validSups = new Set(
        next.length > 0
          ? reports.filter(r => next.includes(r.area || '')).map(r => r.supervisor)
          : []
      );
      setSelectedSupervisors(sups => sups.filter(sup => validSups.has(sup)));
      const validShops = new Set(
        next.length > 0
          ? reports.filter(r => next.includes(r.area || '')).map(r => r.shopName)
          : []
      );
      setSelectedShops(shops => shops.filter(shop => validShops.has(shop)));
      return next;
    });
    setCurrentPage(1);
  };

  // 切换督导选中（多选），联动清理区域和店铺
  const toggleSupervisor = (sup: string) => {
    setSelectedSupervisors(prev => {
      const next = prev.includes(sup) ? prev.filter(s => s !== sup) : [...prev, sup];
      const validShops = new Set(
        next.length > 0
          ? reports.filter(r => next.includes(r.supervisor)).map(r => r.shopName)
          : []
      );
      setSelectedShops(shops => shops.filter(shop => validShops.has(shop)));
      const validAreas = new Set(
        next.length > 0
          ? reports.filter(r => next.includes(r.supervisor)).map(r => r.area)
          : []
      );
      setSelectedAreas(areas => areas.filter(a => validAreas.has(a)));
      return next;
    });
    setCurrentPage(1);
  };

  // 切换店铺选中（多选），联动清理区域和督导
  const toggleShop = (shop: string) => {
    setSelectedShops(prev => {
      const next = prev.includes(shop) ? prev.filter(s => s !== shop) : [...prev, shop];
      const validSups = new Set(
        next.length > 0
          ? reports.filter(r => next.includes(r.shopName)).map(r => r.supervisor)
          : []
      );
      setSelectedSupervisors(sups => sups.filter(sup => validSups.has(sup)));
      const validAreas = new Set(
        next.length > 0
          ? reports.filter(r => next.includes(r.shopName)).map(r => r.area)
          : []
      );
      setSelectedAreas(areas => areas.filter(a => validAreas.has(a)));
      return next;
    });
    setCurrentPage(1);
  };

  const handleFilterAll = () => {
    setSelectedAreas([]);
    setSelectedSupervisors([]);
    setSelectedShops([]);
    setSelectedWarehouses([]);
    setSelectedDistrictManagers([]);
    setSelectedDealers([]);
    setSelectedMonthComparables([]);
    setSelectedYearComparables([]);
    setShowAreaPanel(false);
    setShowSupervisorPanel(false);
    setShowShopPanel(false);
    setShowWarehousePanel(false);
    setShowDistrictManagerPanel(false);
    setShowDealerPanel(false);
    setShowMonthComparablePanel(false);
    setShowYearComparablePanel(false);
    setCurrentPage(1);
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

  const handleCustomDateChange = () => {
    if (customStartDate && customEndDate) {
      setDateRange('custom');
      loadReports('custom');
    }
  };
  const handleDateRangeChange = (newDateRange: string) => {
    console.log('Date range changed to:', newDateRange);
    setDateRange(newDateRange);
    loadReports(newDateRange);
  };

  const totalAmount = filteredReports.reduce((sum, r) => sum + r.amount, 0);
  const totalTarget = filteredReports.reduce((sum, r) => sum + (r.target || 0), 0);
  const totalSameAmount = filteredReports.reduce((sum, r) => sum + (r.sameAmount || 0), 0);
  const totalQuantity = Math.round(filteredReports.reduce((sum, r) => sum + r.quantity, 0));
  const totalOrderCount = filteredReports.reduce((sum, r) => sum + (r.orderCount || 0), 0);
const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;
  const totalPages = Math.ceil(filteredReports.length / pageSize);
  const paginatedReports = filteredReports.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const formatCurrency = (value: number): string => `${value.toLocaleString('zh-CN', { useGrouping: false })}`;

  const exportExcel = () => {
    const rows: any[][] = [[
      '区经', '督导', '店铺名称', '仓库类别', '业绩目标', '业绩金额', '业绩达成', '同期金额', '同比', '销售数量', '开单数',
      '客单价', '件单价', '连带率', '礼包数', '新增会员', '主推数量', '老会员贡献', '生日会员', '礼包额'
    ]];
    filteredReports.forEach(r => {
      const same = r.sameAmount || 0;
      const tbP = same > 0 ? (((r.amount - same) / same) * 100).toFixed(1) + '%' : '-';
      rows.push([
        r.districtManager, r.supervisor, r.shopName, r.warehouseType || '', r.target,
        Math.round(r.amount), r.achievement.toFixed(1) + '%', Math.round(same), tbP, r.quantity, r.orderCount || 0,
        (r.avgOrderValue || 0).toFixed(0), (r.avgItemPrice || 0).toFixed(0),
        (r.attachmentRate || 0).toFixed(2), r.giftPackageCount || 0,
        r.newMemberCount || 0, r.mainProductCount || 0,
        r.oldMemberAmount ? Math.round(r.oldMemberAmount) : 0,
        r.birthMemberAmount ? Math.round(r.birthMemberAmount) : 0,
        Math.round(r.giftPackageAmount || 0)
      ]);
    });
    const totalOldMember = Math.round(filteredReports.reduce((s, r) => s + (r.oldMemberAmount || 0), 0));
    const totalBirthMember = Math.round(filteredReports.reduce((s, r) => s + (r.birthMemberAmount || 0), 0));
    rows.push(['合计', '', '', '', totalTarget, Math.round(totalAmount),
      totalTarget > 0 ? ((totalAmount / totalTarget) * 100).toFixed(1) + '%' : '0%',
      Math.round(totalSameAmount),
      totalSameAmount > 0 ? (((totalAmount - totalSameAmount) / totalSameAmount) * 100).toFixed(1) + '%' : '-',
      totalQuantity, totalOrderCount || 0, '', '', '', '',
      filteredReports.reduce((s, r) => s + (r.newMemberCount || 0), 0),
      filteredReports.reduce((s, r) => s + (r.mainProductCount || 0), 0),
      totalOldMember, totalBirthMember,
      Math.round(filteredReports.reduce((s, r) => s + (r.giftPackageAmount || 0), 0))
    ]);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '销售报表');
    XLSX.writeFile(wb, `销售报表_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportPDF = async () => {
    const el = document.querySelector('.report-table-container') as HTMLElement;
    if (!el) return;
    const canvas = await html2canvas(el, { scale: 1.5, backgroundColor: '#fff', useCORS: true, allowTaint: true, logging: false });
    const img = canvas.toDataURL('image/jpeg', 0.92);
    const pdf = new jsPDF('l', 'mm', 'a4');
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const ratio = pw / canvas.width;
    const imgH = canvas.height * ratio;
    let pos = 0;
    pdf.addImage(img, 'JPEG', 0, pos, pw, imgH);
    let remaining = imgH - ph;
    while (remaining > 0) { pos -= ph; pdf.addPage(); pdf.addImage(img, 'JPEG', 0, pos, pw, imgH); remaining -= ph; }
    pdf.save(`销售报表_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const getAchievementColor = (achievement: number, timeProgress: number) => {
    if (achievement >= timeProgress) {
      return 'bg-green-100 text-green-600';
    } else if (achievement >= timeProgress * 0.5) {
      return 'bg-red-100 text-red-600';
    } else {
      return 'bg-red-900 text-red-100';
    }
  };

  return (
    <Layout title="销售报表" subtitle="查看各店铺销售数据">
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <p className="text-red-600">数据加载失败: {error}</p>
            <button
              onClick={() => loadReports()}
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
              <div className="flex items-center gap-2 relative">
                <Filter className="w-5 h-5 text-gray-400" />
                <button
                  onClick={() => { setShowAreaPanel(v => !v); setShowSupervisorPanel(false); setShowShopPanel(false); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedAreas.length > 0 ? 'bg-primary text-white' : selectedSupervisors.length === 0 && selectedShops.length === 0 ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
                >
                  {selectedAreas.length > 0 ? `区域(${selectedAreas.length})` : '全部'}
                </button>
                <button
                  onClick={() => { setShowSupervisorPanel(v => !v); setShowAreaPanel(false); setShowShopPanel(false); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedSupervisors.length > 0 ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
                >
                  本区{selectedSupervisors.length > 0 ? `(${selectedSupervisors.length})` : ''}
                </button>
                <button
                  onClick={() => { setShowShopPanel(v => !v); setShowAreaPanel(false); setShowSupervisorPanel(false); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedShops.length > 0 ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
                >
                  本店{selectedShops.length > 0 ? `(${selectedShops.length})` : ''}
                </button>
                <button
                  onClick={() => { setShowWarehousePanel(v => !v); setShowAreaPanel(false); setShowSupervisorPanel(false); setShowShopPanel(false); setShowDistrictManagerPanel(false); setShowDealerPanel(false); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedWarehouses.length > 0 ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
                >
                  仓库{selectedWarehouses.length > 0 ? `(${selectedWarehouses.length})` : ''}
                </button>
                <button
                  onClick={() => { setShowDistrictManagerPanel(v => !v); setShowAreaPanel(false); setShowSupervisorPanel(false); setShowShopPanel(false); setShowWarehousePanel(false); setShowDealerPanel(false); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedDistrictManagers.length > 0 ? 'bg-primary text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  区经{selectedDistrictManagers.length > 0 ? `(${selectedDistrictManagers.length})` : ''}
                </button>
                <button
                  onClick={() => { setShowDealerPanel(v => !v); setShowAreaPanel(false); setShowSupervisorPanel(false); setShowShopPanel(false); setShowWarehousePanel(false); setShowDistrictManagerPanel(false); }}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${selectedDealers.length > 0 ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
                >
                  经销商{selectedDealers.length > 0 ? `(${selectedDealers.length})` : ''}
                </button>
                <button
                  onClick={() => { setShowMonthComparablePanel(v => !v); setShowAreaPanel(false); setShowSupervisorPanel(false); setShowShopPanel(false); setShowWarehousePanel(false); setShowDistrictManagerPanel(false); setShowDealerPanel(false); setShowYearComparablePanel(false); }}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${selectedMonthComparables.length > 0 ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
                >
                  月可比{selectedMonthComparables.length > 0 ? `(${selectedMonthComparables.length})` : ''}
                </button>
                <button
                  onClick={() => { setShowYearComparablePanel(v => !v); setShowAreaPanel(false); setShowSupervisorPanel(false); setShowShopPanel(false); setShowWarehousePanel(false); setShowDistrictManagerPanel(false); setShowDealerPanel(false); setShowMonthComparablePanel(false); }}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${selectedYearComparables.length > 0 ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
                >
                  年可比{selectedYearComparables.length > 0 ? `(${selectedYearComparables.length})` : ''}
                </button>

                {(showAreaPanel || showSupervisorPanel || showShopPanel || showWarehousePanel || showDistrictManagerPanel || showDealerPanel || showMonthComparablePanel || showYearComparablePanel) && (
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => { setShowAreaPanel(false); setShowSupervisorPanel(false); setShowShopPanel(false); setShowWarehousePanel(false); setShowDistrictManagerPanel(false); setShowDealerPanel(false); setShowMonthComparablePanel(false); setShowYearComparablePanel(false); }}
                  />
                )}

                {showAreaPanel && (
                  <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3 min-w-[220px] max-h-72 overflow-auto">
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
                      <span className="text-xs text-gray-500">选择区域（{availableAreas.length}）</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            const next = [...availableAreas];
                            const validSups = new Set(reports.filter(r => next.includes(r.area || '')).map(r => r.supervisor));
                            setSelectedAreas(next);
                            setSelectedSupervisors(sups => sups.filter(sup => validSups.has(sup)));
                            const validShops = new Set(reports.filter(r => next.includes(r.area || '')).map(r => r.shopName));
                            setSelectedShops(shops => shops.filter(shop => validShops.has(shop)));
                            setCurrentPage(1);
                          }}
                          className="text-xs text-primary hover:underline"
                        >
                          全选
                        </button>
                        <button
                          onClick={() => { setSelectedAreas([]); setSelectedSupervisors([]); setSelectedShops([]); setCurrentPage(1); }}
                          className="text-xs text-gray-400 hover:underline"
                        >
                          清空
                        </button>
                      </div>
                    </div>
                    {availableAreas.length === 0 ? (
                      <p className="text-xs text-gray-400 py-2 text-center">无可选区域</p>
                    ) : (
                      availableAreas.map(area => (
                        <label key={area} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedAreas.includes(area)}
                            onChange={() => toggleArea(area)}
                            className="w-4 h-4 accent-primary"
                          />
                          <span className="text-sm text-gray-700">{area}</span>
                        </label>
                      ))
                    )}
                  </div>
                )}

                {showSupervisorPanel && (
                  <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3 min-w-[220px] max-h-72 overflow-auto">
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
                      <span className="text-xs text-gray-500">选择督导（{availableSupervisors.length}）</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            const next = [...availableSupervisors];
                            const validShops = new Set(reports.filter(r => next.includes(r.supervisor)).map(r => r.shopName));
                            setSelectedSupervisors(next);
                            setSelectedShops(shops => shops.filter(shop => validShops.has(shop)));
                            const validAreas = new Set(reports.filter(r => next.includes(r.supervisor)).map(r => r.area));
                            setSelectedAreas(areas => areas.filter(a => validAreas.has(a)));
                            setCurrentPage(1);
                          }}
                          className="text-xs text-primary hover:underline"
                        >
                          全选
                        </button>
                        <button
                          onClick={() => { setSelectedSupervisors([]); setSelectedShops([]); setSelectedAreas([]); setCurrentPage(1); }}
                          className="text-xs text-gray-400 hover:underline"
                        >
                          清空
                        </button>
                      </div>
                    </div>
                    {availableSupervisors.length === 0 ? (
                      <p className="text-xs text-gray-400 py-2 text-center">无可选督导</p>
                    ) : (
                      availableSupervisors.map(sup => (
                        <label key={sup} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedSupervisors.includes(sup)}
                            onChange={() => toggleSupervisor(sup)}
                            className="w-4 h-4 accent-primary"
                          />
                          <span className="text-sm text-gray-700">{sup}</span>
                        </label>
                      ))
                    )}
                  </div>
                )}

                {showShopPanel && (
                  <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3 min-w-[220px] max-h-72 overflow-auto">
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
                      <span className="text-xs text-gray-500">选择店铺（{availableShops.length}）</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            const next = [...availableShops];
                            const validSups = new Set(reports.filter(r => next.includes(r.shopName)).map(r => r.supervisor));
                            setSelectedShops(next);
                            setSelectedSupervisors(sups => sups.filter(sup => validSups.has(sup)));
                            const validAreas = new Set(reports.filter(r => next.includes(r.shopName)).map(r => r.area));
                            setSelectedAreas(areas => areas.filter(a => validAreas.has(a)));
                            setCurrentPage(1);
                          }}
                          className="text-xs text-primary hover:underline"
                        >
                          全选
                        </button>
                        <button
                          onClick={() => { setSelectedShops([]); setSelectedSupervisors([]); setSelectedAreas([]); setCurrentPage(1); }}
                          className="text-xs text-gray-400 hover:underline"
                        >
                          清空
                        </button>
                      </div>
                    </div>
                    {availableShops.length === 0 ? (
                      <p className="text-xs text-gray-400 py-2 text-center">无可选店铺</p>
                    ) : (
                      availableShops.map(shop => (
                        <label key={shop} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedShops.includes(shop)}
                            onChange={() => toggleShop(shop)}
                            className="w-4 h-4 accent-primary"
                          />
                          <span className="text-sm text-gray-700">{shop}</span>
                        </label>
                      ))
                    )}
                  </div>
                )}
                {showWarehousePanel && (
                  <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3 min-w-[180px]">
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
                      <span className="text-xs text-gray-500">仓库类别</span>
                      <div className="flex gap-2">
                        <button onClick={() => { setSelectedWarehouses([...availableWarehouses]); setCurrentPage(1); }} className="text-xs text-primary hover:underline">全选</button>
                        <button onClick={() => { setSelectedWarehouses([]); setCurrentPage(1); }} className="text-xs text-gray-400 hover:underline">清空</button>
                      </div>
                    </div>
                    {availableWarehouses.map(wh => (
                      <label key={wh} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                        <input type="checkbox" checked={selectedWarehouses.includes(wh)}
                          onChange={() => { setSelectedWarehouses(prev => prev.includes(wh) ? prev.filter(w => w !== wh) : [...prev, wh]); setCurrentPage(1); }}
                          className="w-4 h-4 accent-primary"
                        />
                        <span className="text-sm text-gray-700">{wh}</span>
                      </label>
                    ))}
                  </div>
                )}

                {showDistrictManagerPanel && (
                  <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3 min-w-[180px]">
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
                      <span className="text-xs text-gray-500">区经</span>
                      <div className="flex gap-2">
                        <button onClick={() => { setSelectedDistrictManagers([...availableDistrictManagers]); setCurrentPage(1); }} className="text-xs text-primary hover:underline">全选</button>
                        <button onClick={() => { setSelectedDistrictManagers([]); setCurrentPage(1); }} className="text-xs text-gray-400 hover:underline">清空</button>
                      </div>
                    </div>
                    {availableDistrictManagers.length === 0 ? (
                      <p className="text-xs text-gray-400 py-2 text-center">无可选区经</p>
                    ) : availableDistrictManagers.map(dm => (
                      <label key={dm} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                        <input type="checkbox" checked={selectedDistrictManagers.includes(dm)}
                          onChange={() => { setSelectedDistrictManagers(prev => prev.includes(dm) ? prev.filter(x => x !== dm) : [...prev, dm]); setCurrentPage(1); }}
                          className="w-4 h-4 accent-primary"
                        />
                        <span className="text-sm text-gray-700">{dm}</span>
                      </label>
                    ))}
                  </div>
                )}

                {showDealerPanel && (
                  <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3 min-w-[180px]">
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
                      <span className="text-xs text-gray-500">经销商</span>
                      <div className="flex gap-2">
                        <button onClick={() => { setSelectedDealers([...availableDealers]); setCurrentPage(1); }} className="text-xs text-primary hover:underline">全选</button>
                        <button onClick={() => { setSelectedDealers([]); setCurrentPage(1); }} className="text-xs text-gray-400 hover:underline">清空</button>
                      </div>
                    </div>
                    {availableDealers.length === 0 ? (
                      <p className="text-xs text-gray-400 py-2 text-center">无经销商</p>
                    ) : availableDealers.map(dl => (
                      <label key={dl} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                        <input type="checkbox" checked={selectedDealers.includes(dl)}
                          onChange={() => { setSelectedDealers(prev => prev.includes(dl) ? prev.filter(x => x !== dl) : [...prev, dl]); setCurrentPage(1); }}
                          className="w-4 h-4 accent-primary"
                        />
                        <span className="text-sm text-gray-700">{dl}</span>
                      </label>
                    ))}
                  </div>
                )}

                {showMonthComparablePanel && (
                  <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3 min-w-[180px]">
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
                      <span className="text-xs text-gray-500">月可比性（{availableMonthComparables.length}）</span>
                      <div className="flex gap-2">
                        <button onClick={() => { setSelectedMonthComparables([...availableMonthComparables]); setCurrentPage(1); }} className="text-xs text-primary hover:underline">全选</button>
                        <button onClick={() => { setSelectedMonthComparables([]); setCurrentPage(1); }} className="text-xs text-gray-400 hover:underline">清空</button>
                      </div>
                    </div>
                    {availableMonthComparables.length === 0 ? (
                      <p className="text-xs text-gray-400 py-2 text-center">无月可比性</p>
                    ) : availableMonthComparables.map(v => (
                      <label key={v} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                        <input type="checkbox" checked={selectedMonthComparables.includes(v)}
                          onChange={() => { setSelectedMonthComparables(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]); setCurrentPage(1); }}
                          className="w-4 h-4 accent-primary"
                        />
                        <span className="text-sm text-gray-700">{v}</span>
                      </label>
                    ))}
                  </div>
                )}

                {showYearComparablePanel && (
                  <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3 min-w-[180px]">
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
                      <span className="text-xs text-gray-500">年可比性（{availableYearComparables.length}）</span>
                      <div className="flex gap-2">
                        <button onClick={() => { setSelectedYearComparables([...availableYearComparables]); setCurrentPage(1); }} className="text-xs text-primary hover:underline">全选</button>
                        <button onClick={() => { setSelectedYearComparables([]); setCurrentPage(1); }} className="text-xs text-gray-400 hover:underline">清空</button>
                      </div>
                    </div>
                    {availableYearComparables.length === 0 ? (
                      <p className="text-xs text-gray-400 py-2 text-center">无年可比性</p>
                    ) : availableYearComparables.map(v => (
                      <label key={v} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                        <input type="checkbox" checked={selectedYearComparables.includes(v)}
                          onChange={() => { setSelectedYearComparables(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]); setCurrentPage(1); }}
                          className="w-4 h-4 accent-primary"
                        />
                        <span className="text-sm text-gray-700">{v}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => loadReports()}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-1.5 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
              >
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                <span className="text-sm">刷新数据</span>
              </button>
              <button onClick={exportExcel} className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"><FileSpreadsheet size={16} />导出Excel</button>
              <button onClick={exportPDF} className="flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"><FileText size={16} />导出PDF</button>
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
        ) : reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[400px]">
            <p className="text-xl text-gray-500">暂无数据，请点击"刷新数据"按钮加载数据</p>
          </div>
        ) : (
          <div className="w-full">

        <div className="grid grid-cols-7 gap-4 mb-6 mt-4 px-6">
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
                <p className="text-sm text-gray-500">目标完成</p>
                <p className="text-2xl font-bold text-gray-800 mt-1">
                  {totalTarget > 0 ? ((totalAmount / totalTarget) * 100).toFixed(1) : '0'}%
                </p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-green-500" />
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
                  ¥{filteredReports.length > 0 ? Math.round(totalAmount / filteredReports.length).toLocaleString('zh-CN', { useGrouping: false }) : 0}
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
                <p className="text-2xl font-bold text-gray-800 mt-1">{filteredReports.length}</p>
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

        <div className="mx-6 bg-white rounded-xl shadow-sm overflow-hidden report-table-container table-row-compact">
          <div className="max-h-[140vh] overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 z-20">
                <tr className="bg-gray-50">
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 sticky left-0 z-30 bg-gray-50 whitespace-nowrap">
                    仓库类别
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 sticky left-[70px] z-30 bg-gray-50 whitespace-nowrap">
                    <button onClick={() => handleSort('districtManager')} className="flex items-center gap-1 hover:text-primary transition-colors">
                      区经 {getSortIcon('districtManager')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 sticky left-[160px] z-30 bg-gray-50 whitespace-nowrap">
                    <button onClick={() => handleSort('supervisor')} className="flex items-center gap-1 hover:text-primary transition-colors">
                      督导 {getSortIcon('supervisor')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 sticky left-[240px] z-30 bg-gray-50 whitespace-nowrap">
                    <button onClick={() => handleSort('shopName')} className="flex items-center gap-1 hover:text-primary transition-colors">
                      店铺名称 {getSortIcon('shopName')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('target')} className="inline-flex items-center gap-1 hover:text-primary transition-colors ml-auto">
                      业绩目标 {getSortIcon('target')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('amount')} className="inline-flex items-center gap-1 hover:text-primary transition-colors ml-auto">
                      业绩金额 {getSortIcon('amount')}
                    </button>
                  </th>
<th className="px-4 py-3 text-right text-sm font-medium text-gray-600 whitespace-nowrap">
                    同期金额
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('achievement')} className="inline-flex items-center gap-1 hover:text-primary transition-colors ml-auto">
                      业绩达成 {getSortIcon('achievement')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 whitespace-nowrap">
                    同比
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
                    <button onClick={() => handleSort('newMemberCount')} className="inline-flex items-center gap-1 hover:text-primary transition-colors ml-auto">
                      新增会员 {getSortIcon('newMemberCount')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('mainProductCount')} className="inline-flex items-center gap-1 hover:text-primary transition-colors ml-auto">
                      主推数量 {getSortIcon('mainProductCount')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('oldMemberAmount')} className="inline-flex items-center gap-1 hover:text-primary transition-colors ml-auto">
                      老会员贡献 {getSortIcon('oldMemberAmount')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('birthMemberAmount')} className="inline-flex items-center gap-1 hover:text-primary transition-colors ml-auto">
                      生日会员 {getSortIcon('birthMemberAmount')}
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
                {loading ? (
                  <tr>
                    <td colSpan={18} className="px-6 py-8 text-center text-gray-400">
                      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      <p>加载中...</p>
                    </td>
                  </tr>
                ) : filteredReports.length === 0 ? (
                  <tr>
                    <td colSpan={18} className="px-6 py-8 text-center text-gray-400">
                      暂无数据，请点击"刷新数据"按钮加载数据
                    </td>
                  </tr>
                ) : (
                  <>
                    {paginatedReports.map((report, index) => (
                      <tr key={index} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-gray-600 sticky left-0 z-10 bg-white hover:bg-gray-50 whitespace-nowrap">{report.warehouseType || '-'}</td>
                        <td className="px-4 py-3 text-gray-600 sticky left-[70px] z-10 bg-white hover:bg-gray-50 whitespace-nowrap">{report.districtManager}</td>
                        <td className="px-4 py-3 text-gray-600 sticky left-[160px] z-10 bg-white hover:bg-gray-50 whitespace-nowrap">{report.supervisor}</td>
                        <td className="px-4 py-3 text-gray-800 font-medium sticky left-[240px] z-10 bg-white hover:bg-gray-50 whitespace-nowrap">{report.shopName}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(report.target || 0)}</td>
<td className="px-4 py-3 text-right text-gray-800 font-medium">{formatCurrency(Math.round(report.amount))}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(Math.round(report.sameAmount || 0))}</td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={`px-2 py-1 text-xs rounded-full font-medium ${getAchievementColor(report.achievement, report.timeProgress || timeProgress)}`}
                          >
                            {report.achievement.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {(() => {
                            const same = report.sameAmount || 0;
                            const cur = report.amount;
                            if (same <= 0) return <span className="text-gray-400">-</span>;
                            const growth = ((cur - same) / same) * 100;
                            return <span className="font-medium" style={{ color: growth >= 0 ? '#16a34a' : '#dc2626' }}>{growth.toFixed(1)}%</span>;
                          })()}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">{Math.round(report.quantity)}件</td>
                        <td className="px-4 py-3 text-right text-gray-600">{report.orderCount || 0}</td>
                        <td className="px-4 py-3 text-right text-gray-600">¥{report.avgOrderValue.toFixed(1)}</td>
                        <td className="px-4 py-3 text-right text-gray-600">¥{report.avgItemPrice.toFixed(1)}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{report.attachmentRate.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{report.giftPackageCount}个</td>
                        <td className="px-4 py-3 text-right text-gray-600">{report.newMemberCount || 0}人</td>
                        <td className="px-4 py-3 text-right text-gray-600">{report.mainProductCount || 0}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{report.oldMemberAmount ? formatCurrency(Math.round(report.oldMemberAmount)) : '-'}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{report.birthMemberAmount ? formatCurrency(Math.round(report.birthMemberAmount)) : '-'}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(Math.round(report.giftPackageAmount))}</td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50 font-bold">
                      <td className="px-4 py-3 text-gray-800 sticky left-0 z-10 bg-gray-50 whitespace-nowrap">总计</td>
                      <td className="px-4 py-3 text-gray-800 sticky left-[70px] z-10 bg-gray-50 whitespace-nowrap">-</td>
                      <td className="px-4 py-3 text-gray-800 sticky left-[160px] z-10 bg-gray-50 whitespace-nowrap">-</td>
                      <td className="px-4 py-3 text-gray-800 sticky left-[240px] z-10 bg-gray-50 whitespace-nowrap">{filteredReports.length}家店铺</td>
                      <td className="px-4 py-3 text-right text-gray-800">{formatCurrency(totalTarget)}</td>
<td className="px-4 py-3 text-right text-gray-800">{formatCurrency(Math.round(totalAmount))}</td>
                      <td className="px-4 py-3 text-right text-gray-800">{formatCurrency(Math.round(totalSameAmount))}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`px-2 py-1 text-xs rounded-full font-medium ${totalTarget > 0 ? ((totalAmount / totalTarget) * 100 >= timeProgress ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600') : 'bg-gray-100 text-gray-600'}`}>
                          {totalTarget > 0 ? ((totalAmount / totalTarget) * 100).toFixed(1) : '0'}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {(() => {
                          if (totalSameAmount <= 0) return <span className="text-gray-400">-</span>;
                          const growth = ((totalAmount - totalSameAmount) / totalSameAmount) * 100;
                          return <span className="font-bold" style={{ color: growth >= 0 ? '#16a34a' : '#dc2626' }}>{growth.toFixed(1)}%</span>;
                        })()}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-800">{totalQuantity}件</td>
                      <td className="px-4 py-3 text-right text-gray-800">{totalOrderCount}</td>
                      <td className="px-4 py-3 text-right text-gray-800">¥{(totalOrderCount > 0 ? (totalAmount / totalOrderCount).toFixed(1) : '0.0')}</td>
                      <td className="px-4 py-3 text-right text-gray-800">¥{(totalQuantity > 0 ? (totalAmount / totalQuantity).toFixed(1) : '0.0')}</td>
                      <td className="px-4 py-3 text-right text-gray-800">{(totalQuantity / totalOrderCount).toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-gray-800">{filteredReports.reduce((sum, r) => sum + (r.giftPackageCount || 0), 0)}个</td>
                      <td className="px-4 py-3 text-right text-gray-800">{filteredReports.reduce((sum, r) => sum + (r.newMemberCount || 0), 0)}人</td>
                      <td className="px-4 py-3 text-right text-gray-800">{filteredReports.reduce((sum, r) => sum + (r.mainProductCount || 0), 0)}</td>
                      <td className="px-4 py-3 text-right text-gray-800">{formatCurrency(Math.round(filteredReports.reduce((sum, r) => sum + (r.oldMemberAmount || 0), 0)))}</td>
                      <td className="px-4 py-3 text-right text-gray-800">{formatCurrency(Math.round(filteredReports.reduce((sum, r) => sum + (r.birthMemberAmount || 0), 0)))}</td>
                      <td className="px-4 py-3 text-right text-gray-800">{formatCurrency(Math.round(filteredReports.reduce((sum, r) => sum + (r.giftPackageAmount || 0), 0)))}</td>
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
              显示 {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, filteredReports.length)} 条，共 {filteredReports.length} 条
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
                  const start = Math.max(2, currentPage - 1);
                  const end = Math.min(totalPages - 1, currentPage + 1);
                  for (let i = start; i <= end; i++) pages.push(i);
                  if (currentPage < totalPages - 2) pages.push('...');
                  pages.push(totalPages);
                }
                return pages.map((page, idx) =>
                  page === '...' ? <span key={'e'+idx} className="px-2 text-gray-400">...</span> :
                  <button key={page} onClick={() => setCurrentPage(page as number)}
                    className={`px-3 py-1 text-sm rounded-lg ${page === currentPage ? 'bg-primary text-white' : 'border border-gray-200 hover:bg-gray-50'}`}>{page}</button>
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
        </div>)}
      </div>
    </Layout>
  );
}

export default ReportPage;
