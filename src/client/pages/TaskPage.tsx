import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit2, Trash2, Check, X, RefreshCw, CheckCircle2, Circle, Play } from 'lucide-react';
import { getTasks, createTask, updateTask, deleteTask, executeTask } from '../../api/tasks';
import { getShops } from '../../api/shops';
import type { InspectionTask, Shop } from '../../types';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { useDataCacheStore } from '../../store/dataCacheStore';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';

function TaskPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { taskData, setTaskData } = useDataCacheStore();
  
  const [tasks, setTasks] = useState<InspectionTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState<InspectionTask | null>(null);
  const [hasData, setHasData] = useState(false);
  const [shops, setShops] = useState<Shop[]>([]);
  const [executingId, setExecutingId] = useState<number | null>(null);
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    selectedSupervisors: [] as string[],
    selectedShops: [] as string[],
    deadline: ''
  });

  const loadShops = async () => {
    try {
      const shopData = await getShops(user?.groupName);
      const shopsArray = Array.isArray(shopData) ? shopData : [];
      setShops(shopsArray);
    } catch (error) {
      console.error('Failed to load shops:', error);
      setShops([]);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      if (!user) {
        console.log('loadData - user is undefined');
        setTasks([]);
        setTaskData([]);
        setHasData(true);
        return;
      }
      
      const currentIsAdmin = user.isAdmin === '是';
      const currentGroupName = user.groupName;
      const currentUserCode = user.userCode || user.userName || user.name || user.realName || '';
      
      console.log('loadData - user:', JSON.stringify(user));
      console.log('loadData - currentGroupName:', currentGroupName);
      console.log('loadData - currentUserCode:', currentUserCode);
      
      const data = await getTasks(currentUserCode, currentIsAdmin, currentGroupName);
      console.log('loadData - received tasks:', JSON.stringify(data));
      console.log('loadData - task count:', data ? data.length : 0);
      
      const taskArray = Array.isArray(data) ? data : [];
      if (taskArray.length > 0) {
        setTasks(taskArray);
        setTaskData(taskArray);
        setHasData(true);
        console.log('loadData - tasks set successfully');
      } else {
        setTasks([]);
        setTaskData([]);
        setHasData(true);
        console.log('loadData - no tasks received');
      }
    } catch (error) {
      console.error('Failed to load tasks:', error);
      setTasks([]);
      setTaskData([]);
      setHasData(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // 有缓存直接用，无缓存才加载
    if (taskData) {
      setTasks(taskData);
      setHasData(true);
      // shops 仍需加载（未缓存）
      if (user) loadShops();
    } else if (user) {
      console.log('useEffect triggered, user:', user);
      loadData();
      loadShops();
    }
  }, [user]);

  // 使用 useMemo 确保权限判断响应式更新
  const isAdmin = user?.isAdmin === '是';
  const isManager = isAdmin || 
                   user?.userName === '经理XX' || 
                   user?.groupName === '管理组' ||
                   (user?.groupName && user.groupName.includes('经理')) ||
                   (user?.userName && user.userName.includes('经理'));
  const canExecute = isAdmin || isManager;
  const canEdit = isAdmin || isManager;
  const isSupervisor = !isAdmin && !isManager;

  const supervisors = useMemo(() => {
    const supervisorSet = new Set<string>();
    shops.forEach((s: any) => {
      const supervisor = s.supervisor || s['督导'] || '';
      if (supervisor) supervisorSet.add(supervisor);
    });
    return Array.from(supervisorSet).sort();
  }, [shops]);

  const filteredShops = useMemo(() => {
    if (formData.selectedSupervisors.length === 0) {
      return shops;
    }
    return shops.filter((s: any) => formData.selectedSupervisors.includes(s.supervisor || s['督导'] || ''));
  }, [shops, formData.selectedSupervisors]);

  // 区域查找映射: shopName -> area
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
  const taskFilter = useAreaSupervisorShopFilter<InspectionTask>(tasks, {
    getArea: (t) => {
      const firstShop = t.shopNames?.[0];
      return firstShop ? shopAreaMap.get(firstShop) : undefined;
    },
    getSupervisor: (t) => t.assignedTo ? t.assignedTo.split(',').map(s => s.trim()).filter(Boolean) : [],
    getShopName: (t) => t.shopNames || [],
    getWarehouseType: (item: any) => (item.warehouseType) || ((item.shopName || item.destination || item.shopNames || '').toString().endsWith('_JM') ? '加盟' : (item.shopName || item.destination || item.shopNames || '').toString().endsWith('_ZY') ? '直营' : ''),
  });

  const filteredTasks = taskFilter.filteredData.filter(task => {
    // 后端已经处理了权限过滤，前端只需要根据状态过滤
    if (filterStatus === 'all') return true;
    const statusMap: Record<string, InspectionTask['status']> = {
      pending: 'pending',
      inProgress: 'in_progress',
      completed: 'completed'
    };
    return task.status === statusMap[filterStatus];
  });

  const handleExecute = async (task: InspectionTask) => {
    if (!task.id || !canExecute) return;
    if (!window.confirm('巡店任务一经执行不能删除，您是否确定执行巡店任务？')) return;
    
    try {
      setExecutingId(task.id);
      await executeTask(task.id);
      await loadData();
    } catch (error) {
      console.error('Failed to execute task:', error);
    } finally {
      setExecutingId(null);
    }
  };

  const handleTaskClick = (task: InspectionTask) => {
    console.log('点击任务:', task);
    console.log('任务ID:', task.id);
    navigate(`/tasks/${task.id}`);
  };

  const handleSubmit = async () => {
    if (!formData.title.trim() || formData.selectedSupervisors.length === 0 || formData.selectedShops.length === 0) {
      return;
    }
    
    try {
      if (editingTask) {
        await updateTask(String(editingTask.id), {
          ...formData,
          assignedTo: formData.selectedSupervisors.join(','),
          shops: formData.selectedShops,
          shopNames: formData.selectedShops
        });
      } else {
        await createTask({ 
          title: formData.title,
          description: formData.description,
          assignedTo: formData.selectedSupervisors.join(','),
          assignedToName: formData.selectedSupervisors.join(','),
          shops: formData.selectedShops,
          shopNames: formData.selectedShops,
          deadline: formData.deadline,
          status: 'pending',
          createdBy: user?.userCode,
          createdByName: user?.userName || user?.realName || user?.name
        });
      }
      await loadData();
      setShowModal(false);
      setEditingTask(null);
      setFormData({ title: '', description: '', selectedSupervisors: [], selectedShops: [], deadline: '' });
    } catch (error) {
      console.error('Failed to save task:', error);
    }
  };

  const toggleSupervisor = (supervisor: string) => {
    setFormData(prev => ({
      ...prev,
      selectedSupervisors: prev.selectedSupervisors.includes(supervisor)
        ? prev.selectedSupervisors.filter(s => s !== supervisor)
        : [...prev.selectedSupervisors, supervisor]
    }));
  };

  const toggleShop = (shopName: string) => {
    setFormData(prev => ({
      ...prev,
      selectedShops: prev.selectedShops.includes(shopName)
        ? prev.selectedShops.filter(s => s !== shopName)
        : [...prev.selectedShops, shopName]
    }));
  };

  const handleDelete = async (id: number | undefined) => {
    if (!id || !window.confirm('确定要删除这个任务吗？')) return;
    
    try {
      await deleteTask(id);
      await loadData();
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  const handleEdit = (task: InspectionTask) => {
    setEditingTask(task);
    setFormData({
      title: task.title,
      description: task.description || '',
      selectedSupervisors: task.assignedTo ? task.assignedTo.split(',') : [],
      selectedShops: task.shopNames || [],
      deadline: task.deadline || ''
    });
    setShowModal(true);
  };

  const handleStatusChange = async (task: InspectionTask, newStatus: InspectionTask['status']) => {
    try {
      await updateTask(String(task.id), { ...task, status: newStatus });
      await loadData();
    } catch (error) {
      console.error('Failed to update task status:', error);
    }
  };

  const uncompletedCount = filteredTasks.filter(t => t.status !== 'completed').length;

  return (
    <Layout title="巡店任务" subtitle="查看和管理巡店任务">
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
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !hasData ? (
          <div className="flex flex-col items-center justify-center min-h-[400px]">
            <p className="text-xl text-gray-500 mb-4">请刷新数据</p>
          </div>
        ) : (
          <div className="w-full">
            {(isAdmin || isManager) && (
              <div className="flex justify-end mb-6 px-6">
                <button
                  onClick={() => {
                    setEditingTask(null);
                    setFormData({ title: '', description: '', selectedSupervisors: [], selectedShops: [], deadline: '' });
                    setShowModal(true);
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
                >
                  <Plus size={18} />
                  <span>新建任务</span>
                </button>
              </div>
            )}

            <div className="bg-white rounded-xl shadow-sm mx-6 overflow-hidden">
              <div className="flex items-center gap-4 px-6 py-4 border-b border-gray-100 flex-wrap">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setFilterStatus('all')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filterStatus === 'all' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    全部
                  </button>
                  <button
                    onClick={() => setFilterStatus('pending')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filterStatus === 'pending' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    待处理
                  </button>
                  <button
                    onClick={() => setFilterStatus('inProgress')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filterStatus === 'inProgress' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    进行中
                  </button>
                  <button
                    onClick={() => setFilterStatus('completed')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filterStatus === 'completed' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    已完成
                  </button>
                </div>
                <div className="h-6 w-px bg-gray-200" />
                <AreaSupervisorShopFilter filter={taskFilter} />
              </div>

              <div className="divide-y divide-gray-100">
                {filteredTasks.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-400">暂无巡店任务</p>
                  </div>
                ) : (
                  filteredTasks.map(task => (
                    <div 
                      key={task.id} 
                      className="px-6 py-4 hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => handleTaskClick(task)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <h3 className="font-medium text-gray-800">{task.title}</h3>
                            <span className="text-xs text-gray-400">(ID: {task.id})</span>
                            <span className={`px-2 py-1 text-xs rounded-full ${
                              task.status === 'pending' ? 'bg-yellow-100 text-yellow-600' :
                              task.status === 'in_progress' ? 'bg-blue-100 text-blue-600' :
                              'bg-green-100 text-green-600'
                            }`}>
                              {task.status === 'pending' ? '待处理' :
                               task.status === 'in_progress' ? '进行中' : '已完成'}
                            </span>
                          </div>
                          {task.description && (
                            <p className="text-sm text-gray-500 mt-1">{task.description}</p>
                          )}
                          {task.shopNames && task.shopNames.length > 0 && (
                            <p className="text-xs text-gray-400 mt-1">
                              巡店店铺: {task.shopNames.slice(0, 3).join(', ')}{task.shopNames.length > 3 ? `...等${task.shopNames.length}家店铺` : ''}
                            </p>
                          )}
                          <div className="flex items-center gap-4 mt-2 text-sm text-gray-400">
                            {task.assignedTo && <span>负责人: {task.assignedTo}</span>}
                            {task.deadline && <span>截止日期: {task.deadline}</span>}
                            <span>创建时间: {task.createdAt ? new Date(task.createdAt).toLocaleString() : ''}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {task.status === 'pending' && canExecute && (
                            <div className="flex flex-col items-center">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleExecute(task); }}
                                disabled={executingId === task.id}
                                className="p-2 rounded-lg bg-orange-100 hover:bg-orange-200 transition-colors disabled:opacity-50"
                                title="执行任务"
                              >
                                <Play size={18} className="text-orange-600" />
                              </button>
                              <span className="text-xs text-gray-500 mt-1">执行</span>
                            </div>
                          )}
                          {task.status === 'pending' && canEdit && (
                            <div className="flex flex-col items-center">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleEdit(task); }}
                                className="p-2 rounded-lg bg-blue-100 hover:bg-blue-200 transition-colors"
                                title="编辑"
                              >
                                <Edit2 size={18} className="text-blue-600" />
                              </button>
                              <span className="text-xs text-gray-500 mt-1">编辑</span>
                            </div>
                          )}
                          {task.status === 'pending' && canEdit && (
                            <div className="flex flex-col items-center">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(task.id); }}
                                className="p-2 rounded-lg bg-red-100 hover:bg-red-200 transition-colors"
                                title="删除"
                              >
                                <Trash2 size={18} className="text-red-600" />
                              </button>
                              <span className="text-xs text-gray-500 mt-1">删除</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-800">
                  {editingTask ? '编辑巡店任务' : '新建巡店任务'}
                </h2>
                <button
                  onClick={() => {
                    setShowModal(false);
                    setEditingTask(null);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X size={20} className="text-gray-500" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">任务标题 *</label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
                    placeholder="请输入任务标题"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">任务描述</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none resize-none"
                    placeholder="请输入任务描述"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">截止日期</label>
                  <input
                    type="date"
                    value={formData.deadline}
                    onChange={(e) => setFormData(prev => ({ ...prev, deadline: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">督导（多选）</label>
                  <div className="flex flex-wrap gap-2">
                    {supervisors.map(supervisor => (
                      <button
                        key={supervisor}
                        onClick={() => toggleSupervisor(supervisor)}
                        className={`px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1.5 ${
                          formData.selectedSupervisors.includes(supervisor)
                            ? 'bg-primary text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {formData.selectedSupervisors.includes(supervisor) ? (
                          <CheckCircle2 size={14} />
                        ) : (
                          <Circle size={14} />
                        )}
                        {supervisor}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">门店（多选）{formData.selectedSupervisors.length > 0 && <span className="text-gray-400 text-xs">(已筛选)</span>}</label>
                  <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                    {filteredShops.map((shop: any) => {
                      const shopName = shop.shopName || shop['店铺名称'] || shop.storeName || `店铺${filteredShops.indexOf(shop) + 1}`;
                      return (
                        <button
                          key={shopName}
                          onClick={() => toggleShop(shopName)}
                          className={`px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1.5 ${
                            formData.selectedShops.includes(shopName)
                              ? 'bg-primary text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {formData.selectedShops.includes(shopName) ? (
                            <CheckCircle2 size={14} />
                          ) : (
                            <Circle size={14} />
                          )}
                          {shopName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-4 mt-6">
                <button
                  onClick={() => {
                    setShowModal(false);
                    setEditingTask(null);
                  }}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSubmit}
                  className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
                >
                  {editingTask ? '保存修改' : '创建任务'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default TaskPage;