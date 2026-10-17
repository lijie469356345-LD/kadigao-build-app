import { useState, useEffect } from 'react';
import { TrendingUp, ShoppingBag, Users, Store, FileText, ArrowRight, BarChart3, Calendar, RefreshCw } from 'lucide-react';
import { getLogs } from '../../api/logs';
import { getSalesReport } from '../../api/reports';
import { getUsers } from '../../api/users';
import { getAverageScore } from '../../api/scores';
import { getTaskCount } from '../../api/tasks';
import { useNavigate } from 'react-router-dom';
import type { LogItem, SalesReport, User } from '../../types';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { useDataCacheStore } from '../../store/dataCacheStore';

function DashboardPage() {
  const { user } = useAuthStore();
  const { dashboardData, setDashboardData } = useDataCacheStore();
  const isAdmin = user?.isAdmin === '是';
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [reports, setReports] = useState<SalesReport[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [avgScore, setAvgScore] = useState<string>('0');
  const [taskCount, setTaskCount] = useState<number>(0);
  const [timeProgress, setTimeProgress] = useState<number>(0);
  const [hasData, setHasData] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (dashboardData) {
      setLogs(dashboardData.logs);
      setReports(dashboardData.reports);
      setUsers(dashboardData.users);
      setAvgScore(dashboardData.avgScore);
      setTaskCount(dashboardData.taskCount);
      setTimeProgress(dashboardData.timeProgress);
      setHasData(true);
    } else {
      // 首次进入无缓存，自动加载
      loadData();
    }
  }, [dashboardData]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [logsRes, reportsResult, usersData, score, count] = await Promise.all([
        getLogs(user?.userCode || '', isAdmin, user?.groupName || '', undefined, undefined, false, 1, 0),
        getSalesReport('month', 'all', user?.groupName || undefined),
        getUsers(),
        getAverageScore(),
        getTaskCount(user?.userCode || '', isAdmin, 'pending')
      ]);
      const latestLogs = logsRes.data.slice(0, 5);
      setLogs(latestLogs);
      setReports(reportsResult.data);
      setTimeProgress(reportsResult.timeProgress || 0);
      setUsers(usersData);
      setTaskCount(count);
      const scoreStr = score > 0 ? score.toString() : '0';
      setAvgScore(scoreStr);
      setDashboardData({
        logs: latestLogs,
        reports: reportsResult.data,
        users: usersData,
        avgScore: scoreStr,
        taskCount: count,
        timeProgress: reportsResult.timeProgress || 0
      });
      setHasData(true);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const totalAmount = reports.reduce((sum, r) => sum + r.amount, 0);
  const totalTarget = reports.reduce((sum, r) => sum + r.target, 0);
  const totalQuantity = reports.reduce((sum, r) => sum + r.quantity, 0);
  const totalOrderCount = reports.reduce((sum, r) => sum + (r.orderCount || 0), 0);
  const pendingTasks = taskCount;

  return (
    <Layout title="仪表盘" subtitle="欢迎回来，查看今日巡店概览">
      <div className="max-w-6xl mx-auto">
        {/* 刷新按钮 */}
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
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !hasData ? (
          <div className="flex flex-col items-center justify-center min-h-[400px]">
            <p className="text-xl text-gray-500 mb-4">请刷新数据</p>
          </div>
        ) : (<div className="w-full">
        {/* 销售统计卡片 */}
        <div className="grid grid-cols-7 gap-4 mb-6">
          <div className="bg-white rounded-xl p-6 shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/reports')}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">销售金额</p>
                <p className="text-2xl font-bold text-gray-800 mt-1">
                  ¥{Math.round(totalAmount / 10000)}万
                </p>
              </div>
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-primary" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/reports')}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">目标完成</p>
                <p className="text-2xl font-bold text-gray-800 mt-1">
                  {totalTarget > 0 ? ((totalAmount / totalTarget) * 100).toFixed(1) : '0'}%
                </p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-green-500" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/reports')}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">销售数量</p>
                <p className="text-2xl font-bold text-gray-800 mt-1">{totalQuantity}件</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <Calendar className="w-6 h-6 text-blue-500" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/reports')}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">销售笔数</p>
                <p className="text-2xl font-bold text-gray-800 mt-1">{totalOrderCount}</p>
              </div>
              <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-indigo-500" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/reports')}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">平均店效</p>
                <p className="text-2xl font-bold text-gray-800 mt-1">
                  ¥{reports.length > 0 ? Math.round(totalAmount / reports.length).toLocaleString('zh-CN', { useGrouping: false }) : 0}元
                </p>
              </div>
              <div className="w-12 h-12 bg-cyan-100 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-cyan-500" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/reports')}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">店铺数量</p>
                <p className="text-2xl font-bold text-gray-800 mt-1">{reports.length}</p>
              </div>
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-purple-500" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/tasks')}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">未完成任务</p>
                <p className="text-2xl font-bold text-gray-800 mt-1">{pendingTasks}项</p>
              </div>
              <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                <FileText className="w-6 h-6 text-orange-500" />
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">近期巡店日志</h2>
              <button 
                onClick={() => navigate('/logs')}
                className="text-primary text-sm hover:underline"
              >
                查看全部
              </button>
            </div>
            <div className="space-y-4">
              {logs.length === 0 ? (
                <p className="text-gray-400 text-center py-8">暂无巡店日志</p>
              ) : (
                logs.map((log, index) => (
                  <div 
                    key={index} 
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                    onClick={() => navigate(`/logs/${log.id}`)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                        <Store className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-800">{log.destination}</p>
                        <p className="text-sm text-gray-500">{log.supervisor} - {log.date}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-500">状态</p>
                      <span className="px-2 py-1 text-xs rounded-full font-medium bg-green-100 text-green-600">
                        已完成
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">今日待办</h2>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full border-2 border-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-gray-800">完成今日巡店计划</p>
                  <p className="text-sm text-gray-500">5家店铺</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-green-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-gray-800 line-through">提交昨日巡店日志</p>
                  <p className="text-sm text-gray-500">已完成</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full border-2 border-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-gray-800">整理销售数据</p>
                  <p className="text-sm text-gray-500">本周报告</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full border-2 border-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-gray-800">团队会议</p>
                  <p className="text-sm text-gray-500">下午 2:00</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>)}
      </div>
    </Layout>
  );
}

export default DashboardPage;
