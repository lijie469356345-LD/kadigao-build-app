import { useEffect, useState } from 'react';
import { ArrowLeft, Calendar, User, Store, Clock, CheckCircle2, Circle, PlayCircle, AlertCircle } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { getTaskById } from '../../api/tasks';
import type { InspectionTask } from '../../types';
import Layout from '../components/Layout';

function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<InspectionTask | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      navigate('/tasks');
      return;
    }
    
    loadTask();
  }, [id, navigate]);

  const loadTask = async () => {
    try {
      setLoading(true);
      const data = await getTaskById(id!);
      setTask(data);
    } catch (error) {
      console.error('Failed to load task:', error);
      alert('加载任务失败');
    } finally {
      setLoading(false);
    }
  };

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'pending':
        return { label: '待处理', color: 'bg-yellow-100 text-yellow-600', icon: Circle };
      case 'in_progress':
        return { label: '进行中', color: 'bg-blue-100 text-blue-600', icon: PlayCircle };
      case 'completed':
        return { label: '已完成', color: 'bg-green-100 text-green-600', icon: CheckCircle2 };
      default:
        return { label: status, color: 'bg-gray-100 text-gray-600', icon: AlertCircle };
    }
  };

  if (loading) {
    return (
      <Layout title="巡店任务详情">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!task) {
    return (
      <Layout title="巡店任务详情">
        <div className="flex flex-col items-center justify-center min-h-[400px]">
          <AlertCircle size={48} className="text-gray-400 mb-4" />
          <p className="text-gray-500">任务不存在</p>
          <button
            onClick={() => navigate('/tasks')}
            className="mt-4 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
          >
            返回任务列表
          </button>
        </div>
      </Layout>
    );
  }

  const statusInfo = getStatusInfo(task.status);
  const StatusIcon = statusInfo.icon;

  return (
    <Layout title="巡店任务详情">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <button
          onClick={() => navigate('/tasks')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-6 transition-colors"
        >
          <ArrowLeft size={20} />
          <span>返回任务列表</span>
        </button>

        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-primary to-primary-dark px-6 py-8">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-white mb-2">{task.title}</h1>
                <p className="text-white/80 text-sm">任务编号: {task.id}</p>
              </div>
              <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium ${statusInfo.color}`}>
                <StatusIcon size={18} />
                {statusInfo.label}
              </span>
            </div>
          </div>

          <div className="divide-y divide-gray-100">
            <div className="px-6 py-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">任务信息</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-blue-50 rounded-lg">
                    <User size={24} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1">创建人</p>
                    <p className="font-medium text-gray-800">{task.createdByName || '未知'}</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-green-50 rounded-lg">
                    <User size={24} className="text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1">负责人</p>
                    <p className="font-medium text-gray-800">{task.assignedToName || task.assignedTo || '未分配'}</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-orange-50 rounded-lg">
                    <Clock size={24} className="text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1">截止日期</p>
                    <p className="font-medium text-gray-800">{task.deadline || '未设置'}</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-purple-50 rounded-lg">
                    <Calendar size={24} className="text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1">创建时间</p>
                    <p className="font-medium text-gray-800">{String(task.createdAt || '未知')}</p>
                  </div>
                </div>
              </div>
            </div>

            {task.description && (
              <div className="px-6 py-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">任务描述</h2>
                <p className="text-gray-600 bg-gray-50 rounded-lg p-4">{task.description}</p>
              </div>
            )}

            {task.shopNames && task.shopNames.length > 0 && (
              <div className="px-6 py-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">巡店店铺</h2>
                <div className="flex flex-wrap gap-2">
                  {task.shopNames.map((shop, index) => (
                    <div key={index} className="flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-lg">
                      <Store size={16} className="text-primary" />
                      <span className="text-gray-700">{shop}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-sm text-gray-500">共 {task.shopNames.length} 家店铺</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-center">
          <button
            onClick={() => navigate('/tasks')}
            className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
          >
            返回任务列表
          </button>
        </div>
      </div>
    </Layout>
  );
}

export default TaskDetailPage;
