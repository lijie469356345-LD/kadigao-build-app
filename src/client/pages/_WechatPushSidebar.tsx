import { useNavigate, useLocation } from 'react-router-dom';
import {
  Home, Settings, Database, Shield, Store, Users, Braces,
  MapPin,
  LayoutDashboard, FileText, ListChecks,
} from 'lucide-react';

// 主菜单：系统管理核心导航（与 Layout 侧边栏一致）
const MAIN_MENU = [
  { path: '/', label: '系统门户', icon: Home },
  { path: '/maintenance', label: '系统维护', icon: Settings },
  { path: '/database', label: '数据库连接', icon: Database },
  { path: '/data-extraction', label: '数据提取', icon: Braces },
  { path: '/permissions', label: '权限管理', icon: Shield },
  { path: '/shops', label: '店铺档案', icon: Store },
  { path: '/coaching-stores', label: '陪跑店铺管理', icon: MapPin },
  { path: '/users', label: '用户管理', icon: Users },
];

// 子菜单：企微推送内部导航
const SUB_MENU = [
  { path: '/wechat-push', label: '推送总览', icon: LayoutDashboard },
  { path: '/wechat-push/template', label: '消息模板生成器', icon: FileText },
  { path: '/wechat-push/recipients', label: '接收人管理', icon: Users },
  { path: '/wechat-push/logs', label: '推送总列表', icon: ListChecks },
  { path: '/wechat-push/settings', label: '系统开关与配置', icon: Settings },
];

function MenuButton({ item, active }: { item: { path: string; label: string; icon: any }; active: boolean }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(item.path)}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
        active ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-gray-600 hover:bg-gray-50'
      }`}
    >
      <item.icon size={16} />
      <span>{item.label}</span>
    </button>
  );
}

export default function WechatPushSidebar() {
  const location = useLocation();

  return (
    <aside className="w-56 shrink-0 bg-white rounded-xl shadow-sm p-3 space-y-4 self-start sticky top-24">
      <div>
        <div className="px-3 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">主菜单</div>
        <div className="space-y-1 mt-1">
          {MAIN_MENU.map(m => (
            <MenuButton key={m.path} item={m} active={location.pathname === m.path} />
          ))}
        </div>
      </div>

      <div className="border-t border-gray-100 pt-3">
        <div className="px-3 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">企微推送</div>
        <div className="space-y-1 mt-1">
          {SUB_MENU.map(m => (
            <MenuButton key={m.path} item={m} active={location.pathname === m.path} />
          ))}
        </div>
      </div>
    </aside>
  );
}
