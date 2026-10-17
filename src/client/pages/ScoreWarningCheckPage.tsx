import { Fragment, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import {
  getIndicators, createIndicator, updateIndicator, deleteIndicator,
  getStoreOverviewScores, CheckIndicator, StoreOvwRow, DIMENSIONS,
} from '../../api/storeCheck';
import { getShops } from '../../api/shops';
import { useAuthStore } from '../../store/authStore';
import { Plus, Pencil, Trash2, Save, X, Loader2, ChevronDown, ChevronRight } from 'lucide-react';

type Tab = 'indicators' | 'overview' | 'helper';

interface EditState {
  id: number | null;
  dimId: number;
  name: string;
  score: string;
  note: string;
}

interface OverviewRow {
  shopName: string;
  area: string;
  districtManager: string;
  supervisor: string;
  dealer: string;
  manager: string;
  phone: string;
  warehouse: string;
  hasScore: boolean;
  total: number | null;
  full: number | null;
  rectCount: number;
  rectGap: number;
  detail?: { dimId: number; dim: string; name: string; full: number; score: number }[];
}

const DIM_LABEL = ['一', '二', '三', '四', '五'];

function ScoreWarningCheckPage() {
  const { user } = useAuthStore();
  const [tab, setTab] = useState<Tab>('overview');
  const [indicators, setIndicators] = useState<CheckIndicator[]>([]);
  const [shops, setShops] = useState<StoreOvwRow[]>([]);
  const [overview, setOverview] = useState<OverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [toast, setToast] = useState('');

  const show = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ind, arches] = await Promise.all([
        getIndicators(),
        getShops(user?.groupName || undefined), // 与“系统管理·店铺档案”同一数据源/权限过滤，取值保持一致
      ]);
      setIndicators(ind);
      setOverview((arches || []).map((s: any) => ({
        shopName: s.shopName || '', area: s.area || '', districtManager: s.districtManager || '',
        supervisor: s.supervisor || '', dealer: s.dealer || '',
        manager: s.contactPerson || '', phone: s.phone || '', warehouse: s.warehouseType || '',
        hasScore: false, total: null, full: null, rectCount: 0, rectGap: 0,
      } as OverviewRow)));
      setShops((arches || []).map((s: any) => ({
        shopName: s.shopName || '', area: s.area || '', districtManager: s.districtManager || '',
        supervisor: s.supervisor || '', dealer: s.dealer || '',
        manager: s.contactPerson || '', phone: s.phone || '',
      })));
    } catch (e) {
      console.error(e);
      show('加载失败');
    }
    setLoading(false);
  }, [show, user]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const byDim = useMemo(() => DIMENSIONS.map((d) => ({ dim: d, items: indicators.filter((i) => i.dimId === d.id) })), [indicators]);
  const personCols = useMemo(() => indicators.filter((i) => i.dimId === 2).map((i) => i.name), [indicators]);

  const openAdd = () => setEditing({ id: null, dimId: 1, name: '', score: '0', note: '' });
  const openEdit = (i: CheckIndicator) => setEditing({ id: i.id, dimId: i.dimId, name: i.name, score: String(i.score), note: i.note || '' });
  const saveIndicator = async () => {
    if (editing == null) return;
    if (!editing.name.trim()) { show('请填写检测项名称'); return; }
    setSaveBusy(true);
    try {
      const data = { dimId: editing.dimId, name: editing.name.trim(), score: Number(editing.score) || 0, note: editing.note };
      if (editing.id == null) await createIndicator(data);
      else await updateIndicator(editing.id, data);
      setEditing(null);
      show('已保存');
      loadAll();
    } catch (e) { console.error(e); show('保存失败'); }
    setSaveBusy(false);
  };
  const removeIndicator = async (it: CheckIndicator) => {
    if (!window.confirm(`确认删除检测项「${it.name}」？`)) return;
    try { await deleteIndicator(it.id); show('已删除'); loadAll(); }
    catch (e) { console.error(e); show('删除失败'); }
  };

  const tabs: [Tab, string][] = [['overview', '得分总览'], ['helper', '重点帮扶'], ['indicators', '标准检查项']];

  return (
    <Layout title="店铺检测" subtitle="五维度评分框架（100 分 / 36 项）">
      <div className="px-4 md:px-6 max-w-[1100px] mx-auto">
        <div className="flex gap-1 mb-4 bg-white rounded-xl shadow-sm p-1 w-fit">
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 rounded-lg text-sm ${tab === k ? 'bg-amber-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-amber-500" /></div>
        ) : tab === 'indicators' ? (
          <IndicatorsTab
            byDim={byDim} editing={editing} setEditing={setEditing} openAdd={openAdd} openEdit={openEdit}
            saveIndicator={saveIndicator} saveBusy={saveBusy} onDelete={removeIndicator}
          />
        ) : tab === 'overview' ? (
          <OverviewTab rows={overview} groupName={user?.groupName || ''} />
        ) : (
          <HelperTab shops={shops} personCols={personCols} />
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50">{toast}</div>
      )}
    </Layout>
  );
}

// ---------- Tab：检测项标准 ----------
function IndicatorsTab({ byDim, editing, setEditing, openAdd, openEdit, saveIndicator, saveBusy, onDelete }: {
  byDim: { dim: typeof DIMENSIONS[number]; items: CheckIndicator[] }[];
  editing: EditState | null;
  setEditing: (e: EditState | null) => void;
  openAdd: () => void;
  openEdit: (i: CheckIndicator) => void;
  saveIndicator: () => void;
  saveBusy: boolean;
  onDelete: (i: CheckIndicator) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-500">评分项可新增/修改/删除；每项“如何得分”可随时补充维护。</p>
        <button onClick={openAdd} className="px-3 py-2 rounded-lg bg-amber-500 text-white text-sm flex items-center gap-1 hover:bg-amber-600">
          <Plus className="w-4 h-4" /> 新增检测项
        </button>
      </div>

      {byDim.map(({ dim, items }) => {
        const total = items.reduce((s, x) => s + (x.score || 0), 0);
        return (
          <div key={dim.id} className="bg-white rounded-xl shadow-sm mb-3 overflow-hidden">
            <div className="px-4 py-2.5 bg-amber-50 border-b">
              <span className="font-semibold text-gray-800">
                维度{DIM_LABEL[dim.id - 1]}·{dim.name}（{total}/{dim.full} 分 · {items.length} 项）
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 border-b text-left">
                  <th className="px-3 py-2 w-14">序号</th>
                  <th className="px-3 py-2">检测项</th>
                  <th className="px-3 py-2 w-16">分值</th>
                  <th className="px-3 py-2">口径 / 如何得分</th>
                  <th className="px-3 py-2 w-24 text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-400">{it.code || String(i + 1).padStart(2, '0')}</td>
                    <td className="px-3 py-2 font-medium">{it.name}</td>
                    <td className="px-3 py-2 text-center">{it.score}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 max-w-md">{it.note || '—'}</td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      <button onClick={() => openEdit(it)} className="text-amber-600 hover:text-amber-700 mx-1"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => onDelete(it)} className="text-red-400 hover:text-red-600 mx-1"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400 text-xs">该维度暂无检测项</td></tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-semibold">{editing.id == null ? '新增检测项' : '编辑检测项'}</h3>
              <button onClick={() => setEditing(null)}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <div className="px-4 py-3 space-y-3">
              <FieldRow label="维度">
                <select value={editing.dimId} onChange={(e) => setEditing({ ...editing, dimId: Number(e.target.value) })} className="w-full border rounded-lg px-2 py-1 text-sm">
                  {DIMENSIONS.map((d) => <option key={d.id} value={d.id}>维度{d.name}（满分 {d.full}）</option>)}
                </select>
              </FieldRow>
              <FieldRow label="检测项名称">
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="w-full border rounded-lg px-2 py-1 text-sm" placeholder="例：销售目标达成率" />
              </FieldRow>
              <FieldRow label="分值">
                <input type="number" min={0} value={editing.score} onChange={(e) => setEditing({ ...editing, score: e.target.value })} className="w-full border rounded-lg px-2 py-1 text-sm" />
              </FieldRow>
              <FieldRow label="如何得分 / 口径">
                <textarea value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} className="w-full border rounded-lg px-2 py-1 text-sm" rows={3} placeholder="（后期同步每项得分口径，可随时修改）" />
              </FieldRow>
            </div>
            <div className="px-4 py-3 border-t flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-3 py-2 rounded bg-gray-100 text-gray-700 text-sm">取消</button>
              <button onClick={saveIndicator} disabled={saveBusy} className="px-3 py-2 rounded bg-amber-500 text-white text-sm flex items-center gap-1 disabled:opacity-40">
                {saveBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- 总览总表：第一区区域汇总 + 第二区门店明细 ----------
  function OverviewTab({ rows, groupName }: { rows: OverviewRow[]; groupName?: string }) {
  const monthOf = (nn: number) => { const t = new Date(); t.setMonth(t.getMonth() - nn); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; };
  const monthOpts = useMemo(() => Array.from({ length: 12 }, (_x, i) => monthOf(i)), []);
  const [start, setStart] = useState(() => monthOf(0));
  const [end, setEnd] = useState(() => monthOf(0));
  const [detected, setDetected] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [loaded, setLoaded] = useState<OverviewRow[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());

  // 联动筛选：全部 本区 本店 仓库 区经 经销商 督导
  const [f, setF] = useState({ area: '', shopName: '', warehouse: '', districtManager: '', dealer: '', supervisor: '' });

  const shown = (detected && loaded) ? loaded : rows;
  const apply = (list: OverviewRow[], o: Partial<typeof f>) => list.filter((s) =>
    (!o.area || s.area === o.area) && (!o.warehouse || s.warehouse === o.warehouse) &&
    (!o.districtManager || s.districtManager === o.districtManager) &&
    (!o.dealer || s.dealer === o.dealer) && (!o.supervisor || s.supervisor === o.supervisor) &&
    (!o.shopName || s.shopName === o.shopName));
  const dimsOf = (dim: keyof typeof f) => Array.from(new Set(apply(shown, { ...f, [dim]: '' }).map((x) => x[dim] as string).filter(Boolean))).sort();

  const filtered = useMemo(() => apply(shown, f), [shown, f]);

  const doDetect = async () => {
    setDetecting(true); setErr('');
    try {
      // 按检查项标准生成门店检测结果（t 变化即重算）
      const list = await getStoreOverviewScores({ start, end, t: String(Date.now()), groupName });
      const map = new Map(list.map((s) => [s.shopName, s]));
      setLoaded(rows.map((r) => {
        const sc = map.get(r.shopName);
        return { ...r, hasScore: !!sc, total: sc ? Number(sc.total) : null, full: sc ? Number(sc.full) : null,
          rectCount: sc ? Number(sc.rectCount) || 0 : 0, rectGap: sc ? Number(sc.rectGap) || 0 : 0,
          detail: sc ? (sc.detail as any[] || []) : [] };
      }));
      setDetected(true);
    } catch (e) { console.error(e); setErr('获取得分失败'); }
    setDetecting(false);
  };
  const resetOverV = () => { setDetected(false); setLoaded(null); setOpen(new Set()); };

  const toggleDetail = (sn: string) => setOpen((prev) => { const n = new Set(prev); if (n.has(sn)) n.delete(sn); else n.add(sn); return n; });

  // 第一区：按 区域/区经/督导/经销商 分组汇总
  const groups = useMemo(() => {
    const map = new Map<string, OverviewRow[]>();
    for (const x of filtered) {
      const key = `${x.area}||${x.districtManager}||${x.supervisor}||${x.dealer}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(x);
    }
    const arr = Array.from(map.values()).map((children) => {
      const scored = children.filter((c) => c.hasScore);
      const avg = scored.length ? Math.round((scored.reduce((sm, c) => sm + (c.total || 0), 0) / scored.length) * 10) / 10 : null;
      const phone = children.find((c) => c.phone)?.phone || '';
      return {
        area: children[0].area, dm: children[0].districtManager, sup: children[0].supervisor,
        dealer: children[0].dealer, phone, count: children.length,
        avg, grade: avg == null ? null : gradeOf(avg),
        rectCount: children.reduce((sm, c) => sm + c.rectCount, 0),
        rectGap: children.reduce((sm, c) => sm + c.rectGap, 0),
      };
    });
    const withAvg = arr.filter((g) => g.avg != null).sort((a, b) => (b.avg! - a.avg!));
    const rmap = new Map(withAvg.map((g, i) => [gkey(g), i + 1]));
    return arr.map((g) => ({ ...g, rank: g.avg == null ? null : (rmap.get(gkey(g)) || null) }));
  }, [filtered]);

  // —— 排序（第一区/第二区所有字段均可点击排序） ——
  const [sA, setSA] = useState<{ k: string; d: 1 | -1 }>({ k: 'avg', d: -1 });
  const [sB, setSB] = useState<{ k: string; d: 1 | -1 }>({ k: 'total', d: -1 });
  const cmp = (a: any, b: any): number => {
    if (a == null && b == null) return 0;
    if (a == null) return 1; if (b == null) return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), 'zh');
  };
  const sortedGroups = groups.slice().sort((a: any, b: any) => {
    const va = a[sA.k]; const vb = b[sA.k];
    const r = cmp(va, vb); return sA.d * r;
  });
  const sortedRows: any = filtered.slice().sort((a: any, b: any) => {
    const av = sB.k === 'dept' ? a.districtManager + a.supervisor : a[sB.k];
    const bv = sB.k === 'dept' ? b.districtManager + b.supervisor : b[sB.k];
    return sB.d * cmp(av, bv);
  });
  const setS = (which: 'A' | 'B', k: string) => {
    const set = which === 'A' ? setSA : setSB;
    set((prev: any) => prev.k === k ? { k, d: (prev.d === 1 ? -1 : 1) } : { k, d: -1 });
  };
  const arrow = (k: string, cur: { k: string; d: 1 | -1 }) => cur.k === k ? (cur.d === 1 ? ' ▲' : ' ▼') : '';

  const scoreCell = (x: OverviewRow, what: 'total' | 'grade' | 'rect' | 'short') => {
    if (!detected) return <span className="text-gray-300">—</span>;
    if (what === 'total') return <span className="font-medium">{x.hasScore ? x.total : <span className="text-gray-300">—</span>}</span>;
    if (what === 'grade') return x.total != null ? gradeOf(x.total) : <span className="text-gray-300">—</span>;
    if (what === 'rect') return x.hasScore ? <span className="text-red-500">{x.rectCount}项</span> : <span className="text-gray-300">—</span>;
    if (what === 'short') return x.hasScore && x.rectGap > 0 ? <span className="text-red-500 font-medium">{x.rectGap}分</span> : <span className="text-gray-300">{x.hasScore ? '无短板' : '—'}</span>;
    return null;
  };

  return (
    <div className="space-y-4">
      {/* 时间段 + 检测 */}
      <div className="bg-white rounded-xl shadow-sm px-3 py-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">统计时间段：</span>
        <select value={start} onChange={(e) => setStart(e.target.value)} className="border rounded px-2 py-1 text-sm">
          {monthOpts.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="text-xs text-gray-500">至</span>
        <select value={end} onChange={(e) => setEnd(e.target.value)} className="border rounded px-2 py-1 text-sm">
          {monthOpts.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={doDetect} disabled={detecting || start > end}
          className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-sm flex items-center gap-1 hover:bg-amber-600 disabled:opacity-50">
          {detecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />} 确定检测
        </button>
        {detected && <button onClick={resetOverV} className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-sm">重置</button>}
        <span className="text-xs text-gray-400 ml-auto">{detected ? `已检测 ${start} ~ ${end}` : '选择时间段并“确定检测”后展示实际得分'}</span>
        {err && <span className="text-xs text-red-500">{err}</span>}
      </div>

      {/* 联动筛选 */}
      <div className="bg-white rounded-xl shadow-sm px-3 py-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-400">筛选：</span>
        <OvFilter label="本区" value={f.area} options={dimsOf('area')} onChange={(v) => setF({ ...f, area: v })} />
        <OvFilter label="仓库" value={f.warehouse} options={dimsOf('warehouse')} onChange={(v) => setF({ ...f, warehouse: v })} />
        <OvFilter label="区经" value={f.districtManager} options={dimsOf('districtManager')} onChange={(v) => setF({ ...f, districtManager: v })} />
        <OvFilter label="经销商" value={f.dealer} options={dimsOf('dealer')} onChange={(v) => setF({ ...f, dealer: v })} />
        <OvFilter label="督导" value={f.supervisor} options={dimsOf('supervisor')} onChange={(v) => setF({ ...f, supervisor: v })} />
        <select value={f.shopName} onChange={(e) => setF({ ...f, shopName: e.target.value })} className="border rounded px-2 py-1 text-xs max-w-[9rem]">
          <option value="">本店：全部</option>
          {shown.map((x) => <option key={x.shopName} value={x.shopName}>{x.shopName}</option>)}
        </select>
        {(f.area || f.warehouse || f.districtManager || f.dealer || f.supervisor || f.shopName) && (
          <button onClick={() => setF({ area: '', warehouse: '', districtManager: '', dealer: '', supervisor: '', shopName: '' })}
            className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-500">全部</button>
        )}
        <span className="text-xs text-gray-400 ml-auto">命中 {filtered.length} 家门店 / {groups.length} 组</span>
      </div>

      {/* 第一区 ：区域汇总 */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 bg-amber-50 border-b font-semibold text-gray-800">第一区 · 区域汇总</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead><tr className="text-gray-500 border-b bg-gray-50">
              {[['area', '区域'], ['dm', '区经'], ['sup', '督导'], ['dealer', '经销商'], ['phone', '经销商电话'], ['count', '店数'], ['avg', '店均得分'], ['grade', '店均等级'], ['rank', '得分排名'], ['rectCount', '扣分项'], ['rectGap', '短板汇总']].map(([k, l]: any) => (
                <th key={k} onClick={() => setS('A', k)} className="px-2 py-2 text-center border-r last:border-r-0 cursor-pointer select-none hover:text-amber-600">{l}{arrow(k, sA)}</th>
              ))}
            </tr></thead>
            <tbody>
            {sortedGroups.map((g: any, i: number) => (
              <tr key={i} className="border-b hover:bg-gray-50">
                <td className="px-2 py-2">{g.area || '-'}</td><td className="px-2 py-2">{g.dm}</td>
                <td className="px-2 py-2">{g.sup}</td><td className="px-2 py-2">{g.dealer}</td>
                <td className="px-2 py-2">{g.phone || '-'}</td><td className="px-2 py-2">{g.count}</td>
                <td className="px-2 py-2 font-medium">{detected ? (g.avg ?? '-') : <span className="text-gray-300">—</span>}</td>
                <td className="px-2 py-2">{detected ? (g.avg == null ? '-' : g.grade) : <span className="text-gray-300">—</span>}</td>
                <td className="px-2 py-2 text-gray-500">{detected ? (g.rank ?? '-') : <span className="text-gray-300">—</span>}</td>
                <td className="px-2 py-2 text-red-500">{detected ? g.rectCount : <span className="text-gray-300">—</span>}</td>
                <td className="px-2 py-2 text-red-500">{detected ? (g.rectGap ? -g.rectGap : 0) : <span className="text-gray-300">—</span>}</td>
              </tr>
            ))}
            {groups.length === 0 && <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400 text-sm">无分组数据</td></tr>}
          </tbody></table>
        </div>
      </div>

      {/* 第二区：门店明细 */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 bg-gray-50 border-b font-semibold text-gray-700">第二区 · 门店明细（点击行展开检查项）</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead><tr className="text-gray-500 border-b bg-gray-50">
              {[['area', '区域'], ['shopName', '店铺名称'], ['manager', '店长'], ['phone', '店铺电话'], ['dept', '区经·督导'], ['total', '总得分'], ['grade', '等级'], ['rectCount', '扣分项'], ['rectGap', '短板汇总'], ['o', '明细']].map(([k, l]: any) => (
                <th key={k} onClick={() => k !== 'o' && setS('B', k)} className={`px-2 py-2 text-center border-b last:border-r-0 ${k !== 'o' ? 'cursor-pointer select-none hover:text-amber-600' : ''}`}>{l}{k !== 'o' ? arrow(k, sB) : ''}</th>
              ))}
            </tr></thead>
            <tbody>
              {sortedRows.map((x: OverviewRow) => {
                const isOpen = open.has(x.shopName);
                return (
                  <Fragment key={x.shopName}>
                    <tr onClick={() => toggleDetail(x.shopName)} className="border-b hover:bg-gray-50 cursor-pointer">
                      <td className="px-2 py-2">{x.area}</td>
                      <td className="px-2 py-2 font-medium">{x.shopName}</td>
                      <td className="px-2 py-2">{x.manager || '—'}</td>
                      <td className="px-2 py-2">{x.phone}</td>
                      <td className="px-2 py-2">{x.districtManager}·{x.supervisor}</td>
                      <td className="px-2 py-2">{scoreCell(x, 'total')}</td>
                      <td className="px-2 py-2">{scoreCell(x, 'grade')}</td>
                      <td className="px-2 py-2">{scoreCell(x, 'rect')}</td>
                      <td className="px-2 py-2">{scoreCell(x, 'short')}</td>
                      <td className="px-2 py-2 text-amber-600">{isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}明细</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={10} className="px-4 py-3 bg-amber-50/50 border-b">
                          <div className="text-xs font-medium text-gray-600 mb-2">{x.shopName} · 检查项明细（未达标红显）</div>
                          {!x.detail || x.detail.length === 0 ? (
                            <div className="text-gray-400 text-xs">请先"确定检测"后查看检查项明细</div>
                          ) : (
                            <ul className="space-y-1 max-h-56 overflow-auto">
                              {x.detail.map((it, i) => {
                                const bad = it.score < it.full;
                                return (
                                  <li key={i} className={`flex items-center gap-2 text-xs px-2 py-1 bg-white rounded border ${bad ? 'border-red-200' : 'border-gray-100'}`}>
                                    <span className="w-6 shrink-0 text-gray-400">[{it.dim}]</span>
                                    <span className={`flex-1 truncate ${bad ? 'text-red-600' : 'text-gray-600'}`} title={it.name}>{it.name}</span>
                                    <span className="text-gray-300 shrink-0">满分{it.full}·可得{it.score}</span>
                                    {bad && <span className="text-red-500 shrink-0">-{it.full - it.score}分</span>}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400 text-sm">暂无门店</td></tr>}
            </tbody></table>
        </div>
      </div>
    </div>
  );
}

function OvFilter({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1 text-xs">
      <span className="text-gray-400">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded px-2 py-1 text-xs max-w-[7rem]">
        <option value="">全部</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function gradeOf(total: number): string {
  if (total >= 90) return 'S'; if (total >= 80) return 'A'; if (total >= 70) return 'B';
  if (total >= 60) return 'C'; return 'D';
}
function gkey(g: { area: string; dm: string; sup: string; dealer: string }): string {
  return `${g.area}||${g.dm}||${g.sup}||${g.dealer}`;
}

// ---------- 重点帮扶人员（框架） ----------
function HelperTab({ shops, personCols }: { shops: StoreOvwRow[]; personCols: string[] }) {
  const cols = personCols.length ? personCols : ['个人月贡献', '个人目标达成', '个人同比', '个人环比', '个人盈利', '个人连带率', '个人客单价', '个人转化率', '个人会员招募'];
  return (
    <div className="bg-white rounded-xl shadow-sm">
      <div className="px-4 py-3 border-b text-sm text-gray-500">
        重点帮扶人员 —— 按维“人”各项实际得分取倒数 50 名（当前为框架）
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="text-gray-500 border-b bg-gray-50">
              {['区域', '区经', '督导', '经销商', '店铺名称', '店员', ...cols, '实际得分'].map((h) => (
                <th key={h} className="px-2 py-2 text-center border-b last:border-r-0">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shops.map((s, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="px-2 py-2">{s.area}</td>
                <td className="px-2 py-2">{s.districtManager}</td>
                <td className="px-2 py-2">{s.supervisor}</td>
                <td className="px-2 py-2">{s.dealer}</td>
                <td className="px-2 py-2 font-medium">{s.shopName}</td>
                <td className="px-2 py-2 text-gray-300">—</td>
                {cols.map((c) => <td key={c} className="px-2 py-2 text-gray-300">—</td>)}
                <td className="px-2 py-2 text-gray-300">—</td>
              </tr>
            ))}
            {shops.length === 0 && (
              <tr><td colSpan={cols.length + 7} className="px-4 py-8 text-center text-gray-400 text-sm">暂无店铺数据</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

export default ScoreWarningCheckPage;