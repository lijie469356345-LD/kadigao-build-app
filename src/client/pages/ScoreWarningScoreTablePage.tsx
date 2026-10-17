import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import Layout from '../components/Layout';
import {
  SCORE_FORM, FULL_SCORE, emptyScores, calcTotal, clampScore, itemKey,
  buildRectification, buildRectificationMessage,
} from '../../utils/scoreForm';
import {
  getStoreScoreRecords, getStoreScoreRecord, createStoreScoreRecord,
  updateStoreScoreRecord, deleteStoreScoreRecord, pushStoreRectification,
  getWechatRecipientOptions, searchWechatRecipients,
  StoreScoreHeader, WechatRecipientUser,
  getShopOptions, ShopOption,
} from '../../api/storeScoreRecords';
import { Send, Save, RotateCcw, Trash2, Loader2, X, RefreshCw } from 'lucide-react';

interface Header {
  shopName: string;
  address: string;
  supervisor: string;
  staffCount: string;
  evalMonth: string;
  evaluator: string;
}

function todayMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function barColor(pct: number): string {
  if (pct >= 85) return 'bg-green-500';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-red-500';
}

function ScoreWarningScoreTablePage() {
  const { user } = useAuthStore();
  const [header, setHeader] = useState<Header>({
    shopName: '', address: '', supervisor: '', staffCount: '',
    evalMonth: todayMonth(), evaluator: user?.userName || user?.name || '',
  });
  const [scores, setScores] = useState<Record<string, number>>(emptyScores());
  const [records, setRecords] = useState<StoreScoreHeader[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  // 店铺筛选（相互影响联动）：全部 本区 本店 仓库 区经 经销商 督导
  const [shopOptions, setShopOptions] = useState<ShopOption[]>([]);
  const [filters, setFilters] = useState({
    warehouse: '', area: '', districtManager: '', dealer: '', supervisor: '',
  });

  // 企微推送弹窗状态
  const [pushOpen, setPushOpen] = useState(false);
  const [groups, setGroups] = useState<string[]>([]);
  const [group, setGroup] = useState('');
  const [keyword, setKeyword] = useState('');
  const [users, setUsers] = useState<WechatRecipientUser[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState('');

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }, []);

  const total = useMemo(() => calcTotal(scores), [scores]);
  const rectification = useMemo(() => buildRectification(scores), [scores]);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      setRecords(await getStoreScoreRecords(user?.groupName || ''));
    } catch (e) {
      console.error(e);
      showToast('加载历史记录失败');
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  // 加载店仓全店铺（名称/地址/筛选维度）
  useEffect(() => {
    getShopOptions(user?.groupName || '')
      .then((list) => setShopOptions(list || []))
      .catch((e) => { console.error(e); showToast('加载店铺列表失败'); });
  }, [showToast]);

  // 按一组筛选条件过滤店铺
  const applyFilters = (list: ShopOption[], f: Partial<typeof filters>) => list.filter((s) =>
    (!f.warehouse || s.warehouse === f.warehouse) &&
    (!f.area || s.area === f.area) &&
    (!f.districtManager || s.districtManager === f.districtManager) &&
    (!f.dealer || s.dealer === f.dealer) &&
    (!f.supervisor || s.supervisor === f.supervisor)
  );

  // 相互影响：某维度可选项 = 在“忽略该维度、应用其余维度筛选”的店铺里取去重值
  const dimOptions = (dim: keyof typeof filters) =>
    Array.from(new Set(
      applyFilters(shopOptions, { ...filters, [dim]: '' })
        .map((s) => String(s[dim] || ''))
        .filter(Boolean)
    )).sort();

  // 店铺下拉候选：应用全部已选筛选
  const filteredShops = useMemo(() => applyFilters(shopOptions, filters), [shopOptions, filters]);

  // 店铺下拉：始终包含当前已选择项，避免载入历史记录时丢失
  const shopSelectOptions = useMemo(() => {
    if (!header.shopName || filteredShops.some((s) => s.shopName === header.shopName)) return filteredShops;
    return [{ shopName: header.shopName } as ShopOption, ...filteredShops];
  }, [filteredShops, header.shopName]);

  const selectShop = (name: string) => {
    const shop = shopOptions.find((s) => s.shopName === name);
    setHeader((h) => ({ ...h, shopName: name, address: shop?.address || '', supervisor: shop?.supervisor || '' }));
  };

  const setFilter = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));

  const updateHeader = (k: keyof Header, v: string) => setHeader((h) => ({ ...h, [k]: v }));

  const onScore = (pi: number, si: number, ii: number, val: string) => {
    const k = itemKey(pi, si, ii);
    const full = SCORE_FORM[pi].sections[si].items[ii].full;
    const num = val === '' ? 0 : Number(val);
    setScores((old) => ({ ...old, [k]: clampScore(Number.isNaN(num) ? 0 : num, full) }));
  };

  const setAllScores = (map: Record<string, number>) => {
    const base = emptyScores();
    for (const k of Object.keys(base)) {
      const full = findFull(k);
      base[k] = clampScore(map[k], full);
    }
    setScores(base);
  };

  const findFull = (k: string): number => {
    const [pi, si, ii] = k.split('-').map(Number);
    try { return SCORE_FORM[pi].sections[si].items[ii].full; } catch { return 0; }
  };

  const resetForm = () => {
    setHeader({ shopName: '', address: '', supervisor: '', staffCount: '', evalMonth: todayMonth(), evaluator: user?.userName || user?.name || '' });
    setScores(emptyScores());
    setSelectedId(null);
  };

  const selectRecord = async (id: number) => {
    try {
      const full = await getStoreScoreRecord(id, user?.groupName || '');
      setHeader({
        shopName: full.shopName || '', address: full.address || '', supervisor: full.supervisor || '',
        staffCount: full.staffCount || '', evalMonth: full.evalMonth || todayMonth(), evaluator: full.evaluator || '',
      });
      setAllScores(full.scores || {});
      setSelectedId(id);
    } catch (e) {
      console.error(e);
      showToast('载入记录失败');
    }
  };

  const buildPayload = () => ({
    shopName: header.shopName, address: header.address, supervisor: header.supervisor,
    staffCount: header.staffCount, evalMonth: header.evalMonth, evaluator: header.evaluator,
    fullScore: FULL_SCORE, totalScore: total, scores, rectification,
  });

  const handleSubmit = async (mode: 'new' | 'update') => {
    if (!header.shopName) { showToast('请填写店铺名称'); return; }
    if (!header.evalMonth) { showToast('请填写评估月份'); return; }
    setSaving(true);
    const payload = buildPayload();
    try {
      if (mode === 'new') {
        const r = await createStoreScoreRecord(payload);
        showToast('提交成功，分数已清零');
        setSelectedId(null);
        setScores(emptyScores());
        setHeader((h) => ({ ...h, shopName: '', address: '', supervisor: '', staffCount: '' }));
      } else if (selectedId != null) {
        await updateStoreScoreRecord(selectedId, payload);
        showToast('已更新评分');
        setSelectedId(null);
        setScores(emptyScores());
        setHeader((h) => ({ ...h, shopName: '', address: '', supervisor: '', staffCount: '' }));
      }
      await loadRecords();
    } catch (e) {
      console.error(e);
      showToast('保存失败');
    }
    setSaving(false);
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('确认删除该条提交记录？')) return;
    try {
      await deleteStoreScoreRecord(id);
      if (selectedId === id) { setSelectedId(null); setScores(emptyScores()); }
      loadRecords();
      showToast('已删除');
    } catch (e) {
      console.error(e);
      showToast('删除失败');
    }
  };

  const doSearch = async (g?: string, kw?: string) => {
    setSearching(true);
    try {
      const res = await searchWechatRecipients({ groupName: g || undefined, keyword: (kw ?? keyword) || undefined });
      setUsers(res.withWechat || []);
    } catch (e) {
      console.error(e);
      setUsers([]);
    }
    setSearching(false);
  };

  const openPushModal = async () => {
    if (selectedId == null) { showToast('请先提交并选中对应的提交记录后再推送'); return; }
    if (rectification.blocks.length === 0) { showToast('当前无扣分项，无需推送'); return; }
    setPushResult('');
    setSelected(new Set());
    setKeyword('');
    setGroup('');
    setUsers([]);
    setPushOpen(true);
    try {
      const opts = await getWechatRecipientOptions();
      setGroups(opts.groups || []);
      doSearch('', '');
    } catch (e) {
      console.error(e);
    }
  };

  const canPush = selectedId != null && rectification.blocks.length > 0;

  const toggleUser = (account: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(account)) next.delete(account); else next.add(account);
      return next;
    });
  };

  const doPush = async () => {
    if (selected.size === 0) { showToast('请选择接收人'); return; }
    setPushing(true);
    setPushResult('');
    try {
      const message = buildRectificationMessage({
        shopName: header.shopName, evalMonth: header.evalMonth, evaluator: header.evaluator,
      }, scores);
      const recipients = users.filter((u) => selected.has(u.wechatAccount)).map((u) => ({ name: u.userName || u.wechatAccount, wechatAccount: u.wechatAccount }));
      const res = await pushStoreRectification(message, recipients);
      let text = res.summary || '推送完成';
      const fails = (res.detail || []).filter((d: any) => !d.success);
      if (fails.length) text += '\n失败：' + fails.map((d: any) => `${d.recipient}（${(d.error || 'unknown').split('\n')[0]}）`).join('、');
      setPushResult(text);
    } catch (e: any) {
      console.error(e);
      setPushResult('推送失败：' + (e?.response?.data?.message || e?.message || '未知错误'));
    }
    setPushing(false);
  };

  const inputCls = 'w-full border rounded-lg px-2 py-1 text-sm';
  return (
    <Layout title="店铺检查打分表" subtitle="店铺优化评估表（巡店）">
      <div className="p-3 md:p-6 max-w-[1100px] mx-auto">
        {/* 顶部信息 + 总分 */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          {/* 联动筛选（各维度可选项相互影响） */}
          <div className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b">
            <span className="text-xs text-gray-400 mr-1">筛选店铺：</span>
            <FilterSelect label="本区" value={filters.area} options={dimOptions('area')} onChange={(v) => setFilter('area', v)} />
            <FilterSelect label="仓库" value={filters.warehouse} options={dimOptions('warehouse')} onChange={(v) => setFilter('warehouse', v)} />
            <FilterSelect label="区经" value={filters.districtManager} options={dimOptions('districtManager')} onChange={(v) => setFilter('districtManager', v)} />
            <FilterSelect label="经销商" value={filters.dealer} options={dimOptions('dealer')} onChange={(v) => setFilter('dealer', v)} />
            <FilterSelect label="督导" value={filters.supervisor} options={dimOptions('supervisor')} onChange={(v) => setFilter('supervisor', v)} />
            {(filters.warehouse || filters.area || filters.districtManager || filters.dealer || filters.supervisor) && (
              <button onClick={() => setFilters({ warehouse: '', area: '', districtManager: '', dealer: '', supervisor: '' })}
                className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-500">
                全部
              </button>
            )}
            <span className="text-xs text-gray-400 ml-auto">命中 {filteredShops.length} 家店铺</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Field label="店铺名称（必填）">
              <select value={header.shopName} onChange={(e) => selectShop(e.target.value)} className={inputCls}>
                <option value="">请选择店铺</option>
                {shopSelectOptions.map((s) => <option key={s.shopName} value={s.shopName}>{s.shopName}</option>)}
              </select>
            </Field>
            <Field label="地址">
              <input value={header.address} readOnly placeholder="自动带出" className={inputCls + ' bg-gray-50 text-gray-500'} />
            </Field>
            <Field label="督导">
              <input value={header.supervisor} readOnly placeholder="自动带出" className={inputCls + ' bg-gray-50 text-gray-500'} />
            </Field>
            <Field label="店铺人数"><input value={header.staffCount} onChange={(e) => updateHeader('staffCount', e.target.value)} className={inputCls} /></Field>
            <Field label="评估月份"><input type="month" value={header.evalMonth} onChange={(e) => updateHeader('evalMonth', e.target.value)} className={inputCls} /></Field>
            <Field label="评估人员"><input value={header.evaluator} onChange={(e) => updateHeader('evaluator', e.target.value)} className={inputCls} /></Field>
          </div>

          <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t">
            <div>
              <div className="text-sm text-gray-500">总得分</div>
              <div className="text-3xl font-bold text-amber-600">{total}<span className="text-base text-gray-400">/{FULL_SCORE}</span></div>
            </div>
            <div>
              <div className="text-sm text-gray-500">得分率</div>
              <div className="flex items-center gap-2">
                <div className="w-32 h-3 bg-gray-200 rounded-full overflow-hidden">
                  <div className={`h-full ${barColor(rectification.scorePct)}`} style={{ width: rectification.scorePct + '%' }}></div>
                </div>
                <span className="text-sm">{rectification.scorePct}%</span>
              </div>
            </div>
            <div className="text-sm text-red-600">扣分项：{rectification.blocks.length} 项 · 共扣 {rectification.deductionTotal} 分</div>
            <div className="ml-auto flex flex-wrap gap-2">
              {selectedId != null && (
                <button onClick={resetForm} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-gray-200 text-gray-700 hover:bg-gray-300">
                  <Save className="w-4 h-4" /> 新建
                </button>
              )}
              <button onClick={() => handleSubmit('update')} disabled={saving || selectedId == null}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 保存修改
              </button>
              <button onClick={() => handleSubmit('new')} disabled={saving}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 提交
              </button>
              <button onClick={resetForm} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-gray-200 text-gray-700 hover:bg-gray-300">
                <RotateCcw className="w-4 h-4" /> 重置
              </button>
              <button onClick={openPushModal} disabled={!canPush}
                title={selectedId == null ? '请先提交并选中对应的提交记录' : '推送当前选中记录的整改报告'}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-green-500 text-white hover:bg-green-600 disabled:bg-gray-300 disabled:text-gray-500 disabled:hover:bg-gray-300 disabled:cursor-not-allowed">
                <Send className="w-4 h-4" /> 生成整改并推送
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-4">
          {/* 打分表 */}
          <div className="flex-1 min-w-0 space-y-4 overflow-x-auto"><div className="min-w-[560px]">
            {SCORE_FORM.map((project, pi) => (
              <div key={pi} className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 bg-amber-50 text-amber-700 font-semibold border-b">{project.name}</div>
                {project.sections.map((section, si) => (
                  <div key={si} className="border-b last:border-0">
                    <div className="px-4 py-2 text-sm font-medium text-gray-500 bg-gray-50">{section.name}</div>
                    {section.items.map((it, ii) => {
                      const k = itemKey(pi, si, ii);
                      const val = scores[k] ?? 0;
                      return (
                        <div key={k} className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b last:border-0">
                          <div className="flex-1 min-w-0 text-[13px] leading-snug break-words">
                            {ii + 1}、{it.content}
                            <span className="text-xs text-gray-400 ml-1">（满分 {it.full}）</span>
                          </div>
                          <input
                            type="number" min={0} max={it.full}
                            value={val === 0 ? '' : val}
                            onChange={(e) => onScore(pi, si, ii, e.target.value)}
                            placeholder="0"
                            className="w-16 sm:w-20 h-10 shrink-0 border rounded-lg px-1 text-center text-base"
                          />
                          <span className="text-xs text-gray-400 shrink-0 w-7">/{it.full}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
              </div>
          </div>

          {/* 历史记录 */}
          <div className="w-80 hidden lg:block shrink-0">
            <div className="bg-white rounded-xl shadow-sm p-4 sticky top-24">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-700">提交记录</h3>
                <button onClick={loadRecords} className="text-amber-600 hover:text-amber-700 p-1" title="刷新"><RefreshCw className="w-4 h-4" /></button>
              </div>
              {loading ? (
                <div className="text-center text-gray-400 py-6"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
              ) : records.length === 0 ? (
                <div className="text-center text-gray-400 py-6 text-sm">暂无记录</div>
              ) : (
                <ul className="space-y-2 max-h-[60vh] overflow-auto">
                  {records.map((r) => (
                    <li key={r.id} onClick={() => selectRecord(r.id)}
                      className={`p-2 rounded-lg border cursor-pointer transition ${selectedId === r.id ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-medium text-sm truncate">{r.shopName || '未命名'}</span>
                        <span className="text-xs text-gray-400 shrink-0">{r.evalMonth}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        得分 {r.totalScore}/{r.fullScore} · {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ''}
                      </div>
                      <div className="flex items-center justify-end mt-1">
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
                          className="text-red-500 hover:text-red-600 text-xs flex items-center gap-0.5">
                          <Trash2 className="w-3 h-3" /> 删
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 接收人多选弹窗 */}
      {pushOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-semibold">选择推送接收人（可多选）</h3>
              <button onClick={() => setPushOpen(false)}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <div className="px-4 py-2 border-b text-xs text-gray-500">
              整改报告将作为企微自定义通知发送给选中用户（仅显示有企微账号的）。
            </div>
            <div className="flex items-center gap-2 px-4 py-2 border-b flex-wrap">
              <select value={group} onChange={(e) => { setGroup(e.target.value); doSearch(e.target.value, undefined); }}
                className="border rounded px-2 py-1 text-sm">
                <option value="">全部用户组</option>
                {groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') doSearch(undefined, keyword); }}
                placeholder="姓名/代码" className="border rounded px-2 py-1 text-sm flex-1" />
              <button onClick={() => doSearch(undefined, keyword)} className="px-3 py-1 rounded bg-amber-500 text-white text-sm">查询</button>
            </div>
            <div className="flex-1 overflow-auto px-2 py-1 min-h-[200px]">
              {searching && (
                <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" /></div>
              )}
              {!searching && users.length === 0 && (
                <div className="text-center text-gray-400 py-8 text-sm">没有带企微账号的用户</div>
              )}
              {!searching &&
                users.map((u) => (
                  <label key={u.wechatAccount} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
                    <input type="checkbox" checked={selected.has(u.wechatAccount)} onChange={() => toggleUser(u.wechatAccount)} />
                    <div className="text-sm truncate">
                      {u.userName} <span className="text-green-600 text-xs">企微：{u.wechatAccount}</span>
                    </div>
                    <div className="text-xs text-gray-400 ml-auto shrink-0">{u.groupName}</div>
                  </label>
                ))
              }
            </div>
            <div className="px-4 py-3 border-t flex items-center justify-between">
              <div className="text-sm text-gray-500">已选 {selected.size} 人</div>
              <div className="flex gap-2">
                <button onClick={() => setPushOpen(false)} disabled={pushing} className="px-3 py-2 rounded bg-gray-200 text-gray-700 text-sm">取消</button>
                <button onClick={doPush} disabled={pushing || selected.size === 0}
                  className="px-3 py-2 rounded bg-green-500 text-white text-sm inline-flex items-center gap-1 disabled:opacity-40">
                  {pushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} 发送
                </button>
              </div>
            </div>
            {pushResult && (
              <div className="px-4 py-3 border-t whitespace-pre-wrap text-sm max-h-32 overflow-auto bg-gray-50 rounded-b-xl">
                {pushResult}
              </div>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50">{toast}</div>
      )}
    </Layout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1 text-xs">
      <span className="text-gray-400">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="border rounded px-2 py-1 text-xs max-w-[8rem]">
        <option value="">全部</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

export default ScoreWarningScoreTablePage;