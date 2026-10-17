import { useState, useEffect, useMemo } from 'react';
import { Save, RefreshCw, Upload, Trash2, X } from 'lucide-react';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';
import { getSalesReport } from '../../api/reports';
import type { SalesReport } from '../../types';
import axios from '../../api/axios';
import * as XLSX from 'xlsx';

const TARGET_FIELDS = [
  'monthTarget','springTarget','summerTarget','autumnTarget','winterTarget',
  'newProductTarget','oldProductTarget','mainProductTarget',
  'menShoesTarget','womenShoesTarget','kidsShoesTarget','bagTarget',
];
const FIELD_LABELS = ['销量指标','新春目标','新夏目标','新秋目标','新冬目标','新品目标','老品目标','主推款目标','男鞋目标','女鞋目标','童鞋目标','包包目标'];

function decomposeMonthlyTarget(monthlyTarget: number, year: number, month: number) {
  if (monthlyTarget <= 0) return [];
  const coeffs: Record<string, number> = { '周一': 1.0, '周二': 1.0, '周三': 1.0, '周四': 1.0, '周五': 1.1, '周六': 1.5, '周日': 1.2 };
  const dim = new Date(year, month, 0).getDate();
  const weekDayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const days: { dayIndex: number; date: string; dayOfWeek: string; coefficient: number }[] = [];
  for (let d = 1; d <= dim; d++) {
    const dt = new Date(year, month - 1, d);
    days.push({ dayIndex: d, date: `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`, dayOfWeek: weekDayNames[dt.getDay()], coefficient: coeffs[weekDayNames[dt.getDay()]] || 1.0 });
  }
  const result: { day: number; date: string; dayOfWeek: string; dailyTarget: number }[] = [];
  const segs = [
    { days: days.filter(d => d.dayIndex <= 15), ratio: 0.6 },
    { days: days.filter(d => d.dayIndex > 15 && d.dayIndex <= 28), ratio: 0.4 },
    { days: days.filter(d => d.dayIndex > 28), ratio: 0 },
  ];
  segs.forEach(seg => {
    const totalWeight = seg.days.reduce((s, d) => s + d.coefficient, 0);
    const segTotal = Math.round(monthlyTarget * seg.ratio);
    let allocated = 0;
    seg.days.forEach((d, i) => {
      const v = i < seg.days.length - 1 ? Math.round(d.coefficient * segTotal / totalWeight) : segTotal - allocated;
      allocated += v;
      result.push({ day: d.dayIndex, date: d.date, dayOfWeek: d.dayOfWeek, dailyTarget: v });
    });
  });
  return result.sort((a, b) => a.day - b.day);
}

function DailyProductTargetUploadPage() {
  const pageTitle = '日常商品指标上传';
  const { user } = useAuthStore();
  const now = new Date();
  const [monthYear, setMonthYear] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [salesData, setSalesData] = useState<SalesReport[]>([]);
  const [shopArchiveMap, setShopArchiveMap] = useState<Record<string, { product: string; productLeader: string }>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [targets, setTargets] = useState<Record<string, Record<string, number>>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [decomposeModal, setDecomposeModal] = useState<{ shopName: string; fieldKey: string; fieldLabel: string } | null>(null);
  const [decomposedData, setDecomposedData] = useState<{ day: number; date: string; dayOfWeek: string; dailyTarget: number }[]>([]);

  const loadShopArchive = async () => {
    try {
      const res = await axios.get(`/shops/archive${user?.groupName ? `?groupName=${encodeURIComponent(user.groupName)}` : ''}`);
      const list = res.data || [];
      const map: Record<string, { product: string; productLeader: string }> = {};
      list.forEach((s: any) => { map[s.shopName] = { product: s.product || '', productLeader: s.productLeader || '' }; });
      setShopArchiveMap(map);
    } catch (e) { console.error(e); }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const result = await getSalesReport('month', 'all', user?.groupName || undefined);
      const data = (result.data || []).filter((r: any) => r.warehouseType !== '加盟');
      setSalesData(data);

      const res = await axios.get(`/daily-product-targets/by-month/${monthYear}`);
      const savedList = res.data || [];
      const t: Record<string, Record<string, number>> = {};
      const st: Record<string, string> = {};
      savedList.forEach((r: any) => {
        const obj: Record<string, number> = {};
        TARGET_FIELDS.forEach(f => { obj[f] = r[f] || 0; });
        t[r.shopName] = obj;
        st[r.shopName] = r.status || 'editing';
      });
      setTargets(t);
      setStatuses(st);
      await loadShopArchive();
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const filter = useAreaSupervisorShopFilter<SalesReport>(salesData, {
    getArea: (r) => r.area,
    getSupervisor: (r) => r.supervisor,
    getShopName: (r) => r.shopName,
    getWarehouseType: (r) => (r as any).warehouseType,
    onChange: () => {},
  });

  const [selectedDealer, setSelectedDealer] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [selectedProductLeader, setSelectedProductLeader] = useState('');

  const dealers = useMemo(() => [...new Set(salesData.map(r => r.districtManager).filter(Boolean))].sort(), [salesData]);
  const productOptions = useMemo(() => [...new Set(Object.values(shopArchiveMap).map(v => v.product).filter(Boolean))].sort(), [shopArchiveMap]);
  const productLeaderOptions = useMemo(() => [...new Set(Object.values(shopArchiveMap).map(v => v.productLeader).filter(Boolean))].sort(), [shopArchiveMap]);

  const filteredData = useMemo(() => {
    let data = filter.filteredData;
    if (selectedDealer) data = data.filter(r => r.districtManager === selectedDealer);
    const arch = shopArchiveMap;
    if (selectedProduct) data = data.filter(r => (arch[r.shopName]?.product || '') === selectedProduct);
    if (selectedProductLeader) data = data.filter(r => (arch[r.shopName]?.productLeader || '') === selectedProductLeader);
    return data;
  }, [filter.filteredData, selectedDealer, selectedProduct, selectedProductLeader, shopArchiveMap]);

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 30;
  const totalPages = Math.max(1, Math.ceil(filteredData.length / pageSize));
  const paginatedData = filteredData.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const allFieldsFilled = (t: Record<string, number> | undefined) => t && TARGET_FIELDS.every(f => (t as any)[f] > 0);

  const fmt = (v: number) => v?.toLocaleString?.('zh-CN', { useGrouping: false }) || '0';

  const saveData = async () => {
    setSaving(true);
    try {
      const records = filteredData.map(r => {
        const arch = shopArchiveMap[r.shopName] || {};
        const t = targets[r.shopName];
        const filled = allFieldsFilled(t);
        return {
          shopName: r.shopName,
          product: arch.product || '',
          productLeader: (r as any).productLeader || arch.productLeader || '',
          ...(t || {}),
          status: filled ? 'locked' : (statuses[r.shopName] || 'editing'),
        };
      });
      await axios.put(`/daily-product-targets/${encodeURIComponent(user?.userCode || '')}/${monthYear}`, { records });
      const newStatuses = { ...statuses };
      records.forEach(r => { if (r.status === 'locked') newStatuses[r.shopName] = 'locked'; });
      setStatuses(newStatuses);
      alert('保存成功（已填满全部指标的店铺已自动锁定）');
    } catch (e: any) { alert('保存失败'); }
    setSaving(false);
  };

  const openDecompose = (shopName: string, fieldKey: string, fieldLabel: string) => {
    const [y, m] = monthYear.split('-').map(Number);
    const t = targets[shopName] || {};
    const val = t[fieldKey] || 0;
    const data = decomposeMonthlyTarget(val, y, m);
    setDecomposedData(data);
    setDecomposeModal({ shopName, fieldKey, fieldLabel });
  };

  const clearAllTargets = async () => {
    if (!confirm(`确定清空 ${monthYear} 所有商品指标目标吗？此操作直接删除数据库数据，不可恢复！`)) return;
    try {
      await axios.delete(`/daily-product-targets/clear/${monthYear}`);
      setTargets({});
      setStatuses({});
      alert('已清空本月目标');
    } catch (e: any) { alert('清空失败: ' + (e?.response?.data?.error || e.message)); }
  };

  const handleLock = async (shopName: string) => {
    const t = targets[shopName];
    if (!t || !TARGET_FIELDS.every(f => (t as any)[f] > 0)) { alert('请先填写全部指标再锁定'); return; }
    try {
      await axios.put(`/daily-product-targets/${encodeURIComponent(user?.userCode || '')}/${monthYear}`, {
        records: [{ shopName, ...t, status: 'locked', product: shopArchiveMap[shopName]?.product || '', productLeader: shopArchiveMap[shopName]?.productLeader || '' }],
      });
      setStatuses(prev => ({ ...prev, [shopName]: 'locked' }));
      alert('已锁定');
    } catch { alert('锁定失败'); }
  };

  const importExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        if (rows.length < 2) { alert('模板至少需要表头+1行数据'); return; }
        const header = rows[0];
        const shopIdx = header.findIndex((h: string) => String(h).includes('店铺名称'));
        if (shopIdx < 0) { alert('模板需包含"店铺名称"列'); return; }
        const newTargets = { ...targets };
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const sn = String(row[shopIdx] || '').trim();
          if (!sn) continue;
          const obj: Record<string, number> = { ...(newTargets[sn] || {}) };
          TARGET_FIELDS.forEach((f, idx) => {
            const val = parseFloat(row[shopIdx + 3 + idx]) || 0;
            if (val > 0) obj[f] = val;
          });
          newTargets[sn] = obj;
        }
        setTargets(newTargets);
        alert('导入完成');
      } catch { alert('导入失败，请检查模板格式'); }
    };
    reader.readAsBinaryString(file);
  };

  const exportTemplate = () => {
    const header = ['店铺名称','商品','组长', ...FIELD_LABELS];
    const data = [header];
    filteredData.forEach(r => {
      const arch = shopArchiveMap[r.shopName] || {};
      const t = targets[r.shopName] || {};
      data.push([r.shopName, arch.product || '', arch.productLeader || '', ...TARGET_FIELDS.map((f: string) => String(t[f] || ''))] as any);
    });
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '商品指标模板');
    XLSX.writeFile(wb, `商品指标上传模板_${monthYear}.xlsx`);
  };

  const th = 'border border-gray-400 px-2 py-1.5 text-xs font-bold text-gray-700 text-center bg-gray-100 align-middle';
  const td = 'border border-gray-400 px-1 py-0.5 text-center align-middle';

  if (!user) return <Layout title={pageTitle}><p className="text-gray-500 p-8">请先登录</p></Layout>;

  return (
    <Layout title={pageTitle} subtitle={`${monthYear} 商品指标填报`}>
      <div className="p-2">
        {/* 筛选器 */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <span className="text-xs text-gray-500 font-bold">月筛选:</span>
          <input type="month" value={monthYear} onChange={e => setMonthYear(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-sm w-36" />
          <button onClick={loadData} disabled={loading} className="px-3 py-1 bg-gray-100 rounded text-sm hover:bg-gray-200"><RefreshCw size={14} className={loading?'animate-spin inline':'inline'} /> 刷新</button>
          <span className="text-xs text-gray-400 mx-1">|</span>
          <span className="text-xs text-gray-500 font-bold">区经:</span>
          <select value={selectedDealer} onChange={e => setSelectedDealer(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs">
            <option value="">全部</option>
            {dealers.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
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
          <AreaSupervisorShopFilter filter={filter as any} />
          <span className="text-xs text-gray-400 mx-1">|</span>
          <button onClick={saveData} disabled={saving} className="px-4 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"><Save size={14} className="inline" /> {saving ? '保存中...' : '保存'}</button>
          <button onClick={clearAllTargets} className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600"><Trash2 size={14} className="inline" /> 清空本月目标</button>
          <button onClick={exportTemplate} className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700">导出模板</button>
          <label className="px-3 py-1 bg-orange-500 text-white rounded text-sm hover:bg-orange-600 cursor-pointer">
            <Upload size={14} className="inline" /> 导入Excel
            <input type="file" accept=".xlsx,.xls" onChange={importExcel} className="hidden" />
          </label>
        </div>

        {loading ? <p className="text-gray-400 py-8 text-center">加载中...</p> : (
          <div className="bg-white border border-gray-400 rounded overflow-x-auto">
            <table className="border-collapse text-xs w-full" style={{ minWidth: 2000 }}>
              <thead>
                <tr className="bg-blue-50">
                  <th className={th} style={{width:'80px'}}>序号</th>
                  <th className={th} style={{width:'130px'}}>店铺名称</th>
                  <th className={th} style={{width:'80px'}}>商品</th>
                  <th className={th} style={{width:'80px'}}>组长</th>
                  {FIELD_LABELS.map((l, i) => (
                    <th key={i} className={th} style={{width:'75px'}}>{l}</th>
                  ))}
                  <th className={th} style={{width:'70px'}}>状态</th>
                  <th className={th} style={{width:'70px'}}>操作</th>
                </tr>
              </thead>
              <tbody>
                {paginatedData.map((r, i) => {
                  const shopT = targets[r.shopName] || {};
                  const arch = shopArchiveMap[r.shopName] || {};
                  const locked = (statuses[r.shopName] || '') === 'locked';
                  const isRowFilled = allFieldsFilled(shopT);
                  return (
                    <tr key={r.shopName} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className={td}>{(currentPage - 1) * pageSize + i + 1}</td>
                      <td className={td} style={{fontWeight:'bold'}}>{r.shopName}</td>
                      <td className={td}>{arch.product || '-'}</td>
                      <td className={td}>{arch.productLeader || '-'}</td>
                      {TARGET_FIELDS.map((f, fi) => (
                        <td key={f} className={td}>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              className={`flex-1 px-1 py-1 border rounded text-center text-xs ${locked ? 'bg-gray-100 border-gray-200 cursor-not-allowed text-red-600 font-bold' : 'border-gray-300'}`}
                              value={shopT[f] || ''}
                              disabled={locked}
                              onChange={e => {
                                if (locked) return;
                              setTargets(prev => {
                                const cur = { ...(prev[r.shopName] || {}) };
                                cur[f] = parseFloat(e.target.value) || 0;
                                return { ...prev, [r.shopName]: cur };
                              });
                            }}
                          />
                          {(shopT[f] || 0) > 0 && (
                            <button
                              onClick={() => openDecompose(r.shopName, f, FIELD_LABELS[fi])}
                              className="flex-shrink-0 w-4 h-4 bg-blue-100 text-blue-600 rounded text-[10px] hover:bg-blue-200 flex items-center justify-center"
                              title="分解到日"
                            >日</button>
                          )}
                          </div>
                        </td>
                      ))}
                      <td className={td}>
                        <span className={`text-xs font-bold px-1 py-0.5 rounded ${locked ? 'bg-red-100 text-red-600' : isRowFilled ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'}`}>
                          {locked ? '已锁定' : isRowFilled ? '可锁定' : '编辑中'}
                        </span>
                      </td>
                      <td className={td}>
                        {locked ? (
                          <span className="text-gray-300 text-xs">锁定</span>
                        ) : (
                          <button onClick={() => handleLock(r.shopName)} className="px-2 py-0.5 bg-red-500 text-white rounded text-xs hover:bg-red-600" disabled={!isRowFilled}>
                            锁定
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {paginatedData.length === 0 && (
                  <tr><td colSpan={6 + TARGET_FIELDS.length} className="border border-gray-400 px-6 py-4 text-center text-gray-400">暂无数据</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-3">
            <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className="px-2 py-1 border rounded text-xs disabled:opacity-30">首页</button>
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-2 py-1 border rounded text-xs disabled:opacity-30">上一页</button>
            <span className="text-xs text-gray-500">{currentPage} / {totalPages}</span>
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-2 py-1 border rounded text-xs disabled:opacity-30">下一页</button>
            <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} className="px-2 py-1 border rounded text-xs disabled:opacity-30">末页</button>
          </div>
        )}
        {/* 分解到日弹窗 */}
        {decomposeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setDecomposeModal(null)}>
            <div className="bg-white rounded-lg shadow-2xl p-4 max-w-4xl w-full max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-blue-600">
                  {decomposeModal.shopName} - {decomposeModal.fieldLabel} 分解到日
                  <span className="text-xs text-gray-400 ml-2">({monthYear})</span>
                </h3>
                <button onClick={() => setDecomposeModal(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>
              {decomposedData.length === 0 ? (
                <p className="text-gray-400 text-center py-4">目标为0，无需分解</p>
              ) : (
                <table className="border-collapse text-xs w-full">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border border-gray-300 px-2 py-1">日期</th>
                      <th className="border border-gray-300 px-2 py-1">星期</th>
                      <th className="border border-gray-300 px-2 py-1 text-right">日目标</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decomposedData.map((d, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="border border-gray-300 px-2 py-1 text-center">{d.date}</td>
                        <td className="border border-gray-300 px-2 py-1 text-center">{d.dayOfWeek}</td>
                        <td className="border border-gray-300 px-2 py-1 text-right font-bold" style={{color: d.dailyTarget > 0 ? '#2563eb' : '#ccc'}}>{d.dailyTarget > 0 ? d.dailyTarget : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-yellow-100 font-bold">
                      <td className="border border-gray-300 px-2 py-1 text-center" colSpan={2}>合计</td>
                      <td className="border border-gray-300 px-2 py-1 text-right">{decomposedData.reduce((s, d) => s + d.dailyTarget, 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default DailyProductTargetUploadPage;
