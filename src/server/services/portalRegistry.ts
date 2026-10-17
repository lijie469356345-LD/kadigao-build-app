import sql from 'mssql';
import { getPool } from '../../config/db';

// LD_Zxtmh: 门户明细映射表，记录菜单/页面与数据库表的对应关系
export async function ensurePortalTable() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'LD_Zxtmh')
    CREATE TABLE LD_Zxtmh (
      id INT IDENTITY(1,1) PRIMARY KEY,
      portalCn NVARCHAR(100) NOT NULL,
      portalEn NVARCHAR(100) NOT NULL,
      menuCn NVARCHAR(100) NOT NULL,
      menuEn NVARCHAR(100) NOT NULL,
      tableName NVARCHAR(200),
      routePath NVARCHAR(200),
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);
}

export async function registerPortalEntry(entry: {
  portalCn: string; portalEn: string; menuCn: string; menuEn: string; tableName?: string; routePath?: string;
}) {
  try {
    await ensurePortalTable();
    const pool = await getPool();
    await pool.request()
      .input('pc', sql.NVarChar, entry.portalCn)
      .input('pe', sql.NVarChar, entry.portalEn)
      .input('mc', sql.NVarChar, entry.menuCn)
      .input('me', sql.NVarChar, entry.menuEn)
      .input('tn', sql.NVarChar, entry.tableName || '')
      .input('rp', sql.NVarChar, entry.routePath || '')
      .query(`
        IF EXISTS (SELECT * FROM LD_Zxtmh WHERE portalEn=@pe AND menuEn=@me)
          UPDATE LD_Zxtmh SET portalCn=@pc, menuCn=@mc, tableName=@tn, routePath=@rp WHERE portalEn=@pe AND menuEn=@me
        ELSE
          INSERT INTO LD_Zxtmh (portalCn, portalEn, menuCn, menuEn, tableName, routePath)
          VALUES (@pc, @pe, @mc, @me, @tn, @rp)
      `);
  } catch { /* 静默忽略 */ }
}

// 菜单注册单一数据源：LD_Zxtmh 注册 + sys_role_menu 角色授权种子共用
export interface PortalMenuEntry {
  masterPortalCn?: string; masterPortalEn?: string; // 主门户（一级）维度：新层级框架 主门户 → 门户 → 菜单
  portalCn: string; portalEn: string; menuCn: string; menuEn: string; tableName?: string; routePath?: string;
  isMenu?: boolean; // false = 子表/明细表（不在门户和侧边栏展示，也不在权限管理中展示）
}

// 主门户（一级）顺序：附件新层级框架 1 系统管理 / 2 人事绩效 / 3 财务结算 / 4 行政资产 / 5 采购·商品 / 6 销售业务 / 7 门店运营 / 9 特色业务 / 10 消息工作台（附件原稿缺 8 号，按原样保留）
export const PORTAL_MASTERS: { masterPortalEn: string; masterPortalCn: string }[] = [
  { masterPortalEn: 'masterSystem', masterPortalCn: '系统管理' },
  { masterPortalEn: 'masterHr', masterPortalCn: '人事绩效' },
  { masterPortalEn: 'masterFinance', masterPortalCn: '财务结算' },
  { masterPortalEn: 'masterAdmin', masterPortalCn: '行政资产' },
  { masterPortalEn: 'masterMerch', masterPortalCn: '采购/商品' },
  { masterPortalEn: 'masterSalesBiz', masterPortalCn: '销售业务' },
  { masterPortalEn: 'masterStoreOps', masterPortalCn: '门店运营' },
  { masterPortalEn: 'masterFeature', masterPortalCn: '特色业务' },
  { masterPortalEn: 'masterDesk', masterPortalCn: '消息工作台' },
];

// 成长课堂 8 个分类菜单（授权粒度与页面分类一一对应，供 portalRegistry/v3SeedData/权限读取/数据校验共用）
// catCode 对应 GC_Category.catCode（GC_ 前缀菜单为上传资料入口，不映射到资料分类）
export const GC_CLASS_MENUS: { menuEn: string; menuCn: string; catCode: string }[] = [
  { menuEn: 'gcUpload', menuCn: '上传资料', catCode: '' },
  { menuEn: 'gcProduct', menuCn: '品研中心（商品）', catCode: 'product' },
  { menuEn: 'gcHr', menuCn: '人才发展（人事）', catCode: 'hr' },
  { menuEn: 'gcOps', menuCn: '运营智库（运营）', catCode: 'ops' },
  { menuEn: 'gcFinance', menuCn: '财务规范（财务）', catCode: 'finance' },
  { menuEn: 'gcAdmin', menuCn: '行政指南（行政）', catCode: 'admin' },
  { menuEn: 'gcSysops', menuCn: '系统实操（实操）', catCode: 'sysops' },
  { menuEn: 'gcMember', menuCn: '会员研习（会员）', catCode: 'member' },
];

// 成长课堂旧版整体授权菜单标识（历史 sys_role_menu 记录，读取/保存时自动展开为 8 个分类）
export const GC_LEGACY_MENU_EN = 'growthClassroom';

// 旧版整体授权键展开：growthClassroom:growthClassroom → 8 个分类授权键（去重，与已存在的新键合并）
//  - 老库（只有旧整体键）→ 展开为 8 个分类键
//  - 新库（分类键已补种）→ 原样保留分类键，旧整体键展开后与分类键去重
//  - 其余门户/菜单键原样保留
export function expandLegacyMenuKeys(rows: { portalEn: string; menuEn: string }[]): { portalEn: string; menuEn: string }[] {
  const out: { portalEn: string; menuEn: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.portalEn === 'growthClassroom') {
      if (row.menuEn === GC_LEGACY_MENU_EN) {
        for (const m of GC_CLASS_MENUS) {
          const k = `growthClassroom:${m.menuEn}`;
          if (!seen.has(k)) {
            seen.add(k);
            out.push({ portalEn: 'growthClassroom', menuEn: m.menuEn });
          }
        }
        continue;
      }
      const k = `growthClassroom:${row.menuEn}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(row);
      }
      continue;
    }
    out.push(row);
  }
  return out;
}

// 门户入口默认路由（点击门户卡片进入的主页；未配置时回退 portalEn 直连路径）
export const PORTAL_DEFAULT_ROUTES: Record<string, string> = {
  system: '/system',
  baseInfo: '/register-audit',
  attendance: '/attendance/clock-in',
  payroll: '/payroll/salary-scheme',
  purchase: '/purchase',
  dashboard: '/dashboard',
  inspection: '/inspection',
  sales: '/reports',
  staffChannel: '/staff-channel',
  automation: '/automation',
  directSales: '/direct-sales-summary',
  coaching: '/coaching-stores',
  douyin: '/douyin/fudai',
  xixie: '/xixie/cost',
  financial: '/financial/revenue-profit',
  score: '/score-warning',
  warehouse: '/warehouse',
  reimbursement: '/reimbursement',
  pk: '/pk-report',
  asset: '/asset/fixed-assets',
  growthClassroom: '/asset/growth-classroom',
};

export const PORTAL_MENU_ENTRIES: PortalMenuEntry[] = [
    // ===================== 1 系统管理 =====================
    // 系统管理：数据库连接/数据提取/系统维护/企微推送 + 权限管理（自基础资料迁回）；店铺档案、陪跑店铺管理、用户管理、组织管理、注册审核、职位管理 归属所属主门户
    { masterPortalCn: '系统管理', masterPortalEn: 'masterSystem', portalCn: '系统管理', portalEn: 'system', menuCn: '数据库连接', menuEn: 'databaseConfig', tableName: '', routePath: '/database' },
    { masterPortalCn: '系统管理', masterPortalEn: 'masterSystem', portalCn: '系统管理', portalEn: 'system', menuCn: '数据提取', menuEn: 'dataExtraction', tableName: 'DataExtraction', routePath: '/data-extraction' },
    { masterPortalCn: '系统管理', masterPortalEn: 'masterSystem', portalCn: '系统管理', portalEn: 'system', menuCn: '系统维护', menuEn: 'systemMaintenance', tableName: '', routePath: '/maintenance' },
    { masterPortalCn: '系统管理', masterPortalEn: 'masterSystem', portalCn: '系统管理', portalEn: 'system', menuCn: '企微推送', menuEn: 'wechatPush', tableName: 'WechatPushSettings', routePath: '/wechat-push' },
    // 权限管理（自基础资料迁回系统管理）
    { masterPortalCn: '系统管理', masterPortalEn: 'masterSystem', portalCn: '系统管理', portalEn: 'system', menuCn: '权限管理', menuEn: 'permissions', tableName: 'GroupPermissions', routePath: '/permissions' },
    // 权限管理子表（随权限管理迁回系统管理）
    { masterPortalCn: '系统管理', masterPortalEn: 'masterSystem', portalCn: '系统管理', portalEn: 'system', menuCn: '角色管理', menuEn: 'sysRole', tableName: 'sys_role', routePath: '/permissions', isMenu: false },
    { masterPortalCn: '系统管理', masterPortalEn: 'masterSystem', portalCn: '系统管理', portalEn: 'system', menuCn: '角色菜单授权', menuEn: 'sysRoleMenu', tableName: 'sys_role_menu', routePath: '/permissions', isMenu: false },
    // 企微推送子表
    { masterPortalCn: '系统管理', masterPortalEn: 'masterSystem', portalCn: '系统管理', portalEn: 'system', menuCn: '推送历史', menuEn: 'wechatPushHistory', tableName: 'WechatPushHistory', routePath: '/wechat-push', isMenu: false },
    { masterPortalCn: '系统管理', masterPortalEn: 'masterSystem', portalCn: '系统管理', portalEn: 'system', menuCn: '推送历史V2', menuEn: 'wechatPushHistoryV2', tableName: 'WechatPushHistoryV2', routePath: '/wechat-push', isMenu: false },
    { masterPortalCn: '系统管理', masterPortalEn: 'masterSystem', portalCn: '系统管理', portalEn: 'system', menuCn: '推送日志', menuEn: 'wechatPushLogs', tableName: 'WechatPushLogs', routePath: '/wechat-push', isMenu: false },
    { masterPortalCn: '系统管理', masterPortalEn: 'masterSystem', portalCn: '系统管理', portalEn: 'system', menuCn: '推送日志V2', menuEn: 'wechatPushLogsV2', tableName: 'WechatPushLogsV2', routePath: '/wechat-push', isMenu: false },
    { masterPortalCn: '系统管理', masterPortalEn: 'masterSystem', portalCn: '系统管理', portalEn: 'system', menuCn: '推送模块', menuEn: 'wechatPushModules', tableName: 'WechatPushModules', routePath: '/wechat-push', isMenu: false },
    { masterPortalCn: '系统管理', masterPortalEn: 'masterSystem', portalCn: '系统管理', portalEn: 'system', menuCn: '推送队列', menuEn: 'wechatPushQueue', tableName: 'WechatPushQueue', routePath: '/wechat-push', isMenu: false },
    { masterPortalCn: '系统管理', masterPortalEn: 'masterSystem', portalCn: '系统管理', portalEn: 'system', menuCn: '推送接收人', menuEn: 'wechatPushRecipients', tableName: 'WechatPushRecipients', routePath: '/wechat-push', isMenu: false },
    { masterPortalCn: '系统管理', masterPortalEn: 'masterSystem', portalCn: '系统管理', portalEn: 'system', menuCn: '推送模板', menuEn: 'wechatPushTemplate', tableName: 'WechatPushTemplate', routePath: '/wechat-push', isMenu: false },
    { masterPortalCn: '系统管理', masterPortalEn: 'masterSystem', portalCn: '系统管理', portalEn: 'system', menuCn: '推送模板字段', menuEn: 'wechatPushTemplateFields', tableName: 'WechatPushTemplateFields', routePath: '/wechat-push', isMenu: false },
    { masterPortalCn: '系统管理', masterPortalEn: 'masterSystem', portalCn: '系统管理', portalEn: 'system', menuCn: '推送模板V2', menuEn: 'wechatPushTemplateV2', tableName: 'WechatPushTemplateV2', routePath: '/wechat-push', isMenu: false },
    // ===================== 2 人事绩效 =====================
    // 基础资料（迁入：注册审核/组织管理/权限管理/职位管理/店铺档案/用户管理；新增占位：入职/转正/调岗/离职）
    { masterPortalCn: '人事绩效', masterPortalEn: 'masterHr', portalCn: '基础资料', portalEn: 'baseInfo', menuCn: '注册审核', menuEn: 'registerAudit', tableName: 'register_apply', routePath: '/register-audit' },
    { masterPortalCn: '人事绩效', masterPortalEn: 'masterHr', portalCn: '基础资料', portalEn: 'baseInfo', menuCn: '组织管理', menuEn: 'orgManage', tableName: 'sys_org', routePath: '/org-manage' },
    { masterPortalCn: '人事绩效', masterPortalEn: 'masterHr', portalCn: '基础资料', portalEn: 'baseInfo', menuCn: '职位管理', menuEn: 'positions', tableName: 'sys_position', routePath: '/positions' },
    { masterPortalCn: '人事绩效', masterPortalEn: 'masterHr', portalCn: '基础资料', portalEn: 'baseInfo', menuCn: '店铺档案', menuEn: 'shopArchive', tableName: 'DataExtraction', routePath: '/shops' },
    { masterPortalCn: '人事绩效', masterPortalEn: 'masterHr', portalCn: '基础资料', portalEn: 'baseInfo', menuCn: '用户管理', menuEn: 'users', tableName: 'UserGroups', routePath: '/users' },
    { masterPortalCn: '人事绩效', masterPortalEn: 'masterHr', portalCn: '基础资料', portalEn: 'baseInfo', menuCn: '入职管理', menuEn: 'onboarding', tableName: 'onboarding_record', routePath: '/base/onboarding' },
    { masterPortalCn: '人事绩效', masterPortalEn: 'masterHr', portalCn: '基础资料', portalEn: 'baseInfo', menuCn: '工牌制作统计台账', menuEn: 'onboardingBadge', tableName: 'onboarding_badge_ledger', routePath: '/base/onboarding-badge' },
    { masterPortalCn: '人事绩效', masterPortalEn: 'masterHr', portalCn: '基础资料', portalEn: 'baseInfo', menuCn: '内购卡调整', menuEn: 'onboardingCardAdjust', tableName: 'onboarding_card_adjust', routePath: '/base/onboarding-card-adjust' },
    { masterPortalCn: '人事绩效', masterPortalEn: 'masterHr', portalCn: '基础资料', portalEn: 'baseInfo', menuCn: '转正管理', menuEn: 'regularization', tableName: '', routePath: '/base/regularization' },
    { masterPortalCn: '人事绩效', masterPortalEn: 'masterHr', portalCn: '基础资料', portalEn: 'baseInfo', menuCn: '调岗管理', menuEn: 'transfer', tableName: '', routePath: '/base/transfer' },
    { masterPortalCn: '人事绩效', masterPortalEn: 'masterHr', portalCn: '基础资料', portalEn: 'baseInfo', menuCn: '离职管理', menuEn: 'resignation', tableName: '', routePath: '/base/resignation' },
    // 用户子表（随用户管理留在基础资料）
    { masterPortalCn: '人事绩效', masterPortalEn: 'masterHr', portalCn: '基础资料', portalEn: 'baseInfo', menuCn: '用户角色绑定', menuEn: 'sysUserRole', tableName: 'sys_user_role', routePath: '/users', isMenu: false },
    // 考勤（新增门户，菜单占位）
    { masterPortalCn: '人事绩效', masterPortalEn: 'masterHr', portalCn: '考勤', portalEn: 'attendance', menuCn: '打卡', menuEn: 'clockIn', tableName: '', routePath: '/attendance/clock-in' },
    { masterPortalCn: '人事绩效', masterPortalEn: 'masterHr', portalCn: '考勤', portalEn: 'attendance', menuCn: '排班', menuEn: 'schedule', tableName: '', routePath: '/attendance/schedule' },
    { masterPortalCn: '人事绩效', masterPortalEn: 'masterHr', portalCn: '考勤', portalEn: 'attendance', menuCn: '考勤报表', menuEn: 'attendanceReport', tableName: '', routePath: '/attendance/report' },
    // 自动薪资（新增门户，菜单占位）
    { masterPortalCn: '人事绩效', masterPortalEn: 'masterHr', portalCn: '自动薪资', portalEn: 'payroll', menuCn: '薪资方案', menuEn: 'salaryScheme', tableName: '', routePath: '/payroll/salary-scheme' },
    { masterPortalCn: '人事绩效', masterPortalEn: 'masterHr', portalCn: '自动薪资', portalEn: 'payroll', menuCn: '薪资核算', menuEn: 'salaryCalculation', tableName: '', routePath: '/payroll/salary-calculation' },
    { masterPortalCn: '人事绩效', masterPortalEn: 'masterHr', portalCn: '自动薪资', portalEn: 'payroll', menuCn: '薪资档案管理', menuEn: 'salaryArchive', tableName: '', routePath: '/payroll/salary-archive' },
    // ===================== 3 财务结算 =====================
    // 费用报销（按附件顺序：审批流设计/预付款申请/预算管控/欠款查询/账簿管理/账簿查询/借款申请/付款记录/报销主页/费用报表/凭证记录）
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '费用报销', portalEn: 'reimbursement', menuCn: '审批流设计', menuEn: 'reimbursementApproval', tableName: 'ApprovalFlow', routePath: '/reimbursement/approval' },
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '费用报销', portalEn: 'reimbursement', menuCn: '预付款申请', menuEn: 'advancePayment', tableName: 'AdvancePayment', routePath: '/reimbursement/advance-payment' },
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '费用报销', portalEn: 'reimbursement', menuCn: '预算管控', menuEn: 'budgetControl', tableName: 'BudgetConfig', routePath: '/reimbursement/budget' },
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '费用报销', portalEn: 'reimbursement', menuCn: '欠款查询', menuEn: 'debtQuery', tableName: 'EmployeeAdvance', routePath: '/reimbursement/debt-query' },
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '费用报销', portalEn: 'reimbursement', menuCn: '账簿管理', menuEn: 'ledgerManage', tableName: 'LedgerAccount', routePath: '/reimbursement/ledger-manage' },
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '费用报销', portalEn: 'reimbursement', menuCn: '账簿查询', menuEn: 'ledgerQuery', tableName: 'LedgerAccount', routePath: '/reimbursement/ledger-query' },
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '费用报销', portalEn: 'reimbursement', menuCn: '借款申请', menuEn: 'loanApplication', tableName: 'EmployeeAdvance', routePath: '/reimbursement/expense-application' },
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '费用报销', portalEn: 'reimbursement', menuCn: '付款记录', menuEn: 'paymentRecord', tableName: 'PaymentRecord', routePath: '/reimbursement/payment-record' },
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '费用报销', portalEn: 'reimbursement', menuCn: '报销主页', menuEn: 'reimbursementHome', tableName: 'Reimbursement', routePath: '/reimbursement/home' },
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '费用报销', portalEn: 'reimbursement', menuCn: '费用报表', menuEn: 'reimbursementReport', tableName: 'Reimbursement', routePath: '/reimbursement/report' },
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '费用报销', portalEn: 'reimbursement', menuCn: '凭证记录', menuEn: 'reimbursementVoucher', tableName: 'ReimbursementVoucher', routePath: '/reimbursement/voucher' },
    // 费用报销子表
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '费用报销', portalEn: 'reimbursement', menuCn: '审批任务', menuEn: 'approvalTask', tableName: 'ApprovalTask', routePath: '/reimbursement/approval', isMenu: false },
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '费用报销', portalEn: 'reimbursement', menuCn: '报销附件', menuEn: 'reimbursementAttachment', tableName: 'ReimbursementAttachment', routePath: '/reimbursement/home', isMenu: false },
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '费用报销', portalEn: 'reimbursement', menuCn: '报销明细', menuEn: 'reimbursementItem', tableName: 'ReimbursementItem', routePath: '/reimbursement/home', isMenu: false },
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '费用报销', portalEn: 'reimbursement', menuCn: '报销模板', menuEn: 'reimbursementTemplate', tableName: 'ReimbursementTemplate', routePath: '/reimbursement/home', isMenu: false },
    // 财务年度评估（按附件顺序：投入产出分析/无成本价商品/租售比分析/营收利润分析/工资分析/店铺费用分析）
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '财务年度评估', portalEn: 'financial', menuCn: '投入产出分析', menuEn: 'inputOutputAnalysis', tableName: '有效业绩全', routePath: '/financial/input-output' },
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '财务年度评估', portalEn: 'financial', menuCn: '无成本价商品', menuEn: 'noCostPriceProduct', tableName: '价格刘全', routePath: '/financial/no-cost-price-product' },
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '财务年度评估', portalEn: 'financial', menuCn: '租售比分析', menuEn: 'rentRatioAnalysis', tableName: '有效业绩全', routePath: '/financial/rent-ratio' },
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '财务年度评估', portalEn: 'financial', menuCn: '营收利润分析', menuEn: 'revenueProfitAnalysis', tableName: '有效业绩全', routePath: '/financial/revenue-profit' },
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '财务年度评估', portalEn: 'financial', menuCn: '工资分析', menuEn: 'salaryAnalysis', tableName: '有效业绩全', routePath: '/financial/salary' },
    { masterPortalCn: '财务结算', masterPortalEn: 'masterFinance', portalCn: '财务年度评估', portalEn: 'financial', menuCn: '店铺费用分析', menuEn: 'storeCostAnalysis', tableName: '有效业绩全', routePath: '/financial/store-cost' },
    // ===================== 4 行政资产 =====================
    // 培训反馈
    { masterPortalCn: '行政资产', masterPortalEn: 'masterAdmin', portalCn: '培训反馈', portalEn: 'staffChannel', menuCn: '反馈明细表', menuEn: 'feedbackDetails', tableName: 'FeedbackDetails', routePath: '/staff-channel/details' },
    { masterPortalCn: '行政资产', masterPortalEn: 'masterAdmin', portalCn: '培训反馈', portalEn: 'staffChannel', menuCn: '反馈任务单', menuEn: 'feedbackTasks', tableName: 'FeedbackTasks', routePath: '/staff-channel/tasks' },
    { masterPortalCn: '行政资产', masterPortalEn: 'masterAdmin', portalCn: '培训反馈', portalEn: 'staffChannel', menuCn: '全员通道', menuEn: 'staffChannelHome', tableName: '', routePath: '/staff-channel' },
    // 资产管理（盘点明细/出车归还记录/车辆维保/车辆违章 由子表提升为菜单）
    { masterPortalCn: '行政资产', masterPortalEn: 'masterAdmin', portalCn: '资产管理', portalEn: 'asset', menuCn: '授权人管理', menuEn: 'authorizedPersons', tableName: 'FA_AuthorizedPersons', routePath: '/asset/authorized-persons' },
    { masterPortalCn: '行政资产', masterPortalEn: 'masterAdmin', portalCn: '资产管理', portalEn: 'asset', menuCn: '固定资产', menuEn: 'fixedAssets', tableName: 'FA_Assets', routePath: '/asset/fixed-assets' },
    { masterPortalCn: '行政资产', masterPortalEn: 'masterAdmin', portalCn: '资产管理', portalEn: 'asset', menuCn: '申请用车', menuEn: 'vehicleApply', tableName: 'VA_Application', routePath: '/asset/vehicle-apply' },
    { masterPortalCn: '行政资产', masterPortalEn: 'masterAdmin', portalCn: '资产管理', portalEn: 'asset', menuCn: '车辆管理', menuEn: 'vehicleManage', tableName: 'VM_Vehicles', routePath: '/asset/vehicle-manage' },
    { masterPortalCn: '行政资产', masterPortalEn: 'masterAdmin', portalCn: '资产管理', portalEn: 'asset', menuCn: '报废处置', menuEn: 'assetDisposal', tableName: 'FA_Disposal', routePath: '/asset/fixed-assets' },
    { masterPortalCn: '行政资产', masterPortalEn: 'masterAdmin', portalCn: '资产管理', portalEn: 'asset', menuCn: '资产分布', menuEn: 'assetDistribution', tableName: 'FA_AssetDistribution', routePath: '/asset/fixed-assets' },
    { masterPortalCn: '行政资产', masterPortalEn: 'masterAdmin', portalCn: '资产管理', portalEn: 'asset', menuCn: '资产盘点', menuEn: 'assetInventory', tableName: 'FA_Inventory', routePath: '/asset/fixed-assets' },
    { masterPortalCn: '行政资产', masterPortalEn: 'masterAdmin', portalCn: '资产管理', portalEn: 'asset', menuCn: '资产变动', menuEn: 'assetTransfer', tableName: 'FA_TransferLog', routePath: '/asset/fixed-assets' },
    { masterPortalCn: '行政资产', masterPortalEn: 'masterAdmin', portalCn: '资产管理', portalEn: 'asset', menuCn: '折旧方案', menuEn: 'depreciationScheme', tableName: 'FA_DepreciationScheme', routePath: '/asset/fixed-assets' },
    { masterPortalCn: '行政资产', masterPortalEn: 'masterAdmin', portalCn: '资产管理', portalEn: 'asset', menuCn: '盘点明细', menuEn: 'inventoryDetail', tableName: 'FA_InventoryDetail', routePath: '/asset/inventory-detail' },
    { masterPortalCn: '行政资产', masterPortalEn: 'masterAdmin', portalCn: '资产管理', portalEn: 'asset', menuCn: '出车归还记录', menuEn: 'vehicleDepartureReturn', tableName: 'VA_DepartureReturn', routePath: '/asset/vehicle-departure-return' },
    { masterPortalCn: '行政资产', masterPortalEn: 'masterAdmin', portalCn: '资产管理', portalEn: 'asset', menuCn: '车辆维保', menuEn: 'vehicleMaintenance', tableName: 'VM_Maintenance', routePath: '/asset/vehicle-maintenance' },
    { masterPortalCn: '行政资产', masterPortalEn: 'masterAdmin', portalCn: '资产管理', portalEn: 'asset', menuCn: '车辆违章', menuEn: 'vehicleViolation', tableName: 'VM_Violation', routePath: '/asset/vehicle-violation' },
    // 成长课堂（行政资产主门户下的新门户：8 个分类菜单分别授权，页面分类切换与侧边栏显示均按授权过滤）
    ...GC_CLASS_MENUS.map((m) => ({ masterPortalCn: '行政资产', masterPortalEn: 'masterAdmin', portalCn: '成长课堂', portalEn: 'growthClassroom', menuCn: m.menuCn, menuEn: m.menuEn, tableName: 'GC_Material', routePath: '/asset/growth-classroom' })),
    // ===================== 5 采购/商品 =====================
    // 采购管理（按附件顺序：畅销款排行/商品部计划/往期订单/往期销售/商品利润评估/采购管理/季度销售评估/建议配码/供应商评估）
    { masterPortalCn: '采购/商品', masterPortalEn: 'masterMerch', portalCn: '采购管理', portalEn: 'purchase', menuCn: '畅销款排行', menuEn: 'bestSeller', tableName: 'DataExtraction', routePath: '/best-seller' },
    { masterPortalCn: '采购/商品', masterPortalEn: 'masterMerch', portalCn: '采购管理', portalEn: 'purchase', menuCn: '商品部计划', menuEn: 'merchandisePlan', tableName: '', routePath: '/purchase/merchandise-plan' },
    { masterPortalCn: '采购/商品', masterPortalEn: 'masterMerch', portalCn: '采购管理', portalEn: 'purchase', menuCn: '往期订单', menuEn: 'previousOrders', tableName: '', routePath: '/purchase/previous-orders' },
    { masterPortalCn: '采购/商品', masterPortalEn: 'masterMerch', portalCn: '采购管理', portalEn: 'purchase', menuCn: '往期销售', menuEn: 'previousSales', tableName: '', routePath: '/purchase/previous-sales' },
    { masterPortalCn: '采购/商品', masterPortalEn: 'masterMerch', portalCn: '采购管理', portalEn: 'purchase', menuCn: '商品利润评估', menuEn: 'profitEvaluation', tableName: '', routePath: '/purchase/profit-evaluation' },
    { masterPortalCn: '采购/商品', masterPortalEn: 'masterMerch', portalCn: '采购管理', portalEn: 'purchase', menuCn: '采购管理', menuEn: 'purchaseHome', tableName: '', routePath: '/purchase' },
    { masterPortalCn: '采购/商品', masterPortalEn: 'masterMerch', portalCn: '采购管理', portalEn: 'purchase', menuCn: '季度销售评估', menuEn: 'quarterlyEvaluation', tableName: '', routePath: '/purchase/quarterly-evaluation' },
    { masterPortalCn: '采购/商品', masterPortalEn: 'masterMerch', portalCn: '采购管理', portalEn: 'purchase', menuCn: '建议配码', menuEn: 'suggestedCode', tableName: '', routePath: '/purchase/suggested-code' },
    { masterPortalCn: '采购/商品', masterPortalEn: 'masterMerch', portalCn: '采购管理', portalEn: 'purchase', menuCn: '供应商评估', menuEn: 'supplierEvaluation', tableName: '', routePath: '/purchase/supplier-evaluation' },
    // 自动化管理（按附件顺序：自动分货/自动并货/自动补货/初始并货表/线上并货）
    { masterPortalCn: '采购/商品', masterPortalEn: 'masterMerch', portalCn: '自动化管理', portalEn: 'automation', menuCn: '自动分货', menuEn: 'autoDistribute', tableName: '', routePath: '/automation/distribute' },
    { masterPortalCn: '采购/商品', masterPortalEn: 'masterMerch', portalCn: '自动化管理', portalEn: 'automation', menuCn: '自动并货', menuEn: 'autoMerge', tableName: '', routePath: '/automation/merge' },
    { masterPortalCn: '采购/商品', masterPortalEn: 'masterMerch', portalCn: '自动化管理', portalEn: 'automation', menuCn: '自动补货', menuEn: 'autoReplenish', tableName: 'ReplenishParams', routePath: '/automation/replenish' },
    { masterPortalCn: '采购/商品', masterPortalEn: 'masterMerch', portalCn: '自动化管理', portalEn: 'automation', menuCn: '初始并货表', menuEn: 'initialMerge', tableName: '今日库存全', routePath: '/automation/initial' },
    { masterPortalCn: '采购/商品', masterPortalEn: 'masterMerch', portalCn: '自动化管理', portalEn: 'automation', menuCn: '线上并货', menuEn: 'onlineMerge', tableName: '线上调拨记录', routePath: '/automation/online-merge' },
    // 自动化管理子表
    { masterPortalCn: '采购/商品', masterPortalEn: 'masterMerch', portalCn: '自动化管理', portalEn: 'automation', menuCn: '补货结果', menuEn: 'replenishResult', tableName: 'ReplenishResult', routePath: '/automation/replenish', isMenu: false },
    { masterPortalCn: '采购/商品', masterPortalEn: 'masterMerch', portalCn: '自动化管理', portalEn: 'automation', menuCn: '补货选中SKU', menuEn: 'replenishSelectedSku', tableName: 'ReplenishSelectedSku', routePath: '/automation/replenish', isMenu: false },
    // ===================== 6 销售业务 =====================
    // 店铺评分预警（按附件顺序：店铺检测/店铺整改确认/店铺检查打分表/店铺意见建议/店铺预警表）
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '店铺评分预警', portalEn: 'score', menuCn: '店铺检测', menuEn: 'shopCheck', tableName: 'ShopCheckIndicators', routePath: '/score-warning/check' },
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '店铺评分预警', portalEn: 'score', menuCn: '店铺整改确认', menuEn: 'shopRectification', tableName: 'StoreRectificationItems', routePath: '/score-warning/rectification' },
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '店铺评分预警', portalEn: 'score', menuCn: '店铺检查打分表', menuEn: 'shopScoreTable', tableName: 'StoreScoreRecords', routePath: '/score-warning/score-table' },
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '店铺评分预警', portalEn: 'score', menuCn: '店铺意见建议', menuEn: 'shopSuggestion', tableName: 'ShopSuggestions', routePath: '/score-warning/suggestion' },
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '店铺评分预警', portalEn: 'score', menuCn: '店铺预警表', menuEn: 'shopWarningTable', tableName: 'ShopCheckIndicators', routePath: '/score-warning/warning-table' },
    // 店铺评分预警子表
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '店铺评分预警', portalEn: 'score', menuCn: '意见回复', menuEn: 'suggestionReplies', tableName: 'SuggestionReplies', routePath: '/score-warning/suggestion', isMenu: false },
    // 销售管理（按附件顺序：年度经营看板/对比报表/财务字段/月目标分解/业绩看板/销售报表/店铺诊断/月目标分解店员/店员销售指标/会员报表[新]）
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '销售管理', portalEn: 'sales', menuCn: '年度经营看板', menuEn: 'annualOperationDashboard', tableName: '店仓全', routePath: '/annual-operation-dashboard' },
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '销售管理', portalEn: 'sales', menuCn: '对比报表', menuEn: 'comparisonReport', tableName: '有效业绩全', routePath: '/comparison' },
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '销售管理', portalEn: 'sales', menuCn: '财务字段', menuEn: 'financeField', tableName: '商品全', routePath: '/finance-field' },
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '销售管理', portalEn: 'sales', menuCn: '月目标分解', menuEn: 'monthlyTarget', tableName: 'MonthlyTargetDecomposition', routePath: '/monthly-target-decomposition' },
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '销售管理', portalEn: 'sales', menuCn: '业绩看板', menuEn: 'performanceDashboard', tableName: '有效业绩全', routePath: '/performance-dashboard' },
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '销售管理', portalEn: 'sales', menuCn: '销售报表', menuEn: 'reports', tableName: 'DataExtraction', routePath: '/reports' },
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '销售管理', portalEn: 'sales', menuCn: '店铺诊断', menuEn: 'shopDiagnosis', tableName: '有效业绩全', routePath: '/shop-diagnosis' },
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '销售管理', portalEn: 'sales', menuCn: '月目标分解店员', menuEn: 'staffMonthlyTarget', tableName: 'StaffMonthlyTarget', routePath: '/staff-monthly-target' },
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '销售管理', portalEn: 'sales', menuCn: '店员销售指标', menuEn: 'staffSalesTarget', tableName: '有效业绩全', routePath: '/staff-sales-target' },
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '销售管理', portalEn: 'sales', menuCn: '会员报表', menuEn: 'memberReport', tableName: '', routePath: '/member-report' },
    // 销售管理子表
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '销售管理', portalEn: 'sales', menuCn: '销售对比', menuEn: 'salesComparison', tableName: 'LD_SalesComparison', routePath: '/comparison', isMenu: false },
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '销售管理', portalEn: 'sales', menuCn: '月目标变更', menuEn: 'monthlyTargetChange', tableName: 'MonthlyTargetChangeRequest', routePath: '/monthly-target-decomposition', isMenu: false },
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '销售管理', portalEn: 'sales', menuCn: '月目标日数据', menuEn: 'monthlyTargetDaily', tableName: 'MonthlyTargetDaily', routePath: '/monthly-target-decomposition', isMenu: false },
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '销售管理', portalEn: 'sales', menuCn: '月目标比例', menuEn: 'monthlyTargetRatio', tableName: 'MonthlyTargetRatio', routePath: '/monthly-target-decomposition', isMenu: false },
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '销售管理', portalEn: 'sales', menuCn: '店员月目标变更', menuEn: 'staffMonthlyTargetChange', tableName: 'StaffMonthlyTargetChangeRequest', routePath: '/staff-monthly-target', isMenu: false },
    { masterPortalCn: '销售业务', masterPortalEn: 'masterSalesBiz', portalCn: '销售管理', portalEn: 'sales', menuCn: '店员月目标日数据', menuEn: 'staffMonthlyTargetDaily', tableName: 'StaffMonthlyTargetDaily', routePath: '/staff-monthly-target', isMenu: false },
    // ===================== 7 门店运营 =====================
    // PK管理（按附件顺序：PK日目标跟进/PK日目标上传/PK数据表/PK维度设定/PK报表/PK店铺目标/PK任务单）
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: 'PK管理', portalEn: 'pk', menuCn: 'PK日目标跟进', menuEn: 'pkDailyFollowup', tableName: 'PK_StoreDailyTargets', routePath: '/pk-daily-followup' },
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: 'PK管理', portalEn: 'pk', menuCn: 'PK日目标上传', menuEn: 'pkDailyTarget', tableName: 'PK_StoreDailyTargets', routePath: '/pk-daily-target' },
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: 'PK管理', portalEn: 'pk', menuCn: 'PK数据表', menuEn: 'pkDataTable', tableName: 'PK_StoreTargets', routePath: '/pk-data-table' },
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: 'PK管理', portalEn: 'pk', menuCn: 'PK维度设定', menuEn: 'pkDimensionConfig', tableName: 'PK_Dimensions', routePath: '/pk-dimensions' },
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: 'PK管理', portalEn: 'pk', menuCn: 'PK报表', menuEn: 'pkReport', tableName: 'PK_StoreTargets', routePath: '/pk-report' },
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: 'PK管理', portalEn: 'pk', menuCn: 'PK店铺目标', menuEn: 'pkStoreTarget', tableName: 'PK_StoreTargets', routePath: '/pk-target' },
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: 'PK管理', portalEn: 'pk', menuCn: 'PK任务单', menuEn: 'pkTaskOrder', tableName: 'PK_TaskOrders', routePath: '/pk-task-order' },
    // 巡店管理（按附件顺序：巡店日志/日志未完成统计/评分体系/巡店任务）
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: '巡店管理', portalEn: 'inspection', menuCn: '巡店日志', menuEn: 'logs', tableName: 'StoreInspectionLogs', routePath: '/logs' },
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: '巡店管理', portalEn: 'inspection', menuCn: '日志未完成统计', menuEn: 'logStatistics', tableName: 'StoreInspectionLogs', routePath: '/logs/statistics' },
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: '巡店管理', portalEn: 'inspection', menuCn: '评分体系', menuEn: 'scores', tableName: 'DailyScores', routePath: '/scores' },
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: '巡店管理', portalEn: 'inspection', menuCn: '巡店任务', menuEn: 'tasks', tableName: 'InspectionTasks', routePath: '/tasks' },
    // 巡店管理子表
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: '巡店管理', portalEn: 'inspection', menuCn: '巡店日志明细', menuEn: 'inspectionLogItems', tableName: 'StoreInspectionLogItems', routePath: '/logs', isMenu: false },
    // 运营工作汇报（按附件顺序：日常商品指标上传/日常指标上传/区经运营汇报/商品组长工作汇报/商品店铺工作汇报/督导运营汇报）
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: '运营工作汇报', portalEn: 'directSales', menuCn: '日常商品指标上传', menuEn: 'dailyProductTargetUpload', tableName: 'DailyProductTargets', routePath: '/daily-product-target-upload' },
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: '运营工作汇报', portalEn: 'directSales', menuCn: '日常指标上传', menuEn: 'dailyTargetUpload', tableName: 'DailyShopTargets', routePath: '/daily-target-upload' },
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: '运营工作汇报', portalEn: 'directSales', menuCn: '区经运营汇报', menuEn: 'directSalesSummary', tableName: 'DirectSalesSummary', routePath: '/direct-sales-summary' },
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: '运营工作汇报', portalEn: 'directSales', menuCn: '商品组长工作汇报', menuEn: 'productGroupReport', tableName: 'DirectSalesSummary', routePath: '/direct-sales-summary/product-group' },
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: '运营工作汇报', portalEn: 'directSales', menuCn: '商品店铺工作汇报', menuEn: 'productLeaderReport', tableName: 'DirectSalesSummary', routePath: '/direct-sales-summary/product-leader' },
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: '运营工作汇报', portalEn: 'directSales', menuCn: '督导运营汇报', menuEn: 'supervisorReport', tableName: 'DirectSalesSummary', routePath: '/direct-sales-summary/supervisor' },
    // 运营工作汇报子表
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: '运营工作汇报', portalEn: 'directSales', menuCn: '店铺日指标日数据', menuEn: 'dailyShopTargetDaily', tableName: 'DailyShopTargetDaily', routePath: '/daily-target-upload', isMenu: false },
    { masterPortalCn: '门店运营', masterPortalEn: 'masterStoreOps', portalCn: '运营工作汇报', portalEn: 'directSales', menuCn: '商品日指标日数据', menuEn: 'dailyProductTargetDaily', tableName: 'DailyProductTargetDaily', routePath: '/daily-product-target-upload', isMenu: false },
    // ===================== 9 特色业务 =====================
    // 陪跑跟进（陪跑店铺管理[原系统管理]迁入；按附件顺序：陪跑店铺管理/陪跑跟进/时段业绩播报）
    { masterPortalCn: '特色业务', masterPortalEn: 'masterFeature', portalCn: '陪跑跟进', portalEn: 'coaching', menuCn: '陪跑店铺管理', menuEn: 'coachingStores', tableName: 'CoachingStores', routePath: '/coaching-stores' },
    { masterPortalCn: '特色业务', masterPortalEn: 'masterFeature', portalCn: '陪跑跟进', portalEn: 'coaching', menuCn: '陪跑跟进', menuEn: 'coaching', tableName: 'CoachingStores', routePath: '/coaching' },
    { masterPortalCn: '特色业务', masterPortalEn: 'masterFeature', portalCn: '陪跑跟进', portalEn: 'coaching', menuCn: '时段业绩播报', menuEn: 'hourlyPerformance', tableName: '有效业绩全', routePath: '/hourly-performance' },
    // 仓库管理
    { masterPortalCn: '特色业务', masterPortalEn: 'masterFeature', portalCn: '仓库管理', portalEn: 'warehouse', menuCn: '仓库扫码入库', menuEn: 'scanInbound', tableName: 'WarehouseScanRecords', routePath: '/warehouse/scan' },
    // 仓库管理子表
    { masterPortalCn: '特色业务', masterPortalEn: 'masterFeature', portalCn: '仓库管理', portalEn: 'warehouse', menuCn: '仓库客户映射', menuEn: 'warehouseCustomerMap', tableName: 'WarehouseCustomerMap', routePath: '/warehouse/scan', isMenu: false },
    // 抖音专区
    { masterPortalCn: '特色业务', masterPortalEn: 'masterFeature', portalCn: '抖音专区', portalEn: 'douyin', menuCn: '福袋', menuEn: 'fuDai', tableName: '用券全', routePath: '/douyin/fudai' },
    { masterPortalCn: '特色业务', masterPortalEn: 'masterFeature', portalCn: '抖音专区', portalEn: 'douyin', menuCn: '好评会员', menuEn: 'goodReviewMember', tableName: '促销全', routePath: '/douyin/haoping' },
    { masterPortalCn: '特色业务', masterPortalEn: 'masterFeature', portalCn: '抖音专区', portalEn: 'douyin', menuCn: '袜子转化', menuEn: 'sockConversion', tableName: '用券全', routePath: '/douyin/wazi' },
    // 洗鞋养护专区（按附件顺序：洗鞋服务反馈/洗鞋费用上传/洗鞋投放上传/洗鞋汇总报表/洗鞋核销上传）
    { masterPortalCn: '特色业务', masterPortalEn: 'masterFeature', portalCn: '洗鞋养护专区', portalEn: 'xixie', menuCn: '洗鞋服务反馈', menuEn: 'shoeFeedback', tableName: 'XS_ShoeFeedback', routePath: '/shoe-feedback/manage' },
    { masterPortalCn: '特色业务', masterPortalEn: 'masterFeature', portalCn: '洗鞋养护专区', portalEn: 'xixie', menuCn: '洗鞋费用上传', menuEn: 'xixieCostUpload', tableName: 'XixieCost', routePath: '/xixie/cost' },
    { masterPortalCn: '特色业务', masterPortalEn: 'masterFeature', portalCn: '洗鞋养护专区', portalEn: 'xixie', menuCn: '洗鞋投放上传', menuEn: 'xixieInvestUpload', tableName: 'XixieInvest', routePath: '/xixie/invest' },
    { masterPortalCn: '特色业务', masterPortalEn: 'masterFeature', portalCn: '洗鞋养护专区', portalEn: 'xixie', menuCn: '洗鞋汇总报表', menuEn: 'xixieSummaryReport', tableName: 'XixieCost', routePath: '/xixie/summary' },
    { masterPortalCn: '特色业务', masterPortalEn: 'masterFeature', portalCn: '洗鞋养护专区', portalEn: 'xixie', menuCn: '洗鞋核销上传', menuEn: 'xixieWriteoffUpload', tableName: 'XixieWriteoff', routePath: '/xixie/writeoff' },
    // 洗鞋养护子表
    { masterPortalCn: '特色业务', masterPortalEn: 'masterFeature', portalCn: '洗鞋养护专区', portalEn: 'xixie', menuCn: '洗鞋转换', menuEn: 'xixieConvert', tableName: 'XixieConvert', routePath: '/xixie/summary', isMenu: false },
    // ===================== 10 消息工作台 =====================
    // 工作台（原仪表盘门户；仪表盘 + 待办/消息 6 项占位）
    { masterPortalCn: '消息工作台', masterPortalEn: 'masterDesk', portalCn: '工作台', portalEn: 'dashboard', menuCn: '仪表盘', menuEn: 'dashboard', tableName: '', routePath: '/dashboard' },
    { masterPortalCn: '消息工作台', masterPortalEn: 'masterDesk', portalCn: '工作台', portalEn: 'dashboard', menuCn: '我的待办审批', menuEn: 'todoApproval', tableName: '', routePath: '/workbench/todo-approvals' },
    { masterPortalCn: '消息工作台', masterPortalEn: 'masterDesk', portalCn: '工作台', portalEn: 'dashboard', menuCn: '我发起的申请', menuEn: 'myApplications', tableName: '', routePath: '/workbench/my-applications' },
    { masterPortalCn: '消息工作台', masterPortalEn: 'masterDesk', portalCn: '工作台', portalEn: 'dashboard', menuCn: '已办任务查询', menuEn: 'doneTasks', tableName: '', routePath: '/workbench/done-tasks' },
    { masterPortalCn: '消息工作台', masterPortalEn: 'masterDesk', portalCn: '工作台', portalEn: 'dashboard', menuCn: '消息通知中心', menuEn: 'notifications', tableName: '', routePath: '/workbench/notifications' },
    { masterPortalCn: '消息工作台', masterPortalEn: 'masterDesk', portalCn: '工作台', portalEn: 'dashboard', menuCn: '个人工作台配置', menuEn: 'workbenchConfig', tableName: '', routePath: '/workbench/config' },
    { masterPortalCn: '消息工作台', masterPortalEn: 'masterDesk', portalCn: '工作台', portalEn: 'dashboard', menuCn: '快捷功能收藏', menuEn: 'quickFavorites', tableName: '', routePath: '/workbench/favorites' },
  ];

// 批量注册所有系统门户和菜单
export async function registerAllPortalEntries() {
  const entries = PORTAL_MENU_ENTRIES;

  for (const e of entries) {
    await registerPortalEntry(e);
  }
  console.log(`LD_Zxtmh: registered ${entries.length} portal entries`);
}