import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, ArrowLeft, Users, AlertCircle, CheckCircle } from 'lucide-react';
import { getFeedbackTasks, getFeedbackDetails } from '../../api/feedback';

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { text: string; cls: string }> = {
    draft: { text: '草稿', cls: 'bg-gray-100 text-gray-700' },
    running: { text: '进行中', cls: 'bg-blue-100 text-blue-700' },
    submitted: { text: '已发布', cls: 'bg-emerald-100 text-emerald-700' },
    closed: { text: '已关闭', cls: 'bg-red-100 text-red-700' },
  };
  const m = map[status] || { text: status, cls: 'bg-gray-100 text-gray-700' };
  return <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${m.cls}`}>{m.text}</span>;
}

function PublicEntryPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<any[]>([]);
  const [details, setDetails] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const load = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const [ts, ds] = await Promise.all([getFeedbackTasks(), getFeedbackDetails()]);
      setTasks(ts.filter((t: any) => t.status !== 'draft'));
      setDetails(ds as any[]);
    } catch (e: any) {
      setErrorMsg('加载失败：' + (e.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isExpired = (end: string) => {
    if (!end) return false;
    const d = new Date(end); d.setHours(23, 59, 59, 999);
    return today.getTime() > d.getTime();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-sm">
              <Users className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-800">培训反馈 · 全员通道</h1>
              <p className="text-xs text-gray-500 mt-1">无需登录，即可查看反馈明细表并提交反馈</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/login')}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors shadow-sm"
          >
            <ArrowLeft size={16} />
            返回登录
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <button
            onClick={() => navigate('/public-feedback/details')}
            className="text-left p-5 bg-white rounded-2xl border border-gray-200 hover:border-emerald-400 hover:shadow-md transition-all group md:col-span-2"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center group-hover:bg-emerald-500 transition-colors">
                <ClipboardList className="w-6 h-6 text-emerald-600 group-hover:text-white transition-colors" />
              </div>
              <div>
                <div className="font-bold text-gray-800">反馈明细表</div>
                <div className="text-xs text-gray-500 mt-1">查看所有任务并提交反馈</div>
              </div>
            </div>
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-800">当前可反馈的培训任务</h2>
            <button
              onClick={load}
              className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              刷新
            </button>
          </div>

          {loading ? (
            <div className="py-12 text-center text-sm text-gray-500">加载中...</div>
          ) : errorMsg ? (
            <div className="p-4 bg-red-50 rounded-xl text-red-600 text-sm flex items-center gap-2">
              <AlertCircle size={16} /> {errorMsg}
            </div>
          ) : tasks.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">当前暂无发布中的反馈任务</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {tasks.map((t) => {
                const expired = isExpired(t.endTime);
                const taskDetails = details.filter((d: any) => String(d.taskId) === String(t.id) && !d.isDefault && d.status === 'submitted');
                const users = Array.from(new Set(taskDetails.map((d: any) => d.userName).filter(Boolean)));
                const shops = Array.from(new Set(taskDetails.map((d: any) => d.shopName).filter(Boolean)));
                return (
                  <div
                    key={t.id}
                    className={`p-4 border rounded-xl transition-all ${expired ? 'bg-gray-50 border-gray-200 opacity-75' : 'border-gray-200 hover:border-emerald-400 hover:shadow-sm bg-white'}`}
                  >
                    <div className="text-xs text-gray-400 font-mono">{t.taskNo}</div>
                    <div className="font-bold text-gray-800 mt-1 line-clamp-2">{t.title}</div>
                    {t.remark && (
                      <div className="text-xs text-gray-500 mt-1.5 line-clamp-2">{t.remark}</div>
                    )}
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
                    <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
                      <span>
                        {t.startTime || '-'} 至 {t.endTime || '-'}
                      </span>
                      {expired ? (
                        <span className="text-red-500">已截止</span>
                      ) : (
                        <span className="text-emerald-600">进行中</span>
                      )}
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <StatusBadge status={t.status} />
                      {!expired ? (
                        <button
                          onClick={() => navigate(`/public-feedback/form/${t.id}`)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 text-white text-xs rounded-lg hover:bg-emerald-600 transition-colors shadow-sm"
                        >
                          <CheckCircle size={14} /> 我要反馈
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">敬请期待</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 text-center text-xs text-gray-400">
          截止时间之后的任务将无法再提交反馈，已提交反馈也将不显示。
        </div>
      </div>
    </div>
  );
}

export default PublicEntryPage;
