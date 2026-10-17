import { useEffect, useState } from 'react';
import PageHeader from './_WechatPageHeader';
import WechatPushSidebar from './_WechatPushSidebar';
import {
  PushLogV2, PushLogGroup, PushTemplate,
  getModules, getPushLogs, rePushLogs, manualPush, getSourceData, getTemplates,
  deletePushLog, batchDeletePushLogs,
} from '../../api/wechatPushV2';
import { ChevronDown, ChevronRight, RefreshCw, Send, CheckCircle2, XCircle, Clock, SkipForward, Plus, Search, X, FileText, Trash2, MessageSquare, UserCheck } from 'lucide-react';

const MODULE_NAMES: Record<string, string> = {
  inspection_log: '巡店日志',
  direct_sales_summary: '运营工作汇报',
  daily_shop_target: '日常指标上传',
  feedback_task: '培训反馈任务',
  feedback_detail: '培训反馈明细',
  coaching_store: '陪跑跟进',
  daily_score: '评分体系',
  monthly_target: '月目标分解',
  inspection_task: '巡店任务',
  custom_notification: '自定义通知',
};

export default function WechatPushLogsPage() {
  const [logs, setLogs] = useState<PushLogV2[]>([]);
  const [groups, setGroups] = useState<PushLogGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);

  // 筛选条件
  const [moduleCode, setModuleCode] = useState('all');
  const [status, setStatus] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [keyword, setKeyword] = useState('');
  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set());

  // 多选
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [repushing, setRepushing] = useState(false);

  // 手动推送面板
  const [showManualPush, setShowManualPush] = useState(false);
  const [pushModule, setPushModule] = useState('');
  const [sourceData, setSourceData] = useState<any[]>([]);
  const [sourceTotal, setSourceTotal] = useState(0);
  const [sourcePage, setSourcePage] = useState(1);
  const [sourceKeyword, setSourceKeyword] = useState('');
  const [sourceLoading, setSourceLoading] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<number>>(new Set());
  const [pushTemplates, setPushTemplates] = useState<PushTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number>(0);

  // 详情弹窗
  const [detailLog, setDetailLog] = useState<PushLogV2 | null>(null);

  // 模块列表（用于下拉）
  const [moduleList, setModuleList] = useState<{ moduleCode: string; moduleName: string }[]>([]);

  useEffect(() => { loadModules(); }, []);
  useEffect(() => { load(); }, [page]);

  const loadModules = async () => {
    try {
      const mods = await getModules();
      setModuleList(mods.map(m => ({ moduleCode: m.moduleCode, moduleName: m.moduleName })));
    } catch { /* ignore */ }
  };

  const load = async (p = page) => {
    setLoading(true);
    try {
      const r = await getPushLogs({
        moduleCode: moduleCode === 'all' ? undefined : moduleCode,
        status: status === 'all' ? undefined : status,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        keyword: keyword || undefined,
        page: p,
        pageSize,
        groupBy: 'module',
      });
      setLogs(r.logs || []);
      setGroups(r.groups || []);
      setTotal(r.total || 0);
    } catch {
      setLogs([]); setGroups([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => { setPage(1); load(1); };

  const handleRepush = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定重新推送选中的 ${selectedIds.size} 条记录？推送模式由模板决定。`)) return;
    setRepushing(true);
    try {
      await rePushLogs(Array.from(selectedIds));
      setSelectedIds(new Set());
      alert('重新推送请求已提交，请稍后刷新查看结果');
      load();
    } catch (err: any) {
      alert('重新推送失败: ' + (err?.response?.data?.error || err.message));
    } finally {
      setRepushing(false);
    }
  };

  // 手动推送：加载源数据
  const loadSourceData = async (p = 1) => {
    if (!pushModule) return;
    setSourceLoading(true);
    try {
      const r = await getSourceData(pushModule, { keyword: sourceKeyword || undefined, page: p, pageSize: 20 });
      setSourceData(r.rows || []); setSourceTotal(r.total || 0); setSourcePage(p);
    } catch { setSourceData([]); setSourceTotal(0); }
    setSourceLoading(false);
  };

  const handleManualPush = async () => {
    if (selectedSourceIds.size === 0 || !pushModule) return;
    if (!selectedTemplateId) { alert('请先选择一个模板'); return; }
    const tpl = pushTemplates.find(t => t.id === selectedTemplateId);
    const isSummary = tpl?.pushMode === 'summary';
    const confirmMsg = isSummary
      ? `确定用模板「${tpl?.title || tpl?.templateName}」将选中的 ${selectedSourceIds.size} 条数据合并为 1 条汇总消息推送？`
      : `确定用模板「${tpl?.title || tpl?.templateName}」逐条推送选中的 ${selectedSourceIds.size} 条数据（共 ${selectedSourceIds.size} 条消息）？`;
    if (!confirm(confirmMsg)) return;
    setRepushing(true);
    try {
      const r = await manualPush(pushModule, Array.from(selectedSourceIds), true, selectedTemplateId);
      alert(`推送完成：${r.results?.map((x: any) => x.summary).join('; ') || 'OK'}`);
      setSelectedSourceIds(new Set());
      loadSourceData(sourcePage);
      load();
    } catch (err: any) {
      alert('推送失败: ' + (err?.response?.data?.error || err.message));
    } finally { setRepushing(false); }
  };

  const toggleModule = (code: string) => {
    const next = new Set(collapsedModules);
    if (next.has(code)) next.delete(code); else next.add(code);
    setCollapsedModules(next);
  };

  // 当前选中模板（派生）
  const selectedTpl = pushTemplates.find(t => t.id === selectedTemplateId);
  const selectedTplSkipQuery = !!selectedTpl && selectedTpl.dataSourceMode === 'skip_query';

  // 有数据就推（不查询数据源）：后端自动按模块条件圈选全部符合条件且未推送的数据
  const handleDirectPush = async () => {
    if (!pushModule) return;
    if (!selectedTemplateId) { alert('请先选择一个模板'); return; }
    const tpl = pushTemplates.find(t => t.id === selectedTemplateId);
    const isSummary = tpl?.pushMode === 'summary';
    const confirmMsg = isSummary
      ? `确定用模板「${tpl?.title || tpl?.templateName}」自动圈选全部符合条件且未推送的数据，合并为 1 条汇总消息推送？（无数据会自动跳过）`
      : `确定用模板「${tpl?.title || tpl?.templateName}」自动圈选全部符合条件且未推送的数据并逐条推送？（无数据会自动跳过）`;
    if (!confirm(confirmMsg)) return;
    setRepushing(true);
    try {
      const r = await manualPush(pushModule, [], true, selectedTemplateId);
      if (r.skipped) {
        alert('当前没有符合条件且未推送的数据，已跳过推送');
      } else {
        alert(`推送完成：${r.results?.map((x: any) => x.summary).join('; ') || 'OK'}`);
      }
      load();
    } catch (err: any) {
      alert('推送失败: ' + (err?.response?.data?.error || err.message));
    } finally { setRepushing(false); }
  };

  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === logs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(logs.map(l => l.id)));
    }
  };

  // 按模块分组日志
  const groupedLogs: Record<string, PushLogV2[]> = {};
  for (const l of logs) {
    if (!groupedLogs[l.moduleCode]) groupedLogs[l.moduleCode] = [];
    groupedLogs[l.moduleCode].push(l);
  }

  const StatusIcon = ({ status }: { status: string }) => {
    switch (status) {
      case 'success': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'failed': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'pending': return <Clock className="w-4 h-4 text-blue-500" />;
      case 'skipped': return <SkipForward className="w-4 h-4 text-gray-400" />;
      default: return null;
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="min-h-screen bg-gray-100">
      <PageHeader title="推送总列表" subtitle="多模块推送记录，支持筛选、分组与重新推送" />
      <div className="max-w-7xl mx-auto px-4 py-6 flex gap-4">
        <WechatPushSidebar />
        <div className="flex-1 min-w-0 space-y-4">
        {/* 手动推送入口 */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button onClick={() => { setShowManualPush(!showManualPush); if (!showManualPush) setPushModule(''); }}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm flex items-center gap-1">
                <Plus size={16} /> 手动推送
              </button>
              <span className="text-xs text-gray-500">选择模块与模板 → 按数据源策略推送（实时查询勾选 / 一键有数据就推）</span>
            </div>
          </div>

          {showManualPush && (
            <div className="mt-3 border-t pt-3">
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-1">
                  <label className="text-sm text-gray-600">模块:</label>
                  <select className="border rounded px-3 py-1.5 text-sm" value={pushModule}
                    onChange={e => { setPushModule(e.target.value); setSelectedSourceIds(new Set()); setSelectedTemplateId(0);
                      if (e.target.value) getTemplates(e.target.value).then(t => setPushTemplates(t || [])).catch(() => setPushTemplates([]));
                    }}>
                    <option value="">-- 请选择 --</option>
                    {moduleList.map(m => <option key={m.moduleCode} value={m.moduleCode}>{m.moduleName}</option>)}
                  </select>
                </div>
                {pushModule && (
                  <div className="flex items-center gap-1">
                    <label className="text-sm text-gray-600">模板:</label>
                    <select className="border rounded px-3 py-1.5 text-sm" value={selectedTemplateId}
                      onChange={e => { setSelectedTemplateId(Number(e.target.value)); setSelectedSourceIds(new Set()); setSourceData([]); }}>
                      <option value={0}>-- 请选择模板 --</option>
                      {pushTemplates.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.title || t.templateName} ({t.pushMode === 'summary' ? '汇总' : '明细'}{t.dataSourceMode === 'skip_query' ? '·有数据就推' : ''})
                        </option>
                      ))}
                    </select>
                    {selectedTemplateId > 0 && (() => {
                      const tpl = pushTemplates.find(t => t.id === selectedTemplateId);
                      return <span className="text-xs text-gray-400">推送模式: {tpl?.pushMode === 'summary' ? '汇总' : '明细'} · 数据源: {tpl?.dataSourceMode === 'skip_query' ? '不查询·有数据就推' : '实时查询'}</span>;
                    })()}
                  </div>
                )}
                {!selectedTplSkipQuery && (
                  <>
                    <input className="border rounded px-2 py-1.5 text-sm w-48" placeholder="搜索关键词..."
                      value={sourceKeyword} onChange={e => setSourceKeyword(e.target.value)} />
                    <button onClick={() => loadSourceData(1)} disabled={!pushModule || sourceLoading}
                      className="px-3 py-1.5 bg-blue-500 text-white rounded text-sm flex items-center gap-1">
                      <Search size={14} /> 查询源数据
                    </button>
                  </>
                )}
              </div>

              {/* 数据源策略：不查询数据源，有数据就推 */}
              {selectedTplSkipQuery && (
                <div className="mt-3 p-3 bg-indigo-50 border border-indigo-200 rounded">
                  <p className="text-xs text-indigo-700 mb-2">该模板为「不查询数据源，有数据就推」：点击下方按钮后，系统自动按模块条件圈选全部符合条件且未推送的数据并推送（无数据自动跳过），无需手动勾选。</p>
                  <button onClick={handleDirectPush} disabled={repushing || !selectedTemplateId}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm flex items-center gap-1 disabled:opacity-50">
                    <Send size={14} /> {repushing ? '推送中...' : '有数据就推（一键推送）'}
                  </button>
                </div>
              )}

              {sourceData.length > 0 && (
                <>
                  <div className="text-xs text-gray-500 mb-2">共 {sourceTotal} 条，已选 {selectedSourceIds.size} 条</div>
                  <div className="border rounded max-h-64 overflow-auto mb-2">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-600 sticky top-0">
                        <tr>
                          <th className="px-2 py-1 w-8"><input type="checkbox" onChange={() => {
                            if (selectedSourceIds.size === sourceData.length) setSelectedSourceIds(new Set());
                            else setSelectedSourceIds(new Set(sourceData.map(r => r._sourceId)));
                          }} checked={selectedSourceIds.size === sourceData.length && sourceData.length > 0} /></th>
                          {Object.keys(sourceData[0] || {}).filter(k => !k.startsWith('_')).slice(0, 5).map(k => (
                            <th key={k} className="text-left px-2 py-1">{k}</th>
                          ))}
                          <th className="text-left px-2 py-1">状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sourceData.map(r => (
                          <tr key={r._sourceId} className={`border-t ${r._pushed ? 'bg-gray-50' : 'hover:bg-blue-50'}`}>
                            <td className="px-2 py-1">
                              <input type="checkbox" checked={selectedSourceIds.has(r._sourceId)}
                                onChange={() => {
                                  const next = new Set(selectedSourceIds);
                                  next.has(r._sourceId) ? next.delete(r._sourceId) : next.add(r._sourceId);
                                  setSelectedSourceIds(next);
                                }} />
                            </td>
                            {Object.keys(r).filter(k => !k.startsWith('_')).slice(0, 5).map(k => (
                              <td key={k} className="px-2 py-1 text-gray-700 max-w-[150px] truncate">{String(r[k] ?? '')}</td>
                            ))}
                            <td className="px-2 py-1">
                              {r._pushed ? <span className="text-green-600 text-xs">已推送</span> : <span className="text-orange-500 text-xs">未推送</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-1">
                      {sourcePage > 1 && <button onClick={() => loadSourceData(sourcePage - 1)} className="px-2 py-1 border rounded text-xs">上一页</button>}
                      {sourceTotal > sourcePage * 20 && <button onClick={() => loadSourceData(sourcePage + 1)} className="px-2 py-1 border rounded text-xs">下一页</button>}
                    </div>
                    <button onClick={handleManualPush} disabled={selectedSourceIds.size === 0 || repushing}
                      className="px-4 py-1.5 bg-green-600 text-white rounded text-sm flex items-center gap-1 disabled:opacity-50">
                      <Send size={14} /> {repushing ? '推送中...' : `推送选中 (${selectedSourceIds.size})`}
                    </button>
                  </div>
                </>
              )}
              {pushModule === 'custom_notification' && selectedTemplateId > 0 && (
                <div className="text-center py-4">
                  <p className="text-sm text-gray-600 mb-3">自定义通知无需查询源数据，选择模板和接收人后直接发送</p>
                  <button onClick={async () => {
                    const tpl = pushTemplates.find(t => t.id === selectedTemplateId);
                    if (!confirm(`确定用模板「${tpl?.title}」发送自定义通知？`)) return;
                    setRepushing(true);
                    try {
                      const r = await manualPush('custom_notification', [0], false, selectedTemplateId);
                      alert(r.results?.[0]?.summary || '已发送');
                    } catch (err: any) { alert('发送失败: ' + (err?.response?.data?.error || err.message)); }
                    setRepushing(false);
                  }} disabled={repushing}
                    className="px-6 py-2 bg-green-600 text-white rounded-lg text-sm flex items-center gap-1 mx-auto disabled:opacity-50">
                    <Send size={14} /> {repushing ? '发送中...' : '发送通知'}
                  </button>
                </div>
              )}
              {pushModule !== 'custom_notification' && pushModule && !sourceLoading && sourceData.length === 0 && !selectedTplSkipQuery && (
                <div className="text-center py-4 text-gray-400 text-sm">无数据或表不存在，请先查询</div>
              )}
            </div>
          )}
        </div>

        {/* 筛选栏 */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
            <div>
              <label className="text-xs text-gray-500">开始日期</label>
              <input type="date" className="w-full border rounded px-2 py-1.5 text-sm mt-0.5"
                value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500">结束日期</label>
              <input type="date" className="w-full border rounded px-2 py-1.5 text-sm mt-0.5"
                value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500">模块</label>
              <select className="w-full border rounded px-2 py-1.5 text-sm mt-0.5"
                value={moduleCode} onChange={e => setModuleCode(e.target.value)}>
                <option value="all">全部模块</option>
                {moduleList.map(m => (
                  <option key={m.moduleCode} value={m.moduleCode}>{m.moduleName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">状态</label>
              <select className="w-full border rounded px-2 py-1.5 text-sm mt-0.5"
                value={status} onChange={e => setStatus(e.target.value)}>
                <option value="all">全部状态</option>
                <option value="success">成功</option>
                <option value="failed">失败</option>
                <option value="pending">待推送</option>
                <option value="skipped">已跳过</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">关键词</label>
              <input type="text" className="w-full border rounded px-2 py-1.5 text-sm mt-0.5"
                placeholder="标题/督导/店铺/接收人" value={keyword}
                onChange={e => setKeyword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()} />
            </div>
            <div className="flex gap-2">
              <button onClick={handleSearch}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm">
                查询
              </button>
              <button onClick={() => { setModuleCode('all'); setStatus('all'); setStartDate(''); setEndDate(''); setKeyword(''); setPage(1); load(1); }}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-sm">
                重置
              </button>
            </div>
          </div>
        </div>

        {/* 操作栏 */}
        <div className="bg-white rounded-xl shadow-sm px-5 py-3 flex items-center justify-between">
          <span className="text-sm text-gray-600">
            共 <b>{total}</b> 条记录
            {selectedIds.size > 0 && <span className="ml-2 text-blue-600">（已选 {selectedIds.size} 条）</span>}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={handleRepush} disabled={selectedIds.size === 0 || repushing}
              className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm disabled:opacity-50 flex items-center gap-1">
              <Send size={14} /> {repushing ? '推送中...' : `重新推送 (${selectedIds.size})`}
            </button>
            <button onClick={async () => {
              if (selectedIds.size === 0) return;
              if (!confirm(`确定删除选中的 ${selectedIds.size} 条记录并释放其推送资源？`)) return;
              try { await batchDeletePushLogs(Array.from(selectedIds)); setSelectedIds(new Set()); load(); }
              catch (err: any) { alert('删除失败: ' + (err?.response?.data?.error || err.message)); }
            }} disabled={selectedIds.size === 0}
              className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded text-sm disabled:opacity-50 flex items-center gap-1">
              <Trash2 size={14} /> 删除 ({selectedIds.size})
            </button>
            <button onClick={() => load()} disabled={loading}
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-sm flex items-center gap-1">
              <RefreshCw size={14} /> 刷新
            </button>
          </div>
        </div>

        {/* 按模块分组的推送列表 */}
        <div className="space-y-4">
          {!loading && logs.length > 0 && (
            <div className="bg-gradient-to-r from-blue-50 to-green-50 rounded-xl shadow-sm px-5 py-3 flex items-center gap-6 text-sm border border-blue-100">
              <span className="text-gray-600 font-medium">📋 确认跟踪:</span>
              {(() => {
                const normalLogs = logs.filter(l => l.triggeredBy !== 'callback_reply' && l.status === 'success' && l.recipientAccount !== '(系统)');
                const acked = normalLogs.filter(l => l.acked === 1).length;
                const totalN = normalLogs.length;
                return (
                  <>
                    <span className="flex items-center gap-1 text-green-600"><UserCheck size={14} /> 已回复 <b>{acked}</b></span>
                    <span className="flex items-center gap-1 text-orange-500"><Clock size={14} /> 待回复 <b>{totalN - acked}</b></span>
                    <span className="text-gray-400">|</span>
                    <span className="text-gray-500">回复率 <b className={totalN > 0 && acked / totalN >= 0.8 ? 'text-green-600' : 'text-orange-500'}>{totalN > 0 ? (acked / totalN * 100).toFixed(0) : 0}%</b></span>
                    <span className="text-xs text-gray-400 ml-auto">共 {totalN} 条可追踪推送</span>
                  </>
                );
              })()}
            </div>
          )}
          {loading && logs.length === 0 && (
            <div className="text-center py-12 text-gray-400">加载中...</div>
          )}
          {!loading && logs.length === 0 && (
            <div className="text-center py-12 text-gray-400">暂无推送记录</div>
          )}

          {Object.entries(groupedLogs).map(([code, items]) => {
            const collapsed = collapsedModules.has(code);
            const groupStat = groups.find(g => g.moduleCode === code);
            return (
              <div key={code} className="bg-white rounded-xl shadow-sm overflow-hidden">
                {/* 模块标题 */}
                <div className="px-5 py-3 bg-gray-50 border-b flex items-center justify-between cursor-pointer hover:bg-gray-100"
                  onClick={() => toggleModule(code)}>
                  <div className="flex items-center gap-2">
                    {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    <span className="font-semibold text-gray-800">{MODULE_NAMES[code] || code}</span>
                    <span className="text-xs text-gray-400">({code})</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    {groupStat && (
                      <>
                        <span className="text-green-600">成功 {groupStat.successCount}</span>
                        <span className="text-red-600">失败 {groupStat.failedCount}</span>
                        <span className="text-gray-500">总计 {groupStat.total}</span>
                      </>
                    )}
                    {!groupStat && <span className="text-gray-500">{items.length} 条</span>}
                  </div>
                </div>

                {!collapsed && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-gray-500 text-xs">
                        <tr>
                          <th className="text-left px-3 py-2 w-8">
                            <input type="checkbox" className="w-4 h-4"
                              checked={items.every(l => selectedIds.has(l.id))}
                              onChange={toggleSelectAll} />
                          </th>
                          <th className="text-left px-3 py-2">时间</th>
                          <th className="text-left px-3 py-2">源ID</th>
                          <th className="text-left px-3 py-2">标题/摘要</th>
                          <th className="text-left px-3 py-2">负责人</th>
                          <th className="text-left px-3 py-2">对象</th>
                          <th className="text-left px-3 py-2">接收人</th>
                          <th className="text-left px-3 py-2">状态</th>
                          <th className="text-left px-3 py-2">确认</th>
                          <th className="text-left px-3 py-2">重试</th>
                          <th className="text-left px-3 py-2 max-w-[200px]">失败原因</th>
                          <th className="text-left px-3 py-2 w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map(l => (
                          <tr key={l.id} className="border-t hover:bg-blue-50 align-top cursor-pointer"
                            onClick={(e) => {
                              // 点 checkbox 不触发详情
                              if ((e.target as HTMLElement).tagName === 'INPUT') return;
                              setDetailLog(l);
                            }}>
                            <td className="px-3 py-2">
                              <input type="checkbox" className="w-4 h-4"
                                checked={selectedIds.has(l.id)}
                                onChange={() => toggleSelect(l.id)} />
                            </td>
                            <td className="px-3 py-2 text-gray-600 whitespace-nowrap text-xs">
                              {(() => {
                                const d = l.triggeredAt || l.createdAt;
                                if (!d) return '-';
                                const dt = new Date(d);
                                return <>{dt.toLocaleDateString('zh-CN')}<br /><span className="text-gray-400">{dt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></>;
                              })()}
                            </td>
                            <td className="px-3 py-2 text-gray-800 font-mono text-xs">#{l.sourceId}</td>
                            <td className="px-3 py-2 text-gray-800 text-xs max-w-[150px] truncate">
                              {l.sourceTitle || '-'}
                            </td>
                            <td className="px-3 py-2 text-gray-800 text-xs">{l.supervisor || '-'}</td>
                            <td className="px-3 py-2 text-gray-800 text-xs max-w-[100px] truncate">{l.destination || '-'}</td>
                            <td className="px-3 py-2 text-gray-800 text-xs whitespace-nowrap">
                              {l.recipientName}
                              <span className="text-gray-400 ml-1">({l.recipientAccount})</span>
                            </td>
                            <td className="px-3 py-2">
                              <span className="inline-flex items-center gap-1 text-xs">
                                <StatusIcon status={l.status} />
                                {l.status === 'success' && <span className="text-green-600">成功</span>}
                                {l.status === 'failed' && <span className="text-red-600">失败</span>}
                                {l.status === 'pending' && <span className="text-blue-600">待推送</span>}
                                {l.status === 'skipped' && <span className="text-gray-400">跳过</span>}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              {l.triggeredBy === 'callback_reply' ? (
                                <span className="text-xs text-blue-500">📨 回复</span>
                              ) : l.acked === 1 ? (
                                <span className="inline-flex items-center gap-1 text-xs text-green-600"><CheckCircle2 size={12} /> 已回复</span>
                              ) : l.status === 'success' && l.recipientAccount !== '(系统)' ? (
                                <span className="inline-flex items-center gap-1 text-xs text-orange-500"><Clock size={12} /> 待回复</span>
                              ) : (
                                <span className="text-xs text-gray-300">-</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-gray-600 text-xs">{l.retryCount || 0}</td>
                            <td className="px-3 py-2 text-gray-500 text-xs max-w-[200px] truncate">
                              {l.errorDetail || '-'}
                            </td>
                            <td className="px-3 py-2">
                              <button onClick={async (e) => {
                                e.stopPropagation();
                                if (!confirm('确定删除这条推送记录？将同时释放推送资源允许重新推送。')) return;
                                try { await deletePushLog(l.id); load(); }
                                catch (err: any) { alert('删除失败: ' + (err?.response?.data?.error || err.message)); }
                              }} className="text-gray-400 hover:text-red-500">
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="bg-white rounded-xl shadow-sm px-5 py-3 flex items-center justify-between text-sm">
            <span className="text-gray-500">第 {page} / {totalPages} 页</span>
            <div className="space-x-2">
              <button onClick={() => { const p = Math.max(1, page - 1); setPage(p); load(p); }}
                disabled={page === 1}
                className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50">
                上一页
              </button>
              <button onClick={() => { const p = Math.min(totalPages, page + 1); setPage(p); load(p); }}
                disabled={page >= totalPages}
                className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50">
                下一页
              </button>
            </div>
          </div>
        )}

        {/* 推送详情弹窗 */}
        {detailLog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center" onClick={() => setDetailLog(null)}>
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-auto mx-4" onClick={e => e.stopPropagation()}>
              <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between rounded-t-xl">
                <div className="flex items-center gap-2">
                  <FileText size={18} className="text-blue-600" />
                  <h2 className="text-lg font-bold text-gray-800">推送详情</h2>
                </div>
                <button onClick={() => setDetailLog(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
              </div>
              <div className="p-6 space-y-4">
                {/* 基本信息 */}
                <div className="grid grid-cols-2 gap-3">
                  <InfoItem label="推送时间" value={(() => { const d = detailLog.triggeredAt || detailLog.createdAt; return d ? new Date(d).toLocaleString('zh-CN') : '-'; })()} />
                  <InfoItem label="记录创建时间" value={detailLog.createdAt ? new Date(detailLog.createdAt).toLocaleString('zh-CN') : '-'} />
                  <InfoItem label="模块" value={MODULE_NAMES[detailLog.moduleCode] || detailLog.moduleCode} />
                  <InfoItem label="源数据ID" value={`#${detailLog.sourceId}`} />
                  <InfoItem label="数据表" value={detailLog.sourceTable} />
                  <InfoItem label="数据标题" value={detailLog.sourceTitle || '-'} />
                  <InfoItem label="负责人" value={detailLog.supervisor || '-'} />
                  <InfoItem label="对象/店铺" value={detailLog.destination || '-'} />
                  <InfoItem label="触发方式" value={detailLog.triggeredBy === 'manual' ? '手动推送' : detailLog.triggeredBy === 'auto' ? '自动触发' : detailLog.triggeredBy === 'polling' ? '轮询扫描' : detailLog.triggeredBy || '-'} />
                </div>

                {/* 推送状态 */}
                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">推送状态</h3>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <StatusIcon status={detailLog.status} />
                      <span className={`font-semibold text-sm ${detailLog.status === 'success' ? 'text-green-700' : detailLog.status === 'failed' ? 'text-red-700' : detailLog.status === 'pending' ? 'text-blue-700' : 'text-gray-500'}`}>
                        {detailLog.status === 'success' ? '推送成功' : detailLog.status === 'failed' ? '推送失败' : detailLog.status === 'pending' ? '待推送' : detailLog.status === 'skipped' ? '已跳过' : detailLog.status}
                      </span>
                    </div>
                    {detailLog.retryCount > 0 && (
                      <div className="text-xs text-gray-500">重试次数：{detailLog.retryCount} 次</div>
                    )}
                    {detailLog.errorDetail && (
                      <div className="mt-2 bg-red-50 border border-red-100 rounded p-3">
                        <div className="text-xs text-red-600 font-semibold mb-1">失败原因</div>
                        <pre className="text-xs text-red-700 whitespace-pre-wrap">{detailLog.errorDetail}</pre>
                      </div>
                    )}
                  </div>
                </div>

                {/* 接收人 */}
                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">接收人</h3>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{detailLog.recipientName}</span>
                      <span className="text-xs text-gray-400 bg-white border rounded px-2 py-0.5">{detailLog.recipientAccount}</span>
                    </div>
                  </div>
                </div>

                {/* 消息内容 */}
                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">推送消息内容</h3>
                  <pre className="bg-gray-50 border rounded-lg p-4 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-auto">{detailLog.messageContent}</pre>
                </div>
              </div>
              <div className="border-t px-6 py-3 flex justify-end bg-gray-50 rounded-b-xl">
                <button onClick={() => setDetailLog(null)} className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 rounded text-sm">关闭</button>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-gray-400 mb-0.5">{label}</div>
      <div className="text-sm text-gray-800 break-all">{value || '-'}</div>
    </div>
  );
}
