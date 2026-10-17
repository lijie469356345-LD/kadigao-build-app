import { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import {
  getPkTaskOrders, PkTaskOrder,
  getPkDimensions,
  getPkTargets, PkTargetRow,
  confirmPkDimensions, exportPkDimensions, importPkDimensions, PkDimensionGroup,
} from '../../api/pk';
import { Save, Layers, FileSpreadsheet, ClipboardList, AlertTriangle, Plus, X, Trash2, Users, Check, Upload, Pencil, Palette, Tag, ChevronDown, ChevronUp } from 'lucide-react';

// 候选维度：来自本任务单店铺目标（店铺目标 → 维度设定），用户自定义 PK组别
interface DimCandidate {
  dimName: string;
  /** 用户自定义报表展示名称（PK报表赛区标题居中放大显示；空则回退 dimName） */
  displayName: string;
  values: string[];                // 目标中出现过的全部值（去重、按出现顺序）
  groups: PkDimensionGroup[];      // 用户创建的 PK组别（组名 + 值）
  showNew: boolean;                // 是否展开「新增PK组别」表单
  draftName: string;               // 新组别名称草稿
  draftPicked: Record<string, boolean>; // 新组别勾选的值草稿
  draftColors: Record<string, string>;  // 新组别中各值选定的PK颜色（值→hex）
  collapsed: boolean;              // 该维度是否折叠（各维度独立折叠，互不影响）
}

// 组别配色（红蓝绿循环，与报表赛区展示一致）
const GROUP_TONES = [
  { dot: 'bg-red-500', chip: 'bg-red-50 text-red-700 border-red-300', ring: 'hover:ring-red-200' },
  { dot: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700 border-blue-300', ring: 'hover:ring-blue-200' },
  { dot: 'bg-green-500', chip: 'bg-green-50 text-green-700 border-green-300', ring: 'hover:ring-green-200' },
];

// 值可选PK颜色：10 个高对比度色，用户为每个值指定后报表按该颜色展示
const VALUE_COLORS = [
  { name: '红色', hex: '#E53935' },
  { name: '橙色', hex: '#FB8C00' },
  { name: '黄色', hex: '#FDD835' },
  { name: '绿色', hex: '#43A047' },
  { name: '青色', hex: '#00ACC1' },
  { name: '蓝色', hex: '#1E88E5' },
  { name: '紫色', hex: '#8E24AA' },
  { name: '品红', hex: '#D81B60' },
  { name: '靛蓝', hex: '#3949AB' },
  { name: '棕灰', hex: '#546E7A' },
];

/** 根据背景色亮度决定 chip 文字色（亮底深字 / 暗底白字） */
function chipTextColor(hex: string): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#1f2937' : '#ffffff';
}

function PkDimensionPage() {
  const [taskOrders, setTaskOrders] = useState<PkTaskOrder[]>([]);
  const [orderId, setOrderId] = useState<number | ''>('');
  const [dims, setDims] = useState<DimCandidate[]>([]);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 正在编辑的组别（di 维度下标 / gi 组下标 / editName 组名草稿 / editPicked 勾选的值草稿 / editColors 值→PK颜色；null = 未编辑）
  const [editing, setEditing] = useState<{ di: number; gi: number; editName: string; editPicked: Record<string, boolean>; editColors: Record<string, string> } | null>(null);
  // 编辑面板中当前展开颜色色板的值（同一时刻只展开一个）
  const [editingColorFor, setEditingColorFor] = useState<string | null>(null);
  // 新增组别表单中当前展开颜色色板的值（同一时刻只展开一个）
  const [draftColorFor, setDraftColorFor] = useState<string | null>(null);

  const currentOrder = taskOrders.find(o => o.id === orderId) || null;

  const loadTaskOrders = async () => {
    const res = await getPkTaskOrders();
    const list: PkTaskOrder[] = Array.isArray(res.data) ? res.data : [];
    setTaskOrders(list);
    return list;
  };

  const groupingCount = (d: DimCandidate) => {
    const set = new Set<string>();
    d.groups.forEach(g => (g.values || []).forEach(v => set.add(v)));
    return set.size;
  };

  // 从店铺目标聚合候选维度与取值，并以已确认组别（PK_Dimensions.groups）回显
  const load = async () => {
    if (orderId === '') { setDims([]); setConfirmedCount(0); return; }
    setLoading(true);
    try {
      const [targetRes, dimRes] = await Promise.all([
        getPkTargets({ taskOrderId: orderId }),
        getPkDimensions({ taskOrderId: orderId }),
      ]);
      const targets: PkTargetRow[] = Array.isArray(targetRes.data) ? targetRes.data : [];
      const confirmed: any[] = Array.isArray(dimRes.data) ? dimRes.data : [];

      // 聚合目标中的维度 → 值（去重保持出现顺序）
      const agg = new Map<string, string[]>();
      (targets || []).forEach(t => {
        (t.dims || []).forEach(d => {
          const name = String(d.name || '').trim();
          const value = String(d.value || '').trim();
          if (!name || !value) return;
          if (!agg.has(name)) agg.set(name, []);
          const list = agg.get(name)!;
          if (!list.includes(value)) list.push(value);
        });
      });

      // 已确认维度组别回显（含自定义报表展示名称）
      const confirmedMap = new Map<string, { displayName: string; groups: PkDimensionGroup[] }>();
      (confirmed || []).forEach(c => {
        const gs: PkDimensionGroup[] = ((c && c.groups) || [])
          .map((g: any) => {
            const gv = Array.isArray(g && g.values) ? (g.values as any[]).map((v: any) => String(v).trim()).filter(Boolean) : [];
            const gm = g && g.colorMap && typeof g.colorMap === 'object' && !Array.isArray(g.colorMap) ? g.colorMap : undefined;
            const colorMap: Record<string, string> | undefined = gm
              ? Object.fromEntries(Object.entries(gm as Record<string, string>).filter(([k, v]) => gv.includes(k) && typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)))
              : undefined;
            return { groupName: String(g && g.groupName || '').trim(), values: gv, colorMap: colorMap && Object.keys(colorMap).length > 0 ? colorMap : undefined };
          })
          .filter((g: PkDimensionGroup) => g.groupName !== '' && g.values.length > 0);
        if (gs.length > 0) confirmedMap.set(String(c.dimName || '').trim(), { displayName: String(c.displayName || '').trim(), groups: gs });
      });

      const candidates: DimCandidate[] = [...agg.entries()].map(([dimName, values]) => {
        // 回显时剔除不再出现在目标中的值，避免幽灵值
        const saved = (confirmedMap.get(dimName)?.groups || []).map(g => {
          const gv = g.values.filter(v => values.includes(v));
          const colorMap = g.colorMap && Object.keys(g.colorMap).length > 0
            ? Object.fromEntries(Object.entries(g.colorMap).filter(([k]) => gv.includes(k)))
            : undefined;
          return {
            groupName: g.groupName,
            values: gv,
            colorMap: colorMap && Object.keys(colorMap).length > 0 ? colorMap : undefined,
          };
        }).filter(g => g.values.length > 0);
        return {
          dimName,
          displayName: confirmedMap.get(dimName)?.displayName || '',
          values,
          groups: JSON.parse(JSON.stringify(saved)),
          showNew: false,
          draftName: '',
          draftPicked: {},
          draftColors: {},
          collapsed: false,
        };
      });
      setDims(candidates);
      setConfirmedCount([...confirmedMap.keys()].length);
    } catch (e: any) {
      alert(e?.response?.data?.error || '加载维度候选失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTaskOrders().then(list => {
      if (list.length > 0) setOrderId(list[0].id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [orderId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps

  /** 某个值是否已进入某组 */
  const isGrouped = (d: DimCandidate, v: string) => d.groups.some(g => (g.values || []).includes(v));

  const openNewGroup = (di: number) => {
    setDims(prev => prev.map((d, i) => i !== di ? d : { ...d, showNew: true, draftName: '', draftPicked: {}, draftColors: {} }));
  };

  const closeNewGroup = (di: number) => {
    setDims(prev => prev.map((d, i) => i !== di ? d : { ...d, showNew: false, draftName: '', draftPicked: {}, draftColors: {} }));
  };

  const setDraftName = (di: number, name: string) => {
    setDims(prev => prev.map((d, i) => i !== di ? d : { ...d, draftName: name }));
  };

  /** 设置维度自定义报表展示名称（PK报表赛区标题居中放大显示） */
  const setDisplayName = (di: number, name: string) => {
    setDims(prev => prev.map((d, i) => i !== di ? d : { ...d, displayName: name }));
  };

  /** 折叠/展开某个维度（各维度独立折叠，互不影响其他维度） */
  const toggleCollapsed = (di: number) => {
    setDims(prev => prev.map((d, i) => i !== di ? d : { ...d, collapsed: !d.collapsed }));
  };

  const toggleDraftPick = (di: number, v: string) => {
    setDims(prev => prev.map((d, i) => {
      if (i !== di) return d;
      return { ...d, draftPicked: { ...d.draftPicked, [v]: !d.draftPicked[v] } };
    }));
  };

  /** 新增组别草稿中为某个值设置PK颜色（再次点击同一颜色取消；选色时自动勾选纳入本组） */
  const setDraftColor = (di: number, v: string, hex: string) => {
    setDims(prev => prev.map((d, i) => {
      if (i !== di) return d;
      const colors = { ...d.draftColors };
      if (colors[v] === hex) delete colors[v];
      else colors[v] = hex;
      return { ...d, draftColors: colors, draftPicked: { ...d.draftPicked, [v]: true } };
    }));
  };

  /** 新增PK组别：从候选值中勾选入组（值可重复参与多个组别） */
  const addGroup = (di: number) => {
    const dim = dims[di];
    const name = dim.draftName.trim();
    if (!name) { alert('请输入PK组别名称'); return; }
    const picked = dim.values.filter(v => dim.draftPicked[v]);
    if (picked.length === 0) { alert('请至少勾选一个候选值归入该组'); return; }
    const colorMap: Record<string, string> = {};
    picked.forEach(v => { if (dim.draftColors[v]) colorMap[v] = dim.draftColors[v]; });
    setDims(prev => prev.map((d, i) => i !== di
      ? d
      : { ...d, groups: [...d.groups, { groupName: name, values: picked, colorMap: Object.keys(colorMap).length > 0 ? colorMap : undefined }], showNew: false, draftName: '', draftPicked: {}, draftColors: {} }));
  };

  /** 开始编辑组别：载入组名、组内值勾选草稿与值颜色 */
  const openEditGroup = (di: number, gi: number) => {
    const g = dims[di].groups[gi];
    const editPicked: Record<string, boolean> = {};
    (g.values || []).forEach(v => { editPicked[v] = true; });
    const editColors: Record<string, string> = {};
    const cm = g.colorMap || {};
    Object.keys(cm).forEach(k => { if (cm[k]) editColors[k] = cm[k]; });
    setEditing({ di, gi, editName: g.groupName, editPicked, editColors });
    setEditingColorFor(null);
  };

  /** 切换编辑态中某个值的勾选 */
  const toggleEditPick = (di: number, v: string) => {
    setEditing(prev => {
      if (!prev || prev.di !== di) return prev;
      return { ...prev, editPicked: { ...prev.editPicked, [v]: !prev.editPicked[v] } };
    });
  };

  /** 编辑态中为某个值设置PK颜色（再次点击同一颜色取消该值配色；选色时自动将该值纳入本组） */
  const setEditValueColor = (di: number, v: string, hex: string) => {
    setEditing(prev => {
      if (!prev || prev.di !== di) return prev;
      const colors = { ...prev.editColors };
      if (colors[v] === hex) delete colors[v];
      else colors[v] = hex;
      return { ...prev, editColors: colors, editPicked: { ...prev.editPicked, [v]: true } };
    });
  };

  /** 保存组别编辑：更新组名、组内值与值颜色 */
  const saveEditGroup = () => {
    if (!editing) return;
    const { di, gi } = editing;
    const name = editing.editName.trim();
    if (!name) { alert('请输入PK组别名称'); return; }
    const picked = dims[di].values.filter(v => editing.editPicked[v]);
    if (picked.length === 0) { alert('请至少勾选一个候选值保留在组内'); return; }
    const colorMap: Record<string, string> = {};
    picked.forEach(v => { if (editing.editColors[v]) colorMap[v] = editing.editColors[v]; });
    setDims(prev => prev.map((d, i) => {
      if (i !== di) return d;
      return {
        ...d,
        groups: d.groups.map((g, j) => j !== gi ? g : { groupName: name, values: picked, colorMap: Object.keys(colorMap).length > 0 ? colorMap : undefined }),
      };
    }));
    setEditing(null);
    setEditingColorFor(null);
  };

  /** 从组中移除单个值（同步清除该值的PK颜色） */
  const removeGroupValue = (di: number, gi: number, v: string) => {
    setDims(prev => prev.map((d, i) => {
      if (i !== di) return d;
      const groups = d.groups.map((g, j) => {
        if (j !== gi) return g;
        const values = g.values.filter(x => x !== v);
        let colorMap = g.colorMap;
        if (colorMap && colorMap[v]) {
          const cm = { ...colorMap };
          delete cm[v];
          colorMap = Object.keys(cm).length > 0 ? cm : undefined;
        }
        return { ...g, values, colorMap };
      });
      return { ...d, groups };
    }));
  };

  /** 删除整个PK组别 */
  const removeGroup = (di: number, gi: number) => {
    const dim = dims[di];
    const g = dim.groups[gi];
    if (!confirm(`确定删除PK组别「${g.groupName}」？该组将不再参与PK，其余组别不受影响。`)) return;
    setDims(prev => prev.map((d, i) => {
      if (i !== di) return d;
      return { ...d, groups: d.groups.filter((_, j) => j !== gi) };
    }));
  };

  // 确认保存：全量覆盖该任务单维度组别（仅保留含有效值组的维度）
  const handleSave = async () => {
    if (orderId === '') { alert('请先选择 PK任务单'); return; }
    const payload = dims
      .map(d => ({
        dimName: d.dimName,
        displayName: d.displayName.trim(),
        groups: d.groups
          .map(g => ({
            groupName: g.groupName.trim(),
            values: (g.values || []).filter(Boolean),
            colorMap: g.colorMap && Object.keys(g.colorMap).length > 0 ? g.colorMap : undefined,
          }))
          .filter(g => g.groupName !== '' && g.values.length > 0),
      }))
      .filter(d => d.groups.length > 0);
    if (payload.length === 0) {
      if (!confirm('当前未创建任何PK组别，确认后该任务单将没有可PK维度，PK报表不显示赛区。是否继续？')) return;
    }
    setSaving(true);
    try {
      const res = await confirmPkDimensions({ taskOrderId: orderId as number, dims: payload });
      const saved = Number(res.data?.saved) || payload.length;
      setConfirmedCount(saved);
      alert(`确认成功：${saved} 个维度已按PK组别确认参与PK。\nPK报表将按组别展示各维度PK结果。`);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || '确认失败');
    } finally {
      setSaving(false);
    }
  };

  // 导出当前任务单 PK维度组别（xlsx，服务端生成，列结构与导入一致可回导）
  const handleExport = async () => {
    if (orderId === '') { alert('请先选择 PK任务单'); return; }
    const display = dims
      .map(d => ({
        dimName: d.dimName,
        groups: d.groups.filter(g => g.groupName.trim() && g.values.length > 0),
      }))
      .filter(d => d.groups.length > 0);
    if (display.length === 0) { alert('当前没有已确认的PK组别可导出'); return; }
    try {
      const res = await exportPkDimensions({ taskOrderId: orderId as number });
      const blob = res.data as Blob;
      const disposition: string = String(res.headers?.['content-disposition'] || '');
      let filename = `PK维度组别_${currentOrder?.orderName || ''}_${new Date().toISOString().slice(0, 10)}.xlsx`;
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
    }
  };

  // 选择文件并导入：全量覆盖该任务单已确认组别（维度/组别/值按 Excel 重建）
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许再次选择同一文件
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) { alert('仅支持 .xlsx / .xls 文件'); return; }
    if (!confirm(`导入将全量覆盖任务单「${currentOrder?.orderName || ''}」当前已确认的 PK组别（维度/组别/组内值按文件重建），是否继续？`)) return;
    setImporting(true);
    try {
      const res = await importPkDimensions(orderId as number, file);
      const data = (res.data || {}) as any;
      const warnings: string[] = Array.isArray(data.warnings) ? data.warnings : [];
      const savedDims: any[] = Array.isArray(data.dims) ? data.dims : [];
      const groupCount = savedDims.reduce((n, d) => n + (Array.isArray(d.groups) ? d.groups.length : 0), 0);
      const warnText = warnings.length > 0
        ? `\n\n警告 ${warnings.length} 条：\n${warnings.slice(0, 30).join('\n')}${warnings.length > 30 ? `\n…等共 ${warnings.length} 条` : ''}`
        : '';
      alert(`导入成功：${data.saved ?? 0} 个维度 / ${groupCount} 个PK组别已覆盖保存，PK报表已按新组别生效。${warnText}`);
      await load();
    } catch (err: any) {
      const data = err?.response?.data;
      const warnings: string[] = Array.isArray(data?.warnings) ? data.warnings : [];
      const msg = data?.message || data?.error || '导入失败';
      alert(`${msg}${warnings.length > 0 ? `\n\n${warnings.slice(0, 30).join('\n')}` : ''}`);
    } finally {
      setImporting(false);
    }
  };

  const selectCls = 'border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-48 focus:outline-none bg-white focus:ring-2 focus:ring-blue-200';

  return (
    <Layout title="PK维度设定" subtitle="自定义创建 PK组别：维度取值来自「PK店铺目标」，为每个维度新建组别、从候选值中勾选归组，确认后 PK报表按组别展示对拼">
      <div className="p-4">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 flex items-center gap-1"><ClipboardList size={14} /> PK任务单</span>
            <select value={orderId} onChange={e => setOrderId(e.target.value ? Number(e.target.value) : '')} className={selectCls}>
              <option value="">请选择任务单</option>
              {taskOrders.map(o => (
                <option key={o.id} value={o.id}>{o.orderName}{o.pkStartDate ? `（${o.pkStartDate} 起）` : ''}</option>
              ))}
            </select>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-sm font-medium">
            <Layers size={14} /> {currentOrder
              ? `已确认 ${confirmedCount} 个维度 / 当前候选 ${dims.length} 个维度`
              : '未选择任务单'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={orderId === '' || loading || saving || dims.length === 0}
              className="px-4 py-1.5 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-teal-700 disabled:opacity-40"
            >
              <Save size={14} /> {saving ? '确认中...' : '确认保存组别'}
            </button>
            <button
              onClick={handleExport}
              disabled={orderId === '' || loading || saving || importing || dims.length === 0}
              className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-green-700 disabled:opacity-40"
              title="导出当前任务单已确认的 PK组别（xlsx，列结构与导入一致，可直接回导）"
            >
              <FileSpreadsheet size={14} /> 导出配置
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={orderId === '' || loading || saving || importing || dims.length === 0}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-blue-700 disabled:opacity-40"
              title="从 xlsx 批量导入 PK组别，全量覆盖当前任务单已确认组别（值需存在于店铺目标中）"
            >
              <Upload size={14} /> {importing ? '导入中...' : '导入配置'}
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportFile} />
          </div>
        </div>

        <div className="mb-3 flex items-start gap-2 text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="text-blue-500 shrink-0 mt-0.5" />
          <span>数据流：先在「PK店铺目标」录入各店铺的维度取值 → 本页自动提取维度与候选值 → 新建 PK组别并从候选值中勾选归组（一个值可同时加入多个组别，重复参与对决）→ 确认后 PK报表按每个维度的组别对拼，业绩最高组为胜方。</span>
        </div>

        {!currentOrder && (
          <div className="mb-4 flex items-center gap-2 text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm">
            <ClipboardList size={16} />
            尚未选择 PK任务单。请先在「PK任务单」菜单创建任务单，再到「PK店铺目标」录入维度值。
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {loading && <div className="p-8 text-center text-gray-400 text-sm">加载中...</div>}
          {!loading && currentOrder && dims.length === 0 && (
            <div className="px-6 py-14 text-center">
              <p className="text-gray-400 text-sm mb-2">任务单「{currentOrder.orderName}」的店铺目标中还没有任何维度取值。</p>
              <p className="text-gray-400 text-sm mb-4">请先到「PK店铺目标」选择该任务单，为每个店铺录入维度值后，再回来创建 PK组别。</p>
            </div>
          )}
          {!loading && !currentOrder && (
            <div className="px-6 py-12 text-center text-gray-400 text-sm">请先选择/创建 PK任务单</div>
          )}
          {dims.length > 0 && (
            <div className="p-4 space-y-4">
              {dims.map((d, di) => {
                const groupedCount = groupingCount(d);
                return (
                  <div key={d.dimName} className="border-2 border-indigo-200 rounded-xl p-4 bg-white shadow-sm">
                    <div className="flex items-center gap-3 mb-3 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs font-bold border border-indigo-300">
                        维度 {di + 1}
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-600 text-white rounded-full text-sm font-medium">
                        <Layers size={13} /> {d.dimName}
                      </span>
                      <span className="text-xs text-gray-400">
                        候选 {d.values.length} 个值 · 已建 {d.groups.length} 个PK组 · 已参与分组 {groupedCount} 个值（可重复入组）
                      </span>
                      <button
                        onClick={() => toggleCollapsed(di)}
                        className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                        title={d.collapsed ? `展开「${d.dimName}」维度全部内容` : `折叠「${d.dimName}」维度（点击展开可恢复）`}
                      >
                        {d.collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                        {d.collapsed ? '展开' : '折叠'}
                      </button>
                    </div>

                    {!d.collapsed && (<>
                    {/* 报表展示名称：用户自定义，PK报表赛区标题居中放大显示 */}
                    <div className="flex items-center gap-2 mb-3">
                      <span className="inline-flex items-center gap-1 text-sm text-gray-500 shrink-0">
                        <Tag size={13} /> 报表展示名称
                      </span>
                      <input
                        value={d.displayName}
                        onChange={e => setDisplayName(di, e.target.value)}
                        placeholder={`如：${d.dimName}争霸 / 大区PK赛（报表赛区标题居中放大显示）`}
                        className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm w-72 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      />
                      <span className="text-xs text-gray-400">留空则报表显示「{d.dimName}」</span>
                    </div>

                    {/* PK组别区 */}
                    {d.groups.length === 0 ? (
                      <div className="mb-3 flex items-center gap-2 text-gray-400 text-xs bg-white border border-dashed border-gray-200 rounded-lg px-3 py-2.5">
                        <Users size={14} /> 尚未创建 PK组别，点击下方「新增PK组别」从候选值中分组。
                      </div>
                    ) : (
                      <div className="mb-3 grid gap-2.5">
                        {d.groups.map((g, gi) => {
                          const tone = GROUP_TONES[gi % GROUP_TONES.length];
                          const isEditing = editing && editing.di === di && editing.gi === gi;
                          if (isEditing) {
                            // ---- 组别编辑态：可改组名、增删组内值（值可重复勾选） ----
                            return (
                              <div key={`${g.groupName}-${gi}`} className="border border-teal-300 bg-teal-50/50 rounded-lg px-3 py-2.5 shadow-sm">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className={`w-2.5 h-2.5 rounded-full ${tone.dot}`} />
                                  <input
                                    value={editing.editName}
                                    onChange={e => setEditing({ ...editing, editName: e.target.value })}
                                    placeholder="组别名称"
                                    className="border border-gray-200 rounded-lg px-2 py-1 text-sm w-52 focus:outline-none bg-white focus:ring-2 focus:ring-teal-200"
                                  />
                                  <span className="text-xs text-gray-400">从候选值中勾选归入本组（可重复参与）</span>
                                </div>
                                <div className="mb-2 flex items-center gap-1.5 text-[11px] text-teal-700 bg-teal-100/60 rounded-md px-2 py-1">
                                  <Palette size={12} />
                                  每个值右侧的「选色」可为该值指定PK报表颜色（10色可选，未指定则报表按轮换色展示）
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                                  {d.values.map(v => {
                                    const picked = !!editing.editPicked[v];
                                    const vColor = editing.editColors[v];
                                    return (
                                      <span key={v} className="inline-flex items-center gap-1">
                                        <label
                                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-sm cursor-pointer select-none transition-colors ${
                                            picked
                                              ? 'bg-teal-600 border-teal-600 text-white'
                                              : 'bg-white border-gray-200 text-gray-600 hover:border-teal-300'
                                          }`}
                                        >
                                          <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={picked}
                                            onChange={() => toggleEditPick(di, v)}
                                          />
                                          <span className={`w-1.5 h-1.5 rounded-full ${picked ? 'bg-white' : 'bg-gray-300'}`} />
                                          {v}
                                        </label>
                                        <span className="relative inline-flex items-center">
                                          <button
                                            type="button"
                                            onClick={() => setEditingColorFor(editingColorFor === v ? null : v)}
                                            className={`inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                                              vColor
                                                ? 'border-transparent text-white'
                                                : 'border-gray-300 bg-white text-gray-500 hover:border-teal-400 hover:bg-teal-50 hover:text-teal-600'
                                            }`}
                                            style={vColor ? { backgroundColor: vColor, borderColor: vColor } : undefined}
                                            title={vColor ? `该值指定颜色：${vColor}（点击更换）` : '为该值选择PK颜色'}
                                          >
                                            <Palette size={10} />
                                            {vColor ? '已选' : '选色'}
                                          </button>
                                          {editingColorFor === v && (
                                            <span className="absolute top-6 left-0 z-20 flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1.5 shadow-xl">
                                              {VALUE_COLORS.map(c => (
                                                <button
                                                  key={c.hex}
                                                  type="button"
                                                  onClick={() => { setEditValueColor(di, v, c.hex); setEditingColorFor(null); }}
                                                  className={`w-5 h-5 rounded-full hover:scale-110 transition-transform ${vColor === c.hex ? 'ring-2 ring-offset-1 ring-gray-800' : ''}`}
                                                  style={{ backgroundColor: c.hex }}
                                                  title={c.name}
                                                />
                                              ))}
                                            </span>
                                          )}
                                        </span>
                                      </span>
                                    );
                                  })}
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={saveEditGroup}
                                    className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-teal-700"
                                  >
                                    <Check size={13} /> 保存修改
                                  </button>
                                  <button
                                    onClick={() => setEditing(null)}
                                    className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700"
                                  >
                                    取消
                                  </button>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div key={`${g.groupName}-${gi}`} className="group bg-white border border-gray-100 rounded-lg px-3 py-2 shadow-sm">
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className={`w-2.5 h-2.5 rounded-full ${tone.dot}`} />
                                <span className="text-sm font-semibold text-gray-700">{g.groupName}</span>
                                <span className="text-xs text-gray-400">({g.values.length} 值)</span>
                                <button
                                  onClick={() => openEditGroup(di, gi)}
                                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-600 transition-colors"
                                  title="编辑该PK组别（改组名 / 增删组内值）"
                                >
                                  <Pencil size={12} />
                                  编辑
                                </button>
                                <button
                                  onClick={() => removeGroup(di, gi)}
                                  className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600 hover:border-red-300 hover:bg-red-50 hover:text-red-600 transition-colors"
                                  title="删除该PK组别"
                                >
                                  <Trash2 size={12} />
                                  删除
                                </button>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {g.values.map(v => {
                                  const vColor = g.colorMap && g.colorMap[v];
                                  return (
                                    <span
                                      key={v}
                                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-xs ${tone.chip}`}
                                      style={vColor ? { backgroundColor: vColor, borderColor: vColor, color: chipTextColor(vColor) } : undefined}
                                    >
                                      {v}
                                      <button
                                        type="button"
                                        className="opacity-60 hover:opacity-100"
                                        title="从组中移除"
                                        onClick={() => removeGroupValue(di, gi, v)}
                                      >
                                        <X size={11} />
                                      </button>
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* 新增PK组别 */}
                    {!d.showNew ? (
                      <button
                        onClick={() => openNewGroup(di)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-teal-600 bg-teal-50 hover:bg-teal-100 rounded-lg border border-teal-200 transition-colors"
                      >
                        <Plus size={14} /> 新增PK组别
                      </button>
                    ) : (
                      <div className="border border-teal-200 bg-teal-50/40 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm text-gray-600 font-medium">组别名称</span>
                          <input
                            value={d.draftName}
                            onChange={e => setDraftName(di, e.target.value)}
                            placeholder="如：红队 / 肖 / 组A"
                            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm w-56 focus:outline-none bg-white focus:ring-2 focus:ring-teal-200"
                          />
                          <span className="text-xs text-gray-400">从候选值中勾选归入本组（一个值可加入多个组别，重复参与PK）</span>
                        </div>
                        {(() => {
                          return (
                            <div className="mb-2 flex items-center gap-1.5 text-[11px] text-teal-700 bg-teal-100/60 rounded-md px-2 py-1">
                              <Palette size={12} />
                              每个值右侧的「选色」可为该值指定PK报表颜色（10色可选，未指定则报表按轮换色展示）
                            </div>
                          );
                        })()}
                        {(() => {
                          return (
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              {d.values.map(v => {
                                const alreadyIn = d.groups.filter(g => (g.values || []).includes(v)).map(g => g.groupName);
                                const vColor = d.draftColors[v];
                                return (
                                  <span key={v} className="inline-flex items-center gap-1">
                                    <label
                                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-sm cursor-pointer select-none transition-colors ${
                                        d.draftPicked[v]
                                          ? 'bg-teal-600 border-teal-600 text-white'
                                          : 'bg-white border-gray-200 text-gray-600 hover:border-teal-300'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={!!d.draftPicked[v]}
                                        onChange={() => toggleDraftPick(di, v)}
                                      />
                                      <span className={`w-1.5 h-1.5 rounded-full ${d.draftPicked[v] ? 'bg-white' : 'bg-gray-300'}`} />
                                      {v}
                                      {alreadyIn.length > 0 && (
                                        <span className={`text-[10px] ${d.draftPicked[v] ? 'text-teal-100' : 'text-gray-400'}`}>
                                          （已在：{alreadyIn.join('、')}）
                                        </span>
                                      )}
                                    </label>
                                    <span className="relative inline-flex items-center">
                                      <button
                                        type="button"
                                        onClick={() => setDraftColorFor(draftColorFor === v ? null : v)}
                                        className={`inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                                          vColor
                                            ? 'border-transparent text-white'
                                            : 'border-gray-300 bg-white text-gray-500 hover:border-teal-400 hover:bg-teal-50 hover:text-teal-600'
                                        }`}
                                        style={vColor ? { backgroundColor: vColor, borderColor: vColor } : undefined}
                                        title={vColor ? `该值指定颜色：${vColor}（点击更换）` : '为该值选择PK颜色'}
                                      >
                                        <Palette size={10} />
                                        {vColor ? '已选' : '选色'}
                                      </button>
                                      {draftColorFor === v && (
                                        <span className="absolute top-6 left-0 z-20 flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1.5 shadow-xl">
                                          {VALUE_COLORS.map(c => (
                                            <button
                                              key={c.hex}
                                              type="button"
                                              onClick={() => { setDraftColor(di, v, c.hex); setDraftColorFor(null); }}
                                              className={`w-5 h-5 rounded-full hover:scale-110 transition-transform ${vColor === c.hex ? 'ring-2 ring-offset-1 ring-gray-800' : ''}`}
                                              style={{ backgroundColor: c.hex }}
                                              title={c.name}
                                            />
                                          ))}
                                        </span>
                                      )}
                                    </span>
                                  </span>
                                );
                              })}
                            </div>
                          );
                        })()}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => addGroup(di)}
                            className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-teal-700"
                          >
                            <Check size={13} /> 添加组别
                          </button>
                          <button
                            onClick={() => closeNewGroup(di)}
                            className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 已被归组的值提示（值可重复入组：至少归入一个组的参与PK，从未归入任何组的不参与） */}
                    {groupedCount > 0 && groupedCount < d.values.length && (
                      <div className="mt-2 text-xs text-gray-400">
                        已参与分组值：{d.values.filter(v => isGrouped(d, v)).join('、')}
                        {d.values.filter(v => !isGrouped(d, v)).length > 0 && `（未参与分组的 ${d.values.filter(v => !isGrouped(d, v)).join('、')} 不参与PK）`}
                      </div>
                    )}
                    </>)}
                  </div>
                );
              })}
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-gray-400">
                  确认后该任务单将保留 {dims.filter(d => d.groups.length > 0).length} 个维度的PK组别进入报表（每个维度一个展示区，区内组别对拼）
                </span>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-5 py-2 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-teal-700 disabled:opacity-40"
                >
                  <Save size={14} /> {saving ? '确认中...' : '确认保存组别'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

export default PkDimensionPage;