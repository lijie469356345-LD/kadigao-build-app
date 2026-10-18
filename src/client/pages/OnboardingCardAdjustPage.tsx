import { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { getCardAdjusts, markCardAdjustDone, type CardAdjustItem } from '../../api/onboarding';
import { Loader2, Info } from 'lucide-react';

/**
 * 内购卡调整 · 自动生成提醒展示页
 * 仅展示系统自动生成的调整提醒：
 *  - 入职：行政完成快速建用户并提交确认后，自动生成「普卡转内购卡」提醒；
 *  - 离职：离职流程完成后，由离职模块自动写入「内购卡转普卡」提醒。
 * 实际卡类型调整由会员专员在会员系统完成，完成后在本页点「确认已处理」回填状态。
 */
export default function OnboardingCardAdjustPage() {
  const [items, setItems] = useState<CardAdjustItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [remarkDraft, setRemarkDraft] = useState<Record<number, string>>({});

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  // 确认已处理：用户在会员系统完成普卡↔内购卡调整后回填状态
  const doMarkDone = async (it: CardAdjustItem) => {
    if (!window.confirm(`确认「${it.userName}」的内购卡调整已在会员系统处理完成？确认后该提醒标记为已处理。`)) return;
    setConfirmingId(it.id);
    try {
      const remark = (remarkDraft[it.id] || '').trim();
      const res = await markCardAdjustDone(it.id, remark ? { remark } : {});
      showToast(res.message);
      load();
    } catch (e: any) {
      showToast(e?.response?.data?.message || '确认失败');
    } finally {
      setConfirmingId(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getCardAdjusts(statusFilter || undefined);
      setItems(r.adjusts);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-100';

  return (
    <Layout title="内购卡调整" subtitle="自动收集普卡转内购卡（新员工）/ 内购卡转普卡（离职）提醒，由会员专员在会员系统完成调整，本页仅登记展示">
      {toast && <div className="mb-3 p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">{toast}</div>}
      <div className="mb-4 p-4 rounded-xl bg-blue-50 border border-blue-100 text-sm text-blue-700 flex gap-2">
        <Info size={18} className="shrink-0 mt-0.5" />
        <span>调整提醒由系统自动生成：新员工完成入职账号开通后自动登记「普卡转内购卡」；离职流程完成后自动登记「内购卡转普卡」。实际卡类型调整在会员系统执行，本页不做手动新增。</span>
      </div>

      {/* 调整记录列表 */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-800">调整提醒记录</h3>
          <select className={`${inputCls} w-auto`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">全部状态</option>
            <option value="pending">待会员专员处理</option>
            <option value="done">已处理</option>
          </select>
        </div>
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">暂无调整提醒</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left">
                  <th className="px-3 py-2.5 font-medium">员工</th>
                  <th className="px-3 py-2.5 font-medium">手机号</th>
                  <th className="px-3 py-2.5 font-medium">会员代码</th>
                  <th className="px-3 py-2.5 font-medium">类型</th>
                  <th className="px-3 py-2.5 font-medium">说明</th>
                  <th className="px-3 py-2.5 font-medium">提交人</th>
                  <th className="px-3 py-2.5 font-medium">状态</th>
                  <th className="px-3 py-2.5 font-medium">提交时间</th>
                  <th className="px-3 py-2.5 font-medium">处理备注</th>
                  <th className="px-3 py-2.5 font-medium w-28">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-t border-gray-100">
                    <td className="px-3 py-3">
                      <div className="text-gray-800 font-medium">{it.userName}</div>
                      {it.userCode && <div className="text-xs text-gray-400">{it.userCode}</div>}
                    </td>
                    <td className="px-3 py-3 text-gray-600">{it.phone || '-'}</td>
                    <td className="px-3 py-3 text-gray-600">{it.memberCode || '-'}</td>
                    <td className="px-3 py-3 text-gray-600">{it.adjustTypeLabel}</td>
                    <td className="px-3 py-3 text-gray-600 max-w-52 truncate" title={it.reason || ''}>{it.reason || '-'}</td>
                    <td className="px-3 py-3 text-gray-600">{it.submitter || '-'}</td>
                    <td className="px-3 py-3">
                      {it.status === 'pending' ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">待会员专员处理</span>
                      ) : (
                        <div>
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">已处理</span>
                          {it.handleTime && <div className="mt-1 text-xs text-gray-500">{it.handler ? `${it.handler} · ` : ''}{it.handleTime}</div>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-gray-500 text-xs">{it.createTime}</td>
                    <td className="px-3 py-3 text-gray-500 text-xs">
                      {it.status === 'pending' ? (
                        <input
                          className="w-32 px-2 py-1 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-100"
                          placeholder="处理备注（可选）" value={remarkDraft[it.id] || ''}
                          onChange={(e) => setRemarkDraft((m) => ({ ...m, [it.id]: e.target.value }))} />
                      ) : (
                        <span className="text-xs text-gray-400">{it.remark || '-'}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {it.status === 'pending' ? (
                        <button onClick={() => doMarkDone(it)} disabled={confirmingId === it.id}
                          className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs hover:bg-blue-700 disabled:opacity-50">
                          {confirmingId === it.id ? '处理中...' : '确认已处理'}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}