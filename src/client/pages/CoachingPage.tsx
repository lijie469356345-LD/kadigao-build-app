import { useState, useEffect, useMemo } from 'react';
import Layout from '../components/Layout';
import { getCoachingStores, CoachingStore } from '../../api/coachingStores';
import { getSalesReport } from '../../api/reports';
import type { SalesReport } from '../../types';
import { useAuthStore } from '../../store/authStore';
import { FileSpreadsheet, Filter } from 'lucide-react';
import * as XLSX from 'xlsx';
import { AREA_PATTERN } from '../../types/permissionConstants';

function CoachingPage() {
  const { user } = useAuthStore();
  const now = new Date();
  const [monthYear, setMonthYear] = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);
  const [startDate, setStartDate] = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`);
  const [endDate, setEndDate] = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${new Date(now.getFullYear(), now.getMonth()+1, 0).getDate()}`);
  const [coachingShops, setCoachingShops] = useState<CoachingStore[]>([]);
  const [salesData, setSalesData] = useState<SalesReport[]>([]);
  const [loading, setLoading] = useState(false);

  // 筛选状态
  const [scopeFilter, setScopeFilter] = useState<'all'|'area'|'shop'>('all');
  const [selectedDealer, setSelectedDealer] = useState('');
  const [selectedWarehouse, setSelectedWarehouse] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const stores = await getCoachingStores(monthYear, user?.groupName);
      setCoachingShops(stores);
      if (startDate && endDate) {
        const result = await getSalesReport('custom', 'all', user?.groupName || undefined, { startDate, endDate });
        const allData = result.data || [];
        const coachingShopNames = new Set(stores.map(s => s.shopName));
        setSalesData(allData.filter(r => coachingShopNames.has(r.shopName)));
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [monthYear, startDate, endDate]);

  // 获取用户的本区和本店信息
  const userAreaInfo = useMemo(() => {
    const userName = user?.userName || '';
    const groupName = user?.groupName || '';
    // 尝试从组名提取督导名
    let supervisorName = userName;
    const svMatch = groupName.match(/督导(.+)/);
    if (svMatch) supervisorName = svMatch[1].replace(/加盟|直营|组[_\s]*/g, '').trim();

    // 从 coachingShops 中找该用户关联的店铺
    const myShops = coachingShops.filter(s => {
      const sv = (s.supervisor || '').trim();
      return sv && (sv.includes(supervisorName) || supervisorName.includes(sv) || sv === userName);
    });
    const myAreas = [...new Set(myShops.map(s => s.area).filter(Boolean))] as string[];
    const myShopNames = myShops.map(s => s.shopName);

    // 如果是经理，从组名提取区域
    let managerArea = '';
    const mgrMatch = groupName.match(/经理(.+)/);
    if (mgrMatch) {
      const areaMatch = mgrMatch[1].match(new RegExp(AREA_PATTERN));
      if (areaMatch) managerArea = areaMatch[0];
    }

    return {
      areas: managerArea ? [managerArea] : myAreas,
      shopNames: myShopNames,
    };
  }, [coachingShops, user]);

  // 提取筛选选项
  const filterOptions = useMemo(() => {
    const dealers = [...new Set(coachingShops.map(s => s.districtManager).filter(Boolean))] as string[];
    const warehouses = [...new Set(coachingShops.map(s => s.warehouseType).filter(Boolean))] as string[];
    return { dealers: dealers.sort(), warehouses: warehouses.sort() };
  }, [coachingShops]);

  // 应用筛选
  const filteredSalesData = useMemo(() => {
    let data = salesData;

    // 全部/本区/本店
    if (scopeFilter === 'area') {
      const areas = userAreaInfo.areas;
      if (areas.length > 0) {
        data = data.filter(r => areas.includes(r.area || ''));
      }
    } else if (scopeFilter === 'shop') {
      const shops = userAreaInfo.shopNames;
      if (shops.length > 0) {
        data = data.filter(r => shops.includes(r.shopName));
      }
    }

    // 区经筛选
    if (selectedDealer) {
      data = data.filter(r => r.districtManager === selectedDealer);
    }

    // 仓库筛选
    if (selectedWarehouse) {
      data = data.filter(r => (r as any).warehouseType === selectedWarehouse);
    }

    return data;
  }, [salesData, scopeFilter, selectedDealer, selectedWarehouse, userAreaInfo]);

  const fmt = (v: number) => v?.toLocaleString?.('zh-CN', { useGrouping: false }) || '0';
  const pct = (a: number, b: number) => b > 0 ? ((a / b) * 100).toFixed(1) + '%' : '-';

  const exportExcel = () => {
    const rows: any[][] = [['区经','督导','店铺名称','业绩目标','业绩金额','达成率','销售数量','开单数','客单价','件单价','连带率','礼包数','新增会员','主推数量','老会员贡献','生日会员']];
    filteredSalesData.forEach(r => {
      rows.push([r.districtManager||'', r.supervisor||'', r.shopName, fmt(r.target), fmt(Math.round(r.amount)), pct(r.amount, r.target),
        r.quantity, r.orderCount||0, (r.avgOrderValue||0).toFixed(0), (r.avgItemPrice||0).toFixed(1), (r.attachmentRate||0).toFixed(2),
        r.giftPackageCount||0, r.newMemberCount||0, r.mainProductCount||0,
        r.oldMemberAmount?Math.round(r.oldMemberAmount):0, r.birthMemberAmount?Math.round(r.birthMemberAmount):0]);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '陪跑跟进');
    XLSX.writeFile(wb, `陪跑跟进_${monthYear}_${startDate}-${endDate}.xlsx`);
  };

  const th = 'border border-gray-400 px-2 py-1.5 text-xs font-bold text-gray-700 text-center bg-gray-100';
  const td = 'border border-gray-400 px-2 py-1.5 text-xs text-center';

  const scopeBtn = (val: typeof scopeFilter, label: string) => (
    <button
      onClick={() => setScopeFilter(val)}
      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
        scopeFilter === val ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );

  const userAreaLabel = userAreaInfo.areas.length > 0 ? `本区(${userAreaInfo.areas.join(',')})` : '本区';
  const userShopLabel = userAreaInfo.shopNames.length > 0 ? `本店(${userAreaInfo.shopNames.length}家)` : '本店';

  return (
    <Layout title="陪跑跟进" subtitle={`${monthYear} 陪跑店铺数据`}>
      <div className="p-4">
        {/* 第一行：月份 + 日期 */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <input type="month" value={monthYear} onChange={e => setMonthYear(e.target.value)} className="px-2 py-1 border rounded text-sm w-36" />
          <span className="text-xs text-gray-400">日期</span>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="px-2 py-1 border rounded text-sm" />
          <span className="text-xs text-gray-400">至</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="px-2 py-1 border rounded text-sm" />
          <button onClick={loadData} disabled={loading} className="px-3 py-1 bg-gray-100 rounded text-sm">刷新</button>
          <button onClick={exportExcel} className="px-3 py-1 bg-green-600 text-white rounded text-sm"><FileSpreadsheet size={14} className="inline" /> 导出Excel</button>
          <span className="text-xs text-gray-400">{coachingShops.length} 家陪跑店铺</span>
        </div>

        {/* 第二行：筛选器 */}
        <div className="flex items-center gap-3 mb-4 flex-wrap bg-blue-50 border border-blue-200 rounded px-3 py-2">
          <Filter size={16} className="text-blue-600" />
          <span className="text-xs text-gray-600 font-bold">范围:</span>
          {scopeBtn('all', '全部')}
          {scopeBtn('area', userAreaLabel)}
          {scopeBtn('shop', userShopLabel)}
          <span className="text-gray-300 mx-1">|</span>
          <span className="text-xs text-gray-600 font-bold">区经:</span>
          <select
            value={selectedDealer}
            onChange={e => setSelectedDealer(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded text-sm"
          >
            <option value="">全部区经</option>
            {filterOptions.dealers.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <span className="text-xs text-gray-600 font-bold">仓库:</span>
          <select
            value={selectedWarehouse}
            onChange={e => setSelectedWarehouse(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded text-sm"
          >
            <option value="">全部仓库</option>
            {filterOptions.warehouses.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
          <span className="text-xs text-gray-400 ml-auto">
            {scopeFilter !== 'all' || selectedDealer || selectedWarehouse
              ? `已筛选 ${filteredSalesData.length} 条`
              : `共 ${salesData.length} 条`}
          </span>
        </div>

        {loading ? <p className="text-gray-400 py-8 text-center">加载中...</p> : coachingShops.length === 0 ? (
          <p className="text-gray-400 py-8 text-center">{monthYear} 本月无陪跑店铺</p>
        ) : filteredSalesData.length === 0 ? (
          <p className="text-gray-400 py-8 text-center">{salesData.length > 0 ? '筛选条件下无数据' : '暂无销售数据'}</p>
        ) : (
          <div className="bg-white border border-gray-400 rounded overflow-x-auto">
            <table className="border-collapse text-xs w-full" style={{ minWidth: 1400 }}>
              <thead>
                <tr className="bg-gray-100">
                  <th className={th}>区经</th><th className={th}>督导</th><th className={th}>店铺名称</th>
                  <th className={th}>业绩目标</th><th className={th}>业绩金额</th><th className={th}>达成率</th>
                  <th className={th}>销售数量</th><th className={th}>开单数</th>
                  <th className={th}>客单价</th><th className={th}>件单价</th><th className={th}>连带率</th>
                  <th className={th}>礼包数</th><th className={th}>新增会员</th><th className={th}>主推数量</th>
                  <th className={th}>老会员贡献</th><th className={th}>生日会员</th>
                </tr>
              </thead>
              <tbody>
                {filteredSalesData.map((r, i) => (
                  <tr key={r.shopName} className={i%2===0?'bg-white':'bg-gray-50'}>
                    <td className={td}>{r.districtManager || '-'}</td>
                    <td className={td}>{r.supervisor || '-'}</td>
                    <td className={td}>{r.shopName}</td>
                    <td className={td}>{fmt(r.target)}</td>
                    <td className={td}>{fmt(Math.round(r.amount))}</td>
                    <td className={td} style={{color: r.target>0&&r.amount>=r.target?'#16a34a':'#dc2626',fontWeight:'bold'}}>{pct(r.amount, r.target)}</td>
                    <td className={td}>{r.quantity}</td>
                    <td className={td}>{r.orderCount||0}</td>
                    <td className={td}>¥{(r.avgOrderValue||0).toFixed(0)}</td>
                    <td className={td}>¥{(r.avgItemPrice||0).toFixed(1)}</td>
                    <td className={td}>{(r.attachmentRate||0).toFixed(2)}</td>
                    <td className={td}>{r.giftPackageCount||0}</td>
                    <td className={td}>{r.newMemberCount||0}</td>
                    <td className={td}>{r.mainProductCount||0}</td>
                    <td className={td}>{r.oldMemberAmount ? fmt(Math.round(r.oldMemberAmount)) : '-'}</td>
                    <td className={td}>{r.birthMemberAmount ? fmt(Math.round(r.birthMemberAmount)) : '-'}</td>
                  </tr>
                ))}
                {filteredSalesData.length > 0 && (() => {
                  const t = filteredSalesData.reduce((a, r) => ({
                    target: a.target + (r.target||0), amount: a.amount + (r.amount||0),
                    quantity: a.quantity + (r.quantity||0), orderCount: a.orderCount + (r.orderCount||0),
                    giftCount: a.giftCount + (r.giftPackageCount||0), newMember: a.newMember + (r.newMemberCount||0),
                    mainProduct: a.mainProduct + (r.mainProductCount||0),
                    oldMember: a.oldMember + (r.oldMemberAmount||0), birthMember: a.birthMember + (r.birthMemberAmount||0),
                  }), { target:0, amount:0, quantity:0, orderCount:0, giftCount:0, newMember:0, mainProduct:0, oldMember:0, birthMember:0 });
                  const tRate = t.target > 0 ? ((t.amount / t.target) * 100).toFixed(1) + '%' : '-';
                  return (
                    <tr className="bg-yellow-100 font-bold">
                      <td className={td} colSpan={2}></td>
                      <td className={td} style={{fontSize:'14px'}}>合计 ({filteredSalesData.length}家)</td>
                      <td className={td}>{fmt(Math.round(t.target))}</td>
                      <td className={td}>{fmt(Math.round(t.amount))}</td>
                      <td className={td} style={{color:t.target>0&&t.amount>=t.target?'#16a34a':'#dc2626',fontWeight:'bold'}}>{tRate}</td>
                      <td className={td}>{t.quantity}</td>
                      <td className={td}>{t.orderCount}</td>
                      <td className={td}>¥{(t.orderCount>0?(t.amount/t.orderCount):0).toFixed(0)}</td>
                      <td className={td}>¥{(t.quantity>0?(t.amount/t.quantity):0).toFixed(1)}</td>
                      <td className={td}>{(t.quantity>0?(t.quantity/t.orderCount):0).toFixed(2)}</td>
                      <td className={td}>{t.giftCount}</td>
                      <td className={td}>{t.newMember}</td>
                      <td className={td}>{t.mainProduct}</td>
                      <td className={td}>{fmt(Math.round(t.oldMember))}</td>
                      <td className={td}>{fmt(Math.round(t.birthMember))}</td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default CoachingPage;
