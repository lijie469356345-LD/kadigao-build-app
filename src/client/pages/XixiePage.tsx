import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Upload, Send, CheckCircle2, BarChart3 } from 'lucide-react';

function XixiePage() {
  const navigate = useNavigate();

  const menuItems = [
    { icon: Upload, label: '洗鞋费用上传', desc: '洗鞋费用数据上传', path: '/xixie/cost' },
    { icon: Send, label: '洗鞋投放上传', desc: '洗鞋投放数据上传', path: '/xixie/invest' },
    { icon: CheckCircle2, label: '洗鞋核销上传', desc: '洗鞋核销数据上传', path: '/xixie/writeoff' },
    { icon: BarChart3, label: '洗鞋汇总报表', desc: '洗鞋汇总数据报表', path: '/xixie/summary' },
  ];

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 py-6">
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
              <h1 className="text-2xl font-bold text-sky-600">洗鞋养护专区</h1>
              <p className="text-gray-500 mt-1">洗鞋养护专项功能</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          {menuItems.map((item) => (
            <button
              key={item.label}
              onClick={() => item.path ? navigate(item.path) : alert(`${item.label} 功能正在开发中，敬请期待！`)}
              className="flex flex-col items-center justify-center p-8 bg-white rounded-xl shadow-md hover:shadow-lg transition-all duration-200 transform hover:-translate-y-1 text-gray-700 hover:text-sky-600"
            >
              <div className="p-4 rounded-full bg-sky-50 mb-4">
                <item.icon className="w-8 h-8 text-sky-600" />
              </div>
              <span className="font-semibold text-lg">{item.label}</span>
              <span className="text-xs text-gray-400 mt-2">{item.desc}</span>
              {!item.path && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full mt-2">待开发</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default XixiePage;
