import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../store/authStore';
import { reimbursementApi } from '../../api/reimbursement';
import Layout from '../components/Layout';
import PaymentDialog from '../components/PaymentDialog';
import {
  Plus, Send, CheckCircle2, XCircle, Clock, Wallet,
  ArrowLeft, Search, FileText, AlertCircle, Banknote,
  Eye, Workflow, User, Users, Briefcase
} from 'lucide-react';

const EXPENSE_TYPES = ['差旅费', '业务招待', '办公费', '交通费', '培训费', '其他'];

const APPROVAL_STATUS_MAP: Record<string, { label: string; color: string; icon: any }> = {
  pending: { label: '待审批', color: 'text-amber-600 bg-amber-50', icon: Clock },
  approved: { label: '已批准', color: 'text-green-600 bg-green-50', icon: CheckCircle2 },
  rejected: { label: '已驳回', color: 'text-red-600 bg-red-50', icon: XCircle },
};

interface AdvanceRecord {
  id: number;
  employeeId: string;
  employeeName: string;
  advanceNo: string;
  advanceAmount: number;
  deductedAmount: number;
  balance: number;
  advanceDate: string;
  remark: string;
  expenseType: string;
  applyReason: string;
  approvalStatus: string;
  status: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectReason?: string;
  createdAt: string;
}

function ExpenseApplicationPage() {
  const { user } = useAuthStore();
  const [view, setView] = useState<'list' | 'form' | 'detail'>('list');
  const [list, setList] = useState<AdvanceRecord[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchKey, setSearchKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 审批任务
  const [detail, setDetail] = useState<AdvanceRecord | null>(null);
  const [approvalTasks, setApprovalTasks] = useState<any[]>([]);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);

  // 出纳付款弹窗
  const [payDialog, setPayDialog] = useState<any>(null);

  // 表单数据
  const [formData, setFormData] = useState({
    expenseType: '差旅费',
    advanceAmount: '',
    advanceDate: new Date().toISOString().slice(0, 10),
    applyReason: '',
    remark: '',
  });

  const isAdmin = user?.isAdmin === '是';

  // 检查当前用户是否有审批权限（支持 person/position/group/org/orgLevel 类型）
  const checkCanApprove = (task: any): boolean => {
    if (!task || task.status !== 'pending') return false;
    const approvers: any[] = task.approvers || [];
    // 用户全部组织归属（旧 token 无 orgIds 时回退单个 orgId）
    const myOrgs: number[] = (user?.orgIds && user?.orgIds.length ? user?.orgIds : (user?.orgId ? [user?.orgId] : []));
    const myRoles: string[] = user?.roleCodes || [];
    for (const a of approvers) {
      if (a.approverType === 'person' && a.approverCode === user?.userCode) return true;
      if (a.approverType === 'group' && a.approverCode === user?.groupName) return true;
      // 指定组织+角色：用户拥有该角色即候选按钮（服务端仍按申请人/审批人组织线严格校验）
      if (a.approverType === 'org' && a.roleCode && myRoles.includes(a.roleCode)) return true;
      // 按组织层：目标组织为任务创建时固化的申请人组织链第 N 层，审批人需是该组织成员且拥有对应角色
      if (a.approverType === 'orgLevel' && a.roleCode && a.orgId && myOrgs.includes(Number(a.orgId)) && myRoles.includes(a.roleCode)) return true;
    }
    return false;
  };

  // 查看详情 + 加载审批进度
  const handleView = (r: AdvanceRecord) => {
    setDetail(r);
    setView('detail');
    setRejectReason('');
    setShowRejectBox(false);
    reimbursementApi.approvalTaskBySource('advance', r.id).then((tasks: any) => {
      if (!tasks.error && !tasks.message) setApprovalTasks(tasks);
      else setApprovalTasks([]);
    });
  };

  // 审批通过
  const handleApproveTask = async (taskId: number) => {
    await reimbursementApi.approvalTaskApprove(taskId, {
      approvedBy: user?.userName || user?.userCode || '',
      userCode: user?.userCode || '',
      groupName: user?.groupName || '',
    });
    setShowRejectBox(false);
    setRejectReason('');
    if (detail) {
      reimbursementApi.approvalTaskBySource('advance', detail.id).then((tasks: any) => {
        if (!tasks.error && !tasks.message) setApprovalTasks(tasks);
      });
      loadData();
    }
  };

  // 审批驳回
  const handleRejectTask = async (taskId: number) => {
    if (!rejectReason.trim()) { showMessage('error', '请填写驳回原因'); return; }
    await reimbursementApi.approvalTaskReject(taskId, {
      approvedBy: user?.userName || user?.userCode || '',
      userCode: user?.userCode || '',
      groupName: user?.groupName || '',
      rejectReason,
    });
    setShowRejectBox(false);
    setRejectReason('');
    if (detail) {
      reimbursementApi.approvalTaskBySource('advance', detail.id).then((tasks: any) => {
        if (!tasks.error && !tasks.message) setApprovalTasks(tasks);
      });
      loadData();
    }
  };

  const loadData = useCallback(async () => {
    const data = await reimbursementApi.advances(undefined, filterStatus !== 'all' ? filterStatus : undefined);
    if (!data.error && !data.message) setList(data);
  }, [filterStatus]);

  useEffect(() => {
    if (view === 'list') loadData();
  }, [view, loadData]);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleNew = () => {
    setFormData({
      expenseType: '差旅费',
      advanceAmount: '',
      advanceDate: new Date().toISOString().slice(0, 10),
      applyReason: '',
      remark: '',
    });
    setView('form');
  };

  const handleSubmit = async () => {
    if (!formData.advanceAmount || Number(formData.advanceAmount) <= 0) {
      showMessage('error', '请填写有效的预支金额');
      return;
    }
    if (!formData.applyReason.trim()) {
      showMessage('error', '请填写申请事由');
      return;
    }
    setSubmitting(true);
    try {
      const res = await reimbursementApi.createAdvance({
        employeeId: user?.userCode || '',
        employeeName: user?.userName || user?.userCode || '',
        advanceAmount: Number(formData.advanceAmount),
        advanceDate: formData.advanceDate,
        expenseType: formData.expenseType,
        applyReason: formData.applyReason,
        remark: formData.remark,
      });
      if (res.id) {
        showMessage('success', `借款申请提交成功，单号：${res.advanceNo}`);
        setView('list');
        loadData();
      } else {
        showMessage('error', res.message || '提交失败');
      }
    } catch {
      showMessage('error', '网络错误，提交失败');
    }
    setSubmitting(false);
  };

  // 汇总统计
  const stats = {
    total: list.length,
    pending: list.filter(r => r.approvalStatus === 'pending').length,
    approved: list.filter(r => r.approvalStatus === 'approved').length,
    totalAmount: list.filter(r => r.approvalStatus === 'approved').reduce((s, r) => s + Number(r.advanceAmount || 0), 0),
    remaining: list.filter(r => r.approvalStatus === 'approved' && r.status === 'active').reduce((s, r) => s + Number(r.balance || 0), 0),
  };

  const filteredList = list.filter(r => {
    if (searchKey) {
      const k = searchKey.toLowerCase();
      return r.employeeName?.toLowerCase().includes(k) || r.advanceNo?.toLowerCase().includes(k) || r.applyReason?.toLowerCase().includes(k);
    }
    return true;
  });

  return (
    <Layout title="借款申请" subtitle="借款申请与审批管理">
      <div className="p-4 md:p-6">
        {message && (
          <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            <span>{message.text}</span>
          </div>
        )}

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-xs text-gray-500">申请总数</div>
            <div className="text-2xl font-bold text-gray-800 mt-1">{stats.total}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-xs text-gray-500">待审批</div>
            <div className="text-2xl font-bold text-amber-600 mt-1">{stats.pending}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-xs text-gray-500">已批准</div>
            <div className="text-2xl font-bold text-green-600 mt-1">{stats.approved}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-xs text-gray-500">批准总额</div>
            <div className="text-2xl font-bold text-blue-600 mt-1">{stats.totalAmount.toFixed(2)}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-xs text-gray-500">可用余额</div>
            <div className="text-2xl font-bold text-lime-600 mt-1">{stats.remaining.toFixed(2)}</div>
          </div>
        </div>

        {view === 'list' && (
          <>
            {/* 工具栏 */}
            <div className="bg-white rounded-lg shadow p-4 mb-4">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleNew}
                  className="flex items-center gap-2 px-4 py-2 bg-lime-600 text-white rounded-lg hover:bg-lime-700 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>新建借款申请</span>
                </button>

                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                  {['all', 'pending', 'approved', 'rejected'].map(s => (
                    <button
                      key={s}
                      onClick={() => setFilterStatus(s)}
                      className={`px-3 py-1.5 rounded-md text-sm transition-colors ${filterStatus === s ? 'bg-white text-lime-600 font-medium shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      {s === 'all' ? '全部' : APPROVAL_STATUS_MAP[s]?.label || s}
                    </button>
                  ))}
                </div>

                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="搜索申请人/单号/事由"
                    value={searchKey}
                    onChange={e => setSearchKey(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-lime-500"
                  />
                </div>
              </div>
            </div>

            {/* 申请列表 */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-4 py-3 text-left">单号</th>
                      <th className="px-4 py-3 text-left">申请人</th>
                      <th className="px-4 py-3 text-left">费用类型</th>
                      <th className="px-4 py-3 text-right">预支金额</th>
                      <th className="px-4 py-3 text-right">已抵扣</th>
                      <th className="px-4 py-3 text-right">余额</th>
                      <th className="px-4 py-3 text-left">申请日期</th>
                      <th className="px-4 py-3 text-left">审批状态</th>
                      <th className="px-4 py-3 text-left">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredList.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                          <FileText className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                          暂无借款申请记录
                        </td>
                      </tr>
                    ) : filteredList.map(r => {
                      const st = APPROVAL_STATUS_MAP[r.approvalStatus] || APPROVAL_STATUS_MAP.pending;
                      return (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono text-xs text-gray-600">{r.advanceNo || '-'}</td>
                          <td className="px-4 py-3">{r.employeeName}</td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">{r.expenseType || '其他'}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-medium">{Number(r.advanceAmount || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-right text-gray-500">{Number(r.deductedAmount || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-right font-medium text-lime-600">{Number(r.balance || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-gray-600">{r.advanceDate ? r.advanceDate.slice(0, 10) : '-'}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${st.color}`}>
                              <st.icon className="w-3 h-3" />
                              {st.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              <button onClick={() => handleView(r)} className="text-gray-400 hover:text-blue-600" title="查看"><Eye className="w-4 h-4" /></button>
                              {r.approvalStatus === 'approved' && r.status !== 'paid' && isAdmin && (
                                <button
                                  onClick={() => setPayDialog({
                                    sourceType: 'advance',
                                    sourceId: r.id,
                                    sourceNo: r.advanceNo,
                                    payee: r.employeeName,
                                    amount: r.advanceAmount,
                                  })}
                                  className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                                >
                                  <Banknote className="w-3 h-3" />出纳付款
                                </button>
                              )}
                              {r.approvalStatus === 'approved' && r.status === 'paid' && (
                                <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                                  <CheckCircle2 className="w-3 h-3" />已付款
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {view === 'form' && (
          <div className="bg-white rounded-lg shadow p-6 max-w-2xl mx-auto">
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={() => setView('list')}
                className="flex items-center gap-1 text-gray-500 hover:text-gray-700"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>返回</span>
              </button>
              <h2 className="text-lg font-bold text-gray-800">新建借款申请</h2>
            </div>

            <div className="space-y-4">
              {/* 申请人（自动填入，只读） */}
              <div>
                <label className="block text-sm text-gray-600 mb-1">申请人 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={user?.userName || user?.userCode || ''}
                  readOnly
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">费用类型 <span className="text-red-500">*</span></label>
                  <select
                    value={formData.expenseType}
                    onChange={e => setFormData({ ...formData, expenseType: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-lime-500"
                  >
                    {EXPENSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">预支金额 (元) <span className="text-red-500">*</span></label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.advanceAmount}
                    onChange={e => setFormData({ ...formData, advanceAmount: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-lime-500"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">申请日期 <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  value={formData.advanceDate}
                  onChange={e => setFormData({ ...formData, advanceDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-lime-500"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">申请事由 <span className="text-red-500">*</span></label>
                <textarea
                  value={formData.applyReason}
                  onChange={e => setFormData({ ...formData, applyReason: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-lime-500"
                  placeholder="请详细说明预支款项的用途和原因"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">备注</label>
                <textarea
                  value={formData.remark}
                  onChange={e => setFormData({ ...formData, remark: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-lime-500"
                  placeholder="其他需要说明的事项（选填）"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t">
                <button
                  onClick={() => setView('list')}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex items-center gap-2 px-6 py-2 bg-lime-600 text-white rounded-lg hover:bg-lime-700 disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  <span>{submitting ? '提交中...' : '提交申请'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {view === 'detail' && detail && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button onClick={() => setView('list')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
                  <ArrowLeft className="w-4 h-4" />返回列表
                </button>
                <span className="font-mono text-sm text-gray-600">{detail.advanceNo}</span>
                {(() => {
                  const st = APPROVAL_STATUS_MAP[detail.approvalStatus] || APPROVAL_STATUS_MAP.pending;
                  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${st.color}`}><st.icon className="w-3 h-3" />{st.label}</span>;
                })()}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">借款信息</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><span className="text-gray-500">申请人：</span><span className="font-medium">{detail.employeeName}</span></div>
                <div><span className="text-gray-500">费用类型：</span><span className="font-medium">{detail.expenseType || '其他'}</span></div>
                <div><span className="text-gray-500">申请日期：</span><span className="font-medium">{detail.advanceDate?.slice(0, 10)}</span></div>
                <div><span className="text-gray-500">预支金额：</span><span className="font-bold text-lime-600">¥{Number(detail.advanceAmount).toFixed(2)}</span></div>
                <div className="md:col-span-4"><span className="text-gray-500">申请事由：</span><span className="font-medium">{detail.applyReason || '-'}</span></div>
                {detail.remark && <div className="md:col-span-4"><span className="text-gray-500">备注：</span><span className="font-medium">{detail.remark}</span></div>}
              </div>
            </div>

            {approvalTasks.length > 0 && (
              <ApprovalProgress
                tasks={approvalTasks}
                canApproveTask={checkCanApprove}
                onApprove={handleApproveTask}
                onReject={handleRejectTask}
                rejectReason={rejectReason}
                setRejectReason={setRejectReason}
                showRejectBox={showRejectBox}
                setShowRejectBox={setShowRejectBox}
              />
            )}

            {detail.approvalStatus === 'approved' && detail.status !== 'paid' && isAdmin && (
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Banknote className="w-5 h-5 text-blue-600" />出纳付款</h3>
                    <p className="text-sm text-gray-500 mt-1">应付金额：<span className="font-bold text-blue-600">¥{Number(detail.advanceAmount).toFixed(2)}</span></p>
                  </div>
                  <button onClick={() => setPayDialog({ sourceType: 'advance', sourceId: detail.id, sourceNo: detail.advanceNo, payee: detail.employeeName, amount: detail.advanceAmount })} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                    <Banknote className="w-4 h-4" />出纳付款
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 出纳付款弹窗 */}
      {payDialog && (
        <PaymentDialog
          sourceType={payDialog.sourceType}
          sourceId={payDialog.sourceId}
          sourceNo={payDialog.sourceNo}
          payee={payDialog.payee}
          amount={payDialog.amount}
          onClose={() => setPayDialog(null)}
          onSuccess={() => { setPayDialog(null); loadData(); }}
        />
      )}
    </Layout>
  );
}

// ============================================================
// 子组件：审批进度展示
// ============================================================
const APPROVER_ICONS: Record<string, any> = { person: User, group: Users };
const APPROVER_COLORS: Record<string, string> = { person: 'text-blue-500', group: 'text-purple-500' };
const LEVEL_LABELS = ['一级', '二级', '三级', '四级', '五级', '六级', '七级', '八级', '九级', '十级'];

function ApprovalProgress({ tasks, canApproveTask, onApprove, onReject, rejectReason, setRejectReason, showRejectBox, setShowRejectBox }: {
  tasks: any[];
  canApproveTask: (task: any) => boolean;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  rejectReason: string;
  setRejectReason: (v: string) => void;
  showRejectBox: boolean;
  setShowRejectBox: (v: boolean) => void;
}) {
  const currentPending = tasks.find(t => t.status === 'pending');
  const ccUsers: any[] = (tasks[0] && tasks[0].ccUsers) || [];
  const ccOrgs: any[] = (tasks[0] && tasks[0].ccOrgs) || [];
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
        <Workflow className="w-5 h-5 text-lime-600" />审批进度
      </h3>
      {(ccUsers.length > 0 || ccOrgs.length > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1"><Send className="w-3 h-3 text-teal-500" />抄送：</span>
          {ccUsers.map((u: any, ui: number) => (
            <span key={`ccu${ui}`} className="inline-flex items-center gap-1 bg-teal-50 border border-teal-200 text-teal-700 rounded px-2 py-0.5">
              <User className="w-3 h-3" />{u.userName || u.userCode}
            </span>
          ))}
          {ccOrgs.map((o: any, oi: number) => (
            <span key={`cco${oi}`} className="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded px-2 py-0.5">
              <Briefcase className="w-3 h-3" />{o.org_name || o.org_id}
            </span>
          ))}
        </div>
      )}
      <div className="space-y-3">
        {tasks.map((task, idx) => {
          const Icon = task.status === 'approved' ? CheckCircle2 : task.status === 'rejected' ? XCircle : Clock;
          const iconColor = task.status === 'approved' ? 'text-green-500' : task.status === 'rejected' ? 'text-red-500' : 'text-amber-500';
          const statusLabel = task.status === 'approved' ? '已通过' : task.status === 'rejected' ? '已驳回' : task.status === 'waiting' ? '待前级审批' : '待审批';
          const statusBg = task.status === 'approved' ? 'bg-green-50 border-green-200' : task.status === 'rejected' ? 'bg-red-50 border-red-200' : task.status === 'waiting' ? 'bg-gray-50 border-gray-200' : 'bg-amber-50 border-amber-200';
          const approvers: any[] = task.approvers || [];
          const canApprove = canApproveTask(task);
          return (
            <div key={idx} className={`border rounded-lg p-4 ${statusBg}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className={`w-5 h-5 ${iconColor}`} />
                  <span className="font-medium text-gray-800">{LEVEL_LABELS[task.level - 1] || `第${task.level}级`}</span>
                  <span className="text-xs text-gray-500">({task.level}/{task.totalLevels})</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${task.status === 'approved' ? 'bg-green-100 text-green-700' : task.status === 'rejected' ? 'bg-red-100 text-red-700' : task.status === 'waiting' ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-700'}`}>{statusLabel}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-xs text-gray-500">审批人：</span>
                {approvers.map((a: any, ai: number) => {
                  const AIcon = APPROVER_ICONS[a.approverType] || User;
                  return (
                    <span key={ai} className="inline-flex items-center gap-1 text-xs bg-white border border-gray-200 rounded px-2 py-0.5">
                      <AIcon className={`w-3 h-3 ${APPROVER_COLORS[a.approverType] || 'text-gray-400'}`} />
                      {a.approverName}
                    </span>
                  );
                })}
              </div>
              {task.status === 'approved' && task.approvedBy && (
                <div className="text-xs text-gray-500">审批人：{task.approvedBy} | 时间：{task.approvedAt?.slice(0, 16).replace('T', ' ')}</div>
              )}
              {task.status === 'rejected' && (
                <div className="text-xs text-red-600">驳回原因：{task.rejectReason || '无'}</div>
              )}
              {canApprove && showRejectBox && (
                <div className="mt-2">
                  <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} className="w-full border border-red-300 rounded px-2 py-1.5 text-sm" placeholder="请输入驳回原因" />
                </div>
              )}
              {canApprove && (
                <div className="mt-2 flex gap-2">
                  <button onClick={() => onApprove(task.id)} className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
                    <CheckCircle2 className="w-4 h-4" />审批通过
                  </button>
                  {!showRejectBox ? (
                    <button onClick={() => setShowRejectBox(true)} className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 text-sm">
                      <XCircle className="w-4 h-4" />驳回
                    </button>
                  ) : (
                    <>
                      <button onClick={() => onReject(task.id)} className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm">
                        <XCircle className="w-4 h-4" />确认驳回
                      </button>
                      <button onClick={() => { setShowRejectBox(false); setRejectReason(''); }} className="px-3 py-1.5 text-gray-500 text-sm">取消</button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {currentPending && (
        <div className="mt-3 text-xs text-gray-400 flex items-center gap-1">
          <Workflow className="w-3 h-3" />
          当前等待「{LEVEL_LABELS[currentPending.level - 1] || `第${currentPending.level}级`}」审批通过后自动进入下一级
        </div>
      )}
    </div>
  );
}

export default ExpenseApplicationPage;
