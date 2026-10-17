import { useState, useMemo, useEffect, Fragment } from 'react';
import { Calendar, RefreshCw, FileSpreadsheet, FileText, Search } from 'lucide-react';
import { getShopDiagnosis } from '../../api/reports';
import { getShops } from '../../api/shops';
import type { ShopDiagnosis } from '../../types';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// 指标定义：key 对应 ShopDiagnosis 字段前缀（current/mom/year 前缀拼接）
const PERIODS = ['current', 'mom', 'year'] as const;
const PERIOD_LABEL: Record<string, string> = { current: '本', mom: '环', year: '同' };

// extra：在该指标周期列（本/环/同）之后追加的额外列
type MetricDef = {
  key: string;
  label: string;
  fmt: (v: number) => string;
  extra?: {
    label: string;
    value: (row: ShopDiagnosis) => number;
    fmt: (v: number) => string;
  };
};
const METRICS: MetricDef[] = [
  {
    key: 'Amount', label: '业绩', fmt: (v) => Math.round(v).toLocaleString('zh-CN', { useGrouping: false }),
    extra: {
      label: '同比',
      // 业绩同比 = 本期 / 同期 - 1（百分比），同期为 0 时按 0 处理，避免除零报错
      value: (row) => {
        const y = row.yearAmount || 0;
        const c = row.currentAmount || 0;
        return y > 0 ? (c / y - 1) * 100 : 0;
      },
      fmt: (v) => (v > 0 ? `+${v.toFixed(1)}%` : v < 0 ? `${v.toFixed(1)}%` : '0.0%'),
    },
  },
  { key: 'Quantity', label: '销量', fmt: (v) => Math.round(v).toLocaleString('zh-CN', { useGrouping: false }) },
  { key: 'AttachmentRate', label: '连带率', fmt: (v) => v.toFixed(2) },
  { key: 'OrderCount', label: '开单数', fmt: (v) => Math.round(v).toLocaleString('zh-CN', { useGrouping: false }) },
  { key: 'AvgItemPrice', label: '件单价', fmt: (v) => Math.round(v).toLocaleString('zh-CN', { useGrouping: false }) },
  { key: 'AvgOrderValue', label: '客单价', fmt: (v) => Math.round(v).toLocaleString('zh-CN', { useGrouping: false }) },
  { key: 'GiftCount', label: '礼包数', fmt: (v) => Math.round(v).toLocaleString('zh-CN', { useGrouping: false }) },
  { key: 'GiftAmount', label: '礼包额', fmt: (v) => Math.round(v).toLocaleString('zh-CN', { useGrouping: false }) },
  { key: 'GiftRatio', label: '礼包占比', fmt: (v) => v.toFixed(1) + '%' },
  { key: 'NewMember', label: '新增会员', fmt: (v) => Math.round(v).toLocaleString('zh-CN', { useGrouping: false }) },
  { key: 'MemberContribution', label: '会员贡献', fmt: (v) => Math.round(v).toLocaleString('zh-CN', { useGrouping: false }) },
  { key: 'MemberContributionRatio', label: '会员贡献占比', fmt: (v) => v.toFixed(1) + '%' },
];

// 每个指标占用的列数（周期列 + 可能的额外列）
const metricColSpan = (m: MetricDef) => PERIODS.length + (m.extra ? 1 : 0);

function shiftDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 聚合一组行：累加型指标求和，比率类指标按合计重算
function aggregateRows(rows: ShopDiagnosis[]): ShopDiagnosis {
  const sum = (f: (r: ShopDiagnosis) => number) => rows.reduce((s, r) => s + f(r), 0);
  const amount = sum((r) => r.currentAmount);
  const momAmount = sum((r) => r.momAmount);
  const yearAmount = sum((r) => r.yearAmount);
  const quantity = sum((r) => r.currentQuantity);
  const momQuantity = sum((r) => r.momQuantity);
  const yearQuantity = sum((r) => r.yearQuantity);
  const orderCount = sum((r) => r.currentOrderCount);
  const momOrderCount = sum((r) => r.momOrderCount);
  const yearOrderCount = sum((r) => r.yearOrderCount);
  const giftCount = sum((r) => r.currentGiftCount);
  const momGiftCount = sum((r) => r.momGiftCount);
  const yearGiftCount = sum((r) => r.yearGiftCount);
  const giftAmount = sum((r) => r.currentGiftAmount);
  const momGiftAmount = sum((r) => r.momGiftAmount);
  const yearGiftAmount = sum((r) => r.yearGiftAmount);
  const newMember = sum((r) => r.currentNewMember);
  const momNewMember = sum((r) => r.momNewMember);
  const yearNewMember = sum((r) => r.yearNewMember);
  const memberContribution = sum((r) => r.currentMemberContribution);
  const momMemberContribution = sum((r) => r.momMemberContribution);
  const yearMemberContribution = sum((r) => r.yearMemberContribution);

  return {
    ...rows[0],
    currentAmount: amount, momAmount, yearAmount,
    currentQuantity: quantity, momQuantity, yearQuantity,
    currentOrderCount: orderCount, momOrderCount, yearOrderCount,
    currentAttachmentRate: orderCount > 0 ? quantity / orderCount : 0,
    momAttachmentRate: momOrderCount > 0 ? momQuantity / momOrderCount : 0,
    yearAttachmentRate: yearOrderCount > 0 ? yearQuantity / yearOrderCount : 0,
    currentAvgItemPrice: quantity > 0 ? amount / quantity : 0,
    momAvgItemPrice: momQuantity > 0 ? momAmount / momQuantity : 0,
    yearAvgItemPrice: yearQuantity > 0 ? yearAmount / yearQuantity : 0,
    currentAvgOrderValue: orderCount > 0 ? amount / orderCount : 0,
    momAvgOrderValue: momOrderCount > 0 ? momAmount / momOrderCount : 0,
    yearAvgOrderValue: yearOrderCount > 0 ? yearAmount / yearOrderCount : 0,
    currentGiftCount: giftCount, momGiftCount, yearGiftCount,
    currentGiftAmount: giftAmount, momGiftAmount, yearGiftAmount,
    currentGiftRatio: amount > 0 ? (giftAmount / amount) * 100 : 0,
    momGiftRatio: momAmount > 0 ? (momGiftAmount / momAmount) * 100 : 0,
    yearGiftRatio: yearAmount > 0 ? (yearGiftAmount / yearAmount) * 100 : 0,
    currentNewMember: newMember, momNewMember, yearNewMember,
    currentMemberContribution: memberContribution, momMemberContribution, yearMemberContribution,
    currentMemberContributionRatio: amount > 0 ? (memberContribution / amount) * 100 : 0,
    momMemberContributionRatio: momAmount > 0 ? (momMemberContribution / momAmount) * 100 : 0,
    yearMemberContributionRatio: yearAmount > 0 ? (yearMemberContribution / yearAmount) * 100 : 0,
  };
}

function ShopDiagnosisPage() {
  const { user } = useAuthStore();

  const today = new Date();
  const [currentStart, setCurrentStart] = useState(fmtDate(shiftDays(today, -6)));
  const [currentEnd, setCurrentEnd] = useState(fmtDate(today));
  const [momStart, setMomStart] = useState(fmtDate(shiftDays(today, -13)));
  const [momEnd, setMomEnd] = useState(fmtDate(shiftDays(today, -7)));
  const [yearStart, setYearStart] = useState(fmtDate(shiftDays(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()), -6)));
  const [yearEnd, setYearEnd] = useState(fmtDate(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())));

  const [diagnosisData, setDiagnosisData] = useState<ShopDiagnosis[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const shopCmp = (d: { shopName?: string }) => shopComparableMap[String(d?.shopName || '').trim()] || { mc: '', yc: '' };

  const areaSupervisorShopFilter = useAreaSupervisorShopFilter<ShopDiagnosis>(diagnosisData, {
    getArea: (d) => d.area,
    getSupervisor: (d) => d.supervisor,
    getShopName: (d) => d.shopName,
    getWarehouseType: (d: any) => d.warehouseType,
    getDistrictManager: (d) => d.districtManager,
    getDealer: (d) => d.dealer,
    getMonthComparable: (d) => shopCmp(d).mc,
    getYearComparable: (d) => shopCmp(d).yc,
    monthComparableOptions: comparableOptions.month,
    yearComparableOptions: comparableOptions.year,
  });

  const [searchText, setSearchText] = useState('');
  const filteredData = useMemo(() => {
    let result = areaSupervisorShopFilter.filteredData;
    if (searchText.trim()) {
      const kw = searchText.trim().toLowerCase();
      result = result.filter(d =>
        (d.supervisor || '').toLowerCase().includes(kw) ||
        (d.districtManager || '').toLowerCase().includes(kw) ||
        (d.shopName || '').toLowerCase().includes(kw)
      );
    }
    return result;
  }, [areaSupervisorShopFilter.filteredData, searchText]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const params = {
        currentStartDate: currentStart,
        currentEndDate: currentEnd,
        momStartDate: momStart,
        momEndDate: momEnd,
        yearStartDate: yearStart,
        yearEndDate: yearEnd,
        groupName: user?.groupName || undefined,
      };
      const result = await getShopDiagnosis(params);
      setDiagnosisData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载数据失败');
      console.error('Failed to load shop diagnosis:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleResetDates = () => {
    const t = new Date();
    setCurrentStart(fmtDate(shiftDays(t, -6)));
    setCurrentEnd(fmtDate(t));
    setMomStart(fmtDate(shiftDays(t, -13)));
    setMomEnd(fmtDate(shiftDays(t, -7)));
    const ly = new Date(t.getFullYear() - 1, t.getMonth(), t.getDate());
    setYearStart(fmtDate(shiftDays(ly, -6)));
    setYearEnd(fmtDate(ly));
  };

  useEffect(() => { loadData(); }, []);

  // 板块一：按 区经+督导+经销商 汇总（比率类指标需按合计重算）
  const section1Rows = useMemo(() => {
    const groupMap = new Map<string, ShopDiagnosis[]>();
    filteredData.forEach((d) => {
      const key = `${d.districtManager}|${d.supervisor}|${d.dealer}`;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(d);
    });
    return Array.from(groupMap.values()).map((rows) => aggregateRows(rows));
  }, [filteredData]);

  // 导出 Excel：两个板块各一个 sheet
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const buildSheet = (rows: ShopDiagnosis[], showShopName: boolean, sheetName: string) => {
      const groupCols = showShopName ? 4 : 3;
      const header1: any[] = ['区经', '督导', '经销商'];
      if (showShopName) header1.push('店铺名称');
      METRICS.forEach(m => header1.push(m.label, '', '', ...(m.extra ? [''] : [])));
      const header2: any[] = Array(groupCols).fill('');
      METRICS.forEach(m => {
        PERIODS.forEach(p => header2.push(PERIOD_LABEL[p]));
        if (m.extra) header2.push(m.extra.label);
      });

      const aoa: any[][] = [header1, header2];
      rows.forEach(row => {
        const line: any[] = [row.districtManager, row.supervisor, row.dealer];
        if (showShopName) line.push(row.shopName);
        METRICS.forEach(m => {
          PERIODS.forEach(p => line.push((row as any)[`${p}${m.key}`] || 0));
          if (m.extra) line.push(m.extra.fmt(m.extra.value(row)));
        });
        aoa.push(line);
      });
      if (rows.length > 0) {
        const total = aggregateRows(rows);
        const line: any[] = ['合计', '-', '-'];
        if (showShopName) line.push(`${rows.length}家店铺`);
        METRICS.forEach(m => {
          PERIODS.forEach(p => line.push((total as any)[`${p}${m.key}`] || 0));
          if (m.extra) line.push(m.extra.fmt(m.extra.value(total)));
        });
        aoa.push(line);
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const merges: any[] = [];
      let startCol = groupCols;
      METRICS.forEach(m => {
        const span = PERIODS.length + (m.extra ? 1 : 0);
        merges.push({ s: { r: 0, c: startCol }, e: { r: 0, c: startCol + span - 1 } });
        startCol += span;
      });
      for (let c = 0; c < groupCols; c++) {
        merges.push({ s: { r: 0, c }, e: { r: 1, c } });
      }
      ws['!merges'] = merges;
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    };

    buildSheet(section1Rows, false, '区经督导经销商汇总');
    buildSheet(filteredData, true, '店铺明细');
    XLSX.writeFile(wb, `店铺诊断_${currentStart}_${currentEnd}.xlsx`);
  };

  // 导出 PDF：截图诊断区域
  const exportPDF = async () => {
    const el = document.querySelector('.diagnosis-export-container') as HTMLElement;
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
    pdf.save(`店铺诊断_${currentStart}_${currentEnd}.pdf`);
  };

  const renderTable = (rows: ShopDiagnosis[], showShopName: boolean) => {
    const metricCols = METRICS.reduce((sum, m) => sum + metricColSpan(m), 0);
    const totalCols = (showShopName ? 4 : 3) + metricCols;
    const totalRow = rows.length > 0 ? aggregateRows(rows) : null;
    return (
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs w-full" style={{ minWidth: 2400 }}>
          <thead>
            <tr className="bg-gray-100">
              <th rowSpan={2} className="border border-gray-400 px-3 py-2 text-gray-700 sticky left-0 bg-gray-100 z-20">区经</th>
              <th rowSpan={2} className="border border-gray-400 px-3 py-2 text-gray-700 sticky left-[90px] bg-gray-100 z-20">督导</th>
              <th rowSpan={2} className="border border-gray-400 px-3 py-2 text-gray-700 sticky left-[170px] bg-gray-100 z-20">经销商</th>
              {showShopName && (
                <th rowSpan={2} className="border border-gray-400 px-3 py-2 text-gray-700 sticky left-[250px] bg-gray-100 z-20">店铺名称</th>
              )}
              {METRICS.map((m) => (
                <th key={m.key} colSpan={metricColSpan(m)} className="border border-gray-400 px-2 py-1.5 text-gray-700">{m.label}</th>
              ))}
            </tr>
            <tr className="bg-gray-100">
              {METRICS.map((m) => (
                <Fragment key={m.key}>
                  {PERIODS.map((p) => (
                    <th key={m.key + p} className="border border-gray-400 px-1 py-1 text-gray-500 font-normal">{PERIOD_LABEL[p]}</th>
                  ))}
                  {m.extra && (
                    <th key={m.key + 'extra'} className="border border-gray-400 px-1 py-1 text-gray-500 font-normal">{m.extra.label}</th>
                  )}
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rows.map((row, idx) => {
              const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50';
              return (
              <tr key={idx} className={rowBg}>
                <td className={`border border-gray-300 px-3 py-2 text-gray-800 sticky left-0 z-10 whitespace-nowrap ${rowBg}`}>{row.districtManager}</td>
                <td className={`border border-gray-300 px-3 py-2 text-gray-600 sticky left-[90px] z-10 whitespace-nowrap ${rowBg}`}>{row.supervisor}</td>
                <td className={`border border-gray-300 px-3 py-2 text-gray-600 sticky left-[170px] z-10 whitespace-nowrap ${rowBg}`}>{row.dealer}</td>
                {showShopName && (
                  <td className={`border border-gray-300 px-3 py-2 text-gray-800 font-medium sticky left-[250px] z-10 whitespace-nowrap ${rowBg}`}>{row.shopName}</td>
                )}
                {METRICS.map((m) => (
                  <Fragment key={m.key}>
                    {PERIODS.map((p) => {
                      const val = (row as any)[`${p}${m.key}`] as number;
                      return (
                        <td key={m.key + p} className={`border border-gray-300 px-1 py-2 text-right whitespace-nowrap ${p === 'current' ? 'font-bold text-gray-900' : 'text-gray-500'}`}>
                          {m.fmt(val || 0)}
                        </td>
                      );
                    })}
                    {m.extra && (
                      <td key={m.key + 'extra'} className={`border border-gray-300 px-1 py-2 text-right whitespace-nowrap ${m.extra.value(row) > 0 ? 'text-green-600 font-bold' : m.extra.value(row) < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                        {m.extra.fmt(m.extra.value(row))}
                      </td>
                    )}
                  </Fragment>
                ))}
              </tr>
              );
            })}
            {totalRow && (
              <tr className="bg-yellow-50 font-bold">
                <td className="border border-gray-300 px-3 py-2 text-gray-900 sticky left-0 bg-yellow-50 z-10 whitespace-nowrap">合计</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-600 sticky left-[90px] bg-yellow-50 z-10 whitespace-nowrap">-</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-600 sticky left-[170px] bg-yellow-50 z-10 whitespace-nowrap">-</td>
                {showShopName && (
                  <td className="border border-gray-300 px-3 py-2 text-gray-800 sticky left-[250px] bg-yellow-50 z-10 whitespace-nowrap">{rows.length}家店铺</td>
                )}
                {METRICS.map((m) => (
                  <Fragment key={m.key}>
                    {PERIODS.map((p) => {
                      const val = (totalRow as any)[`${p}${m.key}`] as number;
                      return (
                        <td key={m.key + p} className={`border border-gray-300 px-1 py-2 text-right whitespace-nowrap ${p === 'current' ? 'font-bold text-gray-900' : 'text-gray-600'}`}>
                          {m.fmt(val || 0)}
                        </td>
                      );
                    })}
                    {m.extra && (
                      <td key={m.key + 'extra'} className={`border border-gray-300 px-1 py-2 text-right whitespace-nowrap font-bold ${m.extra.value(totalRow) > 0 ? 'text-green-600' : m.extra.value(totalRow) < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                        {m.extra.fmt(m.extra.value(totalRow))}
                      </td>
                    )}
                  </Fragment>
                ))}
              </tr>
            )}
            {rows.length === 0 && (
              <tr>
                <td colSpan={totalCols} className="border border-gray-300 px-4 py-8 text-center text-gray-400">暂无数据</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <Layout title="店铺诊断" subtitle="销售指标本环同对比分析">
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <p className="text-red-600">数据加载失败: {error}</p>
            <button onClick={loadData} className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600">重新加载</button>
          </div>
        </div>
      )}

      <div className="w-full">
        <div className="flex justify-between items-center mb-6 gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-600">本期:</span>
              <input type="date" value={currentStart} onChange={(e) => setCurrentStart(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs" />
              <span className="text-gray-400">至</span>
              <input type="date" value={currentEnd} onChange={(e) => setCurrentEnd(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-600">环期:</span>
              <input type="date" value={momStart} onChange={(e) => setMomStart(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs" />
              <span className="text-gray-400">至</span>
              <input type="date" value={momEnd} onChange={(e) => setMomEnd(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-600">同期:</span>
              <input type="date" value={yearStart} onChange={(e) => setYearStart(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs" />
              <span className="text-gray-400">至</span>
              <input type="date" value={yearEnd} onChange={(e) => setYearEnd(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleResetDates} className="flex items-center gap-1 px-3 py-1 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200"><Calendar size={14} />重置日期</button>
            <button onClick={loadData} disabled={loading} className="flex items-center gap-1 px-3 py-1 bg-primary text-white rounded text-sm hover:bg-primary-dark disabled:opacity-50"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />刷新数据</button>
            <button onClick={exportExcel} disabled={filteredData.length === 0} className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"><FileSpreadsheet size={14} />导出Excel</button>
            <button onClick={exportPDF} disabled={filteredData.length === 0} className="flex items-center gap-1 px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50"><FileText size={14} />导出PDF</button>
          </div>
        </div>

        <div className="mb-4 bg-white rounded-lg shadow p-4 flex items-center gap-3 flex-wrap">
          <AreaSupervisorShopFilter filter={areaSupervisorShopFilter} />
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

        {loading ? (
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-8 diagnosis-export-container">
            {/* 板块一：区经/督导/经销商 汇总 */}
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-200 bg-blue-50">
                <h3 className="font-bold text-blue-700">第一板块 · 区经 / 督导 / 经销商汇总</h3>
              </div>
              {renderTable(section1Rows, false)}
            </div>

            {/* 板块二：店铺明细 */}
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-200 bg-green-50">
                <h3 className="font-bold text-green-700">第二板块 · 店铺明细</h3>
              </div>
              {renderTable(filteredData, true)}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default ShopDiagnosisPage;
