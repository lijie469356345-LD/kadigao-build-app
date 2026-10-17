import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../store/authStore';
import { reimbursementApi } from '../../api/reimbursement';
import Layout from '../components/Layout';
import PaymentDialog from '../components/PaymentDialog';
import {
  Plus, Trash2, Banknote, CheckCircle2, X, Wallet, Edit2,
  ArrowLeft, Eye, Workflow, User, Users, Briefcase, Clock, XCircle, Send
} from 'lucide-react';

const EXPENSE_TYPES = ['差旅费', '业务招待', '办公费', '交通费', '培训费', '其他'];
const PAYMENT_TYPES = ['银行转账', '现金', '支票', '电子支付'];
const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: '待审批', color: 'text-amber-600 bg-amber-50' },
  approved: { label: '已审批', color: 'text-green-600 bg-green-50' },
  rejected: { label: '已驳回', color: 'text-red-600 bg-red-50' },
};
const PAY_STATUS_MAP: Record<string, { label: string; color: string }> = {
  unpaid: { label: '未付款', color: 'text-gray-500 bg-gray-100' },
  paid: { label: '已付款', color: 'text-emerald-600 bg-emerald-50' },
};

function AdvancePaymentPage() {
  const { user } = useAuthStore();
  const [list, setList] = useState<any[]>([]);
  const [view, setView] = useState<'list' | 'form' | 'detail'>('list');
  const [editing, setEditing] = useState<any>(null);
  const [payDialog, setPayDialog] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [approvalTasks, setApprovalTasks] = useState<any[]>([]);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);

  const loadData = useCallback(async () => {
    const data = await reimbursementApi.advancePaymentList();
    if (!data.error && !data.message) setList(data);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

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
  const handleView = (item: any) => {
    setDetail(item);
    setView('detail');
    setRejectReason('');
    setShowRejectBox(false);
    reimbursementApi.approvalTaskBySource('advance_payment', item.id).then((tasks: any) => {
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
      reimbursementApi.approvalTaskBySource('advance_payment', detail.id).then((tasks: any) => {
        if (!tasks.error && !tasks.message) setApprovalTasks(tasks);
      });
      loadData();
    }
  };

  // 审批驳回
  const handleRejectTask = async (taskId: number) => {
    if (!rejectReason.trim()) { alert('请填写驳回原因'); return; }
    await reimbursementApi.approvalTaskReject(taskId, {
      approvedBy: user?.userName || user?.userCode || '',
      userCode: user?.userCode || '',
      groupName: user?.groupName || '',
      rejectReason,
    });
    setShowRejectBox(false);
    setRejectReason('');
    if (detail) {
      reimbursementApi.approvalTaskBySource('advance_payment', detail.id).then((tasks: any) => {
        if (!tasks.error && !tasks.message) setApprovalTasks(tasks);
      });
      loadData();
    }
  };

  const handleNew = () => {
    setEditing({
      applyNo: `AP${Date.now()}`,
      applicantId: user?.userCode || '',
      applicantName: user?.userName || '',
      department: user?.orgName || '',
      expenseType: '差旅费',
      paymentType: '银行转账',
      applyAmount: 0,
      applyDate: new Date().toISOString().slice(0, 10),
      reason: '',
    });
    setView('form');
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.applicantName.trim()) { alert('请填写申请人'); return; }
    if (!editing.applyAmount || editing.applyAmount <= 0) { alert('请填写申请金额'); return; }
    await reimbursementApi.advancePaymentCreate({ ...editing, createdBy: user?.userCode });
    setView('list');
    setEditing(null);
    loadData();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除此预付款申请？')) return;
    await reimbursementApi.advancePaymentDelete(id);
    loadData();
  };

  const handlePaySuccess = () => {
    setPayDialog(null);
    loadData();
  };

  const isAdmin = user?.isAdmin === '是';

  // 统计
  const totalPending = list.filter(r => r.approvalStatus === 'pending').length;
  const totalApproved = list.filter(r => r.approvalStatus === 'approved').length;
  const totalUnpaid = list.filter(r => r.approvalStatus === 'approved' && r.payStatus === 'unpaid').length;

  return (
    <Layout title="预付款申请" subtitle="预付款申请与审批管理">
      <div className="p-4 max-w-7xl mx-auto space-y-6">
        {/* 统计卡片 */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
            <div className="p-3 rounded-full bg-amber-50"><Wallet className="w-5 h-5 text-amber-600" /></div>
            <div><div className="text-2xl font-bold text-gray-800">{totalPending}</div><div className="text-xs text-gray-500">待审批</div></div>
          </div>
          <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
            <div className="p-3 rounded-full bg-green-50"><CheckCircle2 className="w-5 h-5 text-green-600" /></div>
            <div><div className="text-2xl font-bold text-gray-800">{totalApproved}</div><div className="text-xs text-gray-500">已审批</div></div>
          </div>
          <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
            <div className="p-3 rounded-full bg-blue-50"><Banknote className="w-5 h-5 text-blue-600" /></div>
            <div><div className="text-2xl font-bold text-gray-800">{totalUnpaid}</div><div className="text-xs text-gray-500">待付款</div></div>
          </div>
        </div>

        {/* 操作栏 */}
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Wallet className="w-5 h-5 text-lime-600" />预付款申请列表</h3>
          <button onClick={handleNew} className="flex items-center gap-2 px-4 py-2 bg-lime-600 text-white rounded-lg hover:bg-lime-700 transition">
            <Plus className="w-4 h-4" />新建预付款申请
          </button>
        </div>

        {/* 新建表单 */}
        {view === 'form' && editing && (
          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">申请单号</label>
                <input value={editing.applyNo} onChange={e => setEditing({ ...editing, applyNo: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">申请人</label>
                <input value={editing.applicantName} onChange={e => setEditing({ ...editing, applicantName: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">组织</label>
                <input value={editing.department} readOnly title="自动获取当前用户所属组织" className="w-full border border-gray-200 bg-gray-100 rounded-lg px-3 py-2 text-sm text-gray-600" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">申请日期</label>
                <input type="date" value={editing.applyDate} onChange={e => setEditing({ ...editing, applyDate: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">费用类型</label>
                <select value={editing.expenseType} onChange={e => setEditing({ ...editing, expenseType: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {EXPENSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">付款类型</label>
                <select value={editing.paymentType} onChange={e => setEditing({ ...editing, paymentType: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {PAYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">申请金额</label>
                <input type="number" value={editing.applyAmount} onChange={e => setEditing({ ...editing, applyAmount: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">申请事由</label>
              <textarea value={editing.reason} onChange={e => setEditing({ ...editing, reason: e.target.value })} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="请输入预付款申请事由" />
            </div>
            <div className="flex gap-3">
              <button onClick={handleSave} className="flex items-center gap-1 px-4 py-2 bg-lime-600 text-white rounded-lg hover:bg-lime-700 text-sm"><CheckCircle2 className="w-4 h-4" />提交申请</button>
              <button onClick={() => { setView('list'); setEditing(null); }} className="flex items-center gap-1 px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm"><X className="w-4 h-4" />取消</button>
            </div>
          </div>
        )}

        {/* 列表 */}
        {view === 'list' && (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 text-left">申请单号</th>
                <th className="px-4 py-3 text-left">申请人</th>
                <th className="px-4 py-3 text-left">组织</th>
                <th className="px-4 py-3 text-left">费用类型</th>
                <th className="px-4 py-3 text-right">金额</th>
                <th className="px-4 py-3 text-left">申请日期</th>
                <th className="px-4 py-3 text-center">审批状态</th>
                <th className="px-4 py-3 text-center">付款状态</th>
                <th className="px-4 py-3 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400">暂无预付款申请</td></tr>
              ) : list.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{item.applyNo}</td>
                  <td className="px-4 py-3">{item.applicantName}</td>
                  <td className="px-4 py-3">{item.department || '-'}</td>
                  <td className="px-4 py-3">{item.expenseType || '-'}</td>
                  <td className="px-4 py-3 text-right font-semibold">¥{Number(item.applyAmount).toFixed(2)}</td>
                  <td className="px-4 py-3">{item.applyDate?.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 rounded text-xs ${(STATUS_MAP[item.approvalStatus] || { label: item.approvalStatus, color: 'text-gray-500 bg-gray-100' }).color}`}>{(STATUS_MAP[item.approvalStatus] || { label: item.approvalStatus }).label}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 rounded text-xs ${(PAY_STATUS_MAP[item.payStatus] || { label: item.payStatus, color: 'text-gray-500 bg-gray-100' }).color}`}>{(PAY_STATUS_MAP[item.payStatus] || { label: item.payStatus }).label}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-center gap-2">
                      <button onClick={() => handleView(item)} className="text-gray-400 hover:text-blue-600" title="查看"><Eye className="w-4 h-4" /></button>
                      {item.approvalStatus === 'approved' && item.payStatus === 'unpaid' && (
                        <button onClick={() => setPayDialog({ sourceType: 'advance_payment', sourceId: item.id, sourceNo: item.applyNo, payee: item.applicantName, amount: item.applyAmount })} className="flex items-center gap-1 text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">
                          <Banknote className="w-3.5 h-3.5" />出纳付款
                        </button>
                      )}
                      {item.approvalStatus === 'pending' && (
                        <button onClick={() => handleDelete(item.id)} className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}

        {/* 详情视图 */}
        {view === 'detail' && detail && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button onClick={() => setView('list')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
                  <ArrowLeft className="w-4 h-4" />返回列表
                </button>
                <span className="font-mono text-sm text-gray-600">{detail.applyNo}</span>
                <span className={`px-2 py-0.5 rounded text-xs ${(STATUS_MAP[detail.approvalStatus] || { label: detail.approvalStatus, color: 'text-gray-500 bg-gray-100' }).color}`}>{(STATUS_MAP[detail.approvalStatus] || { label: detail.approvalStatus }).label}</span>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">预付款信息</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><span className="text-gray-500">申请人：</span><span className="font-medium">{detail.applicantName}</span></div>
                <div><span className="text-gray-500">组织：</span><span className="font-medium">{detail.department || '-'}</span></div>
                <div><span className="text-gray-500">申请日期：</span><span className="font-medium">{detail.applyDate?.slice(0, 10)}</span></div>
                <div><span className="text-gray-500">费用类型：</span><span className="font-medium">{detail.expenseType || '-'}</span></div>
                <div><span className="text-gray-500">付款类型：</span><span className="font-medium">{detail.paymentType || '-'}</span></div>
                <div><span className="text-gray-500">申请金额：</span><span className="font-bold text-lime-600">¥{Number(detail.applyAmount).toFixed(2)}</span></div>
                <div className="md:col-span-4"><span className="text-gray-500">申请事由：</span><span className="font-medium">{detail.reason || '-'}</span></div>
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

            {detail.approvalStatus === 'approved' && detail.payStatus === 'unpaid' && (
              <div className="bg-white rounded-xl shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Banknote className="w-5 h-5 text-blue-600" />出纳付款</h3>
                    <p className="text-sm text-gray-500 mt-1">应付金额：<span className="font-bold text-blue-600">¥{Number(detail.applyAmount).toFixed(2)}</span></p>
                  </div>
                  <button onClick={() => setPayDialog({ sourceType: 'advance_payment', sourceId: detail.id, sourceNo: detail.applyNo, payee: detail.applicantName, amount: detail.applyAmount })} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                    <Banknote className="w-4 h-4" />出纳付款
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {payDialog && (
        <PaymentDialog
          sourceType={payDialog.sourceType}
          sourceId={payDialog.sourceId}
          sourceNo={payDialog.sourceNo}
          payee={payDialog.payee}
          amount={payDialog.amount}
          onSuccess={handlePaySuccess}
          onClose={() => setPayDialog(null)}
        />
      )}
    </Layout>
  );
}

export default AdvancePaymentPage;

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
    <div className="bg-white rounded-xl shadow p-6">
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
