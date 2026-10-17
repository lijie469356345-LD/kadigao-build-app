import { useState, useMemo } from 'react';
import { Calendar, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, RefreshCw } from 'lucide-react';
import { getCompareReport } from '../../api/reports';
import type { CompareReport } from '../../types';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';

function ComparisonPage() {
  const { user } = useAuthStore();
  
  const [reports, setReports] = useState<CompareReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [compareType, setCompareType] = useState('custom');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasData, setHasData] = useState(false);
  const pageSize = 20;

  // 三级联动多选筛选
  const areaSupervisorShopFilter = useAreaSupervisorShopFilter<CompareReport>(reports, {
    getArea: (r) => r.area,
    getSupervisor: (r) => r.supervisor,
    getShopName: (r) => r.shopName,
    getWarehouseType: (r: any) => (r as any).warehouseType,
    onChange: () => setCurrentPage(1),
  });
  
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const [currentDate, setCurrentDate] = useState(today.toISOString().split('T')[0]);
  const [compareDate, setCompareDate] = useState(yesterday.toISOString().split('T')[0]);

  const loadReports = async () => {
    try {
      setLoading(true);
      const data = await getCompareReport(compareType, currentDate, compareDate, user?.groupName || undefined);
      setReports(data);
      setHasData(true);
    } catch (error) {
      console.error('Failed to load comparison reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCompareTypeChange = (newCompareType: string) => {
    setCompareType(newCompareType);
    if (newCompareType !== 'custom') {
      loadReports();
    }
  };

  const handleDateChange = () => {
    if (compareType === 'custom') {
      loadReports();
    }
  };

  const formatCurrency = (value: number): string => {
    return `${value.toLocaleString('zh-CN', { useGrouping: false })}元`;
  };

  const calculateGrowth = (current: number, last: number): { rate: string; isUp: boolean } => {
    const rate = last > 0 ? ((current - last) / last * 100).toFixed(1) : '0';
    return { rate, isUp: parseFloat(rate) >= 0 };
  };

  const filteredReports = useMemo(() => {
    let result = [...areaSupervisorShopFilter.filteredData];
    // 按今日业绩从高到低排序
    result.sort((a, b) => (b.today?.amount || 0) - (a.today?.amount || 0));
    return result;
  }, [areaSupervisorShopFilter.filteredData]);

  const totalPages = Math.ceil(filteredReports.length / pageSize);
  const paginatedReports = filteredReports.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <Layout title="对比报表" subtitle="本期与上期数据对比分析">
      <div className="w-full">
        <div className="flex justify-end mb-6 px-6">
          <button
            onClick={loadReports}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            <span>刷新数据</span>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !hasData ? (
          <div className="flex flex-col items-center justify-center min-h-[400px]">
            <p className="text-xl text-gray-500 mb-4">请刷新数据</p>
          </div>
        ) : (
          <div className="w-full">
            <div className="flex items-center justify-between mb-6 px-6">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-1">
                  <Calendar className="w-5 h-5 text-gray-400 mr-2" />
                  <select
                    value={compareType}
                    onChange={(e) => handleCompareTypeChange(e.target.value)}
                    className="px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
                  >
                    <option value="custom">自定义对比</option>
                    <option value="todayYesterday">今日对比昨日</option>
                    <option value="weekLastWeek">本周对比上周</option>
                    <option value="monthLastMonth">本月对比上月</option>
                  </select>
                </div>
                
                {compareType === 'custom' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={currentDate}
                      onChange={(e) => {
                        setCurrentDate(e.target.value);
                        handleDateChange();
                      }}
                      className="px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
                    />
                    <span className="text-gray-400">vs</span>
                    <input
                      type="date"
                      value={compareDate}
                      onChange={(e) => {
                        setCompareDate(e.target.value);
                        handleDateChange();
                      }}
                      className="px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
                    />
                  </div>
                )}

                <AreaSupervisorShopFilter filter={areaSupervisorShopFilter} />
              </div>
            </div>

            {/* 固定表头区域 */}
            {totalPages > 1 && (
              <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">
                    显示 {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, filteredReports.length)} 条，共 {filteredReports.length} 条
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage === 1}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      上一页
                    </button>
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      const page = i + Math.max(1, currentPage - 2);
                      if (page > totalPages) return null;
                      return (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`px-4 py-2 text-sm font-medium rounded-lg ${page === currentPage ? 'bg-primary text-white' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'}`}
                        >
                          {page}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                      disabled={currentPage === totalPages}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4 px-6">
              {reports.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-400">暂无数据，请点击"刷新数据"按钮加载数据</p>
                </div>
              ) : (
                paginatedReports.map((report, index) => {
                  const todayData = report.today;
                  const yesterdayData = report.yesterday;
                  const lastWeekData = report.lastWeek;
                  
                  const salesGrowth = calculateGrowth(todayData?.amount || 0, yesterdayData?.amount || 0);
                  const salesGrowthWeek = calculateGrowth(todayData?.amount || 0, lastWeekData?.amount || 0);
                  const quantityGrowth = calculateGrowth(todayData?.quantity || 0, yesterdayData?.quantity || 0);
                  const quantityGrowthWeek = calculateGrowth(todayData?.quantity || 0, lastWeekData?.quantity || 0);
                  const orderGrowth = calculateGrowth(todayData?.orderCount || 0, yesterdayData?.orderCount || 0);
                  const orderGrowthWeek = calculateGrowth(todayData?.orderCount || 0, lastWeekData?.orderCount || 0);
                  const avgItemPriceGrowth = calculateGrowth(
                    todayData?.quantity ? todayData.amount / todayData.quantity : 0,
                    yesterdayData?.quantity ? yesterdayData.amount / yesterdayData.quantity : 0
                  );
                  const avgItemPriceGrowthWeek = calculateGrowth(
                    todayData?.quantity ? todayData.amount / todayData.quantity : 0,
                    lastWeekData?.quantity ? lastWeekData.amount / lastWeekData.quantity : 0
                  );
                  const avgOrderPriceGrowth = calculateGrowth(
                    todayData?.orderCount ? todayData.amount / todayData.orderCount : 0,
                    yesterdayData?.orderCount ? yesterdayData.amount / yesterdayData.orderCount : 0
                  );
                  const avgOrderPriceGrowthWeek = calculateGrowth(
                    todayData?.orderCount ? todayData.amount / todayData.orderCount : 0,
                    lastWeekData?.orderCount ? lastWeekData.amount / lastWeekData.orderCount : 0
                  );
                  const linkageGrowth = calculateGrowth(todayData?.attachmentRate || 0, yesterdayData?.attachmentRate || 0);
                  const linkageGrowthWeek = calculateGrowth(todayData?.attachmentRate || 0, lastWeekData?.attachmentRate || 0);
                  const giftPackGrowth = calculateGrowth(todayData?.giftPackageCount || 0, yesterdayData?.giftPackageCount || 0);
                  const giftPackGrowthWeek = calculateGrowth(todayData?.giftPackageCount || 0, lastWeekData?.giftPackageCount || 0);
                  const giftPackAmountGrowth = calculateGrowth(todayData?.giftPackageAmount || 0, yesterdayData?.giftPackageAmount || 0);
                  const giftPackAmountGrowthWeek = calculateGrowth(todayData?.giftPackageAmount || 0, lastWeekData?.giftPackageAmount || 0);
                  
                  const getGrowthClass = (isUp: boolean) => isUp ? 'text-green-600' : 'text-red-600';
                  
                  return (
                    <div key={index} className="bg-white rounded-xl shadow-sm p-6">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <span className="w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center text-sm font-bold">1</span>
                          <div>
                            <h3 className="text-lg font-semibold text-gray-800">{report.shopName}</h3>
                            <p className="text-sm text-gray-500">区经: {report.districtManager} | 督导: {report.supervisor}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button className="flex items-center gap-1 px-4 py-2 text-base bg-blue-50 text-blue-600 rounded-lg">
                            <div className="w-4 h-4 rounded-full bg-blue-600"></div>
                            <span>今日({report.todayDayOfWeek})</span>
                          </button>
                          <button className="flex items-center gap-1 px-4 py-2 text-base bg-gray-100 text-gray-600 rounded-lg">
                            <div className="w-4 h-4 rounded-full bg-gray-400"></div>
                            <span>上周{report.lastWeekDayOfWeek}</span>
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-4">
                        <div className="bg-gray-50 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm text-gray-600">业绩金额</p>
                            {salesGrowth.isUp ? (
                              <ArrowUpRight className="w-4 h-4 text-green-500" />
                            ) : (
                              <ArrowDownRight className="w-4 h-4 text-red-500" />
                            )}
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold text-gray-800">
                              {(todayData?.amount || 0).toLocaleString('zh-CN', { useGrouping: false })}元
                            </p>
                          </div>
                          <div className="flex justify-between mt-2 text-xs">
                            <span className="text-teal-600">昨日: {(yesterdayData?.amount || 0).toLocaleString('zh-CN', { useGrouping: false })}元</span>
                            <span className={`${getGrowthClass(salesGrowth.isUp)}`}>
                              {salesGrowth.isUp ? '↑' : '↓'}{salesGrowth.rate}%
                            </span>
                          </div>
                          <div className="flex justify-between mt-1 text-xs">
                            <span className="text-blue-600">上周: {(lastWeekData?.amount || 0).toLocaleString('zh-CN', { useGrouping: false })}元</span>
                            <span className={`${getGrowthClass(salesGrowthWeek.isUp)}`}>
                              {salesGrowthWeek.isUp ? '↑' : '↓'}{salesGrowthWeek.rate}%
                            </span>
                          </div>
                        </div>

                        <div className="bg-gray-50 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm text-gray-600">销售数量</p>
                            {quantityGrowth.isUp ? (
                              <ArrowUpRight className="w-4 h-4 text-green-500" />
                            ) : (
                              <ArrowDownRight className="w-4 h-4 text-red-500" />
                            )}
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold text-gray-800">{todayData?.quantity || 0}件</p>
                          </div>
                          <div className="flex justify-between mt-2 text-xs">
                            <span className="text-teal-600">昨日: {yesterdayData?.quantity || 0}件</span>
                            <span className={`${getGrowthClass(quantityGrowth.isUp)}`}>
                              {quantityGrowth.isUp ? '↑' : '↓'}{quantityGrowth.rate}%
                            </span>
                          </div>
                          <div className="flex justify-between mt-1 text-xs">
                            <span className="text-blue-600">上周: {lastWeekData?.quantity || 0}件</span>
                            <span className={`${getGrowthClass(quantityGrowthWeek.isUp)}`}>
                              {quantityGrowthWeek.isUp ? '↑' : '↓'}{quantityGrowthWeek.rate}%
                            </span>
                          </div>
                        </div>

                        <div className="bg-gray-50 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm text-gray-600">开单数</p>
                            {orderGrowth.isUp ? (
                              <ArrowUpRight className="w-4 h-4 text-green-500" />
                            ) : (
                              <ArrowDownRight className="w-4 h-4 text-red-500" />
                            )}
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold text-gray-800">{todayData?.orderCount || 0}</p>
                          </div>
                          <div className="flex justify-between mt-2 text-xs">
                            <span className="text-teal-600">昨日: {yesterdayData?.orderCount || 0}</span>
                            <span className={`${getGrowthClass(orderGrowth.isUp)}`}>
                              {orderGrowth.isUp ? '↑' : '↓'}{orderGrowth.rate}%
                            </span>
                          </div>
                          <div className="flex justify-between mt-1 text-xs">
                            <span className="text-blue-600">上周: {lastWeekData?.orderCount || 0}</span>
                            <span className={`${getGrowthClass(orderGrowthWeek.isUp)}`}>
                              {orderGrowthWeek.isUp ? '↑' : '↓'}{orderGrowthWeek.rate}%
                            </span>
                          </div>
                        </div>

                        <div className="bg-gray-50 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm text-gray-600">件单价</p>
                            {avgItemPriceGrowth.isUp ? (
                              <ArrowUpRight className="w-4 h-4 text-green-500" />
                            ) : (
                              <ArrowDownRight className="w-4 h-4 text-red-500" />
                            )}
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold text-gray-800">
                              ¥{(todayData?.quantity && todayData.amount ? (todayData.amount / todayData.quantity).toFixed(2) : '0')}
                            </p>
                          </div>
                          <div className="flex justify-between mt-2 text-xs">
                            <span className="text-teal-600">昨日: ¥{(yesterdayData?.quantity && yesterdayData.amount ? (yesterdayData.amount / yesterdayData.quantity).toFixed(2) : '0')}</span>
                            <span className={`${getGrowthClass(avgItemPriceGrowth.isUp)}`}>
                              {avgItemPriceGrowth.isUp ? '↑' : '↓'}{avgItemPriceGrowth.rate}%
                            </span>
                          </div>
                          <div className="flex justify-between mt-1 text-xs">
                            <span className="text-blue-600">上周: ¥{(lastWeekData?.quantity && lastWeekData.amount ? (lastWeekData.amount / lastWeekData.quantity).toFixed(2) : '0')}</span>
                            <span className={`${getGrowthClass(avgItemPriceGrowthWeek.isUp)}`}>
                              {avgItemPriceGrowthWeek.isUp ? '↑' : '↓'}{avgItemPriceGrowthWeek.rate}%
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-4 mt-4">
                        <div className="bg-gray-50 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm text-gray-600">客单价</p>
                            {avgOrderPriceGrowth.isUp ? (
                              <ArrowUpRight className="w-4 h-4 text-green-500" />
                            ) : (
                              <ArrowDownRight className="w-4 h-4 text-red-500" />
                            )}
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold text-gray-800">
                              ¥{(todayData?.orderCount && todayData.amount ? (todayData.amount / todayData.orderCount).toFixed(2) : '0')}
                            </p>
                          </div>
                          <div className="flex justify-between mt-2 text-xs">
                            <span className="text-teal-600">昨日: ¥{(yesterdayData?.orderCount && yesterdayData.amount ? (yesterdayData.amount / yesterdayData.orderCount).toFixed(2) : '0')}</span>
                            <span className={`${getGrowthClass(avgOrderPriceGrowth.isUp)}`}>
                              {avgOrderPriceGrowth.isUp ? '↑' : '↓'}{avgOrderPriceGrowth.rate}%
                            </span>
                          </div>
                          <div className="flex justify-between mt-1 text-xs">
                            <span className="text-blue-600">上周: ¥{(lastWeekData?.orderCount && lastWeekData.amount ? (lastWeekData.amount / lastWeekData.orderCount).toFixed(2) : '0')}</span>
                            <span className={`${getGrowthClass(avgOrderPriceGrowthWeek.isUp)}`}>
                              {avgOrderPriceGrowthWeek.isUp ? '↑' : '↓'}{avgOrderPriceGrowthWeek.rate}%
                            </span>
                          </div>
                        </div>

                        <div className="bg-gray-50 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm text-gray-600">连带率</p>
                            {linkageGrowth.isUp ? (
                              <ArrowUpRight className="w-4 h-4 text-green-500" />
                            ) : (
                              <ArrowDownRight className="w-4 h-4 text-red-500" />
                            )}
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold text-gray-800">{(todayData?.attachmentRate || 0).toFixed(2)}</p>
                          </div>
                          <div className="flex justify-between mt-2 text-xs">
                            <span className="text-teal-600">昨日: {(yesterdayData?.attachmentRate || 0).toFixed(2)}</span>
                            <span className={`${getGrowthClass(linkageGrowth.isUp)}`}>
                              {linkageGrowth.isUp ? '↑' : '↓'}{linkageGrowth.rate}%
                            </span>
                          </div>
                          <div className="flex justify-between mt-1 text-xs">
                            <span className="text-blue-600">上周: {(lastWeekData?.attachmentRate || 0).toFixed(2)}</span>
                            <span className={`${getGrowthClass(linkageGrowthWeek.isUp)}`}>
                              {linkageGrowthWeek.isUp ? '↑' : '↓'}{linkageGrowthWeek.rate}%
                            </span>
                          </div>
                        </div>

                        <div className="bg-gray-50 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm text-gray-600">礼包数</p>
                            {giftPackGrowth.isUp ? (
                              <ArrowUpRight className="w-4 h-4 text-green-500" />
                            ) : (
                              <ArrowDownRight className="w-4 h-4 text-red-500" />
                            )}
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold text-gray-800">{todayData?.giftPackageCount || 0}个</p>
                          </div>
                          <div className="flex justify-between mt-2 text-xs">
                            <span className="text-teal-600">昨日: {yesterdayData?.giftPackageCount || 0}个</span>
                            <span className={`${getGrowthClass(giftPackGrowth.isUp)}`}>
                              {giftPackGrowth.isUp ? '↑' : '↓'}{giftPackGrowth.rate}%
                            </span>
                          </div>
                          <div className="flex justify-between mt-1 text-xs">
                            <span className="text-blue-600">上周: {lastWeekData?.giftPackageCount || 0}个</span>
                            <span className={`${getGrowthClass(giftPackGrowthWeek.isUp)}`}>
                              {giftPackGrowthWeek.isUp ? '↑' : '↓'}{giftPackGrowthWeek.rate}%
                            </span>
                          </div>
                        </div>

                        <div className="bg-gray-50 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm text-gray-600">礼包额</p>
                            {giftPackAmountGrowth.isUp ? (
                              <ArrowUpRight className="w-4 h-4 text-green-500" />
                            ) : (
                              <ArrowDownRight className="w-4 h-4 text-red-500" />
                            )}
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold text-gray-800">
                              {(todayData?.giftPackageAmount || 0).toLocaleString('zh-CN', { useGrouping: false })}元
                            </p>
                          </div>
                          <div className="flex justify-between mt-2 text-xs">
                            <span className="text-teal-600">昨日: {(yesterdayData?.giftPackageAmount || 0).toLocaleString('zh-CN', { useGrouping: false })}元</span>
                            <span className={`${getGrowthClass(giftPackAmountGrowth.isUp)}`}>
                              {giftPackAmountGrowth.isUp ? '↑' : '↓'}{giftPackAmountGrowth.rate}%
                            </span>
                          </div>
                          <div className="flex justify-between mt-1 text-xs">
                            <span className="text-blue-600">上周: {(lastWeekData?.giftPackageAmount || 0).toLocaleString('zh-CN', { useGrouping: false })}元</span>
                            <span className={`${getGrowthClass(giftPackAmountGrowthWeek.isUp)}`}>
                              {giftPackAmountGrowthWeek.isUp ? '↑' : '↓'}{giftPackAmountGrowthWeek.rate}%
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default ComparisonPage;