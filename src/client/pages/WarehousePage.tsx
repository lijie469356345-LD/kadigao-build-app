import { useNavigate } from 'react-router-dom';
import { ArrowLeft, PackageCheck } from 'lucide-react';

function WarehousePage() {
  const navigate = useNavigate();

  const menuItems = [
    { icon: PackageCheck, label: '仓库扫码入库', desc: '扫码查询订单并入库', path: '/warehouse/scan' },
  ];

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/')} className="flex items-center gap-2 text-gray-600 hover:text-gray-800 transition-colors">
              <ArrowLeft className="w-5 h-5" /><span>返回门户</span>
            </button>
            <div className="h-6 w-px bg-gray-200" />
            <div>
              <h1 className="text-2xl font-bold text-blue-600">仓库管理</h1>
              <p className="text-gray-500 mt-1">仓库管理专项功能</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          {menuItems.map(item => (
            <button
              key={item.label}
              onClick={() => navigate(item.path)}
              className="flex flex-col items-center justify-center p-8 bg-white rounded-xl shadow-md hover:shadow-lg transition-all duration-200 transform hover:-translate-y-1 text-gray-700 hover:text-blue-600"
            >
              <div className="p-4 rounded-full bg-blue-50 mb-4">
                <item.icon className="w-8 h-8 text-blue-600" />
              </div>
              <span className="font-semibold text-lg">{item.label}</span>
              {item.desc && <span className="text-xs text-gray-400 mt-2">{item.desc}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default WarehousePage;