import { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import {
  getBadgeLedger, submitBadgeMaking, batchSubmitBadgeMaking, getReimburses, financeReview,
  type BadgeLedgerItem, type ReimburseItem,
} from '../../api/onboarding';
import { Loader2 } from 'lucide-react';

/**
 * 工牌制作统计台账 · 阶段七
 *  - 行政：台账中筛选「待制作」记录 → （单个或批量勾选）【提交广告公司制作】→ 输入金额 → 自动生成工牌报销单并流转财务
 *  - 财务：报销单审核/核销 → 核销后整条入职记录自动更新为【入职流程全部完成】
 *  - 行政/财务随时查询统计；支持状态筛选
 */
const BADGE_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: '待制作', cls: 'bg-amber-100 text-amber-700' },
  making: { label: '制作中', cls: 'bg-blue-100 text-blue-700' },
  made: { label: '已制作', cls: 'bg-teal-100 text-teal-700' },
  reimbursed: { label: '已报销', cls: 'bg-green-100 text-green-700' },
};
const RB_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: '待财务审核', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: '已审核待核销', cls: 'bg-blue-100 text-blue-700' },
  settled: { label: '已核销', cls: 'bg-green-100 text-green-700' },
};

export default function OnboardingBadgePage() {
  const { user } = useAuthStore();
  const [tab, setTab] = useState<'ledger' | 'reimburse'>('ledger');
  const [ledStatus, setLedStatus] = useState('');
  const [rbStatus, setRbStatus] = useState('');
  const [ledgers, setLedgers] = useState<BadgeLedgerItem[]>([]);
  const [reimburses, setReimburses] = useState<ReimburseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [makeModal, setMakeModal] = useState<BadgeLedgerItem | null>(null);
  const [checkedIds, setCheckedIds] = useState<number[]>([]);
  const [batchModal, setBatchModal] = useState(false);

  const roleCodes: string[] = (user?.roleCodes || []).filter((c: any) => typeof c === 'string');
  const isAdmin = user?.isAdmin === '是' || roleCodes.includes('super_admin') || roleCodes.includes('data_admin');
  const isFinance = isAdmin || roleCodes.includes('finance') || roleCodes.includes('finance_staff') || roleCodes.includes('cashier');
  const isAdminStaff = isAdmin || roleCodes.includes('admin_staff') || roleCodes.includes('hr_staff') || roleCodes.includes('hr');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, r] = await Promise.all([getBadgeLedger(ledStatus || undefined), getReimburses(rbStatus || undefined)]);
      setLedgers(l.ledgers);
      setReimburses(r.reimburses);
    } catch (e: any) {
      showToast(e?.response?.data?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [ledStatus, rbStatus]);

  useEffect(() => { load(); }, [load]);

  const doFinanceReview = async (id: number, action: 'approve' | 'reject') => {
    const msg = action === 'approve' ? '确认核销该工牌报销单？核销后该员工入职流程即全部完成。' : '确认驳回该报销单？';
    if (!window.confirm(msg)) return;
    try {
      const res = await financeReview(id, { action });
      showToast(res.message);
      load();
    } catch (e: any) {
      showToast(e?.response?.data?.message || '操作失败');
    }
  };

  // 仅「待制作」记录可勾选批量提交，刷新后剔除已失效的勾选
  const toggleCheck = (id: number) => {
    setCheckedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const toggleAllPending = () => {
    const pendings = ledgers.filter((l) => l.status === 'pending').map((l) => l.id);
    const allChecked = pendings.length > 0 && pendings.every((id) => checkedIds.includes(id));
    setCheckedIds(allChecked ? [] : pendings);
  };
  // 加载完成后清洗勾选：只保留仍为待制作且有权限处理的记录
  useEffect(() => {
    setCheckedIds((prev) => prev.filter((id) => {
      const it = ledgers.find((l) => l.id === id);
      return !!it && it.status === 'pending';
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgers]);

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-100';

  return (
    <Layout title="工牌制作统计台账" subtitle="汇总待制作 / 制作中 / 已制作 / 已报销的工牌记录，行政提交制作、财务报销核销，全程留痕可查">
      {toast && <div className="mb-3 p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">{toast}</div>}

      <div className="mb-4 flex gap-2 border-b border-gray-200">
        {([['ledger', '工牌台账'], ['reimburse', '报销单审核']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`pb-2 px-4 text-sm font-medium border-b-2 transition-colors ${tab === k ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'ledger' && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-600">状态筛选：</span>
            <select className={`${inputCls} w-auto`} value={ledStatus} onChange={(e) => setLedStatus(e.target.value)}>
              <option value="">全部</option>
              {Object.entries(BADGE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            {isAdminStaff && (
              <button onClick={toggleAllPending}
                className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${checkedIds.length > 0 ? 'bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
                {checkedIds.length > 0 ? `已选 ${checkedIds.length} 条 · 取消全选` : '全选待制作'}
              </button>
            )}
            {isAdminStaff && checkedIds.length > 0 && (
              <button onClick={() => setBatchModal(true)}
                className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs hover:bg-blue-700">
                批量提交制作（勾选 {checkedIds.length} 条）
              </button>
            )}
            <span className="ml-auto text-xs text-gray-400">共 {ledgers.length} 条</span>
          </div>
          <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
            {loading ? (
              <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
            ) : ledgers.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">暂无工牌记录</div>
            ) : (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-left">
                    {isAdminStaff && <th className="px-4 py-3 font-medium w-10">勾选</th>}
                    <th className="px-4 py-3 font-medium">员工</th>
                    <th className="px-4 py-3 font-medium">工号/申请号</th>
                    <th className="px-4 py-3 font-medium">店铺/职级</th>
                    <th className="px-4 py-3 font-medium">工牌编号</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 font-medium">制作费用</th>
                    <th className="px-4 py-3 font-medium">广告公司</th>
                    <th className="px-4 py-3 font-medium">报销单号</th>
                    <th className="px-4 py-3 font-medium">时间</th>
                    <th className="px-4 py-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgers.map((l) => {
                    const bm = BADGE_STATUS[l.status] || BADGE_STATUS.pending;
                    return (
                      <tr key={l.id} className="border-t border-gray-100 hover:bg-gray-50/60">
                        {isAdminStaff && (
                          <td className="px-4 py-3">
                            <input type="checkbox" className="w-4 h-4 accent-blue-600 cursor-pointer"
                              checked={checkedIds.includes(l.id)} onChange={() => toggleCheck(l.id)}
                              disabled={l.status !== 'pending'}
                              title={l.status === 'pending' ? '勾选可批量提交' : '仅待制作可勾选'} />
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-800">{l.userName}</div>
                          <div className="text-xs text-gray-400">{l.phone || '-'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-gray-600">{l.applyNo}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {l.shopName || '-'}<div className="text-xs text-gray-400">{l.level || ''}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{l.badgeNo || '-'}</td>
                        <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs ${bm.cls}`}>{bm.label}</span></td>
                        <td className="px-4 py-3 text-gray-600">{l.amount != null ? `¥${l.amount}` : '-'}</td>
                        <td className="px-4 py-3 text-gray-600">{l.maker || '-'}</td>
                        <td className="px-4 py-3 text-gray-600">{l.reimburseNo || '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {l.applyTime && <div>申请：{l.applyTime}</div>}
                          {l.submitMakeTime && <div>制作：{l.submitMakeTime}</div>}
                          {l.reimburseTime && <div>核销：{l.reimburseTime}</div>}
                        </td>
                        <td className="px-4 py-3">
                          {l.status === 'pending' && isAdminStaff ? (
                            <button onClick={() => setMakeModal(l)} className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs hover:bg-blue-700">提交广告公司制作</button>
                          ) : l.status === 'making' && isFinance ? (
                            <span className="text-xs text-gray-400">报销单已流转财务</span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'reimburse' && (
        <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
          ) : reimburses.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">暂无工牌报销单</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left">
                  <th className="px-4 py-3 font-medium">报销单号</th>
                  <th className="px-4 py-3 font-medium">员工</th>
                  <th className="px-4 py-3 font-medium">工牌编号</th>
                  <th className="px-4 py-3 font-medium">金额</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">申请时间</th>
                  <th className="px-4 py-3 font-medium">审核人</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {reimburses.map((r) => {
                  const rm = RB_STATUS[r.status] || RB_STATUS.pending;
                  return (
                    <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50/60">
                      <td className="px-4 py-3 text-gray-700 font-medium">{r.reimburseNo}</td>
                      <td className="px-4 py-3">
                        <div className="text-gray-800">{r.userName}</div>
                        <div className="text-xs text-gray-400">{r.applyNo}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{r.badgeNo || '-'}</td>
                      <td className="px-4 py-3 text-gray-600">¥{r.amount}</td>
                      <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs ${rm.cls}`}>{rm.label}</span></td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{r.applyTime}</td>
                      <td className="px-4 py-3 text-gray-600">{r.financeReviewer || '-'}</td>
                      <td className="px-4 py-3">
                        {r.status === 'pending' && isFinance ? (
                          <div className="flex gap-2">
                            <button onClick={() => doFinanceReview(r.id, 'approve')} className="px-3 py-1.5 rounded-md bg-green-600 text-white text-xs hover:bg-green-700">核销</button>
                            <button onClick={() => doFinanceReview(r.id, 'reject')} className="px-3 py-1.5 rounded-md border border-red-300 text-red-600 text-xs hover:bg-red-50">驳回</button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {makeModal && (
        <MakeBadgeModal item={makeModal} onClose={() => setMakeModal(null)}
          onDone={(msg) => { showToast(msg); setMakeModal(null); setCheckedIds([]); load(); }} />
      )}

      {batchModal && (
        <BatchMakeModal items={ledgers.filter((l) => checkedIds.includes(l.id))} onClose={() => setBatchModal(false)}
          onDone={(msg) => { showToast(msg); setBatchModal(false); setCheckedIds([]); load(); }} />
      )}
    </Layout>
  );
}

/* 提交广告公司制作弹窗：填写广告公司与实际费用 → 自动生成报销单 */
function MakeBadgeModal({ item, onClose, onDone }: { item: BadgeLedgerItem; onClose: () => void; onDone: (msg: string) => void }) {
  const [maker, setMaker] = useState('');
  const [amount, setAmount] = useState(item.amount != null ? String(item.amount) : '');
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    if (!maker.trim()) return setErr('请填写广告公司名称');
    setBusy(true);
    try {
      const res = await submitBadgeMaking(item.id, { maker: maker.trim(), amount: amount ? Number(amount) : undefined, remark: remark.trim() });
      onDone(res.message);
    } catch (e: any) { setErr(e?.response?.data?.message || '操作失败'); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-800 mb-4">提交广告公司制作 · {item.userName}</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">广告公司名称 <span className="text-red-500">*</span></label>
            <input className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" value={maker} onChange={(e) => setMaker(e.target.value)} placeholder="如：XX 广告印务" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">工牌制作费用（元）</label>
            <input className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="自动带入申请费用，可按实际调整" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">备注</label>
            <textarea className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm min-h-16" value={remark} onChange={(e) => setRemark(e.target.value)} />
          </div>
          <div className="p-3 rounded-lg bg-gray-50 text-xs text-gray-500">
            提交后将自动生成办公室工牌报销单（关联员工入职信息、工牌制作费用、申请时间），并流转至财务审批节点。
          </div>
          {err && <div className="text-sm text-red-500">{err}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600">取消</button>
            <button onClick={submit} disabled={busy} className="px-5 py-2 rounded-lg bg-blue-600 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? '提交中...' : '确认提交制作'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* 批量提交广告公司制作弹窗：统一广告公司，逐条录入金额 → 自动生成每人工牌报销单并流转财务 */
function BatchMakeModal({ items, onClose, onDone }: { items: BadgeLedgerItem[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [maker, setMaker] = useState('');
  const [amounts, setAmounts] = useState<Record<number, string>>(() => {
    const m: Record<number, string> = {};
    items.forEach((it) => { if (it.amount != null) m[it.id] = String(it.amount); });
    return m;
  });
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const total = items.reduce((s, it) => s + (Number(amounts[it.id]) || 0), 0);
  const submit = async () => {
    setErr('');
    if (!maker.trim()) return setErr('请填写广告公司名称');
    const nums: Record<number, number> = {};
    for (const it of items) {
      const v = Number(amounts[it.id]);
      if (!Number.isFinite(v) || v <= 0) return setErr(`请为「${it.userName}」填写有效的工牌制作费用`);
      nums[it.id] = v;
    }
    setBusy(true);
    try {
      const res = await batchSubmitBadgeMaking({ ids: items.map((it) => it.id), maker: maker.trim(), amounts: nums, remark: remark.trim() });
      onDone(res.message);
    } catch (e: any) { setErr(e?.response?.data?.message || '操作失败'); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-800 px-6 pt-5 pb-3 border-b border-gray-100">批量提交广告公司制作 · 共 {items.length} 条</h3>
        <div className="p-6 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm text-gray-600 mb-1">广告公司名称 <span className="text-red-500">*</span></label>
            <input className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" value={maker} onChange={(e) => setMaker(e.target.value)} placeholder="如：XX 广告印务" />
          </div>
          <div className="border border-gray-200 rounded-lg overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left">
                  <th className="px-3 py-2 font-medium">员工</th>
                  <th className="px-3 py-2 font-medium">工号/申请号</th>
                  <th className="px-3 py-2 font-medium">工牌编号</th>
                  <th className="px-3 py-2 font-medium w-36">制作费用（元）</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      <div className="text-gray-800">{it.userName}</div>
                      <div className="text-xs text-gray-400">{it.shopName || ''}{it.level ? ` / ${it.level}` : ''}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{it.applyNo || '-'}</td>
                    <td className="px-3 py-2 text-gray-600">{it.badgeNo || '-'}</td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" step="0.01" className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                        value={amounts[it.id] ?? ''} onChange={(e) => setAmounts((m) => ({ ...m, [it.id]: e.target.value }))}
                        placeholder="必填" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-sm text-gray-600 mb-1">备注</label>
              <input className="w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="可选" />
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-400">合计金额</div>
              <div className="text-lg font-semibold text-gray-800">¥{total.toFixed(2)}</div>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-gray-50 text-xs text-gray-500">
            提交后将按人为每名员工自动生成工牌报销单（关联入职信息、制作费用、申请时间），并统一流转至财务审批节点。
          </div>
          {err && <div className="text-sm text-red-500">{err}</div>}
        </div>
        <div className="flex justify-end gap-2 px-6 pb-5 border-t border-gray-100 pt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600">取消</button>
          <button onClick={submit} disabled={busy} className="px-5 py-2 rounded-lg bg-blue-600 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? '提交中...' : `确认批量提交（${items.length} 条）并生成报销单`}
          </button>
        </div>
      </div>
    </div>
  );
}