import { useState, useEffect } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import Layout from '../components/Layout';
import axios from 'axios';
import * as XLSX from 'xlsx';

interface FinanceFieldRow {
  商品代码: string;
  品名: string;
  年份: string;
  季节: string;
  性别: string;
  财务性别: string | null;
}

function FinanceFieldPage() {
  const [data, setData] = useState<FinanceFieldRow[]>([]);
  const [filteredData, setFilteredData] = useState<FinanceFieldRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await axios.get('/api/finance-field');
      setData(res.data.data);
      setFilteredData(res.data.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!searchText.trim()) {
      setFilteredData(data);
      return;
    }
    const kw = searchText.toLowerCase();
    setFilteredData(data.filter(row =>
      (row.商品代码 || '').toLowerCase().includes(kw) ||
      (row.品名 || '').toLowerCase().includes(kw) ||
      (row.年份 || '').toString().includes(kw) ||
      (row.季节 || '').toLowerCase().includes(kw) ||
      (row.性别 || '').toLowerCase().includes(kw)
    ));
  }, [searchText, data]);

  const exportExcel = () => {
    const rows: any[][] = [['商品代码', '品名', '年份', '季节', '性别', '财务性别']];
    filteredData.forEach(row => {
      rows.push([row.商品代码, row.品名, row.年份, row.季节, row.性别, row.财务性别 || '']);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '财务字段');
    XLSX.writeFile(wb, `财务字段_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <Layout title="财务字段" subtitle="商品财务字段缺失数据查询">
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <p className="text-red-600">数据加载失败: {error}</p>
            <button onClick={loadData} className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600">重新加载</button>
          </div>
        </div>
      )}

      <div className="w-full">
        <div className="sticky top-0 z-30 bg-white shadow-sm px-6 py-3 border-b">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="relative w-64">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="搜索商品代码/品名..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/50 outline-none"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={loadData}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-1.5 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
              >
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                <span className="text-sm">刷新数据</span>
              </button>
              <button onClick={exportExcel} className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
                导出Excel
              </button>
            </div>
          </div>
          <div className="mt-2 text-sm text-gray-500">
            共 {filteredData.length} 条记录（财务性别为空）
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredData.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[400px]">
            <p className="text-xl text-gray-500">暂无数据</p>
          </div>
        ) : (
          <div className="mx-6 mt-4 bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 z-20">
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">商品代码</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">品名</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">年份</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">季节</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">性别</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">财务性别</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredData.map((row, index) => (
                    <tr key={index} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-800 font-medium">{row.商品代码}</td>
                      <td className="px-4 py-3 text-gray-600">{row.品名}</td>
                      <td className="px-4 py-3 text-gray-600">{row.年份}</td>
                      <td className="px-4 py-3 text-gray-600">{row.季节}</td>
                      <td className="px-4 py-3 text-gray-600">{row.性别}</td>
                      <td className="px-4 py-3 text-red-500 font-medium">{row.财务性别 ?? 'NULL'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default FinanceFieldPage;
