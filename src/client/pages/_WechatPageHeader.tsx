import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const navigate = useNavigate();
  const location = useLocation();

  // 层级返回：/wechat-push/template → /wechat-push → /system
  const getBackPath = () => {
    const path = location.pathname;
    if (path.startsWith('/wechat-push/')) {
      // 3层(/wechat-push/template) → 回2层(/wechat-push)
      return '/wechat-push';
    }
    if (path === '/wechat-push') {
      // 2层 → 回1层(/system)
      return '/system';
    }
    return '/system';
  };

  const getBackLabel = () => {
    const path = location.pathname;
    if (path.startsWith('/wechat-push/template')) return '返回推送总览';
    if (path.startsWith('/wechat-push/logs')) return '返回推送总览';
    if (path.startsWith('/wechat-push/settings')) return '返回推送总览';
    if (path.startsWith('/wechat-push/recipients')) return '返回推送总览';
    if (path === '/wechat-push') return '返回系统管理';
    return '返回';
  };

  return (
    <div className="bg-white shadow-sm border-b sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(getBackPath())}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-800 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>{getBackLabel()}</span>
            </button>
            <div className="h-6 w-px bg-gray-200" />
            <div>
              <h1 className="text-xl font-bold text-blue-600">{title}</h1>
              {subtitle && <p className="text-gray-500 text-sm mt-1">{subtitle}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
