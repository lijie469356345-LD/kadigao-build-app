import { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import {
  getOnboardingRecords, getTimeoutLogs, reviewOnboarding, adminOpenOnboarding,
  type OnboardingRecord, type TimeoutLogItem, type OnboardingOptions,
} from '../../api/onboarding';
import { Loader2, QrCode } from 'lucide-react';
import QRCode from 'qrcode';

/**
 * 入职管理 · 阶段二至阶段四（督导 / 管理层 / 行政）
 *  - 督导：本人待初审记录 → 驳回或同意+定级（店铺/职级/薪资方案）
 *  - 管理层（区经/总监）：只读监管（无操作按钮）
 *  - 行政：已定级记录 → 快速建用户（建账号+企微群二维码+伯俊备案+会员注册码），提交确认即「建档完成 = 入职成功」
 *  - 建档完成后信息进入转正管理「待入职」；下发/考核/转正/工牌/企微码/报销均在转正管理处理
 *  - 超时台账：第 3 天预警 / 第 7 天超时的自动记录（考核到期台账在转正管理）
 */
const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending_review: { label: '待督导初审', cls: 'bg-amber-100 text-amber-700' },
  rejected: { label: '入职驳回', cls: 'bg-red-100 text-red-600' },
  graded: { label: '已定级·待建档', cls: 'bg-blue-100 text-blue-700' },
  account_ready: { label: '入职成功（建档完成）', cls: 'bg-green-100 text-green-700' },
  // 以下状态由转正管理接管，仅作历史数据展示（筛选下拉不提供、无操作按钮）
  probation: { label: '转正考核中', cls: 'bg-cyan-100 text-cyan-700' },
  probation_passed: { label: '已转正·待工牌', cls: 'bg-teal-100 text-teal-700' },
  badge_applied: { label: '工牌申请已提交', cls: 'bg-purple-100 text-purple-700' },
  badge_making: { label: '工牌制作中', cls: 'bg-slate-200 text-slate-700' },
  completed: { label: '转正流程全部完成', cls: 'bg-green-100 text-green-700' },
};

// 入职管理页状态筛选：仅入职阶段（建档完成即入职成功，之后状态归转正管理）
const FILTER_STATUSES = ['pending_review', 'rejected', 'graded', 'account_ready'];

const ADMIN_ROLES = ['super_admin', 'data_admin', 'admin_staff', 'hr_staff', 'hr'];
const MGMT_ROLES = ['area_manager', 'ops_director'];

export default function OnboardingManagePage() {
  const { user } = useAuthStore();
  const [records, setRecords] = useState<OnboardingRecord[]>([]);
  const [logs, setLogs] = useState<TimeoutLogItem[]>([]);
  const [options, setOptions] = useState<OnboardingOptions>({ supervisors: [], shops: [], levels: [], salarySchemes: [] });
  const [tab, setTab] = useState<'flow' | 'timeout'>('flow');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<{ type: 'review' | 'admin'; record: OnboardingRecord } | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrPreview, setQrPreview] = useState('');
  const applyUrl = useMemo(() => `${window.location.origin}/onboarding-apply`, []);

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
      const [r, t] = await Promise.all([getOnboardingRecords(statusFilter || undefined), getTimeoutLogs()]);
      setRecords(r.records);
      setLogs(t.logs);
    } catch (e: any) {
      showToast(e?.response?.data?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    import('../../api/onboarding').then((m) => m.getOnboardingOptions()).then(setOptions).catch(() => undefined);
  }, []);

  // 入口小码预览（页面加载即生成，供点击放大/保存）
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(applyUrl, { width: 160, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => { if (alive) setQrPreview(url); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [applyUrl]);

  const filtered = useMemo(() => records, [records]);

  // 当前登录人是否可操作某条记录
  const canOperate = (r: OnboardingRecord) => {
    if (isMgmtOnly) return false;
    if (isSupervisor && !isAdminStaff) return r.supervisorCode === myCode;
    return true; // 行政/管理员可操作
  };

  const renderActions = (r: OnboardingRecord) => {
    if (!canOperate(r)) return <span className="text-xs text-gray-400">只读</span>;
    switch (r.status) {
      case 'pending_review':
        return (
          <button onClick={() => setModal({ type: 'review', record: r })} className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs hover:bg-blue-700">初审</button>
        );
      case 'graded':
        return isAdminStaff
          ? <button onClick={() => setModal({ type: 'admin', record: r })} className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs hover:bg-indigo-700">快速建用户</button>
          : <span className="text-xs text-gray-400">待行政开通</span>;
      case 'account_ready':
        return isAdminStaff
          ? <button onClick={() => setModal({ type: 'admin', record: r })} className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs hover:bg-indigo-700">开通信息</button>
          : <span className="text-xs text-gray-400">已转入转正管理</span>;
      // 以下状态由转正管理接管，本页只读
      case 'probation':
      case 'probation_passed':
      case 'badge_applied':
      case 'badge_making':
      case 'completed':
        return <span className="text-xs text-gray-400">已转入转正管理</span>;
      default:
        return <span className="text-xs text-gray-400">—</span>;
    }
  };

  const btnCls = 'px-4 py-2 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50';
  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30';

  return (
    <Layout title="入职管理" subtitle="新员工入职全流程：录入 → 督导初审(3-7天) → 定级 → 行政建档（建档完成即入职成功）→ 转正管理（下发/考核/工牌/企微码/报销）">
      {toast && <div className="mb-3 p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">{toast}</div>}

      <div className="mb-4 flex items-end gap-2 border-b border-gray-200">
        {([['flow', '入职流程'], ['timeout', '超时台账']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`pb-2 px-4 text-sm font-medium border-b-2 transition-colors ${tab === k ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
        {/* 新员工入职二维码小码：不占整体页面，可点击放大、保存 */}
        <button onClick={() => setQrOpen(true)}
          title="点击放大查看 / 保存新员工入职二维码"
          className="ml-auto mb-1.5 flex items-center gap-2 px-2.5 py-1 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors">
          {qrPreview ? (
            <img src={qrPreview} alt="新员工入职二维码" className="w-12 h-12 rounded-sm" />
          ) : (
            <QrCode className="w-6 h-6 text-blue-600" />
          )}
          <span className="text-xs text-blue-700 font-medium leading-tight text-left">新员工入职<br />二维码</span>
        </button>
      </div>

      {tab === 'flow' && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-600">状态筛选：</span>
            <select className={`${inputCls} w-auto`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">全部状态</option>
              {FILTER_STATUSES.map((k) => <option key={k} value={k}>{STATUS_META[k].label}</option>)}
            </select>
            <span className="ml-auto text-xs text-gray-400">共 {filtered.length} 条</span>
          </div>

          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">暂无入职记录</div>
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
                    <th className="px-4 py-3 font-medium">时效</th>
                    <th className="px-4 py-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const sm = STATUS_META[r.status] || STATUS_META.pending_review;
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
                          {r.reviewTime && <div>初审：{r.reviewTime}</div>}
                          {r.gradeTime && <div>定级：{r.gradeTime}</div>}
                          {r.adminFinishTime && <div>开通：{r.adminFinishTime}</div>}
                          {r.issueTime && (
                            <div>
                              下发：{r.issueTime}
                              {r.probationEnd && <div className="text-teal-600">考核截止：{r.probationEnd}</div>}
                            </div>
                          )}
                          {r.probationConfirmTime && <div>考核确认：{r.probationConfirmTime}</div>}
                          {r.badgeApplyTime && <div>工牌申请：{r.badgeApplyTime}</div>}
                          {(r.adminUserCode || r.adminBojunAccount) && (
                            <div className="text-indigo-500">
                              {r.adminUserCode && <div>后台账号：{r.adminUserCode}</div>}
                              {r.adminBojunAccount && <div>伯俊账号：{r.adminBojunAccount}</div>}
                            </div>
                          )}
                          {!r.reviewTime && !r.gradeTime && !r.adminFinishTime && !r.issueTime && !r.badgeApplyTime && <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {r.status === 'pending_review' ? (
                            <div>
                              <span className={`text-xs font-medium ${(r.daysElapsed ?? 0) >= 7 ? 'text-red-600' : (r.daysElapsed ?? 0) >= 3 ? 'text-amber-600' : 'text-gray-500'}`}>
                                已 {r.daysElapsed ?? 0} 天
                              </span>
                              {r.deadlineDays !== null && r.deadlineDays !== undefined && (
                                <div className="text-xs text-gray-400">剩余 {r.deadlineDays} 天</div>
                              )}
                            </div>
                          ) : r.status === 'probation' ? (
                            <span className="text-xs text-teal-600">考核中</span>
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
        </>
      )}

      {tab === 'timeout' && (
        <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
          {logs.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">暂无超时/到期记录</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left">
                  <th className="px-4 py-3 font-medium">记录时间</th>
                  <th className="px-4 py-3 font-medium">类型</th>
                  <th className="px-4 py-3 font-medium">员工</th>
                  <th className="px-4 py-3 font-medium">申请号</th>
                  <th className="px-4 py-3 font-medium">负责督导</th>
                  <th className="px-4 py-3 font-medium">内容</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t border-gray-100">
                    <td className="px-4 py-3 text-gray-600">{l.warnTime}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${l.warnType === 'day7' ? 'bg-red-100 text-red-600' : l.warnType === 'day3' ? 'bg-amber-100 text-amber-700' : 'bg-teal-100 text-teal-700'}`}>
                        {l.warnTypeLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{l.userName}</td>
                    <td className="px-4 py-3 text-gray-500">{l.applyNo}</td>
                    <td className="px-4 py-3 text-gray-600">{l.supervisorName || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{l.content}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {modal && <ModalShell onClose={() => setModal(null)} title={modalTitle(modal.type, modal.record.userName)}>
        {modal.type === 'review' && <ReviewModal record={modal.record} options={options} onClose={() => setModal(null)} onDone={(msg) => { showToast(msg); setModal(null); load(); }} />}
        {modal.type === 'admin' && <AdminOpenModal record={modal.record} onClose={() => setModal(null)} onDone={(msg) => { showToast(msg); setModal(null); load(); }} />}
      </ModalShell>}

      {qrOpen && <ModalShell onClose={() => setQrOpen(false)} title="新员工入职二维码">
        <QrCodeModal url={applyUrl} onClose={() => setQrOpen(false)} />
      </ModalShell>}
    </Layout>
  );
}

/* ---------- 新员工入职二维码：放大 + 保存 ---------- */
function QrCodeModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState('');
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { width: 800, margin: 2, errorCorrectionLevel: 'M' })
      .then((d) => { if (alive) setDataUrl(d); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [url]);

  return (
    <div className="space-y-4 flex flex-col items-center">
      <div className="p-3 bg-white border border-gray-200 rounded-xl">
        {dataUrl ? (
          <img src={dataUrl} alt="新员工入职二维码" className="w-64 h-64" />
        ) : err ? (
          <div className="w-64 h-64 flex items-center justify-center text-sm text-red-500">二维码生成失败，请刷新重试</div>
        ) : (
          <div className="w-64 h-64 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
        )}
      </div>
      <p className="text-xs text-gray-400 text-center">扫码进入「新员工自主信息录入」页面，提交即发起入职流程</p>
      <p className="text-xs text-gray-500 break-all text-center max-w-full">{url}</p>
      <div className="flex items-center gap-2 pt-1">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">关闭</button>
        {dataUrl ? (
          <a href={dataUrl} download="新员工入职二维码.png"
            className="px-5 py-2 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-700">保存二维码</a>
        ) : (
          <span className="px-5 py-2 rounded-lg text-sm text-white bg-blue-600 opacity-50 cursor-not-allowed">保存二维码</span>
        )}
      </div>
    </div>
  );
}

function modalTitle(type: string, name: string) {
  const map: Record<string, string> = {
    review: `督导初审 · ${name}`,
    admin: `快速建用户 · ${name}`,
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

/* ---------- 督导初审：驳回 / 同意+定级三要素 ---------- */
function ReviewModal({ record, options, onClose, onDone }: {
  record: OnboardingRecord; options: OnboardingOptions; onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [mode, setMode] = useState<'approve' | 'reject'>('approve');
  const [shopId, setShopId] = useState<number | ''>('');
  const [level, setLevel] = useState('');
  const [schemeId, setSchemeId] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-100';

  const submit = async () => {
    setErr('');
    if (mode === 'reject') {
      setBusy(true);
      try {
        const res = await reviewOnboarding(record.id, { action: 'reject', reason: reason || '考核不通过' });
        onDone(res.message);
      } catch (e: any) { setErr(e?.response?.data?.message || '操作失败'); setBusy(false); }
      return;
    }
    if (!shopId) return setErr('请选择绑定入职店铺');
    if (!level) return setErr('请核定入职职级');
    if (!schemeId) return setErr('请选定对应薪资方案');
    setBusy(true);
    try {
      const res = await reviewOnboarding(record.id, { action: 'approve', shopId: Number(shopId), level, salarySchemeId: Number(schemeId) });
      onDone(res.message);
    } catch (e: any) { setErr(e?.response?.data?.message || '操作失败'); setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button onClick={() => setMode('approve')}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${mode === 'approve' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>同意入职（完善定级）</button>
        <button onClick={() => setMode('reject')}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${mode === 'reject' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'}`}>考核不通过（驳回）</button>
      </div>

      {mode === 'approve' ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">绑定入职店铺 <span className="text-red-500">*</span></label>
            <select className={inputCls} value={shopId} onChange={(e) => setShopId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">请选择店铺</option>
              {options.shops.map((s) => <option key={s.orgId} value={s.orgId}>{s.orgName}{s.warehouseType ? `（${s.warehouseType}）` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">核定入职职级 <span className="text-red-500">*</span></label>
            <select className={inputCls} value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">请选择职级</option>
              {['初级', '中级', '高级'].map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">选定对应薪资方案 <span className="text-red-500">*</span></label>
            <select className={inputCls} value={schemeId} onChange={(e) => setSchemeId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">请选择薪资方案</option>
              {options.salarySchemes.map((s) => <option key={s.id} value={s.id}>{s.schemeName}</option>)}
            </select>
            {options.salarySchemes.find((s) => s.id === schemeId)?.schemeDesc && (
              <p className="text-xs text-gray-400 mt-1">{options.salarySchemes.find((s) => s.id === schemeId)?.schemeDesc}</p>
            )}
          </div>
        </div>
      ) : (
        <div>
          <label className="block text-sm text-gray-600 mb-1">驳回原因</label>
          <textarea className={`${inputCls} min-h-20`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="请输入考核不通过的原因（必填，将留存备查）" />
        </div>
      )}

      {err && <div className="text-sm text-red-500">{err}</div>}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600">取消</button>
        <button onClick={submit} disabled={busy}
          className={`px-5 py-2 rounded-lg text-sm text-white ${mode === 'reject' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'} disabled:opacity-50`}>
          {busy ? '提交中...' : mode === 'reject' ? '确认驳回' : '同意入职并提交定级'}
        </button>
      </div>
    </div>
  );
}

/* ---------- 行政快速建用户：一键集成 4 项 ---------- */
// 企微总群二维码（第2项展示）：默认地址由公司提供后在此配置，系统自动获取展示
const DEFAULT_WECOM_GROUP_QR = ''; // TODO: 填入企微总群二维码图片地址（用户提供后配置）

function AdminOpenModal({ record, onClose, onDone }: {
  record: OnboardingRecord; onClose: () => void; onDone: (msg: string) => void;
}) {
  const [adminUserCode, setAdminUserCode] = useState(record.adminUserCode || record.userCode || '');
  const [password, setPassword] = useState('8888');
  const [groupQr, setGroupQr] = useState(record.adminGroupQr || DEFAULT_WECOM_GROUP_QR);
  const [bojunAccount, setBojunAccount] = useState(record.adminBojunAccount || '');
  const [memberCode, setMemberCode] = useState(record.memberCode || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-100';

  const save = async (confirm: boolean) => {
    setErr('');
    if (confirm && !adminUserCode.trim()) return setErr('请填写系统后台账号代码');
    if (confirm && !groupQr.trim()) return setErr('请填写企微总群二维码地址');
    if (confirm && !bojunAccount.trim()) return setErr('请录入并绑定员工伯俊账号');
    if (confirm && !memberCode.trim()) return setErr('请填写会员代码');
    setBusy(true);
    try {
      const res = await adminOpenOnboarding(record.id, {
        adminUserCode: adminUserCode.trim(),
        password,
        groupQr: groupQr.trim(),
        bojunAccount: bojunAccount.trim(),
        memberCode: memberCode.trim(),
        confirm,
      });
      onDone(res.message);
    } catch (e: any) { setErr(e?.response?.data?.message || '操作失败'); setBusy(false); }
  };

  const stepCls = 'flex items-start gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50/60';
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className={stepCls}>
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center shrink-0">1</span>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">创建系统后台用户账号（配置职级、店铺权限）</label>
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} value={adminUserCode} onChange={(e) => setAdminUserCode(e.target.value)} placeholder="账号代码（默认用工号）" />
              <input className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="初始密码" />
            </div>
            <p className="text-xs text-gray-400 mt-1">系统将按定级职级自动匹配角色、绑定入职店铺组织权限；已存在则复用。</p>
          </div>
        </div>

        <div className={stepCls}>
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center shrink-0">2</span>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">展示企微总群二维码（自动获取系统配置地址并展示）</label>
            <input className={inputCls} value={groupQr} onChange={(e) => setGroupQr(e.target.value)} placeholder="企微总群二维码图片地址（默认已自动获取系统地址）" />
            {groupQr.trim() ? (
              <div className="mt-2">
                <img src={groupQr.trim()} alt="企微总群二维码" className="w-36 h-36 rounded-lg border border-gray-200 object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                {!groupQr.trim().startsWith('http') && <p className="text-xs text-amber-500 mt-1">当前值不是图片地址，未展示二维码图片</p>}
              </div>
            ) : (
              <p className="text-xs text-amber-500 mt-1">系统未配置企微总群二维码地址，请粘贴二维码图片地址</p>
            )}
          </div>
        </div>

        <div className={stepCls}>
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center shrink-0">3</span>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">录入并绑定员工伯俊账号（系统备案）</label>
            <input className={inputCls} value={bojunAccount} onChange={(e) => setBojunAccount(e.target.value)} placeholder="员工伯俊系统账号" />
          </div>
        </div>

        <div className={stepCls}>
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center shrink-0">4</span>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">填写会员代码（内购卡登记使用）</label>
            <input className={inputCls} value={memberCode} onChange={(e) => setMemberCode(e.target.value)} placeholder="填写员工会员代码" />
          </div>
        </div>
      </div>

      {record.status === 'account_ready' && (
        <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-100 text-sm text-indigo-700">
          该记录已建档完成、入职成功（{record.adminFinishTime}），信息已进入转正管理「待入职」。可修改四项信息后重新保存；提交确认后保持建档完成状态。
        </div>
      )}

      {err && <div className="text-sm text-red-500">{err}</div>}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600">取消</button>
        <button onClick={() => save(false)} disabled={busy} className="px-4 py-2 rounded-lg border border-blue-300 text-sm text-blue-600 hover:bg-blue-50 disabled:opacity-50">
          {busy ? '保存中...' : '保存开通信息'}
        </button>
        <button onClick={() => save(true)} disabled={busy} className="px-5 py-2 rounded-lg bg-blue-600 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? '提交中...' : '四项全部完成，提交确认'}
        </button>
      </div>
    </div>
  );
}