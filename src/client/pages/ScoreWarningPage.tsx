import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ScanSearch, ClipboardCheck, AlertTriangle, CheckCircle2, MessageSquare } from 'lucide-react';

function ScoreWarningPage() {
  const navigate = useNavigate();

  const menuItems = [
    { icon: ScanSearch, label: '店铺检测', desc: '店铺检测', path: '/score-warning/check' },
    { icon: ClipboardCheck, label: '店铺检查打分表', desc: '店铺检查打分表', path: '/score-warning/score-table' },
    { icon: AlertTriangle, label: '店铺预警表', desc: '店铺预警表', path: '/score-warning/warning-table' },
    { icon: CheckCircle2, label: '店铺整改确认', desc: '店铺整改确认', path: '/score-warning/rectification' },
    { icon: MessageSquare, label: '店铺意见建议', desc: '店铺意见建议', path: '/score-warning/suggestion' },
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
              <h1 className="text-2xl font-bold text-amber-600">店铺评分预警</h1>
              <p className="text-gray-500 mt-1">店铺评分与预警专项功能</p>
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
              className="flex flex-col items-center justify-center p-8 bg-white rounded-xl shadow-md hover:shadow-lg transition-all duration-200 transform hover:-translate-y-1 text-gray-700 hover:text-amber-600"
            >
              <div className="p-4 rounded-full bg-amber-50 mb-4">
                <item.icon className="w-8 h-8 text-amber-600" />
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

export default ScoreWarningPage;