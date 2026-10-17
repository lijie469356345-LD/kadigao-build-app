import { useState, useEffect, useMemo } from 'react';
import { Award, TrendingUp, TrendingDown, Trophy, AlertTriangle, RefreshCw, Filter, Calendar, ArrowUpRight, ArrowDownRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { get7DayComparison } from '../../api/reports';
import { getShops } from '../../api/shops';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { useDataCacheStore } from '../../store/dataCacheStore';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';
import type { Shop } from '../../types';

interface DayComparison {
  date: string;
  dayOfWeek: string;
  shopName: string;
  districtManager: string;
  supervisor: string;
  amount: number;
  quantity: number;
  orderCount: number;
  avgOrderValue: number;
  avgItemPrice: number;
  attachmentRate: number;
  giftPackageCount: number;
  giftPackageAmount: number;
  target: number;
  achievement: number;
  score: number;
  amountGrowth?: number;
  quantityGrowth?: number;
  scoreGrowth?: number;
  amountWeekGrowth?: number;
  quantityWeekGrowth?: number;
}

interface SupervisorScore {
  supervisor: string;
  avgScore: number;
  shopCount: number;
}

const ScorePage = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [day7Data, setDay7Data] = useState<DayComparison[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [dateRange, setDateRange] = useState('3day');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasData, setHasData] = useState(false);
  const pageSize = 10;
  const { user } = useAuthStore();
  const { scoreData, setScoreData } = useDataCacheStore();

  const filter = useAreaSupervisorShopFilter(day7Data, {
    getArea: (item: DayComparison) => item.districtManager || undefined,
    getSupervisor: (item: DayComparison) => item.supervisor,
    getShopName: (item: DayComparison) => [item.shopName],
    getWarehouseType: (item: any) => (item as any).warehouseType || ((item.shopName || '').endsWith('_JM') ? '加盟' : (item.shopName || '').endsWith('_ZY') ? '直营' : ''),
  });

  useEffect(() => {
    if (scoreData && scoreData.length > 0) {
      setDay7Data(scoreData);
      setHasData(true);
    }
  }, [scoreData]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [day7Response, shopsResponse] = await Promise.all([
        get7DayComparison(dateRange),
        getShops()
      ]);
      
      setDay7Data(day7Response);
      setShops(shopsResponse);
      setScoreData(day7Response);
      setHasData(true);
      setCurrentPage(1);
    } catch (err) {
      setError('加载数据失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasData && user) {
      loadData();
    }
  }, [user, hasData]);

    const filteredData = filter.filteredData;

  const groupedDay7Data = useMemo(() => {
    const groups: Record<string, DayComparison[]> = {};
    filteredData.forEach(item => {
      if (!groups[item.date]) {
        groups[item.date] = [];
      }
      groups[item.date].push(item);
    });
    return groups;
  }, [filteredData]);

  const shopScores = useMemo(() => {
    const scores: Record<string, { items: DayComparison[], count: number, totalScore: number }> = {};
    filteredData.forEach(item => {
      if (!scores[item.shopName]) {
        scores[item.shopName] = { items: [], count: 0, totalScore: 0 };
      }
      scores[item.shopName].items.push(item);
      scores[item.shopName].count++;
      scores[item.shopName].totalScore += item.score;
    });
    return scores;
  }, [filteredData]);

  const averageScore = useMemo(() => {
    const total = Object.values(shopScores).reduce((sum, data) => sum + data.totalScore, 0);
    const count = Object.values(shopScores).reduce((sum, data) => sum + data.count, 0);
    return count > 0 ? total / count : 0;
  }, [shopScores]);

  const topRanking = useMemo(() => {
    return Object.entries(shopScores)
      .map(([shopName, data]) => ({
        shopName,
        avgScore: data.count > 0 ? data.totalScore / data.count : 0,
        avgAmount: data.count > 0 ? data.items.reduce((sum, s) => sum + (s.amount || 0), 0) / data.count : 0
      }))
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, 10);
  }, [shopScores]);

  const bottomRanking = useMemo(() => {
    return Object.entries(shopScores)
      .map(([shopName, data]) => ({
        shopName,
        avgScore: data.count > 0 ? data.totalScore / data.count : 0
      }))
      .sort((a, b) => a.avgScore - b.avgScore)
      .slice(0, 10);
  }, [shopScores]);

  const supervisorScores = useMemo(() => {
    const scores: Record<string, { scores: number[], count: number, totalScore: number }> = {};
    filteredData.forEach(item => {
      const key = item.supervisor || '未知';
      if (!scores[key]) {
        scores[key] = { scores: [], count: 0, totalScore: 0 };
      }
      scores[key].scores.push(item.score);
      scores[key].count++;
      scores[key].totalScore += item.score;
    });
    return scores;
  }, [filteredData]);

  const topSupervisors = useMemo(() => {
    return Object.entries(supervisorScores)
      .map(([supervisor, data]) => {
        const shopCount = new Set(filteredData.filter(d => d.supervisor === supervisor).map(d => d.shopName)).size;
        return {
          supervisor,
          avgScore: data.count > 0 ? data.totalScore / data.count : 0,
          shopCount
        };
      })
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, 3);
  }, [supervisorScores, filteredData]);

  const bottomSupervisors = useMemo(() => {
    return Object.entries(supervisorScores)
      .map(([supervisor, data]) => {
        const shopCount = new Set(filteredData.filter(d => d.supervisor === supervisor).map(d => d.shopName)).size;
        return {
          supervisor,
          avgScore: data.count > 0 ? data.totalScore / data.count : 0,
          shopCount
        };
      })
      .sort((a, b) => a.avgScore - b.avgScore)
      .slice(0, 3);
  }, [supervisorScores, filteredData]);

  const sortedDetailData = useMemo(() => {
    return [...filteredData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [filteredData]);

  const totalPages = useMemo(() => {
    return Math.ceil(sortedDetailData.length / pageSize);
  }, [sortedDetailData, pageSize]);

  const paginatedDetailData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return sortedDetailData.slice(start, end);
  }, [sortedDetailData, currentPage, pageSize]);

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreBg = (score: number) => {
    if (score >= 80) return 'bg-green-50';
    if (score >= 60) return 'bg-yellow-50';
    return 'bg-red-50';
  };

  const getGrowthColor = (growth: number) => {
    return growth >= 0 ? 'text-green-600' : 'text-red-600';
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekDay = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
    return `${month}月${day}日(${weekDay})`;
  };

    return (
    <Layout title="评分体系" subtitle="查看店铺评分排名和得分详情">
      <div className="w-full">
        <div className="flex justify-end mb-6 px-6">
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            <span>刷新数据</span>
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-gray-500">正在加载数据，请稍候...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className="text-red-500 mb-4">⚠️</div>
            <p className="text-xl text-gray-600 mb-4">{error}</p>
            <button
              onClick={loadData}
              className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
            >
              重新加载
            </button>
          </div>
        ) : !hasData ? (
          <div className="flex flex-col items-center justify-center min-h-[400px]">
            <p className="text-xl text-gray-500">请点击"刷新数据"按钮加载数据</p>
          </div>
        ) : (
          <div className="w-full">
<div className="flex items-center justify-between mb-6 mx-6">
              <AreaSupervisorShopFilter filter={filter} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mx-6">
              <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                    <Award className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">平均得分</p>
                    <p className={`text-3xl font-bold ${getScoreColor(averageScore)}`}>{averageScore.toFixed(1)}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">优秀店铺</p>
                    <p className="text-3xl font-bold text-green-600">{topRanking.filter(s => s.avgScore >= 80).length}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                    <TrendingDown className="w-6 h-6 text-red-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">待提升店铺</p>
                    <p className="text-3xl font-bold text-red-600">{bottomRanking.filter(s => s.avgScore < 60).length}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6 mx-6 mt-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-blue-500" />
                  <h3 className="text-lg font-semibold text-gray-800">近3日轮转对比</h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">时间范围:</span>
                  <select
                    value={dateRange}
                    onChange={(e) => setDateRange(e.target.value)}
                    className="px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none text-sm"
                  >
                    <option value="3day">近3天</option>
                    <option value="7day">近7天</option>
                    <option value="30day">近30天</option>
                  </select>
                </div>
              </div>

              <div className="px-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {Object.entries(groupedDay7Data).map(([date, items]) => {
                    const totalAmount = items.reduce((sum, item) => sum + (item.amount || 0), 0);
                    const totalQuantity = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
                    const totalOrderCount = items.reduce((sum, item) => sum + (item.orderCount || 0), 0);
                    const avgAttachmentRate = items.length > 0 
                      ? items.reduce((sum, item) => sum + (item.attachmentRate || 0), 0) / items.length 
                      : 0;
                    const avgScore = items.length > 0 
                      ? items.reduce((sum, item) => sum + (item.score || 0), 0) / items.length 
                      : 0;
                    const firstItem = items[0];

                    return (
                      <div key={date} className="bg-gray-50 rounded-xl p-6">
                        <div className="flex items-center justify-between mb-6">
                          <div>
                            <p className="text-lg font-semibold text-gray-800">{formatDate(date)}</p>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-600">业绩金额</span>
                            <div className="flex items-center gap-2">
                              <span className="text-lg font-semibold text-gray-800">{totalAmount.toLocaleString('zh-CN', { useGrouping: false })}元</span>
                              {firstItem?.amountWeekGrowth !== undefined && (
                                <span className={`text-sm ${getGrowthColor(firstItem.amountWeekGrowth)} flex items-center gap-1`}>
                                  {firstItem.amountWeekGrowth >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                                  {Math.abs(firstItem.amountWeekGrowth).toFixed(1)}%
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-600">销售数量</span>
                            <div className="flex items-center gap-2">
                              <span className="text-lg font-semibold text-gray-800">{totalQuantity}件</span>
                              {firstItem?.quantityWeekGrowth !== undefined && (
                                <span className={`text-sm ${getGrowthColor(firstItem.quantityWeekGrowth)} flex items-center gap-1`}>
                                  {firstItem.quantityWeekGrowth >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                                  {Math.abs(firstItem.quantityWeekGrowth).toFixed(1)}%
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-600">开单数</span>
                            <span className="text-lg font-semibold text-gray-800">{totalOrderCount}</span>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-600">连带率</span>
                            <span className="text-lg font-semibold text-gray-800">{avgAttachmentRate.toFixed(2)}</span>
                          </div>

                          <div className="pt-4 border-t border-gray-200">
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-gray-600">综合得分</span>
                              <div className="flex items-center gap-2">
                                <span className={`text-2xl font-bold ${getScoreColor(avgScore)}`}>
                                  {Math.round(avgScore)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {Object.keys(groupedDay7Data).length === 0 && (
                    <div className="text-center py-12 col-span-3">
                      <p className="text-gray-400">暂无数据</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mx-6 mt-6">
              <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Trophy className="w-5 h-5 text-yellow-500" />
                  <h3 className="text-lg font-semibold text-gray-800">督导排名 TOP 3</h3>
                </div>
                <div className="space-y-3">
                  {topSupervisors.map((item, index) => (
                    <div key={item.supervisor} className={`flex items-center justify-between p-4 rounded-lg ${getScoreBg(item.avgScore)}`}>
                      <div className="flex items-center gap-4">
                        <span className={`text-2xl font-bold w-10 text-center`}>
                          {index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}
                        </span>
                        <div>
                          <span className="font-semibold text-gray-800">{item.supervisor}</span>
                          <p className="text-sm text-gray-500">管理店铺: {item.shopCount}家</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`text-2xl font-bold ${getScoreColor(item.avgScore)}`}>
                          {item.avgScore.toFixed(1)}
                        </span>
                      </div>
                    </div>
                  ))}
                  {topSupervisors.length === 0 && (
                    <p className="text-center text-gray-400 py-4">暂无数据</p>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangle className="w-5 h-5 text-orange-500" />
                  <h3 className="text-lg font-semibold text-gray-800">督导末尾排名 LAST 3</h3>
                </div>
                <div className="space-y-3">
                  {bottomSupervisors.map((item, index) => (
                    <div key={item.supervisor} className={`flex items-center justify-between p-4 rounded-lg ${getScoreBg(item.avgScore)}`}>
                      <div className="flex items-center gap-4">
                        <span className="text-2xl font-bold w-10 text-center text-gray-400">
                          {index === 0 ? '4' : index === 1 ? '5' : '6'}
                        </span>
                        <div>
                          <span className="font-semibold text-gray-800">{item.supervisor}</span>
                          <p className="text-sm text-gray-500">管理店铺: {item.shopCount}家</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`text-2xl font-bold ${getScoreColor(item.avgScore)}`}>
                          {item.avgScore.toFixed(1)}
                        </span>
                      </div>
                    </div>
                  ))}
                  {bottomSupervisors.length === 0 && (
                    <p className="text-center text-gray-400 py-4">暂无数据</p>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6 mx-6 mt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-800">近7日评分详情</h3>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-500">
                    共 {sortedDetailData.length} 条记录
                  </span>
                  <span className="text-sm text-gray-500">
                    每页 {pageSize} 条
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-white z-10">
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">日期</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">店铺</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">督导</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">业绩金额</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">销售数量</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">开单数</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">连带率</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">礼包数</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">综合得分</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedDetailData.map((item) => (
                        <tr key={`${item.date}-${item.shopName}`} className="border-b border-gray-50">
                          <td className="py-3 px-4 text-gray-700">{formatDate(item.date)}</td>
                          <td className="py-3 px-4 font-medium text-gray-800 truncate max-w-[200px]" title={item.shopName}>{item.shopName}</td>
                          <td className="py-3 px-4 text-gray-700">{item.supervisor}</td>
                          <td className="py-3 px-4 text-right">{(item.amount || 0).toLocaleString('zh-CN', { useGrouping: false })}元</td>
                          <td className="py-3 px-4 text-right">{item.quantity || 0}件</td>
                          <td className="py-3 px-4 text-right">{item.orderCount || 0}</td>
                          <td className="py-3 px-4 text-right">{(item.attachmentRate || 0).toFixed(2)}</td>
                          <td className="py-3 px-4 text-right">{item.giftPackageCount || 0}</td>
                          <td className={`py-3 px-4 text-right font-bold ${getScoreColor(item.score)}`}>
                            {item.score || 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {paginatedDetailData.length === 0 && (
                    <div className="text-center py-12">
                      <p className="text-gray-400">暂无评分数据</p>
                    </div>
                  )}
                </div>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <button
                    onClick={() => goToPage(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => goToPage(pageNum)}
                        className={`px-4 py-2 rounded-lg ${currentPage === pageNum ? 'bg-primary text-white' : 'border border-gray-200 hover:bg-gray-50'}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => goToPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6 mx-6 mt-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">评分规则说明</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-blue-50 rounded-lg">
                  <p className="font-medium text-gray-800 mb-2">计分规则</p>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• 增长率 ≥ 100%：10分</li>
                    <li>• 增长率 ≥ 75%：9分</li>
                    <li>• 增长率 ≥ 50%：8分</li>
                    <li>• 增长率 ≥ 25%：7分</li>
                    <li>• 增长率 ≥ 10%：6分</li>
                    <li>• 增长率 ≥ 0%：5分</li>
                    <li>• 增长率 ≥ -25%：4分</li>
                    <li>• 增长率 ≥ -50%：3分</li>
                    <li>• 增长率 ≥ -75%：2分</li>
                    <li>• 增长率 &lt; -75%：1分</li>
                  </ul>
                </div>
                <div className="p-4 bg-green-50 rounded-lg">
                  <p className="font-medium text-gray-800 mb-2">最终得分计算</p>
                  <p className="text-sm text-gray-600">
                    8项指标得分相加得到总分，最终得分 = 总分 / 0.8
                  </p>
                  <p className="text-sm text-gray-600 mt-2">
                    <strong>统计时间：</strong>每天晚上11:30自动计算当天评分
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default ScorePage;