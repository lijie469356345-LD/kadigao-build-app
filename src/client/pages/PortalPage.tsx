import { useNavigate } from 'react-router-dom';
import { useEffect, useState, useId } from 'react';
import { Settings, LayoutDashboard, ClipboardList, BarChart3, Trophy, Target, HelpCircle, Building2, ShoppingCart, LogOut, Key, Users, Cpu, Video, Droplets, Banknote, Gauge, Warehouse, Receipt, PackageCheck, Clock, Network, Store, MessageSquare, Sparkles, ChevronLeft, BookOpen } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useModuleStore } from '../../store/moduleStore';

interface PortalMenu {
  menuEn: string;
  menuCn: string;
  routePath: string;
}

interface PortalInfo {
  portalEn: string;
  portalCn: string;
  masterPortalEn?: string;
  masterPortalCn?: string;
  menuCount: number;
  defaultRoute: string;
  menus: PortalMenu[];
}

interface MasterPortal {
  masterPortalEn: string;
  masterPortalCn: string;
  portals: PortalInfo[];
}

// 热点门户徽标（进入主门户后的门户卡片使用）：主要是销售/巡店/PK 等高频门户
const HOT_PORTAL_ENS = ['pk', 'sales', 'inspection', 'directSales', 'growthClassroom'];
const HOT_PORTAL_NAMES: Record<string, string> = { pk: 'PK管理', sales: '销售管理', inspection: '巡店管理', directSales: '工作汇报管理', growthClassroom: '成长课堂' };
const HOT_BADGE_NAMES: Record<string, string> = { pk: '圈战', sales: '销售', inspection: '巡店', directSales: '工作汇报', growthClassroom: '成长' };

// 仅保留纯展示样式（图标/配色）映射，门户与菜单的可见性完全由后端 sys_role_menu 决定
const FLAME_STYLE = { animation: 'flame-dance 1.2s ease-in-out infinite' };
const GOLD_TEXT_STYLE = { backgroundSize: '200% 100%', animation: 'gold-flow 3s linear infinite' };
const PORTAL_BADGE_ANIMATIONS = `
@keyframes flame-dance { 0%,100% { transform: translateY(0) scale(1); } 25% { transform: translateY(-2px) scale(1.06); } 50% { transform: translateY(1px) scale(0.97); } 75% { transform: translateY(-1px) scale(1.03); } }
@keyframes gold-flow { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
@keyframes flame-flicker { 0%,100% { filter: drop-shadow(0 0 4px rgba(255,120,0,0.55)) drop-shadow(0 0 8px rgba(220,38,38,0.35)); } 50% { filter: drop-shadow(0 0 9px rgba(255,140,0,0.95)) drop-shadow(0 0 16px rgba(220,38,38,0.6)); } }
@keyframes flame-core { 0%,100% { opacity: 0.8; } 50% { opacity: 1; } }
`;
const PORTAL_UI_STYLE: Record<string, { icon: React.ReactNode; color: string; bgColor: string }> = {
  system: { icon: <Settings className="w-8 h-8" />, color: 'text-blue-600', bgColor: 'bg-blue-50 hover:bg-blue-100' },
  baseInfo: { icon: <Network className="w-8 h-8" />, color: 'text-indigo-600', bgColor: 'bg-indigo-50 hover:bg-indigo-100' },
  attendance: { icon: <Clock className="w-8 h-8" />, color: 'text-amber-600', bgColor: 'bg-amber-50 hover:bg-amber-100' },
  payroll: { icon: <Banknote className="w-8 h-8" />, color: 'text-emerald-600', bgColor: 'bg-emerald-50 hover:bg-emerald-100' },
  purchase: { icon: <ShoppingCart className="w-8 h-8" />, color: 'text-cyan-600', bgColor: 'bg-cyan-50 hover:bg-cyan-100' },
  dashboard: { icon: <LayoutDashboard className="w-8 h-8" />, color: 'text-green-600', bgColor: 'bg-green-50 hover:bg-green-100' },
  inspection: { icon: <ClipboardList className="w-8 h-8" />, color: 'text-orange-600', bgColor: 'bg-orange-50 hover:bg-orange-100' },
  sales: { icon: <BarChart3 className="w-8 h-8" />, color: 'text-purple-600', bgColor: 'bg-purple-50 hover:bg-purple-100' },
  staffChannel: { icon: <Users className="w-8 h-8" />, color: 'text-emerald-600', bgColor: 'bg-emerald-50 hover:bg-emerald-100' },
  automation: { icon: <Cpu className="w-8 h-8" />, color: 'text-indigo-600', bgColor: 'bg-indigo-50 hover:bg-indigo-100' },
  directSales: { icon: <BarChart3 className="w-8 h-8" />, color: 'text-teal-600', bgColor: 'bg-teal-50 hover:bg-teal-100' },
  coaching: { icon: <Target className="w-8 h-8" />, color: 'text-pink-600', bgColor: 'bg-pink-50 hover:bg-pink-100' },
  douyin: { icon: <Video className="w-8 h-8" />, color: 'text-rose-600', bgColor: 'bg-rose-50 hover:bg-rose-100' },
  xixie: { icon: <Droplets className="w-8 h-8" />, color: 'text-sky-600', bgColor: 'bg-sky-50 hover:bg-sky-100' },
  financial: { icon: <Banknote className="w-8 h-8" />, color: 'text-emerald-600', bgColor: 'bg-emerald-50 hover:bg-emerald-100' },
  score: { icon: <Gauge className="w-8 h-8" />, color: 'text-amber-600', bgColor: 'bg-amber-50 hover:bg-amber-100' },
  warehouse: { icon: <Warehouse className="w-8 h-8" />, color: 'text-blue-600', bgColor: 'bg-blue-50 hover:bg-blue-100' },
  reimbursement: { icon: <Receipt className="w-8 h-8" />, color: 'text-lime-600', bgColor: 'bg-lime-50 hover:bg-lime-100' },
  pk: { icon: <Trophy className="w-8 h-8" />, color: 'text-red-600', bgColor: 'bg-red-50 hover:bg-red-100' },
  asset: { icon: <PackageCheck className="w-8 h-8" />, color: 'text-pink-600', bgColor: 'bg-pink-50 hover:bg-pink-100' },
  growthClassroom: { icon: <BookOpen className="w-8 h-8" />, color: 'text-violet-600', bgColor: 'bg-violet-50 hover:bg-violet-100' },
};
const FALLBACK_STYLE = { icon: <HelpCircle className="w-8 h-8" />, color: 'text-gray-600', bgColor: 'bg-gray-50 hover:bg-gray-100' };

// 主门户（一级）展示样式
const MASTER_UI_STYLE: Record<string, { icon: React.ReactNode; color: string; bgColor: string; ring: string }> = {
  masterSystem: { icon: <Settings className="w-10 h-10" />, color: 'text-blue-600', bgColor: 'bg-blue-50 hover:bg-blue-100', ring: 'ring-blue-200' },
  masterHr: { icon: <Users className="w-10 h-10" />, color: 'text-indigo-600', bgColor: 'bg-indigo-50 hover:bg-indigo-100', ring: 'ring-indigo-200' },
  masterFinance: { icon: <Banknote className="w-10 h-10" />, color: 'text-emerald-600', bgColor: 'bg-emerald-50 hover:bg-emerald-100', ring: 'ring-emerald-200' },
  masterAdmin: { icon: <PackageCheck className="w-10 h-10" />, color: 'text-pink-600', bgColor: 'bg-pink-50 hover:bg-pink-100', ring: 'ring-pink-200' },
  masterMerch: { icon: <ShoppingCart className="w-10 h-10" />, color: 'text-cyan-600', bgColor: 'bg-cyan-50 hover:bg-cyan-100', ring: 'ring-cyan-200' },
  masterSalesBiz: { icon: <BarChart3 className="w-10 h-10" />, color: 'text-purple-600', bgColor: 'bg-purple-50 hover:bg-purple-100', ring: 'ring-purple-200' },
  masterStoreOps: { icon: <Store className="w-10 h-10" />, color: 'text-orange-600', bgColor: 'bg-orange-50 hover:bg-orange-100', ring: 'ring-orange-200' },
  masterFeature: { icon: <Sparkles className="w-10 h-10" />, color: 'text-rose-600', bgColor: 'bg-rose-50 hover:bg-rose-100', ring: 'ring-rose-200' },
  masterDesk: { icon: <MessageSquare className="w-10 h-10" />, color: 'text-green-600', bgColor: 'bg-green-50 hover:bg-green-100', ring: 'ring-green-200' },
};
const MASTER_FALLBACK_STYLE = { icon: <Building2 className="w-10 h-10" />, color: 'text-gray-600', bgColor: 'bg-gray-50 hover:bg-gray-100', ring: 'ring-gray-200' };

/** 热点新闻风格火焰：金→橙→红渐变 + 双层焰心 + 光晕脉动 + 跳动。size 控制整体尺寸 */
function HotFlame({ size = 26 }: { size?: number }) {
  const gid = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <span
      className="relative inline-flex items-center justify-center shrink-0"
      style={{ width: size, height: size, animation: 'flame-flicker 1.6s ease-in-out infinite' }}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} style={FLAME_STYLE}>
        <defs>
          <linearGradient id={`flame-outer-${gid}`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#dc2626" />
            <stop offset="40%" stopColor="#f97316" />
            <stop offset="75%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#fef08a" />
          </linearGradient>
          <linearGradient id={`flame-core-${gid}`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="55%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#fef9c3" />
          </linearGradient>
        </defs>
        <path
          d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
          fill={`url(#flame-outer-${gid})`}
          stroke="#b91c1c"
          strokeWidth="0.6"
          strokeLinejoin="round"
        />
        <path
          d="M10.6 12.9A1.9 1.9 0 0 0 12 11.5c0-1.05-.38-1.52-.76-2.28-.81-1.62-.17-3.07 1.52-4.55.38 1.9 1.52 3.72 3.04 4.94 1.52 1.21 2.28 2.66 2.28 4.18a5.32 5.32 0 0 1-10.64 0c0-.88.33-1.74.76-2.28a1.9 1.9 0 0 0 1.4 1.39z"
          fill={`url(#flame-core-${gid})`}
          style={{ animation: 'flame-core 1.3s ease-in-out infinite' }}
        />
      </svg>
    </span>
  );
}

/** 热点门户徽标：4 个热点门户统一显示「金红渐变动态火焰 + 金色渐变简称」（销售/巡店/工作汇报/圈战） */
function HotBadge({ portalEn }: { portalEn: string }) {
  const label = HOT_BADGE_NAMES[portalEn] || '';
  return (
    <div className="flex items-center gap-1">
      <HotFlame size={26} />
      <span className="text-sm font-extrabold bg-gradient-to-r from-yellow-500 via-amber-400 to-yellow-600 bg-clip-text text-transparent" style={GOLD_TEXT_STYLE}>
        {label}
      </span>
    </div>
  );
}

/**
 * 三级导航首页：登录后先展示「主门户」→ 点击进入「门户」→ 再进入门户默认路由（侧边菜单联动）。
 * 可见性由后端 my-menus 接口（sys_role_menu 授权）决定，此处仅按返回数据展示。
 */
function PortalPage() {
  const navigate = useNavigate();
  const { user, token, logout } = useAuthStore();
  const { setModule } = useModuleStore();
  const [masters, setMasters] = useState<MasterPortal[]>([]);
  const [selectedMaster, setSelectedMaster] = useState<MasterPortal | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/permissions/my-menus', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => {
        if (!data.error) {
          // 三层结构：主门户 → 门户 → 菜单（服务端 masters 分组）；旧版接口无 masters 时回退 portals 单层
          if (Array.isArray(data.masters)) {
            setMasters(data.masters as MasterPortal[]);
          } else if (Array.isArray(data.portals)) {
            const byMaster = new Map<string, MasterPortal>();
            data.portals.forEach((p: PortalInfo) => {
              const key = p.masterPortalEn || 'unassigned';
              if (!byMaster.has(key)) byMaster.set(key, { masterPortalEn: key, masterPortalCn: p.masterPortalCn || '其他', portals: [] });
              byMaster.get(key)!.portals.push(p);
            });
            setMasters(Array.from(byMaster.values()));
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const handlePortalClick = (portal: PortalInfo) => {
    const route = portal.defaultRoute || '#';
    if (!route || route === '#') {
      alert('该门户暂无可用页面');
      return;
    }
    setModule(portal.portalEn as any);
    navigate(route);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const availableMasters = masters.filter(m => m.portals && m.portals.length > 0);
  // 热门菜单区：从已授权主门户中提取热点门户（可见性仍由后端授权决定）
  const hotPortals = availableMasters.flatMap(m => m.portals).filter(p => HOT_PORTAL_ENS.includes(p.portalEn));

  const renderMasterCard = (master: MasterPortal) => {
    const style = MASTER_UI_STYLE[master.masterPortalEn] || MASTER_FALLBACK_STYLE;
    return (
      <button
        key={master.masterPortalEn}
        onClick={() => setSelectedMaster(master)}
        className={`relative flex flex-col items-center justify-center p-8 rounded-2xl transition-all duration-200 ring-1 ${style.ring} ${style.bgColor} ${style.color} cursor-pointer shadow-md hover:shadow-xl transform hover:-translate-y-1.5`}
      >
        <div className="p-5 rounded-full bg-white shadow-sm mb-4">
          <span className={style.color}>{style.icon}</span>
        </div>
        <span className="font-bold text-lg text-gray-800">{master.masterPortalCn}</span>
        <span className="text-xs text-gray-500 mt-2">{master.portals.length} 个门户 · {master.portals.reduce((s, p) => s + p.menuCount, 0)} 个功能</span>
      </button>
    );
  };

  const renderPortalCard = (portal: PortalInfo, isHot: boolean) => {
    const style = PORTAL_UI_STYLE[portal.portalEn] || FALLBACK_STYLE;
    const name = isHot ? (HOT_PORTAL_NAMES[portal.portalEn] || portal.portalCn) : portal.portalCn;
    return (
      <button
        key={portal.portalEn}
        onClick={() => handlePortalClick(portal)}
        className={`relative flex flex-col items-center justify-center p-8 rounded-xl transition-all duration-200 ${style.bgColor} ${style.color} cursor-pointer shadow-md hover:shadow-lg transform hover:-translate-y-1`}
      >
        {isHot && (
          <div className="absolute top-3 right-3">
            <HotBadge portalEn={portal.portalEn} />
          </div>
        )}
        <div className="p-4 rounded-full bg-white shadow-sm mb-4">
          <span className={style.color}>{style.icon}</span>
        </div>
        <span className="font-semibold text-lg">{name}</span>
        <span className="text-xs text-gray-400 mt-2">{portal.menuCount} 个功能</span>
      </button>
    );
  };

  // 热门菜单区卡片：金红火焰徽标 + 热门名称，点击直达门户默认路由
  const handleHotPortalCard = (portal: PortalInfo) => {
    const style = PORTAL_UI_STYLE[portal.portalEn] || FALLBACK_STYLE;
    const name = HOT_PORTAL_NAMES[portal.portalEn] || portal.portalCn;
    return (
      <button
        key={portal.portalEn}
        onClick={() => handlePortalClick(portal)}
        className="relative flex flex-col items-center justify-center p-6 rounded-2xl bg-gradient-to-br from-orange-50 via-white to-amber-50 ring-1 ring-orange-200 text-orange-600 cursor-pointer shadow-md hover:shadow-xl transform hover:-translate-y-1 transition-all duration-200"
      >
        <div className="absolute top-3 right-3">
          <HotBadge portalEn={portal.portalEn} />
        </div>
        <div className="p-4 rounded-full bg-white shadow-sm mb-3">
          <span className={style.color}>{style.icon}</span>
        </div>
        <span className="font-bold text-lg text-gray-800">{name}</span>
        <span className="text-xs text-gray-400 mt-1.5">{portal.menuCount} 个功能</span>
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <style>{PORTAL_BADGE_ANIMATIONS}</style>
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                <img src="/logo.jpg" alt="logo" className="h-8 w-8 object-contain" />
                卡迪高运营管理系统
              </h1>
              <p className="text-gray-500 mt-1">欢迎回来，{user?.userName}</p>
              {user?.roleNames && user.roleNames.length > 0 && (
                <p className="text-xs text-gray-400 mt-0.5">{user.roleNames.join(' / ')}</p>
              )}
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-bold text-red-600 bg-red-50 px-3 py-1 rounded-full">系统门户</p>
                <p className="text-xs text-gray-400">{new Date().toLocaleDateString('zh-CN')}</p>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <button
                  onClick={() => navigate('/users/change-password')}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  <Key size={18} />
                  <span>修改密码</span>
                </button>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                >
                  <LogOut size={18} />
                  <span>退出登录</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-12">
        {loading ? (
          <div className="text-center text-gray-400 py-16">加载门户中...</div>
        ) : availableMasters.length === 0 ? (
          <div className="text-center text-gray-400 py-16">
            当前账号暂无可用门户，请联系管理员分配权限
          </div>
        ) : !selectedMaster ? (
          /* —— 一级：主门户列表 —— */
          <>
            {hotPortals.length > 0 && (
              <div className="mb-12">
                <div className="flex items-center justify-center gap-3 mb-6">
                  <Trophy size={24} className="text-orange-500" />
                  <h2 className="text-2xl font-extrabold text-gray-800">热门菜单</h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  {hotPortals.map(portal => handleHotPortalCard(portal))}
                </div>
              </div>
            )}
            <div className="flex items-center justify-center gap-3 mb-8">
              <Building2 size={26} className="text-gray-400" />
              <h2 className="text-2xl font-extrabold text-gray-800">主门户</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {availableMasters.map(master => renderMasterCard(master))}
            </div>
            <p className="text-center text-xs text-gray-400 mt-8">选择主门户进入对应业务门户</p>
          </>
        ) : (
          /* —— 二级：主门户下的门户列表 —— */
          <>
            <div className="mb-6 flex items-center gap-3">
              <button
                onClick={() => setSelectedMaster(null)}
                className="flex items-center gap-1 px-4 py-2 bg-white text-gray-600 rounded-lg hover:bg-gray-200 transition-colors shadow-sm"
              >
                <ChevronLeft size={18} />
                <span>返回主门户</span>
              </button>
              <h2 className="text-2xl font-extrabold text-gray-800 flex items-center gap-2">
                <Building2 size={24} className="text-gray-400" />
                {selectedMaster.masterPortalCn}
                <span className="text-sm font-normal text-gray-400">{selectedMaster.portals.length} 个门户</span>
              </h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {selectedMaster.portals.map(portal => renderPortalCard(portal, HOT_PORTAL_ENS.includes(portal.portalEn)))}
            </div>
            <p className="text-center text-xs text-gray-400 mt-8">进入门户后，可在左侧菜单切换业务功能</p>
          </>
        )}
      </div>
    </div>
  );
}

export default PortalPage;