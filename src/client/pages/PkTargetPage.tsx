import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import Layout from '../components/Layout';
import {
  getPkTaskOrders, updatePkTaskOrder, PkTaskOrder,
  getPkTargets, createPkTarget, updatePkTarget, deletePkTarget, clearPkTargets, PkTargetRow,
} from '../../api/pk';
import { getShops } from '../../api/shops';
import { Plus, Search, Trash2, Save, RefreshCw, Target as TargetIcon, X, Download, Upload, FileSpreadsheet, ClipboardList } from 'lucide-react';

/**
 * 解析单行 CSV，正确处理双引号包裹的字段（Excel 导出时含逗号的单元格会被双引号包裹）。
 * 同时兼容制表符分隔。
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',' || ch === '\t') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// 兼容 UTF-8 / GBK(ANSI) 编码的 csv/txt 文本解码
function decodeCsvText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const utf8Text = new TextDecoder('utf-8').decode(bytes);
  if (utf8Text.indexOf('\uFFFD') !== -1) {
    try {
      return new TextDecoder('gbk').decode(bytes).replace(/^\uFEFF/, '');
    } catch {
      return utf8Text.replace(/^\uFEFF/, '');
    }
  }
  return utf8Text.replace(/^\uFEFF/, '');
}

// 将 Excel 日期单元格（序列号 / Date / 字符串）规范为 YYYY-MM-DD
function normalizeDateCell(v: any): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }
  const s = String(v).trim().replace(/\//g, '-');
  return /^\d{4}-\d{1,2}-\d{1,2}/.test(s) ? s : s;
}

// 行编辑态：dims 存 {维度名: 值}
interface EditRow {
  id?: number;
  pkName: string;
  pkStartTime: string;
  shopName: string;
  target: number | string;
  heroMark: string;
  dims: Record<string, string>;
}

function PkTargetPage() {
  const [taskOrders, setTaskOrders] = useState<PkTaskOrder[]>([]);
  const [orderId, setOrderId] = useState<number | ''>('');
  const [rows, setRows] = useState<PkTargetRow[]>([]);
  const [shops, setShops] = useState<string[]>([]);
  const [pkNameFilter, setPkNameFilter] = useState<string>('');
  // 快速搜索：本地即时过滤关键词（匹配 店铺名称/PK名称/目标/维度值），不触发服务端请求
  const [quickSearch, setQuickSearch] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const currentOrder = taskOrders.find(o => o.id === orderId) || null;
  // 维度列直接取自任务单模板（店铺目标先确定维度与取值，PK维度设定从中确认谁PK谁）
  const dimColumns = useMemo(
    () => (currentOrder?.dimColumns && currentOrder.dimColumns.length > 0 ? currentOrder.dimColumns : []),
    [currentOrder]
  );

  // 快速搜索：在已加载的店铺目标中即时过滤（店铺名称 / PK名称 / 目标 / 维度值），区分大小写不敏感
  const displayRows = useMemo(() => {
    const q = quickSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => {
      const dimText = (r.dims || []).map(d => d.value).join(' ');
      return [r.shopName, r.pkName, String(r.target ?? ''), dimText].join(' ').toLowerCase().includes(q);
    });
  }, [rows, quickSearch]);

  const loadShops = async () => {
    try {
      const res = await getShops();
      const names = (Array.isArray(res) ? res : []).map((s: any) => s.shopName || '').filter(Boolean);
      setShops(Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, 'zh-CN')));
    } catch { setShops([]); }
  };

  const loadTaskOrders = async () => {
    const res = await getPkTaskOrders();
    const list: PkTaskOrder[] = Array.isArray(res.data) ? res.data : [];
    setTaskOrders(list);
    return list;
  };

  const load = async () => {
    if (orderId === '') { setRows([]); return; }
    setLoading(true);
    try {
      const targetRes = await getPkTargets({ taskOrderId: orderId, pkName: pkNameFilter || undefined });
      setRows(Array.isArray(targetRes.data) ? targetRes.data : []);
    } catch (e: any) {
      alert(e?.response?.data?.error || '加载PK店铺目标失败');
    } finally {
      setLoading(false);
    }
  };

  // 首次加载：店铺 + 任务单（默认选最新一个）
  useEffect(() => {
    loadShops();
    loadTaskOrders().then(list => {
      if (list.length > 0) setOrderId(list[0].id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 任务单变化时复位 PK 筛选并重新加载
  useEffect(() => { setPkNameFilter(''); }, [orderId]);
  useEffect(() => { load(); }, [orderId, pkNameFilter]);
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // 新行模板：PK名称/开始时间由任务单自动带出，维度列按任务单模板
  const emptyRow = (): EditRow => {
    const dims: Record<string, string> = {};
    dimColumns.forEach(col => { dims[col] = ''; });
    return {
      pkName: currentOrder ? currentOrder.orderName : '',
      pkStartTime: currentOrder ? currentOrder.pkStartDate : '',
      shopName: '', target: '', heroMark: '', dims,
    };
  };
  const [newRow, setNewRow] = useState<EditRow | null>(null);
  const [editRows, setEditRows] = useState<Record<number, EditRow>>({});

  const toEditRow = (r: PkTargetRow): EditRow => {
    const dims: Record<string, string> = {};
    dimColumns.forEach(col => { dims[col] = ''; });
    (r.dims || []).forEach(d => { dims[d.name] = d.value; });
    return { id: r.id, pkName: r.pkName, pkStartTime: r.pkStartTime, shopName: r.shopName, target: r.target, heroMark: r.heroMark || '', dims };
  };

  const getEditRow = (r: PkTargetRow): EditRow => {
    if (r.id != null && editRows[r.id]) return editRows[r.id];
    return toEditRow(r);
  };

  const patchEditRow = (id: number, patch: Partial<EditRow>) => {
    setEditRows(prev => {
      const base = prev[id] ? prev[id] : toEditRow(rows.find(r => r.id === id)!);
      return { ...prev, [id]: { ...base, ...patch } };
    });
  };

  const toPayload = (er: EditRow): PkTargetRow => ({
    pkName: currentOrder ? currentOrder.orderName : er.pkName,
    pkStartTime: currentOrder ? currentOrder.pkStartDate : er.pkStartTime,
    shopName: er.shopName,
    target: Number(er.target) || 0,
    heroMark: er.heroMark,
    dims: Object.entries(er.dims).filter(([, v]) => String(v).trim() !== '').map(([name, value]) => ({ name, value })),
    taskOrderId: orderId === '' ? undefined : orderId,
  });

  const handleSaveNew = async () => {
    if (!newRow) return;
    if (!currentOrder) { alert('请先选择 PK任务单'); return; }
    if (!newRow.shopName.trim()) { alert('请选择店铺'); return; }
    try {
      await createPkTarget(toPayload(newRow));
      setNewRow(null);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || '保存失败');
    }
  };

  const handleSaveEdit = async (r: PkTargetRow) => {
    const er = editRows[r.id!];
    if (!er.shopName.trim()) { alert('店铺名称必填'); return; }
    try {
      await updatePkTarget(r.id!, toPayload(er));
      setEditRows(prev => { const { [r.id!]: _drop, ...rest } = prev; return rest; });
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || '保存失败');
    }
  };

  const handleDelete = async (r: PkTargetRow) => {
    if (!confirm(`删除店铺「${r.shopName}」在 PK「${r.pkName}」中的目标记录？`)) return;
    try {
      if (r.id != null) await deletePkTarget(r.id);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || '删除失败');
    }
  };

  // 清空任务单目标：mode = 'order' 清空当前任务单；mode = 'all' 清空全部任务单
  const handleClear = async (mode: 'order' | 'all') => {
    if (mode === 'order' && orderId === '') { alert('请先选择 PK任务单'); return; }
    const scope = mode === 'order'
      ? `任务单「${currentOrder?.orderName || ''}」`
      : '全部任务单';
    if (!confirm(`确定清空 ${scope} 下的全部店铺目标吗？\n此操作不可恢复，请谨慎操作。`)) return;
    try {
      await clearPkTargets(mode === 'order' ? { taskOrderId: orderId as number } : undefined);
      await load();
      alert(`已清空 ${scope} 的店铺目标`);
    } catch (e: any) {
      alert(e?.response?.data?.error || '清空失败');
    }
  };

  // 添加维度列：点击后弹出输入框，确认后追加到任务单 dimColumns（列名按"维度N"自动编号，可自定义）
  const [dimModalOpen, setDimModalOpen] = useState(false);
  const [dimName, setDimName] = useState('');
  const handleAddDimension = () => {
    if (orderId === '') { alert('请先选择 PK任务单'); return; }
    if (!currentOrder) return;
    const used = new Set(dimColumns);
    let n = 1;
    while (used.has(`维度${n}`)) n++;
    setDimName(`维度${n}`);
    setDimModalOpen(true);
  };
  const handleConfirmAddDimension = async () => {
    if (!currentOrder) return;
    const name = dimName.trim();
    if (!name) { alert('请输入维度列名称'); return; }
    if (dimColumns.some(c => c === name)) { alert('该维度列名称已存在'); return; }
    try {
      await updatePkTaskOrder(currentOrder.id, { dimColumns: [...dimColumns, name] });
      const list = await loadTaskOrders();
      setTaskOrders(list);
      setNewRow(prev => {
        if (!prev) return prev;
        return { ...prev, dims: { ...prev.dims, [name]: '' } };
      });
      setDimModalOpen(false);
      setDimName('');
    } catch (e: any) {
      alert(e?.response?.data?.error || '添加维度列失败');
    }
  };

  // 删除维度列：从任务单 dimColumns 移除（该列不再录入；已录入值保留在目标中，
  // 但只要未确认进 PK维度设定，PK报表中就不会出现）
  const handleDeleteDimension = async (col: string) => {
    if (!currentOrder) return;
    if (!confirm(`确定删除维度列「${col}」吗？\n该列将不再显示与录入；若已在「PK维度设定」确认，请到该页重新确认后即可从PK报表移除。`)) return;
    try {
      await updatePkTaskOrder(currentOrder.id, { dimColumns: dimColumns.filter(c => c !== col) });
      const list = await loadTaskOrders();
      setTaskOrders(list);
    } catch (e: any) {
      alert(e?.response?.data?.error || '删除维度列失败');
    }
  };

  // ---------- 批量导入 / 模板下载 / 导出（参照月目标模块） ----------

  // 下载导入模板：表头按任务单维度列 + 全部系统店铺行（PK名称/开始时间由当前任务单带出）
  const handleDownloadTemplate = () => {
    if (!currentOrder) { alert('请先选择 PK任务单'); return; }
    const header = ['PK名称', 'PK开始时间', '店铺名称', '目标', '英雄标', ...dimColumns];
    const rows: any[][] = [
      header,
      ...shops.map(s => [currentOrder.orderName, currentOrder.pkStartDate, s, '', '', ...dimColumns.map(() => '')]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, ...dimColumns.map(() => ({ wch: 12 }))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PK店铺目标模板');
    XLSX.writeFile(wb, `PK店铺目标_导入模板_${currentOrder.orderName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // 逐行校验并导入：PK名称/开始时间一律取当前任务单；店铺须精确匹配；目标须为有效数字；维度值任意文本（空=未填）
  // 兼容新旧模板：新模板含"英雄标"列（在目标之后、维度之前）；旧模板无该列，英雄标留空、维度从第5列起
  const importRows = async (rowsIn: any[][]) => {
    if (!currentOrder) { alert('请先选择 PK任务单'); return; }
    const cols = dimColumns;
    const shopSet = new Set(shops);
    let ok = 0;
    let fail = 0;
    const errors: string[] = [];
    let lineNo = 0;
    // 检测模板是否含"英雄标"列：首个含表头关键词的行，若任一单元格为"英雄标"则维度从 index 5 起，否则从 4 起
    let heroMarkCol = false;
    for (const row of rowsIn) {
      const cells = (row || []).map(c => c == null ? '' : String(c).trim());
      const joined = cells.join(' ');
      if (/PK名称/.test(joined) || /店铺名称/.test(joined) || /目标/.test(joined)) {
        heroMarkCol = cells.some(c => c === '英雄标');
        break;
      }
    }
    const dimStart = heroMarkCol ? 5 : 4;
    const batch: Promise<any>[] = [];
    for (const row of rowsIn) {
      lineNo++;
      const cells = (row || []).map(c => c == null ? '' : String(c).trim());
      if (cells.length < 4) continue;
      const joined = cells.join(' ');
      if (lineNo === 1 && /(PK名称|店铺名称|目标|维度)/.test(joined)) continue; // 表头行
      const reasons: string[] = [];
      const pkName = currentOrder.orderName;
      const pkStartTime = currentOrder.pkStartDate;
      const shopName = cells[2];
      if (!shopName || !shopSet.has(shopName)) reasons.push(`店铺「${shopName || '空'}」不在系统中`);
      const target = cells[3].replace(/,/g, '');
      if (target === '' || !isFinite(Number(target))) reasons.push('目标非有效数字');
      const heroMark = heroMarkCol ? (cells[4] || '') : '';
      const dims: { name: string; value: string }[] = [];
      cols.forEach((col, i) => {
        const cellVal = cells[dimStart + i] || '';
        if (!cellVal) return; // 空=未填
        dims.push({ name: col, value: cellVal });
      });
      if (reasons.length > 0) {
        fail++;
        if (errors.length < 8) errors.push(`第${lineNo}行：${reasons.join('；')}`);
        continue;
      }
      batch.push(
        createPkTarget({
          pkName, pkStartTime, shopName, target: Number(target), heroMark,
          dims, taskOrderId: orderId === '' ? undefined : orderId,
        }).then(() => { ok++; }).catch((e: any) => {
          fail++;
          if (errors.length < 8) errors.push(`第${lineNo}行写入失败：${e?.response?.data?.error || e?.message || '未知错误'}`);
        })
      );
      if (batch.length >= 20) { await Promise.all(batch); batch.length = 0; }
    }
    if (batch.length > 0) await Promise.all(batch);
    await load();
    let msg = `导入完成：成功 ${ok} 条，失败 ${fail} 条。`;
    if (errors.length > 0) msg += `\n\n${errors.join('\n')}`;
    if (fail > errors.length) msg += `\n...等共 ${fail} 行失败`;
    alert(msg);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
    if (isExcel) {
      if (fileName.endsWith('.xls')) {
        alert('检测到 .xls 格式，中文支持有限。请用 Excel / WPS「另存为」.xlsx 后再上传。');
        if (fileRef.current) fileRef.current.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = new Uint8Array(ev.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheet = workbook.SheetNames[0];
          if (!firstSheet) { alert('Excel 文件中没有工作表'); return; }
          const rowsIn: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { header: 1, defval: '' }) as any[][];
          importRows(rowsIn);
        } catch (err) {
          console.error('解析Excel失败:', err);
          alert('解析 Excel 文件失败，请确认文件格式正确');
        }
      };
      reader.onerror = () => alert('读取文件失败，请重试');
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = decodeCsvText(ev.target?.result as ArrayBuffer);
        importRows(text.split(/\r?\n/).map(l => parseCsvLine(l)));
      };
      reader.onerror = () => alert('读取文件失败，请重试');
      reader.readAsArrayBuffer(file);
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  // 导出当前任务单筛选列表为 Excel
  const handleExport = () => {
    if (rows.length === 0) { alert('当前没有可导出的数据'); return; }
    const header = ['PK名称', 'PK开始时间', '店铺名称', '目标', '英雄标', ...dimColumns];
    const aoa: any[][] = [header];
    rows.forEach(r => {
      const dm: Record<string, string> = {};
      (r.dims || []).forEach(d => { dm[d.name] = d.value; });
      aoa.push([r.pkName, r.pkStartTime, r.shopName, r.target, r.heroMark || '', ...dimColumns.map(col => dm[col] || '')]);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, ...dimColumns.map(() => ({ wch: 12 }))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PK店铺目标');
    XLSX.writeFile(wb, `PK店铺目标_${currentOrder?.orderName || '全部'}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const th = 'px-3 py-3 text-left text-sm font-medium text-gray-600 whitespace-nowrap';
  const td = 'px-3 py-2 text-sm text-gray-800';
  const inputCls = 'border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-200';
  const selectCls = 'border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-28 focus:outline-none bg-white focus:ring-2 focus:ring-blue-200';

  return (
    <Layout title="PK店铺目标" subtitle="先在本页录入每个店铺的维度取值，再到「PK维度设定」确认谁PK谁；PK名称与开始时间自动取任务单">
      <div className="p-4">
        {/* 顶部工具条 */}
        <div className="flex items-center gap-3 mb-4 flex-wrap bg-white rounded-xl shadow-sm border border-gray-100 p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 flex items-center gap-1"><ClipboardList size={14} /> PK任务单</span>
            <select value={orderId} onChange={e => setOrderId(e.target.value ? Number(e.target.value) : '')} className={`${selectCls} w-48`}>
              <option value="">请选择任务单</option>
              {taskOrders.map(o => (
                <option key={o.id} value={o.id}>{o.orderName}（{o.pkStartDate || '未设日期'} 起）</option>
              ))}
            </select>
          </div>
          {currentOrder && (
            <span className="text-xs text-gray-500">
              制单日期：{currentOrder.docDate || '-'}　PK截止：{currentOrder.pkEndDate || '-'}　目标 {currentOrder.targetCount} 条 / 维度列 {dimColumns.length} 个
            </span>
          )}
          <div className="flex items-center gap-2 ml-4">
            <span className="text-sm text-gray-500">PK筛选</span>
            <select value={pkNameFilter} onChange={e => setPkNameFilter(e.target.value)} className={selectCls}>
              <option value="">全部PK</option>
              {[...new Set(rows.map(r => r.pkName).filter(Boolean))].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={quickSearch}
              onChange={e => setQuickSearch(e.target.value)}
              disabled={orderId === ''}
              placeholder="快速搜索：店铺名称/维度值"
              className="pl-8 pr-7 py-1.5 border border-gray-200 rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-40"
            />
            {quickSearch && (
              <button onClick={() => setQuickSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" title="清除搜索">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={handleAddDimension} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-blue-700">
              <Plus size={14} /> 添加维度列
            </button>
            <button onClick={() => setNewRow(emptyRow())} disabled={orderId === ''} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-indigo-700 disabled:opacity-40">
              <Plus size={14} /> 新增店铺目标
            </button>
            <button onClick={handleDownloadTemplate} disabled={orderId === ''} className="px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-sm flex items-center gap-1 hover:bg-gray-50 disabled:opacity-40" title="下载 Excel 导入模板（含全部系统店铺）">
              <Download size={14} /> 下载模板
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={orderId === ''} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-blue-700 disabled:opacity-40" title="批量导入 Excel / CSV（xlsx 或 csv/txt，首行为列名）">
              <Upload size={14} /> 批量导入
            </button>
            <button onClick={handleExport} disabled={orderId === ''} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-green-700 disabled:opacity-40" title="导出当前筛选数据为 Excel">
              <FileSpreadsheet size={14} /> 导出
            </button>
            <div className="relative">
              <select
                value=""
                onChange={e => {
                  const v = e.target.value;
                  e.target.value = '';
                  if (v === 'order') handleClear('order');
                  else if (v === 'all') handleClear('all');
                }}
                disabled={orderId === ''}
                className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm cursor-pointer disabled:opacity-40"
                title="清空店铺目标：可清空当前任务单，也可清空全部任务单"
              >
                <option value="" className="bg-white text-gray-700">清空目标…</option>
                <option value="order" className="bg-white text-gray-700">清空当前任务单</option>
                <option value="all" className="bg-white text-gray-700">清空全部任务单</option>
              </select>
            </div>
            <button onClick={load} disabled={loading} className="px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-sm flex items-center gap-1">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 刷新
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden" onChange={handleImportFile} />
          </div>
        </div>

        {!currentOrder && (
          <div className="mb-4 flex items-center gap-2 text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm">
            <ClipboardList size={16} />
            尚未选择 PK任务单。请先在「PK任务单」菜单创建任务单（制单日期 / PK日期 / 任务单名称），再回来录入店铺目标。
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
          {loading && <div className="p-8 text-center text-gray-400 text-sm">加载中...</div>}
          {!loading && currentOrder && dimColumns.length === 0 && (
            <div className="px-6 py-12 text-center">
              <p className="text-gray-400 text-sm mb-3">任务单「{currentOrder.orderName}」暂未设置维度列，点击「添加维度列」录入店铺目标维度</p>
            </div>
          )}
          {!loading && currentOrder && dimColumns.length > 0 && (
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className={th}>PK名称</th>
                  <th className={th}>PK开始时间</th>
                  <th className={th}>店铺名称</th>
                  <th className={th}>目标</th>
                  <th className={th}>英雄标</th>
                  {dimColumns.map(col => (
                    <th key={col} className={`${th} relative`}>
                      <span className="inline-flex items-center gap-1">
                        {col}
                        <button onClick={() => handleDeleteDimension(col)} className="text-gray-400 hover:text-red-600 hover:bg-red-50 rounded p-0.5" title={`删除维度列${col}`}>
                          <X size={13} />
                        </button>
                      </span>
                    </th>
                  ))}
                  <th className={`${th} w-32`}>操作</th>
                </tr>
              </thead>
              <tbody>
                {/* 新增行 */}
                {newRow && (
                  <tr className="bg-indigo-50/60 border-b border-indigo-100">
                    <td className={td}>
                      <span className="px-2 py-1.5 text-gray-700 block w-40 truncate" title={newRow.pkName}>{newRow.pkName || '-'}</span>
                    </td>
                    <td className={td}>
                      <span className="px-2 py-1.5 text-gray-700">{newRow.pkStartTime || '-'}</span>
                    </td>
                    <td className={td}>
                      <select value={newRow.shopName} onChange={e => setNewRow({ ...newRow, shopName: e.target.value })} className={selectCls}>
                        <option value="">选择店铺</option>
                        {shops.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className={td}>
                      <input type="number" value={newRow.target} onChange={e => setNewRow({ ...newRow, target: e.target.value })} className={inputCls} placeholder="目标" />
                    </td>
                    <td className={td}>
                      <input value={newRow.heroMark} onChange={e => setNewRow({ ...newRow, heroMark: e.target.value })} className={inputCls} placeholder="英雄标" />
                    </td>
                    {dimColumns.map(col => (
                      <td key={col} className={td}>
                        <input
                          value={newRow.dims[col] || ''}
                          onChange={e => setNewRow({ ...newRow, dims: { ...newRow.dims, [col]: e.target.value } })}
                          className={inputCls}
                          placeholder="维度值"
                        />
                      </td>
                    ))}
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        <button onClick={handleSaveNew} className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-teal-700">
                          <Save size={13} /> 保存
                        </button>
                        <button onClick={() => setNewRow(null)} className="px-2 py-1.5 text-gray-400 hover:text-gray-600">取消</button>
                      </div>
                    </td>
                  </tr>
                )}

                {displayRows.length === 0 && !newRow && (
                  <tr>
                    <td colSpan={6 + dimColumns.length} className="px-6 py-10 text-center text-gray-400 text-sm">
                      {rows.length === 0
                        ? '该任务单暂无店铺目标，点击「新增店铺目标」录入，或使用「下载模板 + 批量导入」'
                        : `没有匹配「${quickSearch.trim()}」的店铺目标，换个关键词试试`}
                    </td>
                  </tr>
                )}
                {displayRows.map(r => {
                  const er = getEditRow(r);
                  const editing = r.id != null && !!editRows[r.id];
                  const disabled = !editing;
                  return (
                    <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className={td}>
                        <span className="px-2 py-1.5 text-gray-800 block w-40 truncate" title={er.pkName}>{er.pkName || '-'}</span>
                      </td>
                      <td className={td}>
                        <span className="px-2 py-1.5 text-gray-800">{er.pkStartTime || '-'}</span>
                      </td>
                      <td className={td}>
                        {disabled ? (
                          <span className="px-2 py-1.5 text-gray-800 block whitespace-nowrap" title={r.shopName}>{r.shopName}</span>
                        ) : (
                          <select value={er.shopName} onChange={e => patchEditRow(r.id!, { shopName: e.target.value })} className={selectCls}>
                            <option value="">选择店铺</option>
                            {shops.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        )}
                      </td>
                      <td className={td}>
                        <input
                          disabled={disabled}
                          type="number"
                          value={er.target}
                          onChange={e => patchEditRow(r.id!, { target: e.target.value })}
                          className={`${inputCls} ${disabled ? 'bg-gray-50 text-gray-700' : ''}`}
                        />
                      </td>
                      <td className={td}>
                        <input
                          disabled={disabled}
                          value={er.heroMark || ''}
                          onChange={e => patchEditRow(r.id!, { heroMark: e.target.value })}
                          className={`${inputCls} ${disabled ? 'bg-gray-50 text-gray-700' : ''}`}
                          placeholder="英雄标"
                        />
                      </td>
                      {dimColumns.map(col => (
                        <td key={col} className={td}>
                          <input
                            disabled={disabled}
                            value={er.dims[col] || ''}
                            onChange={e => patchEditRow(r.id!, { dims: { ...er.dims, [col]: e.target.value } })}
                            className={`${inputCls} ${disabled ? 'bg-gray-50 text-gray-700' : ''}`}
                            placeholder="维度值"
                          />
                        </td>
                      ))}
                      <td className={td}>
                        <div className="flex items-center gap-2">
                          {editing ? (
                            <>
                              <button onClick={() => handleSaveEdit(r)} className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-teal-700">
                                <Save size={13} /> 保存
                              </button>
                              <button onClick={() => setEditRows(prev => { const { [r.id!]: _drop, ...rest } = prev; return rest; })} className="px-2 py-1.5 text-gray-400 hover:text-gray-600 text-sm">
                                取消
                              </button>
                            </>
                          ) : (
                            <button onClick={() => setEditRows(prev => ({ ...prev, [r.id!]: getEditRow(r) }))} className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-sm hover:bg-blue-100">
                              编辑
                            </button>
                          )}
                          <button onClick={() => handleDelete(r)} className="px-2 py-1.5 text-red-400 hover:text-red-600" title="删除">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!loading && !currentOrder && (
            <div className="px-6 py-12 text-center text-gray-400 text-sm">请先选择/创建 PK任务单</div>
          )}
        </div>
      </div>

      {/* 添加维度列输入框 */}
      {dimModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDimModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl p-5 w-96" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-blue-600">添加维度列</h3>
              <button onClick={() => setDimModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <p className="text-xs text-gray-500 mb-3">输入新维度列名称（如：维度六、大区、商圈），保存后本任务单所有店铺目标的表格将新增该列。</p>
            <input
              autoFocus
              value={dimName}
              onChange={e => setDimName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleConfirmAddDimension(); }}
              placeholder="请输入维度列名称"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setDimModalOpen(false)} className="px-3 py-1.5 text-gray-500 hover:text-gray-700 text-sm">取消</button>
              <button onClick={handleConfirmAddDimension} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">确定添加</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

export default PkTargetPage;