import { useEffect, useState } from 'react';
import { Settings, AlertCircle, RefreshCw, Server } from 'lucide-react';
import { getMaintenanceStatus, toggleMaintenance } from '../../api/logs';
import { useAuthStore } from '../../store/authStore';
import Layout from '../components/Layout';

function MaintenancePage() {
  const [status, setStatus] = useState({
    isMaintenance: false,
    message: '',
    estimatedTime: '',
  });
  const [loading, setLoading] = useState(true);
  const { user } = useAuthStore();

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    try {
      setLoading(true);
      const res = await getMaintenanceStatus();
      setStatus(res);
    } catch (error) {
      console.error('Failed to check maintenance status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async () => {
    try {
      const res = await toggleMaintenance();
      setStatus(res);
    } catch (error) {
      console.error('Failed to toggle maintenance:', error);
    }
  };

  if (loading) {
    return (
      <Layout title="系统维护">
        <div className="flex items-center justify-center min-h-[400px]">
          <RefreshCw className="w-8 h-8 text-primary animate-spin" />
        </div>
      </Layout>
    );
  }

  const isAdmin = user?.isAdmin || false;

  return (
    <Layout title="系统维护" subtitle="管理系统维护状态">
      <div className="max-w-6xl mx-auto">
        <div className={`bg-white rounded-xl shadow-sm p-8 text-center ${
          status.isMaintenance ? 'border-red-200' : 'border-green-200'
        }`}>
          <div className={`w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center ${
            status.isMaintenance ? 'bg-red-100' : 'bg-green-100'
          }`}>
            {status.isMaintenance ? (
              <AlertCircle className="w-10 h-10 text-red-500" />
            ) : (
              <Server className="w-10 h-10 text-green-500" />
            )}
          </div>
          <h2 className={`text-2xl font-bold mb-2 ${
            status.isMaintenance ? 'text-red-600' : 'text-green-600'
          }`}>
            {status.isMaintenance ? '系统维护中' : '系统正常运行'}
          </h2>
          <p className="text-gray-500 mb-6">{status.message}</p>
          
          {status.isMaintenance && (
            <p className="text-sm text-gray-400 mb-6">
              预计维护时间: {status.estimatedTime}
            </p>
          )}

          {isAdmin && (
            <button
              onClick={handleToggle}
              className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                status.isMaintenance
                  ? 'bg-green-500 hover:bg-green-600 text-white'
                  : 'bg-red-500 hover:bg-red-600 text-white'
              }`}
            >
              {status.isMaintenance ? '结束维护' : '开始维护'}
            </button>
          )}

          {!isAdmin && status.isMaintenance && (
            <button
              onClick={checkStatus}
              className="flex items-center gap-2 mx-auto px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors"
            >
              <RefreshCw size={18} />
              <span>刷新重试</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4 mt-6">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="text-sm font-medium text-gray-500 mb-2">系统状态</h3>
            <p className={`text-xl font-bold ${
              status.isMaintenance ? 'text-red-500' : 'text-green-500'
            }`}>
              {status.isMaintenance ? '维护中' : '运行中'}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="text-sm font-medium text-gray-500 mb-2">用户状态</h3>
            <p className="text-xl font-bold text-gray-800">
              {isAdmin ? '管理员' : '普通用户'}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="text-sm font-medium text-gray-500 mb-2">维护时间</h3>
            <p className="text-xl font-bold text-gray-800">{status.estimatedTime || '未设置'}</p>
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default MaintenancePage;
