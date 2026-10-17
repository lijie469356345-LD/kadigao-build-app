import { LayoutDashboard, FileText, BarChart3, Users, Store, Settings, LogOut, Shield, Database, Loader2, ClipboardList, Award, Home, TrendingUp, ShoppingCart, Target, MessageSquare, Package, Boxes, GitMerge, Table, Table2, Truck, PieChart, ClipboardCheck, MapPin, FolderCog, UserCog, Gift, Star, Footprints, Upload, Send, CheckCircle2, Wallet, Percent, ScanSearch, AlertTriangle, Warehouse, Gauge, Receipt, Workflow, TrendingDown, Banknote, CreditCard, BookOpen, PackageX, Network, Trophy, UserCheck, Briefcase, PackageCheck, CarFront, Clock, BadgeCheck, Calendar, Calculator, Menu, X, type LucideIcon } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useModuleStore } from '../../store/moduleStore';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

interface LayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  /** 页面级附加类名（用于按页面覆盖移动端内容区宽度等全局样式） */
  className?: string;
}

// 侧边栏菜单项：menuEn 可选，携带时按菜单标识独立控制可见性（兼容共用同一 routePath 的菜单）
type MenuItem = { icon: LucideIcon; label: string; path: string; menuEn?: string };

function Layout({ children, title, subtitle, className }: LayoutProps) {
  const navigate = useNavigate();
  const { user, token, logout, isLoggedIn } = useAuthStore();
  const { currentModule, clearModule } = useModuleStore();

  const [allowedPortalEns, setAllowedPortalEns] = useState<string[]>([]);
  // 移动端抽屉菜单开合
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  // 按门户分组的授权菜单映射：portalEn -> { menuEns, routes }（null=未加载完成，此时不过滤，避免首帧闪没）
  // 规则：每个门户-次门户-菜单 只显示对应的关系——菜单可见性严格按「当前门户的授权菜单集合」判定
  const [portalMenuMap, setPortalMenuMap] = useState<Map<string, { menuEns: Set<string>; routes: Set<string> }> | null>(null);
  // 全系统受菜单授权管理的路由清单
  const [managedRoutes, setManagedRoutes] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/permissions/my-menus', {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(r=>r.json()).then(data=>{
      if(!data.error && Array.isArray(data.portals)) {
        setAllowedPortalEns(data.portals.map((p: any) => p.portalEn));
        const map = new Map<string, { menuEns: Set<string>; routes: Set<string> }>();
        data.portals.forEach((p: any) => {
          const menuEns = new Set<string>();
          const routes = new Set<string>();
          (p.menus || []).forEach((m: any) => { if (m.menuEn) menuEns.add(m.menuEn); if (m.routePath) routes.add(m.routePath); });
          map.set(p.portalEn, { menuEns, routes });
        });
        setPortalMenuMap(map);
        if (Array.isArray(data.managedRoutes)) setManagedRoutes(data.managedRoutes);
      }
    }).catch(()=>{});
  }, [token]);

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-2" />
          <p className="text-gray-500">正在验证身份...</p>
        </div>
      </div>
    );
  }

  const getModuleFromPath = () => {
    const path = window.location.pathname;
    // 系统管理：系统维护/数据库连接/数据提取/企微推送/数据表管理 + 权限管理（自基础资料迁回）
    if (path.startsWith('/maintenance') || path.startsWith('/database') || path.startsWith('/data-extraction') || path.startsWith('/wechat-push') || path.startsWith('/data-manager') || path.startsWith('/permissions')) {
      return 'system';
    }
    // 基础资料（原 system 迁出：组织/用户/店铺/注册审核/职位 + /base/* 占位）
    if (path.startsWith('/org-manage') || path.startsWith('/users') || path.startsWith('/shops') || path.startsWith('/register-audit') || path.startsWith('/positions') || path.startsWith('/base/')) {
      return 'baseInfo';
    }
    if (path.startsWith('/attendance')) {
      return 'attendance';
    }
    if (path.startsWith('/payroll')) {
      return 'payroll';
    }
    // 工作台（原仪表盘门户扩展：/dashboard + /workbench/*）
    if (path.startsWith('/dashboard') || path.startsWith('/workbench')) {
      return 'dashboard';
    }
    if (path.startsWith('/purchase') || path.startsWith('/best-seller')) {
      return 'purchase';
    }
    if (path.startsWith('/logs') || path.startsWith('/tasks')) {
      return 'inspection';
    }
    if (path.startsWith('/financial')) {
      return 'financial';
    }
    if (path.startsWith('/score-warning')) {
      return 'score';
    }
    if (path.startsWith('/warehouse')) {
      return 'warehouse';
    }
    if (path.startsWith('/reports') || path.startsWith('/performance-dashboard') || path.startsWith('/comparison') || path.startsWith('/shop-diagnosis') || path.startsWith('/monthly-target-decomposition') || path.startsWith('/staff-monthly-target') || path.startsWith('/staff-sales-target') || path.startsWith('/finance-field') || path.startsWith('/annual-operation-dashboard') || path.startsWith('/member-report')) {
      return 'sales';
    }
    if (path.startsWith('/staff-channel')) {
      return 'staffChannel';
    }
    if (path.startsWith('/coaching')) {
      return 'coaching';
    }
    if (path.startsWith('/automation')) {
      return 'automation';
    }
    if (path.startsWith('/direct-sales-summary')) {
      return 'directSales';
    }
    if (path.startsWith('/douyin')) {
      return 'douyin';
    }
    if (path.startsWith('/xixie')) {
      return 'xixie';
    }
    if (path.startsWith('/shoe-feedback/manage')) {
      return 'xixie';
    }
    if (path.startsWith('/reimbursement')) {
      return 'reimbursement';
    }
    if (path.startsWith('/pk-')) {
      return 'pk';
    }
    if (path.startsWith('/asset/growth-classroom')) {
      return 'growthClassroom';
    }
    if (path.startsWith('/asset')) {
      return 'asset';
    }
    return null;
  };

  const moduleFromPath = getModuleFromPath();
  // 成长课堂路径优先于 currentModule：无论从门户卡还是资产菜单进入，都展示成长课堂分类菜单
  const effectiveModule = (moduleFromPath === 'growthClassroom' || currentModule === 'growthClassroom') ? 'growthClassroom' : (currentModule || moduleFromPath);

  // 菜单项可见性：严格按「门户-次门户-菜单」层级对应关系判定——
  // 菜单项必须命中「当前门户（effectiveModule）的授权菜单集合」（menuEn 精确匹配，缺失 menuEn 的旧菜单按 routePath 在该门户授权集内匹配）；
  // 系统门户恒显；成长课堂入口按「成长课堂门户被授权」判定；首页（无门户上下文）按全系统授权路由兜底
  const isMenuItemVisible = (item: { path: string; menuEn?: string }) => {
    // 成长课堂入口：成长课堂门户被授权（任一 gc 分类授权即含该门户）→ 显示，与成长课堂分类菜单保持同一门户规则
    if (item.menuEn === 'growthClassroom') {
      if (!portalMenuMap) return false;
      return portalMenuMap.has('growthClassroom');
    }
    if (item.path === '/') return true;
    if (!portalMenuMap) return false;
    if (effectiveModule) {
      // 模块内：只显示当前门户授权集中的菜单（菜单-门户严格对应，杜绝同 routePath 跨菜单误显）
      const grant = portalMenuMap.get(effectiveModule);
      if (!grant) return false;
      if (item.menuEn) return grant.menuEns.has(item.menuEn);
      return grant.routes.has(item.path);
    }
    // 首页/无门户上下文（adminMenuItems/normalMenuItems 快捷导航兜底）：按全系统已授权路由判定
    if (item.menuEn) return Array.from(portalMenuMap.values()).some(g => g.menuEns.has(item.menuEn!));
    return Array.from(portalMenuMap.values()).some(g => g.routes.has(item.path));
  };

// 管理员判定与 v3 角色授权体系一致：管理员字段 或 持有 super_admin/data_admin 角色（sys_role_menu 已授权 system 门户）
  const isAdmin = user?.isAdmin === '是' || (user?.roleCodes || []).includes('super_admin') || (user?.roleCodes || []).includes('data_admin');

  // 无权限访问当前模块则跳回门户（以服务端 sys_role_menu 授权为准）
  if (effectiveModule && allowedPortalEns.length > 0 && !allowedPortalEns.includes(effectiveModule)) {
    setTimeout(() => navigate('/'), 0);
  }

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const systemMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: Settings, label: '系统维护', path: '/maintenance', menuEn: 'systemMaintenance' },
    { icon: Database, label: '数据库连接', path: '/database', menuEn: 'databaseConfig' },
    { icon: Database, label: '数据提取', path: '/data-extraction', menuEn: 'dataExtraction' },
    { icon: MessageSquare, label: '企业微信推送', path: '/wechat-push', menuEn: 'wechatPush' },
    { icon: Shield, label: '权限管理', path: '/permissions', menuEn: 'permissions' },
  ];

  const baseInfoMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: UserCheck, label: '注册审核', path: '/register-audit', menuEn: 'registerAudit' },
    { icon: Network, label: '组织管理', path: '/org-manage', menuEn: 'orgManage' },
    { icon: Briefcase, label: '职位管理', path: '/positions', menuEn: 'positions' },
    { icon: Store, label: '店铺档案', path: '/shops', menuEn: 'shopArchive' },
    { icon: Users, label: '用户管理', path: '/users', menuEn: 'users' },
    { icon: UserCheck, label: '入职管理', path: '/base/onboarding', menuEn: 'onboarding' },
    { icon: BadgeCheck, label: '工牌制作台账', path: '/base/onboarding-badge', menuEn: 'onboardingBadge' },
    { icon: CreditCard, label: '内购卡调整', path: '/base/onboarding-card-adjust', menuEn: 'onboardingCardAdjust' },
    { icon: BadgeCheck, label: '转正管理', path: '/base/regularization', menuEn: 'regularization' },
    { icon: GitMerge, label: '调岗管理', path: '/base/transfer', menuEn: 'transfer' },
    { icon: LogOut, label: '离职管理', path: '/base/resignation', menuEn: 'resignation' },
  ];

  const attendanceMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: Clock, label: '打卡', path: '/attendance/clock-in', menuEn: 'clockIn' },
    { icon: Calendar, label: '排班', path: '/attendance/schedule', menuEn: 'schedule' },
    { icon: BarChart3, label: '考勤报表', path: '/attendance/report', menuEn: 'attendanceReport' },
  ];

  const payrollMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: Wallet, label: '薪资方案', path: '/payroll/salary-scheme', menuEn: 'salaryScheme' },
    { icon: Calculator, label: '薪资核算', path: '/payroll/salary-calculation', menuEn: 'salaryCalculation' },
    { icon: FolderCog, label: '薪资档案管理', path: '/payroll/salary-archive', menuEn: 'salaryArchive' },
  ];

const inspectionMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: ClipboardList, label: '巡店任务', path: '/tasks', menuEn: 'tasks' },
    { icon: FileText, label: '巡店日志', path: '/logs', menuEn: 'logs' },
    { icon: ClipboardCheck, label: '日志未完成统计', path: '/logs/statistics', menuEn: 'logStatistics' },
    { icon: Award, label: '评分体系', path: '/scores', menuEn: 'scores' },
  ];

const salesMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: Gauge, label: '业绩看板', path: '/performance-dashboard', menuEn: 'performanceDashboard' },
    { icon: BarChart3, label: '销售报表', path: '/reports', menuEn: 'reports' },
    { icon: Target, label: '店员销售指标', path: '/staff-sales-target', menuEn: 'staffSalesTarget' },
    { icon: PieChart, label: '月目标分解', path: '/monthly-target-decomposition', menuEn: 'monthlyTarget' },
    { icon: PieChart, label: '月目标分解店员', path: '/staff-monthly-target', menuEn: 'staffMonthlyTarget' },
    { icon: TrendingUp, label: '店铺诊断', path: '/shop-diagnosis', menuEn: 'shopDiagnosis' },
    { icon: FileText, label: '财务字段', path: '/finance-field', menuEn: 'financeField' },
    { icon: LayoutDashboard, label: '年度经营看板', path: '/annual-operation-dashboard', menuEn: 'annualOperationDashboard' },
    { icon: BarChart3, label: '对比报表', path: '/comparison', menuEn: 'comparisonReport' },
    { icon: Users, label: '会员报表', path: '/member-report', menuEn: 'memberReport' },
  ];

const purchaseMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: ShoppingCart, label: '采购管理', path: '/purchase', menuEn: 'purchaseHome' },
    { icon: TrendingUp, label: '畅销款排行', path: '/best-seller', menuEn: 'bestSeller' },
    { icon: FileText, label: '往期订单', path: '/purchase/previous-orders', menuEn: 'previousOrders' },
    { icon: BarChart3, label: '往期销售', path: '/purchase/previous-sales', menuEn: 'previousSales' },
    { icon: BarChart3, label: '商品利润评估', path: '/purchase/profit-evaluation', menuEn: 'profitEvaluation' },
    { icon: Users, label: '供应商评估', path: '/purchase/supplier-evaluation', menuEn: 'supplierEvaluation' },
    { icon: Store, label: '建议配码', path: '/purchase/suggested-code', menuEn: 'suggestedCode' },
    { icon: FileText, label: '商品部计划', path: '/purchase/merchandise-plan', menuEn: 'merchandisePlan' },
    { icon: BarChart3, label: '季度销售评估', path: '/purchase/quarterly-evaluation', menuEn: 'quarterlyEvaluation' },
  ];

const dashboardMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: LayoutDashboard, label: '仪表盘', path: '/dashboard', menuEn: 'dashboard' },
    { icon: ClipboardList, label: '我的待办审批', path: '/workbench/todo-approvals', menuEn: 'todoApproval' },
    { icon: Send, label: '我发起的申请', path: '/workbench/my-applications', menuEn: 'myApplications' },
    { icon: CheckCircle2, label: '已办任务查询', path: '/workbench/done-tasks', menuEn: 'doneTasks' },
    { icon: MessageSquare, label: '消息通知中心', path: '/workbench/notifications', menuEn: 'notifications' },
    { icon: Settings, label: '个人工作台配置', path: '/workbench/config', menuEn: 'workbenchConfig' },
    { icon: Star, label: '快捷功能收藏', path: '/workbench/favorites', menuEn: 'quickFavorites' },
  ];

const staffChannelMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: Users, label: '全员通道', path: '/staff-channel', menuEn: 'staffChannelHome' },
    { icon: FileText, label: '反馈任务单', path: '/staff-channel/tasks', menuEn: 'feedbackTasks' },
    { icon: ClipboardList, label: '反馈明细表', path: '/staff-channel/details', menuEn: 'feedbackDetails' },
  ];

const automationMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: Package, label: '自动补货', path: '/automation/replenish', menuEn: 'autoReplenish' },
    { icon: Boxes, label: '自动分货', path: '/automation/distribute', menuEn: 'autoDistribute' },
    { icon: GitMerge, label: '自动并货', path: '/automation/merge', menuEn: 'autoMerge' },
    { icon: Table, label: '初始并货表', path: '/automation/initial', menuEn: 'initialMerge' },
    { icon: Truck, label: '线上并货', path: '/automation/online-merge', menuEn: 'onlineMerge' },
  ];

const coachingMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: Target, label: '陪跑跟进', path: '/coaching', menuEn: 'coaching' },
    { icon: Store, label: '陪跑店铺管理', path: '/coaching-stores', menuEn: 'coachingStores' },
    { icon: Clock, label: '时段业绩播报', path: '/hourly-performance', menuEn: 'hourlyPerformance' },
  ];

const directSalesMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: TrendingUp, label: '直营区经运营工作汇报', path: '/direct-sales-summary', menuEn: 'directSalesSummary' },
    { icon: FileText, label: '日常运营指标上传', path: '/daily-target-upload', menuEn: 'dailyTargetUpload' },
    { icon: TrendingUp, label: '直营督导运营工作汇报', path: '/direct-sales-summary/supervisor', menuEn: 'supervisorReport' },
    { icon: TrendingUp, label: '商品店铺工作汇报', path: '/direct-sales-summary/product-leader', menuEn: 'productLeaderReport' },
    { icon: TrendingUp, label: '商品组长工作汇报', path: '/direct-sales-summary/product-group', menuEn: 'productGroupReport' },
    { icon: FileText, label: '日常商品指标上传', path: '/daily-product-target-upload', menuEn: 'dailyProductTargetUpload' },
  ];

const douyinMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: Gift, label: '福袋', path: '/douyin/fudai', menuEn: 'fuDai' },
    { icon: Star, label: '好评会员', path: '/douyin/haoping', menuEn: 'goodReviewMember' },
    { icon: Footprints, label: '袜子转化', path: '/douyin/wazi', menuEn: 'sockConversion' },
  ];

const xixieMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: Upload, label: '洗鞋费用上传', path: '/xixie/cost', menuEn: 'xixieCostUpload' },
    { icon: Send, label: '洗鞋投放上传', path: '/xixie/invest', menuEn: 'xixieInvestUpload' },
    { icon: CheckCircle2, label: '洗鞋核销上传', path: '/xixie/writeoff', menuEn: 'xixieWriteoffUpload' },
    { icon: BarChart3, label: '洗鞋汇总报表', path: '/xixie/summary', menuEn: 'xixieSummaryReport' },
    { icon: MessageSquare, label: '洗鞋服务反馈', path: '/shoe-feedback/manage', menuEn: 'shoeFeedback' },
  ];

const financialMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: BarChart3, label: '营收利润分析', menuEn: 'revenueProfitAnalysis', path: '/financial/revenue-profit' },
    { icon: Wallet, label: '店铺费用分析', menuEn: 'storeCostAnalysis', path: '/financial/store-cost' },
    { icon: Percent, label: '租售比分析', menuEn: 'rentRatioAnalysis', path: '/financial/rent-ratio' },
    { icon: TrendingUp, label: '投入产出分析', menuEn: 'inputOutputAnalysis', path: '/financial/input-output' },
{ icon: Users, label: '工资分析', menuEn: 'salaryAnalysis', path: '/financial/salary' },
    { icon: PackageX, label: '无成本价商品', menuEn: 'noCostPriceProduct', path: '/financial/no-cost-price-product' },
  ];

const scoreMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: ScanSearch, label: '店铺检测', path: '/score-warning/check', menuEn: 'shopCheck' },
    { icon: ClipboardCheck, label: '店铺检查打分表', path: '/score-warning/score-table', menuEn: 'shopScoreTable' },
    { icon: AlertTriangle, label: '店铺预警表', path: '/score-warning/warning-table', menuEn: 'shopWarningTable' },
    { icon: CheckCircle2, label: '店铺整改确认', path: '/score-warning/rectification', menuEn: 'shopRectification' },
    { icon: MessageSquare, label: '店铺意见建议', path: '/score-warning/suggestion', menuEn: 'shopSuggestion' },
  ];

const warehouseMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: Warehouse, label: '仓库扫码入库', path: '/warehouse/scan', menuEn: 'scanInbound' },
  ];

const reimbursementMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: LayoutDashboard, label: '报销申请', path: '/reimbursement/home', menuEn: 'reimbursementHome' },
    { icon: Wallet, label: '借款申请', path: '/reimbursement/expense-application', menuEn: 'loanApplication' },
    { icon: CreditCard, label: '预付款申请', path: '/reimbursement/advance-payment', menuEn: 'advancePayment' },
    { icon: Banknote, label: '付款记录', path: '/reimbursement/payment-record', menuEn: 'paymentRecord' },
    { icon: TrendingDown, label: '预算管控', path: '/reimbursement/budget', menuEn: 'budgetControl' },
    { icon: FileText, label: '凭证记录', path: '/reimbursement/voucher', menuEn: 'reimbursementVoucher' },
    { icon: Workflow, label: '审批流设计', path: '/reimbursement/approval', menuEn: 'reimbursementApproval' },
    { icon: BarChart3, label: '费用报表', path: '/reimbursement/report', menuEn: 'reimbursementReport' },
    { icon: TrendingDown, label: '欠款查询', path: '/reimbursement/debt-query', menuEn: 'debtQuery' },
    { icon: BookOpen, label: '账簿查询', path: '/reimbursement/ledger-query', menuEn: 'ledgerQuery' },
    { icon: Settings, label: '账簿管理', path: '/reimbursement/ledger-manage', menuEn: 'ledgerManage' },
  ];

const pkMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: ClipboardList, label: 'PK任务单', path: '/pk-task-order', menuEn: 'pkTaskOrder' },
    { icon: Trophy, label: 'PK店铺目标', path: '/pk-target', menuEn: 'pkStoreTarget' },
    { icon: Target, label: 'PK维度设定', path: '/pk-dimensions', menuEn: 'pkDimensionConfig' },
    { icon: BarChart3, label: 'PK报表', path: '/pk-report', menuEn: 'pkReport' },
    { icon: Table2, label: 'PK数据表', path: '/pk-data-table', menuEn: 'pkDataTable' },
    { icon: Upload, label: 'PK日目标上传', path: '/pk-daily-target', menuEn: 'pkDailyTarget' },
    { icon: TrendingUp, label: 'PK日目标跟进', path: '/pk-daily-followup', menuEn: 'pkDailyFollowup' },
  ];

  const assetMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: PackageCheck, label: '固定资产', menuEn: 'fixedAssets', path: '/asset/fixed-assets' },
    { icon: Truck, label: '申请用车', menuEn: 'vehicleApply', path: '/asset/vehicle-apply' },
    { icon: CarFront, label: '车辆管理', menuEn: 'vehicleManage', path: '/asset/vehicle-manage' },
    { icon: BadgeCheck, label: '授权人管理', menuEn: 'authorizedPersons', path: '/asset/authorized-persons' },
  ];

  // 成长课堂页内分类菜单：系统门户 + 上传资料 + 7 个部门分类（分类菜单按 menuEn 参与后台授权，未授权分类不可见；系统门户恒显）
  const growthClassroomMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: Upload, label: '上传资料', menuEn: 'gcUpload', path: '/asset/growth-classroom?gcAction=upload' },
    { icon: Package, label: '品研中心（商品）', menuEn: 'gcProduct', path: '/asset/growth-classroom?gcCat=product' },
    { icon: Users, label: '人才发展（人事）', menuEn: 'gcHr', path: '/asset/growth-classroom?gcCat=hr' },
    { icon: TrendingUp, label: '运营智库（运营）', menuEn: 'gcOps', path: '/asset/growth-classroom?gcCat=ops' },
    { icon: Wallet, label: '财务规范（财务）', menuEn: 'gcFinance', path: '/asset/growth-classroom?gcCat=finance' },
    { icon: FolderCog, label: '行政指南（行政）', menuEn: 'gcAdmin', path: '/asset/growth-classroom?gcCat=admin' },
    { icon: Settings, label: '系统实操（实操）', menuEn: 'gcSysops', path: '/asset/growth-classroom?gcCat=sysops' },
    { icon: Gift, label: '会员研习（会员）', menuEn: 'gcMember', path: '/asset/growth-classroom?gcCat=member' },
  ];

const adminMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: Settings, label: '系统维护', path: '/maintenance' },
    { icon: Database, label: '数据库连接', path: '/database' },
    { icon: Shield, label: '权限管理', path: '/permissions' },
    { icon: Store, label: '店铺档案', path: '/shops' },
    { icon: ShoppingCart, label: '采购管理', path: '/purchase' },
    { icon: LayoutDashboard, label: '仪表盘', path: '/dashboard' },
    { icon: Gauge, label: '业绩看板', path: '/performance-dashboard' },
    { icon: BarChart3, label: '销售报表', path: '/reports' },
    { icon: Target, label: '店员销售指标', path: '/staff-sales-target' },
    { icon: PieChart, label: '月目标分解', path: '/monthly-target-decomposition' },
    { icon: PieChart, label: '月目标分解店员', path: '/staff-monthly-target' },


    { icon: TrendingUp, label: '店铺诊断', path: '/shop-diagnosis' },
    { icon: FileText, label: '财务字段', path: '/finance-field' },
    { icon: LayoutDashboard, label: '年度经营看板', path: '/annual-operation-dashboard' },
    { icon: BarChart3, label: '对比报表', path: '/comparison' },
    { icon: FileText, label: '巡店日志', path: '/logs' },
    { icon: ClipboardCheck, label: '日志未完成统计', path: '/logs/statistics' },
    { icon: ClipboardList, label: '巡店任务', path: '/tasks' },
    { icon: Award, label: '评分体系', path: '/scores' },
    { icon: Users, label: '用户管理', path: '/users' },
    { icon: Users, label: '全员通道', path: '/staff-channel' },
    { icon: MessageSquare, label: '企业微信推送', path: '/wechat-push' },
  ];

const normalMenuItems: MenuItem[] = [
    { icon: Home, label: '系统门户', path: '/' },
    { icon: ShoppingCart, label: '采购管理', path: '/purchase' },
    { icon: LayoutDashboard, label: '仪表盘', path: '/dashboard' },
    { icon: Gauge, label: '业绩看板', path: '/performance-dashboard' },
    { icon: BarChart3, label: '销售报表', path: '/reports' },
    { icon: Target, label: '店员销售指标', path: '/staff-sales-target' },
    { icon: PieChart, label: '月目标分解', path: '/monthly-target-decomposition' },
    { icon: PieChart, label: '月目标分解店员', path: '/staff-monthly-target' },


    { icon: TrendingUp, label: '店铺诊断', path: '/shop-diagnosis' },
    { icon: FileText, label: '财务字段', path: '/finance-field' },
    { icon: LayoutDashboard, label: '年度经营看板', path: '/annual-operation-dashboard' },
    { icon: BarChart3, label: '对比报表', path: '/comparison' },
    { icon: FileText, label: '巡店日志', path: '/logs' },
    { icon: ClipboardCheck, label: '日志未完成统计', path: '/logs/statistics' },
    { icon: ClipboardList, label: '巡店任务', path: '/tasks' },
    { icon: Award, label: '评分体系', path: '/scores' },
    { icon: Users, label: '全员通道', path: '/staff-channel' },
    { icon: MessageSquare, label: '企业微信推送', path: '/wechat-push' },
  ];

  let menuItems = isAdmin ? adminMenuItems : normalMenuItems;

  if (effectiveModule === 'system' && isAdmin) {
    menuItems = systemMenuItems;
  } else if (effectiveModule === 'baseInfo') {
    menuItems = baseInfoMenuItems;
  } else if (effectiveModule === 'attendance') {
    menuItems = attendanceMenuItems;
  } else if (effectiveModule === 'payroll') {
    menuItems = payrollMenuItems;
  } else if (effectiveModule === 'inspection') {
    menuItems = inspectionMenuItems;
  } else if (effectiveModule === 'sales') {
    menuItems = salesMenuItems;
  } else if (effectiveModule === 'purchase') {
    menuItems = purchaseMenuItems;
  } else if (effectiveModule === 'dashboard') {
    menuItems = dashboardMenuItems;
  } else if (effectiveModule === 'staffChannel') {
    menuItems = staffChannelMenuItems;
  } else if (effectiveModule === 'coaching') {
    menuItems = coachingMenuItems;
  } else if (effectiveModule === 'automation') {
    menuItems = automationMenuItems;
  } else if (effectiveModule === 'directSales') {
    menuItems = directSalesMenuItems;
  } else if (effectiveModule === 'douyin') {
    menuItems = douyinMenuItems;
  } else if (effectiveModule === 'xixie') {
    menuItems = xixieMenuItems;
  } else if (effectiveModule === 'financial') {
    menuItems = financialMenuItems;
  } else if (effectiveModule === 'score') {
    menuItems = scoreMenuItems;
  } else if (effectiveModule === 'warehouse') {
    menuItems = warehouseMenuItems;
  } else if (effectiveModule === 'reimbursement') {
    menuItems = reimbursementMenuItems;
  } else if (effectiveModule === 'pk') {
    menuItems = pkMenuItems;
  } else if (effectiveModule === 'asset') {
    menuItems = assetMenuItems;
  } else if (effectiveModule === 'growthClassroom') {
    menuItems = growthClassroomMenuItems;
  }

  return (
    <div className={`min-h-screen bg-gray-50 mobile-wide-150${className ? ` ${className}` : ''}`}>
      <div className="flex">
        {/* 移动端菜单遮罩 */}
        {menuOpen && (
          <div className="fixed inset-0 bg-black/30 z-30 lg:hidden" onClick={closeMenu} />
        )}
        <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-white shadow-sm flex flex-col transform transition-transform duration-200 ${menuOpen ? 'translate-x-0' : '-translate-x-full'} lg:static lg:translate-x-0 lg:transform-none lg:flex-shrink-0 lg:min-h-screen`}>
          <div className="p-6 border-b border-gray-100 flex items-center justify-between">
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <img src="/logo.jpg" alt="logo" className="h-6 w-6 object-contain" />
              卡迪高运营管理系统
            </h1>
            <button className="lg:hidden p-1.5 -mr-1.5 rounded-lg hover:bg-gray-100 text-gray-600" onClick={closeMenu} aria-label="关闭菜单">
              <X size={20} />
            </button>
          </div>
          <nav className="p-4 flex-1">
            <ul className="space-y-2">
{menuItems.filter(isMenuItemVisible).map((item) => (
                <li key={item.menuEn || item.path}>
                  <button
                    onClick={() => {
                      if (item.path === '/') {
                        clearModule();
                      }
                      setTimeout(() => {
                        navigate(item.path);
                        closeMenu();
                      }, 0);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                      (item.path.includes('?')
                        ? window.location.pathname + window.location.search === item.path
                        : window.location.pathname === item.path)
                        ? 'bg-primary text-white'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <item.icon size={20} />
                    <span className={`font-medium ${item.label === '系统门户' ? 'font-bold text-red-600' : ''}`}>
                      {item.label === '系统门户' && <span className="bg-red-100 px-2 py-0.5 rounded-full mr-1">★</span>}
                      {item.label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="w-64 p-4 border-t border-gray-100 mt-auto">
            <div className="text-center mb-4">
              <p className="text-sm text-gray-600">欢迎您，<span className="font-medium">{user?.userName}</span></p>
            </div>
            <button
              onClick={() => navigate('/users/change-password')}
              className="w-full flex items-center gap-3 px-4 py-2 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors mb-2"
            >
              <Settings size={18} />
              <span className="font-medium">修改密码</span>
            </button>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut size={18} />
              <span className="font-medium">退出登录</span>
            </button>
          </div>
        </aside>

        <main className="flex-1 min-w-0 min-h-screen bg-gray-50">
          <header className="bg-white shadow-sm px-4 sm:px-6 py-4 sticky top-0 z-10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 sm:gap-3">
                <button className="lg:hidden p-1.5 rounded-lg hover:bg-gray-100 text-gray-700" onClick={() => setMenuOpen(true)} aria-label="打开菜单">
                  <Menu size={22} />
                </button>
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-gray-800">{title}</h2>
                  {subtitle && <p className="text-gray-500 text-sm mt-1">{subtitle}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-4">
                <span className="text-gray-600 text-sm">
                  您好, <span className="font-medium">{user?.userName}</span>
                </span>
              </div>
            </div>
          </header>
          <div className="p-2 sm:p-4 lg:p-6 overflow-x-auto">
            <div className="min-w-0 w-full">
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default Layout;
