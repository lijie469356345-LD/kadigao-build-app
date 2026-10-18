import { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import {
  getOnboardingRecords, issueOnboarding, confirmProbation, applyBadge,
  type OnboardingRecord,
} from '../../api/onboarding';
import { Loader2 } from 'lucide-react';

/**
 * 转正管理（由原入职管理阶段五/六/七移交而来）
 *  - 员工建档完成（account_ready）即入职成功，信息进入本页「待入职」状态
 *  - 流程：待入职 → 下发（15天转正考核）→ 督导确认转正 → 制作工牌 + 制作企微码 → 工牌台账/报销闭环
 *  - 操作人：督导（本人下发/考核/工牌+企微码申请），行政/管理员（全局）；区经/总监只读
 */
const STATUS_META: Record<string, { label: string; cls: string }> = {
  account_ready: { label: '待入职（建档完成）', cls: 'bg-indigo-100 text-indigo-700' },
  probation: { label: '15天转正考核', cls: 'bg-cyan-100 text-cyan-700' },
  probation_passed: { label: '已转正·待制卡/企微码', cls: 'bg-teal-100 text-teal-700' },
  badge_applied: { label: '工牌+企微码申请已提交', cls: 'bg-purple-100 text-purple-700' },
  badge_making: { label: '工牌制作中', cls: 'bg-slate-200 text-slate-700' },
  completed: { label: '转正流程全部完成', cls: 'bg-green-100 text-green-700' },
};

const ADMIN_ROLES = ['super_admin', 'data_admin', 'admin_staff', 'hr_staff', 'hr'];
const MGMT_ROLES = ['area_manager', 'ops_director'];

export default function RegularizationManagePage() {
  const { user } = useAuthStore();
  const [records, setRecords] = useState<OnboardingRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<{ type: 'probation'; record: OnboardingRecord } | null>(null);

  const roleCodes: string[] = (user?.roleCodes || []).filter((c: any) => typeof c === 'string');
  const isAdmin = user?.isAdmin === '是' || roleCodes.includes('super_admin') || roleCodes.includes('data_admin');
  const isSupervisor = roleCodes.includes('supervisor');
  const isAdminStaff = isAdmin || ADMIN_ROLES.some((r) => roleCodes.includes(r));
  const isMgmtOnly = !isAdminStaff && !isSupervisor && MGMT_ROLES.some((r) => roleCodes.includes(r));
  const myCode = user?.userCode || '';

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getOnboardingRecords(statusFilter || undefined);
      setRecords(r.records);
    } catch (e: any) {
      showToast(e?.response?.data?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  // 当前登录人是否可操作某条记录（督导仅本人记录，行政/管理员全局）
  const canOperate = (r: OnboardingRecord) => {
    if (isMgmtOnly) return false;
    if (isSupervisor && !isAdminStaff) return r.supervisorCode === myCode;
    return true;
  };

  const doIssue = async (r: OnboardingRecord) => {
    if (!window.confirm(`确认下发账号给 ${r.userName}？下发后自动进入 15 天转正考核期（系统自动计时）。`)) return;
    try {
      const res = await issueOnboarding(r.id);
      showToast(res.message);
      load();
    } catch (e: any) {
      showToast(e?.response?.data?.message || '下发失败');
    }
  };

  // 制作工牌+企微码：点击后不跳转，直接将该员工信息转入工牌制作台账（pending 待制作），转正管理流程随即收尾
  const doBadgeApply = async (r: OnboardingRecord) => {
    if (!window.confirm(`确认将 ${r.userName} 转入工牌制作台账？转入后该员工转正管理即完成，可在工牌台账中批量制作+录入金额并自动生成报销单。`)) return;
    try {
      const res = await applyBadge(r.id, {});
      showToast(res.message);
      load();
    } catch (e: any) {
      showToast(e?.response?.data?.message || '转人工牌台账失败');
    }
  };

  const renderActions = (r: OnboardingRecord) => {
    if (!canOperate(r)) return <span className="text-xs text-gray-400">只读</span>;
    switch (r.status) {
      case 'account_ready':
        return <button onClick={() => doIssue(r)} className="px-3 py-1.5 rounded-md bg-cyan-600 text-white text-xs hover:bg-cyan-700">下发账号（进入15天考核）</button>;
      case 'probation':
        return <button onClick={() => setModal({ type: 'probation', record: r })} className="px-3 py-1.5 rounded-md bg-teal-600 text-white text-xs hover:bg-teal-700">考核确认</button>;
      case 'probation_passed':
        return <button onClick={() => doBadgeApply(r)} className="px-3 py-1.5 rounded-md bg-purple-600 text-white text-xs hover:bg-purple-700">制作工牌+企微码</button>;
      default:
        return <span className="text-xs text-gray-400">—</span>;
    }
  };

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30';

  const filtered = useMemo(() => records, [records]);

  return (
    <Layout title="转正管理" subtitle="员工转正全流程：建档入职成功后进入待入职 → 下发(15天考核) → 督导确认转正 → 制作工牌/企微码 → 报销闭环">
      {toast && <div className="mb-3 p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">{toast}</div>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-600">状态筛选：</span>
        <select className={`${inputCls} w-auto`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">全部状态</option>
          {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <span className="ml-auto text-xs text-gray-400">共 {filtered.length} 条</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">暂无转正记录</div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl shadow-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-left">
                <th className="px-4 py-3 font-medium">工号/申请号</th>
                <th className="px-4 py-3 font-medium">姓名</th>
                <th className="px-4 py-3 font-medium">手机号</th>
                <th className="px-4 py-3 font-medium">负责督导</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">定级信息</th>
                <th className="px-4 py-3 font-medium">流程节点</th>
                <th className="px-4 py-3 font-medium">考核时效</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const sm = STATUS_META[r.status] || STATUS_META.account_ready;
                return (
                  <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50/60 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800">{r.userCode}</div>
                      <div className="text-xs text-gray-400">{r.applyNo}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-800">{r.userName}</div>
                      <div className="text-xs text-gray-400">{r.gender || '-'}{r.education ? ` / ${r.education}` : ''}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{r.phone}</td>
                    <td className="px-4 py-3 text-gray-600">{r.supervisorName || r.supervisorCode || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${sm.cls}`}>{sm.label}</span>
                      {r.rejectReason && <div className="text-xs text-red-500 mt-1" title={r.rejectReason}>{r.rejectReason.slice(0, 18)}{r.rejectReason.length > 18 ? '…' : ''}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {r.shopName && <div>{r.shopName}</div>}
                      {r.level && <div className="text-xs text-gray-400">职级：{r.level}</div>}
                      {r.salarySchemeName && <div className="text-xs text-gray-400">薪资：{r.salarySchemeName}</div>}
                      {!r.shopName && <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {r.adminFinishTime && <div>建档：{r.adminFinishTime}</div>}
                      {r.issueTime && <div>下发：{r.issueTime}</div>}
                      {r.probationConfirmTime && <div>转正确认：{r.probationConfirmTime}</div>}
                      {r.badgeApplyTime && <div>工牌/企微码申请：{r.badgeApplyTime}</div>}
                      {r.wecomQr && <div className="text-purple-600">企微码：{r.wecomQr.length > 30 ? r.wecomQr.slice(0, 30) + '…' : r.wecomQr}</div>}
                      {!r.adminFinishTime && !r.issueTime && !r.probationConfirmTime && !r.badgeApplyTime && !r.wecomQr && <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {r.status === 'probation' ? (
                        <div>
                          <span className="text-xs text-teal-600">考核中</span>
                          {r.probationEnd && <div className="text-xs text-gray-400">截止 {r.probationEnd}</div>}
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{renderActions(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && <ModalShell onClose={() => setModal(null)} title={modalTitle(modal.type, modal.record.userName)}>
        {modal.type === 'probation' && <ProbationModal record={modal.record} onClose={() => setModal(null)} onDone={(msg) => { showToast(msg); setModal(null); load(); }} />}
      </ModalShell>}
    </Layout>
  );
}

function modalTitle(type: string, name: string) {
  const map: Record<string, string> = {
    probation: `15天转正考核确认 · ${name}`,
  };
  return map[type] || '';
}

function ModalShell({ children, title, onClose }: { children: React.ReactNode; title: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

/* ---------- 15 天转正考核确认 ---------- */
function ProbationModal({ record, onClose, onDone }: {
  record: OnboardingRecord; onClose: () => void; onDone: (msg: string) => void;
}) {
  const [result, setResult] = useState<'pass' | 'fail'>('pass');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    if (result === 'fail' && !reason.trim()) return setErr('请填写考核不通过原因');
    setBusy(true);
    try {
      const res = await confirmProbation(record.id, { result, reason: reason || '' });
      onDone(res.message);
    } catch (e: any) { setErr(e?.response?.data?.message || '操作失败'); setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div className="p-3 rounded-lg bg-cyan-50 border border-cyan-100 text-sm text-cyan-800">
        考核期：{record.issueTime || '—'} 起，截止 {record.probationEnd || '—'}。请确认该员工 15 天转正考核结果。
      </div>
      <div className="flex gap-2">
        <button onClick={() => setResult('pass')}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${result === 'pass' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600'}`}>考核合格（同意转正）</button>
        <button onClick={() => setResult('fail')}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${result === 'fail' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'}`}>考核不通过</button>
      </div>
      {result === 'fail' && (
        <div>
          <label className="block text-sm text-gray-600 mb-1">不通过原因</label>
          <textarea className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="必填" />
        </div>
      )}
      {err && <div className="text-sm text-red-500">{err}</div>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600">取消</button>
        <button onClick={submit} disabled={busy}
          className={`px-5 py-2 rounded-lg text-sm text-white ${result === 'fail' ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'} disabled:opacity-50`}>
          {busy ? '提交中...' : result === 'pass' ? '确认转正' : '确认考核不通过'}
        </button>
      </div>
    </div>
  );
}

/* ---------- 转正后：制作工牌 + 企微码 — 已改由「工牌制作台账」页统一处理，点击转正管理页按钮直接进入台账 ---------- */