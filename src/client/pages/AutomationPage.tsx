import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles, GitMerge, Table, Package, Boxes, Truck } from 'lucide-react';
import Layout from '../components/Layout';

function AutomationPage() {
  const navigate = useNavigate();

  return (
    <Layout title="自动化管理" subtitle="智能自动化运营工具">
      <div className="min-h-[600px]">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div className="col-span-full p-8 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-2xl shadow-lg">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center">
                <Sparkles className="w-7 h-7 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">欢迎使用自动化管理</h2>
                <p className="text-white/80 text-sm mt-1">智能化的店铺运营工具，让管理更高效</p>
              </div>
            </div>
            <p className="text-white/90 text-sm leading-relaxed mb-4">
              在左侧菜单中选择需要使用的功能：自动补货、自动分货、自动并货、初始并货表，点击即可进入对应功能页面。
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/automation/merge')}
                className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <GitMerge size={16} /> 进入自动并货
              </button>
              <button
                onClick={() => navigate('/automation/initial')}
                className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Table size={16} /> 初始并货表
              </button>
              <button
                onClick={() => navigate('/automation/online-merge')}
                className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Truck size={16} /> 线上并货
              </button>
            </div>
          </div>

          <div className="p-6 bg-white rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center">
                <GitMerge className="w-5 h-5 text-violet-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-800">自动并货</h3>
            </div>
            <p className="text-sm text-gray-600 mb-3 leading-relaxed">按店铺汇总销售数据进行并货，生成并货报表</p>
            <button
              onClick={() => navigate('/automation/merge')}
              className="text-sm text-violet-600 font-medium hover:text-violet-700"
            >
              进入 →
            </button>
          </div>

          <div className="p-6 bg-white rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-pink-50 rounded-xl flex items-center justify-center">
                <Table className="w-5 h-5 text-pink-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-800">初始并货表</h3>
            </div>
            <p className="text-sm text-gray-600 mb-3 leading-relaxed">配置并货所需的店铺及销售基础数据</p>
            <button
              onClick={() => navigate('/automation/initial')}
              className="text-sm text-pink-600 font-medium hover:text-pink-700"
            >
              进入 →
            </button>
          </div>

          <div className="p-6 bg-white rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                <Truck className="w-5 h-5 text-indigo-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-800">线上并货</h3>
            </div>
            <p className="text-sm text-gray-600 mb-3 leading-relaxed">页面直接创建店铺间调拨，生成调拨明细表</p>
            <button
              onClick={() => navigate('/automation/online-merge')}
              className="text-sm text-indigo-600 font-medium hover:text-indigo-700"
            >
              进入 →
            </button>
          </div>

          <div className="p-6 bg-white rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                <Package className="w-5 h-5 text-blue-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-800">自动补货</h3>
            </div>
            <p className="text-sm text-gray-600 mb-3 leading-relaxed">总仓→门店 SKC粒度智能补货建议，支持参数配置与结果导出</p>
            <button
              onClick={() => navigate('/automation/replenish')}
              className="text-sm text-blue-600 font-medium hover:text-blue-700"
            >
              进入 →
            </button>
          </div>

          <div className="p-6 bg-gray-50 rounded-2xl border border-gray-100">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-cyan-100 rounded-xl flex items-center justify-center">
                <Boxes className="w-5 h-5 text-cyan-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-700">自动分货</h3>
              <span className="px-2 py-0.5 bg-gray-200 text-gray-600 text-xs rounded-full font-medium">开发中</span>
            </div>
            <p className="text-sm text-gray-500 leading-relaxed">基于店铺销售数据分析，智能分配库存到各店铺</p>
          </div>
        </div>

        <div className="p-6 bg-white rounded-2xl shadow-sm border border-gray-100">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <ArrowLeft className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h4 className="font-bold text-gray-800 mb-2">功能说明</h4>
              <ul className="space-y-1 text-sm text-gray-600">
                <li>• <span className="font-medium text-gray-800">左侧菜单</span>：当前显示的是自动化管理的功能菜单，可直接点击进入对应页面</li>
                <li>• <span className="font-medium text-gray-800">返回首页</span>：点击左侧"系统门户"可返回首页门户</li>
                <li>• <span className="font-medium text-gray-800">自动补货</span>：总仓→门店智能补货建议，支持参数配置、款色管理与结果导出</li>
                <li>• <span className="font-medium text-gray-800">自动分货</span>：基于店铺销售数据智能分配库存（开发中）</li>
                <li>• <span className="font-medium text-gray-800">自动并货</span>：按店铺汇总销售数据进行并货</li>
                <li>• <span className="font-medium text-gray-800">初始并货表</span>：配置并货所需的店铺及销售基础数据</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default AutomationPage;
