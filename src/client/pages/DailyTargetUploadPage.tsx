import { useState, useEffect } from 'react';
import { Save, RefreshCw, Upload, Trash2, X } from 'lucide-react';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';
import { getSalesReport } from '../../api/reports';
import type { SalesReport } from '../../types';
import axios from '../../api/axios';
import * as XLSX from 'xlsx';

function DailyTargetUploadPage() {
  const { user } = useAuthStore();
  const now = new Date();
  const [monthYear, setMonthYear] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [salesData, setSalesData] = useState<SalesReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [targets, setTargets] = useState<Record<string, Record<string, number>>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [changeData, setChangeData] = useState<Record<string, Record<string, number>>>({});
  const [changeModalShop, setChangeModalShop] = useState<string | null>(null);
  const [changeForm, setChangeForm] = useState<Record<string, number>>({});
  const [decomposeModal, setDecomposeModal] = useState<{ shopName: string; fieldKey: string; fieldLabel: string } | null>(null);
  const [decomposedData, setDecomposedData] = useState<{ day: number; date: string; dayOfWeek: string; dailyTarget: number }[]>([]);
  const fields = ['orderCountTarget','giftRatioTarget','newMemberTarget','attachmentRateTarget','mainProductTarget','oldMemberTarget','birthdayTarget'];
  const fieldLabels = ['开单数目标','礼包量指标','新增会员指标','连带率指标','主推款指标','老会员贡献指标','生日会员贡献指标'];

  function decomposeMonthlyTarget(monthlyTarget: number, year: number, month: number, fieldKey?: string) {
    if (monthlyTarget <= 0) return [];
    const coeffs: Record<string, number> = { '周一': 1.0, '周二': 1.0, '周三': 1.0, '周四': 1.0, '周五': 1.1, '周六': 1.5, '周日': 1.2 };
    const dim = new Date(year, month, 0).getDate();
    const weekDayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const days: { dayIndex: number; date: string; dayOfWeek: string; coefficient: number }[] = [];
    for (let d = 1; d <= dim; d++) {
      const dt = new Date(year, month - 1, d);
      days.push({ dayIndex: d, date: `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`, dayOfWeek: weekDayNames[dt.getDay()], coefficient: coeffs[weekDayNames[dt.getDay()]] || 1.0 });
    }
    // 连带率每天目标相同，不除以天数
    if (fieldKey === 'attachmentRateTarget') {
      return days.map(d => ({ day: d.dayIndex, date: d.date, dayOfWeek: d.dayOfWeek, dailyTarget: monthlyTarget }));
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

  const isAdmin = user?.isAdmin === '是' || (user?.groupName || '').includes('管理');
  const isDirector = (user?.roleNames || []).includes('运营总监') || (user?.groupName || '').includes('总监') || (user?.groupName || '').includes('总');
  const canApprove = isAdmin || isDirector; // 管理和总监可审批

  const isShopLocked = (shopName: string) => {
    const s = statuses[shopName] || 'editing';
    return s === 'locked' || s === 'approved';
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const result = await getSalesReport('month', 'all', user?.groupName || undefined);
      const data = result.data || [];
      setSalesData(data);

      // 所有用户查看全部指标（权限内），保存时仍按 userCode 区分
      const url = `/daily-shop-targets/by-month/${monthYear}`;
      const res = await axios.get(url);
      const savedList = res.data || [];
      const t: Record<string, Record<string, number>> = {};
      savedList.forEach((r: any) => {
        t[r.shopName] = {
          orderCountTarget: r.orderCountTarget || 0,
          giftRatioTarget: r.giftRatioTarget || 0,
          newMemberTarget: r.newMemberTarget || 0,
          attachmentRateTarget: r.attachmentRateTarget || 0,
          mainProductTarget: r.mainProductTarget || 0,
          oldMemberTarget: r.oldMemberTarget || 0,
          birthdayTarget: r.birthdayTarget || 0,
        };
      });
      const st: Record<string, string> = {};
      savedList.forEach((r: any) => { st[r.shopName] = r.status || 'editing'; });
      const cd: Record<string, Record<string, number>> = {};
      savedList.forEach((r: any) => {
        if (r.changeData) {
          try { cd[r.shopName] = JSON.parse(r.changeData); } catch {}
        }
      });
      setStatuses(st);
      setTargets(t);
      setChangeData(cd);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []); // 仅首次挂载加载，后续点刷新/保存才更新

  const filter = useAreaSupervisorShopFilter<SalesReport>(salesData, {
    getArea: (r) => r.area,
    getSupervisor: (r) => r.supervisor,
    getShopName: (r) => r.shopName,
    getWarehouseType: (r) => (r as any).warehouseType,
    onChange: () => {},
  });

  const filteredSalesData = filter.filteredData;
  const [selectedDealer, setSelectedDealer] = useState('');
  const dealers = [...new Set(filteredSalesData.map(r => r.districtManager).filter(Boolean))].sort();
  const displayData = selectedDealer ? filteredSalesData.filter(r => r.districtManager === selectedDealer) : filteredSalesData;

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 30;
  const totalPages = Math.max(1, Math.ceil(displayData.length / pageSize));
  const paginatedData = displayData.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  
  const allFieldsFilled = (t: Record<string, number> | undefined) => t && fields.every(f => (t as any)[f] > 0);

  const saveData = async () => {
    setSaving(true);
    try {
      const records = displayData.map(r => {
        const t = targets[r.shopName];
        const filled = allFieldsFilled(t);
        return {
          shopName: r.shopName,
          districtManager: r.districtManager || '',
          supervisor: r.supervisor || '',
          ...(t || {}),
          status: filled ? 'locked' : (statuses[r.shopName] || 'editing'),
        };
      });
      await axios.put(`/daily-shop-targets/${encodeURIComponent(user?.userCode || '')}/${monthYear}`, { records });
      // 更新本地状态：全部填完的自动锁定
      const newStatuses = { ...statuses };
      records.forEach(r => { if (r.status === 'locked') newStatuses[r.shopName] = 'locked'; });
      setStatuses(newStatuses);
      alert('保存成功（已填满7项指标的店铺已自动锁定）');
    } catch (e: any) { alert('保存失败'); }
    setSaving(false);
  };

  const openDecompose = (shopName: string, fieldKey: string, fieldLabel: string) => {
    const [y, m] = monthYear.split('-').map(Number);
    const t = targets[shopName] || {};
    const val = t[fieldKey] || 0;
    const data = decomposeMonthlyTarget(val, y, m, fieldKey);
    setDecomposedData(data);
    setDecomposeModal({ shopName, fieldKey, fieldLabel });
  };

  const patchStatus = async (shopName: string, status: string) => {
    try {
      await axios.patch(`/daily-shop-targets/${encodeURIComponent(user?.userCode || '')}/${monthYear}/${encodeURIComponent(shopName)}`, { status });
      setStatuses(prev => ({ ...prev, [shopName]: status }));
      if (status === 'approved') alert('已审批通过，数据已锁定写入');
      else if (status === 'locked') alert('已锁定');
      else if (status === 'pending_change') alert('已提交变更申请，等待审批');
    } catch (e: any) { alert('操作失败: ' + (e.message || '')); }
  };

  const handleLock = async (shopName: string) => {
    const t = targets[shopName];
    if (!t || !fields.every(f => (t as any)[f] > 0)) { alert('请先填写全部7项指标再锁定'); return; }
    await patchStatus(shopName, 'locked');
  };

  const openChangeModal = (shopName: string) => {
    const current = targets[shopName] || {};
    const init: Record<string, number> = {};
    fields.forEach(f => { init[f] = (current as any)[f] || 0; });
    setChangeForm(init);
    setChangeModalShop(shopName);
  };

  const submitChangeRequest = async () => {
    if (!changeModalShop) return;
    try {
      await axios.patch(`/daily-shop-targets/request-change/${monthYear}/${encodeURIComponent(changeModalShop)}`, { changeData: changeForm });
      setChangeData(prev => ({ ...prev, [changeModalShop]: { ...changeForm } }));
      setStatuses(prev => ({ ...prev, [changeModalShop]: 'pending_change' }));
      setChangeModalShop(null);
      alert('已提交变更申请，等待审批');
    } catch (e: any) { alert('提交失败: ' + (e.message || '')); }
  };

  const handleApprove = async (shopName: string) => {
    try {
      await axios.patch(`/daily-shop-targets/approve/${monthYear}/${encodeURIComponent(shopName)}`);
      const url = (isAdmin || isDirector)
        ? `/daily-shop-targets/by-month/${monthYear}`
        : `/daily-shop-targets/${encodeURIComponent(user?.userCode || '')}/${monthYear}`;
      const res = await axios.get(url);
      const savedList = res.data || [];
      const t = { ...targets };
      const st = { ...statuses };
      const cd = { ...changeData };
      savedList.forEach((r: any) => {
        t[r.shopName] = {
          orderCountTarget: r.orderCountTarget || 0,
          giftRatioTarget: r.giftRatioTarget || 0,
          newMemberTarget: r.newMemberTarget || 0,
          attachmentRateTarget: r.attachmentRateTarget || 0,
          mainProductTarget: r.mainProductTarget || 0,
          oldMemberTarget: r.oldMemberTarget || 0,
          birthdayTarget: r.birthdayTarget || 0,
        };
        st[r.shopName] = r.status || 'editing';
        if (r.changeData) { try { cd[r.shopName] = JSON.parse(r.changeData); } catch {} } else { delete cd[r.shopName]; }
      });
      setTargets(t);
      setStatuses(st);
      setChangeData(cd);
      alert('已审批通过，变更数据已写入');
    } catch (e: any) { alert('审批失败: ' + (e.message || '')); }
  };

  const handleReject = async (shopName: string) => {
    if (!confirm('确定拒绝该变更申请？店铺将恢复锁定状态。')) return;
    try {
      await axios.patch(`/daily-shop-targets/reject/${monthYear}/${encodeURIComponent(shopName)}`);
      setStatuses(prev => ({ ...prev, [shopName]: 'locked' }));
      setChangeData(prev => { const n = { ...prev }; delete n[shopName]; return n; });
      alert('已拒绝变更');
    } catch (e: any) { alert('操作失败: ' + (e.message || '')); }
  };

  const statusLabel = (s: string) => {
    const map: Record<string, string> = { editing: '编辑中', locked: '已锁定', pending_change: '申请变更中', approved: '已审批' };
    return map[s] || s;
  };
  const statusColor = (s: string) => {
    const map: Record<string, string> = { editing: 'text-gray-500', locked: 'text-orange-600', pending_change: 'text-blue-600', approved: 'text-green-600' };
    return map[s] || '';
  };
  const rowBg = (s: string) => {
    if (s === 'locked' || s === 'approved') return 'bg-green-50';
    if (s === 'pending_change') return 'bg-blue-50';
    return '';
  };

  const downloadTemplate = () => {
    const headers = ['店铺名称', ...fieldLabels];
    const rows = [headers];
    filteredSalesData.slice(0, 5).forEach(r => {
      rows.push([r.shopName, ...fields.map(() => '0')]);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '模板');
    XLSX.writeFile(wb, `日常运营指标导入模板_${monthYear}.xlsx`);
  };

  const clearMonth = async () => {
    if (!confirm(`确定清空 ${monthYear} 所有指标？此操作不可恢复！`)) return;
    try {
      await axios.delete(`/daily-shop-targets/clear/${monthYear}`);
      setTargets({});
      setStatuses({});
      alert('已清空');
    } catch (e: any) { alert('清空失败'); }
  };

  const batchUpload = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.xlsx,.xls';
    input.onchange = async (e: any) => {
      try {
        const file = e.target.files[0];
        if (!file) return;
        const data = await file.arrayBuffer();
        const wb = XLSX.read(data);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        if (rows.length < 2) { alert('文件无数据行'); return; }
        let count = 0;
        const t = { ...targets };
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const shopName = String(row[0] || '').trim();
          if (!shopName) continue;
          if (!t[shopName]) t[shopName] = {};
          fields.forEach((f, j) => { if (row[j + 1] !== undefined && row[j + 1] !== '') t[shopName][f] = Number(row[j + 1]) || 0; });
          count++;
        }
        if (count === 0) { alert('未识别到有效数据，请检查格式：第一列店铺名称，后续列为指标数值'); return; }
        // 自动锁定已填满7项指标的店铺
        const newStatuses = { ...statuses };
        Object.keys(t).forEach(sn => { if (allFieldsFilled(t[sn])) newStatuses[sn] = 'locked'; });
        setStatuses(newStatuses);
        setTargets(t);
        alert(`成功导入 ${count} 条记录（已填满的已自动锁定）`);
      } catch (err: any) { alert('导入失败: ' + (err.message || '文件格式错误')); }
    };
    input.click();
  };

  const inp = 'w-20 px-1 py-0.5 border border-gray-300 rounded text-center text-xs outline-none focus:ring-1 focus:ring-blue-400';

  return (
    <Layout title="日常运营指标上传" subtitle={`${monthYear} 单店指标录入`}>
      <div className="p-4">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <input type="month" value={monthYear} onChange={e => setMonthYear(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-sm w-36" />
          <button onClick={loadData} disabled={loading} className="px-3 py-1 bg-gray-100 rounded text-sm hover:bg-gray-200"><RefreshCw size={14} /> 刷新</button>
          <span className="text-gray-300">|</span>
          {(isAdmin || Object.keys(targets).length === 0) && <button onClick={batchUpload} className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"><Upload size={14} className="inline" /> 批量上传</button>}
          <button onClick={downloadTemplate} className="px-3 py-1 bg-purple-500 text-white rounded text-sm hover:bg-purple-600">下载模板</button>
          <button onClick={saveData} disabled={saving} className="px-4 py-1 bg-primary text-white rounded text-sm hover:bg-primary-dark"><Save size={14} className="inline" /> {saving ? '保存中...' : '保存'}</button>
          {(isAdmin || isDirector) && <button onClick={clearMonth} className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600"><Trash2 size={14} className="inline" /> 清空本月指标</button>}
          <span className="text-gray-300">|</span>
          <select value={selectedDealer} onChange={e => { setSelectedDealer(e.target.value); setCurrentPage(1); }} className="px-2 py-1 border border-gray-300 rounded text-sm">
            <option value="">全部区经</option>
            {dealers.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <AreaSupervisorShopFilter filter={filter as any} />
        </div>
        {/* 审批专区 - 管理/总监可见 */}
        {canApprove && (() => {
          const pendingShops = Object.keys(statuses).filter(sn => statuses[sn] === 'pending_change' && changeData[sn]).map(sn => ({
            shopName: sn,
            supervisor: '',
            districtManager: '',
          }));
          if (pendingShops.length === 0) return null;
          return (
            <div className="mb-4 bg-yellow-50 border-2 border-yellow-400 rounded-lg p-4">
              <h3 className="text-sm font-bold text-yellow-800 mb-2">待审批变更（{pendingShops.length}家店铺）</h3>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {pendingShops.map(s => {
                  const cur = targets[s.shopName] || {};
                  const req = changeData[s.shopName] || {};
                  return (
                    <div key={s.shopName} className="bg-white border border-yellow-300 rounded p-3 text-xs">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-sm">{s.shopName}</span>
                      </div>
                      <table className="w-full border-collapse mb-2">
                        <thead>
                          <tr className="bg-gray-50">
                            <th className="border border-gray-300 px-2 py-1 text-left">指标</th>
                            <th className="border border-gray-300 px-2 py-1 text-center">当前值</th>
                            <th className="border border-gray-300 px-2 py-1 text-center text-red-600">变更为</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fields.map((f, i) => (
                            (cur as any)[f] !== (req as any)[f] ? (
                              <tr key={f}>
                                <td className="border border-gray-300 px-2 py-1">{fieldLabels[i]}</td>
                                <td className="border border-gray-300 px-2 py-1 text-center">{(cur as any)[f] || 0}</td>
                                <td className="border border-gray-300 px-2 py-1 text-center text-red-600 font-bold">{(req as any)[f] || 0}</td>
                              </tr>
                            ) : null
                          ))}
                        </tbody>
                      </table>
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => handleApprove(s.shopName)} className="px-3 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600">确认审批</button>
                        <button onClick={() => handleReject(s.shopName)} className="px-3 py-1 bg-gray-400 text-white rounded text-xs hover:bg-gray-500">拒绝</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
        {loading ? <p className="text-gray-400 py-8 text-center">加载中...</p> : (
          <div className="bg-white border border-gray-400 rounded overflow-x-auto">
            <table className="border-collapse text-xs w-full" style={{ minWidth: 1600 }}>
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">区经</th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">督导</th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700 w-64">店铺名称</th>
                  {fields.map((f, i) => (
                    <th key={f} className="border border-gray-400 px-2 py-1.5 text-gray-700">{fieldLabels[i]}</th>
                  ))}
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">状态</th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700 w-40">操作</th>
                </tr>
              </thead>
              <tbody>
                {paginatedData.length === 0 ? (
                  <tr><td colSpan={12} className="border border-gray-400 px-3 py-4 text-center text-gray-400">暂无数据</td></tr>
                ) : paginatedData.map((r, i) => {
                  const t = targets[r.shopName] || {};
                  const st = statuses[r.shopName] || 'editing';
                  const locked = isShopLocked(r.shopName);
                  return (
                    <tr key={r.shopName} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${rowBg(st)}`}>
                      <td className="border border-gray-400 px-2 py-1 text-center">{r.districtManager || '-'}</td>
                      <td className="border border-gray-400 px-2 py-1 text-center">{r.supervisor || '-'}</td>
                      <td className="border border-gray-400 px-2 py-1 max-w-64 truncate" title={r.shopName}>{r.shopName}</td>
                      {fields.map((f, fi) => (
                        <td key={f} className="border border-gray-400 px-2 py-1 text-center">
                          <div className="flex items-center gap-1">
                            <input type="number" step={f === 'attachmentRateTarget' ? '0.01' : '1'} className={`flex-1 px-1 py-0.5 border rounded text-center text-xs ${locked ? 'bg-gray-100 border-gray-200 cursor-not-allowed text-red-600 font-bold' : 'border-gray-300'}`} value={(t as any)[f] || ''} disabled={locked}
                              onChange={e => setTargets(prev => {
                                const n = { ...prev };
                                if (!n[r.shopName]) n[r.shopName] = {};
                                n[r.shopName][f] = +e.target.value;
                                return n;
                              })} />
                            {((t as any)[f] || 0) > 0 && (
                              <button onClick={() => openDecompose(r.shopName, f, fieldLabels[fi])}
                                className="flex-shrink-0 w-4 h-4 bg-blue-100 text-blue-600 rounded text-[10px] hover:bg-blue-200 flex items-center justify-center"
                                title="分解到日">日</button>
                            )}
                          </div>
                        </td>
                      ))}
                      <td className={`border border-gray-400 px-2 py-1 text-center text-xs font-medium ${statusColor(st)}`}>{statusLabel(st)}</td>
                      <td className="border border-gray-400 px-2 py-1 text-center">
                        <div className="flex items-center gap-1 justify-center">
                          {!locked ? (
                            <button onClick={() => {}} className="px-2 py-0.5 bg-blue-500 text-white rounded text-xs hover:bg-blue-600 whitespace-nowrap">编辑</button>
                          ) : canApprove && (st === 'pending_change') ? (
                            <button onClick={() => handleApprove(r.shopName)} className="px-2 py-0.5 bg-green-500 text-white rounded text-xs hover:bg-green-600 whitespace-nowrap">确认审批</button>
                          ) : canApprove ? (
                            <button onClick={() => handleApprove(r.shopName)} className="px-2 py-0.5 bg-green-500 text-white rounded text-xs hover:bg-green-600 whitespace-nowrap">编辑</button>
                          ) : null}
                          {locked && !canApprove && st !== 'pending_change' && (
                            <button onClick={() => openChangeModal(r.shopName)} className="px-2 py-0.5 bg-purple-500 text-white rounded text-xs hover:bg-purple-600 whitespace-nowrap">申请变更</button>
                          )}
                          {locked && st === 'pending_change' && !canApprove && (
                            <span className="text-xs text-gray-400">申请变更中</span>
                          )}
                          {canApprove && st === 'pending_change' && changeData[r.shopName] && (
                            <span className="text-[10px] text-blue-500 ml-1" title="有待审批的变更数据">●</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-3 py-2 border-t border-gray-200 bg-gray-50">
                <span className="text-xs text-gray-500">共 {displayData.length} 条，第 {currentPage}/{totalPages} 页</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className="px-2 py-0.5 text-xs border rounded disabled:opacity-30">首页</button>
                  <button onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="px-2 py-0.5 text-xs border rounded disabled:opacity-30">上一页</button>
                  {(() => {
                    const pages: (number | string)[] = [];
                    if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) pages.push(i); }
                    else {
                      pages.push(1);
                      if (currentPage > 3) pages.push('...');
                      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
                      if (currentPage < totalPages - 2) pages.push('...');
                      pages.push(totalPages);
                    }
                    return pages.map((p, i) => p === '...' ? <span key={'e'+i} className="px-1 text-gray-400 text-xs">...</span> :
                      <button key={p} onClick={() => setCurrentPage(p as number)} className={`px-2 py-0.5 text-xs border rounded ${p === currentPage ? 'bg-primary text-white' : ''}`}>{p}</button>);
                  })()}
                  <button onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages} className="px-2 py-0.5 text-xs border rounded disabled:opacity-30">下一页</button>
                  <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage >= totalPages} className="px-2 py-0.5 text-xs border rounded disabled:opacity-30">末页</button>
                </div>
              </div>
            )}
          </div>
        )}
        {/* 变更申请弹窗 */}
        {changeModalShop && (() => {
          const current = targets[changeModalShop] || {};
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setChangeModalShop(null)}>
              <div className="bg-white rounded-lg shadow-xl w-[640px] max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-3 border-b font-bold text-sm text-gray-700">申请变更 — {changeModalShop}</div>
                <div className="px-5 py-3">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="border border-gray-300 px-2 py-1.5 text-left">指标</th>
                        <th className="border border-gray-300 px-2 py-1.5 text-center w-28">当前目标</th>
                        <th className="border border-gray-300 px-2 py-1.5 text-center w-28">变更目标</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((f, i) => (
                        <tr key={f}>
                          <td className="border border-gray-300 px-2 py-1.5">{fieldLabels[i]}</td>
                          <td className="border border-gray-300 px-2 py-1.5 text-center font-medium">{(current as any)[f] || 0}</td>
                          <td className="border border-gray-300 px-2 py-1.5 text-center">
                            <input type="number" className="w-20 px-1 py-0.5 border border-gray-300 rounded text-center text-xs outline-none focus:ring-1 focus:ring-blue-400"
                              value={changeForm[f] || ''}
                              onChange={e => setChangeForm(prev => ({ ...prev, [f]: +e.target.value }))} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-5 py-3 border-t flex justify-end gap-2">
                  <button onClick={() => setChangeModalShop(null)} className="px-4 py-1.5 bg-gray-100 rounded text-sm hover:bg-gray-200">取消</button>
                  <button onClick={submitChangeRequest} className="px-4 py-1.5 bg-purple-500 text-white rounded text-sm hover:bg-purple-600">提交变更申请</button>
                </div>
              </div>
            </div>
          );
        })()}
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
                        <td className="border border-gray-300 px-2 py-1 text-right font-bold" style={{color: d.dailyTarget > 0 ? '#2563eb' : '#ccc'}}>
                          {d.dailyTarget > 0 ? (decomposeModal.fieldKey === 'attachmentRateTarget' ? d.dailyTarget.toFixed(2) : d.dailyTarget) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-yellow-100 font-bold">
                      <td className="border border-gray-300 px-2 py-1 text-center" colSpan={2}>
                        {decomposeModal.fieldKey === 'attachmentRateTarget' ? '每日目标' : '合计'}
                      </td>
                      <td className="border border-gray-300 px-2 py-1 text-right">
                        {decomposeModal.fieldKey === 'attachmentRateTarget'
                          ? (decomposedData[0]?.dailyTarget || 0).toFixed(2)
                          : decomposedData.reduce((s, d) => s + d.dailyTarget, 0)}
                      </td>
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
export default DailyTargetUploadPage;
