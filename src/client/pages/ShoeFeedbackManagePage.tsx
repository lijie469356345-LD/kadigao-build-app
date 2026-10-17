import { useEffect, useState, useCallback } from 'react';
import { Search, RefreshCw, Download, Eye, CheckCircle2, Loader2, X, Plus, Trash2 } from 'lucide-react';
import { getShoeFeedbackList, getShoeFeedbackDetail, handleShoeFeedback, completeShoeFeedback, repushShoeFeedback } from '../../api/shoeFeedback';
import Layout from '../components/Layout';
import * as XLSX from 'xlsx';

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  evaluating: '评估中',
  submitted: '已提交',
  accepted: '已受理',
  completed: '已完成',
  voided: '已作废',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  evaluating: 'bg-yellow-100 text-yellow-700',
  submitted: 'bg-blue-100 text-blue-700',
  accepted: 'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
  voided: 'bg-gray-200 text-gray-500',
};

function ShoeFeedbackManagePage() {
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState('all');
  const [agreeFilter, setAgreeFilter] = useState('all');
  const [pushFilter, setPushFilter] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [remark, setRemark] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [ticketRows, setTicketRows] = useState<{ label: string; count: string }[]>([{ label: '第一次', count: '' }]);
  const [completeRemark, setCompleteRemark] = useState('');
  const [showRepushModal, setShowRepushModal] = useState(false);
  const [repushRows, setRepushRows] = useState<{ label: string; count: string }[]>([{ label: '第一次', count: '' }]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getShoeFeedbackList({
        status: statusFilter,
        agree: agreeFilter,
        pushed: pushFilter,
        keyword,
        page,
        pageSize,
      });
      setList(data.list || []);
      setTotal(data.total || 0);
    } catch (e: any) {
      console.error('加载列表失败:', e);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, agreeFilter, pushFilter, keyword, page, pageSize]);

  useEffect(() => { loadData(); }, [loadData]);

  const viewDetail = async (id: number) => {
    try {
      const data = await getShoeFeedbackDetail(id);
      setDetail(data);
      setRemark(data.handlerRemark || '');
      setShowDetail(true);
    } catch (e: any) {
      console.error('查看详情失败:', e);
    }
  };

  const doHandle = async (id: number) => {
    setActionLoading(id);
    try {
      await handleShoeFeedback(id, remark);
      setShowDetail(false);
      loadData();
    } catch (e: any) {
      alert('处理失败: ' + (e?.response?.data?.message || e?.message || ''));
    } finally {
      setActionLoading(null);
    }
  };

  const doComplete = async (id: number) => {
    // 先加载当前记录的详情，确保弹窗展示和提交的都是本单数据
    try {
      setActionLoading(id);
      const data = await getShoeFeedbackDetail(id);
      setDetail(data);
      setTicketRows([{ label: '第一次', count: '' }]);
      setCompleteRemark('');
      setShowCompleteModal(true);
    } catch (e: any) {
      alert('加载详情失败: ' + (e?.response?.data?.message || e?.message || ''));
    } finally {
      setActionLoading(null);
    }
  };

  const addTicketRow = () => {
    const next = ticketRows.length + 1;
    const labels = ['第一次', '第二次', '第三次', '第四次', '第五次', '第六次', '第七次', '第八次'];
    setTicketRows([...ticketRows, { label: labels[next - 1] || `第${next}次`, count: '' }]);
  };

  const removeTicketRow = (index: number) => {
    if (ticketRows.length > 1) {
      setTicketRows(ticketRows.filter((_, i) => i !== index));
    }
  };

  const updateTicketRow = (index: number, field: 'label' | 'count', value: string) => {
    setTicketRows(ticketRows.map((row, i) => i === index ? { ...row, [field]: value } : row));
  };

  const doRepush = async (id: number) => {
    setActionLoading(id);
    try {
      const data = await getShoeFeedbackDetail(id);
      setDetail(data);
      // 默认带出已完成时保存的补发明细，可修改
      let initRows: { label: string; count: string }[] = [{ label: '第一次', count: '' }];
      if (data.ticketDetails) {
        try {
          const td = typeof data.ticketDetails === 'string' ? JSON.parse(data.ticketDetails) : data.ticketDetails;
          if (Array.isArray(td) && td.length > 0) {
            initRows = td.map((t: any) => ({ label: String(t?.label ?? ''), count: String(t?.count ?? '') }));
          }
        } catch { /* 历史脏数据忽略解析错误 */ }
      }
      setRepushRows(initRows);
      setShowRepushModal(true);
    } catch (e: any) {
      alert('加载详情失败: ' + (e?.response?.data?.message || e?.message || ''));
    } finally {
      setActionLoading(null);
    }
  };

  const addRepushRow = () => {
    const next = repushRows.length + 1;
    const labels = ['第一次', '第二次', '第三次', '第四次', '第五次', '第六次', '第七次', '第八次'];
    setRepushRows([...repushRows, { label: labels[next - 1] || `第${next}次`, count: '' }]);
  };

  const removeRepushRow = (index: number) => {
    if (repushRows.length > 1) {
      setRepushRows(repushRows.filter((_, i) => i !== index));
    }
  };

  const updateRepushRow = (index: number, field: 'label' | 'count', value: string) => {
    setRepushRows(repushRows.map((row, i) => i === index ? { ...row, [field]: value } : row));
  };

  const doRepushSubmit = async (id: number) => {
    const validRows = repushRows.filter(r => r.count !== '' && r.count !== null && r.count !== undefined && !isNaN(parseInt(r.count)) && parseInt(r.count) > 0);
    if (validRows.length === 0) {
      alert('请至少填写一次补发张数');
      return;
    }
    const ticketDetails = validRows.map(r => ({ label: r.label, count: parseInt(r.count) }));
    setActionLoading(id);
    try {
      const data = await repushShoeFeedback(id, ticketDetails);
      alert(data.message || '推送已发送');
      setShowRepushModal(false);
      loadData();
    } catch (e: any) {
      alert('补发推送失败: ' + (e?.response?.data?.message || e?.message || ''));
    } finally {
      setActionLoading(null);
    }
  };

  const doCompleteSubmit = async (id: number) => {
    const validRows = ticketRows.filter(r => r.count !== '' && r.count !== null && r.count !== undefined && !isNaN(parseInt(r.count)) && parseInt(r.count) >= 0);
    if (validRows.length === 0) {
      alert('请至少填写一次补发张数');
      return;
    }
    const ticketDetails = validRows.map(r => ({ label: r.label, count: parseInt(r.count) }));
    setActionLoading(id);
    try {
      await completeShoeFeedback(id, completeRemark, ticketDetails);
      setShowCompleteModal(false);
      setShowDetail(false);
      loadData();
    } catch (e: any) {
      alert('完成失败: ' + (e?.response?.data?.message || e?.message || ''));
    } finally {
      setActionLoading(null);
    }
  };

  const handleExport = async () => {
    try {
      const { exportShoeFeedback } = await import('../../api/shoeFeedback');
      const data = await exportShoeFeedback({
        status: statusFilter,
        agree: agreeFilter,
        pushed: pushFilter,
        keyword,
      });
      if (data.rows && data.rows.length > 0) {
        const ws = XLSX.utils.json_to_sheet(data.rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '洗鞋反馈');
        XLSX.writeFile(wb, `洗鞋服务反馈_${new Date().toISOString().slice(0, 10)}.xlsx`);
      } else {
        alert('暂无数据可导出');
      }
    } catch (e: any) {
      alert('导出失败: ' + (e?.message || ''));
    }
  };

  return (
    <Layout title="洗鞋服务反馈管理" subtitle="查看用户反馈、处理与完成">
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="all">全部状态</option>
          <option value="submitted">已提交</option>
          <option value="accepted">已受理</option>
          <option value="completed">已完成</option>
          <option value="evaluating">评估中</option>
          <option value="pending">待处理</option>
          <option value="voided">已作废</option>
        </select>
        <select
          value={agreeFilter}
          onChange={(e) => { setAgreeFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="all">全部同意</option>
          <option value="agree">同意</option>
          <option value="disagree">不同意</option>
          <option value="unset">未决策</option>
        </select>
        <select
          value={pushFilter}
          onChange={(e) => { setPushFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="all">全部推送</option>
          <option value="pushed">已推送</option>
          <option value="unpushed">未推送</option>
        </select>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); loadData(); } }}
            placeholder="搜索编号/姓名/手机号"
            className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm w-56"
          />
        </div>
        <button
          onClick={() => { setPage(1); loadData(); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          查询
        </button>
        <button
          onClick={() => { setStatusFilter('all'); setAgreeFilter('all'); setPushFilter('all'); setKeyword(''); setPage(1); }}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
        >
          重置
        </button>
        <button
          onClick={handleExport}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 flex items-center gap-2"
        >
          <Download size={16} /> 导出
        </button>
        <button
          onClick={loadData}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center gap-2"
        >
          <RefreshCw size={16} /> 刷新
        </button>
      </div>

      {/* 表格 */}
      <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-gray-500">
              <th className="text-left px-3 py-3">反馈编号</th>
              <th className="text-left px-3 py-3">充值时间</th>
              <th className="text-left px-3 py-3">充值金额</th>
              <th className="text-center px-3 py-3">已用券数</th>
              <th className="text-center px-3 py-3">过期券数</th>
              <th className="text-center px-3 py-3">预估补发</th>
              <th className="text-center px-3 py-3">实际补发</th>
              <th className="text-center px-3 py-3">推送</th>
              <th className="text-left px-3 py-3">提交人</th>
              <th className="text-center px-3 py-3">同意</th>
              <th className="text-center px-3 py-3">状态</th>
              <th className="text-left px-3 py-3">创建时间</th>
              <th className="text-center px-3 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((item: any) => (
              <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-3 py-3 font-mono text-xs text-gray-700">{item.feedbackNo}</td>
                <td className="px-3 py-3 text-gray-600">{item.rechargeDate || '-'}</td>
                <td className="px-3 py-3 text-gray-600">{item.rechargeAmount ? `¥${item.rechargeAmount}` : '-'}</td>
                <td className="text-center px-3 py-3 text-gray-600">{item.usedTicketCount}</td>
                <td className="text-center px-3 py-3 text-gray-600">{item.expiredTicketCount || '-'}</td>
                <td className="text-center px-3 py-3 font-bold text-blue-600">{item.estimatedTickets || 0}</td>
                <td className="text-center px-3 py-3">
                  {item.ticketTotal != null && item.ticketTotal !== undefined ? (
                    <div>
                      <span className="font-bold text-green-600">{item.ticketTotal}张</span>
                      {item.ticketSummary && <div className="text-xs text-gray-400">{item.ticketSummary}</div>}
                    </div>
                  ) : (
                    <span className="text-gray-300">未填写</span>
                  )}
                </td>
                <td className="text-center px-3 py-3">
                  {item.pushed ? (
                    <div>
                      <span className="text-green-600">已推送</span>
                      {item.pushRecipients && <div className="text-xs text-gray-400">{item.pushRecipients}</div>}
                    </div>
                  ) : item.ticketTotal != null && item.ticketTotal !== undefined ? (
                    <span className="text-orange-500">未推送</span>
                  ) : (
                    <span className="text-gray-300">-</span>
                  )}
                </td>
                <td className="px-3 py-3 text-gray-600">
                  {item.submitterName || '-'}
                  {item.submitterPhone && <div className="text-xs text-gray-400">{item.submitterPhone}</div>}
                </td>
                <td className="text-center px-3 py-3">
                  {item.agreeStatus === 'agree' ? (
                    <span className="text-green-600">同意</span>
                  ) : item.agreeStatus === 'disagree' ? (
                    <span className="text-red-500">不同意</span>
                  ) : (
                    <span className="text-gray-300">-</span>
                  )}
                </td>
                <td className="text-center px-3 py-3">
                  <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${STATUS_COLORS[item.status] || ''}`}>
                    {STATUS_LABELS[item.status] || item.status}
                  </span>
                </td>
                <td className="px-3 py-3 text-gray-500 text-xs">
                  {item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : '-'}
                </td>
                <td className="text-center px-3 py-3">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => viewDetail(item.id)}
                      className="text-blue-600 hover:text-blue-700 p-1"
                      title="查看详情"
                    >
                      <Eye size={16} />
                    </button>
                    {item.status === 'submitted' && (
                      <button
                        onClick={() => doHandle(item.id)}
                        disabled={actionLoading === item.id}
                        className="text-orange-600 hover:text-orange-700 text-xs font-medium px-2 py-1 bg-orange-50 rounded"
                      >
                        {actionLoading === item.id ? '处理中...' : '处理'}
                      </button>
                    )}
                    {item.status === 'accepted' && (
                      <button
                        onClick={() => doComplete(item.id)}
                        disabled={actionLoading === item.id}
                        className="text-green-600 hover:text-green-700 text-xs font-medium px-2 py-1 bg-green-50 rounded"
                      >
                        {actionLoading === item.id ? '完成中...' : '完成'}
                      </button>
                    )}
                    {item.status === 'completed' && (
                      <button
                        onClick={() => doRepush(item.id)}
                        disabled={actionLoading === item.id}
                        className="text-blue-600 hover:text-blue-700 text-xs font-medium px-2 py-1 bg-blue-50 rounded"
                        title="对已完成单据再次推送补发通知（用于未推送或推送失败的单据）"
                      >
                        {actionLoading === item.id ? '推送中...' : '补发推送'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={12} className="text-center py-8 text-gray-400">暂无数据</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 合计条数 + 分页：条数筛选后始终显示（即使仅一页），分页按钮仅多页时显示 */}
      {total > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-gray-500">共 {total} 条</span>
          {total > pageSize && (
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-sm disabled:opacity-50"
              >
                上一页
              </button>
              <span className="px-3 py-1.5 text-sm text-gray-600">{page} / {Math.ceil(total / pageSize)}</span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page >= Math.ceil(total / pageSize)}
                className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-sm disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      )}

      {/* 详情弹窗 */}
      {showDetail && detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowDetail(false)}>
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="text-lg font-bold text-gray-800">反馈详情</h3>
              <button onClick={() => setShowDetail(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400">反馈编号</label>
                  <p className="text-sm font-mono text-gray-700">{detail.feedbackNo}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-400">状态</label>
                  <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${STATUS_COLORS[detail.status] || ''}`}>
                    {STATUS_LABELS[detail.status] || detail.status}
                  </span>
                </div>
                <div>
                  <label className="text-xs text-gray-400">充值时间</label>
                  <p className="text-sm text-gray-700">{detail.rechargeDate || '-'}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-400">充值金额</label>
                  <p className="text-sm text-gray-700">{detail.rechargeAmount ? `¥${detail.rechargeAmount}` : '-'}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-400">已用券数</label>
                  <p className="text-sm text-gray-700">{detail.usedTicketCount} 张</p>
                </div>
                <div>
                  <label className="text-xs text-gray-400">过期券数</label>
                  <p className="text-sm text-gray-700">{detail.expiredTicketCount || '-'}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-400">预估补发</label>
                  <p className="text-sm font-bold text-blue-600">{detail.estimatedTickets || 0} 张</p>
                </div>
                <div>
                  <label className="text-xs text-gray-400">提交人</label>
                  <p className="text-sm text-gray-700">{detail.submitterName || '-'}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-400">联系电话</label>
                  <p className="text-sm text-gray-700">{detail.submitterPhone || '-'}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-400">同意情况</label>
                  <p className="text-sm text-gray-700">
                    {detail.agreeStatus === 'agree' ? '同意' : detail.agreeStatus === 'disagree' ? '不同意' : '-'}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-gray-400">创建时间</label>
                  <p className="text-sm text-gray-700">{detail.createdAt ? new Date(detail.createdAt).toLocaleString('zh-CN') : '-'}</p>
                </div>
              </div>

              {detail.disagreeDesc && (
                <div>
                  <label className="text-xs text-gray-400">不同意见描述</label>
                  <p className="text-sm text-gray-700 mt-1 p-3 bg-gray-50 rounded-lg">{detail.disagreeDesc}</p>
                </div>
              )}

              {detail.paymentProofPath && (
                <div>
                  <label className="text-xs text-gray-400">付款记录</label>
                  <div className="mt-1">
                    <img
                      src={detail.paymentProofPath}
                      alt="付款记录"
                      className="max-h-48 rounded-lg border border-gray-200 cursor-pointer hover:opacity-80 transition"
                      onClick={() => setPreviewImage(detail.paymentProofPath)}
                    />
                    <p className="text-xs text-gray-400 mt-1">点击图片可放大查看</p>
                  </div>
                </div>
              )}

              {detail.handlerName && (
                <div className="border-t pt-3">
                  <label className="text-xs text-gray-400">处理人 / 时间</label>
                  <p className="text-sm text-gray-700">{detail.handlerName} {detail.handledAt ? new Date(detail.handledAt).toLocaleString('zh-CN') : ''}</p>
                </div>
              )}

              {/* 处理备注 */}
              {(detail.status === 'submitted' || detail.status === 'accepted') && (
                <div>
                  <label className="text-xs text-gray-400">处理备注</label>
                  <textarea
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                    rows={3}
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
                    placeholder="填写处理备注（可选）"
                  />
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex gap-3 pt-2">
                {detail.status === 'submitted' && (
                  <button
                    onClick={() => doHandle(detail.id)}
                    disabled={actionLoading === detail.id}
                    className="flex-1 py-2.5 bg-orange-600 text-white rounded-lg font-medium text-sm disabled:bg-gray-300 flex items-center justify-center gap-2"
                  >
                    {actionLoading === detail.id ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    标记为已受理
                  </button>
                )}
                {detail.status === 'accepted' && (
                  <button
                    onClick={() => doComplete(detail.id)}
                    disabled={actionLoading === detail.id}
                    className="flex-1 py-2.5 bg-green-600 text-white rounded-lg font-medium text-sm disabled:bg-gray-300 flex items-center justify-center gap-2"
                  >
                    {actionLoading === detail.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 size={16} />}
                    标记为已完成
                  </button>
                )}
                <button
                  onClick={() => setShowDetail(false)}
                  className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium text-sm"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 补发张数弹窗 */}
      {showCompleteModal && detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-800">补发洗鞋券</h3>
              <button
                onClick={() => setShowCompleteModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mb-4 p-3 bg-blue-50 rounded-lg">
              <p className="text-sm text-gray-700">
                <span className="text-gray-400">会员：</span>{detail.submitterName || '-'}
              </p>
              <p className="text-sm text-gray-700 mt-1">
                <span className="text-gray-400">手机号：</span>{detail.submitterPhone || '-'}
              </p>
              <p className="text-sm text-gray-700 mt-1">
                <span className="text-gray-400">预估补发：</span>{detail.estimatedTickets ?? 0} 张
              </p>
            </div>

            {/* 动态张数输入行 */}
            <label className="text-xs text-gray-400 mb-2 block">补发明细（可添加多次）</label>
            <div className="space-y-2 mb-3">
              {ticketRows.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={row.label}
                    onChange={(e) => updateTicketRow(index, 'label', e.target.value)}
                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm text-center"
                    placeholder="标签"
                  />
                  <input
                    type="number"
                    value={row.count}
                    onChange={(e) => updateTicketRow(index, 'count', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="补发张数"
                    min="0"
                  />
                  <span className="text-sm text-gray-400">张</span>
                  {ticketRows.length > 1 && (
                    <button
                      onClick={() => removeTicketRow(index)}
                      className="p-2 text-red-400 hover:text-red-600"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={addTicketRow}
              className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 flex items-center justify-center gap-1 mb-4"
            >
              <Plus size={16} /> 添加一次补发
            </button>

            {/* 备注 */}
            <div className="mb-4">
              <label className="text-xs text-gray-400 mb-1 block">处理备注（可选）</label>
              <textarea
                value={completeRemark}
                onChange={(e) => setCompleteRemark(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
                placeholder="填写处理备注"
              />
            </div>

            {/* 提交按钮 */}
            <div className="flex gap-3">
              <button
                onClick={() => doCompleteSubmit(detail.id)}
                disabled={actionLoading === detail.id}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-lg font-medium text-sm disabled:bg-gray-300 flex items-center justify-center gap-2"
              >
                {actionLoading === detail.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 size={16} />}
                确认完成并推送
              </button>
              <button
                onClick={() => setShowCompleteModal(false)}
                className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium text-sm"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 补发推送弹窗（推送时可修改补发张数） */}
      {showRepushModal && detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[75] p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-800">补发推送</h3>
              <button
                onClick={() => setShowRepushModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mb-4 p-3 bg-blue-50 rounded-lg">
              <p className="text-sm text-gray-700">
                <span className="text-gray-400">会员：</span>{detail.submitterName || '-'}
              </p>
              <p className="text-sm text-gray-700 mt-1">
                <span className="text-gray-400">手机号：</span>{detail.submitterPhone || '-'}
              </p>
              <p className="text-sm text-gray-700 mt-1">
                <span className="text-gray-400">预估补发：</span>{detail.estimatedTickets ?? 0} 张
              </p>
              <p className="text-xs text-gray-400 mt-2">推送将按下方填写的补发张数发送，可修改后重新推送</p>
            </div>

            <label className="text-xs text-gray-400 mb-2 block">补发明细（可添加多次）</label>
            <div className="space-y-2 mb-3">
              {repushRows.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={row.label}
                    onChange={(e) => updateRepushRow(index, 'label', e.target.value)}
                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm text-center"
                    placeholder="标签"
                  />
                  <input
                    type="number"
                    value={row.count}
                    onChange={(e) => updateRepushRow(index, 'count', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="补发张数"
                    min="0"
                  />
                  <span className="text-sm text-gray-400">张</span>
                  {repushRows.length > 1 && (
                    <button
                      onClick={() => removeRepushRow(index)}
                      className="p-2 text-red-400 hover:text-red-600"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={addRepushRow}
              className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 flex items-center justify-center gap-1 mb-4"
            >
              <Plus size={16} /> 添加一次补发
            </button>

            <div className="flex gap-3">
              <button
                onClick={() => doRepushSubmit(detail.id)}
                disabled={actionLoading === detail.id}
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm disabled:bg-gray-300 flex items-center justify-center gap-2"
              >
                {actionLoading === detail.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 size={16} />}
                确认补发推送
              </button>
              <button
                onClick={() => setShowRepushModal(false)}
                className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium text-sm"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 图片放大预览 */}
      {previewImage && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4"
          onClick={() => setPreviewImage(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white p-2"
            onClick={(e) => { e.stopPropagation(); setPreviewImage(null); }}
          >
            <X size={28} />
          </button>
          <img
            src={previewImage}
            alt="付款记录放大"
            className="max-w-[95vw] max-h-[95vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </Layout>
  );
}

export default ShoeFeedbackManagePage;
