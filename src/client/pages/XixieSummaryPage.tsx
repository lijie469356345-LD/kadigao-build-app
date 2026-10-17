import { useEffect, useState, useMemo } from 'react';
import Layout from '../components/Layout';
import { getXixieSummary, XixieSummaryRow } from '../../api/xixie';
import { RefreshCw, Download, Search } from 'lucide-react';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';
import * as XLSX from 'xlsx';

function XixieSummaryPage() {
  const now = new Date();
  const [monthYear, setMonthYear] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [rows, setRows] = useState<XixieSummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 30;

  const load = async () => {
    setLoading(true);
    try {
      const data = await getXixieSummary(monthYear);
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      alert(e?.response?.data?.error || '查询失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [monthYear]);

  const filter = useAreaSupervisorShopFilter<XixieSummaryRow>(rows, {
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
  const totalInvestPeople = filteredRows.reduce((s, r) => s + (r.发放人数 || 0), 0);
  const totalIssued = filteredRows.reduce((s, r) => s + (r.发放张数 || 0), 0);
  const totalWriteoffPeople = filteredRows.reduce((s, r) => s + (r.核销人数 || 0), 0);
  const totalUsed = filteredRows.reduce((s, r) => s + (r.核销张数 || 0), 0);
  const totalRevenue = filteredRows.reduce((s, r) => s + (r.转化业绩 || 0), 0);
  const totalTransformed = filteredRows.reduce((s, r) => s + (r.转化人数 || 0), 0);

  useEffect(() => { setPage(1); }, [filter.filteredData, searchTerm]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // 汇总区：按 月份+区经+仓库类别+督导 分组，聚合各数值列（不含店铺维度）
  const summaryGroups = useMemo(() => {
    const map = new Map<string, XixieSummaryRow>();
    for (const r of filteredRows) {
      const key = [r.monthYear || '', r.区经 || '', r.仓库类别 || '', r.督导 || ''].join('|');
      if (!map.has(key)) {
        map.set(key, { monthYear: r.monthYear || '', 区经: r.区经 || '', 仓库类别: r.仓库类别 || '', 督导: r.督导 || '', 店铺名称: '', 双数: 0, 费用: 0, 发放人数: 0, 发放张数: 0, 核销人数: 0, 核销张数: 0, 转化人数: 0, 转化业绩: 0 });
      }
      const g = map.get(key)!;
      g.双数 += r.双数 || 0;
      g.费用 += r.费用 || 0;
      g.发放人数 += r.发放人数 || 0;
      g.发放张数 += r.发放张数 || 0;
      g.核销人数 += r.核销人数 || 0;
      g.核销张数 += r.核销张数 || 0;
      g.转化人数 += r.转化人数 || 0;
      g.转化业绩 += r.转化业绩 || 0;
    }
    return Array.from(map.values());
  }, [filteredRows]);

  const handleExport = () => {
    if (filteredRows.length === 0) { alert('暂无数据可导出'); return; }
    const header = ['月份', '区经', '仓库类别', '督导', '店铺名称', '双数', '费用', '发放人数', '发放张数', '核销人数', '核销张数', '转化人数', '转化业绩'];
    const data = filteredRows.map(r => [
      r.monthYear || '', r.区经 || '', r.仓库类别 || '', r.督导 || '', r.店铺名称 || '',
      r.双数 ?? 0, r.费用 ?? 0, r.发放人数 ?? 0, r.发放张数 ?? 0, r.核销人数 ?? 0, r.核销张数 ?? 0, r.转化人数 ?? 0, r.转化业绩 ?? 0,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '洗鞋汇总报表');
    XLSX.writeFile(wb, `洗鞋汇总报表_${monthYear}.xlsx`);
  };

  const th = 'px-4 py-3 text-left text-sm font-medium text-gray-600 whitespace-nowrap';
  const td = 'px-4 py-3 text-sm text-gray-800';

  return (
    <Layout title="洗鞋汇总报表" subtitle="洗鞋费用与转化数据汇总">
      <div className="p-4">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <input type="month" value={monthYear} onChange={e => setMonthYear(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
          <button onClick={load} disabled={loading} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 查询
          </button>
          <button onClick={handleExport} className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1">
            <Download size={14} /> 下载
          </button>
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

        <div className="bg-white rounded-xl shadow-sm overflow-x-auto mb-4">
          <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-700">汇总区</div>
          <table className="w-full min-w-[1000px]">
            <thead className="bg-gray-50">
              <tr>
                <th className={th}>月份</th>
                <th className={th}>区经</th>
                <th className={th}>仓库类别</th>
                <th className={th}>督导</th>
                <th className={th}>双数</th>
                <th className={th}>费用</th>
                <th className={th}>发放人数</th>
                <th className={th}>发放张数</th>
                <th className={th}>核销人数</th>
                <th className={th}>核销张数</th>
                <th className={th}>转化人数</th>
                <th className={th}>转化业绩</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={12} className="px-4 py-6 text-center text-gray-400">加载中...</td></tr>
              ) : summaryGroups.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-6 text-center text-gray-400">暂无数据</td></tr>
              ) : summaryGroups.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className={td}>{r.monthYear || '-'}</td>
                  <td className={td}>{r.区经 || '-'}</td>
                  <td className={td}>{r.仓库类别 || '-'}</td>
                  <td className={td}>{r.督导 || '-'}</td>
                  <td className={td}>{r.双数 ?? 0}</td>
                  <td className={td}>{(r.费用 ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 2, useGrouping: false })}</td>
                  <td className={td}>{r.发放人数 ?? 0}</td>
                  <td className={td}>{r.发放张数 ?? 0}</td>
                  <td className={td}>{r.核销人数 ?? 0}</td>
                  <td className={td}>{r.核销张数 ?? 0}</td>
                  <td className={td}>{r.转化人数 ?? 0}</td>
                  <td className={td}>{(r.转化业绩 ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 2, useGrouping: false })}</td>
                </tr>
              ))}
            </tbody>
            {summaryGroups.length > 0 && (
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td className={td} colSpan={4}>合计</td>
                  <td className={td}>{totalCount}</td>
                  <td className={td}>{totalCost.toLocaleString('zh-CN', { maximumFractionDigits: 2, useGrouping: false })}</td>
                  <td className={td}>{totalInvestPeople}</td>
                  <td className={td}>{totalIssued}</td>
                  <td className={td}>{totalWriteoffPeople}</td>
                  <td className={td}>{totalUsed}</td>
                  <td className={td}>{totalTransformed}</td>
                  <td className={td}>{totalRevenue.toLocaleString('zh-CN', { maximumFractionDigits: 2, useGrouping: false })}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full min-w-[1100px]">
            <thead className="bg-gray-50">
              <tr>
                <th className={th}>月份</th>
                <th className={th}>区经</th>
                <th className={th}>仓库类别</th>
                <th className={th}>督导</th>
                <th className={th}>店铺名称</th>
                <th className={th}>双数</th>
                <th className={th}>费用</th>
                <th className={th}>发放人数</th>
                <th className={th}>发放张数</th>
                <th className={th}>核销人数</th>
                <th className={th}>核销张数</th>
                <th className={th}>转化人数</th>
                <th className={th}>转化业绩</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={13} className="px-4 py-8 text-center text-gray-400">加载中...</td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={13} className="px-4 py-8 text-center text-gray-400">暂无数据</td></tr>
              ) : paginatedRows.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className={td}>{r.monthYear || '-'}</td>
                  <td className={td}>{r.区经 || '-'}</td>
                  <td className={td}>{r.仓库类别 || '-'}</td>
                  <td className={td}>{r.督导 || '-'}</td>
                  <td className={td}>{r.店铺名称 || '-'}</td>
                  <td className={td}>{r.双数 ?? 0}</td>
                  <td className={td}>{(r.费用 ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 2, useGrouping: false })}</td>
                  <td className={td}>{r.发放人数 ?? 0}</td>
                  <td className={td}>{r.发放张数 ?? 0}</td>
                  <td className={td}>{r.核销人数 ?? 0}</td>
                  <td className={td}>{r.核销张数 ?? 0}</td>
                  <td className={td}>{r.转化人数 ?? 0}</td>
                  <td className={td}>{(r.转化业绩 ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 2, useGrouping: false })}</td>
                </tr>
              ))}
            </tbody>
            {filteredRows.length > 0 && (
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td className={td} colSpan={5}>合计</td>
                  <td className={td}>{totalCount}</td>
                  <td className={td}>{totalCost.toLocaleString('zh-CN', { maximumFractionDigits: 2, useGrouping: false })}</td>
                  <td className={td}>{totalInvestPeople}</td>
                  <td className={td}>{totalIssued}</td>
                  <td className={td}>{totalWriteoffPeople}</td>
                  <td className={td}>{totalUsed}</td>
                  <td className={td}>{totalTransformed}</td>
                  <td className={td}>{totalRevenue.toLocaleString('zh-CN', { maximumFractionDigits: 2, useGrouping: false })}</td>
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
      </div>
    </Layout>
  );
}

export default XixieSummaryPage;
