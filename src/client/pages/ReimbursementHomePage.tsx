import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { reimbursementApi } from '../../api/reimbursement';
import Layout from '../components/Layout';
import PaymentDialog from '../components/PaymentDialog';
import {
  Plus, FileText, Save, Send, Eye, Edit2, Trash2, Download,
  Upload, X, CheckCircle2, AlertCircle, Wallet, TrendingDown,
  Receipt, FileSpreadsheet, Banknote, Shield, ChevronDown, ChevronRight, ArrowLeft, Loader2,
  Workflow, User, Users, Briefcase, Clock, XCircle
} from 'lucide-react';

const REIMBURSE_TYPES = ['差旅费', '业务招待', '办公费', '交通费', '培训费', '其他'];
const EXPENSE_TYPES = ['差旅费', '业务招待', '办公费', '交通费', '培训费', '其他'];
const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'text-gray-500 bg-gray-100' },
  submitted: { label: '待审批', color: 'text-blue-600 bg-blue-50' },
  approved: { label: '已审批', color: 'text-green-600 bg-green-50' },
  finance_reviewing: { label: '财务审核中', color: 'text-amber-600 bg-amber-50' },
  finance_approved: { label: '财务已批', color: 'text-green-600 bg-green-50' },
  finance_rejected: { label: '财务驳回', color: 'text-red-600 bg-red-50' },
  paid: { label: '已付款', color: 'text-emerald-600 bg-emerald-50' },
};

interface ReimbursementItem {
  id?: number;
  expenseType: string;
  occurDate: string;
  amount: number;
  taxRate: number;
  taxAmount: number;
  remark: string;
}

interface Attachment {
  name: string;
  url: string;
  type?: string;
}

interface Reimbursement {
  id?: number;
  reimburseNo?: string;
  applicantId: string;
  applicantName: string;
  department: string;
  reimburseDate: string;
  reimburseType: string;
  reason: string;
  items: ReimbursementItem[];
  attachments: Attachment[];
  totalAmount?: number;
  taxTotal?: number;
  advanceDeduction: number;
  actualPayable?: number;
  status: string;
  templateId?: number;
  budgetWarn?: boolean;
  budgetExceed?: boolean;
  financeRemark?: string;
  financeStatus?: string;
  financeRejectReason?: string;
  payStatus?: string;
  payDate?: string;
  paySerialNo?: string;
  voucherId?: number;
}

function ReimbursementHomePage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [view, setView] = useState<'list' | 'form' | 'detail' | 'advanceList'>('list');
  const [list, setList] = useState<any[]>([]);
  const [editing, setEditing] = useState<Reimbursement | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [availableAdvances, setAvailableAdvances] = useState<any[]>([]);
  const [advanceList, setAdvanceList] = useState<any[]>([]);
  const [payDialog, setPayDialog] = useState<any>(null);
  const [approvalTasks, setApprovalTasks] = useState<any[]>([]);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);

  const loadData = useCallback(async () => {
    const data = await reimbursementApi.list();
    if (!data.error && !data.message) setList(data);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 计算明细合计
  const calcTotals = (items: ReimbursementItem[]) => {
    let total = 0, tax = 0;
    items.forEach(it => {
      total += Number(it.amount) || 0;
      tax += Number(it.taxAmount) || 0;
    });
    return { total, tax };
  };

  // 计算税额（taxRate 为百分比值，如 13 表示 13%）
  const calcTax = (amount: number, rate: number) => {
    return Math.round((amount * rate / 100) * 100) / 100;
  };

  // 表单操作
  const handleNew = async () => {
    // 自动获取员工已审批通过的可用预支款
    let advDeduction = 0;
    let advList: any[] = [];
    if (user?.userCode) {
      try {
        const data = await reimbursementApi.availableAdvances(user.userCode);
        if (!data.error && !data.message && Array.isArray(data)) {
          advList = data;
          advDeduction = data.reduce((sum: number, a: any) => sum + Number(a.balance || 0), 0);
        }
      } catch { /* ignore */ }
    }
    setAvailableAdvances(advList);
    setEditing({
      applicantId: user?.userCode || '',
      applicantName: user?.userName || user?.userCode || '',
      department: user?.orgName || '',
      reimburseDate: new Date().toISOString().slice(0, 10),
      reimburseType: '差旅费',
      reason: '',
      items: [{ expenseType: '差旅费', occurDate: new Date().toISOString().slice(0, 10), amount: 0, taxRate: 0, taxAmount: 0, remark: '' }],
      attachments: [],
      advanceDeduction: advDeduction,
      status: 'draft',
    });
    setView('form');
  };

  // 报销预支款：加载当前用户的可用预支款列表
  const handleShowAdvanceList = async () => {
    if (user?.userCode) {
      try {
        const data = await reimbursementApi.availableAdvances(user.userCode);
        if (!data.error && !data.message && Array.isArray(data)) {
          setAdvanceList(data);
        }
      } catch { /* ignore */ }
    }
    setView('advanceList');
  };

  // 点击预支款"报销"按钮：自动生成报销单，带出报销类型和事由
  const handleReimburseAdvance = (adv: any) => {
    const advList = [adv];
    setAvailableAdvances(advList);
    setEditing({
      applicantId: user?.userCode || '',
      applicantName: user?.userName || user?.userCode || '',
      department: user?.orgName || '',
      reimburseDate: new Date().toISOString().slice(0, 10),
      reimburseType: adv.expenseType || '其他',
      reason: adv.applyReason || adv.remark || '',
      items: [{ expenseType: adv.expenseType || '其他', occurDate: new Date().toISOString().slice(0, 10), amount: 0, taxRate: 0, taxAmount: 0, remark: `预支款:${adv.advanceNo}` }],
      attachments: [],
      advanceDeduction: Number(adv.balance) || 0,
      status: 'draft',
    });
    setView('form');
  };

  const handleEdit = (item: any) => {
    reimbursementApi.getById(item.id).then(data => {
      if (!data.error && !data.message) {
        setEditing({
          id: data.id,
          reimburseNo: data.reimburseNo,
          applicantId: data.applicantId,
          applicantName: data.applicantName,
          department: data.department,
          reimburseDate: data.reimburseDate?.slice(0, 10),
          reimburseType: data.reimburseType,
          reason: data.reason,
          items: data.items || [],
          attachments: data.attachments || [],
          advanceDeduction: data.advanceDeduction || 0,
          status: data.status,
          budgetWarn: data.budgetWarn,
          budgetExceed: data.budgetExceed,
          financeRemark: data.financeRemark,
          financeStatus: data.financeStatus,
          financeRejectReason: data.financeRejectReason,
          payStatus: data.payStatus,
          payDate: data.payDate?.slice(0, 10),
          paySerialNo: data.paySerialNo,
          voucherId: data.voucherId,
        });
        setView('form');
      }
    });
  };

  const handleView = (item: any) => {
    reimbursementApi.getById(item.id).then(data => {
      if (!data.error && !data.message) {
        setDetail(data);
        setView('detail');
        // 加载审批进度
        reimbursementApi.approvalTaskBySource('reimbursement', item.id).then((tasks: any) => {
          if (!tasks.error && !tasks.message) setApprovalTasks(tasks);
          else setApprovalTasks([]);
        });
      }
    });
  };

  const handleSave = async (submit: boolean) => {
    if (!editing) return;
    const totals = calcTotals(editing.items);
    const payload = {
      ...editing,
      totalAmount: totals.total,
      taxTotal: totals.tax,
      actualPayable: totals.total - (editing.advanceDeduction || 0),
      status: submit ? 'submitted' : 'draft',
      createdBy: user?.userCode || editing.applicantName,
    };
    if (editing.id) {
      await reimbursementApi.update(editing.id, payload);
    } else {
      await reimbursementApi.create(payload);
    }
    setEditing(null);
    setView('list');
    loadData();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除此报销单？')) return;
    await reimbursementApi.delete(id);
    loadData();
  };

  const handleUpload = async (files: FileList) => {
    if (!editing || !files.length) return;
    const result = await reimbursementApi.upload(Array.from(files));
    if (result.urls) {
      setEditing({ ...editing, attachments: [...editing.attachments, ...result.urls] });
    }
  };

  // 上传发票并 OCR 识别，自动生成明细行
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const handleInvoiceUpload = async (files: FileList) => {
    if (!editing || !files.length) return;
    setInvoiceLoading(true);
    try {
      // 先上传文件到服务器
      const uploadResult = await reimbursementApi.upload(Array.from(files));
      const urls: { name: string; url: string; type?: string }[] = uploadResult.urls || [];
      // 同时加入附件
      if (urls.length > 0) {
        setEditing(prev => prev ? { ...prev, attachments: [...prev.attachments, ...urls] } : prev);
      }
      // 逐张 OCR 识别
      const newItems: ReimbursementItem[] = [];
      for (const f of Array.from(files)) {
        try {
          const ocrRes = await reimbursementApi.invoiceOcr(f);
          if (ocrRes.success && ocrRes.amount != null) {
            newItems.push({
              expenseType: editing.reimburseType,
              occurDate: ocrRes.date || new Date().toISOString().slice(0, 10),
              amount: ocrRes.amount,
              taxRate: ocrRes.taxRate || 0,
              taxAmount: ocrRes.taxAmount || 0,
              remark: ocrRes.invoiceNo ? `发票号:${ocrRes.invoiceNo}` : '发票识别',
            });
          }
        } catch { /* 单张失败跳过 */ }
      }
      if (newItems.length > 0) {
        setEditing(prev => prev ? { ...prev, items: [...prev.items, ...newItems] } : prev);
      }
    } catch { /* ignore */ }
    setInvoiceLoading(false);
  };

  // 明细行操作
  const addItem = () => {
    if (!editing) return;
    setEditing({ ...editing, items: [...editing.items, { expenseType: editing.reimburseType, occurDate: new Date().toISOString().slice(0, 10), amount: 0, taxRate: 0, taxAmount: 0, remark: '' }] });
  };

  // 切换报销类型时同步已有明细行的费用类型
  const handleReimburseTypeChange = (newType: string) => {
    if (!editing) return;
    setEditing({
      ...editing,
      reimburseType: newType,
      items: editing.items.map(it => ({ ...it, expenseType: newType })),
    });
  };

  const updateItem = (idx: number, field: string, value: any) => {
    if (!editing) return;
    const items = [...editing.items];
    items[idx] = { ...items[idx], [field]: value };
    if (field === 'amount' || field === 'taxRate') {
      items[idx].taxAmount = calcTax(Number(items[idx].amount) || 0, Number(items[idx].taxRate) || 0);
    }
    setEditing({ ...editing, items });
  };

  const removeItem = (idx: number) => {
    if (!editing) return;
    setEditing({ ...editing, items: editing.items.filter((_, i) => i !== idx) });
  };

  // 财务审核
  const handleFinanceReview = async (id: number, status: string, remark: string, rejectReason: string) => {
    await reimbursementApi.financeReview(id, { financeStatus: status, financeRemark: remark, financeRejectReason: rejectReason });
    setView('list');
    loadData();
  };

  // 付款登记
  const handlePayment = async (id: number, payStatus: string, payDate: string, paySerialNo: string) => {
    await reimbursementApi.payment(id, { payStatus, payDate, paySerialNo });
    setView('list');
    loadData();
  };

  // 生成凭证
  const handleGenerateVoucher = async (id: number) => {
    const result = await reimbursementApi.generateVoucher(id);
    if (result.success) {
      alert(`凭证已生成，凭证号：${result.voucherNo}`);
      loadData();
    }
  };

  // 审批通过
  const handleApprove = async (taskId: number) => {
    await reimbursementApi.approvalTaskApprove(taskId, {
      approvedBy: user?.userName || user?.userCode || '',
      userCode: user?.userCode || '',
      groupName: user?.groupName || '',
    });
    setShowRejectBox(false);
    setRejectReason('');
    if (detail?.id) {
      reimbursementApi.approvalTaskBySource('reimbursement', detail.id).then((tasks: any) => {
        if (!tasks.error && !tasks.message) setApprovalTasks(tasks);
      });
      reimbursementApi.getById(detail.id).then((data: any) => {
        if (!data.error && !data.message) setDetail(data);
      });
    }
  };

  // 审批驳回
  const handleReject = async (taskId: number) => {
    if (!rejectReason.trim()) { alert('请填写驳回原因'); return; }
    await reimbursementApi.approvalTaskReject(taskId, {
      approvedBy: user?.userName || user?.userCode || '',
      userCode: user?.userCode || '',
      groupName: user?.groupName || '',
      rejectReason,
    });
    setShowRejectBox(false);
    setRejectReason('');
    if (detail?.id) {
      reimbursementApi.approvalTaskBySource('reimbursement', detail.id).then((tasks: any) => {
        if (!tasks.error && !tasks.message) setApprovalTasks(tasks);
      });
      reimbursementApi.getById(detail.id).then((data: any) => {
        if (!data.error && !data.message) setDetail(data);
      });
    }
  };

  // 检查当前用户是否有审批权限
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

  // 导出付款清单
  const handleExportPayments = async () => {
    const data = await reimbursementApi.exportPayments();
    if (data.error || data.message) return;
    const headers = ['报销单号', '报销人', '组织', '报销类型', '实际应付', '付款状态', '付款日期', '付款流水号'];
    const rows = data.map((r: any) => [r.reimburseNo, r.applicantName, r.department, r.reimburseType, r.actualPayable, r.payStatus, r.payDate, r.paySerialNo]);
    const csv = [headers, ...rows].map((r: string[]) => r.map((c: string) => `"${c ?? ''}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '付款清单.csv';
    a.click();
  };

  const today = new Date().toISOString().slice(0, 10);

  // ============================================================
  // 列表视图
  // ============================================================
  if (view === 'list') {
    return (
      <Layout title="报销申请" subtitle="报销申请、审批、付款与凭证管理">
        <div className="p-4 max-w-7xl mx-auto">
          {/* 操作按钮区 */}
          <div className="flex flex-wrap gap-3 mb-6">
            <button onClick={handleNew} className="flex items-center gap-2 px-4 py-2 bg-lime-600 text-white rounded-lg hover:bg-lime-700 transition">
              <Plus className="w-4 h-4" />新建报销单
            </button>
            <button onClick={handleShowAdvanceList} className="flex items-center gap-2 px-4 py-2 bg-white border border-lime-300 text-lime-700 rounded-lg hover:bg-lime-50 transition">
              <Wallet className="w-4 h-4" />报销预支款
            </button>
            <button onClick={handleExportPayments} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition">
              <Download className="w-4 h-4" />导出付款清单
            </button>
          </div>

          {/* 报销单列表 */}
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left">报销单号</th>
                  <th className="px-4 py-3 text-left">报销人</th>
                  <th className="px-4 py-3 text-left">组织</th>
                  <th className="px-4 py-3 text-left">类型</th>
                  <th className="px-4 py-3 text-right">金额</th>
                  <th className="px-4 py-3 text-left">状态</th>
                  <th className="px-4 py-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {list.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">暂无报销单，点击"新建报销单"开始</td></tr>
                ) : list.map((item) => {
                  const st = STATUS_MAP[item.status] || { label: item.status, color: 'text-gray-500 bg-gray-100' };
                  return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs">{item.reimburseNo}</td>
                      <td className="px-4 py-3">{item.applicantName}</td>
                      <td className="px-4 py-3">{item.department || '-'}</td>
                      <td className="px-4 py-3">{item.reimburseType}</td>
                      <td className="px-4 py-3 text-right font-semibold">¥{Number(item.actualPayable || item.totalAmount || 0).toFixed(2)}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-1 rounded text-xs ${st.color}`}>{st.label}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => handleView(item)} className="text-gray-400 hover:text-blue-600" title="查看"><Eye className="w-4 h-4" /></button>
                          {item.status === 'draft' && <button onClick={() => handleEdit(item)} className="text-gray-400 hover:text-lime-600" title="编辑"><Edit2 className="w-4 h-4" /></button>}
                          {item.status === 'draft' && <button onClick={() => handleDelete(item.id)} className="text-gray-400 hover:text-red-600" title="删除"><Trash2 className="w-4 h-4" /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Layout>
    );
  }

  // ============================================================
  // 报销预支款视图：列出预支款明细，点击报销生成报销单
  // ============================================================
  if (view === 'advanceList') {
    return (
      <Layout title="报销预支款" subtitle="选择预支款进行报销">
        <div className="p-4 max-w-5xl mx-auto">
          <div className="mb-4">
            <button onClick={() => setView('list')} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm">
              <ArrowLeft className="w-4 h-4" />返回报销申请
            </button>
          </div>
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="px-4 py-3 bg-lime-50 border-b border-lime-200 flex items-center gap-2">
              <Wallet className="w-5 h-5 text-lime-600" />
              <span className="font-medium text-lime-700">可用预支款明细</span>
              <span className="text-sm text-gray-500 ml-auto">共 {advanceList.length} 笔</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left">预支单号</th>
                  <th className="px-4 py-3 text-left">费用类型</th>
                  <th className="px-4 py-3 text-left">预支日期</th>
                  <th className="px-4 py-3 text-left">事由</th>
                  <th className="px-4 py-3 text-right">预支金额</th>
                  <th className="px-4 py-3 text-right">余额</th>
                  <th className="px-4 py-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {advanceList.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">暂无可用预支款</td></tr>
                ) : advanceList.map((adv) => (
                  <tr key={adv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">{adv.advanceNo}</td>
                    <td className="px-4 py-3">{adv.expenseType || '其他'}</td>
                    <td className="px-4 py-3">{adv.advanceDate?.slice(0, 10)}</td>
                    <td className="px-4 py-3 text-gray-600">{adv.applyReason || adv.remark || '-'}</td>
                    <td className="px-4 py-3 text-right">¥{Number(adv.advanceAmount).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-lime-600">¥{Number(adv.balance).toFixed(2)}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => handleReimburseAdvance(adv)} className="flex items-center gap-1 px-3 py-1.5 bg-lime-600 text-white rounded-lg hover:bg-lime-700 transition text-xs mx-auto">
                        <Receipt className="w-3.5 h-3.5" />报销
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Layout>
    );
  }

  // ============================================================
  // 表单视图（新建/编辑）
  // ============================================================
  if (view === 'form' && editing) {
    const totals = calcTotals(editing.items);
    const actualPayable = totals.total - (editing.advanceDeduction || 0);
    return (
      <Layout title={editing.id ? `编辑报销单 ${editing.reimburseNo || ''}` : '新建报销单'} subtitle="填写报销信息">
        <div className="p-4 max-w-5xl mx-auto space-y-6">
          {/* 基础信息 */}
          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">基础信息</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">报销人</label>
                <input value={editing.applicantName} onChange={e => setEditing({ ...editing, applicantName: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">组织</label>
                <input value={editing.department} readOnly title="自动获取当前用户所属组织" className="w-full border border-gray-200 bg-gray-100 rounded-lg px-3 py-2 text-sm text-gray-600" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">报销日期</label>
                <input type="date" value={editing.reimburseDate} onChange={e => setEditing({ ...editing, reimburseDate: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">报销类型</label>
                <select value={editing.reimburseType} onChange={e => handleReimburseTypeChange(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {REIMBURSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-600 mb-1">报销事由</label>
                <input value={editing.reason} onChange={e => setEditing({ ...editing, reason: e.target.value })} placeholder="简要说明报销事由" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
          </div>

          {/* 预算提示 */}
          {editing.budgetExceed && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2 text-red-700">
              <AlertCircle className="w-5 h-5" />
              <span className="text-sm">当前报销金额超出组织预算，提交后需强制上级审批</span>
            </div>
          )}
          {editing.budgetWarn && !editing.budgetExceed && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center gap-2 text-amber-700">
              <AlertCircle className="w-5 h-5" />
              <span className="text-sm">当前报销金额接近预算上限，请留意</span>
            </div>
          )}

          {/* 费用明细 */}
          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">费用明细</h3>
              <div className="flex gap-2">
                <label className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg cursor-pointer border ${invoiceLoading ? 'bg-gray-100 text-gray-400 border-gray-200' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'}`}>
                  {invoiceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  <span>{invoiceLoading ? '识别中...' : '上传发票'}</span>
                  <input type="file" multiple accept="image/*" className="hidden" disabled={invoiceLoading} onChange={e => e.target.files && handleInvoiceUpload(e.target.files)} />
                </label>
                <button onClick={addItem} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-lime-50 text-lime-700 border border-lime-200 rounded-lg hover:bg-lime-100">
                  <Plus className="w-4 h-4" />添加明细行
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left">费用类型</th>
                    <th className="px-3 py-2 text-left">发生日期</th>
                    <th className="px-3 py-2 text-right">金额</th>
                    <th className="px-3 py-2 text-right">税率(%)</th>
                    <th className="px-3 py-2 text-right">税额</th>
                    <th className="px-3 py-2 text-left">备注</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {editing.items.map((it, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2">
                        <select value={it.expenseType} onChange={e => updateItem(idx, 'expenseType', e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm w-full">
                          {EXPENSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2"><input type="date" value={it.occurDate?.slice(0, 10)} onChange={e => updateItem(idx, 'occurDate', e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm" /></td>
                      <td className="px-3 py-2"><input type="number" value={it.amount} onChange={e => updateItem(idx, 'amount', Number(e.target.value))} className="border border-gray-300 rounded px-2 py-1 text-sm w-24 text-right" /></td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <input type="number" step="1" value={it.taxRate} onChange={e => updateItem(idx, 'taxRate', Number(e.target.value))} className="border border-gray-300 rounded px-2 py-1 text-sm w-14 text-right" />
                          <span className="text-xs text-gray-500">%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{it.taxAmount.toFixed(2)}</td>
                      <td className="px-3 py-2"><input value={it.remark} onChange={e => updateItem(idx, 'remark', e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm w-full" /></td>
                      <td className="px-3 py-2"><button onClick={() => removeItem(idx)} className="text-gray-400 hover:text-red-600"><X className="w-4 h-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 font-semibold">
                    <td colSpan={2} className="px-3 py-2 text-right">合计</td>
                    <td className="px-3 py-2 text-right">¥{totals.total.toFixed(2)}</td>
                    <td></td>
                    <td className="px-3 py-2 text-right">¥{totals.tax.toFixed(2)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* 附件上传 */}
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">附件上传</h3>
            <div className="flex flex-wrap gap-3">
              {editing.attachments.map((att, idx) => (
                <div key={idx} className="relative w-24 h-24 border border-gray-200 rounded-lg overflow-hidden group">
                  <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
                  <button onClick={() => setEditing({ ...editing, attachments: editing.attachments.filter((_, i) => i !== idx) })} className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <label className="w-24 h-24 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-lime-400 hover:bg-lime-50">
                <Upload className="w-6 h-6 text-gray-400 mb-1" />
                <span className="text-xs text-gray-500">上传附件</span>
                <input type="file" multiple accept="image/*" className="hidden" onChange={e => e.target.files && handleUpload(e.target.files)} />
              </label>
            </div>
            <p className="text-xs text-gray-400 mt-2">支持发票照片、小票、截图，可多张上传</p>
          </div>

          {/* 冲销预借款 */}
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">冲销预借款</h3>
            {availableAdvances.length > 0 && (
              <div className="mb-4 p-3 bg-lime-50 rounded-lg border border-lime-200">
                <div className="flex items-center gap-2 text-sm text-lime-700 mb-2">
                  <Wallet className="w-4 h-4" />
                  <span className="font-medium">系统已自动获取 {availableAdvances.length} 笔可用预支款</span>
                </div>
                <div className="space-y-1">
                  {availableAdvances.map((a, i) => (
                    <div key={i} className="flex justify-between text-xs text-lime-600">
                      <span>{a.advanceNo} | {a.expenseType || '其他'} | {a.advanceDate?.slice(0,10)}</span>
                      <span>余额 ¥{Number(a.balance).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-4">
              <label className="text-sm text-gray-600">抵扣预借款金额</label>
              <input type="number" value={editing.advanceDeduction} onChange={e => setEditing({ ...editing, advanceDeduction: Number(e.target.value) })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-40" />
              <span className="text-sm text-gray-500">实际应付：<strong className="text-lime-600">¥{actualPayable.toFixed(2)}</strong></span>
            </div>
          </div>

          {/* 汇总与操作 */}
          <div className="bg-gray-50 rounded-xl p-6 flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-sm text-gray-600">报销总额：<span className="font-bold text-gray-800">¥{totals.total.toFixed(2)}</span></div>
              <div className="text-sm text-gray-600">税额合计：<span className="font-bold">¥{totals.tax.toFixed(2)}</span></div>
              <div className="text-sm text-gray-600">冲销预借款：<span className="font-bold">¥{(editing.advanceDeduction || 0).toFixed(2)}</span></div>
              <div className="text-base font-bold text-lime-600">实际应付：¥{actualPayable.toFixed(2)}</div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setView('list')} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100">取消</button>
              <button onClick={() => handleSave(false)} className="flex items-center gap-2 px-4 py-2 bg-white border border-lime-300 text-lime-700 rounded-lg hover:bg-lime-50">
                <Save className="w-4 h-4" />存草稿
              </button>
              <button onClick={() => handleSave(true)} className="flex items-center gap-2 px-4 py-2 bg-lime-600 text-white rounded-lg hover:bg-lime-700">
                <Send className="w-4 h-4" />提交报销
              </button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // ============================================================
  // 详情视图
  // ============================================================
  if (view === 'detail' && detail) {
    const st = STATUS_MAP[detail.status] || { label: detail.status, color: 'text-gray-500 bg-gray-100' };
    const isFinanceStage = detail.status === 'approved' || detail.status === 'finance_reviewing' || detail.status === 'finance_approved' || detail.status === 'finance_rejected';
    return (
      <Layout title={`报销单 ${detail.reimburseNo}`} subtitle="报销单详情">
        <div className="p-4 max-w-5xl mx-auto space-y-6">
          {/* 状态条 */}
          <div className="bg-white rounded-xl shadow p-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className={`px-3 py-1 rounded-full text-sm ${st.color}`}>{st.label}</span>
              <span className="text-sm text-gray-500">{detail.reimburseType} | {detail.applicantName} | {detail.department}</span>
            </div>
            <button onClick={() => setView('list')} className="text-sm text-gray-500 hover:text-gray-700">返回列表</button>
          </div>

          {/* 审批进度 */}
          {approvalTasks.length > 0 && (
            <ApprovalProgress
              tasks={approvalTasks}
              canApproveTask={checkCanApprove}
              onApprove={handleApprove}
              onReject={handleReject}
              rejectReason={rejectReason}
              setRejectReason={setRejectReason}
              showRejectBox={showRejectBox}
              setShowRejectBox={setShowRejectBox}
            />
          )}

          {/* 基础信息 */}
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">基础信息</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><span className="text-gray-500">报销人：</span><span className="font-medium">{detail.applicantName}</span></div>
              <div><span className="text-gray-500">组织：</span><span className="font-medium">{detail.department || '-'}</span></div>
              <div><span className="text-gray-500">报销日期：</span><span className="font-medium">{detail.reimburseDate?.slice(0, 10)}</span></div>
              <div><span className="text-gray-500">报销类型：</span><span className="font-medium">{detail.reimburseType}</span></div>
              <div className="md:col-span-4"><span className="text-gray-500">报销事由：</span><span className="font-medium">{detail.reason}</span></div>
            </div>
          </div>

          {/* 费用明细 */}
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">费用明细</h3>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600"><tr>
                <th className="px-3 py-2 text-left">费用类型</th><th className="px-3 py-2 text-left">发生日期</th>
                <th className="px-3 py-2 text-right">金额</th><th className="px-3 py-2 text-right">税率(%)</th>
                <th className="px-3 py-2 text-right">税额</th><th className="px-3 py-2 text-left">备注</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {detail.items?.map((it: any, idx: number) => (
                  <tr key={idx}>
                    <td className="px-3 py-2">{it.expenseType}</td><td className="px-3 py-2">{it.occurDate?.slice(0, 10)}</td>
                    <td className="px-3 py-2 text-right">¥{Number(it.amount).toFixed(2)}</td><td className="px-3 py-2 text-right">{Number(it.taxRate).toFixed(0)}%</td>
                    <td className="px-3 py-2 text-right">¥{Number(it.taxAmount).toFixed(2)}</td><td className="px-3 py-2">{it.remark || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 flex justify-end gap-8 text-sm">
              <span className="text-gray-600">报销总额：<strong>¥{Number(detail.totalAmount).toFixed(2)}</strong></span>
              <span className="text-gray-600">冲销预借款：<strong>¥{Number(detail.advanceDeduction).toFixed(2)}</strong></span>
              <span className="text-lime-600 font-bold">实际应付：¥{Number(detail.actualPayable).toFixed(2)}</span>
            </div>
          </div>

          {/* 附件 */}
          {detail.attachments?.length > 0 && (
            <div className="bg-white rounded-xl shadow p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">附件</h3>
              <div className="flex flex-wrap gap-3">
                {detail.attachments.map((att: any, idx: number) => (
                  <a key={idx} href={att.filePath} target="_blank" className="w-24 h-24 border border-gray-200 rounded-lg overflow-hidden">
                    <img src={att.filePath} alt={att.fileName} className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* 财务审核 */}
          {isFinanceStage && (
            <FinanceReviewPanel reimburseId={detail.id} financeStatus={detail.financeStatus} financeRemark={detail.financeRemark} financeRejectReason={detail.financeRejectReason} onReview={handleFinanceReview} />
          )}

          {/* 付款管理 */}
          {(detail.status === 'finance_approved' || detail.status === 'paid') && (
            <PaymentPanel reimburseId={detail.id} payStatus={detail.payStatus} payDate={detail.payDate} paySerialNo={detail.paySerialNo} onPayment={handlePayment} />
          )}

          {/* 出纳付款 */}
          {detail.status === 'finance_approved' && detail.payStatus !== 'paid' && (
            <div className="bg-white rounded-xl shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Banknote className="w-5 h-5 text-blue-600" />出纳付款</h3>
                  <p className="text-sm text-gray-500 mt-1">应付金额：<span className="font-bold text-blue-600">¥{Number(detail.actualPayable || detail.totalAmount || 0).toFixed(2)}</span></p>
                </div>
                <button onClick={() => setPayDialog({ sourceType: 'reimbursement', sourceId: detail.id, sourceNo: detail.reimburseNo, payee: detail.applicantName, amount: detail.actualPayable || detail.totalAmount })} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                  <Banknote className="w-4 h-4" />出纳付款
                </button>
              </div>
            </div>
          )}

          {/* 凭证 */}
          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">会计凭证</h3>
              {!detail.voucherId && detail.status === 'paid' && (
                <button onClick={() => handleGenerateVoucher(detail.id)} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-lime-50 text-lime-700 border border-lime-200 rounded-lg hover:bg-lime-100">
                  <Receipt className="w-4 h-4" />生成凭证
                </button>
              )}
            </div>
            {detail.voucher && detail.voucher.length > 0 ? (
              <div className="text-sm space-y-1">
                <div><span className="text-gray-500">凭证号：</span><span className="font-mono">{detail.voucher[0].voucherNo}</span></div>
                <div><span className="text-gray-500">凭证日期：</span>{detail.voucher[0].voucherDate?.slice(0, 10)}</div>
                <div><span className="text-gray-500">借方科目：</span>{detail.voucher[0].debitSubject}</div>
                <div><span className="text-gray-500">贷方科目：</span>{detail.voucher[0].creditSubject}</div>
                <div><span className="text-gray-500">金额：</span>¥{Number(detail.voucher[0].amount).toFixed(2)}</div>
                <div><span className="text-gray-500">摘要：</span>{detail.voucher[0].summary}</div>
                <button onClick={() => navigate('/reimbursement/voucher')} className="mt-2 text-sm text-lime-600 hover:underline">查看凭证记录 →</button>
              </div>
            ) : <p className="text-sm text-gray-400">暂未生成凭证</p>}
          </div>
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
            onSuccess={() => { setPayDialog(null); setView('list'); loadData(); }}
          />
        )}
      </Layout>
    );
  }

  // ============================================================
  // 模板管理视图（已移至独立页面 /reimbursement/template）
  // ============================================================

  return null;
}

// ============================================================
// 子组件：财务审核面板
// ============================================================
function FinanceReviewPanel({ reimburseId, financeStatus, financeRemark, financeRejectReason, onReview }: {
  reimburseId: number; financeStatus?: string; financeRemark?: string; financeRejectReason?: string;
  onReview: (id: number, status: string, remark: string, rejectReason: string) => void;
}) {
  const [remark, setRemark] = useState(financeRemark || '');
  const [rejectReason, setRejectReason] = useState(financeRejectReason || '');
  return (
    <div className="bg-white rounded-xl shadow p-6">
      <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><Shield className="w-5 h-5 text-amber-600" />财务审核</h3>
      <div className="space-y-3">
        <div>
          <label className="block text-sm text-gray-600 mb-1">财务备注</label>
          <textarea value={remark} onChange={e => setRemark(e.target.value)} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="发票校验、合规性说明等" />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">驳回原因（驳回时填写）</label>
          <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="发票异常、金额有误等" />
        </div>
        <div className="flex gap-3">
          <button onClick={() => onReview(reimburseId, 'approved', remark, '')} className="flex items-center gap-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
            <CheckCircle2 className="w-4 h-4" />通过复核
          </button>
          <button onClick={() => onReview(reimburseId, 'rejected', remark, rejectReason)} className="flex items-center gap-1 px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100">
            <X className="w-4 h-4" />驳回
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 子组件：付款管理面板
// ============================================================
function PaymentPanel({ reimburseId, payStatus, payDate, paySerialNo, onPayment }: {
  reimburseId: number; payStatus?: string; payDate?: string; paySerialNo?: string;
  onPayment: (id: number, payStatus: string, payDate: string, paySerialNo: string) => void;
}) {
  const [status, setStatus] = useState(payStatus || 'unpaid');
  const [date, setDate] = useState(payDate?.slice(0, 10) || '');
  const [serialNo, setSerialNo] = useState(paySerialNo || '');
  return (
    <div className="bg-white rounded-xl shadow p-6">
      <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><Banknote className="w-5 h-5 text-emerald-600" />付款管理</h3>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm text-gray-600 mb-1">付款状态</label>
          <select value={status} onChange={e => setStatus(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="unpaid">未付款</option>
            <option value="pending">待付款</option>
            <option value="paid">已付款</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">付款日期</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">付款流水号</label>
          <input value={serialNo} onChange={e => setSerialNo(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>
      <button onClick={() => onPayment(reimburseId, status, date, serialNo)} className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">保存付款信息</button>
    </div>
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
                      <X className="w-4 h-4" />驳回
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

export default ReimbursementHomePage;
