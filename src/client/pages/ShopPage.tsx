import { useEffect, useState, useMemo } from 'react';
import { Search, Store, MapPin, User, Phone, Calendar, Building, RefreshCw, Filter, Download } from 'lucide-react';
import { getShops } from '../../api/shops';
import type { Shop } from '../../types';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { useDataCacheStore } from '../../store/dataCacheStore';
import * as XLSX from 'xlsx';

const PAGE_KEY = 'shopPage';

function ShopPage() {
  const { user } = useAuthStore();
  const { pageCache, setPageCache, clearPageCache } = useDataCacheStore();
  const isAdmin = user?.isAdmin === '是';
  const [shops, setShops] = useState<Shop[]>(pageCache[PAGE_KEY] || []);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [hasData, setHasData] = useState(!!pageCache[PAGE_KEY]);
  const [filterWarehouse, setFilterWarehouse] = useState('全部');
  const [filterArea, setFilterArea] = useState('全部');
  const [filterDM, setFilterDM] = useState('全部');
  const [filterSupervisor, setFilterSupervisor] = useState('全部');
  const [filterProduct, setFilterProduct] = useState('全部');
  const [filterProductLeader, setFilterProductLeader] = useState('全部');
  const [filterDealer, setFilterDealer] = useState('全部');

  const filterOptions = useMemo(() => {
    const unique = <T,>(fn: (s: Shop) => T) => ['全部', ...new Set(shops.map(fn).filter(Boolean))].sort() as string[];
    return {
      warehouseTypes: unique(s => s.warehouseType),
      areas: unique(s => s.area),
      districtManagers: unique(s => s.districtManager),
      supervisors: unique(s => s.supervisor),
      products: unique(s => s.product),
      productLeaders: unique(s => s.productLeader),
      dealers: unique(s => s.dealer),
    };
  }, [shops]);

  useEffect(() => {
    if (!pageCache[PAGE_KEY]) {
      loadShops();
    }
  }, []);

  const loadShops = async () => {
    try {
      setLoading(true);
      const data = await getShops(user?.groupName || '');
      setShops(data);
      setHasData(true);
      setPageCache(PAGE_KEY, data);
    } catch (error) {
      console.error('获取店铺列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    clearPageCache(PAGE_KEY);
    loadShops();
  };

  const handleExport = () => {
    const headers = ['店铺名称', '仓库类别', '区域', '区经', '督导', '商品', '商品组长', '联系人', '电话', '经销商', '开业日期', '月可比', '年可比'];
    const keys: (keyof Shop)[] = ['shopName', 'warehouseType', 'area', 'districtManager', 'supervisor', 'product', 'productLeader', 'contactPerson', 'phone', 'dealer', 'openDate', 'monthComparable', 'yearComparable'];
    const rows = [headers];
    filteredShops.forEach(s => {
      rows.push(keys.map(k => (s[k] != null ? String(s[k]) : '')));
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '店铺档案');
    XLSX.writeFile(wb, `店铺档案_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const filteredShops = shops.filter(s => {
    if (filterWarehouse !== '全部' && (s.warehouseType || '') !== filterWarehouse) return false;
    if (filterArea !== '全部' && (s.area || '') !== filterArea) return false;
    if (filterDM !== '全部' && (s.districtManager || '') !== filterDM) return false;
    if (filterSupervisor !== '全部' && (s.supervisor || '') !== filterSupervisor) return false;
    if (filterProduct !== '全部' && (s.product || '') !== filterProduct) return false;
    if (filterProductLeader !== '全部' && (s.productLeader || '') !== filterProductLeader) return false;
    if (filterDealer !== '全部' && (s.dealer || '') !== filterDealer) return false;
    if (!searchTerm) return true;
    const kw = searchTerm.toLowerCase();
    return (s.shopName?.toLowerCase().includes(kw)) ||
      (s.area?.toLowerCase().includes(kw)) ||
      (s.districtManager?.toLowerCase().includes(kw)) ||
      (s.supervisor?.toLowerCase().includes(kw)) ||
      (s.contactPerson?.toLowerCase().includes(kw)) ||
      (s.phone?.includes(searchTerm));
  });

  const FilterSelect = ({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: string[]; label: string }) => (
    <div className="flex items-center gap-1">
      <span className="text-xs text-gray-500 whitespace-nowrap">{label}:</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="border border-gray-200 rounded px-2 py-1.5 text-sm bg-white focus:ring-1 focus:ring-primary/50 outline-none">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  const totalShops = shops.length;
  const filteredCount = filteredShops.length;

  return (
    <Layout title="店铺档案" subtitle="管理店铺信息">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="relative max-w-md w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索店铺名称、联系人、电话..."
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{filteredCount} / {totalShops} 条</span>
            <button onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
              <Download size={18} />
              <span>导出</span>
            </button>
            <button onClick={handleRefresh} disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50">
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
              <span>刷新数据</span>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 mb-4 flex-wrap bg-white rounded-lg p-3 shadow-sm border border-gray-100">
          <Filter size={16} className="text-gray-400" />
          <FilterSelect label="仓库类别" value={filterWarehouse} onChange={setFilterWarehouse} options={filterOptions.warehouseTypes} />
          <FilterSelect label="区域" value={filterArea} onChange={setFilterArea} options={filterOptions.areas} />
          <FilterSelect label="区经" value={filterDM} onChange={setFilterDM} options={filterOptions.districtManagers} />
          <FilterSelect label="督导" value={filterSupervisor} onChange={setFilterSupervisor} options={filterOptions.supervisors} />
          <FilterSelect label="商品" value={filterProduct} onChange={setFilterProduct} options={filterOptions.products} />
          <FilterSelect label="商品组长" value={filterProductLeader} onChange={setFilterProductLeader} options={filterOptions.productLeaders} />
          <FilterSelect label="经销商" value={filterDealer} onChange={setFilterDealer} options={filterOptions.dealers} />
          {(filterWarehouse !== '全部' || filterArea !== '全部' || filterDM !== '全部' || filterSupervisor !== '全部' || filterProduct !== '全部' || filterProductLeader !== '全部' || filterDealer !== '全部') && (
            <button onClick={() => { setFilterWarehouse('全部'); setFilterArea('全部'); setFilterDM('全部'); setFilterSupervisor('全部'); setFilterProduct('全部'); setFilterProductLeader('全部'); setFilterDealer('全部'); }}
              className="text-xs text-primary hover:underline ml-2">清除筛选</button>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full min-w-[1200px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-4 text-left text-sm font-medium text-gray-600">店铺名称</th>
                <th className="px-4 py-4 text-left text-sm font-medium text-gray-600">仓库类别</th>
                <th className="px-4 py-4 text-left text-sm font-medium text-gray-600">区域</th>
                <th className="px-4 py-4 text-left text-sm font-medium text-gray-600">区经</th>
                <th className="px-4 py-4 text-left text-sm font-medium text-gray-600">督导</th>
                <th className="px-4 py-4 text-left text-sm font-medium text-gray-600">商品</th>
                <th className="px-4 py-4 text-left text-sm font-medium text-gray-600">商品组长</th>
                <th className="px-4 py-4 text-left text-sm font-medium text-gray-600">联系人</th>
                <th className="px-4 py-4 text-left text-sm font-medium text-gray-600">电话</th>
                <th className="px-4 py-4 text-left text-sm font-medium text-gray-600">经销商</th>
                <th className="px-4 py-4 text-left text-sm font-medium text-gray-600">开业日期</th>
                <th className="px-4 py-4 text-left text-sm font-medium text-gray-600">月可比</th>
                <th className="px-4 py-4 text-left text-sm font-medium text-gray-600">年可比</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={13} className="px-4 py-8 text-center text-gray-400">
                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p>加载中...</p>
                  </td>
                </tr>
              ) : filteredShops.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-4 py-8 text-center text-gray-400">
                    <p>暂无数据</p>
                  </td>
                </tr>
              ) : (
                filteredShops.map((shop) => (
                  <tr key={shop.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 text-gray-800">
                        <Store size={16} className="text-gray-400" />
                        {shop.shopName}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-gray-800">
                      {shop.warehouseType || '-'}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 text-gray-800">
                        <MapPin size={16} className="text-gray-400" />
                        {shop.area || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-gray-800">
                      {shop.districtManager || '-'}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 text-gray-800">
                        <User size={16} className="text-gray-400" />
                        {shop.supervisor || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-gray-800">
                      {shop.product || '-'}
                    </td>
                    <td className="px-4 py-4 text-gray-800">
                      {shop.productLeader || '-'}
                    </td>
                    <td className="px-4 py-4 text-gray-800">
                      {shop.contactPerson || '-'}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 text-gray-800">
                        <Phone size={16} className="text-gray-400" />
                        {shop.phone || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-gray-800">
                      <div className="flex items-center gap-2 text-gray-800">
                        <Building size={16} className="text-gray-400" />
                        {shop.dealer || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 text-gray-800">
                        <Calendar size={16} className="text-gray-400" />
                        {shop.openDate || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-gray-800">
                      {shop.monthComparable || '-'}
                    </td>
                    <td className="px-4 py-4 text-gray-800">
                      {shop.yearComparable || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}

export default ShopPage;
