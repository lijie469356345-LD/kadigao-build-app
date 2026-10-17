import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { getStaffMonthlyTargets, saveStaffMonthlyTargets, clearStaffMonthlyTargets, getStaffDailyTargets, getStaffList, getLastMonthStaff, submitStaffChangeRequest, approveStaffChangeRequest, StaffMonthlyTargetItem, StaffMonthlyTargetDaily, StaffChangeRequest } from '../../api/staffMonthlyTarget';
import { getShops } from '../../api/shops';
import { Save, Trash2, RefreshCw, Upload, Download, ChevronDown, ChevronRight, Search, Plus, Edit3, Clock, CheckCircle2, XCircle, FileText, X } from 'lucide-react';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';
import * as XLSX from 'xlsx';

function StaffMonthlyTargetPage() {
  const { user } = useAuthStore();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [savedTargets, setSavedTargets] = useState<StaffMonthlyTargetItem[]>([]);
  const [shopList, setShopList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [dailyDetails, setDailyDetails] = useState<Record<number, StaffMonthlyTargetDaily[]>>({});

  // 变更申请相关
  const [changeRequests, setChangeRequests] = useState<StaffChangeRequest[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addRows, setAddRows] = useState<Array<{ shopName: string; staffName: string; monthlyTarget: string }>>([{ shopName: '', staffName: '', monthlyTarget: '' }]);
  const [staffList, setStaffList] = useState<{ shopName: string; staffName: string }[]>([]);
  const [showChangeModal, setShowChangeModal] = useState<{ targetId: number; shopName: string; staffName: string; oldTarget: number } | null>(null);
  const [changeNewTarget, setChangeNewTarget] = useState('');
  const [changeReason, setChangeReason] = useState('');
  const [showApproveModal, setShowApproveModal] = useState<number | null>(null);
  const [approveComment, setApproveComment] = useState('');

  const isAdmin = user?.isAdmin === '是' || (user?.groupName || '').includes('管理');
  const isDirector = (user?.groupName || '').includes('总监') || (user?.groupName || '').includes('总');
  const canApprove = isAdmin || isDirector || /区经|经理/.test(user?.groupName || '');

  const loadShops = useCallback(async () => {
    try { const shops = await getShops(user?.groupName); setShopList(Array.isArray(shops) ? shops : []); } catch { }
  }, [user?.groupName]);

  const loadStaffList = useCallback(async () => {
    try { setStaffList(await getStaffList(user?.groupName)); } catch { }
  }, [user?.groupName]);

  const loadSavedTargets = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getStaffMonthlyTargets(year, month, user?.groupName);
      setSavedTargets(data.targets || []);
      setChangeRequests(data.changeRequests || []);
    } catch { }
    setLoading(false);
  }, [year, month, user?.groupName]);

  useEffect(() => { loadShops(); loadStaffList(); }, [loadShops, loadStaffList]);
  useEffect(() => { loadSavedTargets(); }, [loadSavedTargets]);

  // 用店铺档案补充 区域/仓库 字段，供筛选使用
  const enhancedTargets = useMemo(() => {
    const shopMap = new Map<string, any>();
    shopList.forEach((s: any) => shopMap.set(s.shopName, s));
    return savedTargets.map(t => {
      const shop = shopMap.get(t.shopName) || {};
      return {
        ...t,
        area: shop.area || '',
        warehouseType: shop.warehouseType || '',
      };
    });
  }, [savedTargets, shopList]);

  const filter = useAreaSupervisorShopFilter(enhancedTargets, {
    getArea: (t) => t.area,
    getSupervisor: (t) => t.supervisor,
    getShopName: (t) => t.shopName,
    getWarehouseType: (t) => t.warehouseType,
    getDistrictManager: (t) => t.districtManager,
  });

  const displayTargets = useMemo(() => {
    let result = filter.filteredData;
    if (searchText.trim()) {
      const kw = searchText.trim().toLowerCase();
      result = result.filter(t =>
        (t.supervisor || '').toLowerCase().includes(kw) ||
        (t.districtManager || '').toLowerCase().includes(kw) ||
        (t.shopName || '').toLowerCase().includes(kw)
      );
    }
    return result;
  }, [filter.filteredData, searchText]);

  const handleBatchImport = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.xlsx,.xls,.csv,.txt';
    input.onchange = async (e: any) => {
      try {
        const file = e.target.files[0]; if (!file) return;
        // 每行：年份, 月份, 店铺名称, 店员名称, 月目标
        const rawRows: { y: number; m: number; shopName: string; staffName: string; target: number }[] = [];
        const ext = file.name.split('.').pop()?.toLowerCase();
        const parseCols = (cols: string[]) => {
          const y = parseInt(cols[0] as any) || year;
          const m = parseInt(cols[1] as any) || month;
          const shopName = String(cols[2] || '').trim();
          const staffName = String(cols[3] || '').trim();
          const target = parseInt(cols[4] as any) || 0;
          return { y, m, shopName, staffName, target };
        };
        if (ext === 'xlsx' || ext === 'xls') {
          const data = new Uint8Array(await file.arrayBuffer());
          const wb = XLSX.read(data, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
          for (let i = 1; i < rows.length; i++) {
            const r = parseCols(rows[i].map((c: any) => String(c ?? '').trim()));
            if (r.shopName && r.staffName) rawRows.push(r);
          }
        } else {
          const buf = await file.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let text = new TextDecoder('utf-8').decode(bytes);
          if (text.indexOf('\uFFFD') !== -1) { try { text = new TextDecoder('gbk').decode(bytes); } catch {} }
          text = text.replace(/^\uFEFF/, '');
          const lines = text.split(/\r?\n/).filter((l: string) => l.trim());
          for (let i = 1; i < lines.length; i++) {
            const r = parseCols(lines[i].split(/[,\t]/));
            if (r.shopName && r.staffName) rawRows.push(r);
          }
        }
        if (rawRows.length === 0) { alert('未识别到数据，模板格式: 年份, 月份, 店铺名称, 店员名称, 月目标'); return; }
        const shopMap = new Map<string, any>();
        shopList.forEach((s: any) => shopMap.set(s.shopName || s['店铺名称'] || '', s));
        // 按 (年,月) 分组，自动匹配对应月份保存
        const groups = new Map<string, any[]>();
        const monthKeys: string[] = [];
        rawRows.forEach(r => {
          const shop = shopMap.get(r.shopName) || {};
          const key = `${r.y}-${r.m}`;
          const item = {
            shopName: r.shopName, staffName: r.staffName, monthlyTarget: r.target,
            districtManager: shop.districtManager || shop['区经'] || '',
            supervisor: shop.supervisor || shop['督导'] || '',
            status: 'active',
          };
          if (!groups.has(key)) { groups.set(key, []); monthKeys.push(key); }
          groups.get(key)!.push(item);
        });
        setSaving(true);
        const summary: string[] = [];
        for (const key of monthKeys) {
          const [gy, gm] = key.split('-').map(Number);
          await saveStaffMonthlyTargets({ year: gy, month: gm, items: groups.get(key)!, operator: user?.userName, groupName: user?.groupName });
          summary.push(`${gy}年${gm}月×${groups.get(key)!.length}条`);
        }
        setSaving(false);
        alert(`导入完成：\n${summary.join('\n')}`);
        loadSavedTargets();
      } catch (e: any) { alert('导入失败: ' + (e.message || '')); setSaving(false); }
    };
    input.click();
  };

  const handleDownloadTemplate = async () => {
    let staff: { shopName: string; staffName: string }[] = [];
    try {
      staff = await getLastMonthStaff(year, month, user?.groupName);
    } catch (e: any) {
      alert('加载上月销售店员失败：' + (e?.response?.data?.message || e.message) + '\n请确认后端服务已重启（新增了 /last-month-staff 接口）。');
      return;
    }
    const rows: any[][] = [['年份', '月份', '店铺名称', '店员名称', '月度目标']];
    staff.forEach(s => rows.push([year, month, s.shopName, s.staffName, '']));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '店员月目标模板');
    XLSX.writeFile(wb, `店员月目标模板_${year}年${month}月.xlsx`);
  };

  const handleClear = async () => {
    if (!confirm(`确定清空 ${year}年${month}月 所有店员目标？`)) return;
    try { await clearStaffMonthlyTargets(year, month, user?.groupName); setSavedTargets([]); alert('已清空'); }
    catch (e: any) { alert('清空失败'); }
  };

  const toggleExpand = async (targetId: number) => {
    const next = new Set(expanded);
    if (next.has(targetId)) { next.delete(targetId); }
    else { next.add(targetId); if (!dailyDetails[targetId]) { const d = await getStaffDailyTargets(targetId); setDailyDetails(p => ({ ...p, [targetId]: d })); } }
    setExpanded(next);
  };

  const shopMapForAdd = useMemo(() => {
    const map = new Map<string, any>();
    shopList.forEach((s: any) => map.set(s.shopName, s));
    return map;
  }, [shopList]);

  const addRow = () => setAddRows(prev => [...prev, { shopName: '', staffName: '', monthlyTarget: '' }]);
  const updateAddRow = (idx: number, field: 'shopName' | 'staffName' | 'monthlyTarget', value: string) => {
    setAddRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };
  const removeAddRow = (idx: number) => setAddRows(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);

  const handleSaveAdd = async () => {
    const validRows = addRows.filter(r => r.shopName && r.staffName && Number(r.monthlyTarget) > 0);
    if (validRows.length === 0) { alert('请至少填写一条「店铺 + 店员 + 月目标」'); return; }
    setSaving(true);
    try {
      const items = validRows.map(r => {
        const shop = shopMapForAdd.get(r.shopName) || {};
        return {
          shopName: r.shopName,
          districtManager: shop.districtManager || shop['区经'] || '',
          supervisor: shop.supervisor || shop['督导'] || '',
          staffName: r.staffName.trim(),
          monthlyTarget: Number(r.monthlyTarget) || 0,
          status: 'active',
        };
      });
      await saveStaffMonthlyTargets({ year, month, items, operator: user?.userName, groupName: user?.groupName });
      alert(`成功新增 ${items.length} 条店员指标`);
      setShowAddModal(false);
      setAddRows([{ shopName: '', staffName: '', monthlyTarget: '' }]);
      loadSavedTargets();
    } catch (e: any) { alert('新增失败: ' + (e.message || '')); }
    setSaving(false);
  };

  const pendingChangeMap = useMemo(() => {
    const map = new Set<string>();
    changeRequests.filter(r => r.status === 'pending').forEach(r => map.add(`${r.shopName}|${r.staffName}`));
    return map;
  }, [changeRequests]);

  const handleSubmitChange = async () => {
    if (!showChangeModal) return;
    const newTargetNum = Number(changeNewTarget);
    if (!newTargetNum || newTargetNum <= 0) { alert('请输入有效的新目标金额'); return; }
    try {
      await submitStaffChangeRequest({
        targetId: showChangeModal.targetId,
        year, month,
        shopName: showChangeModal.shopName,
        staffName: showChangeModal.staffName,
        districtManager: '', supervisor: '',
        oldTarget: showChangeModal.oldTarget,
        newTarget: newTargetNum,
        reason: changeReason,
        applicant: user?.userName || '',
        applicantGroup: user?.groupName || '',
      });
      alert('变更申请已提交，等待领导审批');
      setShowChangeModal(null); setChangeNewTarget(''); setChangeReason('');
      loadSavedTargets();
    } catch (e: any) { alert('提交失败: ' + (e?.response?.data?.message || e.message)); }
  };

  const handleApprove = async (requestId: number, action: 'approve' | 'reject') => {
    try {
      await approveStaffChangeRequest({
        requestId,
        action,
        approver: user?.userName || '',
        approverGroup: user?.groupName || '',
        comment: approveComment,
      });
      alert(action === 'approve' ? '已通过变更申请' : '已驳回变更申请');
      setShowApproveModal(null); setApproveComment('');
      loadSavedTargets();
    } catch (e: any) { alert('操作失败: ' + (e?.response?.data?.message || e.message)); }
  };

  const pendingRequests = useMemo(() => changeRequests.filter(r => r.status === 'pending'), [changeRequests]);
  const statusBadge = (s: string) => {
    if (s === 'approved') return '已通过';
    if (s === 'rejected') return '已驳回';
    return '待审批';
  };

  const th = 'border border-gray-400 px-2 py-1.5 text-xs font-bold text-gray-700 text-center bg-gray-100';
  const td = 'border border-gray-400 px-2 py-1.5 text-xs text-center';

  // 导出店铺/店员本月目标（日期竖版：每一天单独一行）
  const handleExportTargets = async () => {
    const source = displayTargets;
    if (source.length === 0) { alert('当前无导出数据'); return; }
    const targetIds = source.filter(t => t.id).map(t => t.id!);
    const dailyMap: Record<number, StaffMonthlyTargetDaily[]> = {};
    for (const id of targetIds) {
      try { dailyMap[id] = await getStaffDailyTargets(id); } catch { }
    }
    const days = new Date(year, month, 0).getDate();
    const rows: any[][] = [['年份', '月份', '店铺名称', '店员名称', '区经', '督导', '月度目标', '日期', '星期', '日目标']];
    for (const t of source as any[]) {
      const dl = dailyMap[t.id!] || [];
      const byDay: Record<number, StaffMonthlyTargetDaily> = {};
      dl.forEach(d => { byDay[d.dayIndex] = d; });
      for (let d = 1; d <= days; d++) {
        const rec = byDay[d];
        rows.push([
          year, month, t.shopName, t.staffName,
          t.districtManager || t.area || '', t.supervisor || '', t.monthlyTarget || 0,
          `${d}日`, rec?.dayOfWeek || '', rec?.dailyTarget ?? 0,
        ]);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 8 }, { wch: 8 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '店铺店员日目标');
    XLSX.writeFile(wb, `店铺店员日目标_${year}年${month}月.xlsx`);
  };

  return (
    <Layout title="月目标分解店员" subtitle={`${year}年${month}月 店员月度目标分解`}>
      <div className="p-4">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <select value={year} onChange={e => setYear(+e.target.value)} className="px-2 py-1 border rounded text-sm">
            {[2025,2026,2027].map(y => <option key={y} value={y}>{y}年</option>)}
          </select>
          <select value={month} onChange={e => setMonth(+e.target.value)} className="px-2 py-1 border rounded text-sm">
            {Array.from({length:12},(_,i)=>i+1).map(m => <option key={m} value={m}>{m}月</option>)}
          </select>
          <button onClick={loadSavedTargets} disabled={loading} className="px-3 py-1 bg-gray-100 rounded text-sm"><RefreshCw size={14} /> 刷新</button>
          <span className="text-gray-300">|</span>
          <button onClick={() => setShowAddModal(true)} className="px-3 py-1 bg-green-600 text-white rounded text-sm"><Plus size={14} className="inline" /> 新增店员指标</button>
          <button onClick={handleBatchImport} className="px-3 py-1 bg-blue-500 text-white rounded text-sm"><Upload size={14} className="inline" /> 批量导入并保存</button>
          <button onClick={handleDownloadTemplate} className="px-3 py-1 bg-purple-500 text-white rounded text-sm"><Download size={14} className="inline" /> 下载模板</button>
          <button onClick={handleExportTargets} className="px-3 py-1 bg-teal-600 text-white rounded text-sm"><Download size={14} className="inline" /> 导出本月目标</button>
          {(isAdmin || isDirector) && <button onClick={handleClear} className="px-3 py-1 bg-red-500 text-white rounded text-sm"><Trash2 size={14} className="inline" /> 清空</button>}
        </div>

        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <AreaSupervisorShopFilter filter={filter as any} />
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

        {loading ? <p className="text-gray-400 py-8 text-center">加载中...</p> : savedTargets.length === 0 ? (
          <p className="text-gray-400 py-8 text-center">暂无店员目标数据，请导入</p>
        ) : displayTargets.length === 0 ? (
          <p className="text-gray-400 py-8 text-center">无匹配的筛选结果</p>
        ) : (
          <div className="bg-white border border-gray-400 rounded overflow-x-auto">
            <table className="border-collapse text-xs w-full">
              <thead>
                <tr className="bg-gray-100">
                  <th className={th}>店铺名称</th><th className={th}>店员名称</th>
                  <th className={th}>月度目标</th><th className={th}>状态</th><th className={th}>日明细</th><th className={th}>操作</th>
                </tr>
              </thead>
              <tbody>
                {displayTargets.map((t, i) => (
                  <Fragment key={t.id || i}>
                    <tr className={i%2===0?'bg-white':'bg-gray-50'}>
                      <td className={td}>{t.shopName}</td><td className={td}>{t.staffName}</td>
                      <td className={td} style={{fontWeight:'bold',color:'#2563eb'}}>{t.monthlyTarget?.toLocaleString('zh-CN', { useGrouping: false })}</td>
                      <td className={td}>
                        {pendingChangeMap.has(`${t.shopName}|${t.staffName}`)
                          ? <span className="text-orange-600">变更中</span>
                          : t.status === 'active' ? '已保存' : t.status}
                      </td>
                      <td className={td}>
                        {t.id ? <button onClick={() => toggleExpand(t.id!)} className="text-blue-500 hover:underline">
                          {expanded.has(t.id!) ? <ChevronDown size={14} className="inline"/> : <ChevronRight size={14} className="inline"/>} 明细
                        </button> : '-'}
                      </td>
                      <td className={td}>
                        {t.id ? <button
                          onClick={() => { setShowChangeModal({ targetId: t.id!, shopName: t.shopName, staffName: t.staffName, oldTarget: t.monthlyTarget || 0 }); setChangeNewTarget(''); setChangeReason(''); }}
                          className="px-2 py-1 border border-orange-300 text-orange-600 rounded text-xs hover:bg-orange-100"
                        ><Edit3 size={12} className="inline" /> 申请变更</button> : '-'}
                      </td>
                    </tr>
                    {t.id && expanded.has(t.id) && (
                      <tr className="bg-blue-50">
                        <td colSpan={6} className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {(dailyDetails[t.id] || []).map(d => (
                              <div key={d.dayIndex} className={`px-2 py-1 rounded text-xs text-center min-w-[60px] ${d.dailyTarget > 0 ? 'bg-white border' : 'bg-gray-100 border border-gray-200 text-gray-400'}`}>
                                <div className="font-bold">{d.dayIndex}日</div>
                                <div className="text-[10px] text-gray-500">{d.dayOfWeek}</div>
                                <div className="font-bold text-blue-600">{d.dailyTarget}</div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 领导审批面板 */}
        {canApprove && pendingRequests.length > 0 && (
          <div className="mt-6 bg-orange-50 border border-orange-200 rounded p-3">
            <h3 className="text-sm font-bold text-orange-700 mb-2 flex items-center gap-1"><Clock size={14} /> 待审批的变更申请 ({pendingRequests.length})</h3>
            <table className="w-full border-collapse text-xs bg-white border border-gray-300">
              <thead><tr className="bg-orange-100">
                <th className="border border-gray-300 px-2 py-1 text-left">店铺</th><th className="border border-gray-300 px-2 py-1 text-left">店员</th>
                <th className="border border-gray-300 px-2 py-1 text-right">原目标</th><th className="border border-gray-300 px-2 py-1 text-right">新目标</th>
                <th className="border border-gray-300 px-2 py-1 text-left">申请人</th><th className="border border-gray-300 px-2 py-1 text-left">原因</th><th className="border border-gray-300 px-2 py-1 text-center">操作</th>
              </tr></thead>
              <tbody>
                {pendingRequests.map(req => (
                  <tr key={req.id}>
                    <td className="border border-gray-300 px-2 py-1">{req.shopName}</td>
                    <td className="border border-gray-300 px-2 py-1">{req.staffName}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right">{req.oldTarget?.toLocaleString('zh-CN', { useGrouping: false })}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right text-orange-600 font-bold">{req.newTarget.toLocaleString('zh-CN', { useGrouping: false })}</td>
                    <td className="border border-gray-300 px-2 py-1">{req.applicant}</td>
                    <td className="border border-gray-300 px-2 py-1 max-w-[160px] truncate">{req.reason || '-'}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center">
                      {showApproveModal === req.id ? (
                        <div className="flex items-center gap-1 justify-center">
                          <input value={approveComment} onChange={e => setApproveComment(e.target.value)} placeholder="审批意见" className="px-1.5 py-0.5 border border-gray-300 rounded text-xs w-24" />
                          <button onClick={() => handleApprove(req.id, 'approve')} className="px-2 py-0.5 bg-green-600 text-white rounded text-xs">通过</button>
                          <button onClick={() => handleApprove(req.id, 'reject')} className="px-2 py-0.5 bg-red-500 text-white rounded text-xs">驳回</button>
                          <button onClick={() => { setShowApproveModal(null); setApproveComment(''); }} className="px-2 py-0.5 text-gray-400 text-xs">取消</button>
                        </div>
                      ) : (
                        <button onClick={() => setShowApproveModal(req.id)} className="px-2 py-0.5 border border-orange-300 text-orange-600 rounded text-xs hover:bg-orange-100">审批</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 变更记录 */}
        {changeRequests.length > 0 && (
          <div className="mt-6 bg-white border border-gray-300 rounded p-3">
            <h3 className="mb-2 flex items-center gap-1"><FileText size={16} className="text-gray-500" /> 变更申请记录</h3>
            <table className="w-full border-collapse text-xs">
              <thead><tr className="bg-gray-100">
                <th className="border border-gray-300 px-2 py-1 text-left">店铺</th><th className="border border-gray-300 px-2 py-1 text-left">店员</th>
                <th className="border border-gray-300 px-2 py-1 text-right">原目标</th><th className="border border-gray-300 px-2 py-1 text-right">新目标</th>
                <th className="border border-gray-300 px-2 py-1 text-left">申请人</th><th className="border border-gray-300 px-2 py-1 text-left">原因</th>
                <th className="border border-gray-300 px-2 py-1 text-center">状态</th><th className="border border-gray-300 px-2 py-1 text-left">审批人</th><th className="border border-gray-300 px-2 py-1 text-left">审批意见</th>
              </tr></thead>
              <tbody>
                {changeRequests.map(req => (
                  <tr key={req.id}>
                    <td className="border border-gray-300 px-2 py-1">{req.shopName}</td>
                    <td className="border border-gray-300 px-2 py-1">{req.staffName}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right">{req.oldTarget?.toLocaleString('zh-CN', { useGrouping: false })}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right">{req.newTarget.toLocaleString('zh-CN', { useGrouping: false })}</td>
                    <td className="border border-gray-300 px-2 py-1">{req.applicant}</td>
                    <td className="border border-gray-300 px-2 py-1 max-w-[160px] truncate">{req.reason || '-'}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center">{statusBadge(req.status)}</td>
                    <td className="border border-gray-300 px-2 py-1">{req.approver || '-'}</td>
                    <td className="border border-gray-300 px-2 py-1 max-w-[140px] truncate">{req.approvalComment || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 新增店员指标 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-5 w-[640px] max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <Plus className="w-5 h-5 text-green-600" />
              <h3 className="text-lg font-semibold text-gray-800">新增店员指标</h3>
            </div>
            <table className="w-full border-collapse text-xs">
              <thead><tr className="bg-gray-100">
                <th className="border border-gray-300 px-2 py-1 text-left w-52">店铺名称</th>
                <th className="border border-gray-300 px-2 py-1 text-left">店员名称</th>
                <th className="border border-gray-300 px-2 py-1 text-left w-32">月目标</th>
                <th className="border border-gray-300 px-2 py-1 w-8"></th>
              </tr></thead>
              <tbody>
                {addRows.map((row, i) => (
                  <tr key={i}>
                    <td className="border border-gray-300 p-1">
                      <select value={row.shopName} onChange={e => updateAddRow(i, 'shopName', e.target.value)} className="w-full border border-gray-200 rounded text-xs px-1 py-1">
                        <option value="">选择店铺</option>
                        {shopList.map((s: any) => <option key={s.shopName} value={s.shopName}>{s.shopName}</option>)}
                      </select>
                    </td>
                    <td className="border border-gray-300 p-1">
                      <input list={`staff-suggest-${i}`} value={row.staffName} onChange={e => updateAddRow(i, 'staffName', e.target.value)} placeholder="选择或输入店员" className="w-full border border-gray-200 rounded text-xs px-1 py-1" />
                      <datalist id={`staff-suggest-${i}`}>
                        {staffList.filter(s => !row.shopName || s.shopName === row.shopName).map((s, si) => <option key={si} value={s.staffName} />)}
                      </datalist>
                    </td>
                    <td className="border border-gray-300 p-1">
                      <input type="number" value={row.monthlyTarget} onChange={e => updateAddRow(i, 'monthlyTarget', e.target.value)} placeholder="0" className="w-full border border-gray-300 rounded text-xs px-1 py-1" min="0" />
                    </td>
                    <td className="border border-gray-300 p-1 text-center">
                      <button onClick={() => removeAddRow(i)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex gap-2 mt-3">
              <button onClick={addRow} className="px-3 py-1 border border-green-300 text-green-600 rounded text-sm hover:bg-green-50"><Plus size={14} className="inline" /> 添加一行</button>
              <div className="flex-1"></div>
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2 border border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-50">取消</button>
              <button onClick={handleSaveAdd} disabled={saving} className="px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700">{saving ? '保存中...' : '确认保存'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 申请变更 */}
      {showChangeModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowChangeModal(null)}>
          <div className="bg-white rounded-xl shadow-xl p-5 w-96" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <Edit3 className="w-5 h-5 text-orange-500" />
              <h3 className="text-lg font-semibold text-gray-800">变更指标申请</h3>
            </div>
            <p className="text-sm text-gray-500 mb-1">店铺：<strong className="text-gray-800">{showChangeModal.shopName}</strong></p>
            <p className="text-sm text-gray-500 mb-1">店员：<strong className="text-gray-800">{showChangeModal.staffName}</strong></p>
            <p className="text-sm text-gray-500 mb-4">原目标：<strong className="text-gray-800">{showChangeModal.oldTarget.toLocaleString('zh-CN', { useGrouping: false })} 元</strong></p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">新目标金额(元)</label>
                <input type="number" value={changeNewTarget} onChange={e => setChangeNewTarget(e.target.value)} placeholder="输入新目标" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" min="0" />
              </div>
              <div>
                <label className="text-xs text-gray-500">变更原因</label>
                <textarea value={changeReason} onChange={e => setChangeReason(e.target.value)} placeholder="说明变更原因..." className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm h-20 resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowChangeModal(null)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">取消</button>
              <button onClick={handleSubmitChange} className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600">提交申请</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

export default StaffMonthlyTargetPage;
