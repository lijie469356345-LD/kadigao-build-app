import { useEffect, useState, useMemo } from 'react';
import Layout from '../components/Layout';
import { getHaoPingReport, HaoPingRow } from '../../api/douyin';
import { RefreshCw, Download, Star, Search } from 'lucide-react';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';
import { useAuthStore } from '../../store/authStore';
import * as XLSX from 'xlsx';

function HaoPingPage() {
  const { user } = useAuthStore();
  const [startDate, setStartDate] = useState('2026-08-01');
  const [endDate, setEndDate] = useState(new Date(Date.now() - 86400000).toISOString().slice(0, 10));
  const [rows, setRows] = useState<HaoPingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await getHaoPingReport(startDate, endDate, user?.groupName);
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      alert(e?.response?.data?.error || '查询失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filter = useAreaSupervisorShopFilter<HaoPingRow>(rows, {
    getArea: (r) => r.区域 || '',
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

  // 汇总：按 日期+督导+店铺名称 分组（基于筛选后数据）
  const summaryRows = useMemo(() => {
    const map: Record<string, { 日期: string; 督导: string; 店铺名称: string; 好评人数: number }> = {};
    filteredRows.forEach(r => {
      const key = `${r.日期 || ''}|${r.督导 || ''}|${r.店铺名称 || ''}`;
      if (!map[key]) {
        map[key] = { 日期: r.日期 || '', 督导: r.督导 || '', 店铺名称: r.店铺名称 || '', 好评人数: 0 };
      }
      map[key].好评人数 += r.好评人数 || 0;
    });
    return Object.values(map).sort((a, b) => (a.日期 + a.督导 + a.店铺名称).localeCompare(b.日期 + b.督导 + b.店铺名称, 'zh-CN'));
  }, [filteredRows]);

  const totalCount = filteredRows.reduce((s, r) => s + (r.好评人数 || 0), 0);

  const handleExport = () => {
    if (filteredRows.length === 0) { alert('暂无数据可导出'); return; }
    const wb = XLSX.utils.book_new();
    const summaryHeader = ['日期', '督导', '店铺名称', '好评人数'];
    const summaryData = summaryRows.map(r => [r.日期, r.督导, r.店铺名称, r.好评人数]);
    const ws1 = XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryData]);
    XLSX.utils.book_append_sheet(wb, ws1, '汇总');
    const detailHeader = ['日期', '区经', '仓库类别', '区域', '督导', '店铺名称', '会员代码', '会员手机', '好评人数'];
    const detailData = filteredRows.map(r => [r.日期 || '', r.区经 || '', r.仓库类别 || '', r.区域 || '', r.督导 || '', r.店铺名称 || '', r.会员代码 || '', r.会员手机 || '', r.好评人数 ?? 0]);
    const ws2 = XLSX.utils.aoa_to_sheet([detailHeader, ...detailData]);
    XLSX.utils.book_append_sheet(wb, ws2, '明细');
    XLSX.writeFile(wb, `好评会员报表_${startDate}.xlsx`);
  };

  const th = 'px-4 py-3 text-left text-sm font-medium text-gray-600 whitespace-nowrap';
  const td = 'px-4 py-3 text-sm text-gray-800';

  return (
    <Layout title="好评会员" subtitle="好评会员报表">
      <div className="p-4">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <label className="text-sm text-gray-600 flex items-center gap-1">
            <Star size={16} className="text-amber-500" /> 时间段：
          </label>
          <input type="date" min="2026-08-01" value={startDate} onChange={e => setStartDate(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
          <span className="text-gray-400">至</span>
          <input type="date" min="2026-08-01" value={endDate} onChange={e => setEndDate(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
          <button onClick={load} disabled={loading} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 查询
          </button>
          <button onClick={handleExport} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm flex items-center gap-1">
            <Download size={14} /> 导出
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

        {/* 第一板块：汇总 */}
        <h2 className="text-lg font-semibold text-gray-800 mb-2">汇总</h2>
        <div className="bg-white rounded-xl shadow-sm overflow-x-auto mb-6">
          <table className="w-full min-w-[600px]">
            <thead className="bg-gray-50">
              <tr>
                <th className={th}>日期</th>
                <th className={th}>督导</th>
                <th className={th}>店铺名称</th>
                <th className={th}>好评人数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">加载中...</td></tr>
              ) : summaryRows.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">暂无数据</td></tr>
              ) : summaryRows.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className={td}>{r.日期 || '-'}</td>
                  <td className={td}>{r.督导 || '-'}</td>
                  <td className={td}>{r.店铺名称 || '-'}</td>
                  <td className={td}>{r.好评人数}</td>
                </tr>
              ))}
            </tbody>
            {summaryRows.length > 0 && (
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td className={td} colSpan={3}>合计</td>
                  <td className={td}>{totalCount}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* 第二板块：明细 */}
        <h2 className="text-lg font-semibold text-gray-800 mb-2">明细</h2>
        <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="bg-gray-50">
              <tr>
                <th className={th}>日期</th>
                <th className={th}>区经</th>
                <th className={th}>仓库类别</th>
                <th className={th}>区域</th>
                <th className={th}>督导</th>
                <th className={th}>店铺名称</th>
                <th className={th}>会员代码</th>
                <th className={th}>会员手机</th>
                <th className={th}>好评人数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">加载中...</td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">暂无数据</td></tr>
              ) : filteredRows.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className={td}>{r.日期 || '-'}</td>
                  <td className={td}>{r.区经 || '-'}</td>
                  <td className={td}>{r.仓库类别 || '-'}</td>
                  <td className={td}>{r.区域 || '-'}</td>
                  <td className={td}>{r.督导 || '-'}</td>
                  <td className={td}>{r.店铺名称 || '-'}</td>
                  <td className={td}>{r.会员代码 || '-'}</td>
                  <td className={td}>{r.会员手机 || '-'}</td>
                  <td className={td}>{r.好评人数 ?? 0}</td>
                </tr>
              ))}
            </tbody>
            {filteredRows.length > 0 && (
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td className={td} colSpan={8}>合计</td>
                  <td className={td}>{totalCount}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </Layout>
  );
}

export default HaoPingPage;
