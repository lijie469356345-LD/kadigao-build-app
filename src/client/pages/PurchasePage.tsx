import Layout from '../components/Layout';
import { useNavigate } from 'react-router-dom';
import { FileText, BarChart3, Users, Store, ShoppingCart, Target, TrendingUp } from 'lucide-react';

interface PurchaseCard {
  title: string;
  desc: string;
  path?: string;
  icon: React.ReactNode;
}

function PurchasePage() {
  const navigate = useNavigate();

  const cards: PurchaseCard[] = [
    { title: '往期订单', desc: '查看和管理历史采购订单记录', path: '/purchase/previous-orders', icon: <FileText className="w-5 h-5" /> },
    { title: '往期销售', desc: '分析历史销售数据和趋势', path: '/purchase/previous-sales', icon: <BarChart3 className="w-5 h-5" /> },
    { title: '商品利润评估', desc: '评估商品利润表现和盈利能力', path: '/purchase/profit-evaluation', icon: <Target className="w-5 h-5" /> },
    { title: '供应商评估', desc: '对供应商进行综合评估和评级', path: '/purchase/supplier-evaluation', icon: <Users className="w-5 h-5" /> },
    { title: '建议配码', desc: '根据数据分析生成配码建议', path: '/purchase/suggested-code', icon: <Store className="w-5 h-5" /> },
    { title: '商品部计划', desc: '管理商品部工作计划和目标', path: '/purchase/merchandise-plan', icon: <ShoppingCart className="w-5 h-5" /> },
    { title: '畅销款排行', desc: '畅销款排行榜数据查看与分析', path: '/best-seller', icon: <TrendingUp className='w-5 h-5' /> },
    { title: '季度销售评估', desc: '季度销售业绩评估和分析', path: '/purchase/quarterly-evaluation', icon: <BarChart3 className="w-5 h-5" /> },
  ];

  return (
    <Layout title="采购管理" subtitle="采购相关业务管理">
      <div className="w-full">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">采购管理模块</h2>
          <p className="text-gray-600 mb-6">
            采购管理模块包含往期订单、往期销售、商品利润评估、供应商评估、建议配码、商品部计划、季度销售评估等功能。
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {cards.map((card) => (
              <div
                key={card.title}
                onClick={() => card.path && navigate(card.path)}
                className={`p-5 border rounded-lg bg-cyan-50 transition-all ${
                  card.path ? 'cursor-pointer hover:shadow-md hover:bg-cyan-100' : ''
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-cyan-700">{card.icon}</span>
                  <h3 className="font-semibold text-cyan-800">{card.title}</h3>
                </div>
                <p className="text-sm text-gray-600">{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default PurchasePage;
