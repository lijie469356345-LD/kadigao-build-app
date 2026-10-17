import { useState, useEffect, useMemo } from 'react';
import { RefreshCw, FileSpreadsheet, FileText, Plus, Trash2, Lock, Save, Send, Unlock } from 'lucide-react';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';
import { getSalesReport } from '../../api/reports';
import type { SalesReport } from '../../types';
import axios from '../../api/axios';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface WorkItem { time: string; category: string; content: string; dueDate: string; summary: string; feedback: string; penalty: string; followUp: string; _locked?: boolean; }
const emptyWI: WorkItem = { time: '', category: '', content: '', dueDate: '', summary: '', feedback: '', penalty: '', followUp: '', _locked: false };

type GroupRow = {
  leader: string; product: string; shopCount: number;
  perfTarget: number; perfDone: number;
  salesTarget: number; salesDone: number;
  avgShopSales: number;
  s26Target: number; s26Done: number;
  a26Target: number; a26Done: number;
  sp26Target: number; sp26Done: number;
  w26Target: number; w26Done: number;
  newProdTarget: number; newProdDone: number;
  oldProdTarget: number; oldProdDone: number;
  mainTarget: number; mainDone: number;
  menTarget: number; menDone: number;
  womenTarget: number; womenDone: number;
  kidsTarget: number; kidsDone: number;
  bagTarget: number; bagDone: number;
};

const emptyGroupRow = (product: string, leader: string): GroupRow => ({
  leader, product, shopCount: 0,
  perfTarget: 0, perfDone: 0, salesTarget: 0, salesDone: 0, avgShopSales: 0,
  s26Target: 0, s26Done: 0, a26Target: 0, a26Done: 0, sp26Target: 0, sp26Done: 0, w26Target: 0, w26Done: 0,
  newProdTarget: 0, newProdDone: 0, oldProdTarget: 0, oldProdDone: 0,
  mainTarget: 0, mainDone: 0, menTarget: 0, menDone: 0,
  womenTarget: 0, womenDone: 0, kidsTarget: 0, kidsDone: 0, bagTarget: 0, bagDone: 0,
});

function getDefaultWeekRange() {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now); monday.setDate(now.getDate() - day + 1);
  const sunday = new Date(now); sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { start: fmt(monday), end: fmt(sunday) };
}

function buildGroupRows(data: SalesReport[], archiveMap: Record<string, { product: string; productLeader: string }>, targets: Record<string, Record<string, number>>, seasonal: Record<string, Record<string, number>>): GroupRow[] {
  const map = new Map<string, GroupRow>();
  const shopSet = new Map<string, Set<string>>(); // product -> shops
  data.forEach(r => {
    const sn = r.shopName;
    const arch = archiveMap[sn] || { product: '', productLeader: '' };
    const product = arch.product || '未分类';
    const key = product;
    if (!map.has(key)) {
      const t = targets[sn] || {};
      map.set(key, emptyGroupRow(product, arch.productLeader || ''));
      shopSet.set(key, new Set());
    }
    const v = map.get(key)!;
    shopSet.get(key)!.add(sn);
    const t = targets[sn] || {};
    const se = seasonal[sn] || {};
    v.perfTarget += r.target||0;
    v.perfDone += r.amount||0;
    v.salesTarget += t.monthTarget || 0;
    v.salesDone += r.quantity||0;
    v.s26Target += t.summerTarget || 0; v.a26Target += t.autumnTarget || 0; v.sp26Target += t.springTarget || 0; v.w26Target += t.winterTarget || 0;
    v.newProdTarget += t.newProductTarget || 0; v.oldProdTarget += t.oldProductTarget || 0;
    v.mainTarget += t.mainProductTarget || 0; v.menTarget += t.menShoesTarget || 0;
    v.womenTarget += t.womenShoesTarget || 0; v.kidsTarget += t.kidsShoesTarget || 0; v.bagTarget += t.bagTarget || 0;
    v.s26Done += se['新夏'] || 0; v.a26Done += se['新秋'] || 0; v.sp26Done += se['新春'] || 0; v.w26Done += se['新冬'] || 0;
    v.menDone += se['男鞋'] || 0; v.womenDone += se['女鞋'] || 0; v.kidsDone += se['童鞋'] || 0; v.bagDone += se['包'] || 0;
    v.newProdDone += se['新品'] || 0; v.oldProdDone += se['老品'] || 0;
    v.mainDone += se['主推款'] || 0;
  });
  for (const [key, v] of map.entries()) {
    v.shopCount = shopSet.get(key)!.size;
  }
  return Array.from(map.values()).sort((a,b)=>a.leader.localeCompare(b.leader)||a.product.localeCompare(b.product));
}

function DirectSalesProductGroupPage() {
  const pageTitle = '商品组长工作汇报';
  const { user } = useAuthStore();
  const now = new Date();
  const [monthYear, setMonthYear] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const defaultWeek = getDefaultWeekRange();
  const [weekStart, setWeekStart] = useState(defaultWeek.start);
  const [weekEnd, setWeekEnd] = useState(defaultWeek.end);
  const [loading, setLoading] = useState(false);
  const [salesData, setSalesData] = useState<SalesReport[]>([]);
  const [weeklySalesData, setWeeklySalesData] = useState<SalesReport[]>([]);
  const [shopArchiveMap, setShopArchiveMap] = useState<Record<string, { product: string; productLeader: string }>>({});
  const [productTargets, setProductTargets] = useState<Record<string, Record<string, number>>>({});
  const [seasonalSales, setSeasonalSales] = useState<Record<string, Record<string, number>>>({});
  const [weekSeasonalSales, setWeekSeasonalSales] = useState<Record<string, Record<string, number>>>({});
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [selectedProductLeader, setSelectedProductLeader] = useState('');
  const [submittedList, setSubmittedList] = useState<any[]>([]);
  const [viewUserCode, setViewUserCode] = useState('');
  const [unsubmitting, setUnsubmitting] = useState(false);

  const isAdmin = user?.isAdmin === '是' || (user?.roleCodes || []).includes('super_admin') || (user?.roleCodes || []).includes('data_admin');
  const isViewingOther = !!viewUserCode;

  const fmt = (v: number) => v?.toLocaleString?.('zh-CN', { useGrouping: false }) || '0';

  const loadSalesData = async (my: string) => {
    try {
      const [y, m] = my.split('-').map(Number);
      const startDate = `${y}-${String(m).padStart(2,'0')}-01`;
      const endDate = `${y}-${String(m).padStart(2,'0')}-${new Date(y, m, 0).getDate()}`;
      const result = await getSalesReport('month', 'all', user?.groupName || undefined, { startDate, endDate });
      setSalesData((result.data || []).filter(r => (r as any).warehouseType !== '加盟'));
    } catch (e) { console.error(e); }
  };
  const loadMonthly = async () => { setLoading(true); await loadSalesData(monthYear); setLoading(false); };
  useEffect(() => { loadMonthly(); }, [monthYear]);

  const loadWeeklyData = async () => {
    try {
      const result = await getSalesReport('custom', 'all', user?.groupName || undefined, { startDate: weekStart, endDate: weekEnd });
      setWeeklySalesData((result.data || []).filter(r => (r as any).warehouseType !== '加盟'));
    } catch (e) { console.error(e); }
  };
  useEffect(() => { if (user?.userCode) loadWeeklyData(); }, [weekStart, weekEnd]);

  const loadShopArchive = async () => {
    try {
      const res = await axios.get(`/shops/archive${user?.groupName ? `?groupName=${encodeURIComponent(user.groupName)}` : ''}`);
      const list = res.data || [];
      const map: Record<string, { product: string; productLeader: string }> = {};
      list.forEach((s: any) => {
        map[s.shopName] = { product: s.product || '', productLeader: s.productLeader || '' };
      });
      setShopArchiveMap(map);
    } catch (e) { console.error(e); }
  };
  useEffect(() => { loadShopArchive(); }, []);

  const loadProductTargets = async () => {
    try {
      const res = await axios.get(`/daily-product-targets/by-month/${monthYear}?_t=${Date.now()}`);
      const list = res.data || [];
      const map: Record<string, Record<string, number>> = {};
      list.forEach((r: any) => {
        map[r.shopName] = {
          monthTarget: r.monthTarget || 0, springTarget: r.springTarget || 0,
          summerTarget: r.summerTarget || 0, autumnTarget: r.autumnTarget || 0,
          winterTarget: r.winterTarget || 0, newProductTarget: r.newProductTarget || 0,
          oldProductTarget: r.oldProductTarget || 0, mainProductTarget: r.mainProductTarget || 0,
          menShoesTarget: r.menShoesTarget || 0, womenShoesTarget: r.womenShoesTarget || 0,
          kidsShoesTarget: r.kidsShoesTarget || 0, bagTarget: r.bagTarget || 0,
        };
      });
      setProductTargets(map);
    } catch (e) { /* 静默 */ }
  };
  useEffect(() => { loadProductTargets(); }, [monthYear]);

  const [weekProductTargets, setWeekProductTargets] = useState<Record<string, Record<string, number>>>({});
  const loadWeekProductTargets = async (startDate: string, endDate: string) => {
    try {
      const [y, m] = startDate.split('-').map(Number);
      const wmy = `${y}-${String(m).padStart(2, '0')}`;
      const res = await axios.get(`/daily-product-targets/daily-sums/${wmy}/${startDate}/${endDate}?_t=${Date.now()}`);
      const list = res.data || [];
      const map: Record<string, Record<string, number>> = {};
      list.forEach((r: any) => {
        if (!map[r.shopName]) map[r.shopName] = {};
        map[r.shopName][r.fieldName] = (map[r.shopName][r.fieldName] || 0) + (r.weekTarget || 0);
      });
      setWeekProductTargets(map);
    } catch (e) { /* 静默 */ }
  };
  useEffect(() => { loadWeekProductTargets(weekStart, weekEnd); }, [weekStart, weekEnd]);

  const parseSeasonal = (list: any[]) => {
    const map: Record<string, Record<string, number>> = {};
    list.forEach((r: any) => {
      const sn = r['店铺名称'] || r.shopName || '';
      const qty = parseFloat(r['数量']) || 0;
      if (!sn) return;
      if (!map[sn]) map[sn] = {};
      const season = r['季节'] || '';
      const gender = r['性别'] || '';
      const newOld = r['新老'] || '';
      if (season) map[sn][season] = (map[sn][season] || 0) + qty;
      if (gender) map[sn][gender] = (map[sn][gender] || 0) + qty;
      if (newOld) map[sn][newOld] = (map[sn][newOld] || 0) + qty;
    });
    return map;
  };

  const loadSeasonalSales = async () => {
    try {
      const [y, m] = monthYear.split('-').map(Number);
      const startDate = `${y}-${String(m).padStart(2,'0')}-01`;
      const endDate = `${y}-${String(m).padStart(2,'0')}-${new Date(y, m, 0).getDate()}`;
      const [seasonRes, mainRes] = await Promise.all([
        axios.get(`/reports/product-seasonal-sales?startDate=${startDate}&endDate=${endDate}&_t=${Date.now()}`),
        axios.get(`/reports/product-main-product?startDate=${startDate}&endDate=${endDate}&_t=${Date.now()}`),
      ]);
      const map = parseSeasonal(seasonRes.data || []);
      (mainRes.data || []).forEach((r: any) => {
        const sn = r['店铺名称'] || '';
        if (!sn) return;
        if (!map[sn]) map[sn] = {};
        map[sn]['主推款'] = (map[sn]['主推款'] || 0) + (parseFloat(r['主推数量']) || 0);
      });
      setSeasonalSales(map);
    } catch (e) { /* 静默 */ }
  };
  useEffect(() => { loadSeasonalSales(); }, [monthYear]);

  const loadWeekSeasonalSales = async () => {
    try {
      const [seasonRes, mainRes] = await Promise.all([
        axios.get(`/reports/product-seasonal-sales?startDate=${weekStart}&endDate=${weekEnd}&_t=${Date.now()}`),
        axios.get(`/reports/product-main-product?startDate=${weekStart}&endDate=${weekEnd}&_t=${Date.now()}`),
      ]);
      const map = parseSeasonal(seasonRes.data || []);
      (mainRes.data || []).forEach((r: any) => {
        const sn = r['店铺名称'] || '';
        if (!sn) return;
        if (!map[sn]) map[sn] = {};
        map[sn]['主推款'] = (map[sn]['主推款'] || 0) + (parseFloat(r['主推数量']) || 0);
      });
      setWeekSeasonalSales(map);
    } catch (e) { /* 静默 */ }
  };
  useEffect(() => { loadWeekSeasonalSales(); }, [weekStart, weekEnd]);

  const workItemKey = (viewUserCode || (user?.userCode ? `${user.userCode}_productLeaderGroup` : ''));
  const loadWorkItems = async () => {
    if (!workItemKey) return;
    try {
      const res = await axios.get(`/direct-sales-summary/${encodeURIComponent(workItemKey)}/${monthYear}?_t=${Date.now()}`);
      const d = res.data;
      if (d && typeof d.workItems === 'string') setWorkItems(JSON.parse(d.workItems));
      else if (d && Array.isArray(d.workItems)) setWorkItems(d.workItems);
      else setWorkItems([]);
    } catch (e) { /* 静默 */ }
  };
  useEffect(() => { loadWorkItems(); }, [monthYear, viewUserCode]);

  const saveWorkItems = async () => {
    setSaving(true);
    try {
      await axios.put(`/direct-sales-summary/${encodeURIComponent(workItemKey)}/${monthYear}`, {
        userCode: workItemKey, workItems: JSON.stringify(workItems), createdBy: workItemKey,
      });
      alert('保存成功');
    } catch { alert('保存失败'); }
    setSaving(false);
  };

  const submitWorkItems = async () => {
    if (workItems.length === 0) { alert('请先添加工作重点'); return; }
    setSubmitting(true);
    try {
      // 锁定所有项
      const lockedItems = workItems.map(w => ({ ...w, _locked: true }));
      await axios.post('/direct-sales-summary/submit', {
        userCode: workItemKey, monthYear,
        workItems: lockedItems,
      });
      setWorkItems(lockedItems);
      alert('提交成功！已锁定的工作重点不可修改。');
    } catch (e: any) {
      alert('提交失败: ' + (e?.response?.data?.error || e.message));
    }
    setSubmitting(false);
  };

  // 管理员：加载已提交汇报列表
  const loadSubmittedList = async () => {
    try {
      const res = await axios.get(`/direct-sales-summary/submitted/${monthYear}?_t=${Date.now()}`);
      const filtered = (res.data || []).filter((s: any) => s.userCode?.endsWith('_productLeaderGroup'));
      setSubmittedList(filtered);
    } catch (e) { console.error(e); setSubmittedList([]); }
  };

  // 管理员：反提交
  const handleUnsubmit = async () => {
    if (!workItemKey) return;
    if (!confirm(`确认反提交 ${workItemKey} 的 ${monthYear} 工作汇报？反提交后可再次修改。`)) return;
    setUnsubmitting(true);
    try {
      await axios.post('/direct-sales-summary/unsubmit', { userCode: workItemKey, monthYear });
      alert('反提交成功，可再次修改');
      setViewUserCode('');
      await loadSubmittedList();
      await loadWorkItems();
    } catch (e: any) {
      alert('反提交失败: ' + (e?.response?.data?.error || e.message));
    }
    setUnsubmitting(false);
  };

  useEffect(() => { if (isAdmin) loadSubmittedList(); }, [monthYear]);

  // 商品/组长预筛选：让筛选器联动
  const productFilteredSalesData = useMemo(() => {
    return salesData.filter(r => {
      const arch = shopArchiveMap[r.shopName];
      if (selectedProduct && (arch?.product || '') !== selectedProduct) return false;
      if (selectedProductLeader && (arch?.productLeader || '') !== selectedProductLeader) return false;
      return true;
    });
  }, [salesData, shopArchiveMap, selectedProduct, selectedProductLeader]);

  const monthFilter = useAreaSupervisorShopFilter<SalesReport>(productFilteredSalesData, {
    getArea: (r) => r.area, getSupervisor: (r) => r.supervisor, getShopName: (r) => r.shopName,
    getWarehouseType: (r) => (r as any).warehouseType,
    onChange: () => {},
  });

  const filteredWeeklyData = useMemo(() => {
    return weeklySalesData.filter(r => {
      const arch = shopArchiveMap[r.shopName];
      if (selectedProduct && (arch?.product || '') !== selectedProduct) return false;
      if (selectedProductLeader && (arch?.productLeader || '') !== selectedProductLeader) return false;
      if (monthFilter.selectedAreas.length > 0 && !monthFilter.selectedAreas.includes(r.area || '')) return false;
      if (monthFilter.selectedSupervisors.length > 0 && !monthFilter.selectedSupervisors.includes(r.supervisor || '')) return false;
      if (monthFilter.selectedShops.length > 0 && !monthFilter.selectedShops.includes(r.shopName)) return false;
      if (monthFilter.selectedWarehouses.length > 0 && !monthFilter.selectedWarehouses.includes((r as any).warehouseType || '')) return false;
      return true;
    });
  }, [weeklySalesData, shopArchiveMap, selectedProduct, selectedProductLeader, monthFilter.selectedAreas, monthFilter.selectedSupervisors, monthFilter.selectedShops, monthFilter.selectedWarehouses]);

  const monthRemainingDays = useMemo(() => {
    const [y,m] = monthYear.split('-').map(Number);
    const dim = new Date(y, m, 0).getDate();
    const td = new Date();
    const tdy = (td.getFullYear()===y && td.getMonth()+1===m) ? td.getDate() : dim;
    return Math.max(1, dim - tdy);
  }, [monthYear]);

  const timeProgress = useMemo(() => {
    const [y,m] = monthYear.split('-').map(Number);
    const now = new Date();
    const monthStart = new Date(y, m-1, 1);
    const monthEnd = new Date(y, m, 1);
    const totalHours = (monthEnd.getTime() - monthStart.getTime()) / 3600000;
    if (now < monthStart) return 0;
    if (now >= monthEnd) return 100;
    const elapsedHours = (now.getTime() - monthStart.getTime()) / 3600000;
    return Math.min(100, (elapsedHours / totalHours) * 100);
  }, [monthYear]);

  const weekRemainingDays = useMemo(() => {
    const end = new Date(weekEnd);
    const td = new Date();
    const remaining = Math.ceil((end.getTime() - td.getTime()) / 86400000);
    return Math.max(1, remaining + 1);
  }, [weekEnd]);

  const productOptions = useMemo(() => [...new Set(Object.values(shopArchiveMap).map(v => v.product).filter(Boolean))].sort(), [shopArchiveMap]);
  const productLeaderOptions = useMemo(() => [...new Set(Object.values(shopArchiveMap).map(v => v.productLeader).filter(Boolean))].sort(), [shopArchiveMap]);

  const applyAvg = (rows: GroupRow[]) => {
    // 店均销量 = 对应总销量 / 店铺数
    rows.forEach(r => { r.avgShopSales = r.shopCount > 0 ? Math.round(r.salesDone / r.shopCount) : 0; });
    return rows;
  };

  const monthRows = useMemo(() => {
    let rows = buildGroupRows(monthFilter.filteredData, shopArchiveMap, productTargets, seasonalSales);
    return applyAvg(rows);
  }, [monthFilter.filteredData, shopArchiveMap, productTargets, seasonalSales]);
  const weekRows = useMemo(() => {
    let rows = buildGroupRows(filteredWeeklyData, shopArchiveMap, weekProductTargets, weekSeasonalSales);
    return applyAvg(rows);
  }, [filteredWeeklyData, shopArchiveMap, weekProductTargets, weekSeasonalSales]);

  const mk1 = (target: number, done: number, remaining: number) => {
    const rate = target > 0 ? ((done / target) * 100).toFixed(0) : '-';
    const remain = target > 0 ? Math.round((target - done) / remaining) : 0;
    return (
      <div className="text-center leading-tight">
        <div className="text-xs" style={{color:'#004799'}}>目标 {target>0?fmt(target):'-'}</div>
        <div style={{fontSize:'15px',fontWeight:'bold',color:'#990000'}}>{fmt(done)}</div>
        <div className="text-xs">
          <span style={{color:'#006633',fontWeight:'bold'}}>达成{rate}%</span>
          <span className="mx-1 text-gray-300">|</span>
          <span style={{color:'#8C8C8C'}}>日均{remain<=0?'完成':fmt(remain)}</span>
        </div>
      </div>
    );
  };

  const achievementColors = (rate: number) => rate >= 80 ? '#16a34a' : rate >= 50 ? '#eab308' : '#dc2626';

  const th1 = 'border border-gray-400 px-2 py-2 text-xs font-bold text-gray-700 text-center bg-blue-100 align-middle';
  const tdV = 'border border-gray-400 px-2 py-1.5 align-middle';

  const METRIC_COLS = [
    { key: 'perf', label: '本月业绩\n目标/完成/达成/剩下日均销', tKey: 'perfTarget', dKey: 'perfDone' },
    { key: 'sales', label: '本月销量\n目标/完成/达成/剩下日均销', tKey: 'salesTarget', dKey: 'salesDone' },
    { key: 'avg', label: '店均销量', tKey: '', dKey: 'avgShopSales', simple: true },
    { key: 's26', label: '新夏\n目标/完成/达成/剩下日均销', tKey: 's26Target', dKey: 's26Done' },
    { key: 'a26', label: '新秋\n目标/完成/达成/剩下日均销', tKey: 'a26Target', dKey: 'a26Done' },
    { key: 'w26', label: '新冬\n目标/完成/达成/剩下日均销', tKey: 'w26Target', dKey: 'w26Done' },
    { key: 'sp26', label: '新春\n目标/完成/达成/剩下日均销', tKey: 'sp26Target', dKey: 'sp26Done' },
    { key: 'newProd', label: '新品销量\n目标/完成/达成/剩下日均销', tKey: 'newProdTarget', dKey: 'newProdDone' },
    { key: 'oldProd', label: '老品销量\n目标/完成/达成/剩下日均销', tKey: 'oldProdTarget', dKey: 'oldProdDone' },
    { key: 'main', label: '主推款\n目标/完成/达成/剩下日均销', tKey: 'mainTarget', dKey: 'mainDone' },
    { key: 'men', label: '男鞋\n目标/完成/达成/剩下日均销', tKey: 'menTarget', dKey: 'menDone' },
    { key: 'women', label: '女鞋\n目标/完成/达成/剩下日均销', tKey: 'womenTarget', dKey: 'womenDone' },
    { key: 'kids', label: '童鞋\n目标/完成/达成/剩下日均销', tKey: 'kidsTarget', dKey: 'kidsDone' },
    { key: 'bag', label: '包包\n目标/完成/达成/剩下日均销', tKey: 'bagTarget', dKey: 'bagDone' },
  ];

  const COL_W = 120;
  const LABEL_W = 90;
  const METRIC_COUNT = METRIC_COLS.length;
  const TOTAL_W = LABEL_W + 80 + 80 + METRIC_COUNT * COL_W;
  const totalColCount = 3 + METRIC_COUNT;

  const renderTable = (title: string, label: string, rows: GroupRow[], remainingDays: number, isWeek: boolean) => {
    if (rows.length === 0) {
      return (
        <div className="bg-white border border-gray-400 rounded mb-4 overflow-x-auto">
          <h3 className={`text-sm font-bold px-3 py-2 border-b border-gray-400 ${isWeek?'bg-green-50 text-green-600':'bg-blue-50 text-blue-600'}`}>
            {title}{isWeek && <span className="text-xs text-gray-400 font-normal ml-2">({weekStart} ~ {weekEnd})</span>}
          </h3>
          <table className="border-collapse table-fixed" style={{ width: TOTAL_W }}>
            <colgroup>
              <col width={LABEL_W} />
              <col width={80} /><col width={80} />
              {Array(METRIC_COUNT).fill(0).map((_,i)=><col key={i} width={COL_W} />)}
            </colgroup>
            <tbody>
              <tr><td colSpan={totalColCount} className="border border-gray-400 px-6 py-4 text-center text-gray-400">暂无数据</td></tr>
            </tbody>
          </table>
        </div>
      );
    }

    const totals = rows.reduce((a,r) => ({
      perfTarget: a.perfTarget+r.perfTarget, perfDone: a.perfDone+r.perfDone,
      salesTarget: a.salesTarget+r.salesTarget, salesDone: a.salesDone+r.salesDone, avgShopSales: a.avgShopSales+r.avgShopSales,
      s26Target: a.s26Target+r.s26Target, s26Done: a.s26Done+r.s26Done,
      a26Target: a.a26Target+r.a26Target, a26Done: a.a26Done+r.a26Done,
      sp26Target: a.sp26Target+r.sp26Target, sp26Done: a.sp26Done+r.sp26Done,
      w26Target: a.w26Target+r.w26Target, w26Done: a.w26Done+r.w26Done,
      newProdTarget: a.newProdTarget+r.newProdTarget, newProdDone: a.newProdDone+r.newProdDone,
      oldProdTarget: a.oldProdTarget+r.oldProdTarget, oldProdDone: a.oldProdDone+r.oldProdDone,
      mainTarget: a.mainTarget+r.mainTarget, mainDone: a.mainDone+r.mainDone,
      menTarget: a.menTarget+r.menTarget, menDone: a.menDone+r.menDone,
      womenTarget: a.womenTarget+r.womenTarget, womenDone: a.womenDone+r.womenDone,
      kidsTarget: a.kidsTarget+r.kidsTarget, kidsDone: a.kidsDone+r.kidsDone,
      bagTarget: a.bagTarget+r.bagTarget, bagDone: a.bagDone+r.bagDone,
    }), {
      perfTarget:0, perfDone:0, salesTarget:0, salesDone:0, avgShopSales:0,
      s26Target:0, s26Done:0, a26Target:0, a26Done:0, sp26Target:0, sp26Done:0, w26Target:0, w26Done:0,
      newProdTarget:0, newProdDone:0, oldProdTarget:0, oldProdDone:0,
      mainTarget:0, mainDone:0, menTarget:0, menDone:0, womenTarget:0, womenDone:0,
      kidsTarget:0, kidsDone:0, bagTarget:0, bagDone:0,
    });

    const tdd = 'border border-gray-400 px-2 py-1.5 text-center font-bold align-middle';
    const headerBg = isWeek ? 'bg-green-100' : 'bg-blue-100';

    const mkCell = (tg:number, dn:number) => {
      const rate = tg>0 ? ((dn/tg)*100).toFixed(0)+'%' : '-';
      const rm = tg>0 ? Math.round((tg-dn)/remainingDays) : 0;
      return (
        <td className={tdd}>
          <div className="text-xs" style={{color:'#004799'}}>目标 {tg>0?fmt(tg):'-'}</div>
          <div style={{fontSize:'16px',color:'#990000'}}>{fmt(dn)}</div>
          <div className="text-xs">
            <span style={{color:'#006633'}}>达成{rate}</span><span className="mx-1">|</span>
            <span style={{color:'#8C8C8C'}}>日均{rm<=0?'完成':fmt(rm)}</span>
          </div>
        </td>
      );
    };

    return (
      <div className="bg-white border border-gray-400 rounded mb-4 overflow-x-auto">
        <h3 className={`text-sm font-bold px-3 py-2 border-b border-gray-400 ${isWeek?'bg-green-50 text-green-600':'bg-blue-50 text-blue-600'}`}>
          {title}{isWeek && <span className="text-xs text-gray-400 font-normal ml-2">({weekStart} ~ {weekEnd})</span>}
        </h3>
        <table className="border-collapse table-fixed" style={{ width: TOTAL_W }}>
          <colgroup>
            <col width={LABEL_W} />
            <col width={80} /><col width={80} />
            {Array(METRIC_COUNT).fill(0).map((_,i)=><col key={i} width={COL_W} />)}
          </colgroup>
          <tbody>
            <tr className={headerBg}>
              <td className={th1} rowSpan={rows.length + 2} style={{verticalAlign:'middle',fontWeight:'bold',fontSize:'14px'}}>
                {label.split('\n').map((l,i)=><span key={i}>{l}<br/></span>)}
              </td>
              <td className={th1}>组长</td>
              <td className={th1}>商品</td>
              {METRIC_COLS.map(m => (
                <td key={m.key} className={th1} style={{whiteSpace:'pre-line'}}>{m.label}</td>
              ))}
            </tr>
            {rows.map((r,i)=>{
              const achRate = r.perfTarget > 0 ? (r.perfDone / r.perfTarget) * 100 : 0;
              const bgColor = achievementColors(achRate);
              return (
                <tr key={i} className={i%2===0?'bg-white':'bg-gray-50'} style={{borderLeft:'4px solid '+bgColor}}>
                  <td className={tdV} style={{textAlign:'center'}}>{r.leader}</td>
                  <td className={tdV} style={{textAlign:'center'}}>{r.product}</td>
                  {METRIC_COLS.map(m => {
                    if (m.simple) return <td key={m.key} className={tdV} style={{textAlign:'center',fontSize:'15px',fontWeight:'bold'}}>{fmt((r as any)[m.dKey])}</td>;
                    return <td key={m.key} className={tdV}>{mk1((r as any)[m.tKey], (r as any)[m.dKey], remainingDays)}</td>;
                  })}
                </tr>
              );
            })}
            <tr className="bg-yellow-100" style={{fontWeight:'bold'}}>
              <td className={tdd} style={{fontSize:'16px'}}>合计</td>
              <td className={tdd}></td>
              {METRIC_COLS.map(m => {
                if (m.simple) return <td key={m.key} className={tdd} style={{fontSize:'16px'}}>{fmt((totals as any)[m.dKey])}</td>;
                return mkCell((totals as any)[m.tKey], (totals as any)[m.dKey]);
              })}
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const mkRow = (rows: GroupRow[], remainingDays: number) => {
      const result: any[][] = [['组长','商品',
        '本月业绩-目标','本月业绩-完成','本月业绩-达成','本月业绩-剩下日均销',
        '本月销量-目标','本月销量-完成','本月销量-达成','本月销量-剩下日均销',
        '店均销量',
        '新夏-目标','新夏-完成','新夏-达成','新夏-剩下日均销',
        '新秋-目标','新秋-完成','新秋-达成','新秋-剩下日均销',
        '新冬-目标','新冬-完成','新冬-达成','新冬-剩下日均销',
        '新春-目标','新春-完成','新春-达成','新春-剩下日均销',
        '新品销量-目标','新品销量-完成','新品销量-达成','新品销量-剩下日均销',
        '老品销量-目标','老品销量-完成','老品销量-达成','老品销量-剩下日均销',
        '主推款-目标','主推款-完成','主推款-达成','主推款-剩下日均销',
        '男鞋-目标','男鞋-完成','男鞋-达成','男鞋-剩下日均销',
        '女鞋-目标','女鞋-完成','女鞋-达成','女鞋-剩下日均销',
        '童鞋-目标','童鞋-完成','童鞋-达成','童鞋-剩下日均销',
        '包包-目标','包包-完成','包包-达成','包包-剩下日均销',
      ]];
      const mkv = (t:number,d:number) => [t, d, t>0?((d/t)*100).toFixed(1)+'%':'-', t>0?Math.round((t-d)/remainingDays):0];
      rows.forEach(r => result.push([r.leader, r.product,
        ...mkv(r.perfTarget, r.perfDone), ...mkv(r.salesTarget, r.salesDone), r.avgShopSales,
        ...mkv(r.s26Target, r.s26Done), ...mkv(r.a26Target, r.a26Done), ...mkv(r.w26Target, r.w26Done), ...mkv(r.sp26Target, r.sp26Done),
        ...mkv(r.newProdTarget, r.newProdDone), ...mkv(r.oldProdTarget, r.oldProdDone),
        ...mkv(r.mainTarget, r.mainDone), ...mkv(r.menTarget, r.menDone),
        ...mkv(r.womenTarget, r.womenDone), ...mkv(r.kidsTarget, r.kidsDone), ...mkv(r.bagTarget, r.bagDone),
      ]));
      return result;
    };
    const ws1 = XLSX.utils.aoa_to_sheet(mkRow(monthRows, monthRemainingDays));
    XLSX.utils.book_append_sheet(wb, ws1, '本月数据详情');
    const ws2 = XLSX.utils.aoa_to_sheet(mkRow(weekRows, weekRemainingDays));
    XLSX.utils.book_append_sheet(wb, ws2, '本周数据详情');
    XLSX.writeFile(wb, `商品组长工作汇报_${monthYear}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportPDF = async () => {
    const mkHTML = (rows: GroupRow[], remainingDays: number) => rows.map((r,i) => {
      const bg = i%2?'#f9fafb':'#fff';
      const td = (c: string) => '<td style="border:1px solid #9ca3af;padding:3px 4px;text-align:center;font-size:9px">'+c+'</td>';
      const mc = (t:number, d:number) => {
        const rate = t>0?Math.round(d/t*100)+'%':'-';
        const rm = t>0?Math.round((t-d)/remainingDays):0;
        return '<td style="border:1px solid #9ca3af;padding:3px 4px;text-align:center;font-size:9px">'+
          '目标:'+fmt(t)+'<br/><span style="color:#990000;font-weight:bold;font-size:12px">'+fmt(d)+'</span><br/>'+
          '达成:'+rate+' | 日均:'+(rm<=0?'完成':fmt(rm))+'</td>';
      };
      return '<tr style="background:'+bg+'">'+td(r.leader)+td(r.product)+
        mc(r.perfTarget,r.perfDone)+mc(r.salesTarget,r.salesDone)+td('店均:'+fmt(r.avgShopSales))+
        mc(r.s26Target,r.s26Done)+mc(r.a26Target,r.a26Done)+mc(r.w26Target,r.w26Done)+mc(r.sp26Target,r.sp26Done)+
        mc(r.newProdTarget,r.newProdDone)+mc(r.oldProdTarget,r.oldProdDone)+
        mc(r.mainTarget,r.mainDone)+mc(r.menTarget,r.menDone)+mc(r.womenTarget,r.womenDone)+
        mc(r.kidsTarget,r.kidsDone)+mc(r.bagTarget,r.bagDone)+'</tr>';
    }).join('');

    const headerRow = '<td style="border:1px solid #9ca3af;padding:3px">组长</td><td style="border:1px solid #9ca3af;padding:3px">商品</td>'+
      '<td style="border:1px solid #9ca3af;padding:3px">本月业绩</td><td style="border:1px solid #9ca3af;padding:3px">本月销量</td><td style="border:1px solid #9ca3af;padding:3px">店均销量</td>'+
      '<td style="border:1px solid #9ca3af;padding:3px">新夏</td><td style="border:1px solid #9ca3af;padding:3px">新秋</td><td style="border:1px solid #9ca3af;padding:3px">新冬</td><td style="border:1px solid #9ca3af;padding:3px">新春</td>'+
      '<td style="border:1px solid #9ca3af;padding:3px">新品销量</td><td style="border:1px solid #9ca3af;padding:3px">老品销量</td><td style="border:1px solid #9ca3af;padding:3px">主推款</td>'+
      '<td style="border:1px solid #9ca3af;padding:3px">男鞋</td><td style="border:1px solid #9ca3af;padding:3px">女鞋</td><td style="border:1px solid #9ca3af;padding:3px">童鞋</td><td style="border:1px solid #9ca3af;padding:3px">包包</td>';

    const html = '<div style="background:#fff;padding:8px;font-family:Arial">' +
      '<h2 style="text-align:center;color:#2563eb;font-size:16px;margin:0 0 8px">商品组长工作汇报 - '+monthYear+'</h2>' +
      '<h3 style="color:#2563eb;font-size:13px;border-bottom:1px solid #93c5fd;padding-bottom:4px">本月数据详情</h3>' +
      '<table style="border-collapse:collapse;font-size:9px;width:100%"><thead><tr style="background:#dbeafe;font-weight:bold;text-align:center">'+headerRow+'</tr></thead><tbody>'+mkHTML(monthRows, monthRemainingDays)+'</tbody></table>' +
      '<h3 style="color:#059669;font-size:13px;border-bottom:1px solid #86efac;padding-bottom:4px;margin-top:12px">本周数据详情 ('+weekStart+' ~ '+weekEnd+')</h3>' +
      '<table style="border-collapse:collapse;font-size:9px;width:100%"><thead><tr style="background:#dcfce7;font-weight:bold;text-align:center">'+headerRow+'</tr></thead><tbody>'+mkHTML(weekRows, weekRemainingDays)+'</tbody></table></div>';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;left:-9999px;top:0';
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    await new Promise(r=>setTimeout(r,300));
    const canvas = await html2canvas(wrap, { scale: 1.5, backgroundColor: '#fff', useCORS: true, allowTaint: true, logging: false });
    document.body.removeChild(wrap);
    const img = canvas.toDataURL('image/jpeg', 0.92);
    const pdf = new jsPDF('l', 'mm', 'a4');
    const pw = pdf.internal.pageSize.getWidth(); const ph = pdf.internal.pageSize.getHeight();
    const ratio = pw / canvas.width; const imgH = canvas.height * ratio;
    pdf.addImage(img, 'JPEG', 0, 0, pw, imgH);
    let remaining = imgH - ph;
    let pos = 0;
    while (remaining > 0) { pos -= ph; pdf.addPage(); pdf.addImage(img, 'JPEG', 0, pos, pw, imgH); remaining -= ph; }
    pdf.save('商品组长工作汇报_'+monthYear+'_'+new Date().toISOString().slice(0,10)+'.pdf');
  };

  if (!user) return <Layout title={pageTitle}><p className="text-gray-500 p-8">请先登录</p></Layout>;

  return (
    <Layout title={pageTitle} subtitle={`${monthYear} 商品组长运营数据`}>
      <div className="p-2 work-report-container" style={{ width: TOTAL_W + 16 }}>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <span className="text-xs text-gray-500 font-bold">月筛选(本月):</span>
          <input type="month" value={monthYear} onChange={e=>setMonthYear(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-sm w-36" />
          <span className="text-xs text-gray-400 mx-1">|</span>
          <span className="text-xs text-gray-500 font-bold">时间段(本周):</span>
          <input type="date" value={weekStart} onChange={e=>setWeekStart(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-sm" />
          <span className="text-xs text-gray-400">至</span>
          <input type="date" value={weekEnd} onChange={e=>setWeekEnd(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-sm" />
          <button onClick={()=>{loadMonthly();loadWeeklyData();}} disabled={loading} className="px-3 py-1 bg-gray-100 rounded text-sm hover:bg-gray-200"><RefreshCw size={14} className={loading?'animate-spin inline':'inline'} /> 刷新</button>
          <span className="text-xs text-gray-400 mx-1">|</span>
          <span className="text-xs text-gray-500 font-bold">时间进度:</span>
          <span className="text-sm font-bold" style={{color:timeProgress>=80?'#16a34a':timeProgress>=50?'#eab308':'#dc2626'}}>{timeProgress.toFixed(1)}%</span>
          <span className="text-xs text-gray-400">| 剩余{monthRemainingDays}天</span>
          <span className="text-xs text-gray-400 mx-1">|</span>
          <span className="text-xs text-gray-500 font-bold">商品:</span>
          <select value={selectedProduct} onChange={e => setSelectedProduct(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs">
            <option value="">全部</option>
            {productOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <span className="text-xs text-gray-500 font-bold">组长:</span>
          <select value={selectedProductLeader} onChange={e => setSelectedProductLeader(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs">
            <option value="">全部</option>
            {productLeaderOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <AreaSupervisorShopFilter filter={monthFilter as any} />
          <span className="text-xs text-gray-400 mx-1">|</span>
          <button onClick={exportExcel} className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"><FileSpreadsheet size={14} className="inline" /> 导出Excel</button>
          <button onClick={exportPDF} className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"><FileText size={14} className="inline" /> 导出PDF</button>
        </div>

        {loading ? <p className="text-gray-400 py-8 text-center">加载中...</p> : (
          <>
            {renderTable('本月数据详情', '本月\n数据\n详情', monthRows, monthRemainingDays, false)}
            {renderTable('本周数据详情', '本周\n数据\n详情', weekRows, weekRemainingDays, true)}
            <div className="bg-white border border-gray-400 rounded mb-4">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-400 bg-blue-50">
                <h3 className="text-sm font-bold text-blue-600">本月工作重点</h3>
                <button onClick={() => setWorkItems(prev => [...prev, { ...emptyWI }])} className="px-2 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600"><Plus size={12} className="inline" /> 新增行</button>
              </div>
              <div className="overflow-x-auto">
                <table className="border-collapse table-fixed" style={{ width: TOTAL_W, fontSize: '16px' }}>
                  <colgroup><col width="80"/><col width="60"/><col width="160"/><col width="80"/><col width="160"/><col width="60"/><col width="60"/><col width="160"/><col width="60"/></colgroup>
                  <thead><tr className="bg-gray-100">
                    <th className="border border-gray-400 px-1 py-2 text-gray-700" style={{fontSize:'20px'}}>执行时间</th>
                    <th className="border border-gray-400 px-1 py-2 text-gray-700" style={{fontSize:'20px'}}>工作类目</th>
                    <th className="border border-gray-400 px-1 py-2 text-gray-700" style={{fontSize:'20px'}}>具体内容</th>
                    <th className="border border-gray-400 px-1 py-2 text-gray-700" style={{fontSize:'20px'}}>预计完成</th>
                    <th className="border border-gray-400 px-1 py-2 text-gray-700" style={{fontSize:'20px'}}>工作总结</th>
                    <th className="border border-gray-400 px-1 py-2 text-gray-700" style={{fontSize:'20px'}}>反馈方式</th>
                    <th className="border border-gray-400 px-1 py-2 text-gray-700" style={{fontSize:'20px'}}>乐捐机制</th>
                    <th className="border border-gray-400 px-1 py-2 text-gray-700" style={{fontSize:'20px'}}>工作计划项目跟进</th>
                    <th className="border border-gray-400 px-1 py-2 text-gray-700" style={{fontSize:'20px'}}>操作</th>
                  </tr></thead>
                  <tbody>
                    {workItems.length === 0 && (
                      <tr><td colSpan={9} className="border border-gray-400 px-3 py-4 text-center text-gray-400">暂无工作项目</td></tr>
                    )}
                    {workItems.map((item, idx) => {
                      const locked = item._locked === true;
                      return (
                        <tr key={idx} className={locked ? 'bg-gray-50' : ''}>
                          {['time','category','content','dueDate','summary','feedback','penalty','followUp'].map(f => {
                            const isDate = f === 'time' || f === 'dueDate';
                            const val = (item as any)[f] || '';
                            return (
                              <td key={f} className="border border-gray-400 px-1 py-1 align-top">
                                {isDate ? (
                                  <input type="date"
                                    className={`w-full px-1 py-1 border rounded ${locked ? 'bg-gray-100 border-gray-200 cursor-not-allowed text-red-600 font-bold' : 'border-gray-200 text-black'}`}
                                    style={{fontSize:'16px', height:'36px'}}
                                    value={val} readOnly={locked} disabled={locked}
                                    onChange={e => { if (locked) return; setWorkItems(prev => { const items = [...prev]; items[idx] = { ...items[idx], [f]: e.target.value }; return items; }); }}
                                  />
                                ) : (
                                  <textarea
                                    className={`w-full px-1 py-1 border rounded resize-none ${locked ? 'bg-gray-100 border-gray-200 cursor-not-allowed text-red-600 font-bold' : 'border-gray-200 text-black'}`}
                                    style={{fontSize:'16px', minHeight:'36px', lineHeight:'1.4'}}
                                    value={val} readOnly={locked} disabled={locked}
                                    rows={1}
                                    ref={el => { if (el) { el.style.height = 'auto'; el.style.height = (el.scrollHeight + 2) + 'px'; } }}
                                    onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = (el.scrollHeight + 2) + 'px'; }}
                                    onFocus={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = (el.scrollHeight + 2) + 'px'; }}
                                    onChange={e => { if (locked) return; setWorkItems(prev => { const items = [...prev]; items[idx] = { ...items[idx], [f]: e.target.value }; return items; }); }}
                                  />
                                )}
                              </td>
                            );
                          })}
                          <td className="border border-gray-400 px-1 py-1 text-center">
                            {locked ? (
                              <span className="text-gray-300"><Lock size={18} /></span>
                            ) : (
                              <button onClick={() => setWorkItems(prev => prev.filter((_, i) => i !== idx))} className="text-red-500 hover:text-red-700"><Trash2 size={18} /></button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex justify-end mb-4">
              <button onClick={saveWorkItems} disabled={saving || isViewingOther} className="px-4 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50 mr-2"><Save size={14} className="inline" /> {saving ? '保存中...' : '保存'}</button>
              <button onClick={submitWorkItems} disabled={submitting || isViewingOther} className="px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50 mr-2"><Send size={14} className="inline" /> {submitting ? '提交中...' : '提交'}</button>
              {isViewingOther && (
                <button onClick={handleUnsubmit} disabled={unsubmitting} className="px-4 py-2 bg-orange-500 text-white rounded text-sm hover:bg-orange-600 mr-2"><Unlock size={14} className="inline" /> {unsubmitting ? '反提交中...' : '反提交'}</button>
              )}
              {isViewingOther && (
                <button onClick={() => setViewUserCode('')} className="px-3 py-2 bg-gray-500 text-white rounded text-sm hover:bg-gray-600 mr-2"><RefreshCw size={14} className="inline" /> 返回</button>
              )}
              {isAdmin && (
                <select
                  value={viewUserCode ? viewUserCode.replace(/_productLeaderGroup$/, '') : ''}
                  onChange={e => setViewUserCode(e.target.value ? e.target.value + '_productLeaderGroup' : '')}
                  className="px-2 py-2 border border-gray-300 rounded text-xs max-w-[200px]"
                >
                  <option value="">-- 查看已提交 --</option>
                  {submittedList.map((s, i) => {
                    const shortCode = s.userCode?.replace(/_productLeaderGroup$/, '') || s.userCode;
                    return (
                      <option key={i} value={shortCode}>
                        {s.userName || s.supervisor || s.dealer || shortCode} ({s.workItemCount}项) {new Date(s.updatedAt).toLocaleDateString()}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

export default DirectSalesProductGroupPage;
