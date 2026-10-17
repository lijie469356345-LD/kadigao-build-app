import { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import {
  getRectifications, updateRectification, bulkMarkRectifications, deleteRectification,
  RectItem, RectRecord, RectSummary,
} from '../../api/storeRectifications';
import { Loader2, RefreshCw, CheckCheck, Trash2, ChevronRight, ChevronDown } from 'lucide-react';

const STATUS = ['待整改', '整改中', '已完成'] as const;
const STATUS_COLOR: Record<string, string> = {
  待整改: 'text-red-600 bg-red-50 border-red-200',
  整改中: 'text-amber-600 bg-amber-50 border-amber-200',
  已完成: 'text-green-600 bg-green-50 border-green-200',
};

function fmtDate(s?: string): string {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s).slice(0, 10);
  return d.toLocaleDateString('zh-CN');
}

function ScoreWarningRectificationPage() {
  const [summary, setSummary] = useState<RectSummary>({ total: 0, pending: 0, inProgress: 0, done: 0, openShops: 0, completionRate: 100 });
  const [records, setRecords] = useState<RectRecord[]>([]);
  const [items, setItems] = useState<RectItem[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('全部');
  const [keyword, setKeyword] = useState('');
  const [savingId, setSavingId] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const { user } = useAuthStore();
  const groupName = user?.groupName || '';

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getRectifications(groupName);
      setSummary(res.summary);
      setRecords(res.records);
      setItems(res.items);
      setExpanded(new Set());
    } catch (e) {
      console.error(e);
      showToast('加载整改数据失败');
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  // 明细过滤：状态 + 店铺关键词
  const visibleItems = useMemo(() => {
    let list = items;
    if (filter !== '全部') list = list.filter((i) => i.status === filter);
    if (keyword.trim()) list = list.filter((i) => i.shopName?.includes(keyword.trim()));
    return list;
  }, [items, filter, keyword]);

  // 记录聚合：满足任意可见明细的记录才展示
  const views = useMemo(() => records
    .filter((rec) => visibleItems.some((i) => i.recordId === rec.id))
    .map((rec) => ({ rec, detail: visibleItems.filter((i) => i.recordId === rec.id) }))
  , [records, visibleItems]);

  const toggleExpand = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const setStatus = async (item: RectItem, status: string) => {
    setItems((arr) => arr.map((x) => (x.id === item.id ? { ...x, status: status as RectItem['status'] } : x)));
    setSavingId(item.id);
    try {
      await updateRectification(item.id, { status });
      showToast('状态已更新');
    } catch (e) {
      console.error(e);
      showToast('更新失败');
    }
    setSavingId(null);
  };

  const saveRemark = async (item: RectItem, remark: string) => {
    if (remark === item.remark) return;
    setItems((arr) => arr.map((x) => (x.id === item.id ? { ...x, remark } : x)));
    try {
      await updateRectification(item.id, { remark });
      showToast('备注已保存');
    } catch (e) {
      console.error(e);
      showToast('备注保存失败');
    }
  };

  const completeRecord = async (rec: RectRecord) => {
    if (!window.confirm(`确认将「${rec.shopName}」该记录的整改项全部标记为已完成？`)) return;
    try {
      await bulkMarkRectifications([rec.id], '已完成');
      showToast('已批量完成');
      load();
    } catch (e) {
      console.error(e);
      showToast('操作失败');
    }
  };

  const removeItem = async (id: number) => {
    if (!window.confirm('确认删除该整改项？')) return;
    try {
      await deleteRectification(id);
      showToast('已删除');
      load();
    } catch (e) {
      console.error(e);
      showToast('删除失败');
    }
  };

  return (
    <Layout title="店铺整改确认" subtitle="整改项跟踪与确认">
      <div className="p-3 md:p-6 max-w-[1100px] mx-auto">
        {/* 汇总 */}
        {!loading && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <div className="bg-white rounded-xl shadow-sm px-4 py-3">
              <div className="text-2xl font-bold text-red-600">{summary.pending}</div>
              <div className="text-sm text-gray-500">待整改</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm px-4 py-3">
              <div className="text-2xl font-bold text-amber-600">{summary.inProgress}</div>
              <div className="text-sm text-gray-500">整改中</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm px-4 py-3">
              <div className="text-2xl font-bold text-green-600">{summary.done}</div>
              <div className="text-sm text-gray-500">已完成</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm px-4 py-3">
              <div className="text-2xl font-bold text-red-600">{summary.openShops}</div>
              <div className="text-sm text-gray-500">未完成店铺</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm px-4 py-3">
              <div className="text-2xl font-bold flex items-center gap-2">{summary.completionRate}%<span className="text-xs text-gray-400">完成率</span></div>
              <div className="h-2 bg-gray-200 rounded-full mt-2 overflow-hidden">
                <div className={`h-full ${summary.completionRate >= 85 ? 'bg-green-500' : summary.completionRate >= 70 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: summary.completionRate + '%' }}></div>
              </div>
            </div>
          </div>
        )}

        {/* 工具条 */}
        <div className="flex flex-wrap items-center gap-2 mb-4 bg-white rounded-xl shadow-sm px-4 py-3">
          <div className="flex gap-1">
            {['全部', '待整改', '整改中', '已完成'].map((s) => (
              <button key={s} onClick={() => setFilter(s)}
                className={`px-3 py-1 rounded-full text-sm ${filter === s ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {s}
              </button>
            ))}
          </div>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索店铺名称"
            className="ml-auto border rounded-lg px-3 py-1.5 text-sm w-48"
          />
          <button onClick={load} className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm flex items-center gap-1">
            <RefreshCw className="w-4 h-4" /> 刷新
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-amber-500" /></div>
        ) : views.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-400">
            <div className="text-5xl mb-3">✅</div>没有需要整改的记录
          </div>
        ) : (
          <div className="space-y-3 overflow-x-auto min-w-[680px] max-w-full">
            {views.map(({ rec, detail }) => {
              const open = expanded.has(rec.id);
              return (
                <div key={rec.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                  {/* 记录条（点击展开/收起，默认收起） */}
                  <div
                    onClick={() => toggleExpand(rec.id)}
                    className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 cursor-pointer transition ${open ? 'bg-amber-50 border-b' : 'hover:bg-gray-50'}`}
                  >
                    <span className="text-gray-400">{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
                    <span className="text-xs text-gray-400 w-20">日期 {fmtDate(rec.createdAt)}</span>
                    <span className="font-semibold text-gray-800 min-w-[8rem]">{rec.shopName}</span>
                    <span className={`text-sm px-2 py-0.5 rounded ${rec.totalScore >= 85 ? 'bg-green-50 text-green-600' : rec.totalScore >= 70 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'}`}>
                      得分 {rec.totalScore}/{rec.fullScore}
                    </span>
                    <span className="text-xs text-gray-500">扣分项 {rec.deductCount}</span>
                    <span className="text-xs text-red-500 font-medium">扣 {rec.deductTotal} 分</span>
                    <span className="text-xs text-gray-400">已办 {rec.doneCount}/{rec.deductCount}</span>
                  </div>

                  {/* 展开的明细（点击后才展示） */}
                  {open && (
                    <div className="bg-gray-50">
                      {detail.length === 0 ? (
                        <div className="px-4 py-6 text-center text-gray-400 text-sm">无匹配的明细</div>
                      ) : (
                        detail.map((it) => (
                          <div key={it.id} className="px-4 py-3 border-b last:border-0">
                            <div className="text-[13px] leading-snug">
                              <span className="text-gray-400 text-xs mr-1">[{it.project}·{it.section}]</span>
                              {it.content}
                            </div>
                            <div className="mt-1 text-xs text-red-500">扣 {it.gap} 分</div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <select value={it.status}
                                onChange={(e) => setStatus(it, e.target.value)}
                                className={`text-xs border rounded px-2 py-1 ${STATUS_COLOR[it.status] || ''}`}>
                                {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                              </select>
                              <input
                                defaultValue={it.remark}
                                onBlur={(e) => saveRemark(it, e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                placeholder="整改说明/备注"
                                className="flex-1 min-w-[180px] border rounded px-2 py-1 text-xs"
                              />
                              <span className="text-xs text-gray-300">回车保存备注</span>
                              <button onClick={() => removeItem(it.id)} className="text-red-400 hover:text-red-600 ml-auto">
                                <Trash2 className="w-4 h-4" />
                              </button>
                              {savingId === it.id && <Loader2 className="w-4 h-4 animate-spin text-amber-500" />}
                            </div>
                          </div>
                        ))
                      )}
                      <div className="flex items-center justify-between px-4 py-2 bg-gray-50">
                        <span className="text-xs text-gray-400">共 {detail.length} 项明细</span>
                        <button onClick={() => completeRecord(rec)}
                          className="px-3 py-1.5 rounded-lg bg-green-500 text-white text-sm flex items-center gap-1 hover:bg-green-600">
                          <CheckCheck className="w-4 h-4" /> 本记录全部完成
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50">{toast}</div>
      )}
    </Layout>
  );
}

export default ScoreWarningRectificationPage;