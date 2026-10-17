import { useEffect, useState, useRef } from 'react';
import Layout from '../components/Layout';
import { getPkTaskOrders, PkTaskOrder, getPkDailyTargets, PkDailyTargetRow, PkScopeMeta, getPkScopeMeta, PkDataDimFilter, uploadPkDailyTargets, clearPkDailyTargets, exportPkDailyTargets } from '../../api/pk';
import PkScopeFilterBar from '../components/PkScopeFilterBar';
import { RefreshCw, Upload, Trash2, Download, ClipboardList, CalendarDays, Search, X, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react';

function fmtTarget(v: number | null | undefined): string {
  if (v == null || !isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2, useGrouping: false });
}

function PkDailyTargetUploadPage() {
  const [taskOrders, setTaskOrders] = useState<PkTaskOrder[]>([]);
  const [orderId, setOrderId] = useState<number | ''>('');
  const [targetDate, setTargetDate] = useState<string>('');
  const [rows, setRows] = useState<PkDailyTargetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');
  const [resultMsg, setResultMsg] = useState<{ ok: boolean; text: string; warnings?: string[] } | null>(null);
  const [quickSearch, setQuickSearch] = useState<string>('');
  // 五维筛选（仓库类别/督导/区经/经销商/店铺名称，服务端过滤）
  const [scopeMeta, setScopeMeta] = useState<PkScopeMeta | null>(null);
  const [scopeFilter, setScopeFilter] = useState<string>('');
  const [dimFilter, setDimFilter] = useState<PkDataDimFilter>({ warehouse: '', supervisor: '', districtManager: '', dealer: '', shopName: '' });
  const autoLoadedRef = useRef(false);

  const currentOrder = taskOrders.find(o => o.id === orderId) || null;

  useEffect(() => {
    getPkTaskOrders().then(res => {
      const list: PkTaskOrder[] = Array.isArray(res.data) ? res.data : [];
      setTaskOrders(list);
      if (list.length > 0) setOrderId(list[0].id);
    }).catch(() => {});
  }, []);

  // 任务单切换后，日期默认取该任务单 PK 开始日
  useEffect(() => {
    setRows([]);
    setTargetDate(currentOrder?.pkStartDate || '');
    setResultMsg(null);
    setError('');
    setQuickSearch('');
    setScopeFilter('');
    setDimFilter({ warehouse: '', supervisor: '', districtManager: '', dealer: '', shopName: '' });
    setScopeMeta(null);
    if (orderId === '') return;
    getPkScopeMeta({ taskOrderId: Number(orderId) }).then(res => setScopeMeta(res.data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const loadRows = async (silent = true) => {
    if (orderId === '') return;
    if (!silent) setLoading(true);
    setError('');
    try {
      // 单选页窄化：string | string[] -> string（取首个选值）
      const dimStr = (v: string | string[] | undefined): string | undefined =>
        Array.isArray(v) ? (v.length ? v[0] : undefined) : (v || undefined);
      const res = await getPkDailyTargets({
        taskOrderId: orderId,
        targetDate: targetDate || undefined,
        filter: scopeFilter || undefined,
        warehouse: dimStr(dimFilter.warehouse),
        supervisor: dimStr(dimFilter.supervisor),
        districtManager: dimStr(dimFilter.districtManager),
        dealer: dimStr(dimFilter.dealer),
        shopName: dimStr(dimFilter.shopName),
      });
      const data = res.data || {};
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setResultMsg(null);
    } catch (e: any) {
      setError(e?.response?.data?.error || '日目标加载失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoLoadedRef.current) return;
    if (orderId === '') return;
    autoLoadedRef.current = true;
    if (currentOrder?.pkStartDate) loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, currentOrder?.pkStartDate]);

  // 范围筛选 / 五维筛选变化：重新从服务端拉取过滤后的列表
  const dimFilterKey = JSON.stringify(dimFilter);
  useEffect(() => {
    if (orderId === '') return;
    if (!autoLoadedRef.current) return;
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeFilter, dimFilterKey]);

  const handleUpload = () => {
    if (orderId === '') { alert('请先选择 PK任务单'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploading(true);
      setError('');
      setResultMsg(null);
      try {
        const res = await uploadPkDailyTargets(Number(orderId), file);
        const data = res.data || {};
        if (data.ok) {
          setResultMsg({ ok: true, text: data.message || '导入成功', warnings: data.warnings || [] });
          loadRows(true);
        } else {
          setResultMsg({ ok: false, text: data.message || '导入失败', warnings: data.warnings || [] });
        }
      } catch (err: any) {
        setError(err?.response?.data?.error || '上传失败，请检查文件格式（列：日期 / 督导 / 店铺名称 / 日目标）');
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };

  const handleClear = async () => {
    if (orderId === '') { alert('请先选择 PK任务单'); return; }
    const scope = targetDate ? ` ${targetDate} 的` : '全部日期的';
    if (!confirm(`确定清空该任务单${scope}已上传日目标？此操作不可恢复！`)) return;
    setClearing(true);
    setError('');
    try {
      const res = await clearPkDailyTargets({ taskOrderId: Number(orderId), targetDate: targetDate || undefined });
      setRows([]);
      setResultMsg({ ok: true, text: `已清空 ${res.data?.deleted ?? 0} 条记录` });
    } catch (e: any) {
      setError(e?.response?.data?.error || '清空失败');
    } finally {
      setClearing(false);
    }
  };

  const handleExport = async () => {
    if (orderId === '') { alert('请先选择 PK任务单'); return; }
    try {
      const res = await exportPkDailyTargets({ taskOrderId: Number(orderId), targetDate: targetDate || undefined });
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const disp = String(res.headers?.['content-disposition'] || '');
      const m = /filename\*=UTF-8''([^;]+)/.exec(disp);
      a.href = url;
      a.download = m ? decodeURIComponent(m[1]) : `PK日目标_${currentOrder?.orderName || ''}_${targetDate || ''}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.response?.data?.error || '导出失败');
    }
  };

  const filteredRows = rows.filter(r => {
    const q = quickSearch.trim().toLowerCase();
    if (!q) return true;
    return String(r.shopName || '').toLowerCase().includes(q) ||
      String(r.supervisor || '').toLowerCase().includes(q) ||
      String(r.targetDate || '').includes(q);
  });

  const totalTarget = filteredRows.reduce((s, r) => s + (Number(r.dailyTarget) || 0), 0);

  return (
    <Layout title="PK日目标上传" subtitle="按 日期 × 督导 × 店铺名称 批量上传日目标，支持清空 / 导出">
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
            <span className="text-sm text-gray-500 flex items-center gap-1"><CalendarDays size={14} /> 日期</span>
            <input type="date" value={targetDate} onChange={e => { setTargetDate(e.target.value); }} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <PkScopeFilterBar meta={scopeMeta} filter={scopeFilter} onChange={setScopeFilter} disabled={loading || orderId === ''} dims={{ value: dimFilter, onChange: setDimFilter }} hideScope />
          <button onClick={() => loadRows(false)} disabled={loading || orderId === ''} className="px-4 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm flex items-center gap-1 hover:bg-gray-200 disabled:opacity-40">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 刷新
          </button>
          <span className="text-gray-300">|</span>
          <button onClick={handleUpload} disabled={uploading || orderId === ''} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-blue-700 disabled:opacity-40">
            <Upload size={14} className={uploading ? 'animate-pulse' : ''} /> {uploading ? '上传中...' : '上传'}
          </button>
          <button onClick={handleExport} disabled={orderId === ''} className="px-4 py-1.5 bg-purple-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-purple-700 disabled:opacity-40">
            <Download size={14} /> 导出
          </button>
          <button onClick={handleClear} disabled={clearing || orderId === ''} className="px-4 py-1.5 bg-red-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-red-700 disabled:opacity-40">
            <Trash2 size={14} /> {clearing ? '清空中...' : '清空'}
          </button>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={quickSearch}
              onChange={e => setQuickSearch(e.target.value)}
              placeholder="快速搜索：日期/督导/店铺"
              className="pl-8 pr-7 py-1.5 border border-gray-200 rounded-lg text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            {quickSearch && (
              <button onClick={() => setQuickSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" title="清除搜索">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* 格式说明 + 上传结果 */}
        <div className="mb-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl bg-white border border-gray-100 shadow-sm px-4 py-3 flex items-start gap-3">
            <FileSpreadsheet size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-gray-600">
              <span className="font-bold text-gray-900">上传格式</span>（.xlsx / .xls，第一行为表头）：
              <span className="ml-1 font-mono text-xs bg-gray-50 border border-gray-200 rounded px-2 py-0.5 whitespace-nowrap">日期 | 督导 | 店铺名称 | 日目标</span>
              <div className="text-xs text-gray-400 mt-1">
                日期形如 2026-09-18；督导可为空（自动按店铺档案带出）；重复上传同 日期+店铺 将覆盖旧值；非本任务单店铺将被跳过。
              </div>
            </div>
          </div>
          <div className="rounded-xl bg-white border border-gray-100 shadow-sm px-4 py-3 flex items-start gap-3">
            {resultMsg ? (
              resultMsg.ok ? (
                <CheckCircle2 size={16} className="text-emerald-600 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertTriangle size={16} className="text-red-600 mt-0.5 flex-shrink-0" />
              )
            ) : (
              <CalendarDays size={16} className="text-gray-400 mt-0.5 flex-shrink-0" />
            )}
            <div className="text-sm">
              {resultMsg ? (
                <div>
                  <span className={`font-bold ${resultMsg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{resultMsg.text}</span>
                  {resultMsg.warnings && resultMsg.warnings.length > 0 && (
                    <div className="text-xs text-gray-500 mt-1 max-h-24 overflow-y-auto">
                      {resultMsg.warnings.slice(0, 20).map((w, i) => <div key={i}>{w}</div>)}
                      {resultMsg.warnings.length > 20 && <div>…共 {resultMsg.warnings.length} 条提示</div>}
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-gray-400">选择任务单后自动加载已上传记录；完成上传 / 清空 / 刷新后此处显示结果。</span>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 text-sm">{error}</div>
        )}

        {/* 已上传列表 */}
        <div className="rounded-2xl bg-white border-2 border-black ring-2 ring-[#D4AF37] shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-white border-b-2 border-black flex items-center gap-2 text-base font-black text-gray-900">
            已上传日目标
            <span className="ml-auto text-xs font-normal text-gray-400 flex items-center gap-3">
              <span>共 {filteredRows.length} 条</span>
              <span>目标合计 <b className="text-gray-900 tabular-nums">{fmtTarget(totalTarget)}</b></span>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b-2 border-black">
                  <th className="px-3 py-2.5 text-left text-sm font-bold text-gray-900 whitespace-nowrap">日期</th>
                  <th className="px-3 py-2.5 text-left text-sm font-bold text-gray-900 whitespace-nowrap">督导</th>
                  <th className="px-3 py-2.5 text-left text-sm font-bold text-gray-900 whitespace-nowrap">店铺名称</th>
                  <th className="px-3 py-2.5 text-right text-sm font-bold text-gray-900 whitespace-nowrap">日目标</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-10 text-center text-gray-400 text-sm">
                      {orderId === '' ? '请先选择 PK任务单' : (loading ? '加载中…' : '暂无上传记录，点击「上传」导入 xlsx 文件')}
                    </td>
                  </tr>
                ) : filteredRows.map(r => (
                  <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2.5 text-sm text-gray-800 whitespace-nowrap">{r.targetDate}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-800">{r.supervisor || '—'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-800 max-w-72">
                      <span className="inline-block align-middle truncate max-w-full" title={r.shopName}>{r.shopName}</span>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-right tabular-nums text-gray-800 font-bold">{fmtTarget(r.dailyTarget)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default PkDailyTargetUploadPage;