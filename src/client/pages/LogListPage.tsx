import { useEffect, useState, useMemo, useCallback } from 'react';
import { Plus, Edit, Trash2, Calendar, MapPin, User, RefreshCw, Send, Eye, Ban, Users, Share2, AlertCircle, ChevronRight, CheckCircle2, XCircle, FileText, X, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getLogs, deleteLog, updateLog, createLog, getDailyStats } from '../../api/logs';
import { getUsers } from '../../api/users';
import { getShops } from '../../api/shops';
import { pushBatchLogs } from '../../api/wechatPush';
import type { LogItem, User as UserType, Shop } from '../../types';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { useDataCacheStore } from '../../store/dataCacheStore';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';

function LogListPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { logData, setLogData } = useDataCacheStore();
  const isAdmin = user?.isAdmin === '是';
  const groupName = user?.groupName || '';
  const userName = user?.userName || '';
  const isManager = groupName.includes('经理') || userName.includes('经理');
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [sharedLogs, setSharedLogs] = useState<LogItem[]>([]);
  const [users, setUsers] = useState<UserType[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingShared, setLoadingShared] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);
  const [hasData, setHasData] = useState(false);
  const pageSize = 20;

  // 是否提交筛选：all=全部 / submitted=已提交 / unsubmitted=未提交（草稿+作废）
  const [submitFilter, setSubmitFilter] = useState<string>('all');

  // 每日填报统计
  const [dailyStats, setDailyStats] = useState<Array<{
    date: string;
    totalRequired: number;
    completed: number;
    incomplete: number;
  }>>([]);
  const [dailyStatsTotalRequired, setDailyStatsTotalRequired] = useState(0);
  const [loadingStats, setLoadingStats] = useState(false);

  // 区域查找映射: shopName(destination) -> area
  const shopAreaMap = useMemo(() => {
    const map = new Map<string, string>();
    shops.forEach((s: any) => {
      const name = s.shopName || s['店铺名称'] || '';
      const area = s.area || s['区域'] || '';
      if (name && area) map.set(name, area);
    });
    return map;
  }, [shops]);

  // 三级联动多选筛选
  const logFilter = useAreaSupervisorShopFilter<LogItem>(logs, {
    getArea: (log) => shopAreaMap.get(log.destination),
    getSupervisor: (log) => log.supervisor,
    getShopName: (log) => log.destination,
    getWarehouseType: (log: any) => (log.warehouseType) || ((log.destination || '').endsWith('_JM') ? '加盟' : (log.destination || '').endsWith('_ZY') ? '直营' : ''),
    onChange: () => setCurrentPage(1),
  });

  useEffect(() => {
    const now = new Date();
    const endDateStr = now.toISOString().split('T')[0];
    const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startDateStr = startDate.toISOString().split('T')[0];

    setStartDate(startDateStr);
    setEndDate(endDateStr);
    // 日期设好后加载数据
    loadLogsWithDates(startDateStr, endDateStr);
  }, []);

  const loadLogsWithDates = async (s: string, e: string) => {
    try {
      setLoading(true);
      const [logsRes, usersData, shopsData] = await Promise.all([
        getLogs(user?.userCode || '', isAdmin, user?.groupName || '', s || undefined, e || undefined, false, 1, 500),
        getUsers(),
        getShops(user?.groupName)
      ]);
      setLogs(logsRes.data);
      setTotalLogs(logsRes.total);
      setUsers(usersData);
      setShops(Array.isArray(shopsData) ? shopsData : []);
      setLogData(logsRes.data);
      setHasData(true);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadData = async (page = currentPage) => {
    await loadLogsWithDates(startDate, endDate);
  };

  // 点击查询按钮：用当前日期范围重新从后端加载数据
  const handleSearch = () => {
    setCurrentPage(1);
    loadLogsWithDates(startDate, endDate);
  };

  const loadSharedLogs = async () => {
    try {
      setLoadingShared(true);
      const res = await getLogs('', false, '', undefined, undefined, true, 1, 5);
      setSharedLogs(res.data);
    } catch (error) {
      console.error('Failed to load shared logs:', error);
    } finally {
      setLoadingShared(false);
    }
  };

  const loadDailyStats = useCallback(async () => {
    try {
      setLoadingStats(true);
      const data = await getDailyStats(undefined, undefined, user?.groupName);
      setDailyStats(data.dailyStats || []);
      setDailyStatsTotalRequired(data.totalRequired || 0);
    } catch (error) {
      console.error('Failed to load daily stats:', error);
    } finally {
      setLoadingStats(false);
    }
  }, [user?.groupName]);

  useEffect(() => { loadDailyStats(); }, [loadDailyStats]);

  const handleDelete = async (id: number) => {
    if (!isAdmin) {
      alert('只有管理员有权限删除日志');
      return;
    }
    if (!window.confirm('确定要删除这条日志吗？')) return;
    try {
      await deleteLog(id);
      loadData();
      loadSharedLogs();
    } catch (error) {
      console.error('Failed to delete log:', error);
    }
  };

  const handleVoid = async (log: LogItem) => {
    if (!isAdmin) {
      alert('只有管理员有权限作废日志');
      return;
    }
    if (!window.confirm('确定要作废这条日志吗？作废后将不参与数据统计。')) return;
    try {
      await updateLog(String(log.id), {
        status: 'voided'
      });
      loadData();
    } catch (error) {
      console.error('Failed to void log:', error);
    }
  };

  const handleSubmit = async (log: LogItem) => {
    if (log.status === 'submitted') {
      alert('该日志已经提交，不能重复提交');
      return;
    }
    if (!window.confirm('确定要提交这条日志吗？')) return;
    try {
      console.log('提交日志:', log.id, '状态:', 'submitted');
      const result = await updateLog(String(log.id), {
        status: 'submitted'
      });
      console.log('提交结果:', result);
      alert('日志提交成功');
      loadData();
    } catch (error) {
      console.error('Failed to submit log:', error);
      alert('提交失败，请重试');
    }
  };

  const handleShare = async (log: LogItem) => {
    if (log.shareToAll) {
      alert('该日志已共享');
      return;
    }
    if (log.status !== 'submitted') {
      alert('只有已提交的日志才能共享');
      return;
    }
    if (!window.confirm('确定要将这条日志共享给全员吗？共享后所有人都能在优秀巡店日志区看到。')) return;
    try {
      const result = await updateLog(String(log.id), {
        shareToAll: 1
      });
      console.log('共享结果:', result);
      alert('日志共享成功');
      loadData();
      loadSharedLogs();
    } catch (error) {
      console.error('Failed to share log:', error);
      alert('共享失败，请重试');
    }
  };

  const handleNewLog = () => {
    // 只有督导需要检测草稿，经理和管理员不检测
    if (!isAdmin && !isManager) {
      const draftLogs = logs.filter(log => log.status === 'draft');
      if (draftLogs.length > 0) {
        const draftList = draftLogs.map(log => `• ${log.date} ${log.destination}`).join('\n');
        alert(`您有 ${draftLogs.length} 条未提交的日志草稿，请先提交或作废后再新建日志：\n\n${draftList}`);
        return;
      }
    }
    navigate('/logs/new');
  };

  const handleEdit = (log: LogItem) => {
    if (log.status === 'submitted') {
      alert('该日志已提交，无法修改');
      return;
    }
    navigate(`/logs/${log.id}`);
  };

  const handleView = (log: LogItem) => {
    navigate(`/logs/${log.id}`);
  };

  const [pushingId, setPushingId] = useState<number | null>(null);
  const [showNoInspectionModal, setShowNoInspectionModal] = useState(false);

  // 多选重新推送（需求4）
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [pushingBatch, setPushingBatch] = useState(false);
  const canBatchPush = isAdmin || isManager;
  const toggleSelect = (id?: number) => {
    if (id == null) return;
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const handleReset = () => {
    const now = new Date();
    const endDateStr = now.toISOString().split('T')[0];
    const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startDateStr = startDate.toISOString().split('T')[0];

    setStartDate(startDateStr);
    setEndDate(endDateStr);
    setSubmitFilter('all');
    logFilter.handleFilterAll();
    setCurrentPage(1);
    setLogData([]);
    // 用默认7天范围重新查询后端
    loadLogsWithDates(startDateStr, endDateStr);
  };

  const handleNoInspection = () => {
    setShowNoInspectionModal(true);
  };

  const handleSubmitNoInspection = async (type: string) => {
    const reason = type === 'leave' ? '调休' : '其他事项不巡店';
    const today = new Date().toISOString().split('T')[0];

    setShowNoInspectionModal(false);

    try {
      await createLog({
        supervisor: userName || '',
        date: today,
        departure: '未巡店',
        destination: '未巡店',
        arrivalTime: '',
        departureTime: '',
        remarks: reason,
        content: undefined,
        signature: userName || '',
        userId: user?.id || 1,
        userName: userName || '',
        status: 'submitted',
        isNoInspection: true
      });
      alert(`已提交未巡店说明：${reason}`);
      setTimeout(() => {
        loadData();
      }, 500);
    } catch (error: any) {
      console.error('提交未巡店说明失败:', error);
      const errMsg = error?.response?.data?.message || error?.response?.data?.error || error?.message || '未知错误';
      alert('提交失败：' + errMsg);
    }
  };

  const filteredLogs = useMemo(() => {
    let result = logFilter.filteredData;
    if (startDate) {
      result = result.filter(log => {
        const d = typeof log.date === 'string' ? log.date.substring(0, 10) : new Date(log.date).toISOString().substring(0, 10);
        return d >= startDate;
      });
    }
    if (endDate) {
      result = result.filter(log => {
        const d = typeof log.date === 'string' ? log.date.substring(0, 10) : new Date(log.date).toISOString().substring(0, 10);
        return d <= endDate;
      });
    }
    if (submitFilter !== 'all') {
      result = result.filter(log =>
        submitFilter === 'submitted' ? log.status === 'submitted' : log.status !== 'submitted'
      );
    }
    return result;
  }, [logFilter.filteredData, startDate, endDate, submitFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const paginatedLogs = filteredLogs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const goToPage = (p: number) => {
    setCurrentPage(p);
  };

  // 当前页全选切换 + 批量重推
  const allPageSelected = paginatedLogs.length > 0 && paginatedLogs.every((l) => selectedIds.has(l.id!));
  const toggleSelectPage = () => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (allPageSelected) {
        paginatedLogs.forEach((l) => n.delete(l.id!));
      } else {
        paginatedLogs.forEach((l) => n.add(l.id!));
      }
      return n;
    });
  };
  const handleBatchPush = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`确定要将选中的 ${selectedIds.size} 条日志重新推送到企业微信吗？`)) return;
    try {
      setPushingBatch(true);
      const ids = Array.from(selectedIds);
      const result = await pushBatchLogs(ids);
      const ok = result.successCount ?? 0;
      alert(`重新推送完成：共 ${result.total} 条，成功 ${ok} 条`);
      setSelectedIds(new Set());
    } catch (error: any) {
      const errMsg = error?.response?.data?.error || error?.message || '未知错误';
      alert(`重新推送失败：${errMsg}`);
    } finally {
      setPushingBatch(false);
    }
  };

  const renderActionButtons = (log: LogItem) => (
    <div className="flex items-center gap-1">
      <div className="flex flex-col items-center">
        <button
          onClick={() => handleView(log)}
          className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg"
          title="查看"
        >
          <Eye size={16} />
        </button>
        <span className="text-xs text-gray-500 mt-1">查看</span>
      </div>
      {log.status !== 'submitted' && (
        <>
          <div className="flex flex-col items-center">
            <button
              onClick={() => handleEdit(log)}
              className="p-2 text-green-500 hover:bg-green-50 rounded-lg"
              title="编辑"
            >
              <Edit size={16} />
            </button>
            <span className="text-xs text-gray-500 mt-1">编辑</span>
          </div>
          <div className="flex flex-col items-center">
            <button
              onClick={() => handleSubmit(log)}
              className="p-2 text-purple-500 hover:bg-purple-50 rounded-lg"
              title="提交"
            >
              <Send size={16} />
            </button>
            <span className="text-xs text-gray-500 mt-1">提交</span>
          </div>
        </>
      )}
      {log.status === 'submitted' && !!!(log.shareToAll) && (isAdmin || isManager) && (
        <div className="flex flex-col items-center">
          <button
            onClick={() => handleShare(log)}
            className="p-2 text-orange-500 hover:bg-orange-50 rounded-lg"
            title="共享全员"
          >
            <Users size={16} />
          </button>
          <span className="text-xs text-gray-500 mt-1">共享</span>
        </div>
      )}
      {!!(log.shareToAll) && (
        <div className="flex flex-col items-center">
          <div className="p-2 text-gray-400 bg-gray-100 rounded-lg">
            <Users size={16} />
          </div>
          <span className="text-xs text-gray-400 mt-1">已共享</span>
        </div>
      )}
      {/* 发给刘邓按钮 — 暂时隐藏，IP白名单配置好后恢复
      {log.status === 'submitted' && (
        <div className="flex flex-col items-center">
          <button
            onClick={() => handlePushToLiudeng(log)}
            disabled={pushingId === log.id}
            className="p-2 text-cyan-600 hover:bg-cyan-50 rounded-lg disabled:opacity-50"
            title="发给刘邓"
          >
            {pushingId === log.id ? (
              <RefreshCw size={16} className="animate-spin" />
            ) : (
              <Share2 size={16} />
            )}
          </button>
          <span className="text-xs text-gray-500 mt-1">发给刘邓</span>
        </div>
      )}
      */}
      {isAdmin && (
        <>
          <div className="flex flex-col items-center">
            <button
              onClick={() => handleVoid(log)}
              className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
              title="作废"
            >
              <Ban size={16} />
            </button>
            <span className="text-xs text-gray-500 mt-1">作废</span>
          </div>
          <div className="flex flex-col items-center">
            <button
              onClick={() => handleDelete(log.id!)}
              className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
              title="删除"
            >
              <Trash2 size={16} />
            </button>
            <span className="text-xs text-gray-500 mt-1">删除</span>
          </div>
        </>
      )}
    </div>
  );

  const NoInspectionModal = () => {
    if (!showNoInspectionModal) return null;
    
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-gray-800">未巡店说明</h3>
            <button
              onClick={() => { setShowNoInspectionModal(false); }}
              className="p-1 hover:bg-gray-100 rounded-lg"
            >
              <X size={20} className="text-gray-500" />
            </button>
          </div>
          <p className="text-gray-600 mb-6">
            请选择未巡店的原因：
          </p>
          <div className="space-y-3">
            <button
              onClick={() => handleSubmitNoInspection('leave')}
              className="w-full py-3 px-4 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors font-medium"
            >
              调休
            </button>
            <button
              onClick={() => handleSubmitNoInspection('other')}
              className="w-full py-3 px-4 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors font-medium"
            >
              其他事项不巡店
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Layout title="巡店日志" subtitle="查看和管理巡店日志">
      <div className="p-4">
        <div className="flex justify-end mb-6 px-2">
          <button
            onClick={() => { loadData(); loadSharedLogs(); }}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            <span>刷新数据</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* 左侧：备注要求区 */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-blue-500 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-blue-800 mb-2">巡店日志填写要求</h3>
                <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
                  <li>所有填写的内容必须全部填完，包括结果和照片</li>
                  <li>内容要清晰具体，结果描述要量化</li>
                  <li>不能存在草稿日志，请进入编辑，删除</li>
                </ol>
              </div>
            </div>
          </div>

          {/* 右侧：每日填报统计卡片 */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-gradient-to-r from-indigo-500 to-purple-500 px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar size={20} className="text-white" />
                  <h2 className="text-lg font-bold text-white">每日填报统计</h2>
                </div>
                <span className="text-sm text-white/80">应填 {dailyStatsTotalRequired} 人 / 日</span>
              </div>
              <div className="p-3 max-h-[280px] overflow-y-auto">
                {loadingStats ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-6 h-6 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : dailyStats.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">暂无统计数据</div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {dailyStats.map((stat) => {
                      const rate = stat.totalRequired > 0
                        ? Math.round((stat.completed / stat.totalRequired) * 100)
                        : 0;
                      return (
                        <button
                          key={stat.date}
                          onClick={() => navigate(`/logs/statistics?date=${stat.date}`)}
                          className="flex items-center justify-between p-3 bg-gray-50 hover:bg-indigo-50 rounded-lg border border-gray-200 hover:border-indigo-300 transition-all text-left group"
                        >
                          <div className="flex flex-col gap-1">
                            <span className="text-sm font-bold text-gray-800">{stat.date}</span>
                            <div className="flex items-center gap-3 text-xs">
                              <span className="flex items-center gap-1 text-green-600">
                                <CheckCircle2 size={12} />
                                {stat.completed}人
                              </span>
                              <span className="flex items-center gap-1 text-red-500">
                                <XCircle size={12} />
                                {stat.incomplete}人
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex flex-col items-end">
                              <span className={`text-lg font-bold ${
                                rate >= 80 ? 'text-green-600'
                                  : rate >= 50 ? 'text-yellow-600'
                                  : 'text-red-500'
                              }`}>{rate}%</span>
                              <span className="text-xs text-gray-400">{stat.completed}/{stat.totalRequired}</span>
                            </div>
                            <ChevronRight size={18} className="text-gray-300 group-hover:text-indigo-400" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mb-8 bg-white rounded-xl shadow-sm border border-orange-100 overflow-hidden">
          <div className="bg-gradient-to-r from-orange-500 to-yellow-500 px-6 py-4">
            <div className="flex items-center gap-3">
              <Users size={24} className="text-white" />
              <h2 className="text-xl font-bold text-white">区优秀巡店日志</h2>
              <span className="px-3 py-1 bg-white/20 text-white rounded-full text-sm font-medium">全员可见</span>
            </div>
          </div>
          {loadingShared ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : sharedLogs.length === 0 ? (
            <div className="bg-gray-50 rounded-lg p-6 text-center">
              <p className="text-gray-500">暂无优秀巡店日志</p>
              <p className="text-sm text-gray-400 mt-2">已提交的日志共享后会显示在这里</p>
            </div>
          ) : (
            <div className="bg-gradient-to-r from-orange-50 to-yellow-50 rounded-lg border border-orange-200 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-orange-100">
                    <th className="px-4 py-3 text-left text-sm font-medium text-orange-800">日期</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-orange-800">督导</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-orange-800">目的地</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-orange-800">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sharedLogs.slice(0, 5).map((log) => (
                    <tr key={log.id} className="hover:bg-orange-100/50 transition-colors">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        <div className="flex items-center gap-2">
                          <Calendar size={14} className="text-orange-400" />
                          {log.date}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        <div className="flex items-center gap-2">
                          <User size={14} className="text-orange-400" />
                          {log.supervisor}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        <div className="flex items-center gap-2">
                          <MapPin size={14} className="text-orange-400" />
                          {log.destination}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-center">
                          <button
                            onClick={() => handleView(log)}
                            className="p-2 text-orange-500 hover:bg-orange-50 rounded-lg"
                            title="查看"
                          >
                            <Eye size={16} />
                          </button>
                          <span className="text-xs text-gray-500 mt-1">查看</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sharedLogs.length > 5 && (
                <div className="px-4 py-2 bg-orange-100 text-center">
                  <span className="text-sm text-orange-600">共 {sharedLogs.length} 条优秀日志</span>
                </div>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !hasData ? (
          <div className="flex flex-col items-center justify-center min-h-[400px]">
            <p className="text-xl text-gray-500">请点击"刷新数据"按钮加载数据</p>
          </div>
        ) : (<div className="w-full">
        <div className="flex flex-col md:flex-row gap-4 mb-4 items-start md:items-center">
          <AreaSupervisorShopFilter filter={logFilter} />
          
          <div className="flex gap-2">
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <span className="flex items-center text-gray-400">至</span>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <select
            value={submitFilter}
            onChange={(e) => { setSubmitFilter(e.target.value); setCurrentPage(1); }}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="all">全部状态</option>
            <option value="submitted">已提交</option>
            <option value="unsubmitted">未提交</option>
          </select>

          <button
            onClick={handleSearch}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
          >
            <Search size={18} />
            <span>查询</span>
          </button>

          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
            <RefreshCw size={18} />
            <span>重置</span>
          </button>
        </div>

        <div className="flex justify-between items-center mb-4">
          <div className="text-sm text-gray-500">
            共 {filteredLogs.length} 条记录
            {selectedIds.size > 0 && (
              <span className="ml-2 text-primary font-medium">已选 {selectedIds.size} 条</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canBatchPush && selectedIds.size > 0 && (
              <button
                onClick={handleBatchPush}
                disabled={pushingBatch}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                {pushingBatch ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} />}
                <span>重新推送 ({selectedIds.size})</span>
              </button>
            )}
            <button
              onClick={handleNewLog}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
            >
              <Plus size={18} />
              <span>新建日志</span>
            </button>
            <button
              onClick={handleNoInspection}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
            >
              <FileText size={18} />
              <span>未巡店说明</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-10">
            <RefreshCw className="inline animate-spin text-primary" size={24} />
            <p className="mt-2 text-gray-500">加载中...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 border-b w-10">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={toggleSelectPage}
                      className="w-4 h-4"
                      aria-label="全选当前页"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 border-b">日期</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 border-b">督导</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 border-b">出发地</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 border-b">目的地</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 border-b">备注</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 border-b">状态</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 border-b">共享状态</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 border-b">操作</th>
                </tr>
              </thead>
              <tbody>
                {paginatedLogs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  paginatedLogs.map((log) => (
                    <tr key={log.id} className={`hover:bg-gray-50 transition-colors ${selectedIds.has(log.id!) ? 'bg-green-50' : ''}`}>
                      <td className="px-4 py-3 border-b w-10">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(log.id!)}
                          onChange={() => toggleSelect(log.id)}
                          className="w-4 h-4"
                          aria-label={`选择日志 ${log.id}`}
                        />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 border-b">
                        <div className="flex items-center gap-2">
                          <Calendar size={16} className="text-gray-400" />
                          {log.date}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 border-b">
                        <div className="flex items-center gap-2">
                          <User size={16} className="text-gray-400" />
                          {log.supervisor}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 border-b">
                        <div className="flex items-center gap-2">
                          <MapPin size={16} className="text-gray-400" />
                          {log.departure}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 border-b">
                        <div className="flex items-center gap-2">
                          <MapPin size={16} className="text-gray-400" />
                          {log.destination}
                        </div>
                      </td>
                      <td className="px-4 py-3 border-b text-sm text-gray-600 max-w-[120px] truncate" title={log.remarks || ''}>{log.remarks || '-'}</td>
                      <td className="px-4 py-3 border-b">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          log.status === 'submitted'
                            ? 'bg-green-100 text-green-800'
                            : log.status === 'voided'
                            ? 'bg-gray-100 text-gray-500'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {log.status === 'submitted' ? '已提交' : log.status === 'voided' ? '已作废' : '草稿'}
                        </span>
                      </td>
                      <td className="px-4 py-3 border-b">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          !!(log.shareToAll)
                            ? 'bg-orange-100 text-orange-800'
                            : 'bg-gray-100 text-gray-500'
                        }`}>
                          {!!(log.shareToAll) ? '已共享' : '未共享'}
                        </span>
                      </td>
                      <td className="px-4 py-3 border-b">
                        {renderActionButtons(log)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {!loading && totalPages > 1 && (
          <div className="flex justify-between items-center mt-4">
            <div className="text-sm text-gray-500">
              共 {filteredLogs.length} 条，第 {currentPage} / {totalPages} 页
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => goToPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                上一页
              </button>
              <button
                onClick={() => goToPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                下一页
              </button>
            </div>
          </div>
        )}
        </div>)}
      </div>
      <NoInspectionModal />
    </Layout>
  );
}

export default LogListPage;
