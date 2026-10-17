import { useEffect, useState, useMemo, useCallback } from 'react';
import { ArrowLeft, Calendar, CheckCircle2, XCircle, Users, RefreshCw, Eye, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getDailyStatsDetail } from '../../api/logs';
import { getShops } from '../../api/shops';
import { useAuthStore } from '../../store/authStore';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';
import Layout from '../components/Layout';

interface StatsDetail {
  date: string;
  userName: string;
  groupName: string;
  submitted: boolean;
  logId: number | null;
  destination: string | null;
  submittedAt: string | null;
  cumulativeMissed: number;
}

interface StatsData {
  date: string;
  startDate: string;
  endDate: string;
  totalRequired: number;
  completed: number;
  incomplete: number;
  earliestDate: string | null;
  totalDays: number;
  details: StatsDetail[];
}

function LogStatisticsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuthStore();

  // 默认时间段：最近一周（今天往前推6天，共7天）
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().split('T')[0];
  })();

  // 如果 URL 带了 date 参数，以该日期为起始，往后推6天
  const urlDate = searchParams.get('date');
  const initialStart = urlDate || weekAgo;
  const initialEnd = urlDate
    ? (() => {
        const d = new Date(urlDate);
        d.setDate(d.getDate() + 6);
        const t = new Date();
        return d > t ? t.toISOString().split('T')[0] : d.toISOString().split('T')[0];
      })()
    : today;

  const [startDate, setStartDate] = useState(initialStart);
  const [endDate, setEndDate] = useState(initialEnd);
  const [statsData, setStatsData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [shops, setShops] = useState<any[]>([]);

  // 加载店铺数据（用于构建区域映射）
  useEffect(() => {
    const loadShops = async () => {
      try {
        const shopData = await getShops(user?.groupName);
        setShops(Array.isArray(shopData) ? shopData : []);
      } catch (error) {
        console.error('Failed to load shops:', error);
        setShops([]);
      }
    };
    if (user) loadShops();
  }, [user]);

  // 构建 shopName -> area 映射
  const shopAreaMap = useMemo(() => {
    const map = new Map<string, string>();
    shops.forEach((s: any) => {
      const name = s.shopName || s['店铺名称'] || '';
      const area = s.area || s['区域'] || '';
      if (name && area) map.set(name, area);
    });
    return map;
  }, [shops]);

  // 构建 supervisorName -> area 映射（用于未提交时也能获取区域）
  const supervisorAreaMap = useMemo(() => {
    const map = new Map<string, string>();
    shops.forEach((s: any) => {
      const supervisor = s.supervisor || s['督导'] || '';
      const area = s.area || s['区域'] || '';
      if (supervisor && area && !map.has(supervisor)) {
        map.set(supervisor, area);
      }
    });
    return map;
  }, [shops]);

  const loadData = useCallback(async (start: string, end: string) => {
    try {
      setLoading(true);
      const data = await getDailyStatsDetail(start, end, user?.groupName);
      setStatsData(data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(startDate, endDate);
  }, [startDate, endDate, loadData]);

  // 三级联动筛选器 —— 对 details 数据进行筛选
  const statsFilter = useAreaSupervisorShopFilter<StatsDetail>(
    statsData?.details || [],
    {
      getArea: (d) => {
        // 优先从填报店铺获取区域，其次从督导名获取
        if (d.destination && shopAreaMap.has(d.destination)) {
          return shopAreaMap.get(d.destination);
        }
        return supervisorAreaMap.get(d.userName);
      },
      getSupervisor: (d) => d.userName,
      getShopName: (d) => d.destination || '',
      getWarehouseType: (d: any) => (d.warehouseType) || ((d.destination || d.shopName || '').endsWith('_JM') ? '加盟' : (d.destination || d.shopName || '').endsWith('_ZY') ? '直营' : ''),
    }
  );

  const filteredDetails = statsFilter.filteredData;

  const handleBack = () => {
    navigate('/logs');
  };

  const handleViewLog = (logId: number) => {
    navigate(`/logs/${logId}`);
  };

  // 导出填报统计到 Excel
  const handleExport = () => {
    if (sortedDetails.length === 0) {
      alert('当前没有可导出的数据');
      return;
    }
    const aoa: any[][] = [
      ['序号', '日期', '姓名', '角色', '填报状态', '填报店铺', '提交时间', '累计未提交天数'],
    ];
    sortedDetails.forEach((d, i) => {
      aoa.push([
        i + 1,
        d.date,
        d.userName,
        d.groupName,
        d.submitted ? '已提交' : '未提交',
        d.destination || '-',
        d.submittedAt || '-',
        `${d.cumulativeMissed} 天`,
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // 列宽自适应
    ws['!cols'] = [
      { wch: 6 }, { wch: 12 }, { wch: 12 }, { wch: 16 },
      { wch: 10 }, { wch: 20 }, { wch: 22 }, { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '填报统计');
    XLSX.writeFile(wb, `日志填报统计_${startDate}_至_${endDate}.xlsx`);
  };

  // 从筛选后的数据重新计算汇总
  const filteredTotal = filteredDetails.length;
  const filteredCompleted = filteredDetails.filter(d => d.submitted).length;
  const filteredIncomplete = filteredTotal - filteredCompleted;
  const completionRate = filteredTotal > 0
    ? Math.round((filteredCompleted / filteredTotal) * 100)
    : 0;

  // 排序：日期倒序 → 未提交优先 → 累计未提交降序
  const sortedDetails = useMemo(() => {
    return [...filteredDetails].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (a.submitted !== b.submitted) return a.submitted ? 1 : -1;
      return b.cumulativeMissed - a.cumulativeMissed;
    });
  }, [filteredDetails]);

  // 计算天数
  const dayCount = (() => {
    const s = new Date(startDate);
    const e = new Date(endDate);
    return Math.floor((e.getTime() - s.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  })();

  return (
    <Layout title="日志填报统计" subtitle="每日填报完成率与明细">
      <div className="p-4">
        {/* 顶部：返回 + 时间段选择 + 筛选 */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft size={18} />
            <span>返回</span>
          </button>

          <div className="flex items-center gap-2 flex-wrap">
            <Calendar size={20} className="text-gray-400" />
            <input
              type="date"
              value={startDate}
              max={endDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 text-gray-700 text-sm"
            />
            <span className="text-gray-400 text-sm">至</span>
            <input
              type="date"
              value={endDate}
              min={startDate}
              max={today}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 text-gray-700 text-sm"
            />
            <span className="text-xs text-gray-400 ml-1">共 {dayCount} 天</span>
          </div>

          <button
            onClick={() => loadData(startDate, endDate)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            <span>刷新</span>
          </button>

          <button
            onClick={handleExport}
            disabled={loading || sortedDetails.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            <Download size={18} />
            <span>导出Excel</span>
          </button>
        </div>

        {/* 筛选器 */}
        <div className="mb-4">
          <AreaSupervisorShopFilter filter={statsFilter} />
        </div>

        {loading ? (
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !statsData ? (
          <div className="flex flex-col items-center justify-center min-h-[400px]">
            <p className="text-xl text-gray-500">暂无数据</p>
          </div>
        ) : (
          <>
            {/* 中部：汇总统计卡片 */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-2">
                  <Users size={20} className="text-indigo-400" />
                  <span className="text-xs text-gray-400">应填</span>
                </div>
                <p className="text-3xl font-bold text-gray-800">{filteredTotal}</p>
                <p className="text-sm text-gray-500 mt-1">应填总人次</p>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-green-200 p-5">
                <div className="flex items-center justify-between mb-2">
                  <CheckCircle2 size={20} className="text-green-500" />
                  <span className="text-xs text-gray-400">已完成</span>
                </div>
                <p className="text-3xl font-bold text-green-600">{filteredCompleted}</p>
                <p className="text-sm text-gray-500 mt-1">已提交人次</p>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-red-200 p-5">
                <div className="flex items-center justify-between mb-2">
                  <XCircle size={20} className="text-red-500" />
                  <span className="text-xs text-gray-400">未完成</span>
                </div>
                <p className="text-3xl font-bold text-red-500">{filteredIncomplete}</p>
                <p className="text-sm text-gray-500 mt-1">未提交人次</p>
              </div>

              <div className={`rounded-xl shadow-sm border p-5 ${
                completionRate >= 80 ? 'bg-green-50 border-green-300'
                  : completionRate >= 50 ? 'bg-yellow-50 border-yellow-300'
                  : 'bg-red-50 border-red-300'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <Calendar size={20} className="text-gray-400" />
                  <span className="text-xs text-gray-400">完成率</span>
                </div>
                <p className={`text-3xl font-bold ${
                  completionRate >= 80 ? 'text-green-600'
                    : completionRate >= 50 ? 'text-yellow-600'
                    : 'text-red-500'
                }`}>{completionRate}%</p>
                <p className="text-sm text-gray-500 mt-1">{startDate} ~ {endDate}</p>
              </div>
            </div>

            {/* 底部：填报明细表格 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-gray-50 px-5 py-3 flex items-center justify-between border-b border-gray-200">
                <h3 className="text-base font-bold text-gray-800">
                  填报明细（{startDate} ~ {endDate}）
                </h3>
                {statsData.earliestDate && (
                  <span className="text-xs text-gray-400">
                    统计起始：{statsData.earliestDate}（共 {statsData.totalDays} 天）
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 border-b whitespace-nowrap">序号</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 border-b whitespace-nowrap">日期</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 border-b whitespace-nowrap">姓名</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 border-b whitespace-nowrap">角色</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 border-b whitespace-nowrap">填报状态</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 border-b whitespace-nowrap">填报店铺</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 border-b whitespace-nowrap">提交时间</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 border-b whitespace-nowrap">累计未提交天数</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 border-b whitespace-nowrap">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDetails.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                          暂无数据
                        </td>
                      </tr>
                    ) : (
                      sortedDetails.map((detail, index) => (
                        <tr key={index} className={`hover:bg-gray-50 transition-colors ${!detail.submitted ? 'bg-red-50/30' : ''}`}>
                          <td className="px-4 py-3 text-sm text-gray-500 border-b">{index + 1}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 border-b whitespace-nowrap">{detail.date}</td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900 border-b">{detail.userName}</td>
                          <td className="px-4 py-3 text-sm text-gray-700 border-b">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              detail.groupName?.includes('督导')
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-purple-100 text-purple-700'
                            }`}>
                              {detail.groupName}
                            </span>
                          </td>
                          <td className="px-4 py-3 border-b">
                            {detail.submitted ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                <CheckCircle2 size={14} />
                                已提交
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                                <XCircle size={14} />
                                未提交
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 border-b">{detail.destination || '-'}</td>
                          <td className="px-4 py-3 text-sm text-gray-500 border-b whitespace-nowrap">{detail.submittedAt || '-'}</td>
                          <td className="px-4 py-3 text-sm border-b">
                            {detail.cumulativeMissed > 0 ? (
                              <span className={`font-bold ${detail.cumulativeMissed > 10 ? 'text-red-600' : 'text-yellow-600'}`}>
                                {detail.cumulativeMissed} 天
                              </span>
                            ) : (
                              <span className="text-green-600 font-medium">0 天</span>
                            )}
                          </td>
                          <td className="px-4 py-3 border-b">
                            {detail.logId && (
                              <button
                                onClick={() => handleViewLog(detail.logId!)}
                                className="flex items-center gap-1 px-2 py-1 text-blue-500 hover:bg-blue-50 rounded-lg text-xs"
                                title="查看日志"
                              >
                                <Eye size={14} />
                                查看
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {sortedDetails.length > 0 && (
                <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex justify-between text-sm text-gray-500">
                  <span>共 {sortedDetails.length} 条记录</span>
                  <span>
                    已提交 {filteredCompleted} 人次 · 未提交 {filteredIncomplete} 人次
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

export default LogStatisticsPage;
