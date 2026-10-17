import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Settings2, Palette, Calculator, History as HistoryIcon,
  Search, Plus, Trash2, Upload, Download, Save, AlertTriangle, RefreshCw,
  ChevronLeft, ChevronRight, Store, Package, TrendingUp, Boxes, Loader2, X,
} from 'lucide-react';
import { useState, useEffect, useMemo, useRef } from 'react';
import Layout from '../components/Layout';
import * as XLSX from 'xlsx';
import {
  fetchParams, saveParams, fetchSkuOptions, fetchSkuFilterOptions, fetchAllSkuOptions, fetchSelectedSkus, addSelectedSkus,
  importSelectedSkus, deleteSelectedSku, clearSelectedSkus, computeReplenish,
  fetchResults, exportReplenishCsv, fetchHistory, deleteHistory,
} from '../../api/replenish';
import type { ReplenishParams, SelectedSku, SkuOption, SkuFilterOptions, ResultRow, ComputeSummary, HistoryItem } from '../../api/replenish';

const SIZE_COLS = ['31','32','33','34','35','36','37','38','39','40','41','42','43','44','45','46'];
const PAGE_SIZE = 200;

const DEFAULT_PARAMS: ReplenishParams = {
  计划销售天数: 7, 日均销统计天数: 7, 单码最大深度: 3, 总仓留仓比例: 0, 是否节假日放大: false,
  节假日前开始: '', 节假日前结束: '', 节假日后开始: '', 节假日后结束: '',
  新品判定天数: 15, 滞销冻结天数: 14, 本店权重: 0.7, 区域权重: 0.3,
};

interface Column { key: string; label: string; width: number; size?: boolean; pct?: boolean; hl?: boolean; }

const AGG_COLS: Column[] = [
  { key: '店铺等级', label: '等级', width: 55 },
  { key: '齐码率', label: '齐码率', width: 62, pct: true },
  { key: '存销比', label: '存销比', width: 60 },
  { key: '现库存合计', label: '现库存', width: 62 },
  { key: '在途合计', label: '在途', width: 52 },
  { key: '可用合计', label: '可用', width: 60 },
  { key: '目标合计', label: '目标', width: 60 },
  { key: '理论补货合计', label: '理论补货', width: 72, hl: true },
  { key: '实际补货合计', label: '实际补货', width: 72, hl: true },
  { key: '状态', label: '状态', width: 84 },
];
const FROZEN_COLS: Column[] = [
  { key: '店铺名称', label: '店铺名称', width: 120 },
  { key: '商品代码', label: '商品代码', width: 100 },
  { key: '颜色名称', label: '颜色名称', width: 100 },
];
const ALL_COLS: Column[] = [
  ...FROZEN_COLS,
  ...SIZE_COLS.map(s => ({ key: s, label: s, width: 44, size: true })),
  { key: '合计', label: '合计', width: 60, size: true },
  ...AGG_COLS,
];
const FROZEN_COUNT = FROZEN_COLS.length;

type Tab = 'params' | 'sku' | 'result' | 'history';

function AutoReplenishPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('params');
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  return (
    <Layout title="自动补货" subtitle="总仓→门店 智能库存补货建议（SKC粒度）">
      <div className="mb-6 flex items-center gap-2">
        <button
          onClick={() => navigate('/automation')}
          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white rounded-lg border border-gray-200 hover:bg-gray-50"
        >
          <ArrowLeft size={16} /> 返回自动化管理
        </button>
      </div>

      {/* Tab 栏 */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {([
          ['params', '参数设置', Settings2],
          ['sku', '款色管理', Palette],
          ['result', '计算与结果', Calculator],
          ['history', '历史记录', HistoryIcon],
        ] as [Tab, string, any][]).map(([k, label, Icon]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              tab === k ? 'bg-blue-600 text-white shadow' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === 'params' && <ParamsPanel showToast={showToast} />}
      {tab === 'sku' && <SkuPanel showToast={showToast} />}
      {tab === 'result' && <ResultPanel showToast={showToast} />}
      {tab === 'history' && <HistoryPanel showToast={showToast} />}

      {toast && (
        <div className="fixed top-6 right-6 z-50 px-4 py-3 bg-gray-900 text-white text-sm rounded-xl shadow-lg">
          {toast}
        </div>
      )}
    </Layout>
  );
}

// ==================== 参数设置 ====================

function ParamsPanel({ showToast }: { showToast: (m: string) => void }) {
  const [form, setForm] = useState<ReplenishParams>(DEFAULT_PARAMS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchParams().then(res => {
      if (res.data.success) setForm({ ...DEFAULT_PARAMS, ...res.data.data });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const set = (k: keyof ReplenishParams, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    const wSum = (Number(form.本店权重) || 0) + (Number(form.区域权重) || 0);
    if (Math.abs(wSum - 1) > 0.01 && wSum > 0) {
      showToast('本店权重 + 区域权重 之和应为 1，已自动归一化');
    }
    setSaving(true);
    try {
      const res = await saveParams(form);
      if (res.data.success) { setForm({ ...DEFAULT_PARAMS, ...res.data.data }); showToast('参数已保存'); }
      else showToast(res.data.message || '保存失败');
    } catch (e: any) {
      showToast(e.response?.data?.message || e.message || '保存失败');
    } finally { setSaving(false); }
  };

  if (loading) return <div className="text-center py-20 text-gray-400">加载中...</div>;

  const NumberInput = ({ label, k, step = 1, min = 0, hint }: any) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type="number" step={step} min={min} value={(form as any)[k]}
        onChange={e => set(k, e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
      />
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center gap-2 mb-1">
        <Settings2 size={18} className="text-blue-600" />
        <h2 className="text-lg font-bold text-gray-800">补货参数配置</h2>
      </div>
      <p className="text-sm text-gray-500 mb-6">所有参数均可随时修改，保存后立即生效，无需改代码。</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
        <NumberInput label="计划销售天数" k="计划销售天数" min={1} hint="目标库存覆盖未来销售周期（天）" />
        <NumberInput label="日均销统计天数" k="日均销统计天数" min={1} hint="历史销量回溯统计周期（天）" />
        <NumberInput label="单码最大深度" k="单码最大深度" min={1} hint="单尺码门店最大铺货上限（双）" />
        <NumberInput label="总仓留仓比例" k="总仓留仓比例" step={0.05} hint="总仓预留不调拨比例（0~0.9）" />
        <NumberInput label="新品判定天数" k="新品判定天数" min={1} hint="上货天数≤该值判定为新品" />
        <NumberInput label="滞销冻结天数" k="滞销冻结天数" min={1} hint="连续0销≥该天数禁止补货" />
        <NumberInput label="本店权重" k="本店权重" step={0.05} hint="本店日均销量加权" />
        <NumberInput label="区域权重" k="区域权重" step={0.05} hint="小区域日均销量加权" />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">节假日放大</label>
          <button
            onClick={() => set('是否节假日放大', !form.是否节假日放大)}
            className={`w-full px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
              form.是否节假日放大 ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-500 border-gray-200'
            }`}
          >
            {form.是否节假日放大 ? '已开启' : '已关闭'}
          </button>
          <p className="text-xs text-gray-400 mt-1">销量波动开关，开启需设置下方日期区间</p>
        </div>
      </div>

      {form.是否节假日放大 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 p-4 bg-blue-50 rounded-xl border border-blue-100">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">节假日前开始</label>
            <input type="date" value={form.节假日前开始} onChange={e => set('节假日前开始', e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">节假日前结束</label>
            <input type="date" value={form.节假日前结束} onChange={e => set('节假日前结束', e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">节假日后开始</label>
            <input type="date" value={form.节假日后开始} onChange={e => set('节假日后开始', e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">节假日后结束</label>
            <input type="date" value={form.节假日后结束} onChange={e => set('节假日后结束', e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg outline-none" />
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-50"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} 保存参数
        </button>
      </div>
    </div>
  );
}

// ==================== 款色管理 ====================

function SkuPanel({ showToast }: { showToast: (m: string) => void }) {
  const [options, setOptions] = useState<SkuOption[]>([]);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [gender, setGender] = useState('');
  const [year, setYear] = useState('');
  const [season, setSeason] = useState('');
  const [style, setStyle] = useState('');
  const [type, setType] = useState('');
  const [filterOptions, setFilterOptions] = useState<SkuFilterOptions>({ years: [], seasons: [], genders: [], styles: [], types: [] });
  const [page, setPage] = useState(1);
  const [searching, setSearching] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [checkedSkus, setCheckedSkus] = useState<Map<string, SkuOption>>(new Map());
  const [selectingAll, setSelectingAll] = useState(false);
  const [selected, setSelected] = useState<SelectedSku[]>([]);
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const totalPages = Math.max(1, Math.ceil(total / 50));

  const loadSelected = () => {
    fetchSelectedSkus().then(res => { if (res.data.success) setSelected(res.data.data || []); }).catch(() => {});
  };
  useEffect(() => { loadSelected(); }, []);

  // 加载筛选下拉选项
  useEffect(() => {
    fetchSkuFilterOptions().then(res => {
      if (res.data.success) setFilterOptions(res.data.data);
    }).catch(() => {});
  }, []);

  const doSearch = (pg = page) => {
    setSearching(true);
    fetchSkuOptions({ keyword, gender, year, season, style, type, page: pg, pageSize: 50 }).then(res => {
      if (res.data.success) { setOptions(res.data.data.list || []); setTotal(res.data.data.total); }
    }).catch(() => {}).finally(() => setSearching(false));
  };
  useEffect(() => { setPage(1); doSearch(1); }, [gender, year, season, style, type]);

  const toggleCheck = (sku: SkuOption) => {
    const k = sku.商品代码 + '\x1f' + sku.颜色名称;
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
    setCheckedSkus(prev => {
      const next = new Map(prev);
      if (next.has(k)) next.delete(k); else next.set(k, sku);
      return next;
    });
  };

  const toggleAllPage = () => {
    const allChecked = options.length > 0 && options.every(o => checked.has(o.商品代码 + '\x1f' + o.颜色名称));
    setChecked(prev => {
      const next = new Set(prev);
      options.forEach(o => {
        const k = o.商品代码 + '\x1f' + o.颜色名称;
        if (allChecked) next.delete(k); else next.add(k);
      });
      return next;
    });
    setCheckedSkus(prev => {
      const next = new Map(prev);
      options.forEach(o => {
        const k = o.商品代码 + '\x1f' + o.颜色名称;
        if (allChecked) next.delete(k); else next.set(k, o);
      });
      return next;
    });
  };

  // 全选当前筛选条件下的全部款色（跨页）
  const selectAllFiltered = async () => {
    setSelectingAll(true);
    try {
      const res = await fetchAllSkuOptions({ keyword, gender, year, season, style, type });
      if (res.data.success) {
        const list = res.data.data.list || [];
        setChecked(prev => {
          const next = new Set(prev);
          list.forEach(x => next.add(x.商品代码 + '\x1f' + x.颜色名称));
          return next;
        });
        setCheckedSkus(prev => {
          const next = new Map(prev);
          list.forEach(x => next.set(x.商品代码 + '\x1f' + x.颜色名称, { 商品代码: x.商品代码, 颜色名称: x.颜色名称, 颜色代码: '', 尺码组: '', 性别: '', 大类: '', 季节: '', 年份: '', 风格: '', 款式: '' } as SkuOption));
          return next;
        });
        showToast(`已勾选当前筛选结果 ${list.length} 个款色`);
      } else showToast(res.data.message || '全选失败');
    } catch (e: any) { showToast(e.response?.data?.message || e.message || '全选失败'); }
    finally { setSelectingAll(false); }
  };

  const clearChecked = () => {
    setChecked(new Set());
    setCheckedSkus(new Map());
  };

  const handleAddChecked = async () => {
    if (checkedSkus.size === 0) { showToast('请先勾选要加入的款色'); return; }
    const items = Array.from(checkedSkus.values()).map(o => ({ 商品代码: o.商品代码, 颜色名称: o.颜色名称 }));
    setAdding(true);
    try {
      const res = await addSelectedSkus(items);
      if (res.data.success) {
        showToast(`已加入 ${res.data.data.inserted} 个款色（重复 ${res.data.data.skipped} 个）`);
        setChecked(new Set());
        setCheckedSkus(new Map());
        loadSelected();
      } else showToast(res.data.message || '添加失败');
    } catch (e: any) { showToast(e.response?.data?.message || e.message || '添加失败'); }
    finally { setAdding(false); }
  };

  const handleDelete = async (id: number) => {
    try { await deleteSelectedSku(id); loadSelected(); } catch {}
  };

  const handleClear = async () => {
    if (!window.confirm('确定清空全部选中款色？')) return;
    try { await clearSelectedSkus(); loadSelected(); showToast('已清空'); } catch {}
  };

  // Excel 导入
  const handleImportFile = async (file: File) => {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const items: { 商品代码: string; 颜色名称: string }[] = [];
      const header = (rows[0] || []).map((h: any) => String(h || '').trim());
      let ci = header.indexOf('商品代码'), oi = header.indexOf('颜色名称');
      const startRow = ci >= 0 || oi >= 0 ? 1 : 0;
      if (ci < 0) ci = 0;
      if (oi < 0) oi = 1;
      for (let i = startRow; i < rows.length; i++) {
        const r = rows[i] || [];
        const code = String(r[ci] ?? '').trim();
        const color = String(r[oi] ?? '').trim();
        if (code && color) items.push({ 商品代码: code, 颜色名称: color });
      }
      if (items.length === 0) { showToast('未识别到有效数据，请包含"商品代码、颜色名称"列'); return; }
      const res = await importSelectedSkus(items);
      if (res.data.success) {
        showToast(`导入成功：新增 ${res.data.data.inserted} 个，重复 ${res.data.data.skipped} 个`);
        loadSelected();
      }
    } catch (e: any) {
      showToast('Excel 解析失败：' + e.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* 候选款色搜索 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Search size={18} className="text-blue-600" />
          <h3 className="text-lg font-bold text-gray-800">候选款色（从商品库搜索）</h3>
        </div>
        <div className="flex flex-wrap gap-3 mb-4">
          <input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { setPage(1); doSearch(1); } }}
            placeholder="输入 商品代码 / 颜色名称 搜索"
            className="flex-1 min-w-[220px] px-3 py-2 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-200"
          />
          <select value={year} onChange={e => setYear(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg outline-none bg-white">
            <option value="">全部年份</option>
            {filterOptions.years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={season} onChange={e => setSeason(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg outline-none bg-white">
            <option value="">全部季节</option>
            {filterOptions.seasons.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={gender} onChange={e => setGender(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg outline-none bg-white">
            <option value="">全部性别</option>
            {filterOptions.genders.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={style} onChange={e => setStyle(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg outline-none bg-white">
            <option value="">全部风格</option>
            {filterOptions.styles.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={type} onChange={e => setType(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg outline-none bg-white">
            <option value="">全部款式</option>
            {filterOptions.types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <button
            onClick={() => { setPage(1); doSearch(1); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            <RefreshCw size={15} /> 搜索
          </button>
        </div>

        <div className="border border-gray-100 rounded-xl overflow-hidden mb-4 max-h-[320px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left w-10">
                  <input
                    type="checkbox"
                    checked={options.length > 0 && options.every(o => checked.has(o.商品代码 + '\x1f' + o.颜色名称))}
                    onChange={toggleAllPage}
                    className="accent-blue-600"
                    title="全选本页"
                  />
                </th>
                <th className="px-3 py-2 text-left">商品代码</th>
                <th className="px-3 py-2 text-left">颜色名称</th>
                <th className="px-3 py-2 text-left">年份</th>
                <th className="px-3 py-2 text-left">季节</th>
                <th className="px-3 py-2 text-left">性别</th>
                <th className="px-3 py-2 text-left">风格</th>
                <th className="px-3 py-2 text-left">款式</th>
                <th className="px-3 py-2 text-left">大类</th>
                <th className="px-3 py-2 text-left">尺码组</th>
              </tr>
            </thead>
            <tbody>
              {searching ? (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400"><Loader2 size={18} className="inline animate-spin" /> 搜索中...</td></tr>
              ) : options.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">无结果，请调整搜索条件</td></tr>
              ) : options.map((o, i) => {
                const k = o.商品代码 + '\x1f' + o.颜色名称;
                const isChecked = checked.has(k);
                return (
                  <tr key={i} className={`border-t border-gray-50 cursor-pointer hover:bg-blue-50/50 ${isChecked ? 'bg-blue-50' : ''}`} onClick={() => toggleCheck(o)}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={isChecked} onChange={() => toggleCheck(o)} className="accent-blue-600" />
                    </td>
                    <td className="px-3 py-2 font-mono">{o.商品代码}</td>
                    <td className="px-3 py-2">{o.颜色名称}</td>
                    <td className="px-3 py-2">{o.年份}</td>
                    <td className="px-3 py-2">{o.季节}</td>
                    <td className="px-3 py-2">{o.性别}</td>
                    <td className="px-3 py-2">{o.风格}</td>
                    <td className="px-3 py-2">{o.款式}</td>
                    <td className="px-3 py-2">{o.大类}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{o.尺码组}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>共 {total} 个款色，已勾选 <span className="text-blue-600 font-bold">{checkedSkus.size}</span> 个</span>
            <div className="flex items-center gap-1 ml-3">
              <button disabled={page <= 1} onClick={() => { setPage(page - 1); doSearch(page - 1); }} className="p-1.5 border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50"><ChevronLeft size={15} /></button>
              <span className="px-2">{page}/{totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => { setPage(page + 1); doSearch(page + 1); }} className="p-1.5 border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50"><ChevronRight size={15} /></button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {checkedSkus.size > 0 && (
              <button
                onClick={clearChecked}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                <X size={14} /> 清空勾选
              </button>
            )}
            <button
              onClick={selectAllFiltered}
              disabled={selectingAll || total === 0}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {selectingAll ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
              全选当前筛选结果（{total}）
            </button>
            <button
              onClick={handleAddChecked}
              disabled={adding || checkedSkus.size === 0}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              加入选中（{checkedSkus.size}）
            </button>
            <input
              ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700"
            >
              <Upload size={15} /> Excel 批量导入
            </button>
          </div>
        </div>
      </div>

      {/* 当前选中款色 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Package size={18} className="text-violet-600" />
            <h3 className="text-lg font-bold text-gray-800">当前参与补货的款色（{selected.length}）</h3>
          </div>
          {selected.length > 0 && (
            <button onClick={handleClear} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-sm hover:bg-red-100">
              <Trash2 size={14} /> 清空
            </button>
          )}
        </div>
        {selected.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center border border-dashed border-gray-200 rounded-xl">
            尚未选择款色，请从上方向上搜索勾选或导入 Excel。只有选中的款色才会参与补货计算。
          </p>
        ) : (
          <div className="border border-gray-100 rounded-xl overflow-hidden max-h-[360px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">商品代码</th>
                  <th className="px-3 py-2 text-left">颜色名称</th>
                  <th className="px-3 py-2 text-left">性别</th>
                  <th className="px-3 py-2 text-left">尺码组</th>
                  <th className="px-3 py-2 text-left">添加时间</th>
                  <th className="px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {selected.map(s => (
                  <tr key={s.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="px-3 py-2 font-mono">{s.商品代码}</td>
                    <td className="px-3 py-2">{s.颜色名称}</td>
                    <td className="px-3 py-2">{s.性别 || '-'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{s.尺码组 || '-'}</td>
                    <td className="px-3 py-2 text-xs text-gray-400">{s.添加时间 ? s.添加时间.slice(0, 10) : '-'}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => handleDelete(s.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== 计算与结果 ====================

function ResultPanel({ showToast }: { showToast: (m: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [summary, setSummary] = useState<ComputeSummary | null>(null);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [batchId, setBatchId] = useState('');
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageData = useMemo(() => {
    let d = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    if (sortKey) {
      d = [...d].sort((a, b) => {
        const av = sortKey.startsWith('sizes.') ? (a.sizes[sortKey.slice(6)] || 0) : (a as any)[sortKey];
        const bv = sortKey.startsWith('sizes.') ? (b.sizes[sortKey.slice(6)] || 0) : (b as any)[sortKey];
        if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
        const cmp = String(av ?? '').localeCompare(String(bv ?? ''), 'zh-CN');
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return d;
  }, [rows, page, sortKey, sortDir]);

  const handleCompute = async () => {
    setLoading(true); setError(''); setWarnings([]); setSummary(null); setRows([]);
    try {
      const res = await computeReplenish();
      if (!res.data.success) { setError(res.data.message || '计算失败'); return; }
      const d = res.data.data;
      setSummary(d.summary);
      setRows(d.previewRows || []);
      setBatchId(d.batchId);
      setWarnings(d.warnings || []);
      setPage(1);
      showToast(`计算完成：建议补货 ${d.summary.实际补货总量} 双（共 ${d.total} 条明细）`);
    } catch (e: any) {
      setError(e.response?.data?.message || e.message || '计算失败，请检查是否已选款色');
    } finally { setLoading(false); }
  };

  const handleExportXlsx = () => {
    if (pageData.length === 0) { showToast('暂无数据'); return; }
    const header = ['店铺名称', '商品代码', '颜色名称', ...SIZE_COLS, '合计', '店铺等级', '齐码率', '存销比', '现库存', '在途', '可用', '目标', '理论补货', '实际补货', '状态'];
    const aoa: any[][] = [header];
    for (const r of pageData) {
      const sizeVals = SIZE_COLS.map(s => r.sizes?.[s] || 0);
      aoa.push([
        r.店铺名称, r.商品代码, r.颜色名称, ...sizeVals, Object.values(r.sizes || {}).reduce((a, b) => a + b, 0),
        r.店铺等级, (r.齐码率 * 100).toFixed(0) + '%', r.存销比, r.现库存合计, r.在途合计, r.可用合计, r.目标合计,
        r.理论补货合计, r.实际补货合计, r.状态,
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '补货明细');
    XLSX.writeFile(wb, `补货明细_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleExportCsv = async () => {
    if (!batchId) { showToast('请先计算'); return; }
    try {
      const blob = await exportReplenishCsv(batchId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `补货明细_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { showToast('导出失败：' + e.message); }
  };

  const getFrozenLeft = (colIdx: number) => {
    if (colIdx >= FROZEN_COUNT) return undefined;
    let left = 0;
    for (let i = 0; i < colIdx; i++) left += FROZEN_COLS[i].width;
    return left;
  };

  const cellValue = (row: ResultRow, col: any): any => {
    if (col.size) {
      if (col.key === '合计') return Object.values(row.sizes || {}).reduce((a, b) => a + b, 0);
      return row.sizes?.[col.key] || 0;
    }
    return (row as any)[col.key];
  };

  return (
    <div className="space-y-6">
      {/* 计算按钮区 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-gray-800">生成补货建议</h3>
            <p className="text-sm text-gray-500 mt-1">按：销量预测 → 系数修正 → 目标库存 → 业务拦截 → 总仓分配 全流程计算</p>
          </div>
          <button
            onClick={handleCompute}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-60"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Calculator size={16} />}
            {loading ? '计算中，请耐心等待...' : '开始计算'}
          </button>
        </div>
        {warnings.length > 0 && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700 flex items-start gap-2">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <div>{warnings.map((w, i) => <div key={i}>• {w}</div>)}</div>
          </div>
        )}
        {error && <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}
      </div>

      {/* 汇总卡片 */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: '涉及店铺数', value: summary.涉及店铺数, icon: Store, color: 'text-blue-600 bg-blue-50' },
            { label: '涉及款色数', value: summary.涉及款色数, icon: Package, color: 'text-violet-600 bg-violet-50' },
            { label: '理论补货量', value: summary.理论补货总量, icon: TrendingUp, color: 'text-amber-600 bg-amber-50' },
            { label: '实际补货量（总仓分配后）', value: summary.实际补货总量, icon: Boxes, color: 'text-emerald-600 bg-emerald-50' },
          ].map((c, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-3">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${c.color}`}>
                <c.icon size={20} />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-800">{c.value.toLocaleString('zh-CN', { useGrouping: false })}</div>
                <div className="text-xs text-gray-500">{c.label}</div>
              </div>
            </div>
          ))}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-red-600 bg-red-50"><Boxes size={20} /></div>
            <div>
              <div className="text-2xl font-bold text-gray-800">{summary.总仓消耗.toLocaleString('zh-CN', { useGrouping: false })}</div>
              <div className="text-xs text-gray-500">总仓库存消耗</div>
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-gray-600 bg-gray-100"><X size={20} /></div>
            <div>
              <div className="text-2xl font-bold text-gray-800">{summary.停补滞销 + summary.停补超铺}</div>
              <div className="text-xs text-gray-500">停补拦截（滞销{summary.停补滞销}/超铺{summary.停补超铺}）</div>
            </div>
          </div>
        </div>
      )}

      {/* 结果表 */}
      {rows.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <h3 className="text-lg font-bold text-gray-800">
              补货明细 <span className="text-sm font-normal text-gray-400 ml-2">共 {rows.length} 行 · 第 {page}/{totalPages} 页 · 每页 {PAGE_SIZE} 行</span>
            </h3>
            <div className="flex items-center gap-2">
              <button onClick={handleExportXlsx} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700">
                <Download size={14} /> 导出当前页 Excel
              </button>
              <button onClick={handleExportCsv} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                <Download size={14} /> 导出全部 CSV
              </button>
            </div>
          </div>

          <div className="overflow-auto max-h-[600px] rounded-xl border border-gray-100">
            <table className="text-xs whitespace-nowrap">
              <thead className="sticky top-0 z-10 bg-gray-50 text-gray-500 font-medium">
                <tr>
                  {ALL_COLS.map((col, i) => (
                    <th
                      key={i}
                      style={{ minWidth: col.width, left: getFrozenLeft(i), zIndex: col.key === '店铺名称' ? 20 : (i < FROZEN_COUNT ? 15 : undefined) }}
                      className={`px-2 py-2 text-left border-r border-gray-100 ${i < FROZEN_COUNT ? 'sticky bg-gray-50' : ''} ${col.hl ? 'bg-amber-50' : ''} ${col.size ? 'text-center' : ''}`}
                      onClick={() => {
                        const k = col.size ? 'sizes.' + col.key : col.key;
                        if (sortKey === k) { if (sortDir === 'asc') setSortDir('desc'); else { setSortKey(null); setSortDir('asc'); } }
                        else { setSortKey(k); setSortDir('asc'); }
                      }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageData.map((row, ri) => (
                  <tr key={ri} className="border-t border-gray-50 hover:bg-blue-50/40">
                    {ALL_COLS.map((col, ci) => {
                      const v = cellValue(row, col);
                      const isFrozen = ci < FROZEN_COUNT;
                      const hl = col.hl && Number(v) > 0;
                      return (
                        <td
                          key={ci}
                          style={{ minWidth: col.width, left: getFrozenLeft(ci), zIndex: isFrozen ? 5 : undefined }}
                          className={`px-2 py-1.5 border-r border-gray-50 ${isFrozen ? 'sticky bg-white font-medium text-gray-800' : ''} ${col.size ? 'text-center' : ''} ${hl ? 'font-bold text-emerald-700' : ''} ${col.size && Number(v) > 0 ? 'text-emerald-700 font-semibold' : 'text-gray-600'}`}
                        >
                          {col.pct ? (Number(v) * 100).toFixed(0) + '%' : Number.isFinite(Number(v)) && typeof v === 'number' ? v.toLocaleString('zh-CN', { useGrouping: false }) : (v ?? '-')}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-4">
            <span className="text-sm text-gray-500">
              建议补货总量 <span className="font-bold text-emerald-600">{rows.reduce((s, r) => s + r.实际补货合计, 0).toLocaleString('zh-CN', { useGrouping: false })}</span> 双
            </span>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="p-1.5 border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50"><ChevronLeft size={15} /></button>
              <span className="px-2 text-sm text-gray-600">{page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="p-1.5 border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50"><ChevronRight size={15} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== 历史记录 ====================

function HistoryPanel({ showToast }: { showToast: (m: string) => void }) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewRows, setViewRows] = useState<ResultRow[]>([]);
  const [viewBatch, setViewBatch] = useState('');
  const [viewLoading, setViewLoading] = useState(false);

  const loadHistory = () => {
    setLoading(true);
    fetchHistory().then(res => { if (res.data.success) setHistory(res.data.data || []); })
      .catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { loadHistory(); }, []);

  const viewBatchResults = async (batchId: string) => {
    setViewLoading(true); setViewBatch(batchId);
    try {
      const all: ResultRow[] = [];
      let page = 1;
      let total = Infinity;
      while (all.length < total) {
        const res = await fetchResults(batchId, page, 500);
        const d = res.data.data;
        all.push(...d.rows);
        total = d.total;
        page++;
        if (page > 50) break; // 安全上限
      }
      setViewRows(all);
    } catch (e: any) {
      showToast('加载失败：' + e.message);
      setViewRows([]);
    } finally { setViewLoading(false); }
  };

  const handleDelete = async (batchId: string) => {
    if (!window.confirm('确定删除该批次记录？')) return;
    try { await deleteHistory(batchId); loadHistory(); if (viewBatch === batchId) { setViewRows([]); setViewBatch(''); } } catch {}
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center gap-2 mb-4">
        <HistoryIcon size={18} className="text-blue-600" />
        <h3 className="text-lg font-bold text-gray-800">计算历史记录</h3>
      </div>
      {loading ? (
        <div className="text-center py-10 text-gray-400">加载中...</div>
      ) : history.length === 0 ? (
        <p className="text-sm text-gray-400 py-10 text-center border border-dashed border-gray-200 rounded-xl">暂无计算记录</p>
      ) : (
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">计算时间</th>
                <th className="px-3 py-2 text-right">店铺数</th>
                <th className="px-3 py-2 text-right">款色数</th>
                <th className="px-3 py-2 text-right">理论补货</th>
                <th className="px-3 py-2 text-right">实际补货</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {history.map(h => (
                <tr key={h.batchId} className="border-t border-gray-50 hover:bg-blue-50/40">
                  <td className="px-3 py-2">{h.计算时间 ? h.计算时间.replace('T', ' ').slice(0, 19) : '-'}</td>
                  <td className="px-3 py-2 text-right">{h.店数}</td>
                  <td className="px-3 py-2 text-right">{h.款色数}</td>
                  <td className="px-3 py-2 text-right">{h.理论补货?.toLocaleString('zh-CN', { useGrouping: false })}</td>
                  <td className="px-3 py-2 text-right font-semibold text-emerald-600">{h.实际补货?.toLocaleString('zh-CN', { useGrouping: false })}</td>
                  <td className="px-3 py-2 text-right space-x-2">
                    <button onClick={() => viewBatchResults(h.batchId)} className="px-2.5 py-1 bg-blue-50 text-blue-600 rounded-lg text-xs hover:bg-blue-100">查看</button>
                    <button onClick={() => handleDelete(h.batchId)} className="px-2.5 py-1 bg-red-50 text-red-600 rounded-lg text-xs hover:bg-red-100">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewLoading && <div className="text-center py-6 text-gray-400">加载批次结果...</div>}
      {viewRows.length > 0 && !viewLoading && (
        <div className="mt-6">
          <h4 className="text-sm font-bold text-gray-700 mb-2">批次明细（{viewBatch}） · 共 {viewRows.length} 行</h4>
          <div className="overflow-auto max-h-[480px] rounded-xl border border-gray-100">
            <table className="text-xs whitespace-nowrap w-full">
              <thead className="sticky top-0 bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-2 py-2 text-left">店铺名称</th>
                  <th className="px-2 py-2 text-left">商品代码</th>
                  <th className="px-2 py-2 text-left">颜色名称</th>
                  {SIZE_COLS.map(s => <th key={s} className="px-1.5 py-2 text-center">{s}</th>)}
                  <th className="px-2 py-2 text-center">合计</th>
                  <th className="px-2 py-2 text-left">状态</th>
                </tr>
              </thead>
              <tbody>
                {viewRows.map((r, i) => {
                  const total = Object.values(r.sizes || {}).reduce((a, b) => a + b, 0);
                  return (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="px-2 py-1.5 font-medium">{r.店铺名称}</td>
                      <td className="px-2 py-1.5 font-mono">{r.商品代码}</td>
                      <td className="px-2 py-1.5">{r.颜色名称}</td>
                      {SIZE_COLS.map(s => <td key={s} className={`px-1.5 py-1.5 text-center ${(r.sizes?.[s] || 0) > 0 ? 'text-emerald-700 font-semibold' : 'text-gray-400'}`}>{r.sizes?.[s] || '-'}</td>)}
                      <td className="px-2 py-1.5 text-center font-bold text-emerald-700">{total}</td>
                      <td className="px-2 py-1.5">{r.状态}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default AutoReplenishPage;
