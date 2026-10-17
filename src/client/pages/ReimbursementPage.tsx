import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LayoutDashboard, FileText, Workflow, BarChart3, Wallet, TrendingDown, Banknote, CreditCard, BookOpen, Settings } from 'lucide-react';

function ReimbursementPage() {
  const navigate = useNavigate();

  const menuItems = [
    { icon: LayoutDashboard, label: '报销申请', desc: '报销申请与待办总览', path: '/reimbursement/home' },
    { icon: Wallet, label: '借款申请', desc: '借款申请与审批管理', path: '/reimbursement/expense-application' },
    { icon: CreditCard, label: '预付款申请', desc: '预付款申请与审批管理', path: '/reimbursement/advance-payment' },
    { icon: Banknote, label: '付款记录', desc: '出纳付款记录与凭证生成', path: '/reimbursement/payment-record' },
    { icon: TrendingDown, label: '预算管控', desc: '部门/项目预算设置与余额', path: '/reimbursement/budget' },
    { icon: FileText, label: '凭证记录', desc: '费用凭证录入与查询', path: '/reimbursement/voucher' },
    { icon: Workflow, label: '审批流设计', desc: '审批流程配置与管理', path: '/reimbursement/approval' },
    { icon: BarChart3, label: '费用报表', desc: '费用统计与分析报表', path: '/reimbursement/report' },
    { icon: TrendingDown, label: '欠款查询', desc: '预支欠款与报销冲抵统计', path: '/reimbursement/debt-query' },
    { icon: BookOpen, label: '账簿查询', desc: '银行卡付款明细与汇总', path: '/reimbursement/ledger-query' },
    { icon: Settings, label: '账簿管理', desc: '银行账户与现金账簿管理', path: '/reimbursement/ledger-manage' },
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
              <h1 className="text-2xl font-bold text-lime-600">费用报销</h1>
              <p className="text-gray-500 mt-1">费用报销管理专项功能</p>
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
              className="flex flex-col items-center justify-center p-8 bg-white rounded-xl shadow-md hover:shadow-lg transition-all duration-200 transform hover:-translate-y-1 text-gray-700 hover:text-lime-600"
            >
              <div className="p-4 rounded-full bg-lime-50 mb-4">
                <item.icon className="w-8 h-8 text-lime-600" />
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

export default ReimbursementPage;
