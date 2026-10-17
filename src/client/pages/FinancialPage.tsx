import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart3, Wallet, Percent, TrendingUp, Users, PackageX } from 'lucide-react';

function FinancialPage() {
  const navigate = useNavigate();

  const menuItems = [
    { icon: BarChart3, label: '营收利润分析', desc: '营收与利润分析', path: '/financial/revenue-profit' },
    { icon: Wallet, label: '店铺费用分析', desc: '店铺费用分析', path: '/financial/store-cost' },
    { icon: Percent, label: '租售比分析', desc: '租售比分析', path: '/financial/rent-ratio' },
    { icon: TrendingUp, label: '投入产出分析', desc: '投入产出分析', path: '/financial/input-output' },
    { icon: Users, label: '工资分析', desc: '工资分析', path: '/financial/salary' },
    { icon: PackageX, label: '无成本价商品', desc: '无成本价商品清单', path: '/financial/no-cost-price-product' },
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
              <h1 className="text-2xl font-bold text-emerald-600">财务年度评估</h1>
              <p className="text-gray-500 mt-1">财务年度评估专项功能</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          {menuItems.map((item) => (
            <button
              key={item.label}
              onClick={() => navigate(item.path)}
              className="flex flex-col items-center justify-center p-8 bg-white rounded-xl shadow-md hover:shadow-lg transition-all duration-200 transform hover:-translate-y-1 text-gray-700 hover:text-emerald-600"
            >
              <div className="p-4 rounded-full bg-emerald-50 mb-4">
                <item.icon className="w-8 h-8 text-emerald-600" />
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

export default FinancialPage;