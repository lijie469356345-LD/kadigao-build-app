import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Search, Download, Filter, X, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Layout from '../components/Layout';
import { fetchInitialTable, fetchMergeFilters, exportMergeCsv } from '../../api/merge';

// ==================== 模块级缓存：切换菜单不丢数据 ====================
let cachedAllData: Record<string, any>[] = [];
let cachedTotal = 0;
let cachedYear: number | '' = '';
let cachedSeason = '';
let cachedSearched = false;

// 列定义（与 VBA header 一致）
const COLUMNS = [
  { key: '商品代码颜色名称', label: '商品代码颜色名称', frozen: true, width: 160, sortable: true },
  { key: '区域', label: '区域', frozen: true, width: 80, sortable: true },
  { key: '商品', label: '商品', frozen: true, width: 70, sortable: true },
  { key: '督导', label: '督导', frozen: true, width: 70 },
  { key: '店铺名称', label: '店铺名称', frozen: false, width: 140, sortable: true },
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

const FROZEN_COUNT = COLUMNS.filter(c => c.frozen).length;

function InitialMergeTablePage() {
  const navigate = useNavigate();

  // 筛选
  const [year, setYear] = useState<number | ''>(cachedYear);
  const [season, setSeason] = useState<string[]>(cachedSeason ? cachedSeason.split(',') : []);

  // 数据状态
  const [allData, setAllData] = useState<Record<string, any>[]>(cachedAllData);
  const [total, setTotal] = useState(cachedTotal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(cachedSearched);
  const [exporting, setExporting] = useState(false);

  // 客户端分页
  const [page, setPage] = useState(1);
  const [pageSize] = useState(200);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(allData.length / pageSize)), [allData.length, pageSize]);

  // 当前页数据
  const pageData = useMemo(() => {
    return allData.slice((page - 1) * pageSize, page * pageSize);
  }, [allData, page, pageSize]);

  // 前端排序
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // 排序后的当前页数据
  const sortedData = useMemo(() => {
    if (!sortKey) return pageData;
    return [...pageData].sort((a: any, b: any) => {
      const aVal = a[sortKey], bVal = b[sortKey];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      if (typeof aVal === 'number' || typeof bVal === 'number') {
        return sortDir === 'asc' ? (parseFloat(aVal)||0) - (parseFloat(bVal)||0) : (parseFloat(bVal)||0) - (parseFloat(aVal)||0);
      }
      const cmp = String(aVal ?? '').localeCompare(String(bVal ?? ''), 'zh-CN');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [pageData, sortKey, sortDir]);

  // 列合计（当前页）
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    COLUMNS.forEach(col => {
      if (col.numeric) t[col.key] = sortedData.reduce((s, r) => s + (parseFloat(r[col.key]) || 0), 0);
    });
    return t;
  }, [sortedData]);

  // 筛选选项
  const [filterOptions, setFilterOptions] = useState<{ years: number[]; seasons: string[] }>({
    years: [], seasons: [],
  });

  useEffect(() => {
    fetchMergeFilters()
      .then(res => { if (res.data.success) setFilterOptions(res.data.data); })
      .catch(err => console.error('加载筛选选项失败', err));
  }, []);

  // 查询：获取全量数据
  const handleSearch = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: any = {};
      if (year) params.year = year;
      if (season.length > 0) params.season = season.join(',');

      const res = await fetchInitialTable(params);
      if (res.data.success) {
        const data = res.data.data || [];
        setAllData(data);
        setTotal(data.length);
        setPage(1);
        setSortKey(null);

        // 写入模块级缓存
        cachedAllData = data;
        cachedTotal = data.length;
        cachedYear = year;
        cachedSeason = season.join(',');
        cachedSearched = true;
        setSearched(true);
      } else {
        setError(res.data.message || '查询失败');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || '查询失败');
    } finally {
      setLoading(false);
    }
  }, [year, season]);

  // 重置
  const handleReset = () => {
    setYear('');
    setSeason([]);
    setSortKey(null);
  };

  // 翻页：纯客户端，不触发查询
  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    setPage(newPage);
  };

  // 表头排序
  const handleSort = (colKey: string) => {
    if (sortKey === colKey) {
      if (sortDir === 'asc') { setSortDir('desc'); }
      else { setSortKey(null); setSortDir('asc'); }
    } else {
      setSortKey(colKey);
      setSortDir('asc');
    }
  };

  // 导出
  const handleExport = async () => {
    setExporting(true);
    try {
      const params: any = {};
      if (year) params.year = year;
      if (season.length > 0) params.season = season.join(',');

      const blob = await exportMergeCsv(params);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `并货表_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError('导出失败：' + (err.message || '未知错误'));
    } finally {
      setExporting(false);
    }
  };

  // 渲染单元格
  const renderCell = (row: Record<string, any>, col: typeof COLUMNS[0]) => {
    const val = row[col.key];
    if (val === null || val === undefined || val === '') return '-';
    if (col.numeric) {
      const n = parseFloat(val);
      if (isNaN(n)) return val;
      return n.toLocaleString('zh-CN', { useGrouping: false });
    }
    return String(val);
  };

  // 冻结列偏移
  const getFrozenLeft = (colIdx: number) => {
    if (colIdx >= FROZEN_COUNT) return undefined;
    let left = 0;
    for (let i = 0; i < colIdx; i++) left += COLUMNS[i].width;
    return left;
  };

  const renderSortIcon = (colKey: string) => {
    if (sortKey === colKey) {
      return sortDir === 'asc'
        ? <ArrowUp size={12} className="text-pink-600 flex-shrink-0" />
        : <ArrowDown size={12} className="text-pink-600 flex-shrink-0" />;
    }
    return <ArrowUpDown size={12} className="text-gray-300 flex-shrink-0" />;
  };

  return (
    <Layout title="初始并货表" subtitle="并货基础数据及配置管理">
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => navigate('/automation')}
          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white rounded-lg border border-gray-200 hover:bg-gray-50"
        >
          <ArrowLeft size={16} /> 返回自动化管理
        </button>
      </div>

      {/* 筛选面板 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 mb-4 overflow-hidden">
        <div className="px-6 py-3 flex items-center gap-2">
          <Filter size={16} className="text-pink-500" />
          <span className="font-semibold text-gray-700">筛选条件</span>
        </div>
        <div className="px-6 pb-4 border-t border-gray-100">
          <div className="flex flex-wrap items-end gap-4 mt-3">
            {/* 年份 */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">年份 ≥</label>
              <select
                value={year}
                onChange={e => setYear(e.target.value ? parseInt(e.target.value) : '')}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-pink-400 outline-none min-w-[100px]"
              >
                <option value="">所有</option>
                {filterOptions.years.map(y => (
                  <option key={y} value={y}>{y}年及以后</option>
                ))}
              </select>
            </div>

            {/* 季节 — 多选 */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">季节（可多选）</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {filterOptions.seasons.map(s => (
                  <label
                    key={s}
                    className={`px-3 py-1.5 rounded-full text-xs cursor-pointer border transition-colors select-none ${
                      season.includes(s)
                        ? 'bg-pink-100 border-pink-400 text-pink-700 font-medium'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-pink-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={season.includes(s)}
                      onChange={() => {
                        setSeason(prev =>
                          prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
                        );
                      }}
                    />
                    {s}
                  </label>
                ))}
                {season.length > 0 && (
                  <button
                    onClick={() => setSeason([])}
                    className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600"
                  >
                    清除
                  </button>
                )}
              </div>
            </div>

            <button
              onClick={handleSearch}
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2 text-sm text-white bg-pink-600 rounded-lg hover:bg-pink-700 disabled:opacity-50"
            >
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
              查询
            </button>
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              <X size={14} /> 重置
            </button>

            {/* 导出 */}
            <button
              onClick={handleExport}
              disabled={exporting || !searched || allData.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-40"
            >
              {exporting ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
              {exporting ? '导出中...' : '导出CSV'}
            </button>
          </div>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
      )}

      {/* 表格 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800">并货数据表</h3>
          <span className="text-xs text-gray-500">
            {searched && total > 0
              ? `共 ${total.toLocaleString('zh-CN', { useGrouping: false })} 条，第 ${page}/${totalPages} 页`
              : searched ? '无匹配数据' : '请设置筛选条件后点击查询'}
          </span>
        </div>

        <div className="relative overflow-auto" style={{ maxHeight: 'calc(100vh - 340px)' }}>
          <table className="w-full text-xs" style={{ minWidth: COLUMNS.reduce((s, c) => s + c.width, 0) + 50 }}>
            <thead className="sticky top-0 z-20">
              <tr className="bg-gray-100 text-gray-600">
                {COLUMNS.map((col, idx) => (
                  <th
                    key={col.key}
                    className={`px-2 py-2 text-center border-b border-gray-200 ${
                      col.frozen ? 'sticky z-30 bg-gray-100' : ''
                    } ${col.highlight ? 'bg-pink-50 text-pink-700' : ''} ${
                      col.sortable ? 'cursor-pointer select-none hover:bg-gray-200' : ''
                    }`}
                    style={{
                      width: col.width, minWidth: col.width,
                      left: col.frozen ? getFrozenLeft(idx) : undefined,
                    }}
                    onClick={() => col.sortable && handleSort(col.key)}
                    title={col.sortable ? '点击排序' : undefined}
                  >
                    <div className="whitespace-nowrap flex items-center justify-center gap-1">
                      <span>{col.label}</span>
                      {col.sortable && renderSortIcon(col.key)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-100">
              {sortedData.map((row, rowIdx) => (
                <tr key={rowIdx} className="hover:bg-pink-50/30 transition-colors">
                  {COLUMNS.map((col, colIdx) => (
                    <td
                      key={col.key}
                      className={`px-2 py-1.5 border-b border-gray-50 ${
                        col.frozen ? 'sticky z-10 bg-white' : ''
                      } ${col.numeric ? 'text-right' : 'text-left'} ${
                        col.highlight ? 'text-pink-700 font-semibold' : 'text-gray-700'
                      }`}
                      style={{
                        width: col.width, minWidth: col.width,
                        left: col.frozen ? getFrozenLeft(colIdx) : undefined,
                      }}
                    >
                      <div className="whitespace-nowrap overflow-hidden text-ellipsis" style={{ maxWidth: col.width + 20 }}>
                        {renderCell(row, col)}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}

              {/* 合计行 */}
              {sortedData.length > 0 && (
                <tr className="bg-pink-50 font-semibold border-t-2 border-pink-200">
                  {COLUMNS.map((col, colIdx) => (
                    <td
                      key={col.key}
                      className={`px-2 py-2 border-b border-pink-100 ${
                        col.frozen ? 'sticky z-10 bg-pink-50' : ''
                      } ${col.numeric ? 'text-right' : 'text-left'} text-pink-700`}
                      style={{
                        width: col.width, minWidth: col.width,
                        left: col.frozen ? getFrozenLeft(colIdx) : undefined,
                      }}
                    >
                      {colIdx === 0 ? '合计' : col.numeric ? (totals[col.key] || 0).toLocaleString('zh-CN', { useGrouping: false }) : ''}
                    </td>
                  ))}
                </tr>
              )}

              {/* 空状态 */}
              {allData.length === 0 && !loading && !searched && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-6 py-16 text-center text-gray-400">
                    请设置筛选条件后点击「查询」按钮
                  </td>
                </tr>
              )}
              {allData.length === 0 && !loading && searched && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-6 py-16 text-center text-gray-400">
                    暂无匹配数据，请调整筛选条件
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-6 py-16 text-center">
                    <RefreshCw size={24} className="animate-spin text-pink-500 mx-auto mb-2" />
                    <span className="text-gray-400 text-sm">查询中，数据量较大请耐心等待...</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 分页：纯客户端翻页 */}
        {totalPages > 1 && (
          <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
            <span className="text-xs text-gray-500">
              第 {page} 页，共 {totalPages} 页，{total.toLocaleString('zh-CN', { useGrouping: false })} 条记录
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePageChange(1)}
                disabled={page <= 1}
                className="px-2 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30"
              >首页</button>
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1}
                className="p-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30"
              ><ChevronLeft size={14} /></button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let p: number;
                if (totalPages <= 5) p = i + 1;
                else if (page <= 3) p = i + 1;
                else if (page >= totalPages - 2) p = totalPages - 4 + i;
                else p = page - 2 + i;
                return (
                  <button
                    key={p}
                    onClick={() => handlePageChange(p)}
                    className={`px-3 py-1 text-xs rounded ${
                      p === page ? 'bg-pink-600 text-white' : 'border border-gray-200 hover:bg-gray-50'
                    }`}
                  >{p}</button>
                );
              })}
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages}
                className="p-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30"
              ><ChevronRight size={14} /></button>
              <button
                onClick={() => handlePageChange(totalPages)}
                disabled={page >= totalPages}
                className="px-2 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30"
              >末页</button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default InitialMergeTablePage;
