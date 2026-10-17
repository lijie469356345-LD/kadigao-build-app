import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardList, AlertCircle, ChevronDown, Eye } from 'lucide-react';
import { getFeedbackTasks, getFeedbackDetails } from '../../api/feedback';

function PublicFeedbackDetailPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<any[]>([]);
  const [details, setDetails] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskIdFilter, setTaskIdFilter] = useState<string>('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [ts, ds] = await Promise.all([
        getFeedbackTasks(),
        getFeedbackDetails(),
      ]);
      setTasks(ts);
      setDetails(ds as any[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // 判断任务是否过期
  const isTaskExpired = (task: any) => {
    if (!task.endTime) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const end = new Date(task.endTime); end.setHours(23, 59, 59, 999);
    return today.getTime() > end.getTime();
  };

  // 找出所有任务是否都已过期 => 整体敬请期待
  const publishedTasks = tasks.filter((t) => t.status !== 'draft');
  const hasAnyActive = publishedTasks.some((t) => !isTaskExpired(t));

  const filteredDetails = (() => {
    let rows = details.filter((d: any) => !d.isDefault); // 默认隐藏默认反馈表（除非开启）
    if (taskIdFilter) {
      rows = rows.filter((d: any) => String(d.taskId) === String(taskIdFilter));
    }
    // 过期任务的明细隐藏（根据点10：截止时间之后，所有明细表被隐藏）
    const expiredTaskIds = new Set(
      publishedTasks.filter(isTaskExpired).map((t: any) => String(t.id))
    );
    rows = rows.filter((d: any) => !expiredTaskIds.has(String(d.taskId)));
    return rows;
  })();

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/public-feedback')}
              className="p-2 text-gray-600 bg-white rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-800">反馈明细表</h1>
              <p className="text-xs text-gray-500 mt-1">全员可查看 · 管理员控制任务与问题</p>
            </div>
          </div>
        </div>

        {!hasAnyActive && publishedTasks.length > 0 && (
          <div className="mb-6 p-6 bg-amber-50 border border-amber-200 rounded-2xl text-center">
            <AlertCircle className="mx-auto text-amber-500 mb-3" size={48} />
            <h2 className="text-2xl font-bold text-amber-800">敬请期待</h2>
            <p className="text-sm text-amber-700 mt-2">
              当前所有反馈任务均已过截止时间，所有历史明细已隐藏。请等待管理员发布新任务。
            </p>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-gray-800 flex items-center gap-2">
              <ClipboardList className="text-emerald-600" size={20} /> 可反馈的任务
            </h2>
            <button
              onClick={load}
              className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >刷新</button>
          </div>

          {loading ? (
            <div className="py-10 text-center text-sm text-gray-500">加载中...</div>
          ) : publishedTasks.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-500">暂无发布的反馈任务</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {publishedTasks.map((t) => {
                const expired = isTaskExpired(t);
                const taskDetails = details.filter((d: any) => String(d.taskId) === String(t.id) && !d.isDefault && d.status === 'submitted');
                const users = Array.from(new Set(taskDetails.map((d: any) => d.userName).filter(Boolean)));
                const shops = Array.from(new Set(taskDetails.map((d: any) => d.shopName).filter(Boolean)));
                return (
                  <div
                    key={t.id}
                    className={`p-4 border rounded-xl ${expired ? 'bg-gray-50 border-gray-200 opacity-75' : 'border-gray-200 hover:border-emerald-400 hover:shadow-sm bg-white'} transition-all`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-gray-400 font-mono">{t.taskNo}</div>
                        <div className="font-bold text-gray-800 mt-0.5 truncate">{t.title}</div>
                        {t.remark && (
                          <div className="text-xs text-gray-500 mt-1 line-clamp-2">{t.remark}</div>
                        )}
                        <div className="mt-3 text-xs text-gray-700 border-t border-gray-100 pt-2 space-y-1">
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
                        <div className="text-xs text-gray-500 mt-2">
                          开始 {t.startTime || '-'} · 截止 {t.endTime || '-'}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-end">
                      {!expired ? (
                        <button
                          onClick={() => navigate(`/public-feedback/form/${t.id}`)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-500 text-white text-sm rounded-lg hover:bg-emerald-600 transition-colors shadow-sm"
                        >
                          我要反馈
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-2 bg-amber-100 text-amber-700 text-sm rounded-lg">
                          敬请期待（已过截止时间）
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <h2 className="font-bold text-gray-800">已提交的反馈明细</h2>
            <div className="flex items-center gap-2">
              <select
                value={taskIdFilter}
                onChange={(e) => setTaskIdFilter(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 outline-none"
              >
                <option value="">全部任务</option>
                {publishedTasks.map((t) => (
                  <option key={t.id} value={t.id}>{t.taskNo} · {t.title}</option>
                ))}
              </select>
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
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">提交时间</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">详情</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDetails.map((d: any) => (
                    <tr key={d.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                      <td className="px-3 py-2 text-xs font-mono text-gray-500">{d.detailNo}</td>
                      <td className="px-3 py-2 text-xs font-mono text-gray-500">{d.taskNo}</td>
                      <td className="px-3 py-2 text-gray-700">{d.taskTitle}</td>
                      <td className="px-3 py-2 text-gray-700">{d.userName}</td>
                      <td className="px-3 py-2 text-gray-700">{d.shopName}</td>
                      <td className="px-3 py-2 text-gray-700">{d.phone}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{d.createdAt}</td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => setExpanded((prev) => ({ ...prev, [d.id]: !prev[d.id] }))}
                          className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700"
                        >
                          {expanded[d.id] ? <ChevronDown size={14} /> : <Eye size={14} />}
                          {expanded[d.id] ? '收起' : '查看'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-4 space-y-3">
                {filteredDetails
                  .filter((d: any) => expanded[d.id])
                  .map((d: any) => (
                    <div key={d.id} className="p-4 bg-emerald-50/40 rounded-xl border border-emerald-200">
                      <div className="font-bold text-sm text-gray-800 mb-2">
                        {d.userName} · {d.shopName} · {d.phone}
                      </div>
                      <div className="space-y-2">
                        {d.answers.map((a: any, idx: number) => (
                          <div key={idx} className="p-3 bg-white rounded-lg border border-gray-200">
                            <div className="text-xs font-medium text-gray-600 mb-1">问题 {idx + 1}: {a.question}</div>
                            <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{a.answer}</div>
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
      </div>
    </div>
  );
}

export default PublicFeedbackDetailPage;
