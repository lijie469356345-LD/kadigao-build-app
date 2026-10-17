import { useCallback, useEffect, useMemo, useState, Fragment } from 'react';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { getStoreAlerts, AlertRow, AlertItem } from '../../api/storeCheck';
import { Loader2, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';

function monthList(): string[] {
  const arr: string[] = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) { const t = new Date(d.getFullYear(), d.getMonth() - i, 1); arr.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`); }
  return arr;
}
const GKEY = (r: any) => `${r.area}||${r.districtManager}||${r.supervisor}||${r.dealer}`;
const cmp = (a: any, b: any) => { if (a == null && b == null) return 0; if (a == null) return 1; if (b == null) return -1; return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'zh'); };

function ScoreWarningWarningTablePage() {
  const monthOpts = useMemo(() => monthList(), []);
  const [month, setMonth] = useState(() => monthList()[0]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ area: '', warehouse: '', districtManager: '', dealer: '', supervisor: '', shopName: '' });
  const [sG, setSG] = useState({ k: 'curAvg', d: 1 as 1 | -1 });
  const [sD, setSD] = useState({ k: 'curTotal', d: 1 as 1 | -1 });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState('');

  const { user } = useAuthStore();
  const load = useCallback(async (m: string, g?: string) => {
    setLoading(true);
    try { setData(await getStoreAlerts(m, g || '')); setOpen(new Set()); }
    catch (e) { console.error(e); setToast('加载预警失败'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(month, user?.groupName || ''); }, [load, month, user]);

  const baseRows: AlertRow[] = data?.rows || [];
  const dimsOf = (dim: keyof typeof f) => Array.from(new Set(baseRows.map((x: any) => x[dim]).filter(Boolean))).sort();
  const filtered = useMemo(() => baseRows.filter((x: any) =>
    (!f.area || x.area === f.area) && (!f.warehouse || x.warehouse === f.warehouse) &&
    (!f.districtManager || x.districtManager === f.districtManager) &&
    (!f.dealer || x.dealer === f.dealer) && (!f.supervisor || x.supervisor === f.supervisor) &&
    (!f.shopName || x.shopName === f.shopName)
  ), [baseRows, f]);

  const groups = useMemo(() => {
    const map = new Map<string, AlertRow[]>();
    for (const r of filtered) { const k = GKEY(r); if (!map.has(k)) map.set(k, []); map.get(k)!.push(r); }
    return Array.from(map.values()).map((members) => ({
      area: members[0].area, dm: members[0].districtManager, sup: members[0].supervisor, dealer: members[0].dealer,
      count: members.length,
      prevAvg: Math.round((members.reduce((s, m) => s + (m.prevTotal || 0), 0) / members.length) * 10) / 10,
      curAvg: Math.round((members.reduce((s, m) => s + m.curTotal, 0) / members.length) * 10) / 10,
      members,
    }));
  }, [filtered]);
  const withDelta = groups.map((g: any) => ({ ...g, delta: Math.round((g.curAvg - g.prevAvg) * 10) / 10 }));

  const sortRows = (arr: any[], cur: { k: string; d: 1 | -1 }) => arr.slice().sort((a: any, b: any) => cur.d * cmp(a[cur.k], b[cur.k]));
  const sortedG = sortRows(withDelta, sG);
  const enriched = filtered.map((r) => ({ ...r, delta: r.prevTotal == null ? null : r.curTotal - r.prevTotal }));
  const sortedD = sortRows(enriched, sD);
  const toggleSort = (cur: { k: string; d: 1 | -1 }, k: string) => ({ k, d: (cur.k === k ? (cur.d === 1 ? -1 : 1) : 1) as 1 | -1 });
  const arrow = (cur: { k: string; d: 1 | -1 }, k: string) => cur.k === k ? (cur.d === 1 ? ' ▲' : ' ▼') : '';
  const toggle = (n: string) => setOpen((p) => { const x = new Set(p); if (x.has(n)) x.delete(n); else x.add(n); return x; });
  const dCls = (d: number | null) => d == null ? 'text-gray-300' : d < 0 ? 'text-red-500' : d > 0 ? 'text-green-500' : 'text-gray-400';
  const dTxt = (d: number | null) => d == null ? '—' : (d > 0 ? '+' : '') + d;

  const GCOLS: [string, string][] = [['area', '区域'], ['dm', '区经'], ['sup', '督导'], ['dealer', '经销商'], ['count', '店数'], ['prevAvg', '上月平均得分'], ['curAvg', '本月平均得分'], ['delta', '分差']];
  const DCOLS: [string, string][] = [['area', '区域'], ['districtManager', '区经'], ['supervisor', '督导'], ['dealer', '经销商'], ['shopName', '门店'], ['prevTotal', '上月得分'], ['curTotal', '本月得分'], ['delta', '分差']];

  return (
    <Layout title="店铺预警表" subtitle="连续不合格（<60分）门店预警">
      <div className="px-4 md:px-6 max-w-[1100px] mx-auto">
        <div className="bg-white rounded-xl shadow-sm px-3 py-2 flex flex-wrap items-center gap-2 mb-3">
          <label className="text-xs text-gray-500">统计月份
            <select value={month} onChange={(e) => setMonth(e.target.value)} className="ml-1 border rounded px-2 py-1 text-sm">{monthOpts.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          </label>
          <button onClick={() => load(month, user?.groupName || '')} className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-sm flex items-center gap-1 hover:bg-amber-600"><RefreshCw className="w-4 h-4" /> 刷新</button>
          {data && <span className="text-xs text-gray-400">对比 {data.prevMonth} → {data.month}（上月与本月均 &lt;60 分才预警）</span>}
        </div>

        <div className="bg-white rounded-xl shadow-sm px-3 py-2 flex flex-wrap items-center gap-2 mb-3">
          <OvFilter label="本区" value={f.area} options={dimsOf('area')} onChange={(v) => setF({ ...f, area: v })} />
          <OvFilter label="仓库" value={f.warehouse} options={dimsOf('warehouse')} onChange={(v) => setF({ ...f, warehouse: v })} />
          <OvFilter label="区经" value={f.districtManager} options={dimsOf('districtManager')} onChange={(v) => setF({ ...f, districtManager: v })} />
          <OvFilter label="经销商" value={f.dealer} options={dimsOf('dealer')} onChange={(v) => setF({ ...f, dealer: v })} />
          <OvFilter label="督导" value={f.supervisor} options={dimsOf('supervisor')} onChange={(v) => setF({ ...f, supervisor: v })} />
          <select value={f.shopName} onChange={(e) => setF({ ...f, shopName: e.target.value })} className="border rounded px-2 py-1 text-xs max-w-[9rem]">
            <option value="">本店：全部</option>
            {baseRows.map((x) => <option key={x.shopName} value={x.shopName}>{x.shopName}</option>)}
          </select>
          {(f.area || f.warehouse || f.districtManager || f.dealer || f.supervisor || f.shopName) && (
            <button onClick={() => setF({ area: '', warehouse: '', districtManager: '', dealer: '', supervisor: '', shopName: '' })} className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-500">全部</button>
          )}
          <span className="text-xs text-gray-400 ml-auto">预警门店 {filtered.length} 家 / {groups.length} 组</span>
        </div>

        {/* 第一区 */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-3">
          <div className="px-4 py-2.5 bg-amber-50 border-b font-semibold text-gray-800">第一区 · 区域汇总</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead><tr className="text-gray-500 border-b bg-gray-50">
                {GCOLS.map(([k, l]) => <th key={k} onClick={() => setSG(toggleSort(sG, k))} className="px-2 py-2 text-center border-b last:border-r-0 cursor-pointer select-none hover:text-amber-600">{l}{arrow(sG, k)}</th>)}
                <th className="px-2 py-2 text-center">预警数</th>
                <th className="px-2 py-2 text-center">具体事项</th>
              </tr></thead>
              <tbody>
              {sortedG.map((g: any, i: number) => (
                <Fragment key={i}>
                  <tr onClick={() => toggle('g' + i)} className="border-b hover:bg-gray-50 cursor-pointer">
                    <td className="px-2 py-2">{g.area || '-'}</td><td className="px-2 py-2">{g.dm}</td>
                    <td className="px-2 py-2">{g.sup}</td><td className="px-2 py-2">{g.dealer}</td>
                    <td className="px-2 py-2"><span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-xs">{g.count}</span></td>
                    <td className="px-2 py-2 text-gray-500">{g.prevAvg}</td>
                    <td className="px-2 py-2 font-medium">{g.curAvg}</td>
                    <td className={`px-2 py-2 ${dCls(g.delta)}`}>{dTxt(g.delta)}</td>
                    <td className="px-2 py-2 text-amber-600">{open.has('g' + i) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}事项</td>
                  </tr>
                  {open.has('g' + i) && (
                    <tr><td colSpan={10} className="px-3 py-2 bg-amber-50/40">
                      {g.members.map((m: AlertRow, j: number) => (
                        <div key={j} className="border-b last:border-0 py-1 text-xs flex items-center gap-2">
                          <span className="font-medium text-gray-700">{m.shopName}</span>
                          <span className="text-gray-500 shrink-0">上月 {m.prevTotal ?? '-'} → 本月 {m.curTotal}</span>
                          {(m.warnings || []).slice(0, 8).map((w: AlertItem, q) => (
                            <span key={q} className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 shrink-0">[{w.dim}]{w.name} {w.score}/{w.full}</span>
                          ))}
                          {(m.warnings || []).length > 8 && <span className="text-gray-400">等{(m.warnings || []).length}项</span>}
                        </div>
                      ))}
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody></table>
          </div>
        </div>

        {/* 第二区 */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b font-semibold text-gray-700">第二区 · 预警门店明细（点击行展开持续不达标事项）</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead><tr className="text-gray-500 border-b bg-gray-50">
                {DCOLS.map(([k, l]) => <th key={`h${k}`} onClick={() => k !== 'o' && setSD(toggleSort(sD, k))} className={`px-2 py-2 text-center ${k !== 'o' ? 'cursor-pointer select-none hover:text-amber-600' : ''}`}>{l}</th>)}
                <th className="px-2 py-2 text-center">预警数</th>
                <th className="px-2 py-2 text-center">具体事项</th>
              </tr></thead>
              <tbody>
              {sortedD.map((r: AlertRow) => {
                const isOpen = open.has('d' + r.shopName);
                const delta = r.prevTotal == null ? null : r.curTotal - r.prevTotal;
                return (
                  <Fragment key={r.shopName}>
                    <tr onClick={() => toggle('d' + r.shopName)} className="border-b hover:bg-gray-50 cursor-pointer">
                      <td className="px-2 py-2">{r.area}</td><td className="px-2 py-2">{r.districtManager}</td>
                      <td className="px-2 py-2">{r.supervisor}</td><td className="px-2 py-2">{r.dealer}</td>
                      <td className="px-2 py-2 font-medium">{r.shopName}</td>
                      <td className="px-2 py-2 text-gray-500">{r.prevTotal}</td>
                      <td className="px-2 py-2 font-medium">{r.curTotal}</td>
                      <td className={`px-2 py-2 ${dCls(delta)}`}>{dTxt(delta)}</td>
                      <td className="px-2 py-2"><span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-xs">{r.warnCount}</span></td>
                      <td className="px-2 py-2 text-amber-600">{isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}事项</td>
                    </tr>
                    {isOpen && (
                      <tr><td colSpan={10} className="px-3 py-2 bg-amber-50/40">
                        {(r.warnings || []).length === 0 ? <div className="text-gray-400 text-xs">无明细</div> : (
                          <ul>{r.warnings.map((w: AlertItem, j) => (
                            <li key={j} className="text-xs py-0.5 px-1"><span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 mr-1">{w.type}</span>[{w.dim}] {w.name}：上月 {w.prevScore} → 本月 {w.score}/{w.full}</li>
                          ))}</ul>
                        )}
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
              {!loading && sortedD.length === 0 && <tr><td colSpan={10} className="px-3 py-12 text-center text-gray-400">本月无连续不合格预警门店</td></tr>}
              {(loading || !data) && <tr><td colSpan={10} className="px-3 py-12 text-center text-gray-400">{loading ? <Loader2 className="w-5 h-5 animate-spin inline" /> : '—'}</td></tr>}
            </tbody></table>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function Stat({ title, value, cls }: { title: string; value: number | string; cls?: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm px-4 py-3">
      <div className={`text-2xl font-bold ${cls || ''}`}>{value}</div>
      <div className="text-sm text-gray-500">{title}</div>
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

export default ScoreWarningWarningTablePage;