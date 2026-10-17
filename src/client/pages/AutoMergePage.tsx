import { useNavigate } from 'react-router-dom';
import { ArrowLeft, GitMerge, Store, TrendingUp, RefreshCw, Search, Download } from 'lucide-react';
import { useState } from 'react';
import Layout from '../components/Layout';
import * as XLSX from 'xlsx';

interface MergeRecord {
  id: number;
  shopName: string;
  salesQuantity: number;
}

const mockData: MergeRecord[] = [
  { id: 1, shopName: '总店', salesQuantity: 1258 },
  { id: 2, shopName: '旗舰店', salesQuantity: 986 },
  { id: 3, shopName: '人民广场店', salesQuantity: 762 },
  { id: 4, shopName: '中山路店', salesQuantity: 645 },
  { id: 5, shopName: '解放碑店', salesQuantity: 528 },
  { id: 6, shopName: '五一路店', salesQuantity: 423 },
  { id: 7, shopName: '南大街店', salesQuantity: 367 },
  { id: 8, shopName: '王府井店', salesQuantity: 298 },
];

function AutoMergePage() {
  const navigate = useNavigate();
  const [searchText, setSearchText] = useState('');

  const filtered = mockData.filter(
    (item) => item.shopName.includes(searchText)
  );

  const total = filtered.reduce((sum, item) => sum + item.salesQuantity, 0);

  const handleExport = () => {
    const rows: any[][] = [['序号', '店铺名称', '销售数量']];
    filtered.forEach((item, idx) => {
      rows.push([idx + 1, item.shopName, item.salesQuantity]);
    });
    rows.push(['合计', '', total]);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '并货数据');
    XLSX.writeFile(wb, `并货表_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <Layout title="自动并货" subtitle="店铺销售数据自动并货汇总">
      <div className="mb-6 flex items-center gap-2">
        <button
          onClick={() => navigate('/automation')}
          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white rounded-lg border border-gray-200 hover:bg-gray-50"
        >
          <ArrowLeft size={16} /> 返回自动化管理
        </button>
      </div>

      {/* 顶部统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="p-5 bg-gradient-to-br from-violet-500 to-violet-600 rounded-2xl shadow-lg text-white">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              <Store className="w-5 h-5" />
            </div>
            <span className="text-sm text-white/90">店铺数量</span>
          </div>
          <p className="text-3xl font-bold">{filtered.length}</p>
        </div>
        <div className="p-5 bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl shadow-lg text-white">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
            <span className="text-sm text-white/90">销售数量</span>
          </div>
          <p className="text-3xl font-bold">{total}</p>
        </div>
        <div className="p-5 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-2xl shadow-lg text-white">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              <GitMerge className="w-5 h-5" />
            </div>
            <span className="text-sm text-white/90">并货状态</span>
          </div>
          <p className="text-3xl font-bold">进行中</p>
        </div>
      </div>

      {/* 搜索和操作栏 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="relative flex-1 md:w-80">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="搜索店铺名称..."
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-400 focus:border-violet-400 outline-none"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100">
              <RefreshCw size={14} /> 刷新数据
            </button>
            <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-violet-600 rounded-lg hover:bg-violet-700">
              <Download size={14} /> 导出Excel
            </button>
          </div>
        </div>
      </div>

      {/* 数据表格 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800">并货数据明细</h3>
          <span className="text-xs text-gray-500">共 {filtered.length} 条记录</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">序号</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">店铺名称</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">销售数量</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((item, idx) => (
                <tr key={item.id} className="hover:bg-violet-50/50 transition-colors">
                  <td className="px-6 py-4 text-sm text-gray-700">{idx + 1}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center">
                        <Store className="w-4 h-4 text-violet-600" />
                      </div>
                      {item.shopName}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700 text-right font-semibold tabular-nums">
                    {item.salesQuantity.toLocaleString('zh-CN', { useGrouping: false })}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-gray-400">
                    暂无数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && (
          <div className="px-6 py-4 border-t border-gray-100 bg-gray-50">
            <div className="flex items-center justify-end gap-4 text-sm">
              <span className="text-gray-600">合计：</span>
              <span className="font-bold text-violet-700 tabular-nums">{total.toLocaleString('zh-CN', { useGrouping: false })}</span>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default AutoMergePage;
