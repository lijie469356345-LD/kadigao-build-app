import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, Eye, ClipboardList, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { getFeedbackTasks, getFeedbackDetails, deleteFeedbackDetail } from '../../api/feedback';
import { useAuthStore } from '../../store/authStore';
import Layout from '../components/Layout';

function FeedbackDetailPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [tasks, setTasks] = useState<any[]>([]);
  const [details, setDetails] = useState<any[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [filterUser, setFilterUser] = useState('');
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [ts, ds] = await Promise.all([getFeedbackTasks(), getFeedbackDetails()]);
      setTasks(ts);
      setDetails(ds as any[]);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const publishedTasks = tasks.filter((t) => t.status === 'running' || t.status === 'submitted');

  const isExpired = (t: any) => {
    if (!t?.endTime) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const end = new Date(t.endTime); end.setHours(23, 59, 59, 999);
    return today.getTime() > end.getTime();
  };

  const hasActive = publishedTasks.some((t) => !isExpired(t));

  const filteredDetails = (() => {
    let rows = details.filter((d: any) => !d.isDefault);
    if (selectedTaskId) {
      rows = rows.filter((d: any) => String(d.taskId) === String(selectedTaskId));
    }
    if (filterUser.trim()) {
      const kw = filterUser.trim();
      rows = rows.filter((d: any) =>
        (d.userName || '').includes(kw) || (d.shopName || '').includes(kw) || (d.phone || '').includes(kw),
      );
    }
    const expiredIds = new Set(publishedTasks.filter(isExpired).map((t: any) => String(t.id)));
    rows = rows.filter((d: any) => !expiredIds.has(String(d.taskId)));
    return rows;
  })();

  const handleDelete = async (d: any) => {
    if (!confirm(`删除该反馈明细（${d.userName} - ${d.taskTitle}）？`)) return;
    try {
      await deleteFeedbackDetail(d.id);
      await load();
    } catch (err: any) {
      alert('删除失败: ' + err.message);
    }
  };

  return (
    <Layout title="培训反馈 · 反馈明细表" subtitle="查看所有提交的反馈，并对执行中的任务提交反馈">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => navigate('/staff-channel')}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white rounded-lg border border-gray-200 hover:bg-gray-50">
          <ArrowLeft size={16} /> 返回培训反馈
        </button>
      </div>

      {!hasActive && publishedTasks.length > 0 && (
        <div className="mb-4 p-6 bg-amber-50 border border-amber-200 rounded-2xl text-center">
          <AlertCircle className="mx-auto text-amber-500 mb-3" size={48} />
          <h2 className="text-2xl font-bold text-amber-700">敬请期待</h2>
          <p className="text-sm text-amber-600 mt-2">当前所有反馈任务均已过截止时间，历史明细已隐藏，请等待管理员发布新任务。</p>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-5">
        <h4 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
          <ClipboardList className="text-primary" size={18} /> 可反馈任务
        </h4>
        {loading ? (
          <div className="py-10 text-center text-sm text-gray-500">加载中...</div>
        ) : publishedTasks.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-500">暂无可反馈任务，请等待管理员创建</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {publishedTasks.map((t) => {
              const expired = isExpired(t);
              const taskDetails = details.filter((d: any) => String(d.taskId) === String(t.id) && !d.isDefault && d.status === 'submitted');
              const users = Array.from(new Set(taskDetails.map((d: any) => d.userName).filter(Boolean)));
              const shops = Array.from(new Set(taskDetails.map((d: any) => d.shopName).filter(Boolean)));
              return (
                <div key={t.id}
                  className={`p-4 border rounded-xl ${expired ? 'bg-gray-50 border-gray-200 opacity-75' : 'border-gray-200 hover:border-primary/50 hover:shadow-sm bg-white'}`}>
                  <div className="text-xs font-mono text-gray-500">{t.taskNo}</div>
                  <div className="font-bold text-gray-800 mt-1 truncate">{t.title}</div>
                  {t.remark && <div className="text-xs text-gray-500 mt-1 line-clamp-2">{t.remark}</div>}
                  <div className="mt-3 text-xs text-gray-700 border-t border-gray-100 pt-3 space-y-1.5">
                    <div>
                      <span className="text-gray-500">用户：</span>
                      <span className="text-gray-800">
                        {users.length > 0 ? `${users.slice(0, 3).join('、')}${users.length > 3 ? ` 等${users.length}人` : ''}` : '暂无提交'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">店铺名称：</span>
                      <span className="text-gray-800">
                        {shops.length > 0 ? `${shops.slice(0, 3).join('、')}${shops.length > 3 ? ` 等${shops.length}家` : ''}` : '暂无'}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-gray-500">{t.startTime || '-'} 至 {t.endTime || '-'}</div>
                  <div className="mt-3 flex items-center justify-end">
                    {!expired ? (
                      <button onClick={() => navigate(`/staff-channel/form/${t.id}`)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm rounded-lg hover:bg-primary-dark shadow-sm">
                        <CheckCircle size={16} /> 我要反馈
                      </button>
                    ) : (
                      <span className="text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg">已截止，敬请期待</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h4 className="font-bold text-gray-800 flex items-center gap-2">
            <Eye className="text-primary" size={18} /> 反馈明细列表
          </h4>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
              <input type="text" value={filterUser} onChange={(e) => setFilterUser(e.target.value)}
                placeholder="用户/店铺/手机"
                className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <select value={selectedTaskId} onChange={(e) => setSelectedTaskId(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm outline-none bg-white focus:ring-2 focus:ring-primary/30 focus:border-primary">
              <option value="">全部任务</option>
              {tasks.map((t) => (<option key={t.id} value={t.id}>{t.taskNo} · {t.title}</option>))}
            </select>
            <button onClick={load} className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">刷新</button>
          </div>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-gray-500">加载中...</div>
        ) : filteredDetails.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-500">暂无反馈记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">明细编号</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">任务编号</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">任务主题</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">用户</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">店铺</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">手机号</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">状态</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">提交时间</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredDetails.map((d: any) => (
                  <tr key={d.id} className="border-t border-gray-100 hover:bg-gray-50/60">
                    <td className="px-3 py-2 text-xs font-mono text-gray-500">{d.detailNo}</td>
                    <td className="px-3 py-2 text-xs font-mono text-gray-500">{d.taskNo}</td>
                    <td className="px-3 py-2 font-medium text-gray-800">{d.taskTitle}</td>
                    <td className="px-3 py-2 text-gray-700">{d.userName}</td>
                    <td className="px-3 py-2 text-gray-700">{d.shopName}</td>
                    <td className="px-3 py-2 text-gray-700">{d.phone}</td>
                    <td className="px-3 py-2">
                      {d.status === 'submitted' ? (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-100 text-emerald-700">已提交（不可修改）</span>
                      ) : (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">{d.status || '草稿'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{d.createdAt}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setExpanded((prev) => ({ ...prev, [d.id]: !prev[d.id] }))}
                          className="p-1.5 text-primary hover:bg-primary/10 rounded-lg" title="查看内容">
                          <Eye size={16} />
                        </button>
                        {user?.isAdmin === '是' && d.status !== 'submitted' && (
                          <button onClick={() => handleDelete(d)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="删除">
                            <XCircle size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 space-y-3">
              {filteredDetails.filter((d: any) => expanded[d.id]).map((d: any) => (
                <div key={d.id} className="p-4 bg-primary/5 rounded-xl border border-primary/20">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                      <div className="font-bold text-gray-800">{d.userName} <span className="text-xs text-gray-500 font-normal">· {d.shopName} · {d.phone}</span></div>
                      <div className="text-xs text-gray-500 mt-0.5">任务: {d.taskTitle} ({d.taskNo})</div>
                    </div>
                    <span className="text-xs text-gray-400">明细编号: {d.detailNo}</span>
                  </div>
                  <div className="space-y-2">
                    {d.answers.map((a: any, idx: number) => (
                      <div key={idx} className="p-3 bg-white rounded-lg border border-gray-200">
                        <div className="text-xs font-medium text-gray-600 mb-1">问题 {idx + 1}：{a.question}</div>
                        <div className="text-sm text-gray-800 whitespace-pre-wrap">{a.answer}</div>
                      </div>
                    ))}
                  </div>
                  {d.remark && (
                    <div className="mt-2 p-3 bg-amber-50 rounded-lg border border-amber-200 text-sm">
                      <span className="font-medium text-amber-700 mr-2">备注：</span>
                      <span className="text-gray-700">{d.remark}</span>
                    </div>
                  )}
                  {d.signature && d.signature.startsWith('data:') && (
                    <div className="mt-2 p-3 bg-white rounded-lg border border-gray-200">
                      <div className="text-xs text-gray-500 mb-2">签字：</div>
                      <img src={d.signature} alt="签字" className="max-h-32" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default FeedbackDetailPage;
