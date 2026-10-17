import { useEffect, useState, useMemo } from 'react';
import Layout from '../components/Layout';
import { getWaziReport, WaziRow } from '../../api/douyin';
import { RefreshCw, Download, Footprints, Search } from 'lucide-react';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';
import { useAuthStore } from '../../store/authStore';
import * as XLSX from 'xlsx';

function WaziPage() {
  const { user } = useAuthStore();
  const [startDate, setStartDate] = useState('2026-07-04');
  const [endDate, setEndDate] = useState(new Date(Date.now() - 86400000).toISOString().slice(0, 10));
  const [rows, setRows] = useState<WaziRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await getWaziReport(startDate, endDate, user?.groupName);
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      alert(e?.response?.data?.error || '查询失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filter = useAreaSupervisorShopFilter<WaziRow>(rows, {
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

  // 汇总：按督导分组（基于筛选后数据）
  const summaryRows = useMemo(() => {
    const map: Record<string, { 督导: string; 转化人数: number; 总人数: number; 转化率: number; 鞋包数量: number; 鞋包业绩: number }> = {};
    filteredRows.forEach(r => {
      const key = r.督导 || '未知';
      if (!map[key]) {
        map[key] = { 督导: key, 转化人数: 0, 总人数: 0, 转化率: 0, 鞋包数量: 0, 鞋包业绩: 0 };
      }
      map[key].转化人数 += r.转化人数 || 0;
      map[key].总人数 += r.总人数 || 0;
      map[key].鞋包数量 += r.鞋包数量 || 0;
      map[key].鞋包业绩 += r.鞋包业绩 || 0;
    });
    const list = Object.values(map);
    list.forEach(r => { r.转化率 = r.总人数 > 0 ? (r.转化人数 * 100) / r.总人数 : 0; });
    return list.sort((a, b) => a.督导.localeCompare(b.督导, 'zh-CN'));
  }, [filteredRows]);

  const total = filteredRows.reduce((acc, r) => ({
    转化人数: acc.转化人数 + (r.转化人数 || 0),
    总人数: acc.总人数 + (r.总人数 || 0),
    鞋包数量: acc.鞋包数量 + (r.鞋包数量 || 0),
    鞋包业绩: acc.鞋包业绩 + (r.鞋包业绩 || 0),
  }), { 转化人数: 0, 总人数: 0, 鞋包数量: 0, 鞋包业绩: 0 });
  const totalRate = total.总人数 > 0 ? ((total.转化人数 * 100) / total.总人数).toFixed(1) : '0.0';

  const handleExport = () => {
    if (filteredRows.length === 0) { alert('暂无数据可导出'); return; }
    const wb = XLSX.utils.book_new();
    const summaryHeader = ['督导', '转化人数', '总人数', '转化率(%)', '鞋包数量', '鞋包业绩'];
    const summaryData = summaryRows.map(r => [r.督导, r.转化人数, r.总人数, r.转化率.toFixed(1), r.鞋包数量, r.鞋包业绩]);
    const ws1 = XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryData]);
    XLSX.utils.book_append_sheet(wb, ws1, '汇总');
    const detailHeader = ['区经', '仓库类别', '区域', '督导', '店铺名称', '转化人数', '总人数', '转化率(%)', '鞋包数量', '鞋包业绩'];
    const detailData = filteredRows.map(r => [r.区经 || '', r.仓库类别 || '', r.区域 || '', r.督导 || '', r.店铺名称 || '', r.转化人数 ?? 0, r.总人数 ?? 0, (r.转化率 ?? 0).toFixed(1), r.鞋包数量 ?? 0, r.鞋包业绩 ?? 0]);
    const ws2 = XLSX.utils.aoa_to_sheet([detailHeader, ...detailData]);
    XLSX.utils.book_append_sheet(wb, ws2, '明细');
    XLSX.writeFile(wb, `袜子转化报表_${startDate}_${endDate}.xlsx`);
  };

  const th = 'px-4 py-3 text-left text-sm font-medium text-gray-600 whitespace-nowrap';
  const td = 'px-4 py-3 text-sm text-gray-800';

  return (
    <Layout title="袜子转化" subtitle="袜子转化报表">
      <div className="p-4">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <label className="text-sm text-gray-600 flex items-center gap-1">
            <Footprints size={16} className="text-cyan-600" /> 时间段：
          </label>
          <input type="date" min="2026-07-04" value={startDate} onChange={e => setStartDate(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
          <span className="text-gray-400">至</span>
          <input type="date" min="2026-07-04" value={endDate} onChange={e => setEndDate(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
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
          <table className="w-full min-w-[700px]">
            <thead className="bg-gray-50">
              <tr>
                <th className={th}>督导</th>
                <th className={th}>转化人数</th>
                <th className={th}>总人数</th>
                <th className={th}>转化率</th>
                <th className={th}>鞋包数量</th>
                <th className={th}>鞋包业绩</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">加载中...</td></tr>
              ) : summaryRows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">暂无数据</td></tr>
              ) : summaryRows.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className={td}>{r.督导}</td>
                  <td className={td}>{r.转化人数}</td>
                  <td className={td}>{r.总人数}</td>
                  <td className={td}>{r.转化率.toFixed(1)}%</td>
                  <td className={td}>{r.鞋包数量}</td>
                  <td className={td}>{r.鞋包业绩.toLocaleString('zh-CN', { maximumFractionDigits: 2, useGrouping: false })}</td>
                </tr>
              ))}
            </tbody>
            {summaryRows.length > 0 && (
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td className={td}>合计</td>
                  <td className={td}>{total.转化人数}</td>
                  <td className={td}>{total.总人数}</td>
                  <td className={td}>{totalRate}%</td>
                  <td className={td}>{total.鞋包数量}</td>
                  <td className={td}>{total.鞋包业绩.toLocaleString('zh-CN', { maximumFractionDigits: 2, useGrouping: false })}</td>
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
                <th className={th}>区经</th>
                <th className={th}>仓库类别</th>
                <th className={th}>区域</th>
                <th className={th}>督导</th>
                <th className={th}>店铺名称</th>
                <th className={th}>转化人数</th>
                <th className={th}>总人数</th>
                <th className={th}>转化率</th>
                <th className={th}>鞋包数量</th>
                <th className={th}>鞋包业绩</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">加载中...</td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">暂无数据</td></tr>
              ) : filteredRows.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className={td}>{r.区经 || '-'}</td>
                  <td className={td}>{r.仓库类别 || '-'}</td>
                  <td className={td}>{r.区域 || '-'}</td>
                  <td className={td}>{r.督导 || '-'}</td>
                  <td className={td}>{r.店铺名称 || '-'}</td>
                  <td className={td}>{r.转化人数 ?? 0}</td>
                  <td className={td}>{r.总人数 ?? 0}</td>
                  <td className={td}>{(r.转化率 ?? 0).toFixed(1)}%</td>
                  <td className={td}>{r.鞋包数量 ?? 0}</td>
                  <td className={td}>{(r.鞋包业绩 ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 2, useGrouping: false })}</td>
                </tr>
              ))}
            </tbody>
            {filteredRows.length > 0 && (
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td className={td} colSpan={5}>合计</td>
                  <td className={td}>{total.转化人数}</td>
                  <td className={td}>{total.总人数}</td>
                  <td className={td}>{totalRate}%</td>
                  <td className={td}>{total.鞋包数量}</td>
                  <td className={td}>{total.鞋包业绩.toLocaleString('zh-CN', { maximumFractionDigits: 2, useGrouping: false })}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </Layout>
  );
}

export default WaziPage;
