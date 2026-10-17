import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import Layout from './Layout';
import axios from '../../api/axios';
import { getShops } from '../../api/shops';
import { useAuthStore } from '../../store/authStore';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from './AreaSupervisorShopFilter';

export interface MetricDef {
  label: string;
  key: string;          // 读取 row.本期/同期 的字段名；后端无此字段则显示 '-'
  type: 'amount' | 'pct' | 'count';
}
export type Row = {
  area: string;
  supervisor?: string;
  shopName?: string;
  rent: number | null;
  shopCount: number;
  本期: Record<string, number | null>;
  同期: Record<string, number | null>;
};
export type ViewMode = 'grouped' | 'rent';

type GroupKey = '本期' | '同期' | '对比' | '增长率';
const GROUPS: GroupKey[] = ['本期', '同期', '对比', '增长率'];

const th = 'border border-gray-400 px-2 py-1.5 text-xs font-bold text-gray-700 text-center bg-gray-100 whitespace-nowrap';
const td = 'border border-gray-400 px-2 py-1.5 text-xs text-center whitespace-nowrap';

function num(v: unknown): number | null {
  return (typeof v === 'number' && isFinite(v)) ? v : null;
}
const getCur = (r: Row, k: string) => num(r.本期?.[k]);
const getSame = (r: Row, k: string) => num(r.同期?.[k]);

function fmtAmount(v: number) {
  return v % 1 === 0 ? v.toLocaleString('zh-CN', { useGrouping: false }) : (Math.round(v * 100) / 100).toLocaleString('zh-CN', { useGrouping: false });
}
function fmtPct(v: number) { return v.toFixed(2) + '%'; }
function fmtVal(v: number | null, group: GroupKey, type: MetricDef['type']): string {
  if (v === null) return '-';
  if (group === '增长率') return fmtPct(v);
  if (type === 'pct') return fmtPct(v);
  return fmtAmount(v);
}
function color(v: number | null, group: GroupKey): CSSProperties {
  if (group !== '对比' && group !== '增长率') return {};
  if (v === null) return {};
  return { color: v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : '#888', fontWeight: 'bold' };
}
function fmtRev(v: number | null) { return v == null ? '-' : fmtAmount(v); }
function fmtRatio(v: number) { return v.toFixed(2) + '%'; }
function fmtGrowth(v: number) { return (v * 100).toFixed(2) + '%'; }
function diffStyle(v: number | null): CSSProperties {
  if (v == null) return {};
  return { color: v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : '#888', fontWeight: 'bold' };
}

function leadCols(detail: boolean) {
  const cols = [{ label: '区域', v: (r: Row) => r.area || '' }];
  if (detail) cols.push({ label: '督导', v: (r: Row) => r.supervisor || '-' }, { label: '店铺名称', v: (r: Row) => r.shopName || '-' });
  cols.push({ label: '租金(维度)', v: (r: Row) => (r.rent == null ? '-' : fmtAmount(r.rent)) }, { label: '店铺数', v: (r: Row) => String(r.shopCount) });
  return cols;
}

/** 本期/同期/对比/增长率 × N 指标的分组对比表 */
export function GroupedTable({ title, subtitle, metrics, rows, detail }: {
  title: string; subtitle: string; metrics: MetricDef[]; rows: Row[]; detail: boolean;
}) {
  const lead = leadCols(detail);
  return (
    <div className="bg-white border border-gray-400 rounded overflow-hidden">
      <div className="px-4 py-2 bg-blue-50 border-b border-gray-400">
        <h3 className="font-bold text-blue-700">{title}</h3>
        <p className="text-[10px] text-gray-500 mt-0.5">{subtitle}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs w-full" style={{ minWidth: 500 + metrics.length * 400 }}>
          <thead>
            <tr>
              {lead.map(c => <th key={c.label} rowSpan={2} className={th}>{c.label}</th>)}
              {GROUPS.map(g => <th key={g} colSpan={metrics.length} className={th}>{g}</th>)}
            </tr>
            <tr>
              {GROUPS.map(g => metrics.map(m => <th key={g + m.label} className={th}>{m.label}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              return (
                <tr key={i}>
                  {lead.map(c => <td key={c.label} className={td}>{c.v(r)}</td>)}
                  {GROUPS.flatMap(g => metrics.map((m, j) => {
                    const cur = getCur(r, m.key), same = getSame(r, m.key);
                    const v = g === '本期' ? cur : g === '同期' ? same : g === '对比' ? (cur === null || same === null ? null : cur - same) : (cur === null || same === null || !same ? null : (cur - same) / same);
                    return <td key={g + m.label} className={td} style={color(v, g)}>{fmtVal(v, g, m.type)}</td>;
                  }))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 租售比：扁平表头 */
export function RentRatioTable({ title, subtitle, rows, detail }: {
  title: string; subtitle: string; rows: Row[]; detail: boolean;
}) {
  const cols = leadCols(detail);
  return (
    <div className="bg-white border border-gray-400 rounded overflow-hidden">
      <div className="px-4 py-2 bg-blue-50 border-b border-gray-400">
        <h3 className="font-bold text-blue-700">{title}</h3>
        <p className="text-[10px] text-gray-500 mt-0.5">{subtitle}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs w-full" style={{ minWidth: 1200 }}>
          <thead>
            <tr>
              {cols.map(c => <th key={c.label} className={th}>{c.label}</th>)}
              <th className={th}>本期租金</th><th className={th}>本期业绩</th><th className={th}>同期租金</th><th className={th}>同期业绩</th>
              <th className={th}>本期租售比</th><th className={th}>同期租售比</th><th className={th}>对比</th><th className={th}>增长率</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const curRev = getCur(r, '营收'), sameRev = getSame(r, '营收');
              const curRatio = r.rent != null && curRev ? r.rent / curRev : null;
              const sameRatio = r.rent != null && sameRev ? r.rent / sameRev : null;
              const cdiff = curRatio === null || sameRatio === null ? null : curRatio - sameRatio;
              const cgrowth = curRatio === null || sameRatio === null || !sameRatio ? null : (curRatio - sameRatio) / sameRatio;
              return (
                <tr key={i}>
                  {cols.map(c => <td key={c.label} className={td}>{c.v(r)}</td>)}
                  <td className={td}>{r.rent == null ? '-' : fmtAmount(r.rent)}</td>
                  <td className={td}>{fmtRev(curRev)}</td>
                  <td className={td}>-</td>
                  <td className={td}>{fmtRev(sameRev)}</td>
                  <td className={td}>{curRatio == null ? '-' : fmtPct(curRatio * 100)}</td>
                  <td className={td}>{sameRatio == null ? '-' : fmtPct(sameRatio * 100)}</td>
                  <td className={td} style={diffStyle(cdiff)}>{cdiff == null ? '-' : fmtRatio(cdiff * 100)}</td>
                  <td className={td} style={diffStyle(cgrowth)}>{cgrowth == null ? '-' : fmtGrowth(cgrowth)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 可配置的分析页面：顶部筛选 + 汇总表 + 明细表 */
export default function FinancialAnalysisView({ title, subtitle, mode, metrics }: {
  title: string; subtitle: string; mode: ViewMode; metrics?: MetricDef[];
}) {
  const { user } = useAuthStore();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [shopList, setShopList] = useState<any[]>([]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 店铺清单（用于联动筛选下拉）
  const loadShops = useCallback(async () => {
    try {
      const shops = await getShops(user?.groupName);
      setShopList(Array.isArray(shops) ? shops : []);
    } catch { setShopList([]); }
  }, [user?.groupName]);
  useEffect(() => { loadShops(); }, [loadShops]);

  // 区经/全部(区域)/本区(督导)/本店/仓库/经销商 联动筛选
  const filter = useAreaSupervisorShopFilter(shopList, {
    getArea: (s: any) => s.area,
    getSupervisor: (s: any) => s.supervisor,
    getShopName: (s: any) => s.shopName,
    getWarehouseType: (s: any) => s.warehouseType,
    getDealer: (s: any) => s.dealer,
    getDistrictManager: (s: any) => s.districtManager as string | undefined,
  });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params: Record<string, any> = { year, month };
      if (user?.groupName) params.groupName = user.groupName;
      if (filter.selectedAreas.length) params.area = filter.selectedAreas.join(',');
      if (filter.selectedSupervisors.length) params.supervisor = filter.selectedSupervisors.join(',');
      if (filter.selectedShops.length) params.shop = filter.selectedShops.join(',');
      if (filter.selectedWarehouses.length) params.warehouse = filter.selectedWarehouses.join(',');
      if (filter.selectedDealers.length) params.dealer = filter.selectedDealers.join(',');
      if (filter.selectedDistrictManagers.length) params.dm = filter.selectedDistrictManagers.join(',');
      const res = await axios.get('/financial-revenue-profit', { params, timeout: 120000 });
      setData(res.data?.data || null);
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || '加载失败');
    } finally { setLoading(false); }
  }, [user?.groupName, year, month, filter.selectedAreas, filter.selectedSupervisors, filter.selectedShops, filter.selectedWarehouses, filter.selectedDealers, filter.selectedDistrictManagers]);

  useEffect(() => { load(); }, [load]);

  const summary: Row[] = data?.summary || [];
  const detail: Row[] = data?.detail || [];

  const tables = mode === 'rent'
    ? [
        <RentRatioTable key="s" title="汇总表 · 可比店租售比" subtitle="按区域汇总" rows={summary} detail={false} />,
        <RentRatioTable key="d" title="明细表 · 可比店租售比" subtitle="按店铺明细" rows={detail} detail />,
      ]
    : metrics
      ? [
          <GroupedTable key="s" title="汇总表 · 可比店分析" subtitle="按区域汇总：本期 / 同期 / 对比 / 增长率" rows={summary} detail={false} metrics={metrics} />,
          <GroupedTable key="d" title="明细表 · 可比店分析" subtitle="按店铺明细：本期 / 同期 / 对比 / 增长率" rows={detail} detail metrics={metrics} />,
        ]
      : [];

  return (
    <Layout title={title} subtitle={`${year}年度 ${subtitle}`}>
      <div className="p-4 space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          <AreaSupervisorShopFilter filter={filter as any} />
          <label className="text-xs font-bold text-gray-600">年份:</label>
          <select value={year} onChange={e => setYear(+e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded text-sm">
            {[year - 2, year - 1, year, year + 1].filter((y, i, a) => a.indexOf(y) === i).map(y => <option key={y} value={y}>{y}年</option>)}
          </select>
          <label className="text-xs font-bold text-gray-600">截止月份:</label>
          <select value={month} onChange={e => setMonth(+e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded text-sm">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}月</option>)}
          </select>
          <button onClick={load} disabled={loading} className="px-3 py-1.5 bg-primary text-white rounded text-sm hover:bg-primary-dark disabled:opacity-50">{loading ? '加载中...' : '查询'}</button>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}
        {!data && !error && <p className="text-gray-400 py-16 text-center">{loading ? '加载中...' : '暂无数据'}</p>}
        {data && tables}
      </div>
    </Layout>
  );
}