import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Boxes, Clock } from 'lucide-react';
import Layout from '../components/Layout';

function AutoDistributePage() {
  const navigate = useNavigate();

  return (
    <Layout title="自动分货" subtitle="智能分货分配系统">
      <div className="mb-6 flex items-center gap-2">
        <button
          onClick={() => navigate('/automation')}
          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white rounded-lg border border-gray-200 hover:bg-gray-50"
        >
          <ArrowLeft size={16} /> 返回自动化管理
        </button>
      </div>

      <div className="min-h-[400px] bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center p-12">
        <div className="w-24 h-24 bg-cyan-50 rounded-full flex items-center justify-center mb-6">
          <Clock className="w-12 h-12 text-cyan-500" />
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">敬请期待</h2>
        <p className="text-gray-500 text-center max-w-md mb-6">
          自动分货功能正在紧张开发中，敬请期待。我们将为您提供基于销售数据的智能分货方案。
        </p>
        <div className="flex items-center gap-2 px-4 py-2 bg-cyan-50 text-cyan-700 rounded-full text-sm font-medium">
          <Boxes size={16} /> 开发中
        </div>
      </div>
    </Layout>
  );
}

export default AutoDistributePage;
