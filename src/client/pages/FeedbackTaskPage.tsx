import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Edit2, Trash2, Play, ArrowLeft, X, PlusCircle, AlertCircle, CheckCircle2, RefreshCw,
} from 'lucide-react';
import {
  getFeedbackTasks, createFeedbackTask, updateFeedbackTask, deleteFeedbackTask, executeFeedbackTask,
} from '../../api/feedback';
import { useAuthStore } from '../../store/authStore';
import { useDataCacheStore } from '../../store/dataCacheStore';
import Layout from '../components/Layout';

const PAGE_KEY = 'feedbackTaskPage';

function genId() {
  return `q_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function statusBadge(status: string) {
  const map: Record<string, { text: string; cls: string }> = {
    draft: { text: '草稿', cls: 'bg-gray-100 text-gray-700' },
    running: { text: '执行中', cls: 'bg-blue-100 text-blue-700' },
    submitted: { text: '已发布', cls: 'bg-emerald-100 text-emerald-700' },
    closed: { text: '已关闭', cls: 'bg-red-100 text-red-700' },
  };
  const m = map[status] || { text: status, cls: 'bg-gray-100 text-gray-700' };
  return <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${m.cls}`}>{m.text}</span>;
}

function FeedbackTaskPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { pageCache, setPageCache, clearPageCache } = useDataCacheStore();
  const isAdmin = user?.isAdmin === '是';

  const cached = pageCache[PAGE_KEY];
  const [tasks, setTasks] = useState<any[]>(cached || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [isNew, setIsNew] = useState(true);

  useEffect(() => {
    if (!cached) {
      load();
    }
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const list = await getFeedbackTasks();
      setTasks(list);
      setPageCache(PAGE_KEY, list);
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    clearPageCache(PAGE_KEY);
    load();
  };

  const QUESTION_TYPES: { value: 'text' | 'choice' | 'tf'; label: string }[] = [
    { value: 'text', label: '问答题' },
    { value: 'choice', label: '选择题' },
    { value: 'tf', label: '判断题' },
  ];

  const openNew = () => {
    setEditing({
      title: '', remark: '', startTime: '', endTime: '',
      items: [{ id: genId(), type: 'text', question: '' }],
      status: 'draft',
    });
    setIsNew(true);
    setEditorOpen(true);
  };

  const openEdit = (t: any) => {
    setEditing(JSON.parse(JSON.stringify(t)));
    setIsNew(false);
    setEditorOpen(true);
  };

  const handleDelete = async (t: any) => {
    if (!confirm(`确定删除任务单"${t.title}"？`)) return;
    try {
      await deleteFeedbackTask(t.id);
      await load();
    } catch (e: any) {
      alert('删除失败: ' + e.message);
    }
  };

  const addItem = (type: 'text' | 'choice' | 'tf') => {
    const base: any = { id: genId(), type, question: '' };
    if (type === 'choice') base.options = ['', ''];
    if (type === 'tf') base.options = ['正确', '错误'];
    setEditing((e: any) => ({ ...e, items: [...e.items, base] }));
  };

  const removeItem = (idx: number) => {
    setEditing((e: any) => ({ ...e, items: e.items.filter((_: any, i: number) => i !== idx) }));
  };

  const updateItemQuestion = (idx: number, val: string) => {
    setEditing((e: any) => {
      const items = e.items.slice();
      items[idx] = { ...items[idx], question: val };
      return { ...e, items };
    });
  };

  const updateItemType = (idx: number, type: 'text' | 'choice' | 'tf') => {
    setEditing((e: any) => {
      const items = e.items.slice();
      const item = { ...items[idx], type };
      if (type === 'choice' && !item.options?.length) item.options = ['', ''];
      if (type === 'tf') item.options = ['正确', '错误'];
      if (type === 'text') delete item.options;
      items[idx] = item;
      return { ...e, items };
    });
  };

  const updateItemOption = (idx: number, optIdx: number, val: string) => {
    setEditing((e: any) => {
      const items = e.items.slice();
      const options = [...(items[idx].options || [])];
      options[optIdx] = val;
      items[idx] = { ...items[idx], options };
      return { ...e, items };
    });
  };

  const addItemOption = (idx: number) => {
    setEditing((e: any) => {
      const items = e.items.slice();
      const options = [...(items[idx].options || []), ''];
      items[idx] = { ...items[idx], options };
      return { ...e, items };
    });
  };

  const removeItemOption = (idx: number, optIdx: number) => {
    setEditing((e: any) => {
      const items = e.items.slice();
      const options = (items[idx].options || []).filter((_: string, i: number) => i !== optIdx);
      items[idx] = { ...items[idx], options };
      return { ...e, items };
    });
  };

  const save = async (opts: { publish?: boolean } = {}) => {
    if (!editing) return;
    if (!editing.title.trim()) { alert('请填写任务主题'); return; }
    if (!editing.items || editing.items.length === 0) { alert('至少需要一个问题'); return; }
    for (const it of editing.items) {
      if (!it.question.trim()) { alert('问题不能为空'); return; }
    }
    try {
      const payload: any = {
        title: editing.title,
        remark: editing.remark,
        startTime: editing.startTime,
        endTime: editing.endTime,
        items: editing.items,
        status: opts.publish ? 'submitted' : editing.status || 'draft',
        createdBy: user?.userCode || '',
        createdByName: user?.userName || '',
      };
      if (isNew) {
        await createFeedbackTask(payload);
      } else {
        await updateFeedbackTask(editing.id, payload);
      }
      setEditorOpen(false);
      await load();
    } catch (err: any) {
      alert('保存失败: ' + err.message);
    }
  };

  const execute = async (t: any) => {
    if (!confirm(`执行任务单"${t.title}"将生成默认反馈表并允许员工提交反馈，是否继续？`)) return;
    try {
      await executeFeedbackTask(t.id);
      alert('执行成功，已生成默认反馈表');
      await load();
    } catch (err: any) {
      alert('执行失败: ' + err.message);
    }
  };

  if (!isAdmin) {
    return (
      <Layout title="培训反馈">
        <div className="p-8 bg-white rounded-2xl shadow border border-gray-100 text-center max-w-md mx-auto">
          <AlertCircle className="mx-auto text-red-400 mb-3" size={48} />
          <h3 className="text-lg font-bold text-gray-800 mb-2">权限不足</h3>
          <p className="text-sm text-gray-500">反馈任务单管理仅管理员可见与维护，请联系管理员。</p>
          <button
            onClick={() => navigate('/staff-channel')}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm rounded-lg hover:bg-primary-dark"
          >返回培训反馈</button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="培训反馈 · 任务单管理" subtitle="管理员创建任务单、执行与发布">
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <button
          onClick={() => navigate('/staff-channel')}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white rounded-lg border border-gray-200 hover:bg-gray-50"
        >
          <ArrowLeft size={16} /> 返回培训反馈
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/staff-channel/details')}
            className="px-4 py-2 text-sm text-gray-600 bg-white rounded-lg border border-gray-200 hover:bg-gray-50">查看反馈明细</button>
          <button onClick={handleRefresh}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> 刷新数据
          </button>
          <button onClick={openNew}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm rounded-lg hover:bg-primary-dark shadow-sm">
            <Plus size={18} /> 新建任务单
          </button>
        </div>
      </div>

      {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-sm text-gray-500">加载中...</div>
        ) : tasks.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-500">暂无任务单</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">任务编号</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">主题</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">备注</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">开始</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">截止</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">问题</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">状态</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">创建人</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} className="border-t border-gray-100 hover:bg-gray-50/60">
                    <td className="px-3 py-2 text-xs font-mono text-gray-500">{t.taskNo}</td>
                    <td className="px-3 py-2 font-medium text-gray-800">{t.title}</td>
                    <td className="px-3 py-2 text-gray-600 max-w-xs truncate">{t.remark || '-'}</td>
                    <td className="px-3 py-2 text-gray-600">{t.startTime || '-'}</td>
                    <td className="px-3 py-2 text-gray-600">{t.endTime || '-'}</td>
                    <td className="px-3 py-2 text-gray-600">{t.items?.length || 0}</td>
                    <td className="px-3 py-2">{statusBadge(t.status)}</td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{t.createdByName || '-'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(t)} className="p-1.5 text-primary hover:bg-primary/10 rounded-lg" title="编辑"><Edit2 size={16} /></button>
                        {t.status === 'draft' && (
                          <button onClick={() => execute(t)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="执行（生成默认反馈表）">
                            <Play size={16} />
                          </button>
                        )}
                        <button onClick={() => handleDelete(t)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="删除"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editorOpen && editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-8">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10">
              <div>
                <h3 className="text-lg font-bold text-gray-800">{isNew ? '新建任务单' : '编辑任务单'}</h3>
                <p className="text-xs text-gray-500 mt-0.5">填写任务信息、开始/截止时间，并维护问题列表</p>
              </div>
              <button onClick={() => setEditorOpen(false)} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">任务主题 <span className="text-red-500">*</span></label>
                  <input type="text" value={editing.title || ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                    placeholder="如：2026 Q2 培训反馈"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/40 focus:border-primary outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">开始时间</label>
                  <input type="date" value={editing.startTime || ''} onChange={(e) => setEditing({ ...editing, startTime: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/40 focus:border-primary outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">截止时间</label>
                  <input type="date" value={editing.endTime || ''} onChange={(e) => setEditing({ ...editing, endTime: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/40 focus:border-primary outline-none text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">备注</label>
                  <textarea rows={2} value={editing.remark || ''} onChange={(e) => setEditing({ ...editing, remark: e.target.value })}
                    placeholder="任务说明"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/40 focus:border-primary outline-none text-sm resize-none"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-gray-700">问题列表 <span className="text-xs text-gray-500 font-normal">（选择题需配置选项，判断题默认"正确/错误"）</span></label>
                  <div className="flex items-center gap-2">
                    {QUESTION_TYPES.map(qt => (
                      <button key={qt.value} onClick={() => addItem(qt.value)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary/10 text-primary rounded-lg hover:bg-primary/20">
                        <PlusCircle size={14} /> +{qt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  {editing.items.map((q: any, idx: number) => (
                    <div key={q.id} className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                      <div className="flex items-start gap-2 mb-3">
                        <span className="mt-2 text-sm font-medium text-gray-500 w-8">{idx + 1}.</span>
                        <select value={q.type || 'text'} onChange={(e) => updateItemType(idx, e.target.value as any)}
                          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary/40 outline-none">
                          {QUESTION_TYPES.map(qt => (
                            <option key={qt.value} value={qt.value}>{qt.label}</option>
                          ))}
                        </select>
                        <textarea rows={1} value={q.question} onChange={(e) => updateItemQuestion(idx, e.target.value)}
                          placeholder="请输入问题"
                          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/40 focus:border-primary outline-none text-sm resize-none"
                        />
                        <button onClick={() => removeItem(idx)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg" title="删除该问题">
                          <Trash2 size={18} />
                        </button>
                      </div>
                      {q.type === 'choice' && (
                        <div className="ml-10 space-y-2">
                          <div className="text-xs text-gray-500 mb-1">选项配置：</div>
                          {(q.options || ['', '']).map((opt: string, optIdx: number) => (
                            <div key={optIdx} className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 w-6">{String.fromCharCode(65 + optIdx)}.</span>
                              <input type="text" value={opt} onChange={(e) => updateItemOption(idx, optIdx, e.target.value)}
                                placeholder={`选项${String.fromCharCode(65 + optIdx)}内容`}
                                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary/40 outline-none"
                              />
                              <button onClick={() => removeItemOption(idx, optIdx)}
                                className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg text-xs">删除</button>
                            </div>
                          ))}
                          <button onClick={() => addItemOption(idx)}
                            className="ml-8 mt-1 text-xs text-primary hover:underline">+ 添加选项</button>
                        </div>
                      )}
                      {q.type === 'tf' && (
                        <div className="ml-10 text-xs text-gray-500">判断题默认选项：<span className="text-gray-700 font-medium">正确</span> / <span className="text-gray-700 font-medium">错误</span></div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-primary/5 rounded-xl border border-primary/20 text-sm text-primary">
                <CheckCircle2 size={16} className="inline-block mr-2" />
                流程提示：点击"保存草稿"先保存，点击"执行"将生成默认反馈表并变为"执行中"，点击"发布"将任务标记为"已发布"。
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3 sticky bottom-0 bg-white rounded-b-2xl">
              <button onClick={() => setEditorOpen(false)}
                className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">取消</button>
              <button onClick={() => save({ publish: false })}
                className="px-5 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">保存草稿</button>
              {isNew ? (
                <button onClick={() => save({ publish: false })}
                  className="px-5 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 shadow-sm">创建</button>
              ) : (
                <button onClick={() => save({ publish: true })}
                  className="inline-flex items-center gap-2 px-5 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-dark shadow-sm">
                  保存并发布
                </button>
              )}
              {!isNew && editing.status === 'draft' && (
                <button onClick={async () => {
                  await save({ publish: false });
                  if (!editorOpen) return;
                  await execute({ ...editing, status: 'draft' });
                }} className="inline-flex items-center gap-2 px-5 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 shadow-sm">
                  <Play size={16} /> 保存并执行
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

export default FeedbackTaskPage;
