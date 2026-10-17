import { FileText, BarChart3, Store, ArrowRight, Calendar, User, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { getLogs } from '../../api/logs';
import { getSalesReport, get7DayComparison } from '../../api/reports';
import { getTaskCount, getTasks } from '../../api/tasks';
import type { LogItem, SalesReport, InspectionTask } from '../../types';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';

function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin === '是';
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [reports, setReports] = useState<SalesReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [avgScore, setAvgScore] = useState<string>('0');
  const [taskCount, setTaskCount] = useState<number>(0);
  const [tasks, setTasks] = useState<InspectionTask[]>([]);
  const [todayLogsCompleted, setTodayLogsCompleted] = useState(0);
  const [todayLogsPending, setTodayLogsPending] = useState(0);
  const [totalPendingLogs, setTotalPendingLogs] = useState(0);

  useEffect(() => {
    // 检查是否已经保存过数据
    const savedData = localStorage.getItem('dashboard_data');
    if (savedData) {
      // 从 localStorage 恢复数据
      const data = JSON.parse(savedData);
      setLogs(data.logs);
      setReports(data.reports);
      setAvgScore(data.avgScore);
      setTaskCount(data.taskCount);
      setTasks(data.tasks);
      setTodayLogsCompleted(data.todayLogsCompleted || 0);
      setTodayLogsPending(data.todayLogsPending || 0);
      setTotalPendingLogs(data.totalPendingLogs || 0);
      setLoading(false);
    } else {
      // 没有保存的数据，重新加载
      loadData();
    }
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('开始加载仪表盘数据...');
      console.log('用户信息:', user);
      
      const [logsRes, reportsResult, day7Data, count, tasksData] = await Promise.all([
        getLogs(user?.userCode || '', isAdmin, user?.groupName || '', undefined, undefined, false, 1, 0),
        getSalesReport('month', 'all', user?.groupName || undefined),
        get7DayComparison(user?.groupName || undefined),
        getTaskCount(user?.userName || user?.userCode || '', isAdmin, user?.groupName || '', 'in_progress'),
        getTasks(user?.userName || user?.userCode || '', isAdmin, user?.groupName || '')
      ]);
      const logsData = logsRes.data;

      console.log('日志数据:', logsData.length);
      console.log('7日对比数据:', day7Data);
      console.log('7日对比数据类型:', Array.isArray(day7Data) ? '数组' : typeof day7Data);
      console.log('7日对比数据长度:', Array.isArray(day7Data) ? day7Data.length : '不是数组');
      console.log('任务数量:', count);
      console.log('任务数据:', tasksData);
      
      const slicedLogs = logsData.slice(0, 5);
      const filteredTasks = tasksData.filter(t => t.status === 'in_progress');
      
      // 用全量日志数据统计（不能只在前5条里统计）
      const today = new Date();
      const todayAll = logsData.filter(log => {
        const logDate = new Date(log.date);
        return logDate.toDateString() === today.toDateString();
      });
      const todayCompleted = todayAll.filter(log => log.status === 'submitted').length;
      const todayPending = todayAll.filter(log => log.status === 'draft').length;
      // 累计未完成 = 所有草稿状态的日志条数
      const totalPending = logsData.filter(log => log.status === 'draft').length;
      
      setLogs(slicedLogs);
      setReports(reportsResult.data);
      
      // 计算平均得分（与评分体系页面一致）
      const day7Array = Array.isArray(day7Data) ? day7Data : [];
      const validScores = day7Array.filter(d => d.score > 0);
      console.log('有效分数数量:', validScores.length);
      let calculatedAvgScore = '0';
      if (validScores.length > 0) {
        const totalScore = validScores.reduce((sum, d) => sum + d.score, 0);
        calculatedAvgScore = (totalScore / validScores.length).toFixed(1);
        console.log('平均得分:', calculatedAvgScore);
      } else {
        console.log('没有有效分数，设置为0');
      }
      setAvgScore(calculatedAvgScore);
      setTaskCount(count);
      setTasks(filteredTasks);
      setTodayLogsCompleted(todayCompleted);
      setTodayLogsPending(todayPending);
      setTotalPendingLogs(totalPending);
      
      // 保存数据到 localStorage（忽略存储超限错误）
      try {
        const dashboardData = {
          logs: slicedLogs,
          reports: reportsResult.data?.slice(0, 50), // 只缓存前50条
          avgScore: calculatedAvgScore,
          taskCount: count,
          tasks: filteredTasks?.slice(0, 20),
          todayLogsCompleted: todayCompleted,
          todayLogsPending: todayPending,
          totalPendingLogs: totalPending
        };
        localStorage.setItem('dashboard_data', JSON.stringify(dashboardData));
      } catch (storageErr) {
        // localStorage 超限，静默忽略
        try { localStorage.removeItem('dashboard_data'); } catch {}
      }
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '加载数据失败';
      console.error('Failed to load dashboard data:', errorMessage);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    // 清除保存的数据
    localStorage.removeItem('dashboard_data');
    // 重新加载数据
    loadData();
  };

  const monthlySales = reports.reduce((sum, r) => sum + r.amount, 0);

  return (
    <Layout title="仪表盘" subtitle="查看系统概览和最新动态">
      <div className="flex justify-end mb-6">
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          <span>{loading ? '加载中...' : '刷新数据'}</span>
        </button>
      </div>
      
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <p className="text-red-600">数据加载失败: {error}</p>
            <button
              onClick={handleRefresh}
              className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
            >
              重新加载
            </button>
          </div>
        </div>
      )}
      
      {/* 响应式卡片网格 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/logs')}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm text-gray-500">今日巡店</p>
              <p className="text-sm sm:text-lg font-bold text-gray-800 mt-1">
                完成 {todayLogsCompleted}
              </p>
              <p className="text-sm sm:text-lg font-bold text-gray-800">
                /未完成 {todayLogsPending}
              </p>
              <p className="text-sm sm:text-lg font-bold text-gray-800">
                /累计未完成 {totalPendingLogs}
              </p>
            </div>
            <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <FileText className="w-6 h-6 text-primary" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/reports')}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm text-gray-500">本月销售</p>
              <p className="text-lg sm:text-2xl font-bold text-gray-800 mt-1">¥{(monthlySales / 10000).toFixed(1)}万</p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <BarChart3 className="w-6 h-6 text-green-500" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/scores')}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm text-gray-500">平均得分</p>
              <p className={`text-lg sm:text-2xl font-bold mt-1 ${parseFloat(avgScore) >= 80 ? 'text-green-500' : parseFloat(avgScore) >= 60 ? 'text-yellow-500' : 'text-red-500'}`}>
                {avgScore}
              </p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <BarChart3 className="w-6 h-6 text-blue-500" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/tasks')}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm text-gray-500">巡店任务未完成</p>
              <p className="text-lg sm:text-2xl font-bold text-gray-800 mt-1">{taskCount}项</p>
            </div>
            <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <Store className="w-6 h-6 text-orange-500" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base sm:text-lg font-semibold text-gray-800">最新巡店日志</h2>
            <button 
              onClick={() => navigate('/logs')}
              className="text-primary text-xs sm:text-sm hover:underline"
            >
              查看全部
            </button>
          </div>
          <div className="space-y-3">
            {loading ? (
              <div className="flex items-center justify-center min-h-[200px]">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : logs.length === 0 ? (
              <p className="text-gray-400 text-center py-8">暂无巡店日志</p>
            ) : (
              logs.map((log, index) => (
                <div 
                  key={index} 
                  className="flex items-center justify-between p-3 sm:p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                  onClick={() => navigate(`/logs/${log.id}`)}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                      <Store className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-800 truncate text-sm">{log.destination}</p>
                        <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                          log.status === 'submitted' 
                            ? 'bg-green-100 text-green-600' 
                            : 'bg-yellow-100 text-yellow-600'
                        }`}>
                          {log.status === 'submitted' ? '已提交' : '草稿'}
                        </span>
                      </div>
                      <p className="text-xs sm:text-sm text-gray-500">{log.supervisor} - {log.date}</p>
                    </div>
                  </div>
                  <div className="flex items-center text-xs sm:text-sm text-gray-500 flex-shrink-0 ml-2">
                    <span>查看详情</span>
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold text-gray-800 mb-4">未完成任务单</h2>
          <div className="space-y-3">
            {loading ? (
              <div className="flex items-center justify-center min-h-[150px]">
                <div className="w-6 h-6 border-3 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : tasks.length === 0 ? (
              <p className="text-gray-400 text-center py-6">暂无未完成任务</p>
            ) : (
              tasks.map((task) => (
                <div 
                  key={task.id} 
                  className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                  onClick={() => navigate('/tasks')}
                >
                  <p className="font-medium text-gray-800 truncate text-sm">{task.title}</p>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <User className="w-3 h-3" />
                      <span>{task.assignedToName}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Calendar className="w-3 h-3" />
                      <span>{task.deadline}</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {task.shopNames.slice(0, 2).join(', ') || '暂无'}
                    {task.shopNames.length > 2 ? `等${task.shopNames.length}家店` : ''}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default Dashboard;
