import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Gift, Star, Footprints } from 'lucide-react';

function DouyinPage() {
  const navigate = useNavigate();

  const menuItems = [
    { icon: Gift, label: '福袋', desc: '福袋活动管理', path: '/douyin/fudai' },
    { icon: Star, label: '好评会员', desc: '好评会员管理', path: '/douyin/haoping' },
    { icon: Footprints, label: '袜子转化', desc: '袜子转化分析', path: '/douyin/wazi' },
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
              <h1 className="text-2xl font-bold text-rose-600">抖音专区</h1>
              <p className="text-gray-500 mt-1">抖音运营专项功能</p>
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
              className="flex flex-col items-center justify-center p-8 bg-white rounded-xl shadow-md hover:shadow-lg transition-all duration-200 transform hover:-translate-y-1 text-gray-700 hover:text-rose-600"
            >
              <div className="p-4 rounded-full bg-rose-50 mb-4">
                <item.icon className="w-8 h-8 text-rose-600" />
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

export default DouyinPage;
