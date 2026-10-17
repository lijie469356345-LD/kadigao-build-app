import { useState, useEffect, useCallback } from 'react';
import { reimbursementApi } from '../../api/reimbursement';
import { getOrgTree, getRoles } from '../../api/adminPerm';
import Layout from '../components/Layout';
import {
  Plus, Trash2, Edit2, X, Search, ChevronUp, ChevronDown, ChevronRight,
  Workflow, User, Users, DollarSign, Wallet, CheckCircle2, AlertCircle, Loader2, Building2, ArrowUpCircle
} from 'lucide-react';

const PAYMENT_TYPES = ['报销', '借款', '预付款'];
// 【2026-09】已移除「限定用户组或用户」条件（用户组功能下线），保留金额/预算两类条件
const CONDITION_TYPES = [
  { value: 'amount', label: '限定金额', icon: DollarSign },
  { value: 'budget', label: '限定预算余额', icon: Wallet },
];

interface Approver {
  approverType: 'person' | 'group' | 'orgLevel' | 'org';
  approverCode: string;
  approverName: string;
  groupName?: string;
  /** 按组织层：组织链第 N 层（顶层为第 1 层，向下递增） */
  orgLevel?: number;
  /** 该层组织内审批人需拥有的角色 */
  roleCode?: string;
  roleName?: string;
  /** 任务创建时固化的目标组织快照（展示用） */
  orgId?: number | null;
  orgName?: string;
  /** org 类型：跨组织审批（申请人不需在该组织线内，用于财务总监/老板等职能组织） */
  crossOrg?: boolean;
}

interface ApprovalLevel {
  level: number;
  approvers: Approver[];
  /** 本级发起定位角色（role_code 数组）：拥有这些角色的用户提交时，审批从本级之后开始（逐级向上） */
  initiatorRoles?: string[];
}

interface ConditionConfig {
  type: 'amount' | 'group_user' | 'budget';
  minAmount?: number;
  maxAmount?: number;
  groups?: string[];
  users?: { userCode: string; userName: string }[];
  budgetType?: string;
  budgetMinRemaining?: number;
}

interface ApprovalFlow {
  id?: number;
  flowNo?: string;
  paymentType?: string;
  approvalSteps: ApprovalLevel[];
  conditionConfig?: ConditionConfig | null;
  status?: string;
  /** 适用范围：org_id/org_ids 为空表示全局适用；非空表示仅指定组织及其下级组织适用（org_ids 支持多组织，逗号分隔） */
  org_id?: number | null;
  org_name?: string | null;
  org_ids?: string | null;
  org_names?: string | null;
  /** 抄送配置（审批流末尾全局抄送）：用户/组织多选，审批流程启动后固化到审批任务 */
  ccUsers?: { userCode: string; userName: string }[];
  ccOrgs?: { org_id: number; org_name: string }[];
}

function ReimbursementApprovalPage() {
  const [list, setList] = useState<ApprovalFlow[]>([]);
  const [editing, setEditing] = useState<ApprovalFlow | null>(null);
  const [showForm, setShowForm] = useState(false);

  const loadData = useCallback(async () => {
    const data = await reimbursementApi.approvalList();
    if (!data.error && !data.message) setList(data);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleNew = () => {
    setEditing({
      flowNo: `AF${Date.now()}`,
      paymentType: '报销',
      approvalSteps: [],
      conditionConfig: null,
      status: 'active',
      org_id: null,
      org_name: null,
      org_ids: null,
      org_names: null,
      ccUsers: [],
      ccOrgs: [],
    });
    setShowForm(true);
  };

  const handleEdit = (item: ApprovalFlow) => {
    // 兼容旧格式：如果 approvalSteps 是扁平的 ApprovalStep[]，转换为 ApprovalLevel[]
    let steps = item.approvalSteps || [];
    if (steps.length > 0 && !steps[0].approvers) {
      // 旧格式扁平数组按 level 分组
      const map: Record<number, Approver[]> = {};
      (steps as any[]).forEach(s => {
        const lv = s.level || 1;
        if (!map[lv]) map[lv] = [];
        map[lv].push({ approverType: s.approverType, approverCode: s.approverCode, approverName: s.approverName, groupName: s.groupName });
      });
      steps = Object.keys(map).map((k, i) => ({ level: i + 1, approvers: map[Number(k)] }));
    }
    const { expenseType: _et, expenseCategory: _ec, ...rest } = item as any;
    setEditing({ ...rest, approvalSteps: steps });
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除此审批流？')) return;
    await reimbursementApi.approvalDelete(id);
    loadData();
  };

  const handleSave = async () => {
    if (!editing) return;
    if (editing.approvalSteps.length === 0) { alert('请至少添加一个审批步骤'); return; }
    const payload = { ...editing, createdBy: 'system' };
    if (editing.id) {
      await reimbursementApi.approvalUpdate(editing.id, payload);
    } else {
      await reimbursementApi.approvalCreate(payload);
    }
    setShowForm(false);
    setEditing(null);
    loadData();
  };

  const handleToggleStatus = async (item: ApprovalFlow) => {
    const newStatus = item.status === 'active' ? 'inactive' : 'active';
    await reimbursementApi.approvalUpdate(item.id!, { ...item, status: newStatus });
    loadData();
  };

  if (showForm && editing) {
    return <ApprovalForm editing={editing} setEditing={setEditing} onSave={handleSave} onCancel={() => { setShowForm(false); setEditing(null); }} />;
  }

  return (
    <Layout title="审批流设计" subtitle="报销审批流程配置与管理">
      <div className="p-4 max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Workflow className="w-5 h-5 text-lime-600" />审批流配置
          </h3>
          <button onClick={handleNew} className="flex items-center gap-2 px-4 py-2 bg-lime-600 text-white rounded-lg hover:bg-lime-700 transition">
            <Plus className="w-4 h-4" />新建审批流
          </button>
        </div>

        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 text-left">审批流编号</th>
                <th className="px-4 py-3 text-left">付款类型</th>
                <th className="px-4 py-3 text-left">适用范围</th>
                <th className="px-4 py-3 text-left">审批步骤</th>
                <th className="px-4 py-3 text-left">条件限定</th>
                <th className="px-4 py-3 text-left">抄送</th>
                <th className="px-4 py-3 text-center">状态</th>
                <th className="px-4 py-3 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">暂无审批流配置，点击"新建审批流"开始</td></tr>
              ) : list.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{item.flowNo}</td>
                  <td className="px-4 py-3">{item.paymentType || '-'}</td>
                  <td className="px-4 py-3">
                    {(() => {
                      // 支持多组织：org_names 逗号分隔优先；兼容历史单组织 org_id
                      const names = String(item.org_names || '').split(',').map(s => s.trim()).filter(Boolean);
                      const scopeNames = names.length > 0 ? names : (item.org_id ? [item.org_name || `组织#${item.org_id}`] : []);
                      return scopeNames.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {scopeNames.map((nm, ni) => (
                            <span key={ni} className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs border border-indigo-200">
                              <Building2 className="w-3 h-3" />{nm}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">全局</span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    {item.approvalSteps && item.approvalSteps.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1">
                        {(() => {
                          // 兼容旧格式(扁平 ApprovalStep[])和新格式(ApprovalLevel[])
                          let levels: { level: number; approvers: Approver[] }[] = [];
                          if (item.approvalSteps[0]?.approvers) {
                            levels = item.approvalSteps;
                          } else {
                            // 旧格式扁平数组按 level 分组
                            const map: Record<number, Approver[]> = {};
                            item.approvalSteps.forEach((s: any) => {
                              const lv = s.level || 1;
                              if (!map[lv]) map[lv] = [];
                              map[lv].push({ approverType: s.approverType, approverCode: s.approverCode, approverName: s.approverName, groupName: s.groupName });
                            });
                            levels = Object.keys(map).map(k => ({ level: Number(k), approvers: map[Number(k)] }));
                          }
                          return levels.map((lv, lvIdx) => (
                            <span key={lvIdx} className="inline-flex items-center gap-1">
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-lime-50 text-lime-700 rounded text-xs border border-lime-200">
                                <span className="font-mono text-[10px] text-lime-400">{lv.level || lvIdx + 1}</span>
                                {lv.approvers.map((a, aIdx) => (
                                  <span key={aIdx} className="inline-flex items-center gap-0.5">
                                    {aIdx > 0 && <span className="text-gray-300 text-[10px]">、</span>}
                                    {a.approverType === 'group' ? <Users className="w-3 h-3 text-purple-500" /> : a.approverType === 'orgLevel' ? <Building2 className="w-3 h-3 text-purple-500" /> : a.approverType === 'org' ? <Building2 className="w-3 h-3 text-indigo-500" /> : <User className="w-3 h-3" />}
                                    {a.approverName}
                                  </span>
                                ))}
                              </span>
                              {lvIdx < levels.length - 1 && <ChevronRight className="w-3 h-3 text-gray-400" />}
                            </span>
                          ));
                        })()}
                      </div>
                    ) : <span className="text-gray-400">未设置</span>}
                  </td>
                  <td className="px-4 py-3">
                    {item.conditionConfig ? <ConditionBadge config={item.conditionConfig} /> : <span className="text-gray-400">无限制</span>}
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const ccUsers = (item as any).ccUsers || [];
                      const ccOrgs = (item as any).ccOrgs || [];
                      if (ccUsers.length === 0 && ccOrgs.length === 0) return <span className="text-gray-400 text-xs">-</span>;
                      return (
                        <div className="flex flex-wrap gap-1">
                          {ccUsers.map((c: any) => (
                            <span key={c.userCode} className="inline-flex items-center gap-1 px-2 py-0.5 bg-sky-50 text-sky-700 rounded text-xs border border-sky-200">
                              <User className="w-3 h-3" />{c.userName}
                            </span>
                          ))}
                          {ccOrgs.map((c: any) => (
                            <span key={c.org_id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-sky-50 text-sky-700 rounded text-xs border border-sky-200">
                              <Building2 className="w-3 h-3" />{c.org_name}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => handleToggleStatus(item)} className={`px-2 py-1 rounded text-xs ${item.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                      {item.status === 'active' ? '启用' : '停用'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-center gap-2">
                      <button onClick={() => handleEdit(item)} className="text-gray-400 hover:text-lime-600" title="编辑"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => handleDelete(item.id!)} className="text-gray-400 hover:text-red-600" title="删除"><Trash2 className="w-4 h-4" /></button>
                    </div>
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
// 审批流表单组件
// ============================================================
function ApprovalForm({ editing, setEditing, onSave, onCancel }: {
  editing: ApprovalFlow;
  setEditing: (v: ApprovalFlow) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <Layout title={editing.id ? `编辑审批流 ${editing.flowNo || ''}` : '新建审批流'} subtitle="配置审批步骤与条件限定">
      <div className="p-4 max-w-5xl mx-auto space-y-6">
        {/* 返回按钮 */}
        <div>
          <button onClick={onCancel} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm">
            <X className="w-4 h-4" />取消
          </button>
        </div>

        {/* 基础信息 */}
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">基础信息</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">审批流编号</label>
              <input value={editing.flowNo || ''} onChange={e => setEditing({ ...editing, flowNo: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="自动生成" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">付款类型</label>
              <select value={editing.paymentType || ''} onChange={e => setEditing({ ...editing, paymentType: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                {PAYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* 审批步骤 */}
        <ApprovalStepsEditor
          steps={editing.approvalSteps || []}
          onChange={(steps) => setEditing({ ...editing, approvalSteps: steps })}
        />

        {/* 抄送（审批流之后）：用户/组织多选，抄送人可查看单据与审批进度，不参与审批 */}
        <CcEditor editing={editing} setEditing={setEditing} />

        {/* 适用范围（按组织） */}
        <OrgScopeEditor editing={editing} setEditing={setEditing} />

        {/* 条件限定 */}
        <ConditionEditor
          config={editing.conditionConfig}
          onChange={(config) => setEditing({ ...editing, conditionConfig: config })}
        />

        {/* 保存按钮 */}
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-6 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 text-sm">取消</button>
          <button onClick={onSave} className="flex items-center gap-2 px-6 py-2 bg-lime-600 text-white rounded-lg hover:bg-lime-700 text-sm">
            <CheckCircle2 className="w-4 h-4" />保存审批流
          </button>
        </div>
      </div>
    </Layout>
  );
}

// ============================================================
// 抄送编辑器：审批流末尾抄送（用户/组织多选，抄送人可查看单据统计与审批进度，不参与审批）
// ============================================================
function CcEditor({ editing, setEditing }: {
  editing: ApprovalFlow;
  setEditing: (v: ApprovalFlow) => void;
}) {
  const [users, setUsers] = useState<any[]>([]);
  const [searchKey, setSearchKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgsLoaded, setOrgsLoaded] = useState(false);
  const [ccTab, setCcTab] = useState<'user' | 'org'>('user');

  const ccUsers = editing.ccUsers || [];
  const ccOrgs = editing.ccOrgs || [];

  useEffect(() => {
    if (orgsLoaded) return;
    setOrgsLoading(true);
    getOrgTree()
      .then((res: any) => setOrgs(Array.isArray(res?.nodes) ? res.nodes : []))
      .catch(() => setOrgs([]))
      .finally(() => { setOrgsLoading(false); setOrgsLoaded(true); });
  }, [orgsLoaded]);

  const searchUsers = async (keyword: string) => {
    setLoading(true);
    try {
      const data = await reimbursementApi.approvalUsers(keyword);
      if (!data.error && !data.message) setUsers(data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleSearch = (val: string) => {
    setSearchKey(val);
    searchUsers(val);
  };

  const toggleUser = (u: any) => {
    const exists = ccUsers.find(c => c.userCode === u.userCode);
    const next = exists
      ? ccUsers.filter(c => c.userCode !== u.userCode)
      : [...ccUsers, { userCode: u.userCode, userName: u.userName }];
    setEditing({ ...editing, ccUsers: next });
  };

  const toggleOrg = (orgId: number) => {
    const node = orgs.find(o => Number(o.org_id) === orgId);
    if (!node) return;
    const exists = ccOrgs.find(o => Number(o.org_id) === orgId);
    const next = exists
      ? ccOrgs.filter(o => Number(o.org_id) !== orgId)
      : [...ccOrgs, { org_id: Number(node.org_id), org_name: node.org_name || '' }];
    setEditing({ ...editing, ccOrgs: next });
  };

  // 组织缩进展示：ancestors 深度 = 祖先数量
  const indent = (node: any) => {
    const depth = node.ancestors ? String(node.ancestors).split('/').filter(Boolean).length : 0;
    return `${'　'.repeat(depth)}${node.org_name || ''}`;
  };

  const ccUserCodes = new Set(ccUsers.map(c => c.userCode));
  const ccOrgIds = new Set(ccOrgs.map(c => Number(c.org_id)));

  return (
    <div className="bg-white rounded-xl shadow p-6">
      <h3 className="text-lg font-bold text-gray-800 mb-1 flex items-center gap-2">
        <Users className="w-5 h-5 text-sky-500" />抄送
      </h3>
      <p className="text-xs text-gray-400 mb-4">
        审批流程启动后，将单据与审批进度抄送给所选用户/组织（可多选）。抄送人可查看单据，不参与审批。
      </p>

      {/* 切换：抄送用户 / 抄送组织 */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setCcTab('user')} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm border transition ${ccTab === 'user' ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-sky-50'}`}>
          <User className="w-4 h-4" />抄送用户 {ccUsers.length > 0 && `(${ccUsers.length})`}
        </button>
        <button onClick={() => setCcTab('org')} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm border transition ${ccTab === 'org' ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-sky-50'}`}>
          <Building2 className="w-4 h-4" />抄送组织 {ccOrgs.length > 0 && `(${ccOrgs.length})`}
        </button>
      </div>

      {/* 已选摘要 */}
      {(ccUsers.length > 0 || ccOrgs.length > 0) && (
        <div className="mb-4 p-3 bg-sky-50 rounded-lg border border-sky-200">
          <p className="text-xs text-sky-600 font-medium mb-2">已选抄送（{ccUsers.length} 个用户，{ccOrgs.length} 个组织）：</p>
          <div className="flex flex-wrap gap-1.5">
            {ccUsers.map(c => (
              <span key={c.userCode} className="inline-flex items-center gap-1 px-2 py-1 bg-white text-sky-700 rounded text-xs border border-sky-200">
                <User className="w-3 h-3" />{c.userName}
                <button onClick={() => toggleUser({ userCode: c.userCode, userName: c.userName })} className="text-sky-300 hover:text-red-500"><X className="w-3 h-3" /></button>
              </span>
            ))}
            {ccOrgs.map(c => (
              <span key={c.org_id} className="inline-flex items-center gap-1 px-2 py-1 bg-white text-sky-700 rounded text-xs border border-sky-200">
                <Building2 className="w-3 h-3" />{c.org_name}
                <button onClick={() => toggleOrg(Number(c.org_id))} className="text-sky-300 hover:text-red-500"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 抄送用户 */}
      {ccTab === 'user' && (
        <div className="p-4 bg-sky-50 rounded-lg border border-sky-200">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={searchKey} onChange={e => handleSearch(e.target.value)} placeholder="搜索用户代码或姓名..." className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm" autoFocus />
            {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />}
          </div>
          <div className="max-h-48 overflow-y-auto grid grid-cols-2 md:grid-cols-3 gap-2">
            {users.map((u: any) => {
              const selected = ccUserCodes.has(u.userCode);
              return (
                <button key={u.userCode} onClick={() => toggleUser(u)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition text-left ${selected ? 'bg-sky-600 text-white border-sky-600' : 'bg-white border-gray-300 hover:border-sky-400 hover:bg-sky-50'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{u.userName}</div>
                    <div className="text-xs opacity-70 truncate">{u.userCode}{u.groupName ? ` | ${u.groupName}` : ''}</div>
                  </div>
                  {selected && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                </button>
              );
            })}
            {users.length === 0 && !loading && <div className="col-span-full text-center text-gray-400 py-4">请输入关键词搜索用户</div>}
          </div>
        </div>
      )}

      {/* 抄送组织 */}
      {ccTab === 'org' && (
        <div className="p-4 bg-sky-50 rounded-lg border border-sky-200">
          <label className="block text-sm text-gray-600 mb-2">选择组织（可多选）：所选组织及其下级组织的成员均可收到抄送</label>
          {orgsLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin" />组织列表加载中...</div>
          ) : orgs.length === 0 ? (
            <p className="text-sm text-gray-400">无可用组织（组织树加载失败或无组织数据），请先配置组织</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-white rounded-lg border border-sky-200 max-h-60 overflow-y-auto p-2">
                {orgs.map(o => {
                  const checked = ccOrgIds.has(Number(o.org_id));
                  return (
                    <label key={o.org_id} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm hover:bg-sky-50 ${checked ? 'bg-sky-50' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOrg(Number(o.org_id))}
                        className="rounded border-gray-300 text-sky-600 focus:ring-sky-500"
                      />
                      <span className={`truncate ${checked ? 'text-sky-700 font-medium' : 'text-gray-700'}`}>{indent(o)}</span>
                    </label>
                  );
                })}
              </div>
              <div className="bg-white rounded-lg border border-sky-200 p-3">
                <p className="text-xs text-gray-500 mb-2">已选组织（{ccOrgs.length} 个）：</p>
                {ccOrgs.length === 0 ? (
                  <p className="text-sm text-gray-400">尚未选择组织，请勾选左侧组织树</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {ccOrgs.map(c => (
                      <span key={c.org_id} className="inline-flex items-center gap-1 px-2 py-1 bg-sky-50 text-sky-700 rounded text-xs border border-sky-200">
                        {c.org_name || `组织#${c.org_id}`}
                        <button onClick={() => toggleOrg(Number(c.org_id))} className="text-sky-400 hover:text-sky-700">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-2">勾选的组织及其所有下级组织的成员均视为抄送人</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 适用范围编辑器：按组织配置审批流适用范围（全局 / 指定组织及其下级）
// ============================================================
function OrgScopeEditor({ editing, setEditing }: {
  editing: ApprovalFlow;
  setEditing: (v: ApprovalFlow) => void;
}) {
  const [orgs, setOrgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded) return;
    setLoading(true);
    getOrgTree()
      .then((res: any) => setOrgs(Array.isArray(res?.nodes) ? res.nodes : []))
      .catch(() => setOrgs([]))
      .finally(() => { setLoading(false); setLoaded(true); });
  }, [loaded]);

  // 多选：从 org_ids（逗号分隔）解析，兼容历史单组织 org_id
  const selectedIds = (() => {
    const raw = String(editing.org_ids || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const ids = raw.length > 0 ? raw : (editing.org_id ? [String(editing.org_id)] : []);
    return ids;
  })();
  const scopeMode: 'global' | 'org' = (editing.org_id || editing.org_ids) ? 'org' : 'global';
  const selectedNodes = selectedIds
    .map(id => orgs.find(o => String(o.org_id) === id))
    .filter(Boolean) as any[];

  const commit = (ids: number[]) => {
    const nodes = ids
      .map(id => orgs.find(o => Number(o.org_id) === id))
      .filter(Boolean) as any[];
    const names = nodes.map(n => n.org_name || '');
    setEditing({
      ...editing,
      org_id: nodes.length > 0 ? Number(nodes[0].org_id) : null,
      org_name: nodes.length > 0 ? names[0] : null,
      org_ids: nodes.length > 0 ? nodes.map(n => n.org_id).join(',') : null,
      org_names: nodes.length > 0 ? names.join(',') : null,
    });
  };

  const handleMode = (mode: 'global' | 'org') => {
    if (mode === 'global') {
      setEditing({ ...editing, org_id: null, org_name: null, org_ids: null, org_names: null });
    } else {
      if (orgs.length === 0) { alert('暂无可选组织，无法按组织限定（组织树加载失败或无组织数据）'); return; }
      if (selectedIds.length === 0) {
        // 默认选中第一个组织（通常是最高层级）
        const first = orgs[0];
        commit([Number(first.org_id)]);
      }
    }
  };

  const toggleOrg = (orgId: number) => {
    const has = selectedIds.includes(String(orgId));
    const next = has
      ? selectedIds.filter(id => id !== String(orgId)).map(Number)
      : [...selectedIds.map(Number), orgId];
    commit(next);
  };

  // 组织缩进展示：ancestors 深度 = 祖先数量
  const indent = (node: any) => {
    const depth = node.ancestors ? String(node.ancestors).split('/').filter(Boolean).length : 0;
    return `${'　'.repeat(depth)}${node.org_name || ''}`;
  };

  return (
    <div className="bg-white rounded-xl shadow p-6">
      <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
        <Building2 className="w-5 h-5 text-indigo-500" />适用范围
      </h3>

      <div className="flex flex-wrap gap-3 mb-4">
        <button
          onClick={() => handleMode('global')}
          className={`px-4 py-2 rounded-lg text-sm border transition ${scopeMode === 'global' ? 'bg-gray-600 text-white border-gray-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
        >
          全局适用（所有组织）
        </button>
        <button
          onClick={() => handleMode('org')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm border transition ${scopeMode === 'org' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-indigo-50'}`}
        >
          <Building2 className="w-4 h-4" />指定组织（可多选，含下级）
        </button>
      </div>

      {scopeMode === 'org' && (
        <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-200">
          <label className="block text-sm text-gray-600 mb-2">选择组织（可多选）：此审批流仅对所选组织及其下级组织的单据生效</label>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin" />组织列表加载中...</div>
          ) : orgs.length === 0 ? (
            <p className="text-sm text-gray-400">无可用组织（组织树加载失败或无组织数据），请先配置组织</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {/* 组织树多选 */}
              <div className="bg-white rounded-lg border border-indigo-200 max-h-72 overflow-y-auto p-2">
                {orgs.map(o => {
                  const checked = selectedIds.includes(String(o.org_id));
                  return (
                    <label key={o.org_id} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm hover:bg-indigo-50 ${checked ? 'bg-indigo-50' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOrg(Number(o.org_id))}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className={`truncate ${checked ? 'text-indigo-700 font-medium' : 'text-gray-700'}`}>{indent(o)}</span>
                    </label>
                  );
                })}
              </div>
              {/* 已选清单 */}
              <div className="bg-white rounded-lg border border-indigo-200 p-3">
                <p className="text-xs text-gray-500 mb-2">已选组织（{selectedNodes.length} 个）：</p>
                {selectedNodes.length === 0 ? (
                  <p className="text-sm text-gray-400">尚未选择组织，请勾选左侧组织树</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedNodes.map(n => (
                      <span key={n.org_id} className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-700 rounded text-xs border border-indigo-200">
                        {n.org_name || `组织#${n.org_id}`}
                        <button onClick={() => toggleOrg(Number(n.org_id))} className="text-indigo-400 hover:text-indigo-700">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-2">勾选的组织及其所有下级组织的单据将命中此流程</p>
              </div>
            </div>
          )}
        </div>
      )}

      {scopeMode === 'global' && (
        <p className="text-sm text-gray-400">未限定组织，所有组织的单据均可命中此审批流（若存在组织化流程，组织化流程优先）</p>
      )}
    </div>
  );
}

// ============================================================
// 审批步骤编辑器：支持多级审批，每级可多选审批人（用户 / 组织层 / 组织+角色）
function ApprovalStepsEditor({ steps, onChange }: {
  steps: ApprovalLevel[];
  onChange: (steps: ApprovalLevel[]) => void;
}) {
  const [users, setUsers] = useState<any[]>([]);
  const [searchKey, setSearchKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [pickerMode, setPickerMode] = useState<'person' | 'orgLevel' | 'org'>('person');
  const [activeLevel, setActiveLevel] = useState<number>(0); // 当前选中添加审批人的级别
  const [roles, setRoles] = useState<{ role_id: number; role_name: string; role_code: string }[]>([]);
  const [orgLevelInput, setOrgLevelInput] = useState<string>('1');
  const [orgRoleInput, setOrgRoleInput] = useState<string>('');
  const [orgs, setOrgs] = useState<any[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgsLoaded, setOrgsLoaded] = useState(false);
  const [orgInput, setOrgInput] = useState<string>('');
  const [orgRoleInput2, setOrgRoleInput2] = useState<string>('');
  const [orgCrossOrg, setOrgCrossOrg] = useState<boolean>(false);

  // 加载角色列表（按组织层审批人需绑定角色）
  useEffect(() => {
    getRoles().then((res: any) => {
      if (Array.isArray(res?.roles)) setRoles(res.roles);
    }).catch(() => { /* ignore */ });
  }, []);

  // 加载组织树（按组织+角色审批人）
  useEffect(() => {
    if (orgsLoaded) return;
    setOrgsLoading(true);
    getOrgTree()
      .then((res: any) => setOrgs(Array.isArray(res?.nodes) ? res.nodes : []))
      .catch(() => setOrgs([]))
      .finally(() => { setOrgsLoading(false); setOrgsLoaded(true); });
  }, [orgsLoaded]);

  const searchUsers = async (keyword: string) => {
    setLoading(true);
    try {
      const data = await reimbursementApi.approvalUsers(keyword);
      if (!data.error && !data.message) setUsers(data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    searchUsers('');
  }, []);

  const handleSearch = (val: string) => {
    setSearchKey(val);
    searchUsers(val);
  };

  const LEVEL_LABELS = ['一级', '二级', '三级', '四级', '五级', '六级', '七级', '八级', '九级', '十级'];
  const getLevelLabel = (idx: number) => LEVEL_LABELS[idx] || `第${idx + 1}级`;

  // 新建级别
  const handleAddLevel = () => {
    onChange([...steps, { level: steps.length + 1, approvers: [], initiatorRoles: [] }]);
  };

  // 添加审批人到指定级别（用户）
  const handleAddPerson = (user: any, levelIdx: number) => {
    const newSteps = steps.map((lv, i) => {
      if (i !== levelIdx) return lv;
      const exists = lv.approvers.find(a => a.approverType === 'person' && a.approverCode === user.userCode);
      if (exists) { alert('该用户已在此级别中'); return lv; }
      return { ...lv, approvers: [...lv.approvers, { approverType: 'person' as const, approverCode: user.userCode, approverName: user.userName, groupName: user.groupName || '' }] };
    });
    onChange(newSteps);
  };

  // 添加审批人到指定级别（按组织层——申请人组织链第 N 层中拥有指定角色的用户均可审）
  const handleAddOrgLevel = (levelIdx: number) => {
    const level = Number(orgLevelInput);
    if (!(level >= 1 && level <= 10)) { alert('请选择组织层级（1-10）'); return; }
    const role = roles.find(r => String(r.role_id) === orgRoleInput);
    if (!role) { alert('请选择角色'); return; }
    const roleCode = role.role_code || '';
    const roleName = role.role_name || roleCode;
    const newSteps = steps.map((lv, i) => {
      if (i !== levelIdx) return lv;
      const exists = lv.approvers.find(a => a.approverType === 'orgLevel' && a.orgLevel === level && a.roleCode === roleCode);
      if (exists) { alert(`已配置「第${level}层·${roleName}」审批人`); return lv; }
      return { ...lv, approvers: [...lv.approvers, { approverType: 'orgLevel' as const, approverCode: `ORG_L${level}_${roleCode}`, approverName: `第${level}层·${roleName}`, groupName: '', orgLevel: level, roleCode, roleName }] };
    });
    onChange(newSteps);
    setOrgRoleInput('');
  };

  // 全选用户（未选中的全部加入当前级别）
  const handleAddAllPersons = (levelIdx: number) => {
    const { persons: selectedPersons } = getSelectedCodes(levelIdx);
    const toAdd = users.filter(u => !selectedPersons.has(u.userCode));
    if (toAdd.length === 0) { alert('搜索结果已全部添加'); return; }
    const newSteps = steps.map((lv, i) => {
      if (i !== levelIdx) return lv;
      const newApprovers = toAdd.map(u => ({ approverType: 'person' as const, approverCode: u.userCode, approverName: u.userName, groupName: u.groupName || '' }));
      const existingCodes = new Set(lv.approvers.filter(a => a.approverType === 'person').map(a => a.approverCode));
      const filtered = newApprovers.filter(a => !existingCodes.has(a.approverCode));
      return { ...lv, approvers: [...lv.approvers, ...filtered] };
    });
    onChange(newSteps);
  };

  // 从指定级别移除审批人
  const handleRemoveApprover = (levelIdx: number, approverIdx: number) => {
    const newSteps = steps.map((lv, i) => {
      if (i !== levelIdx) return lv;
      return { ...lv, approvers: lv.approvers.filter((_, j) => j !== approverIdx) };
    });
    onChange(newSteps);
  };

  // 移除整个级别
  const handleRemoveLevel = (levelIdx: number) => {
    const newSteps = steps.filter((_, i) => i !== levelIdx);
    newSteps.forEach((s, i) => { s.level = i + 1; });
    if (activeLevel >= newSteps.length) setActiveLevel(Math.max(0, newSteps.length - 1));
    onChange(newSteps);
  };

  // 级别上移
  const handleMoveLevelUp = (idx: number) => {
    if (idx === 0) return;
    const arr = [...steps];
    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
    arr.forEach((s, i) => { s.level = i + 1; });
    onChange(arr);
  };

  // 级别下移
  const handleMoveLevelDown = (idx: number) => {
    if (idx === steps.length - 1) return;
    const arr = [...steps];
    [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
    arr.forEach((s, i) => { s.level = i + 1; });
    onChange(arr);
  };

  // 添加审批人到指定级别（按组织+角色——指定组织内拥有所选角色的用户可审批，可跨组织）
  const handleAddOrg = (levelIdx: number) => {
    const node = orgs.find(o => String(o.org_id) === orgInput);
    if (!node) { alert('请选择组织'); return; }
    const role = roles.find(r => String(r.role_id) === orgRoleInput2);
    if (!role) { alert('请选择角色'); return; }
    const roleCode = role.role_code || '';
    const roleName = role.role_name || roleCode;
    const orgId = Number(node.org_id);
    const orgName = node.org_name || '';
    const crossOrg = !!orgCrossOrg;
    const newSteps = steps.map((lv, i) => {
      if (i !== levelIdx) return lv;
      const exists = lv.approvers.find(a => a.approverType === 'org' && Number(a.orgId) === orgId && a.roleCode === roleCode);
      if (exists) { alert(`已配置「${orgName}·${roleName}」审批人`); return lv; }
      return { ...lv, approvers: [...lv.approvers, { approverType: 'org' as const, approverCode: `ORG${orgId}_${roleCode}`, approverName: crossOrg ? `${orgName}·${roleName}（跨组织）` : `${orgName}·${roleName}`, groupName: '', roleCode, roleName, orgId, orgName, crossOrg }] };
    });
    onChange(newSteps);
    setOrgRoleInput2('');
    setOrgCrossOrg(false);
  };

  // 切换某级的“发起定位角色”：申请人拥有这些角色之一时，审批从本级之后开始（逐级向上提交）
  const handleToggleInitiatorRole = (levelIdx: number, roleCode: string) => {
    const newSteps = steps.map((lv, i) => {
      if (i !== levelIdx) return lv;
      const cur = lv.initiatorRoles || [];
      const next = cur.includes(roleCode) ? cur.filter(r => r !== roleCode) : [...cur, roleCode];
      return { ...lv, initiatorRoles: next };
    });
    onChange(newSteps);
  };

  // 收集当前级别已选的 code 集合
  const getSelectedCodes = (levelIdx: number) => {
    if (!steps[levelIdx]) return { persons: new Set<string>(), groups: new Set<string>(), orgLevels: new Set<string>(), orgs: new Set<string>() };
    const persons = new Set(steps[levelIdx].approvers.filter(a => a.approverType === 'person').map(a => a.approverCode));
    const groups = new Set(steps[levelIdx].approvers.filter(a => a.approverType === 'group').map(a => a.approverCode));
    const orgLevels = new Set(steps[levelIdx].approvers.filter(a => a.approverType === 'orgLevel').map(a => `${a.orgLevel}:${a.roleCode}`));
    const orgs = new Set(steps[levelIdx].approvers.filter(a => a.approverType === 'org').map(a => `${a.orgId}:${a.roleCode}`));
    return { persons, groups, orgLevels, orgs };
  };

  return (
    <div className="bg-white rounded-xl shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <User className="w-5 h-5 text-lime-600" />审批步骤
        </h3>
        <button onClick={handleAddLevel} className="flex items-center gap-1 px-3 py-1.5 bg-lime-600 text-white rounded-lg hover:bg-lime-700 text-sm">
          <Plus className="w-4 h-4" />新建审批级别
        </button>
      </div>

      {/* 级别列表 */}
      {steps.length > 0 ? (
        <div className="space-y-3">
          {steps.map((lv, lvIdx) => {
            const { persons, orgLevels } = getSelectedCodes(lvIdx);
            return (
              <div key={lvIdx} className="border border-lime-200 rounded-lg overflow-hidden">
                {/* 级别头部 */}
                <div className="flex items-center gap-3 px-4 py-2.5 bg-lime-50">
                  <span className="flex items-center justify-center w-7 h-7 rounded-full bg-lime-600 text-white text-xs font-bold">{lv.level}</span>
                  <span className="text-sm font-bold text-lime-700">{getLevelLabel(lvIdx)}</span>
                  <span className="text-xs text-gray-400">{lv.approvers.length} 个审批人</span>
                  <div className="flex-1" />
                  <button onClick={() => setActiveLevel(lvIdx)} className={`px-2 py-0.5 rounded text-xs border transition ${activeLevel === lvIdx ? 'bg-lime-600 text-white border-lime-600' : 'bg-white text-lime-600 border-lime-300 hover:bg-lime-50'}`}>添加审批人</button>
                  <button onClick={() => handleMoveLevelUp(lvIdx)} disabled={lvIdx === 0} className="p-1 text-gray-400 hover:text-lime-600 disabled:opacity-30" title="上移"><ChevronUp className="w-4 h-4" /></button>
                  <button onClick={() => handleMoveLevelDown(lvIdx)} disabled={lvIdx === steps.length - 1} className="p-1 text-gray-400 hover:text-lime-600 disabled:opacity-30" title="下移"><ChevronDown className="w-4 h-4" /></button>
                  <button onClick={() => handleRemoveLevel(lvIdx)} className="p-1 text-gray-400 hover:text-red-600" title="删除级别"><X className="w-4 h-4" /></button>
                </div>

                {/* 当前级别的审批人列表 */}
                {lv.approvers.length > 0 ? (
                  <div className="flex flex-wrap gap-2 px-4 py-2.5 bg-white">
                    {lv.approvers.map((a, aIdx) => (
                      <span key={aIdx} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border bg-gray-50">
                        {a.approverType === 'group' ? <Users className="w-3 h-3 text-purple-500" /> : a.approverType === 'orgLevel' ? <Building2 className="w-3 h-3 text-purple-500" /> : a.approverType === 'org' ? <Building2 className="w-3 h-3 text-indigo-500" /> : <User className="w-3 h-3 text-blue-500" />}
                        <span className="font-medium">{a.approverName}</span>
                        {a.approverType === 'org' && a.crossOrg && <span className="text-indigo-400 text-[10px]">跨组织</span>}
                        {a.approverType === 'person' && a.groupName && <span className="text-gray-400 text-[10px]">{a.approverCode}</span>}
                        <button onClick={() => handleRemoveApprover(lvIdx, aIdx)} className="ml-0.5 text-gray-300 hover:text-red-500"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-3 text-center text-sm text-gray-400 bg-white">点击上方"添加审批人"选择本级别的审批人</div>
                )}

                {/* 发起定位角色：申请人拥有这些角色之一时，本级自动跳过，从下一级开始审批（逐级向上） */}
                <div className="px-4 py-2.5 bg-indigo-50/50 border-t border-indigo-100">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-indigo-700 flex items-center gap-1">
                      <ArrowUpCircle className="w-3.5 h-3.5" />发起定位{lv.initiatorRoles && lv.initiatorRoles.length > 0 ? `（${lv.initiatorRoles.length} 个角色）` : ''}：
                    </span>
                    {(lv.initiatorRoles || []).map(r => {
                      const rl = roles.find(x => x.role_code === r);
                      return (
                        <span key={r} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border border-indigo-200 bg-white text-indigo-700">
                          {rl?.role_name || r}
                          <button onClick={() => handleToggleInitiatorRole(lvIdx, r)} className="text-indigo-300 hover:text-red-500"><X className="w-3 h-3" /></button>
                        </span>
                      );
                    })}
                    <select
                      value=""
                      onChange={e => {
                        if (e.target.value) { handleToggleInitiatorRole(lvIdx, e.target.value); e.target.value = ''; }
                      }}
                      className="px-2 py-0.5 rounded text-xs border border-gray-300 bg-white text-gray-600"
                    >
                      <option value="">+ 添加角色</option>
                      {roles.filter(r => !(lv.initiatorRoles || []).includes(r.role_code)).map(r => (
                        <option key={r.role_id} value={r.role_code}>{r.role_name || r.role_code}</option>
                      ))}
                    </select>
                    <span className="text-[11px] text-gray-400">申请人属该角色时本级跳过、由下一级起审（末级提交则直接通过）</span>
                  </div>
                </div>

                {/* 审批人选择面板（仅当前活跃级别展开） */}
                {activeLevel === lvIdx && (
                  <div className="p-4 bg-gray-50 border-t border-gray-200">
                    {/* 模式切换 */}
                    <div className="flex gap-2 mb-3">
                      <button onClick={() => setPickerMode('person')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition ${pickerMode === 'person' ? 'bg-lime-600 text-white border-lime-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-lime-50'}`}>
                        <User className="w-4 h-4" />按用户选择
                      </button>
                      <button onClick={() => setPickerMode('orgLevel')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition ${pickerMode === 'orgLevel' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-purple-50'}`}>
                        <Building2 className="w-4 h-4" />按组织层选择
                      </button>
                      <button onClick={() => setPickerMode('org')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition ${pickerMode === 'org' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-indigo-50'}`}>
                        <Building2 className="w-4 h-4" />按组织选择
                      </button>
                      <button onClick={() => setActiveLevel(-1)} className="ml-auto px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600">收起</button>
                    </div>

                    {/* 按用户 */}
                    {pickerMode === 'person' && (
                      <>
                        <div className="relative mb-3">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input value={searchKey} onChange={e => handleSearch(e.target.value)} placeholder="搜索用户代码或姓名..." className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm" autoFocus />
                          {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />}
                        </div>
                        {users.length > 0 && (
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs text-gray-400">共 {users.length} 人，已选 {persons.size} 人</span>
                            <button onClick={() => handleAddAllPersons(lvIdx)} className="flex items-center gap-1 px-3 py-1 bg-lime-50 text-lime-700 border border-lime-300 rounded-lg text-xs hover:bg-lime-100 transition">
                              <CheckCircle2 className="w-3.5 h-3.5" />全选
                            </button>
                          </div>
                        )}
                        <div className="max-h-40 overflow-y-auto grid grid-cols-2 md:grid-cols-3 gap-2">
                          {users.map((u: any) => {
                            const selected = persons.has(u.userCode);
                            return (
                              <button key={u.userCode} onClick={() => handleAddPerson(u, lvIdx)} disabled={selected} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition text-left ${selected ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-white border-gray-300 hover:border-lime-400 hover:bg-lime-50'}`}>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium truncate">{u.userName}</div>
                                  <div className="text-xs text-gray-400 truncate">{u.userCode} | {u.groupName}</div>
                                </div>
                                {selected ? <CheckCircle2 className="w-4 h-4 text-gray-300" /> : <Plus className="w-4 h-4 text-lime-500" />}
                              </button>
                            );
                          })}
                          {users.length === 0 && !loading && <div className="col-span-full text-center text-gray-400 py-4">未找到匹配用户</div>}
                        </div>
                      </>
                    )}

{/* 按组织层 */}
                    {pickerMode === 'orgLevel' && (
                      <>
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="flex-1 min-w-[180px]">
                            <div className="text-xs text-gray-500 mb-1">组织层级（顶层为第 1 层，向下递增）</div>
                            <select value={orgLevelInput} onChange={e => setOrgLevelInput(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                              {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                                <option key={n} value={n}>{`第 ${n} 层`}</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex-1 min-w-[180px]">
                            <div className="text-xs text-gray-500 mb-1">该层审批角色</div>
                            <select value={orgRoleInput} onChange={e => setOrgRoleInput(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                              <option value="">请选择角色</option>
                              {roles.map(r => (
                                <option key={r.role_id} value={String(r.role_id)}>{r.role_name || r.role_code}</option>
                              ))}
                            </select>
                          </div>
                          <button onClick={() => handleAddOrgLevel(lvIdx)} className="flex items-center gap-1 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 transition">
                            <Plus className="w-4 h-4" />添加审批人
                          </button>
                        </div>
                        <p className="mt-3 text-xs text-gray-400 leading-relaxed">
                          按组织层审批：申请人所在的组织链（顶层→门店）中，该「第 N 层」组织内拥有所选角色的成员可审批；
                          仅在申请人同一条组织流中生效，下级组织的成员无权审批上级的单。
                        </p>
                        {orgLevels.size > 0 && (
                          <div className="mt-3">
                            <div className="text-xs text-gray-400 mb-1.5">当前级别已配置 {orgLevels.size} 项组织层审批人</div>
                            <div className="flex flex-wrap gap-2">
                              {steps[lvIdx].approvers.filter(a => a.approverType === 'orgLevel').map((a, ai) => (
                                <span key={ai} className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs border border-purple-200 bg-purple-50 text-purple-700">
                                  <Building2 className="w-3 h-3" />{a.approverName}
                                  <button onClick={() => handleRemoveApprover(lvIdx, steps[lvIdx].approvers.indexOf(a))} className="text-purple-300 hover:text-red-500"><X className="w-3 h-3" /></button>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {roles.length === 0 && <div className="mt-3 text-center text-gray-400 py-2 text-sm">暂无角色数据（需管理员权限）</div>}
                      </>
                    )}

                    {/* 按组织 */}
                    {pickerMode === 'org' && (
                      <>
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="flex-1 min-w-[200px]">
                            <div className="text-xs text-gray-500 mb-1">审批组织</div>
                            {orgsLoading ? (
                              <div className="flex items-center gap-2 text-sm text-gray-400 px-1 py-2"><Loader2 className="w-4 h-4 animate-spin" />组织列表加载中...</div>
                            ) : (
                              <select value={orgInput} onChange={e => setOrgInput(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                                <option value="">请选择组织</option>
                                {orgs.map(o => {
                                  const depth = o.ancestors ? String(o.ancestors).split('/').filter(Boolean).length : 0;
                                  return (
                                    <option key={o.org_id} value={String(o.org_id)}>{`${'　'.repeat(depth)}${o.org_name || ''} (#${o.org_id})`}</option>
                                  );
                                })}
                              </select>
                            )}
                          </div>
                          <div className="flex-1 min-w-[180px]">
                            <div className="text-xs text-gray-500 mb-1">审批角色</div>
                            <select value={orgRoleInput2} onChange={e => setOrgRoleInput2(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                              <option value="">请选择角色</option>
                              {roles.map(r => (
                                <option key={r.role_id} value={String(r.role_id)}>{r.role_name || r.role_code}</option>
                              ))}
                            </select>
                          </div>
                          <label className="flex items-center gap-1.5 pb-2 text-sm text-gray-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={orgCrossOrg}
                              onChange={e => setOrgCrossOrg(e.target.checked)}
                              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            跨组织审批（审批人不限于申请人组织线内，用于总部/职能组织审批）
                          </label>
                          <button onClick={() => handleAddOrg(lvIdx)} className="flex items-center gap-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition">
                            <Plus className="w-4 h-4" />添加审批人
                          </button>
                        </div>
                        <p className="mt-3 text-xs text-gray-400 leading-relaxed">
                          按组织审批：所选组织内拥有所选角色的用户均可审批。默认要求申请人的组织线在所选组织内
                          （适用于上级组织审批下级单据）；勾选「跨组织审批」后不要求申请人组织线，适用于财务总监/老板等
                          不挂在门店组织链上的职能组织。
                        </p>
                        {(() => {
                          const orgApprovers = steps[lvIdx].approvers.filter(a => a.approverType === 'org');
                          return orgApprovers.length > 0 ? (
                            <div className="mt-3">
                              <div className="text-xs text-gray-400 mb-1.5">当前级别已配置 {orgApprovers.length} 项组织审批人</div>
                              <div className="flex flex-wrap gap-2">
                                {orgApprovers.map((a, ai) => (
                                  <span key={ai} className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs border border-indigo-200 bg-indigo-50 text-indigo-700">
                                    <Building2 className="w-3 h-3" />{a.approverName}
                                    <button onClick={() => handleRemoveApprover(lvIdx, steps[lvIdx].approvers.indexOf(a))} className="text-indigo-300 hover:text-red-500"><X className="w-3 h-3" /></button>
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null;
                        })()}
                        {orgs.length === 0 && !orgsLoading && <div className="mt-3 text-center text-gray-400 py-2 text-sm">暂无组织数据（组织树加载失败或无组织数据）</div>}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* 流程预览 */}
          <div className="flex items-center gap-1 text-xs text-gray-400 mt-2 pt-2 border-t">
            <Workflow className="w-3 h-3" />
            {steps.map((lv, i) => (
              <span key={i} className="flex items-center gap-1">
                <span>{getLevelLabel(i)}({lv.approvers.map(a => a.approverName).join('、') || '空'}){lv.initiatorRoles && lv.initiatorRoles.length > 0 ? `[跳过:${lv.initiatorRoles.map(r => { const rl = roles.find(x => x.role_code === r); return rl?.role_name || r; }).join('/')}]` : ''}</span>
                {i < steps.length - 1 && <ChevronRight className="w-3 h-3" />}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-6">
          <p className="text-gray-400 mb-3">点击"新建审批级别"开始配置审批步骤</p>
          <button onClick={handleAddLevel} className="inline-flex items-center gap-1 px-4 py-2 bg-lime-50 text-lime-700 border border-lime-200 rounded-lg hover:bg-lime-100 text-sm">
            <Plus className="w-4 h-4" />新建一级审批
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 条件限定编辑器：限定金额 / 限定预算余额（用户组条件已下线）
// ============================================================
function ConditionEditor({ config, onChange }: {
  config: ConditionConfig | null | undefined;
  onChange: (config: ConditionConfig | null) => void;
}) {
  const currentType = config?.type || '';

  const handleTypeChange = (type: string) => {
    if (!type) { onChange(null); return; }
    if (type === 'amount') {
      onChange({ type: 'amount', minAmount: 0, maxAmount: 0 });
    } else if (type === 'budget') {
      onChange({ type: 'budget', budgetType: 'department', budgetMinRemaining: 0 });
    }
  };

  return (
    <div className="bg-white rounded-xl shadow p-6">
      <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
        <AlertCircle className="w-5 h-5 text-amber-500" />条件限定
      </h3>

      {/* 条件类型选择 */}
      <div className="flex flex-wrap gap-3 mb-4">
        <button onClick={() => handleTypeChange('')} className={`px-4 py-2 rounded-lg text-sm border transition ${!currentType ? 'bg-gray-600 text-white border-gray-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
          无限制
        </button>
        {CONDITION_TYPES.map(ct => {
          const Icon = ct.icon;
          const active = currentType === ct.value;
          return (
            <button key={ct.value} onClick={() => handleTypeChange(ct.value)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm border transition ${active ? 'bg-lime-600 text-white border-lime-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-lime-50'}`}>
              <Icon className="w-4 h-4" />{ct.label}
            </button>
          );
        })}
      </div>

      {/* 限定金额 */}
      {config?.type === 'amount' && (
        <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">最低金额（含）</label>
            <input type="number" value={config.minAmount || 0} onChange={e => onChange({ ...config, minAmount: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="0" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">最高金额（不含）</label>
            <input type="number" value={config.maxAmount || 0} onChange={e => onChange({ ...config, maxAmount: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="0 表示不限" />
            <p className="text-xs text-gray-400 mt-1">0 表示不设上限</p>
          </div>
          <div className="col-span-2 text-sm text-gray-500">
            当报销金额在 <span className="font-medium text-amber-700">¥{config.minAmount || 0}</span> ~ <span className="font-medium text-amber-700">{config.maxAmount ? '¥' + config.maxAmount : '不限'}</span> 时触发此审批流
          </div>
        </div>
      )}

      {/* 历史数据兼容：旧审批流配置了「限定用户组或用户」（功能已下线），编辑时提示但不销毁数据 */}
      {config?.type === 'group_user' && (
        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-500">
          <p className="flex items-center gap-1.5 font-medium text-gray-600">
            <Users className="w-4 h-4" />该审批流使用了已下线的「限定用户组或用户」条件
          </p>
          <p className="mt-1">请在左侧选择「无限制」或其它条件类型以更新此配置；未修改前保存将保留原有限定条件。</p>
        </div>
      )}

      {/* 限定预算余额 */}
      {config?.type === 'budget' && (
        <div className="p-4 bg-purple-50 rounded-lg border border-purple-200 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">预算类型</label>
            <select value={config.budgetType || 'department'} onChange={e => onChange({ ...config, budgetType: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="department">部门预算</option>
              <option value="project">项目预算</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">最低剩余预算余额</label>
            <input type="number" value={config.budgetMinRemaining || 0} onChange={e => onChange({ ...config, budgetMinRemaining: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="0" />
            <p className="text-xs text-gray-400 mt-1">预算余额低于此值时触发此审批流</p>
          </div>
          <div className="col-span-2 text-sm text-gray-500">
            当 <span className="font-medium text-purple-700">{config.budgetType === 'project' ? '项目' : '部门'}</span> 预算余额低于 <span className="font-medium text-purple-700">¥{config.budgetMinRemaining || 0}</span> 时触发此审批流
          </div>
        </div>
      )}

      {!currentType && (
        <p className="text-sm text-gray-400">无条件限制，所有报销单均走此审批流</p>
      )}
    </div>
  );
}

// ============================================================
// 条件限定徽章组件（列表页展示用）
// ============================================================
function ConditionBadge({ config }: { config: ConditionConfig }) {
  if (config.type === 'amount') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded text-xs border border-amber-200">
        <DollarSign className="w-3 h-3" />
        {config.minAmount ? `≥¥${config.minAmount}` : ''} {config.maxAmount ? `且 <¥${config.maxAmount}` : ''}
        {!config.minAmount && !config.maxAmount ? '金额限制' : ''}
      </span>
    );
  }
  if (config.type === 'group_user') {
    const parts: string[] = [];
    if (config.groups?.length) parts.push(`${config.groups.length}个用户组`);
    if (config.users?.length) parts.push(`${config.users.length}个用户`);
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs border border-blue-200">
        <Users className="w-3 h-3" />{parts.join(' + ') || '用户限制'}
      </span>
    );
  }
  if (config.type === 'budget') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs border border-purple-200">
        <Wallet className="w-3 h-3" />余额≥¥{config.budgetMinRemaining || 0}
      </span>
    );
  }
  return <span className="text-gray-400">-</span>;
}

export default ReimbursementApprovalPage;
