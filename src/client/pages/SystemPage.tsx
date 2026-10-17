import { useNavigate } from 'react-router-dom';
import { Settings, Database, Braces, MessageSquare, Shield, ArrowLeft } from 'lucide-react';
import { useModuleStore } from '../../store/moduleStore';

function SystemPage() {
  const navigate = useNavigate();
  const { setModule } = useModuleStore();

  // 系统管理门户：数据库连接/数据提取/系统维护/企微推送 + 权限管理（自基础资料迁回）；
  // 组织管理、店铺档案、用户管理、注册审核、职位管理 归属 人事绩效-基础资料；陪跑店铺管理 归属 特色业务-陪跑跟进
  const menuItems = [
    { icon: Database, label: '数据库连接', path: '/database' },
    { icon: Braces, label: '数据提取', path: '/data-extraction' },
    { icon: Settings, label: '系统维护', path: '/maintenance' },
    { icon: MessageSquare, label: '企微推送', path: '/wechat-push' },
    { icon: Shield, label: '权限管理', path: '/permissions' },
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
                <h1 className="text-2xl font-bold text-blue-600">系统管理</h1>
                <p className="text-gray-500 mt-1">管理系统基础设置</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          {menuItems.map((item) => (
            <button
              key={item.path}
              onClick={() => {
                setModule('system');
                navigate(item.path);
              }}
              className="flex flex-col items-center justify-center p-8 bg-white rounded-xl shadow-md hover:shadow-lg transition-all duration-200 transform hover:-translate-y-1 text-gray-700 hover:text-blue-600"
            >
              <div className="p-4 rounded-full bg-blue-50 mb-4">
                <item.icon className="w-8 h-8 text-blue-600" />
              </div>
              <span className="font-semibold text-lg">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default SystemPage;
