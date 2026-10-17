import { useNavigate } from 'react-router-dom';
import { BarChart3, TrendingUp, ArrowLeft, Target, PieChart, Database, LayoutDashboard, Gauge } from 'lucide-react';
import { FileText } from 'lucide-react';

function SalesPage() {
  const navigate = useNavigate();

  const menuItems = [
    { icon: Gauge, label: '业绩看板', path: '/performance-dashboard' },
    { icon: BarChart3, label: '销售报表', path: '/reports' },
    { icon: Target, label: '店员销售指标', path: '/staff-sales-target' },
    { icon: PieChart, label: '月目标分解', path: '/monthly-target-decomposition' },
    { icon: PieChart, label: '月目标分解店员', path: '/staff-monthly-target' },
    { icon: TrendingUp, label: '店铺诊断', path: '/shop-diagnosis' },
    { icon: FileText, label: '财务字段', path: '/finance-field' },
    { icon: LayoutDashboard, label: '年度经营看板', path: '/annual-operation-dashboard' },
  ];

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/')}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-800 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                <span>返回门户</span>
              </button>
              <div className="h-6 w-px bg-gray-200" />
              <div>
                <h1 className="text-2xl font-bold text-purple-600">销售管理</h1>
                <p className="text-gray-500 mt-1">管理销售数据与店铺诊断</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {menuItems.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="flex flex-col items-center justify-center p-8 bg-white rounded-xl shadow-md hover:shadow-lg transition-all duration-200 transform hover:-translate-y-1 text-gray-700 hover:text-purple-600"
            >
              <div className="p-4 rounded-full bg-purple-50 mb-4">
                <item.icon className="w-8 h-8 text-purple-600" />
              </div>
              <span className="font-semibold text-lg">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default SalesPage;
