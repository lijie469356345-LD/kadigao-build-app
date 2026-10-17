import { useNavigate } from 'react-router-dom';
import { BarChart3, FileText, ClipboardList, Award, ArrowLeft, ClipboardCheck } from 'lucide-react';

function InspectionPage() {
  const navigate = useNavigate();

  const menuItems = [
    { icon: BarChart3, label: '对比报表', path: '/comparison' },
    { icon: ClipboardList, label: '巡店任务', path: '/tasks' },
    { icon: FileText, label: '巡店日志', path: '/logs' },
    { icon: ClipboardCheck, label: '日志未完成统计', path: '/logs/statistics' },
    { icon: Award, label: '评分体系', path: '/scores' },
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
                <h1 className="text-2xl font-bold text-orange-600">巡店管理</h1>
                <p className="text-gray-500 mt-1">管理巡店相关功能</p>
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
              className="flex flex-col items-center justify-center p-8 bg-white rounded-xl shadow-md hover:shadow-lg transition-all duration-200 transform hover:-translate-y-1 text-gray-700 hover:text-orange-600"
            >
              <div className="p-4 rounded-full bg-orange-50 mb-4">
                <item.icon className="w-8 h-8 text-orange-600" />
              </div>
              <span className="font-semibold text-lg">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default InspectionPage;
