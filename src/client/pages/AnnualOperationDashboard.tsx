import { useState, useEffect, useCallback, useMemo } from 'react';
import { LayoutDashboard, Search } from 'lucide-react';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { getShops } from '../../api/shops';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';
import axios from '../../api/axios';

interface AnnualDashboardData {
  shop: { code: string; name: string; dealer: string; supervisor: string; product: string; yearTarget: number; completed: number; rate: number; gap: number; openDate: string; cabinetCount: number };
  dealer: { name: string; yearTarget: number; completed: number; rate: number; shopCount: number; stock: number };
  supervisor: { name: string; yearTarget: number; completed: number; rate: number; shopCount: number; product: string };
  districtManager: { name: string; yearTarget: number; completed: number; rate: number; shopCount: number };
  monthly: { targets: number[]; currentPeriod: number[]; samePeriod: number[] };
}

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const fmt = (v: number) => Math.round(v || 0).toLocaleString('zh-CN', { useGrouping: false });
const pct = (done: number, target: number) => (target > 0 ? ((done / target) * 100).toFixed(1) + '%' : '-');

function AnnualOperationDashboard() {
  const { user } = useAuthStore();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [shopList, setShopList] = useState<any[]>([]);
  const [data, setData] = useState<AnnualDashboardData | null>(null);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadShops = useCallback(async () => {
    try {
      const shops = await getShops(user?.groupName);
      setShopList(Array.isArray(shops) ? shops : []);
    } catch { }
  }, [user?.groupName]);

  // 区经/区域/督导/店铺/仓库 筛选（去掉独立店铺下拉，改用联动筛选）
  const comparableOptions = useMemo(() => {
    const month = Array.from(new Set(shopList.map(s => s.monthComparable).filter(Boolean) as string[]));
    const year = Array.from(new Set(shopList.map(s => s.yearComparable).filter(Boolean) as string[]));
    return { month, year };
  }, [shopList]);

  const filter = useAreaSupervisorShopFilter(shopList, {
    getArea: (s) => s.area,
    getSupervisor: (s) => s.supervisor,
    getShopName: (s) => s.shopName,
    getWarehouseType: (s) => s.warehouseType,
    getDistrictManager: (s) => s.districtManager,
    getMonthComparable: (s) => s.monthComparable,
    getYearComparable: (s) => s.yearComparable,
    monthComparableOptions: comparableOptions.month,
    yearComparableOptions: comparableOptions.year,
  });
  const filteredShops = useMemo(() => {
    let result = filter.filteredData;
    if (searchText.trim()) {
      const kw = searchText.trim().toLowerCase();
      result = result.filter(s =>
        (s.supervisor || '').toLowerCase().includes(kw) ||
        (s.districtManager || '').toLowerCase().includes(kw) ||
        (s.shopName || '').toLowerCase().includes(kw)
      );
    }
    return result;
  }, [filter.filteredData, searchText]);
  const currentShopName = filteredShops[0]?.shopName || '';

  const loadData = useCallback(async () => {
    if (!currentShopName) { setData(null); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get('/annual-operation-dashboard', { params: { shopName: currentShopName, year }, timeout: 120000 });
      setData(res.data?.data || null);
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [currentShopName, year]);

  useEffect(() => { loadShops(); }, [loadShops]);
  useEffect(() => { loadData(); }, [loadData]);

  const th = 'border border-gray-400 px-2 py-1.5 text-xs font-bold text-gray-700 text-center bg-gray-100 whitespace-nowrap';
  const td = 'border border-gray-400 px-2 py-1.5 text-xs text-center whitespace-nowrap';
  const tdLabel = 'border border-gray-400 px-2 py-1.5 text-xs font-bold text-gray-700 text-center bg-gray-50 whitespace-nowrap';

  const samePeriod = data?.monthly.samePeriod || [];
  const currentPeriod = data?.monthly.currentPeriod || [];
  // 截至上月：当前年份取到本月前一个月，历史年份取全年
  const lastMonthCutoff = year === new Date().getFullYear() ? Math.max(0, new Date().getMonth()) : 12;
  const sameTotalAll = samePeriod.reduce((s, v) => s + v, 0);
  const currentTotalAll = currentPeriod.reduce((s, v) => s + v, 0);
  const sameTotalLastMonth = samePeriod.slice(0, lastMonthCutoff).reduce((s, v) => s + v, 0);
  const currentTotalLastMonth = currentPeriod.slice(0, lastMonthCutoff).reduce((s, v) => s + v, 0);
  const targetTotalAll = (data?.monthly.targets || []).reduce((s, v) => s + v, 0);
  const growthPct = (cur: number, same: number) => same > 0 ? ((cur - same) / same) * 100 : 0;

  return (
    <Layout title="年度经营看板" subtitle={`${year}年度 店铺经营数据看板`}>
      <div className="p-4 space-y-6">
        {/* 筛选器 */}
        <div className="flex items-center gap-3 flex-wrap">
          <AreaSupervisorShopFilter filter={filter as any} />
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="搜索督导/区经/店铺..."
              className="pl-9 pr-3 py-1.5 w-56 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <label className="text-xs font-bold text-gray-600 ml-2">年份:</label>
          <select value={year} onChange={e => setYear(+e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded text-sm">
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}年</option>)}
          </select>
          <button onClick={loadData} disabled={loading} className="px-3 py-1.5 bg-primary text-white rounded text-sm hover:bg-primary-dark disabled:opacity-50">{loading ? '加载中...' : '查询'}</button>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        {!data ? (
          <p className="text-gray-400 py-16 text-center">{currentShopName ? '加载中...' : '请选择店铺查看年度经营数据'}</p>
        ) : (
          <>
            {/* ===== 第一区：数据详情 ===== */}
            <div className="bg-white border border-gray-400 rounded overflow-hidden">
              <div className="px-4 py-2 bg-blue-50 border-b border-gray-400">
                <h3 className="font-bold text-blue-700 flex items-center gap-2"><LayoutDashboard size={16} />第一区 · 数据详情</h3>
              </div>
              <table className="border-collapse text-xs w-full">
                <tbody>
                  <tr>
                    <td className={tdLabel}>店铺编号</td><td className={td}>{data.shop.code || '-'}</td>
                    <td className={tdLabel}>店铺名称</td><td className={td}>{data.shop.name}</td>
                    <td className={tdLabel}>年任务</td><td className={td}>{fmt(data.shop.yearTarget)}</td>
                    <td className={tdLabel}>已完成</td><td className={td}>{fmt(data.shop.completed)}</td>
                    <td className={tdLabel}>完成率</td><td className={td}>{pct(data.shop.completed, data.shop.yearTarget)}</td>
                    <td className={tdLabel}>差额</td><td className={td} style={{color:'#dc2626',fontWeight:'bold'}}>{fmt(data.shop.gap)}</td>
                  </tr>
                  <tr>
                    <td className={tdLabel}>经销商</td><td className={td}>{data.dealer.name || '-'}</td>
                    <td className={tdLabel}>年任务</td><td className={td}>{fmt(data.dealer.yearTarget)}</td>
                    <td className={tdLabel}>已完成</td><td className={td}>{fmt(data.dealer.completed)}</td>
                    <td className={tdLabel}>完成率</td><td className={td}>{pct(data.dealer.completed, data.dealer.yearTarget)}</td>
                    <td className={tdLabel}>店数</td><td className={td}>{data.dealer.shopCount}</td>
                    <td className={tdLabel}>总库存</td><td className={td}>{fmt(data.dealer.stock)}</td>
                  </tr>
                  <tr>
                    <td className={tdLabel}>督导</td><td className={td}>{data.supervisor.name || '-'}</td>
                    <td className={tdLabel}>年任务</td><td className={td}>{fmt(data.supervisor.yearTarget)}</td>
                    <td className={tdLabel}>已完成</td><td className={td}>{fmt(data.supervisor.completed)}</td>
                    <td className={tdLabel}>完成率</td><td className={td}>{pct(data.supervisor.completed, data.supervisor.yearTarget)}</td>
                    <td className={tdLabel}>店数</td><td className={td}>{data.supervisor.shopCount}</td>
                    <td className={tdLabel}>商品</td><td className={td}>{data.supervisor.product || '-'}</td>
                  </tr>
                  <tr>
                    <td className={tdLabel}>区经</td><td className={td}>{data.districtManager.name || '-'}</td>
                    <td className={tdLabel}>年任务</td><td className={td}>{fmt(data.districtManager.yearTarget)}</td>
                    <td className={tdLabel}>已完成</td><td className={td}>{fmt(data.districtManager.completed)}</td>
                    <td className={tdLabel}>完成率</td><td className={td}>{pct(data.districtManager.completed, data.districtManager.yearTarget)}</td>
                    <td className={tdLabel}>店数</td><td className={td}>{data.districtManager.shopCount}</td>
                    <td className={td}></td><td className={td}></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ===== 第二区：本期同期对比 ===== */}
            <div className="bg-white border border-gray-400 rounded overflow-hidden">
              <div className="px-4 py-2 bg-green-50 border-b border-gray-400">
                <h3 className="font-bold text-green-700">第二区 · 本期同期对比</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="border-collapse text-xs w-full" style={{ minWidth: 1100 }}>
                  <thead>
                    <tr>
                      <th className={th}>月份</th>
                      {MONTHS.map(m => <th key={m} className={th}>{m}</th>)}
                      <th className={th}>截至上月合计</th>
                      <th className={th}>总合计</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className={tdLabel}>同期业绩</td>
                      {data.monthly.samePeriod.map((v, i) => <td key={i} className={td}>{fmt(v)}</td>)}
                      <td className={td} style={{fontWeight:'bold'}}>{fmt(sameTotalLastMonth)}</td>
                      <td className={td} style={{fontWeight:'bold',color:'#2563eb'}}>{fmt(sameTotalAll)}</td>
                    </tr>
                    <tr>
                      <td className={tdLabel}>本期业绩</td>
                      {data.monthly.currentPeriod.map((v, i) => <td key={i} className={td} style={v > 0 ? {fontWeight:'bold'} : {color:'#ccc'}}>{v > 0 ? fmt(v) : ''}</td>)}
                      <td className={td} style={{fontWeight:'bold'}}>{fmt(currentTotalLastMonth)}</td>
                      <td className={td} style={{fontWeight:'bold',color:'#2563eb'}}>{fmt(currentTotalAll)}</td>
                    </tr>
                    <tr>
                      <td className={tdLabel}>同比增长</td>
                      {data.monthly.currentPeriod.map((cur, i) => {
                        const same = data.monthly.samePeriod[i] || 0;
                        const growth = same > 0 ? ((cur - same) / same) * 100 : 0;
                        return <td key={i} className={td} style={{color: growth > 0 ? '#16a34a' : growth < 0 ? '#dc2626' : '#888'}}>{same > 0 ? growth.toFixed(1) + '%' : '-'}</td>;
                      })}
                      <td className={td} style={{fontWeight:'bold', color: growthPct(currentTotalLastMonth, sameTotalLastMonth) > 0 ? '#16a34a' : growthPct(currentTotalLastMonth, sameTotalLastMonth) < 0 ? '#dc2626' : '#888'}}>
                        {sameTotalLastMonth > 0 ? growthPct(currentTotalLastMonth, sameTotalLastMonth).toFixed(1) + '%' : '-'}
                      </td>
                      <td className={td} style={{fontWeight:'bold', color: growthPct(currentTotalAll, sameTotalAll) > 0 ? '#16a34a' : growthPct(currentTotalAll, sameTotalAll) < 0 ? '#dc2626' : '#888'}}>
                        {sameTotalAll > 0 ? growthPct(currentTotalAll, sameTotalAll).toFixed(1) + '%' : '-'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* ===== 第三区：本期达成详情 ===== */}
            <div className="bg-white border border-gray-400 rounded overflow-hidden">
              <div className="px-4 py-2 bg-purple-50 border-b border-gray-400">
                <h3 className="font-bold text-purple-700">第三区 · 本期达成详情</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="border-collapse text-xs w-full" style={{ minWidth: 1100 }}>
                  <thead>
                    <tr>
                      <th className={th}>月份</th>
                      {MONTHS.map(m => <th key={m} className={th}>{m}</th>)}
                      <th className={th}>总合计</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className={tdLabel}>目标</td>
                      {data.monthly.targets.map((v, i) => <td key={i} className={td}>{fmt(v)}</td>)}
                      <td className={td} style={{fontWeight:'bold',color:'#2563eb'}}>{fmt(targetTotalAll)}</td>
                    </tr>
                    <tr>
                      <td className={tdLabel}>本期业绩</td>
                      {data.monthly.currentPeriod.map((v, i) => <td key={i} className={td} style={v > 0 ? {fontWeight:'bold'} : {color:'#ccc'}}>{v > 0 ? fmt(v) : ''}</td>)}
                      <td className={td} style={{fontWeight:'bold',color:'#2563eb'}}>{fmt(currentTotalAll)}</td>
                    </tr>
                    <tr>
                      <td className={tdLabel}>达成率</td>
                      {data.monthly.targets.map((tgt, i) => {
                        const cur = data.monthly.currentPeriod[i] || 0;
                        const rate = tgt > 0 ? (cur / tgt) * 100 : 0;
                        return <td key={i} className={td} style={{color: tgt > 0 ? (rate >= 100 ? '#16a34a' : '#dc2626') : '#888'}}>{tgt > 0 ? rate.toFixed(1) + '%' : '-'}</td>;
                      })}
                      <td className={td} style={{fontWeight:'bold',color: targetTotalAll > 0 && currentTotalAll >= targetTotalAll ? '#16a34a' : '#dc2626'}}>
                        {targetTotalAll > 0 ? ((currentTotalAll / targetTotalAll) * 100).toFixed(1) + '%' : '-'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* ===== 第四区：经营状况详情 ===== */}
            <div className="bg-white border border-gray-400 rounded overflow-hidden">
              <div className="px-4 py-2 bg-amber-50 border-b border-gray-400">
                <h3 className="font-bold text-amber-700">第四区 · 经营状况详情</h3>
              </div>
              <table className="border-collapse text-xs w-full">
                <tbody>
                  <tr>
                    <td className={tdLabel}>开业时间</td><td className={td}>{data.shop.openDate || '-'}</td>
                    <td className={tdLabel}>货柜数</td><td className={td}>{data.shop.cabinetCount || '-'}</td>
                    <td className={tdLabel}>年租金</td><td className={td}>无数据</td>
                    <td className={tdLabel}>1-本月亏损</td><td className={td}>无数据</td>
                  </tr>
                  <tr>
                    <td className={tdLabel}>特殊说明</td><td className={td}>无数据</td>
                    <td className={tdLabel}>合作方式</td><td className={td}>无数据</td>
                    <td className={tdLabel}>补贴机制</td><td className={td}>无数据</td>
                    <td className={tdLabel}>其他费用</td><td className={td}>无数据</td>
                  </tr>
                  <tr>
                    <td className={tdLabel}>押金</td><td className={td}>无数据</td>
                    <td className={tdLabel}>合同时间</td><td className={td}>无数据</td>
                    <td className={tdLabel}>租金说明</td><td className={td}>无数据</td>
                    <td className={tdLabel}>上次交租日</td><td className={td}>无数据</td>
                  </tr>
                  <tr>
                    <td className={tdLabel}>上次交租额</td><td className={td}>无数据</td>
                    <td className={tdLabel}>装修费</td><td className={td}>无数据</td>
                    <td className={tdLabel}>转让费</td><td className={td}>无数据</td>
                    <td className={tdLabel}>面积</td><td className={td}>无数据</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

export default AnnualOperationDashboard;
