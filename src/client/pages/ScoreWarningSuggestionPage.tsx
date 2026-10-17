import { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { getShopOptions } from '../../api/storeScoreRecords';
import {
  getSuggestions, getSuggestion, submitSuggestion, postSuggestionMsg, suggestionAction, suggestionSupplement,
  getSuggestionWhoami, uploadSuggestionFiles, Suggestion, SuggestionReply, STATUSES, CATEGORIES,
} from '../../api/suggestions';
import { Plus, X, Loader2, Send, ChevronUp, ImageIcon } from 'lucide-react';

const STYLE: Record<string, string> = {
  待处理: 'bg-amber-100 text-amber-700',
  待补充材料: 'bg-purple-100 text-purple-700', 已办结: 'bg-green-100 text-green-700', 驳回: 'bg-red-100 text-red-700',
};
const FILTERS = ['全部', '待处理', '待补充材料', '已办结', '驳回'];
const REPLY_LABEL: Record<string, string> = { reply: '回复', state: '状态', escalate: '升级', reason: '结论', result: '结果' };

function asHours(s: Suggestion): number | null {
  if (s.status === '已办结' || s.status === '驳回') return null;
  if (!s.createdAt) return null;
  const d = new Date(s.createdAt.replace(/\//g, '-'));
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 3600000);
}

function SuggestionPageRole(user: any): number { const p = String(user?.groupName || (user?.roleNames || []).join('') || ''); if (p.includes('老板')) return 4; if (p.includes('总监')) return 3; if (p.includes('区经')) return 2; if (p.includes('督导')) return 1; return 1; }

export default function ScoreWarningSuggestionPage() {
  const { user } = useAuthStore();
  const [filter, setFilter] = useState('全部');
  const [mine, setMine] = useState(false);
  const [role, setRole] = useState<number>(() => SuggestionPageRole(user));
  const [keyword, setKeyword] = useState('');
  const [kwInput, setKwInput] = useState('');
  const [list, setList] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [detail, setDetail] = useState<{ id: number; data: any } | null>(null);
  const [toast, setToast] = useState('');

  const show = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(''), 2600); }, []);

  const load = useCallback(async (f: string, m: boolean, r: number, kw: string) => {
    setLoading(true);
    const rid = m ? (user?.userCode ? String(user.userCode) : '') : undefined;
    try { setList(await getSuggestions({ status: f === '全部' ? '' : f, reporterId: rid, role: r, viewerName: user?.userName || user?.name || '', viewerId: user?.userCode ? String(user.userCode) : '', groupName: user?.groupName || '', keyword: kw })); }
    catch (e) { console.error(e); show('加载失败'); }
    setLoading(false);
  }, [show, user]);

  useEffect(() => { load(filter, mine, role, keyword); }, [filter, mine, role, keyword, load]);

  // 按登录人姓名自动识别默认层级（督导/区经等）
  useEffect(() => {
    const nm = user?.userName || user?.name || '';
    getSuggestionWhoami(nm).then((r) => { if (r.level > 0) setRole(r.level); }).catch(() => {});
  }, [user]);

  const openDetail = (id: number) => getSuggestion(id).then((data) => setDetail({ id, data })).catch(() => show('加载详情失败'));

  return (
    <Layout title="店铺意见建议" subtitle="意见 / 问题工单闭环">
      <div className="px-3 md:px-6 max-w-[1600px] mx-auto">
        {/* 筛选 */}
        <div className="bg-white rounded-xl shadow-sm px-2 py-2 flex items-center gap-1.5 mb-3 overflow-x-auto whitespace-nowrap snap-x">
          {FILTERS.map((f) => <button key={f} onClick={() => setFilter(f)} className={`shrink-0 whitespace-nowrap px-3 py-1 rounded-full text-sm ${filter === f ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{f}</button>)}
          <input value={kwInput} onChange={(e) => setKwInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setKeyword(kwInput.trim()); }} placeholder="搜索…" className="shrink-0 border rounded-lg px-2 py-1 text-sm w-40" />
          <button onClick={() => { setKeyword(kwInput.trim()); }} className="shrink-0 whitespace-nowrap px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-sm">搜索</button>
          <label className="shrink-0 flex items-center text-sm text-gray-600"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="mr-1" />仅我的</label>
          <select value={role} onChange={(e) => setRole(Number(e.target.value))} className="shrink-0 border rounded px-2 py-1 text-sm">
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{['督导', '区经', '总监', '老板'][n - 1]}</option>)}
          </select>
          <span className="shrink-0 text-xs text-gray-400 whitespace-nowrap">上层(层级&gt;工单)默认看不到</span>
          <button onClick={() => setFormOpen(true)} className="shrink-0 ml-auto whitespace-nowrap px-3 py-1.5 rounded-lg bg-amber-500 text-white text-sm flex items-center gap-1 hover:bg-amber-600"><Plus className="w-4 h-4" /> 新建反馈</button>
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-400"><Loader2 className="w-6 h-6 animate-spin inline" /> 加载中…</div>
        ) : list.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-400">暂无工单</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
            {list.map((s) => {
              const h = asHours(s);
              const ov = h != null && (s.urgent === 1 ? h >= 24 : h >= 48);
              return (
                <div key={s.id} onClick={() => openDetail(s.id)} className="bg-white rounded-xl shadow-sm px-4 py-3 border-l-4 cursor-pointer hover:bg-gray-50"
                  style={{ borderLeftColor: s.urgent === 1 ? '#ef4444' : ov ? '#f59e0b' : '#d1d5db' }}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-gray-400">{s.code}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{s.category}</span>
                    {s.urgent === 1 && <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-600">紧急</span>}
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-50 text-gray-500">{s.mode}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${STYLE[s.status] || 'bg-gray-100'}`}>{s.status}</span>
                    {s.escalateSource === '超时' && <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-600">超时升级</span>}
                    {s.escalateSource === '升级' && <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">手动升级</span>}
                    {ov && <span className="text-xs text-red-500 font-medium">已超时</span>}
                  </div>
                  <div className="mt-1 font-medium text-gray-800">{s.title} <span className="text-xs text-gray-400 ml-1">{s.shopName}</span></div>
                  <div className="text-xs text-gray-400 mt-0.5">提交人 {s.reporterName} · 当前层级 {s.currentLevelName} · {s.createdAt}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {formOpen && <FormModal user={user} onClose={() => setFormOpen(false)} onCreated={() => { setFormOpen(false); load(filter, mine, role, keyword); show('已提交，工单号已生成'); }} />}
      {detail && <DetailModal user={user} role={role} id={detail.id} data={detail.data} onClose={() => setDetail(null)} reload={() => load(filter, mine, role, keyword)} toast={show} />}

      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50">{toast}</div>}
    </Layout>
  );
}

// ============ 新建表单 ============
function FormModal({ user, onClose, onCreated }: any) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('门店运营');
  const [urgent, setUrgent] = useState(false);
  const [content, setContent] = useState('');
  const [mode, setMode] = useState('普通');
  const [identity, setIdentity] = useState('实名');
  const [urls, setUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try { const up = await uploadSuggestionFiles(Array.from(files)); setUrls((p) => [...p, ...up]); }
    catch (e) { console.error(e); }
  };

  const submit = async () => {
    if (!title.trim()) { alert('请填写标题'); return; }
    if (!content.trim()) { alert('请填写内容'); return; }
    setBusy(true);
    try {
      await submitSuggestion({
        title, category, urgent: urgent ? 1 : 0, content, images: urls.join(','),
        mode, identity, shopName: '', // 门店由系统按登录人自动归属，界面不选择/不显示
        reporterId: String(user?.userCode || user?.id || ''),
        reporterName: user?.userName || user?.name || '',
      });
      onCreated('', '');
      onClose();
    } catch (e: any) { alert('提交失败：' + (e?.response?.data?.message || e?.message)); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[92vh] overflow-auto shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b sticky top-0 bg-white">
          <h3 className="font-semibold">新建反馈</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-500" /></button>
        </div>
        <div className="px-4 py-3 space-y-3">
          <div className="text-xs text-gray-400">所属门店已自动按登录信息归属（不显示门店）。</div>
          <Field label="反馈标题 *"><input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border rounded-lg px-2 py-1 text-sm" placeholder="简短概括问题" /></Field>
          <Field label="反馈分类">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border rounded-lg px-2 py-1 text-sm">{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="紧急程度"><select value={urgent ? '紧急' : '普通'} onChange={(e) => setUrgent(e.target.value === '紧急')} className="w-full border rounded-lg px-2 py-1 text-sm"><option>普通</option><option>紧急</option></select></Field>
            <Field label="提交模式"><select value={mode} onChange={(e) => setMode(e.target.value)} className="w-full border rounded-lg px-2 py-1 text-sm"><option>普通上报</option><option value="私密">私密上报</option></select></Field>
          </div>
          <Field label="提交身份"><select value={identity} onChange={(e) => setIdentity(e.target.value)} className="w-full border rounded-lg px-2 py-1 text-sm"><option>实名</option><option value="匿名">匿名</option></select></Field>
          <Field label="反馈内容 *"><textarea value={content} onChange={(e) => setContent(e.target.value)} className="w-full border rounded-lg px-2 py-1 text-sm" rows={4} placeholder="文字描述问题" /></Field>
          <Field label="图片附件（可选，多张）">
            <input type="file" multiple accept="image/*" onChange={(e) => onFiles(e.target.files)} className="w-full text-sm" />
            {urls.length > 0 && <div className="flex flex-wrap gap-2 mt-2">{urls.map((u, i) => <img key={i} src={u} className="w-16 h-16 object-cover rounded border" />)}</div>}
          </Field>
        </div>
        <div className="px-4 py-3 border-t flex justify-end gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-3 py-2 rounded bg-gray-100 text-gray-700 text-sm">取消</button>
          <button onClick={submit} disabled={busy} className="px-4 py-2 rounded bg-amber-500 text-white text-sm flex items-center gap-1 disabled:opacity-40">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} 提交</button>
        </div>
      </div>
    </div>
  );
}

// ============ 详情：操作按钮 + 补充材料 + 独立留言 ============
function DetailModal({ user, role, id, data, onClose, reload, toast }: any) {
  const s: any = data;
  const replies: SuggestionReply[] = data.replies || [];
  const finalized = s.status === '已办结' || s.status === '驳回';
  const isBoss = s.currentLevelName === '老板' || Number(s.currentLevel) >= 4;
  const viewRole = Number(role || 0);
  // 仅当前层级的负责人可操作；提交人/其他层级只可查看与留言
  const isHandler = viewRole === Number(s.currentLevel);
  const escalateLog = (() => { try { return s.escalateLog ? JSON.parse(s.escalateLog) : []; } catch { return []; } })();
  const grow = (e: any) => { const t = e.target; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
  const [msgText, setMsgText] = useState('');
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<{ action: string } | null>(null);
  const [pText, setPText] = useState('');
  const [pImgs, setPImgs] = useState<string[]>([]);
  const [supText, setSupText] = useState('');
  const [supImgs, setSupImgs] = useState<string[]>([]);

  const refresh = async () => { const fresh: any = await getSuggestion(id); data.status = fresh.status; data.currentLevelName = fresh.currentLevelName; data.supplementReq = fresh.supplementReq; data.supplementText = fresh.supplementText; data.supplementImages = fresh.supplementImages; data.replies = fresh.replies; data.rejectReason = fresh.rejectReason; data.escalateReason = fresh.escalateReason; };

  const doAction = async () => {
    setBusy(true);
    try {
      if (prompt!.action === '已办结') { await suggestionAction(id, { action: '已办结' }); toast('已办结'); }
      else if (prompt!.action === '待补充材料') { await suggestionAction(id, { action: '待补充材料', text: pText, images: pImgs.join(',') }); toast('已申请补充材料'); }
      else if (prompt!.action === '驳回') { if (!pText.trim()) { toast('请填写驳回理由'); setBusy(false); return; } await suggestionAction(id, { action: '驳回', text: pText }); toast('已驳回'); }
      else if (prompt!.action === '升级') { await suggestionAction(id, { action: '升级', text: pText, senderName: user?.userName || user?.name || '处理人' }); toast('已升级上一级'); }
      setPrompt(null); setPText(''); setPImgs([]);
      await refresh(); reload();
    } catch (e: any) { toast('操作失败：' + (e?.response?.data?.message || e?.message)); }
    setBusy(false);
  };
  const uploadFor = async (files: FileList | null, isP: boolean) => {
    if (!files || files.length === 0) return;
    const up = await uploadSuggestionFiles(Array.from(files));
    if (isP) setPImgs((p) => [...p, ...up]); else setSupImgs((p) => [...p, ...up]);
  };
  const sendMsg = async () => {
    if (!msgText.trim()) return;
    setBusy(true);
    try { await postSuggestionMsg(id, { text: msgText, senderType: 'handler', senderName: '管理员' }); setMsgText(''); await refresh(); reload(); toast('已留言'); }
    catch (e: any) { toast('留言失败'); } setBusy(false);
  };
  const submitSupplement = async () => {
    if (!supText.trim() && supImgs.length === 0) return;
    setBusy(true);
    try { await suggestionSupplement(id, { text: supText, images: supImgs.join(',') }); setSupText(''); setSupImgs([]); await refresh(); reload(); toast('已补充材料'); }
    catch (e: any) { toast('提交失败'); } setBusy(false);
  };
  const detail = s;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-xl">
        {/* 头部 + ID下方操作按钮 */}
        <div className="px-4 py-3 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold">{s.code}
              <span className={`text-xs px-1.5 py-0.5 rounded ${STYLE[s.status] || ''}`}>{s.status}</span>
              {s.urgent === 1 && <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-600">紧急</span>}
            </div>
            <button onClick={onClose}><X className="w-5 h-5 text-gray-500" /></button>
          </div>
          <p className="text-xs text-gray-500 mt-1">{s.shopName} · {s.mode} · 当前层级 {s.currentLevelName} · 分类 {s.category}</p>
          {s.status === '已办结' && <div className="mt-2 text-xs text-green-600">该工单已办结，仅可留言，不能重复操作。</div>}
          {!finalized && isHandler && isBoss && (
            <div className="flex flex-wrap gap-2 mt-3">
              <button onClick={() => setPrompt({ action: '已办结' })} className="px-3 py-1.5 rounded bg-green-500 text-white text-xs">确认（办结）</button>
              <button onClick={() => setPrompt({ action: '驳回' })} className="px-3 py-1.5 rounded bg-red-500 text-white text-xs">驳回</button>
            </div>
          )}
          {!finalized && isHandler && !isBoss && (
            <div className="flex flex-wrap gap-2 mt-3">
              <button onClick={() => setPrompt({ action: '待补充材料' })} className="px-3 py-1.5 rounded bg-purple-500 text-white text-xs">补充材料</button>
              <button onClick={() => setPrompt({ action: '已办结' })} className="px-3 py-1.5 rounded bg-green-500 text-white text-xs">已办结</button>
              <button onClick={() => setPrompt({ action: '驳回' })} className="px-3 py-1.5 rounded bg-red-500 text-white text-xs">驳回</button>
              <button onClick={() => setPrompt({ action: '升级' })} className="px-3 py-1.5 rounded bg-amber-500 text-white text-xs">升级上一级</button>
            </div>
          )}
          {!isHandler && <div className="mt-2 text-xs text-gray-400">当前由「{s.currentLevelName}」处理，您仅可查看/留言/补充材料。</div>}
          {/* 标题：在操作按钮下方单独展示 */}
          <div className="mt-3 text-base font-medium text-gray-900">{s.title}</div>
          {/* 补充材料区 */}
          {!finalized && (
          <div className="mt-3 rounded bg-purple-50 p-3">
            <div className="text-xs font-medium text-purple-700">待补充材料</div>
            {s.supplementReq ? <div className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">要求：{s.supplementReq}</div> : <div className="text-xs text-gray-400 mt-1">暂无要求</div>}
            <div className="mt-2 flex flex-wrap items-start gap-2">
              <textarea rows={2} value={supText} onChange={(e) => setSupText(e.target.value)} onInput={grow} placeholder="填写补充材料（文本）" className="flex-1 border rounded-lg px-2 py-1 text-sm min-w-[160px] resize-none overflow-hidden" />
              <input type="file" multiple accept="image/*" onChange={(e) => uploadFor(e.target.files, false)} className="text-xs" />
            </div>
            {supImgs.length > 0 && <div className="flex flex-wrap gap-1 mt-1">{supImgs.map((u, i) => <img key={i} src={u} className="w-14 h-14 object-cover border" />)}</div>}
            {s.supplementText && <div className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">已补充：{s.supplementText}</div>}
            {s.supplementImages && <div className="flex flex-wrap gap-1 mt-1">{s.supplementImages.split(',').filter(Boolean).map((u: string, i: number) => <img key={i} src={u} className="w-14 h-14 object-cover border" />)}</div>}
            <button onClick={submitSupplement} disabled={busy} className="mt-2 px-3 py-1 rounded bg-purple-600 text-white text-xs">提交补充</button>
          </div>
          )}
        </div>

        {/* 工单内容 */}
        <div className="px-4 py-3 space-y-3 overflow-auto flex-1">
          <div className="rounded bg-gray-50 p-3 text-sm">
            <div className="text-xs text-gray-400">提交人 {s.reporterName} · {s.createdAt}</div>
            <div className="mt-1 whitespace-pre-wrap">{s.content}</div>
            {s.images && <div className="flex flex-wrap gap-2 mt-2">{s.images.split(',').filter(Boolean).map((u: string, i: number) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} className="w-20 h-20 object-cover rounded border" /></a>)}</div>}
            {s.status === '驳回' && s.rejectReason && <div className="mt-2 text-xs text-red-600">驳回理由：{s.rejectReason}</div>}
            {(escalateLog.length > 0) && (
              <div className="mt-2 text-xs">
                <div className="font-medium text-amber-600 mb-1">升级记录（按次保留，谁&何时&理由）</div>
                <ul className="space-y-1">
                  {escalateLog.map((e: any, i: number) => (
                    <li key={i} className="flex items-center gap-1 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">{e.source === '超时' ? '超时' : '升级'}</span>
                      <span className="text-gray-600">{e.by}</span>
                      <span className="text-gray-400">{e.time}</span>
                      <span className="text-gray-600">→ {['', '督导', '区经', '总监', '老板'][e.to] || e.to}</span>
                      {e.reason && <span className="text-gray-500">：{e.reason}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="text-sm font-medium">留言区（独立）</div>
          {replies.length === 0 ? <div className="text-gray-400 text-sm">暂无留言</div> : replies.map((r: any) => (
            <div key={r.id} className={`flex ${r.senderType === 'submit' ? '' : 'justify-end'}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${r.senderType === 'submit' ? 'bg-gray-100' : 'bg-amber-50'}`}>
                <div className="text-xs flex items-center gap-2"><span className="font-medium">{r.senderName}</span><span className="text-gray-400">{r.replyType} · {r.createdAt}</span></div>
                <div className="mt-0.5 whitespace-pre-wrap">{r.text}</div>
                {r.images && <div className="flex flex-wrap gap-1 mt-1">{r.images.split(',').filter(Boolean).map((u: string, i: number) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} className="w-14 h-14 object-cover border" /></a>)}</div>}
              </div>
            </div>
          ))}

          {/* 留言输入（正文底部独立板块） */}
          <div className="flex items-start gap-2 pt-2">
            <textarea rows={2} value={msgText} onChange={(e) => setMsgText(e.target.value)} onInput={grow} placeholder="留言…" className="flex-1 border rounded-lg px-2 py-1 text-sm resize-none overflow-hidden" />
            <button onClick={sendMsg} disabled={busy} className="px-3 py-2 rounded bg-blue-500 text-white text-sm flex items-center gap-1"><Send className="w-4 h-4" /> 发送留言</button>
          </div>
        </div>
      </div>

      {/* 操作确认弹窗 */}
      {prompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-4 shadow-xl">
            <h3 className="font-semibold mb-2">{prompt.action === '待补充材料' ? '申请补充材料' : prompt.action === '已办结' ? '确认办结此工单？' : prompt.action === '驳回' ? '填写驳回理由' : '填写升级理由'}</h3>
            {prompt.action === '已办结' ? (
              <p className="text-sm text-gray-600">是否已正常完成并结案？</p>
            ) : (
              <>
                <textarea rows={3} value={pText} onChange={(e) => setPText(e.target.value)} onInput={grow} placeholder={prompt.action === '驳回' ? '必填：驳回理由' : prompt.action === '升级' ? '升级理由' : '要求补充材料说明'} className="w-full border rounded-lg px-2 py-1 text-sm resize-none overflow-hidden" />
                {prompt.action === '待补充材料' && <><input type="file" multiple accept="image/*" onChange={(e) => uploadFor(e.target.files, true)} className="text-xs mt-2" />
                {pImgs.length > 0 && <div className="flex flex-wrap gap-1 mt-1">{pImgs.map((u, i) => <img key={i} src={u} className="w-14 h-14 object-cover border" />)}</div>}</>}
              </>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setPrompt(null)} className="px-3 py-2 rounded bg-gray-100 text-gray-700 text-sm">取消</button>
              <button onClick={doAction} disabled={busy} className="px-3 py-2 rounded bg-amber-500 text-white text-sm">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : '确认'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: any) {
  return <div><label className="block text-xs text-gray-400 mb-1">{label}</label>{children}</div>;
}

