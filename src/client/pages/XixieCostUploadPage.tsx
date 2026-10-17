import { useEffect, useState, useMemo, useRef } from 'react';
import Layout from '../components/Layout';
import { getXixieCost, addXixieCost, bulkImportXixieCost, clearXixieCost, deleteXixieCost, XixieCostRow } from '../../api/xixie';
import { RefreshCw, Download, Upload, Plus, AlertTriangle, Search, X, Save, Trash2 } from 'lucide-react';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';
import * as XLSX from 'xlsx';

function XixieCostUploadPage() {
  const now = new Date();
  const [monthYear, setMonthYear] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [rows, setRows] = useState<XixieCostRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 30;
  const [showAdd, setShowAdd] = useState(false);
  const [newRow, setNewRow] = useState({ 店铺名称: '', 督导: '', 双数: '0', 费用: '0' });
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getXixieCost(monthYear);
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      alert(e?.response?.data?.error || '查询失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [monthYear]);

  const filter = useAreaSupervisorShopFilter<XixieCostRow>(rows, {
    getSupervisor: (r) => r.督导 || '',
    getShopName: (r) => r.店铺名称,
    getWarehouseType: (r) => r.仓库类别 || '',
    getDistrictManager: (r) => r.区经 || '',
    onChange: () => {},
  });

  const filteredRows = useMemo(() => {
    const kw = searchTerm.trim().toLowerCase();
    return filter.filteredData.filter(r => !kw || (r.店铺名称 || '').toLowerCase().includes(kw));
  }, [filter.filteredData, searchTerm]);

  const totalCount = filteredRows.reduce((s, r) => s + (r.双数 || 0), 0);
  const totalCost = filteredRows.reduce((s, r) => s + (r.费用 || 0), 0);

  useEffect(() => { setPage(1); }, [filter.filteredData, searchTerm]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleAddSave = async () => {
    if (!newRow.店铺名称.trim()) { alert('店铺名称不能为空'); return; }
    try {
      await addXixieCost({ monthYear, ...newRow });
      setShowAdd(false);
      setNewRow({ 店铺名称: '', 督导: '', 双数: '0', 费用: '0' });
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || '新增失败');
    }
  };

  const handleDownloadTemplate = () => {
    const rows = [['月份', '店铺名称', '双数', '费用']];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '洗鞋费用导入模板');
    XLSX.writeFile(wb, `洗鞋费用导入模板.xlsx`);
  };

  const handleImportClick = () => {
    if (!window.confirm('请准备 Excel 文件，首行为列名（月份、店铺名称、双数、费用）。确定导入？')) return;
    fileRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
      if (json.length === 0) { alert('Excel 无数据'); return; }
      // 月份默认使用页面选择的月份；若 Excel 月份已是 YYYY-MM 则保留
      const normalized = json.map(r => {
        const m = String(r['月份'] || r['monthYear'] || '').trim();
        return { ...r, '月份': /^(\d{4})/.test(m) ? m : monthYear };
      });
      if (!window.confirm(`共解析到 ${normalized.length} 条数据，确定导入吗？`)) return;
      const res = await bulkImportXixieCost(normalized);
      alert(`成功导入 ${res.count} 条`);
      load();
    } catch (err: any) {
      alert('导入失败: ' + (err?.response?.data?.error || err?.message || ''));
    } finally {
      e.target.value = '';
    }
  };

  const handleClear = async () => {
    if (!window.confirm('确定清空所有洗鞋费用数据吗？此操作不可撤销！')) return;
    if (!window.confirm('再次确认：清空后数据将无法恢复，确定继续？')) return;
    try {
      await clearXixieCost();
      alert('已清空所有数据');
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || '清空失败');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('确定删除这条记录吗？')) return;
    try {
      await deleteXixieCost(id);
      load();
    } catch (e: any) {
      alert('删除失败');
    }
  };

  const handleExport = () => {
    if (filteredRows.length === 0) { alert('暂无数据可导出'); return; }
    const header = ['月份', '区经', '仓库类别', '督导', '店铺名称', '双数', '费用'];
    const data = filteredRows.map(r => [
      r.monthYear || '', r.区经 || '', r.仓库类别 || '', r.督导 || '', r.店铺名称 || '', r.双数 ?? 0, r.费用 ?? 0,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '洗鞋费用');
    XLSX.writeFile(wb, `洗鞋费用_${monthYear}.xlsx`);
  };

  const th = 'px-4 py-3 text-left text-sm font-medium text-gray-600 whitespace-nowrap';
  const td = 'px-4 py-3 text-sm text-gray-800';

  return (
    <Layout title="洗鞋费用上传" subtitle="洗鞋费用数据管理">
      <div className="p-4">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <input type="month" value={monthYear} onChange={e => setMonthYear(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
          <button onClick={load} disabled={loading} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 查询
          </button>
          <button onClick={handleDownloadTemplate} className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm flex items-center gap-1">
            <Download size={14} /> 下载模板
          </button>
          <button onClick={handleImportClick} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm flex items-center gap-1">
            <Upload size={14} /> 批量导入
          </button>
          <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 bg-primary text-white rounded-lg text-sm flex items-center gap-1">
            <Plus size={14} /> 新增
          </button>
          <button onClick={handleExport} className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1">
            <Download size={14} /> 导出
          </button>
          <button onClick={handleClear} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm flex items-center gap-1">
            <AlertTriangle size={14} /> 清空数据
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportFile} />
        </div>

        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <AreaSupervisorShopFilter filter={filter} />
          <div className="relative ml-auto">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="搜索店铺名称..."
              className="border border-gray-200 rounded-lg pl-7 pr-3 py-1.5 text-sm w-48"
            />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="bg-gray-50">
              <tr>
                <th className={th}>月份</th>
                <th className={th}>区经</th>
                <th className={th}>仓库类别</th>
                <th className={th}>督导</th>
                <th className={th}>店铺名称</th>
                <th className={th}>双数</th>
                <th className={th}>费用</th>
                <th className={th}>操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">加载中...</td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">暂无数据</td></tr>
              ) : paginatedRows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className={td}>{r.monthYear || '-'}</td>
                  <td className={td}>{r.区经 || '-'}</td>
                  <td className={td}>{r.仓库类别 || '-'}</td>
                  <td className={td}>{r.督导 || '-'}</td>
                  <td className={td}>{r.店铺名称 || '-'}</td>
                  <td className={td}>{r.双数 ?? 0}</td>
                  <td className={td}>{(r.费用 ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 2, useGrouping: false })}</td>
                  <td className={td}>
                    <button onClick={() => handleDelete(r.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
            {filteredRows.length > 0 && (
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td className={td} colSpan={5}>合计</td>
                  <td className={td}>{totalCount}</td>
                  <td className={td}>{totalCost.toLocaleString('zh-CN', { maximumFractionDigits: 2, useGrouping: false })}</td>
                  <td className={td}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {filteredRows.length > 0 && (
          <div className="flex items-center justify-between mt-3">
            <span className="text-sm text-gray-500">共 {filteredRows.length} 条，第 {currentPage}/{totalPages} 页</span>
            <div className="flex gap-2">
              <button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50">上一页</button>
              <button disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50">下一页</button>
            </div>
          </div>
        )}

        {showAdd && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-800">新增洗鞋费用</h3>
                <button onClick={() => setShowAdd(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">店铺名称 <span className="text-red-500">*</span></label>
                  <input type="text" value={newRow.店铺名称} onChange={(e) => setNewRow({ ...newRow, 店铺名称: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">督导（留空自动补全）</label>
                  <input type="text" value={newRow.督导} onChange={(e) => setNewRow({ ...newRow, 督导: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">双数</label>
                  <input type="number" value={newRow.双数} onChange={(e) => setNewRow({ ...newRow, 双数: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">费用</label>
                  <input type="number" value={newRow.费用} onChange={(e) => setNewRow({ ...newRow, 费用: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg outline-none" />
                </div>
              </div>
              <div className="flex gap-3 justify-end mt-6">
                <button onClick={() => setShowAdd(false)} className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">取消</button>
                <button onClick={handleAddSave} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90">
                  <Save size={16} /> 保存
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default XixieCostUploadPage;
