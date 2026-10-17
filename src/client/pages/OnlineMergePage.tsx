import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Search, Filter, X, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Plus, Trash2, Save, Truck, Edit3, Upload, FileSpreadsheet, Wand2 } from 'lucide-react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import Layout from '../components/Layout';
import { fetchOnlineMergeData, createTransferRecord, fetchTransferRecords, updateTransferRecord, deleteTransferRecord } from '../../api/onlineMerge';
import type { TransferRecord } from '../../api/onlineMerge';
import { fetchMergeFilters } from '../../api/merge';

// ==================== 模块级缓存 ====================
let cachedAllData: Record<string, any>[] = [];
let cachedYear: number | '' = '';
let cachedSeason = '';
let cachedSearched = false;

// 列定义（与初始并货表一致）
const COLUMNS = [
  { key: '商品代码颜色名称', label: '商品代码颜色名称', frozen: true, width: 160, sortable: true },
  { key: '区域', label: '区域', frozen: true, width: 80, sortable: true },
  { key: '商品', label: '商品', frozen: true, width: 70, sortable: true },
  { key: '督导', label: '督导', frozen: true, width: 70 },
  { key: '店铺名称', label: '店铺名称', width: 140, sortable: true },
  { key: '商品代码', label: '商品代码', width: 110 },
  { key: '颜色代码', label: '颜色代码', width: 90 },
  { key: '颜色名称', label: '颜色名称', width: 100 },
  { key: '大类', label: '大类', width: 80 },
  { key: '款式', label: '款式', width: 80 },
  { key: '风格', label: '风格', width: 80 },
  { key: '小系列', label: '小系列', width: 90 },
  { key: '俗称', label: '俗称', width: 80 },
  { key: '跟型', label: '跟型', width: 70 },
  { key: '鞋跟', label: '鞋跟', width: 70 },
  { key: '季节', label: '季节', width: 70 },
  { key: '年份', label: '年份', width: 60 },
  { key: '性别', label: '性别', width: 60 },
  { key: '内里', label: '内里', width: 70 },
  { key: '后台价', label: '后台价', width: 80, numeric: true },
  { key: '批发价', label: '批发价', width: 80, numeric: true },
  { key: 'B组', label: 'B组', width: 60 },
  { key: 'C组', label: 'C组', width: 60 },
  { key: '组别', label: '组别', width: 60 },
  { key: '清版类型', label: '清版类型', width: 80 },
  { key: '并货类型', label: '并货类型', width: 80 },
  { key: '大类款式', label: '大类款式', width: 80, numeric: true },
  { key: '大类库存', label: '大类库存', width: 80, numeric: true },
  { key: '单店大盘畅销', label: '单店大盘畅销', width: 100, numeric: true },
  { key: '单店排名', label: '单店排名', width: 80, numeric: true },
  { key: '直营排名', label: '直营排名', width: 80, numeric: true },
  { key: '直营上市日期', label: '直营上市日期', width: 110 },
  { key: '直营上市天数', label: '上市天数', width: 80, numeric: true },
  { key: '10天配货', label: '10天配货', width: 80, numeric: true },
  { key: '周移入', label: '周移入', width: 70, numeric: true },
  { key: '周移出', label: '周移出', width: 70, numeric: true },
  { key: '120天累销量', label: '120天累销量', width: 90, numeric: true },
  { key: '120天累送量', label: '120天累送量', width: 90, numeric: true },
  { key: '月送量', label: '月送量', width: 70, numeric: true },
  { key: '两周送量', label: '两周送量', width: 80, numeric: true },
  { key: '周送量', label: '周送量', width: 70, numeric: true },
  { key: '月销量', label: '月销量', width: 70, numeric: true },
  { key: '两周销量', label: '两周销量', width: 80, numeric: true },
  { key: '周销量', label: '周销量', width: 70, numeric: true },
  { key: '昨日销量', label: '昨日销量', width: 80, numeric: true },
  { key: '今日销量', label: '今日销量', width: 80, numeric: true },
  { key: '在途数量', label: '在途数量', width: 80, numeric: true },
  { key: '31', label: '31', width: 55, numeric: true },
  { key: '32', label: '32', width: 55, numeric: true },
  { key: '33', label: '33', width: 55, numeric: true },
  { key: '34', label: '34', width: 55, numeric: true },
  { key: '35', label: '35', width: 55, numeric: true },
  { key: '36', label: '36', width: 55, numeric: true },
  { key: '37', label: '37', width: 55, numeric: true },
  { key: '38', label: '38', width: 55, numeric: true },
  { key: '39', label: '39', width: 55, numeric: true },
  { key: '40', label: '40', width: 55, numeric: true },
  { key: '41', label: '41', width: 55, numeric: true },
  { key: '42', label: '42', width: 55, numeric: true },
  { key: '43', label: '43', width: 55, numeric: true },
  { key: '44', label: '44', width: 55, numeric: true },
  { key: '45', label: '45', width: 55, numeric: true },
  { key: '46', label: '46', width: 55, numeric: true },
  { key: '合计', label: '合计', width: 70, numeric: true, highlight: true },
  { key: '205', label: '205', width: 55, numeric: true },
  { key: '210', label: '210', width: 55, numeric: true },
  { key: '215', label: '215', width: 55, numeric: true },
  { key: '220', label: '220', width: 55, numeric: true },
  { key: '225', label: '225', width: 55, numeric: true },
  { key: '230', label: '230', width: 55, numeric: true },
  { key: '235', label: '235', width: 55, numeric: true },
  { key: '240', label: '240', width: 55, numeric: true },
  { key: '245', label: '245', width: 55, numeric: true },
  { key: '250', label: '250', width: 55, numeric: true },
  { key: '255', label: '255', width: 55, numeric: true },
  { key: '260', label: '260', width: 55, numeric: true },
  { key: '265', label: '265', width: 55, numeric: true },
  { key: '270', label: '270', width: 55, numeric: true },
  { key: '275', label: '275', width: 55, numeric: true },
  { key: '280', label: '280', width: 55, numeric: true },
  { key: '销售合计', label: '销售合计', width: 80, numeric: true, highlight: true },
];

const SIZE_COLS = ['31','32','33','34','35','36','37','38','39','40','41','42','43','44','45','46'];
const FROZEN_COUNT = COLUMNS.filter(c => c.frozen).length;

// ==================== 并货结果（调拨单式） ====================
interface MergeResultRow {
  skuName: string;      // 商品代码颜色名称
  商品代码: string;
  颜色名称: string;
  调出店铺: string;
  调入店铺: string;
  sizes: Record<string, number>;
  数量: number;
  原因?: string;          // 解析生成
}

// 解析上传的「并货结果」Excel（调拨单式：调出店铺/调入店铺/商品代码/颜色名称/尺码数量）
function parseMergeResultXlsx(wb: XLSX.WorkBook): { rows: MergeResultRow[]; error?: string } {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (!rows || rows.length < 2) return { rows: [], error: '文件为空或缺少数据行' };

  const header = (rows[0] || []).map((h: any) => String(h ?? '').trim());
  let skuNameIdx = -1, codeIdx = -1, colorIdx = -1, fromIdx = -1, toIdx = -1;
  header.forEach((h: any, i: number) => {
    const s = String(h ?? '').trim();
    if (/名称|sku/i.test(s)) skuNameIdx = i;
    if (/^(商品代码|货号|商品编码|品名)$/.test(s)) codeIdx = i;
    if (/^颜色名称$/.test(s) || /^颜色$/.test(s) || s === '色') colorIdx = i;
    if (/调出|出店|源店|转出/.test(s)) fromIdx = i;
    if (/调入|入店|转进|目标店/.test(s)) toIdx = i;
  });

  const sizeIdx: Record<string, number> = {};
  header.forEach((h: any, i: number) => {
    const hs = String(h ?? '').trim();
    let m = hs.match(/^(3[0-9]|4[0-6])$/);
    if (!m) m = hs.match(/尺码[-\s]?(\d{2})$/);
    if (m && SIZE_COLS.includes(m[1])) sizeIdx[m[1]] = i;
  });

  const out: MergeResultRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const cell = (ci: number) => (ci >= 0 && ci < r.length ? String(r[ci] ?? '').trim() : '');
    const from = cell(fromIdx);
    const to = cell(toIdx);
    if (!from || !to) continue;
    const code = cell(codeIdx);
    const color = cell(colorIdx);
    let skuName = cell(skuNameIdx).replace(/\s/g, '');
    if (!skuName) skuName = (code + color).replace(/\s/g, '');
    if (!skuName) continue;
    const sizes: Record<string, number> = {};
    let qty = 0;
    SIZE_COLS.forEach((sz: string) => {
      if (sizeIdx[sz] !== undefined) {
        const v = parseInt(String(r[sizeIdx[sz]] ?? 0)) || 0;
        sizes[sz] = v;
        qty += v;
      }
    });
    if (qty <= 0) continue;
    out.push({ skuName, 商品代码: code, 颜色名称: color, 调出店铺: from, 调入店铺: to, sizes, 数量: qty });
  }
  return out.length ? { rows: out } : { rows: [], error: '未识别到有效数据（需含 调出店铺/调入店铺/商品代码颜色名称/尺码数量 列）' };
}

function OnlineMergePage() {
  const navigate = useNavigate();

  // 筛选
  const [year, setYear] = useState<number | ''>(cachedYear);
  const [season, setSeason] = useState<string[]>(cachedSeason ? cachedSeason.split(',') : []);

  // 并货表数据
  const [allData, setAllData] = useState<Record<string, any>[]>(cachedAllData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(cachedSearched);

  // 并货表分页
  const [page, setPage] = useState(1);
  const [pageSize] = useState(200);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const totalPages = useMemo(() => Math.max(1, Math.ceil(allData.length / pageSize)), [allData.length, pageSize]);

  const pageData = useMemo(() => {
    return allData.slice((page - 1) * pageSize, page * pageSize);
  }, [allData, page, pageSize]);

  const sortedData = useMemo(() => {
    if (!sortKey) return pageData;
    return [...pageData].sort((a, b) => {
      const aVal = a[sortKey], bVal = b[sortKey];
      if (typeof aVal === 'number' && typeof bVal === 'number') return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      const cmp = String(aVal ?? '').localeCompare(String(bVal ?? ''), 'zh-CN');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [pageData, sortKey, sortDir]);

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    COLUMNS.forEach(col => { if (col.numeric) t[col.key] = sortedData.reduce((s, r) => s + (parseFloat(r[col.key]) || 0), 0); });
    return t;
  }, [sortedData]);

  // ==================== 筛选选项 ====================
  const [filterOptions, setFilterOptions] = useState<{ years: number[]; seasons: string[] }>({ years: [], seasons: [] });
  useEffect(() => {
    fetchMergeFilters().then(res => { if (res.data.success) setFilterOptions(res.data.data); }).catch(() => {});
  }, []);

  // 查询
  const handleSearch = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params: any = {};
      if (year) params.year = year;
      if (season.length > 0) params.season = season.join(',');
      const res = await fetchOnlineMergeData(params);
      if (res.data.success) {
        const data = res.data.data || [];
        setAllData(data); setPage(1); setSortKey(null); setSearched(true);
        cachedAllData = data; cachedYear = year; cachedSeason = season.join(','); cachedSearched = true;
      } else setError('查询失败');
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || '查询失败');
    } finally { setLoading(false); }
  }, [year, season]);

  const handleReset = () => { setYear(''); setSeason([]); setSortKey(null); };

  // 翻页
  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    setPage(newPage);
  };

  // 排序
  const handleSort = (colKey: string) => {
    if (sortKey === colKey) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortKey(null); setSortDir('asc'); }
    } else { setSortKey(colKey); setSortDir('asc'); }
  };

  // 渲染单元格
  const renderCell = (row: Record<string, any>, col: typeof COLUMNS[0]) => {
    const val = row[col.key];
    if (val === null || val === undefined || val === '') return '-';
    if (col.numeric) {
      const n = parseFloat(val);
      return isNaN(n) ? val : n.toLocaleString('zh-CN', { useGrouping: false });
    }
    return String(val);
  };

  const getFrozenLeft = (colIdx: number) => {
    if (colIdx >= FROZEN_COUNT) return undefined;
    let left = 0;
    for (let i = 0; i < colIdx; i++) left += COLUMNS[i].width;
    return left;
  };

  const renderSortIcon = (colKey: string) => {
    if (sortKey === colKey) return sortDir === 'asc' ? <ArrowUp size={12} className="text-pink-600 flex-shrink-0" /> : <ArrowDown size={12} className="text-pink-600 flex-shrink-0" />;
    return <ArrowUpDown size={12} className="text-gray-300 flex-shrink-0" />;
  };

  // ==================== 调拨模态框 ====================
  const [showModal, setShowModal] = useState(false);
  const [transferSource, setTransferSource] = useState<Record<string, any> | null>(null);
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [storeSizes, setStoreSizes] = useState<Record<string, Record<string, number>>>({});
  const [transferSaving, setTransferSaving] = useState(false);
  const [storeSearch, setStoreSearch] = useState('');

  // ==================== 并货结果：上传 + 解析 ====================
  const [uploadedRows, setUploadedRows] = useState<MergeResultRow[]>([]);
  const [uploadError, setUploadError] = useState('');
  const [parseInfo, setParseInfo] = useState<{ skipped: number; total: number } | null>(null);
  const [parseLoading, setParseLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const resultFileRef = useRef<HTMLInputElement>(null);

  // 打开调拨模态框
  const openTransfer = (row: Record<string, any>) => {
    setTransferSource(row);
    setSelectedStores([]);
    setStoreSizes({});
    setStoreSearch('');
    setShowModal(true);
  };

  // 当前商品在所有店的库存
  const availableStores = useMemo(() => {
    if (!transferSource) return [];
    const sku = transferSource['商品代码颜色名称'];
    return allData
      .filter(r => r['商品代码颜色名称'] === sku)
      .map(r => r['店铺名称'])
      .filter((name, i, arr) => name && arr.indexOf(name) === i)
      .sort();
  }, [transferSource, allData]);

  // 过滤后的可选店铺
  const filteredStores = useMemo(() => {
    if (!storeSearch) return availableStores;
    return availableStores.filter(s => s.includes(storeSearch));
  }, [availableStores, storeSearch]);

  // 切换店铺选中
  const toggleStore = (store: string) => {
    setSelectedStores(prev => {
      if (prev.includes(store)) {
        // 移除时不删数据，方便回选
        return prev.filter(s => s !== store);
      }
      return [...prev, store];
    });
  };

  // 更新尺码
  const updateSize = (store: string, size: string, value: string) => {
    const num = parseInt(value) || 0;
    setStoreSizes(prev => ({
      ...prev,
      [store]: { ...(prev[store] || {}), [size]: num },
    }));
  };

  // 计算某个店铺的总数
  const storeTotal = (store: string) => {
    const sizes = storeSizes[store] || {};
    return SIZE_COLS.reduce((s, c) => s + (sizes[c] || 0), 0);
  };

  // 推荐调入店铺各尺码现有可售库存（来自并货数据表当前行）
  const storeInvMap = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    if (!transferSource) return map;
    const sku = transferSource['商品代码颜色名称'];
    allData.forEach(r => {
      if (r['商品代码颜色名称'] === sku && r['店铺名称']) {
        const inv: Record<string, number> = {};
        SIZE_COLS.forEach(s => { inv[s] = parseInt(r[s]) || 0; });
        map[r['店铺名称']] = inv;
      }
    });
    return map;
  }, [transferSource, allData]);
  const storeInvTotal = (store: string) => {
    const inv = storeInvMap[store] || {};
    return SIZE_COLS.reduce((s, c) => s + (inv[c] || 0), 0);
  };

  // ==================== 并货结果：上传 / 解析 / 一键落调拨 ====================
  const handleUploadResult = async (file: File) => {
    setUploadError(''); setParseInfo(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const res = parseMergeResultXlsx(wb);
      if (res.error) { setUploadError(res.error); setUploadedRows([]); return; }
      setUploadedRows(res.rows);
    } catch (e: any) {
      setUploadError('Excel 解析失败：' + (e?.message || e));
      setUploadedRows([]);
    }
  };

  // 解析：比对并货数据表（库存/销售）与上传结果，生成"为什么按结果并"的说明
  const handleParse = () => {
    if (uploadedRows.length === 0) { setError('请先上传并货结果'); return; }
    setParseLoading(true); setUploadError('');
    const analyzed: MergeResultRow[] = [];
    let matched = 0;
    uploadedRows.forEach(ur => {
      const sku = ur.skuName;
      const fromInvMap = storeInvMap[ur.调出店铺] || {};
      const toInvMap = storeInvMap[ur.调入店铺] || {};
      const fromRows = allData.filter(r => r['店铺名称'] === ur.调出店铺 && r['商品代码颜色名称'] === sku);
      const toRows = allData.filter(r => r['店铺名称'] === ur.调入店铺 && r['商品代码颜色名称'] === sku);
      const fromTotal = SIZE_COLS.reduce((s, c) => s + (fromInvMap[c] || 0), 0);
      const toInvTotal = SIZE_COLS.reduce((s, c) => s + (toInvMap[c] || 0), 0);
      const toSales = (toRows[0] && (parseFloat(toRows[0]['月销量']) || 0)) || 0;
      const missing = SIZE_COLS.filter(sz => ur.sizes[sz] > 0 && (toInvMap[sz] || 0) === 0);
      if (fromRows.length === 0 && toRows.length === 0) {
        ur.原因 = `并货数据表中未找到该款在「${ur.调出店铺}」/「${ur.调入店铺}」的数据，无法核验`;
      } else {
        matched++;
        const parts: string[] = [];
        if (fromTotal <= 0) { if (fromRows.length) parts.push(`调出店「${ur.调出店铺}」现无库存可调`); }
        else parts.push(`调出店「${ur.调出店铺}」现有库存${fromTotal}双`);
        const toPart = `调入店「${ur.调入店铺}」现有${toInvTotal}双、月销${toSales}`;
        parts.push(toPart);
        if (missing.length > 0) parts.push(`缺${missing.join('/')}码段`);
        if (ur.数量 > toInvTotal) parts.push(`按并需调入${ur.数量}双以补齐缺口`);
        else parts.push(`按并建议调${ur.数量}双优化分配`);
        if (fromTotal < ur.数量) parts.push('⚠️调货量大于调出店现有库存');
        ur.原因 = parts.join('；');
      }
    });
    setParseInfo({ total: uploadedRows.length, skipped: uploadedRows.length - matched });
    setParseLoading(false);
  };

  // 一键落调拨：把解析后的并货结果全部创建为调拨记录
  const handleApplyResult = async () => {
    if (uploadedRows.length === 0) { setError('没有可落单的并货结果'); return; }
    if (!confirm(`将按并货结果生成 ${uploadedRows.length} 条调拨记录，确认？`)) return;
    setApplying(true); setError('');
    try {
      let ok = 0;
      for (const u of uploadedRows) {
        await createTransferRecord({
          商品代码颜色名称: u.skuName, 商品代码: u.商品代码, 颜色名称: u.颜色名称,
          调出店铺: u.调出店铺, 调入店铺: u.调入店铺,
          ...(Object.fromEntries(SIZE_COLS.map(s => [s, u.sizes[s] || 0])) as any),
          操作人: '', 备注: '',
        });
        ok++;
      }
      if (ok > 0) { loadTransfers(); setUploadedRows([]); setParseInfo(null); }
      setError(ok > 0 ? `已生成 ${ok} 条调拨` : '');
    } catch (err: any) {
      setError('生成失败：' + (err.response?.data?.message || err.message));
    } finally { setApplying(false); }
  };

  // 保存调拨
  const handleSaveTransfer = async () => {
    if (!transferSource) return;
    if (selectedStores.length === 0) { setError('请至少选择一个调入店铺'); return; }

    // 验证至少有尺码数据
    const hasData = selectedStores.some(s => storeTotal(s) > 0);
    if (!hasData) { setError('请至少为某个调入店铺填写尺码数量'); return; }

    setTransferSaving(true); setError('');
    try {
      let saved = 0;
      for (const store of selectedStores) {
        const sizes = storeSizes[store] || {};
        const total = storeTotal(store);
        if (total === 0) continue;

        await createTransferRecord({
          商品代码颜色名称: transferSource['商品代码颜色名称'] || '',
          商品代码: transferSource['商品代码'] || '',
          颜色名称: transferSource['颜色名称'] || '',
          调出店铺: transferSource['店铺名称'] || '',
          调入店铺: store,
          ...(Object.fromEntries(SIZE_COLS.map(s => [s, sizes[s] || 0])) as any),
          操作人: '',
          备注: '',
        });
        saved++;
      }

      if (saved > 0) {
        setShowModal(false);
        setTransferSource(null);
        loadTransfers(); // 刷新调拨明细
      } else {
        setError('没有有效的调拨数据');
      }
    } catch (err: any) {
      setError('保存失败：' + (err.response?.data?.message || err.message));
    } finally { setTransferSaving(false); }
  };

  // ==================== 调拨明细表 ====================
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [transferTotal, setTransferTotal] = useState(0);
  const [transferPage, setTransferPage] = useState(1);
  const [transferSearch, setTransferSearch] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);

  // 编辑状态
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editSizes, setEditSizes] = useState<Record<string, number>>({});

  const loadTransfers = useCallback(async () => {
    setTransferLoading(true);
    try {
      const res = await fetchTransferRecords({ search: transferSearch || undefined, page: transferPage, pageSize: 50 });
      if (res.data.success) {
        setTransfers(res.data.data || []);
        setTransferTotal(res.data.total);
      }
    } catch { /* ignore */ }
    finally { setTransferLoading(false); }
  }, [transferSearch, transferPage]);

  useEffect(() => {
    if (searched) loadTransfers();
  }, [searched, loadTransfers]);

  // 删除调拨记录
  const handleDeleteTransfer = async (id: number) => {
    if (!confirm('确定删除这条调拨记录吗？')) return;
    try {
      await deleteTransferRecord(id);
      loadTransfers();
    } catch (err: any) {
      setError('删除失败：' + (err.response?.data?.message || err.message));
    }
  };

  // 开始编辑
  const startEdit = (row: TransferRecord) => {
    if (!row.id) return;
    setEditingId(row.id);
    const sizes: Record<string, number> = {};
    SIZE_COLS.forEach(s => { sizes[s] = (row as any)[s] || 0; });
    setEditSizes(sizes);
  };

  // 取消编辑
  const cancelEdit = () => {
    setEditingId(null);
    setEditSizes({});
  };

  // 保存编辑
  const saveEdit = async (id: number) => {
    const total = SIZE_COLS.reduce((s, c) => s + (editSizes[c] || 0), 0);
    if (total === 0) { setError('尺码数量不能全部为0'); return; }
    try {
      await updateTransferRecord(id, {
        ...(Object.fromEntries(SIZE_COLS.map(s => [s, editSizes[s] || 0])) as any),
      });
      setEditingId(null);
      loadTransfers();
    } catch (err: any) {
      setError('保存失败：' + (err.response?.data?.message || err.message));
    }
  };

  // 尺寸编辑
  const updateEditSize = (size: string, value: string) => {
    setEditSizes(prev => ({ ...prev, [size]: parseInt(value) || 0 }));
  };
  const editTotal = () => SIZE_COLS.reduce((s, c) => s + (editSizes[c] || 0), 0);

  return (
    <Layout title="线上并货" subtitle="店铺间调拨管理与调拨明细">
      {/* 返回按钮 */}
      <div className="mb-4 flex items-center gap-2">
        <button onClick={() => navigate('/automation')} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white rounded-lg border border-gray-200 hover:bg-gray-50">
          <ArrowLeft size={16} /> 返回自动化管理
        </button>
      </div>

      {/* 错误提示 */}
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm flex items-center justify-between">
        <span>{error}</span><button onClick={() => setError('')} className="text-red-400 hover:text-red-600"><X size={14} /></button>
      </div>}

      {/* 筛选面板 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 mb-4 overflow-hidden">
        <div className="px-6 py-3 flex items-center gap-2">
          <Filter size={16} className="text-pink-500" /><span className="font-semibold text-gray-700">筛选条件</span>
        </div>
        <div className="px-6 pb-4 border-t border-gray-100">
          <div className="flex flex-wrap items-end gap-4 mt-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">年份 ≥</label>
              <select value={year} onChange={e => setYear(e.target.value ? parseInt(e.target.value) : '')} className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-pink-400 outline-none min-w-[100px]">
                <option value="">所有</option>
                {filterOptions.years.map(y => <option key={y} value={y}>{y}年及以后</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">季节（可多选）</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {filterOptions.seasons.map(s => (
                  <label key={s} className={`px-3 py-1.5 rounded-full text-xs cursor-pointer border transition-colors select-none ${season.includes(s) ? 'bg-pink-100 border-pink-400 text-pink-700 font-medium' : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-pink-300'}`}>
                    <input type="checkbox" className="sr-only" checked={season.includes(s)} onChange={() => { setSeason(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]); }} />
                    {s}
                  </label>
                ))}
                {season.length > 0 && <button onClick={() => setSeason([])} className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600">清除</button>}
              </div>
            </div>
            <button onClick={handleSearch} disabled={loading} className="flex items-center gap-2 px-5 py-2 text-sm text-white bg-pink-600 rounded-lg hover:bg-pink-700 disabled:opacity-50">
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} 查询
            </button>
            <button onClick={handleReset} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">
              <X size={14} /> 重置
            </button>
          </div>
        </div>
      </div>

      {/* ==================== 并货数据表 ==================== */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-6">
        <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2"><Truck size={18} className="text-pink-500" /> 并货数据表</h3>
          <span className="text-xs text-gray-500">
            {searched && allData.length > 0 ? `共 ${allData.length.toLocaleString('zh-CN', { useGrouping: false })} 条，第 ${page}/${totalPages} 页` : searched ? '无匹配数据' : '请设置筛选条件后点击查询'}
          </span>
        </div>

        <div className="relative overflow-auto" style={{ maxHeight: '50vh' }}>
          <table className="w-full text-xs" style={{ minWidth: COLUMNS.reduce((s, c) => s + c.width, 0) + 100 }}>
            <thead className="sticky top-0 z-20">
              <tr className="bg-gray-100 text-gray-600">
                {COLUMNS.map((col, idx) => (
                  <th key={col.key} className={`px-2 py-2 text-center border-b border-gray-200 ${col.frozen ? 'sticky z-30 bg-gray-100' : ''} ${col.highlight ? 'bg-pink-50 text-pink-700' : ''} ${col.sortable ? 'cursor-pointer select-none hover:bg-gray-200' : ''}`}
                    style={{ width: col.width, minWidth: col.width, left: col.frozen ? getFrozenLeft(idx) : undefined }}
                    onClick={() => col.sortable && handleSort(col.key)} title={col.sortable ? '点击排序' : undefined}>
                    <div className="whitespace-nowrap flex items-center justify-center gap-1"><span>{col.label}</span>{col.sortable && renderSortIcon(col.key)}</div>
                  </th>
                ))}
                <th className="px-2 py-2 text-center border-b border-gray-200 bg-pink-50 text-pink-700 font-bold sticky right-0 z-30" style={{ width: 70, minWidth: 70 }}>
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedData.map((row, rowIdx) => (
                <tr key={rowIdx} className="hover:bg-pink-50/30 transition-colors">
                  {COLUMNS.map((col, colIdx) => (
                    <td key={col.key} className={`px-2 py-1.5 border-b border-gray-50 ${col.frozen ? 'sticky z-10 bg-white' : ''} ${col.numeric ? 'text-right' : 'text-left'} ${col.highlight ? 'text-pink-700 font-semibold' : 'text-gray-700'}`}
                      style={{ width: col.width, minWidth: col.width, left: col.frozen ? getFrozenLeft(colIdx) : undefined }}>
                      <div className="whitespace-nowrap overflow-hidden text-ellipsis" style={{ maxWidth: col.width + 20 }}>{renderCell(row, col)}</div>
                    </td>
                  ))}
                  <td className="px-2 py-1.5 border-b border-gray-50 text-center sticky right-0 z-10 bg-white">
                    <button onClick={() => openTransfer(row)} className="px-3 py-1 text-xs bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors flex items-center gap-1 mx-auto">
                      <Plus size={12} /> 调拨
                    </button>
                  </td>
                </tr>
              ))}

              {/* 合计行 */}
              {sortedData.length > 0 && (
                <tr className="bg-pink-50 font-semibold border-t-2 border-pink-200">
                  {COLUMNS.map((col, colIdx) => (
                    <td key={col.key} className={`px-2 py-2 border-b border-pink-100 ${col.frozen ? 'sticky z-10 bg-pink-50' : ''} ${col.numeric ? 'text-right' : 'text-left'} text-pink-700`}
                      style={{ width: col.width, minWidth: col.width, left: col.frozen ? getFrozenLeft(colIdx) : undefined }}>
                      {colIdx === 0 ? '合计' : col.numeric ? (totals[col.key] || 0).toLocaleString('zh-CN', { useGrouping: false }) : ''}
                    </td>
                  ))}
                  <td className="px-2 py-2 border-b border-pink-100 text-center sticky right-0 z-10 bg-pink-50"></td>
                </tr>
              )}

              {allData.length === 0 && !loading && !searched && (
                <tr><td colSpan={COLUMNS.length + 1} className="px-6 py-16 text-center text-gray-400">请设置筛选条件后点击「查询」按钮</td></tr>
              )}
              {allData.length === 0 && !loading && searched && (
                <tr><td colSpan={COLUMNS.length + 1} className="px-6 py-16 text-center text-gray-400">暂无匹配数据，请调整筛选条件</td></tr>
              )}
              {loading && (
                <tr><td colSpan={COLUMNS.length + 1} className="px-6 py-16 text-center"><RefreshCw size={24} className="animate-spin text-pink-500 mx-auto mb-2" /><span className="text-gray-400 text-sm">查询中，数据量较大请耐心等待...</span></td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
            <span className="text-xs text-gray-500">第 {page} 页，共 {totalPages} 页，{allData.length.toLocaleString('zh-CN', { useGrouping: false })} 条记录</span>
            <div className="flex items-center gap-1">
              <button onClick={() => handlePageChange(1)} disabled={page <= 1} className="px-2 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30">首页</button>
              <button onClick={() => handlePageChange(page - 1)} disabled={page <= 1} className="p-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30"><ChevronLeft size={14} /></button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let p: number;
                if (totalPages <= 5) p = i + 1;
                else if (page <= 3) p = i + 1;
                else if (page >= totalPages - 2) p = totalPages - 4 + i;
                else p = page - 2 + i;
                return <button key={p} onClick={() => handlePageChange(p)} className={`px-3 py-1 text-xs rounded ${p === page ? 'bg-pink-600 text-white' : 'border border-gray-200 hover:bg-gray-50'}`}>{p}</button>;
              })}
              <button onClick={() => handlePageChange(page + 1)} disabled={page >= totalPages} className="p-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30"><ChevronRight size={14} /></button>
              <button onClick={() => handlePageChange(totalPages)} disabled={page >= totalPages} className="px-2 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30">末页</button>
            </div>
          </div>
        )}
      </div>

      {/* ==================== 并货结果与解析 ==================== */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-6">
        <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-bold text-gray-800 flex items-center gap-2"><FileSpreadsheet size={18} className="text-emerald-600" /> 并货结果与解析</h3>
          <div className="flex items-center gap-2">
            <input
              ref={resultFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadResult(f); e.target.value = ''; }}
            />
            <button onClick={() => resultFileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
              <Upload size={13} /> 上传并货结果
            </button>
            <button onClick={handleParse} disabled={parseLoading || uploadedRows.length === 0} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-40">
              <Wand2 size={13} /> 解析
            </button>
            <button onClick={handleApplyResult} disabled={applying || uploadedRows.length === 0} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40">
              {applying ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />} 一键落调拨（{uploadedRows.length}）
            </button>
          </div>
        </div>
        <div className="px-6 py-4">
          <p className="text-xs text-gray-400 mb-3">上传「并货结果」Excel（需含 调出店铺 / 调入店铺 / 商品代码(或颜色名称) / 尺码数量 列），点「解析」比对并货数据表的库存与销售，生成"为什么按此结果并货"的说明，可一键落为调拨记录。</p>
          {uploadError && <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">{uploadError}</div>}
          {parseInfo && <div className="mb-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700">解析完成：共 {parseInfo.total} 条，其中可核验比对的 {parseInfo.total - parseInfo.skipped} 条，跳过 {parseInfo.skipped} 条（数据表无对应款/店）。</div>}
          {uploadedRows.length === 0 ? (
            <div className="py-10 text-center text-gray-400 text-sm border border-dashed border-gray-200 rounded-xl">尚未上传并货结果</div>
          ) : (
            <div className="overflow-auto" style={{ maxHeight: '42vh' }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-emerald-50 text-emerald-800">
                    <th className="px-3 py-2 text-left">商品代码颜色名称</th>
                    <th className="px-3 py-2 text-left">调出店铺</th>
                    <th className="px-3 py-2 text-left">调入店铺</th>
                    {SIZE_COLS.map(s => <th key={s} className="px-1.5 py-2 text-center">{s}</th>)}
                    <th className="px-2 py-2 text-center bg-emerald-100">合计</th>
                    <th className="px-3 py-2 text-left">解析说明</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-50">
                  {uploadedRows.map((u, i) => {
                    const total = SIZE_COLS.reduce((s, c) => s + (u.sizes[c] || 0), 0);
                    return (
                      <tr key={i} className="hover:bg-emerald-50/30">
                        <td className="px-3 py-1.5 font-mono text-gray-700">{u.skuName}</td>
                        <td className="px-3 py-1.5 text-gray-700">{u.调出店铺}</td>
                        <td className="px-3 py-1.5 text-gray-700">{u.调入店铺}</td>
                        {SIZE_COLS.map(s => <td key={s} className={`px-1.5 py-1.5 text-center ${(u.sizes[s] || 0) > 0 ? 'text-gray-800 font-medium' : 'text-gray-300'}`}>{u.sizes[s] || 0}</td>)}
                        <td className="px-2 py-1.5 text-center font-bold text-emerald-700 bg-emerald-50/40">{total}</td>
                        <td className="px-3 py-1.5 text-gray-500 max-w-[280px]">{u.原因 || '未解析'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ==================== 调拨明细表 ==================== */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-bold text-gray-800 flex items-center gap-2"><Edit3 size={18} className="text-indigo-500" /> 调拨明细表</h3>
          <div className="flex items-center gap-2">
            <input
              type="text" placeholder="搜索商品/店铺..."
              value={transferSearch}
              onChange={e => { setTransferSearch(e.target.value); setTransferPage(1); }}
              onKeyDown={e => { if (e.key === 'Enter') loadTransfers(); }}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs w-48 focus:ring-2 focus:ring-indigo-400 outline-none"
            />
            <button onClick={loadTransfers} className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"><Search size={12} /></button>
            <span className="text-xs text-gray-500">共 {transferTotal} 条</span>
          </div>
        </div>

        <div className="overflow-auto" style={{ maxHeight: '45vh' }}>
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-indigo-50 text-indigo-800">
                <th className="px-3 py-2 text-left">调出店铺</th>
                <th className="px-3 py-2 text-left">调入店铺</th>
                <th className="px-3 py-2 text-left">商品代码颜色名称</th>
                {SIZE_COLS.map(s => <th key={s} className="px-2 py-2 text-center w-[48px]">{s}</th>)}
                <th className="px-2 py-2 text-center bg-indigo-100">合计</th>
                <th className="px-3 py-2 text-center">创建时间</th>
                <th className="px-3 py-2 text-center w-[120px]">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-indigo-50">
              {transfers.length === 0 && !transferLoading && (
                <tr><td colSpan={20} className="px-6 py-10 text-center text-gray-400">暂无调拨记录，请在并货数据表中点击「调拨」创建</td></tr>
              )}
              {transferLoading && (
                <tr><td colSpan={20} className="px-6 py-10 text-center"><RefreshCw size={20} className="animate-spin text-indigo-400 mx-auto" /></td></tr>
              )}
              {transfers.map(row => {
                const isEditing = editingId === row.id;
                return (
                  <tr key={row.id} className={`hover:bg-indigo-50/30 transition-colors ${isEditing ? 'bg-indigo-50' : ''}`}>
                    <td className="px-3 py-2 text-gray-800 font-medium">{row.调出店铺}</td>
                    <td className="px-3 py-2 text-gray-800 font-medium">{isEditing ? row.调入店铺 : row.调入店铺}</td>
                    <td className="px-3 py-2 text-gray-600">{row.商品代码颜色名称}</td>
                    {SIZE_COLS.map(s => (
                      <td key={s} className="px-1 py-2 text-center">
                        {isEditing ? (
                          <input
                            type="number" min="0"
                            value={editSizes[s] || 0}
                            onChange={e => updateEditSize(s, e.target.value)}
                            className="w-[42px] px-1 py-0.5 border border-indigo-300 rounded text-xs text-center focus:ring-1 focus:ring-indigo-400 outline-none"
                          />
                        ) : (
                          <span className={((row as any)[s] || 0) > 0 ? 'text-gray-800 font-semibold' : 'text-gray-300'}>{(row as any)[s] || 0}</span>
                        )}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-center font-bold text-indigo-700 bg-indigo-50/50">
                      {isEditing ? editTotal() : (row.合计 || 0)}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-center whitespace-nowrap">
                      {row.创建时间 ? new Date(row.创建时间).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '-'}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => saveEdit(row.id!)} className="p-1 text-green-600 hover:bg-green-50 rounded"><Save size={14} /></button>
                          <button onClick={cancelEdit} className="p-1 text-gray-400 hover:bg-gray-50 rounded"><X size={14} /></button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => startEdit(row)} className="p-1 text-indigo-500 hover:bg-indigo-50 rounded"><Edit3 size={14} /></button>
                          <button onClick={() => handleDeleteTransfer(row.id!)} className="p-1 text-red-400 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ==================== 调拨模态框 ==================== */}
      {showModal && transferSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[1320px] max-h-[94vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            {/* 头部 */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-pink-50 to-white">
              <div>
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Truck size={20} className="text-pink-500" /> 创建调拨</h3>
                <p className="text-xs text-gray-500 mt-1">
                  调出：<span className="font-semibold text-gray-700">{transferSource['店铺名称']}</span>
                  &nbsp;|&nbsp; 商品：<span className="font-semibold text-gray-700">{transferSource['商品代码颜色名称']}</span>
                </p>
              </div>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-auto p-4">
              {/* 调入店铺选择 */}
              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">选择调入店铺（可多选）</label>
                <input
                  type="text" placeholder="搜索店铺名称..."
                  value={storeSearch} onChange={e => setStoreSearch(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-pink-400 outline-none mb-2"
                />
                <div className="flex flex-wrap gap-2 max-h-[26vh] overflow-y-auto p-2 border border-gray-100 rounded-lg bg-gray-50">
                  {filteredStores.map(s => {
                    const isSource = s === transferSource['店铺名称'];
                    return (
                      <label key={s} className={`px-3 py-1 rounded-full text-xs cursor-pointer border transition-colors select-none ${
                        selectedStores.includes(s) ? 'bg-indigo-100 border-indigo-400 text-indigo-700 font-medium' :
                        isSource ? 'bg-gray-200 border-gray-300 text-gray-400 cursor-not-allowed' :
                        'bg-white border-gray-200 text-gray-600 hover:border-indigo-300'
                      }`}>
                        <input type="checkbox" className="sr-only" checked={selectedStores.includes(s)} onChange={() => { if (!isSource) toggleStore(s); }} disabled={isSource} />
                        {s} {isSource && '(调出店)'}
                      </label>
                    );
                  })}
                  {filteredStores.length === 0 && <span className="text-xs text-gray-400 p-2">未找到匹配店铺</span>}
                </div>
                {selectedStores.length > 0 && (
                  <button onClick={() => setSelectedStores([])} className="mt-2 text-xs text-gray-400 hover:text-gray-600">清除全部选择</button>
                )}
              </div>

              {/* 尺码填写表 */}
              {selectedStores.length > 0 && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">填写尺码数量</label>
                  <div className="overflow-x-auto border border-gray-200 rounded-xl">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="px-3 py-2 text-left sticky left-0 bg-gray-100 z-10">调入店铺 <span className="text-gray-400 font-normal">（现有→调入）</span></th>
                          {SIZE_COLS.map(s => <th key={s} className="px-2 py-2 text-center w-[52px]">{s}</th>)}
                          <th className="px-2 py-2 text-center bg-pink-50">小计</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {selectedStores.map(store => [
                          /* 该调入店现有可售库存（只读） */
                          <tr key={store + '_inv'} className="bg-gray-50/70">
                            <td className="px-3 py-1.5 whitespace-nowrap sticky left-0 bg-gray-50/70 z-10">
                              <span className="text-gray-500">{store} 现有</span>
                            </td>
                            {SIZE_COLS.map(s => (
                              <td key={s} className="px-1 py-1.5 text-center text-gray-500">{storeInvMap[store]?.[s] || 0}</td>
                            ))}
                            <td className="px-2 py-1.5 text-center font-semibold text-gray-600 bg-gray-100/60">{storeInvTotal(store)}</td>
                          </tr>,
                          /* 调入数量输入 */
                          <tr key={store + '_in'} className="hover:bg-pink-50/20">
                            <td className="px-3 py-2 text-gray-800 font-medium whitespace-nowrap sticky left-0 bg-white z-10">{store} 调入</td>
                            {SIZE_COLS.map(s => (
                              <td key={s} className="px-1 py-1 text-center">
                                <input
                                  type="number" min="0"
                                  value={storeSizes[store]?.[s] || ''}
                                  onChange={e => updateSize(store, s, e.target.value)}
                                  className="w-[50px] px-1 py-1.5 border border-gray-200 rounded text-xs text-center focus:ring-1 focus:ring-pink-400 outline-none"
                                />
                              </td>
                            ))}
                            <td className="px-2 py-2 text-center font-bold text-pink-600 bg-pink-50/30">{storeTotal(store)}</td>
                          </tr>,
                        ])}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* 底部按钮 */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3 bg-gray-50">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 bg-white rounded-lg border border-gray-200 hover:bg-gray-100">取消</button>
              <button onClick={handleSaveTransfer} disabled={transferSaving || selectedStores.length === 0}
                className="flex items-center gap-2 px-5 py-2 text-sm text-white bg-pink-600 rounded-lg hover:bg-pink-700 disabled:opacity-40">
                {transferSaving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                {transferSaving ? '保存中...' : '保存调拨'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

export default OnlineMergePage;
