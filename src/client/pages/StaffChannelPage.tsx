import { useNavigate } from 'react-router-dom';
import { ClipboardList, ArrowLeft, Users } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import Layout from '../components/Layout';

function StaffChannelPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  return (
    <Layout title="培训反馈" subtitle="全员通道">
      <div className="mb-6 flex items-center gap-2">
        <button onClick={() => navigate('/')}
          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white rounded-lg border border-gray-200 hover:bg-gray-50">
          <ArrowLeft size={16} /> 返回首页
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 mb-6">
        <div className="group p-8 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl shadow-lg hover:shadow-2xl transition transform hover:-translate-y-1 cursor-pointer"
          onClick={() => navigate('/staff-channel/details')}>
          <div className="flex items-center justify-between mb-6">
            <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center">
              <ClipboardList className="w-8 h-8 text-white" />
            </div>
            <span className="flex items-center gap-1 px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full text-xs text-white font-medium">
              <Users size={12} /> 全员可见
            </span>
          </div>
          <h3 className="text-2xl font-bold text-white mb-2">反馈明细表</h3>
          <p className="text-white/80 text-sm leading-relaxed">查看所有反馈记录，点击"我要反馈"填写并签字提交</p>
        </div>
      </div>

      <div className="mt-6 p-6 bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
            <Users className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h4 className="font-bold text-gray-800 mb-2">使用说明</h4>
            <ul className="space-y-1 text-sm text-gray-600">
              <li>• <span className="font-medium text-gray-800">执行任务单</span>：系统生成默认反馈表并对外开放</li>
              <li>• <span className="font-medium text-gray-800">用户提交</span>：在"反馈明细表"中点击"我要反馈"填写并签字提交</li>
              <li>• <span className="font-medium text-gray-800">当前登录</span>：{user?.userName || '未知用户'}</li>
            </ul>
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default StaffChannelPage;
