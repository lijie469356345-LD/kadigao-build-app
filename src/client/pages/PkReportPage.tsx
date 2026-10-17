import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { getPkTaskOrders, PkTaskOrder, getPkNames, getPkReport, exportPkReport, PkReportResult, PkReportDim, PkReportGroup } from '../../api/pk';
import { Trophy, RefreshCw, CalendarDays, Search, Swords, Store, ClipboardList, TrendingUp, X, Crown, Download } from 'lucide-react';

// 「赢」字跳动 + 彩虹波纹上下滚动效果
const WIN_ANIMATION_STYLE = `
@keyframes winBounce {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-6px) scale(1.15); }
}
@keyframes winRainbow {
  0% { background-position: 0% 50%; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
  100% { background-position: 0% 200%; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
}
.win-text {
  display: inline-block;
  font-weight: 900;
  font-size: 20px;
  background: linear-gradient(
    180deg,
    #ff0000 0%,
    #ff8800 14%,
    #ffee00 28%,
    #22dd22 42%,
    #00ccff 57%,
    #4444ff 71%,
    #8800ff 85%,
    #ff0000 100%
  );
  background-size: 100% 300%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: winRainbow 3.2s linear infinite;
  line-height: 1;
}
`;

// 组别卡片：白底黑框（不再用三色渐变底）
const THEMES = [
  {
    card: 'bg-white border-black ring-2 ring-[#D4AF37]',
    badge: 'bg-white text-gray-900 border border-black ring-1 ring-[#D4AF37]',
    text: 'text-gray-900',
    bar: 'from-gray-400 to-gray-600',
    glow: 'shadow-gray-500/30',
  },
  {
    card: 'bg-white border-black ring-2 ring-[#D4AF37]',
    badge: 'bg-white text-gray-900 border border-black ring-1 ring-[#D4AF37]',
    text: 'text-gray-900',
    bar: 'from-gray-400 to-gray-600',
    glow: 'shadow-gray-500/30',
  },
  {
    card: 'bg-white border-black ring-2 ring-[#D4AF37]',
    badge: 'bg-white text-gray-900 border border-black ring-1 ring-[#D4AF37]',
    text: 'text-gray-900',
    bar: 'from-gray-400 to-gray-600',
    glow: 'shadow-gray-500/30',
  },
];

// 赛区卡片：统一白底黑框（不再按 PK 类型区分底色），边框加黑
const ZONE_TONES: { match: RegExp; bg: string; border: string; text: string; titleBg: string }[] = [
  { match: /战区/, bg: 'from-white to-white', border: 'border-black', text: 'text-slate-900', titleBg: 'bg-transparent' },
  { match: /军团/, bg: 'from-white to-white', border: 'border-black', text: 'text-slate-900', titleBg: 'bg-transparent' },
  { match: /战队/, bg: 'from-white to-white', border: 'border-black', text: 'text-slate-900', titleBg: 'bg-transparent' },
  { match: /商品部/, bg: 'from-white to-white', border: 'border-black', text: 'text-slate-900', titleBg: 'bg-transparent' },
  { match: /门店/, bg: 'from-white to-white', border: 'border-black', text: 'text-slate-900', titleBg: 'bg-transparent' },
];
const DEFAULT_ZONE_TONE = { bg: 'from-white to-white', border: 'border-black', text: 'text-slate-900', titleBg: 'bg-transparent' };
function zoneToneOf(name: string) {
  return ZONE_TONES.find(t => t.match.test(name)) || DEFAULT_ZONE_TONE;
}

function fmtRate(rate: number | null): string {
  if (rate == null || !isFinite(Number(rate))) return '∞';
  if (rate === 0) return '0%';
  return `${(rate * 100).toFixed(3)}%`;
}

/** 根据背景色亮度决定 chip 文字色（亮底深字 / 暗底白字） */
function chipTextColor(hex: string): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#1f2937' : '#ffffff';
}

function GroupRow({ group, theme, isZoneWinner, index }: {
  group: PkReportGroup; theme: (typeof THEMES)[number]; isZoneWinner: boolean; index: number;
}) {
  const details = group.valuesDetail && group.valuesDetail.length > 0 ? group.valuesDetail : [];
  return (
    <div
      className={`relative rounded-2xl border-2 p-4 sm:p-5 transition-all duration-300
        ${theme.card} ${isZoneWinner ? 'shadow-xl ' + theme.glow : 'opacity-95'}`}
    >
      {/* 名次角标 */}
      <span className="absolute -top-2.5 -left-2.5 w-6 h-6 rounded-full bg-white border-2 border-black ring-1 ring-[#D4AF37] text-gray-900 text-xs font-bold flex items-center justify-center">
        {index + 1}
      </span>

      {/* 第一行：组名 + PK 徽标（组名底色与 PK 徽标同款，保持视觉一致） */}
      <div className="flex items-center gap-2 mb-2.5">
        <span className={`${theme.badge} px-2.5 py-1 rounded-md text-lg font-black tracking-wide leading-none`}>
          {group.groupName || '未命名组'}
        </span>
        <span className={`${theme.badge} px-2 py-0.5 rounded-md text-xs font-bold tracking-wider flex items-center gap-1`}>
          <Swords size={10} /> PK
        </span>
      </div>

      {/* 值对决行：值名 + 达成率，以刀剑 PK 图标分隔；赢值字体放大 + 奖杯跳动（去目标/业绩，只要达成率），整体居中 */}
      {details.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          {details.map((vd, vi) => {
            const valueTop = vd.value === group.valueWinner;
            const vColor = group.colorMap && group.colorMap[vd.value];
            return (
              <Fragment key={vd.value}>
                {vi > 0 && (
                  <span
                    className="inline-flex items-center gap-0.5 text-red-400 select-none shrink-0"
                    title="PK 对决"
                  >
                    <Swords size={18} className="shrink-0 drop-shadow-[0_0_4px_rgba(248,113,113,0.7)]" />
                    <span className="text-[10px] font-black tracking-wider">PK</span>
                  </span>
                )}
                <span
                  className={`inline-flex items-center gap-1.5 rounded-xl border-2 px-3 py-1.5 ${
                    valueTop
                      ? 'border-black ring-2 ring-[#D4AF37] scale-105 shadow-md shadow-red-500/20'
                      : 'bg-white border-black ring-1 ring-[#D4AF37]'
                  }`}
                >
                  <span
                    className="text-xs font-bold px-2.5 py-0.5 rounded-full max-w-full"
                    style={vColor ? { backgroundColor: vColor, color: chipTextColor(vColor), border: `1px solid ${vColor}` } : undefined}
                  >{vd.value}</span>
                  <span className={`font-bold ${valueTop ? 'text-base sm:text-lg text-red-600' : 'text-sm text-gray-800'}`}>
                    达成率 {fmtRate(vd.rate)}
                  </span>
                  {valueTop && (
                    <>
                      <style>{WIN_ANIMATION_STYLE}</style>
                      <span className="inline-flex items-center gap-1 shrink-0" style={{ animation: 'winBounce 0.8s ease-in-out infinite' }}>
                        <Crown size={26} className="text-[#D4AF37]" />
                        <span className="win-text">赢</span>
                      </span>
                    </>
                  )}
                </span>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DimensionArena({ dim, index }: { dim: PkReportDim; index: number }) {
  // 自定义报表展示名称：用户自定义，居中放大；留空回退「维度X 对决」
  const displayName = dim.displayName?.trim() || '';
  const tone = zoneToneOf(displayName || dim.dimName || '');

  return (
    <div className={`rounded-3xl bg-gradient-to-b ${tone.bg} ${tone.border} border-2 ring-2 ring-[#D4AF37] p-5 sm:p-6 shadow-xl overflow-hidden relative`}>
      {/* 区标题：自定义报表展示名称居中放大；上方小字标注原始维度 */}
      <div className="text-center mb-5">
        {displayName && (
          <div className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.25em] text-gray-700 bg-white border-2 border-black ring-1 ring-[#D4AF37] px-3 py-1 rounded-full mb-2">
            <Swords size={12} /> {dim.dimName} 对决 · 第 {index + 1} 区
          </div>
        )}
        <div className={`inline-block px-5 sm:px-7 py-2 rounded-2xl ${tone.titleBg} ${tone.text} text-2xl sm:text-4xl font-black leading-tight tracking-wide`}>
          {displayName || `${dim.dimName} 对决`}
        </div>
      </div>

      {/* 组别行：每组一行横向展示（组名 + PK徽标 + 值对决 VS 分隔） */}
      <div className="space-y-3">
        {dim.groups.map((g, i) => (
          <GroupRow
            key={g.groupName + i}
            group={g}
            theme={THEMES[i % THEMES.length]}
            isZoneWinner={!!dim.winner && g.groupName === dim.winner}
            index={i}
          />
        ))}
      </div>
    </div>
  );
}

function PkReportPage() {
  const [taskOrders, setTaskOrders] = useState<PkTaskOrder[]>([]);
  const [orderId, setOrderId] = useState<number | ''>('');
  const [pkNames, setPkNames] = useState<string[]>([]);
  const [pkName, setPkName] = useState<string>('');
  const [report, setReport] = useState<PkReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 快速搜索：本地即时过滤（匹配 赛区名/展示名/组别/值/胜方）
  const [quickSearch, setQuickSearch] = useState<string>('');
  // 标记是否已完成「最近一次 PK 任务」的自动加载（仅首次进入时自动加载一次，之后由用户切换任务/生成）
  const autoLoadedRef = useRef(false);

  const currentOrder = taskOrders.find(o => o.id === orderId) || null;

  // 首次加载任务单（默认选最新一个）
  useEffect(() => {
    getPkTaskOrders().then(res => {
      const list: PkTaskOrder[] = Array.isArray(res.data) ? res.data : [];
      setTaskOrders(list);
      if (list.length > 0) setOrderId(list[0].id);
    }).catch(() => {});
  }, []);

  // 任务单变化时加载其下 PK 名称
  useEffect(() => {
    setPkName('');
    setReport(null);
    setError('');
    setQuickSearch('');
    if (orderId === '') { setPkNames([]); return; }
    getPkNames({ taskOrderId: orderId }).then(res => {
      const names: string[] = Array.isArray(res.data) ? res.data : [];
      setPkNames(names);
      if (names.length > 0) setPkName(names[names.length - 1]);
    }).catch(() => {});
  }, [orderId]);

  const loadReport = async () => {
    if (orderId === '') { alert('请先选择 PK任务单'); return; }
    if (!pkName) { alert('该任务单下暂无店铺目标，请先在「PK店铺目标」录入'); return; }
    setLoading(true);
    setError('');
    try {
      // 「业绩统计至」由后端按任务单 PK开始/结束时间自动计算：
      //   - 未开始（今天 < PK开始时间）→ 统计至昨日 + 模拟数据
      //   - 开始后 → 真实数据（进行中默认统计至今日，已结束统计至 PK结束时间）
      const res = await getPkReport({ taskOrderId: orderId, pkName });
      setReport(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || '报表加载失败');
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  // 快速搜索：本地即时过滤。命中 赛区名/展示名/胜方 → 整区保留；组内任一店铺名/值命中 → 整组保留（自己与对手成对展示）；无任何命中则隐藏整个赛区
  const displayReport = useMemo<PkReportResult | null>(() => {
    if (!report) return null;
    const q = quickSearch.trim().toLowerCase();
    if (!q) return report;
    const dims = (report.dims || [])
      .map(dim => {
        const dimHit = [dim.dimName, dim.displayName || '', dim.winner || ''].some(t => t.toLowerCase().includes(q));
        const groups = (dim.groups || [])
          .filter(g => dimHit || [g.groupName, g.valueWinner || '', ...(g.values || []), ...(g.valuesDetail || []).map(v => v.value)].join(' ').toLowerCase().includes(q));
        return { ...dim, groups };
      })
      .filter(dim => dim.groups.length > 0);
    return { ...report, dims };
  }, [report, quickSearch]);

  // 导出 PK报表（xlsx）：与页面「生成报表」同参数同口径，服务端生成后浏览器下载
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    if (orderId === '') { alert('请先选择 PK任务单'); return; }
    if (!report) { alert('请先生成报表再导出'); return; }
    setExporting(true);
    try {
      const res = await exportPkReport({ taskOrderId: orderId as number, pkName });
      const blob = res.data as Blob;
      // 校验服务端确实返回了表格文件（防止旧版服务返回首页 HTML 被存成 .xlsx）
      const contentType: string = String(res.headers?.['content-type'] || '');
      if (!contentType.includes('spreadsheetml') && !contentType.includes('octet-stream')) {
        alert('导出失败：服务端未返回有效的表格文件（若服务刚更新，请先重启服务后重试）');
        return;
      }
      const disposition: string = String(res.headers?.['content-disposition'] || '');
      let filename = `PK报表_${currentOrder?.orderName || pkName || ''}_${report.endDate || ''}.xlsx`;
      const m = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
      if (m && m[1]) filename = decodeURIComponent(m[1]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e?.response?.data?.error || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const shownDims = displayReport?.dims ?? [];
  const noMatchBySearch = !!report && !!quickSearch.trim() && (report.dims?.length ?? 0) > 0 && shownDims.length === 0;

  // 进入页面后自动加载「最近一次 PK 任务」的数据：最新任务单 + 该任务单下按名称排序最后一个 PK 名称
  useEffect(() => {
    if (autoLoadedRef.current) return;
    if (orderId === '') return;
    if (pkName === '') return;
    autoLoadedRef.current = true;
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, pkName]);

  return (
    <Layout title="PK报表" subtitle="按 PK任务单展示红蓝绿 PK 对决 · 每个维度一个赛区 · 组别对拼 · 获胜方突出并赢取奖杯" className="page-pk-report-narrow">
      <div className="p-4">
        {/* 工具栏 */}
        <div className="flex items-center gap-3 mb-4 flex-wrap bg-white rounded-xl shadow-sm border border-gray-100 p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 flex items-center gap-1"><ClipboardList size={14} /> PK任务单</span>
            <select value={orderId} onChange={e => setOrderId(e.target.value ? Number(e.target.value) : '')} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 min-w-44">
              <option value="">请选择任务单</option>
              {taskOrders.map(o => (
                <option key={o.id} value={o.id}>{o.orderName}{o.pkStartDate ? `（${o.pkStartDate} 起）` : ''}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">PK名称</span>
            <select value={pkName} onChange={e => setPkName(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 min-w-40">
              {pkNames.length === 0 && <option value="">该任务单暂无PK</option>}
              {pkNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 flex items-center gap-1"><CalendarDays size={14} /> 业绩统计至</span>
            <span className={`px-3 py-1.5 text-sm font-bold rounded-lg border min-w-32 text-center ${
              report ? (report.isMock ? 'bg-red-50 text-red-600 border-red-300' : 'bg-emerald-50 text-emerald-700 border-emerald-300') : 'bg-gray-50 text-gray-400 border-gray-200'
            }`}>
              {report ? report.endDate : '按任务单自动计算'}
            </span>
            {report && (report.isMock ? (
              <span className="px-2 py-1 rounded-md text-xs font-bold bg-red-100 text-red-600 border border-red-300 flex items-center gap-1">
                <Swords size={11} /> 模拟数据
              </span>
            ) : (
              <span className="px-2 py-1 rounded-md text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-300 flex items-center gap-1">
                <TrendingUp size={11} /> 真实业绩
              </span>
            ))}
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={quickSearch}
              onChange={e => setQuickSearch(e.target.value)}
              placeholder="快速搜索：赛区/组别/值"
              className="pl-8 pr-7 py-1.5 border border-gray-200 rounded-lg text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            {quickSearch && (
              <button onClick={() => setQuickSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" title="清除搜索">
                <X size={14} />
              </button>
            )}
          </div>
          <button onClick={loadReport} disabled={loading || orderId === ''} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-blue-700 disabled:opacity-40">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 生成报表
          </button>
          <button onClick={handleExport} disabled={exporting || !report} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-emerald-700 disabled:opacity-40">
            <Download size={14} className={exporting ? 'animate-pulse' : ''} /> 导出报表
          </button>
          {report && (
            <span className="text-xs text-gray-400 ml-auto flex items-center gap-1">
              <Store size={13} /> {report.storeCount} 家店铺参与 · 业绩区间 {report.startDate || '—'} ~ {report.endDate}
            </span>
          )}
        </div>

        {!currentOrder && (
          <div className="mb-4 flex items-center gap-2 text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm">
            <ClipboardList size={16} />
            尚未选择 PK任务单。请先在「PK任务单」菜单创建任务单并录入店铺目标，即可在此生成 PK 报表。
          </div>
        )}

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 text-sm">{error}</div>
        )}

        {!report && !error && (
          <div className="bg-white rounded-3xl p-16 text-center border-2 border-black ring-2 ring-[#D4AF37]">
            <div className="text-6xl mb-4">🏆</div>
            <div className="text-gray-900 text-lg font-bold mb-2">PK 激战榜</div>
            <div className="text-gray-500 text-sm">选择 PK任务单与 PK名称并点击「生成报表」，每个维度一个赛区、组别对拼，胜方将举起奖杯</div>
          </div>
        )}

        {report && (
          <>
            {/* 模拟数据提示条：PK 尚未开始，业绩统计至昨日并展示模拟数据（红色标识） */}
            {report.isMock && (
              <div className="mb-4 rounded-xl bg-red-50 border border-red-300 px-4 py-3 flex items-start gap-3">
                <div className="mt-0.5 text-red-500 text-sm">🎯</div>
                <div className="text-sm text-red-600">
                  <span className="font-bold text-red-600">PK 尚未开始 · 模拟数据预览</span>
                  <span className="ml-2 text-red-500">
                    {report.pkStartDate ? `开始时间 ${report.pkStartDate}` : ''}
                    {report.pkEndDate ? ` · 结束时间 ${report.pkEndDate}` : ''} · 业绩统计至 {report.endDate}
                  </span>
                  <div className="text-xs text-red-500 mt-1">
                    PK 未开始时默认统计昨日数据并展示模拟业绩；PK 开始后将自动每天统计真实业绩（业绩统计至当日，{report.statusText || ''}）。
                  </div>
                </div>
              </div>
            )}

            {/* 大屏标题 */}
            <div className="mb-4 rounded-2xl bg-white border-2 border-black ring-2 ring-[#D4AF37] px-6 py-4 flex flex-col items-center gap-3 shadow-xl text-center">
              <div className="flex items-center gap-3">
                <Trophy className="text-red-600 w-10 h-10" />
                <div className="text-3xl sm:text-4xl font-black tracking-wide text-gray-900">🏆 {report.pkName} · PK 激战榜{currentOrder ? `（${currentOrder.orderName}）` : ''}</div>
              </div>
              <div className="text-gray-600 text-sm mt-0.5 flex items-center gap-2">共 {shownDims.length} 个维度赛区 · 业绩统计 {report.startDate || '—'} 至 {report.endDate}</div>
            </div>

            {/* 赛区 */}
            <div className="space-y-6">
              {noMatchBySearch && (
                <div className="rounded-2xl bg-white border-2 border-black ring-2 ring-[#D4AF37] p-10 text-center text-gray-600 text-sm">
                  没有匹配「{quickSearch.trim()}」的赛区、组别或值，换个关键词试试
                </div>
              )}
              {!noMatchBySearch && shownDims.length === 0 && (
                <div className="rounded-2xl bg-white border-2 border-black ring-2 ring-[#D4AF37] p-10 text-center text-gray-600 text-sm">
                  {report.scoped
                    ? '当前账号与本次 PK 无相关组别（未参与该 PK 对决），暂无赛区展示'
                    : '该任务单暂无启用维度，请先在「PK维度设定」选择该任务单并创建 PK组别'}
                </div>
              )}
              {shownDims.map((dim, i) => <DimensionArena key={dim.dimName + i} dim={dim} index={i} />)}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

export default PkReportPage;