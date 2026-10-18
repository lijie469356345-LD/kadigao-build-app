import { Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { getMaintenanceStatus } from '../api/logs'

// 立即需要的页面（小体积，不走懒加载）
import UpdateStatusBanner from './components/UpdateStatusBanner'
import MaintenancePage from './pages/MaintenancePage'
import DataExtractionPage from './pages/DataExtractionPage'
import BestSellerPage from './pages/BestSellerPage'
import DirectSalesSummaryPage from './pages/DirectSalesSummaryPage'
import DirectSalesSupervisorPage from './pages/DirectSalesSupervisorPage'
import DirectSalesProductLeaderPage from './pages/DirectSalesProductLeaderPage'
import DirectSalesProductGroupPage from './pages/DirectSalesProductGroupPage'
import DailyProductTargetUploadPage from './pages/DailyProductTargetUploadPage'
import DailyTargetUploadPage from './pages/DailyTargetUploadPage'

// 懒加载所有页面 —— 每个页面会被拆成独立的 JS chunk
const LoginPage = lazy(() => import('./pages/LoginPage'))
const DownloadCenterPage = lazy(() => import('./pages/DownloadCenterPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const RegisterAuditPage = lazy(() => import('./pages/RegisterAuditPage'))
const OnboardingApplyPage = lazy(() => import('./pages/OnboardingApplyPage'))
const OnboardingManagePage = lazy(() => import('./pages/OnboardingManagePage'))
const RegularizationManagePage = lazy(() => import('./pages/RegularizationManagePage'))
const OnboardingBadgePage = lazy(() => import('./pages/OnboardingBadgePage'))
const OnboardingCardAdjustPage = lazy(() => import('./pages/OnboardingCardAdjustPage'))
const ResignationPage = lazy(() => import('./pages/ResignationPage'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const PortalPage = lazy(() => import('./pages/PortalPage'))
const SystemPage = lazy(() => import('./pages/SystemPage'))
const InspectionPage = lazy(() => import('./pages/InspectionPage'))
const SalesPage = lazy(() => import('./pages/SalesPage'))
const ShopDiagnosisPage = lazy(() => import('./pages/ShopDiagnosisPage'))
const LogListPage = lazy(() => import('./pages/LogListPage'))
const LogFormPage = lazy(() => import('./pages/LogFormPage'))
const LogStatisticsPage = lazy(() => import('./pages/LogStatisticsPage'))
const ReportPage = lazy(() => import('./pages/ReportPage'))
const PerformanceDashboard = lazy(() => import('./pages/PerformanceDashboard'))
const ComparisonPage = lazy(() => import('./pages/ComparisonPage'))
const UserPage = lazy(() => import('./pages/UserPage'))
const ShopPage = lazy(() => import('./pages/ShopPage'))
const PermissionPage = lazy(() => import('./pages/PermissionPage'))
const DatabaseConfigPage = lazy(() => import('./pages/DatabaseConfigPage'))
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage'))
const TaskPage = lazy(() => import('./pages/TaskPage'))
const TaskDetailPage = lazy(() => import('./pages/TaskDetailPage'))
const ScorePage = lazy(() => import('./pages/ScorePage'))
const PurchasePage = lazy(() => import('./pages/PurchasePage'))
const PreviousOrdersPage = lazy(() => import('./pages/Purchase/PreviousOrdersPage'))
const PreviousSalesPage = lazy(() => import('./pages/Purchase/PreviousSalesPage'))
const ProfitEvaluationPage = lazy(() => import('./pages/Purchase/ProfitEvaluationPage'))
const SupplierEvaluationPage = lazy(() => import('./pages/Purchase/SupplierEvaluationPage'))
const SuggestedCodePage = lazy(() => import('./pages/Purchase/SuggestedCodePage'))
const MerchandisePlanPage = lazy(() => import('./pages/Purchase/MerchandisePlanPage'))
const QuarterlyEvaluationPage = lazy(() => import('./pages/Purchase/QuarterlyEvaluationPage'))
const WechatPushPage = lazy(() => import('./pages/WechatPushPage'))
const WechatPushTemplatePage = lazy(() => import('./pages/WechatPushTemplatePage'))
const WechatPushRecipientsPage = lazy(() => import('./pages/WechatPushRecipientsPage'))
const WechatPushSettingsPage = lazy(() => import('./pages/WechatPushSettingsPage'))
const WechatPushLogsPage = lazy(() => import('./pages/WechatPushLogsPage'))
const StaffSalesTargetPage = lazy(() => import('./pages/StaffSalesTargetPage'))
const MonthlyTargetDecomposition = lazy(() => import('./pages/MonthlyTargetDecomposition'))
const FinanceFieldPage = lazy(() => import('./pages/FinanceFieldPage'))
const AnnualOperationDashboard = lazy(() => import('./pages/AnnualOperationDashboard'))
const StaffMonthlyTargetPage = lazy(() => import('./pages/StaffMonthlyTargetPage'))
const CoachingStorePage = lazy(() => import('./pages/CoachingStorePage'))
const CoachingPage = lazy(() => import('./pages/CoachingPage'))
const StaffChannelPage = lazy(() => import('./pages/StaffChannelPage'))
const PublicEntryPage = lazy(() => import('./pages/PublicEntryPage'))
const PublicFeedbackDetailPage = lazy(() => import('./pages/PublicFeedbackDetailPage'))
const PublicFeedbackFormPage = lazy(() => import('./pages/PublicFeedbackFormPage'))
const FeedbackTaskPage = lazy(() => import('./pages/FeedbackTaskPage'))
const FeedbackDetailPage = lazy(() => import('./pages/FeedbackDetailPage'))
const FeedbackFormPage = lazy(() => import('./pages/FeedbackFormPage'))
const AutomationPage = lazy(() => import('./pages/AutomationPage'))
const AutoReplenishPage = lazy(() => import('./pages/AutoReplenishPage'))
const AutoDistributePage = lazy(() => import('./pages/AutoDistributePage'))
const AutoMergePage = lazy(() => import('./pages/AutoMergePage'))
const InitialMergeTablePage = lazy(() => import('./pages/InitialMergeTablePage'))
const OnlineMergePage = lazy(() => import('./pages/OnlineMergePage'))
const DataTableManagerPage = lazy(() => import('./pages/DataTableManagerPage'))
const FuDaiPage = lazy(() => import('./pages/FuDaiPage'))
const HaoPingPage = lazy(() => import('./pages/HaoPingPage'))
const WaziPage = lazy(() => import('./pages/WaziPage'))
const XixieCostUploadPage = lazy(() => import('./pages/XixieCostUploadPage'))
const FinancialRevenueProfitPage = lazy(() => import('./pages/FinancialRevenueProfitPage'))
const FinancialStoreCostPage = lazy(() => import('./pages/FinancialStoreCostPage'))
const FinancialRentRatioPage = lazy(() => import('./pages/FinancialRentRatioPage'))
const FinancialInputOutputPage = lazy(() => import('./pages/FinancialInputOutputPage'))
const FinancialSalaryPage = lazy(() => import('./pages/FinancialSalaryPage'))
const FinancialNoCostPricePage = lazy(() => import('./pages/FinancialNoCostPricePage'))
const ScoreWarningPage = lazy(() => import('./pages/ScoreWarningPage'))
const ScoreWarningCheckPage = lazy(() => import('./pages/ScoreWarningCheckPage'))
const ScoreWarningScoreTablePage = lazy(() => import('./pages/ScoreWarningScoreTablePage'))
const ScoreWarningWarningTablePage = lazy(() => import('./pages/ScoreWarningWarningTablePage'))
const ScoreWarningRectificationPage = lazy(() => import('./pages/ScoreWarningRectificationPage'))
const ScoreWarningSuggestionPage = lazy(() => import('./pages/ScoreWarningSuggestionPage'))
const WarehousePage = lazy(() => import('./pages/WarehousePage'))
const WarehouseScanPage = lazy(() => import('./pages/WarehouseScanPage'))
const XixieInvestUploadPage = lazy(() => import('./pages/XixieInvestUploadPage'))
const XixieWriteoffUploadPage = lazy(() => import('./pages/XixieWriteoffUploadPage'))
const XixieSummaryPage = lazy(() => import('./pages/XixieSummaryPage'))
const ReimbursementPage = lazy(() => import('./pages/ReimbursementPage'))
const ReimbursementHomePage = lazy(() => import('./pages/ReimbursementHomePage'))
const BudgetControlPage = lazy(() => import('./pages/BudgetControlPage'))
const ReimbursementVoucherPage = lazy(() => import('./pages/ReimbursementVoucherPage'))
const ReimbursementApprovalPage = lazy(() => import('./pages/ReimbursementApprovalPage'))
const ReimbursementReportPage = lazy(() => import('./pages/ReimbursementReportPage'))
const ExpenseApplicationPage = lazy(() => import('./pages/ExpenseApplicationPage'))
const DebtQueryPage = lazy(() => import('./pages/DebtQueryPage'))
const AdvancePaymentPage = lazy(() => import('./pages/AdvancePaymentPage'))
const PaymentRecordPage = lazy(() => import('./pages/PaymentRecordPage'))
const LedgerQueryPage = lazy(() => import('./pages/LedgerQueryPage'))
const LedgerManagePage = lazy(() => import('./pages/LedgerManagePage'))
const OrgManagePage = lazy(() => import('./pages/OrgManagePage'))
const PositionManagePage = lazy(() => import('./pages/PositionManagePage'))
const PkTaskOrderPage = lazy(() => import('./pages/PkTaskOrderPage'))
const PkDimensionPage = lazy(() => import('./pages/PkDimensionPage'))
const PkTargetPage = lazy(() => import('./pages/PkTargetPage'))
const PkReportPage = lazy(() => import('./pages/PkReportPage'))
const PkDataTablePage = lazy(() => import('./pages/PkDataTablePage'))
const PkDailyTargetUploadPage = lazy(() => import('./pages/PkDailyTargetUploadPage'))
const PkDailyFollowupPage = lazy(() => import('./pages/PkDailyFollowupPage'))
const FixedAssetPage = lazy(() => import('./pages/asset/FixedAssetPage'))
const VehicleApplyPage = lazy(() => import('./pages/asset/VehicleApplyPage'))
const VehicleManagePage = lazy(() => import('./pages/asset/VehicleManagePage'))
const AuthorizedPersonPage = lazy(() => import('./pages/asset/AuthorizedPersonPage'))
const GrowthClassroomPage = lazy(() => import('./pages/asset/GrowthClassroomPage'))
const ShoeFeedbackPage = lazy(() => import('./pages/ShoeFeedbackPage'))
const ShoeFeedbackManagePage = lazy(() => import('./pages/ShoeFeedbackManagePage'))
const HourlyPerformancePage = lazy(() => import('./pages/HourlyPerformancePage'))
const PlaceholderPage = lazy(() => import('./pages/PlaceholderPage'))

// 页面加载中的 fallback
function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <span className="text-sm text-gray-500">加载中...</span>
      </div>
    </div>
  )
}

function ProtectedRoute({ children, requireAdmin = false }: { children: React.ReactNode; requireAdmin?: boolean }) {
  const { isLoggedIn, user } = useAuthStore()
  
  if (!isLoggedIn) {
    return <Navigate to="/login" />
  }
  
  // 管理员判定与 v3 角色授权体系一致：管理员字段 或 持有 super_admin/data_admin 角色（sys_role_menu 已授权 system 门户）
  const isAdmin = user?.isAdmin === '是' || (user?.roleCodes || []).includes('super_admin') || (user?.roleCodes || []).includes('data_admin');
  if (requireAdmin && !isAdmin) {
    return <Navigate to="/dashboard" />
  }
  
  return <>{children}</>
}

function App() {
  const { isLoggedIn } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [isMaintenance, setIsMaintenance] = useState(false)

  useEffect(() => {
    const checkMaintenance = async () => {
      try {
        const res = await getMaintenanceStatus()
        setIsMaintenance(res.isMaintenance)
      } catch (error) {
        console.error('Failed to check maintenance status:', error)
      } finally {
        setLoading(false)
      }
    }
    checkMaintenance()
  }, [])

  // 超过 10 分钟无任何操作（点击/触摸/按键/滚动等）自动回到登录页：
  // 记录最近活动时间，每 30 秒检查一次；App 从后台切回前台时立即检查，
  // 覆盖手机锁屏/切后台超过 10 分钟再回来的场景。超时后 logout() 清登录态，
  // 路由守卫与根路径自动跳转登录页。仅登录状态下启用计时。
  useEffect(() => {
    if (!isLoggedIn) return
    const IDLE_TIMEOUT_MS = 10 * 60 * 1000
    let lastActivity = Date.now()
    const markActive = () => { lastActivity = Date.now() }
    const checkIdle = () => {
      if (Date.now() - lastActivity >= IDLE_TIMEOUT_MS) {
        useAuthStore.getState().logout()
      }
    }
    const events = ['click', 'touchstart', 'keydown', 'mousemove', 'scroll', 'wheel']
    events.forEach((e) => window.addEventListener(e, markActive, { passive: true }))
    const timer = window.setInterval(checkIdle, 30 * 1000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkIdle()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      events.forEach((e) => window.removeEventListener(e, markActive))
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [isLoggedIn])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    )
  }

  if (isMaintenance && isLoggedIn) {
    return <MaintenancePage />
  }

return (
    <Suspense fallback={<PageFallback />}>
      <UpdateStatusBanner />
      <Routes>
<Route path="/login" element={<LoginPage />} />
        <Route path="/download-center" element={<DownloadCenterPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/onboarding-apply" element={<OnboardingApplyPage />} />
        <Route path="/public-feedback" element={<PublicEntryPage />} />
        <Route path="/public-feedback/details" element={<PublicFeedbackDetailPage />} />
        <Route path="/public-feedback/form/:id" element={<PublicFeedbackFormPage />} />
        <Route path="/" element={isLoggedIn ? <PortalPage /> : <LoginPage />} />
        <Route path="/portal" element={
          <ProtectedRoute>
            <PortalPage />
          </ProtectedRoute>
        } />
        <Route path="/dashboard" element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } />
        <Route path="/logs" element={
          <ProtectedRoute>
            <LogListPage />
          </ProtectedRoute>
        } />
        <Route path="/logs/new" element={
          <ProtectedRoute>
            <LogFormPage />
          </ProtectedRoute>
        } />
        <Route path="/logs/statistics" element={
          <ProtectedRoute>
            <LogStatisticsPage />
          </ProtectedRoute>
        } />
        <Route path="/logs/:id" element={
          <ProtectedRoute>
            <LogFormPage />
          </ProtectedRoute>
        } />
        <Route path="/performance-dashboard" element={
          <ProtectedRoute>
            <PerformanceDashboard />
          </ProtectedRoute>
        } />
        <Route path="/reports" element={
          <ProtectedRoute>
            <ReportPage />
          </ProtectedRoute>
        } />
        <Route path="/reports/compare" element={
          <ProtectedRoute>
            <ComparisonPage />
          </ProtectedRoute>
        } />
        <Route path="/comparison" element={
          <ProtectedRoute>
            <ComparisonPage />
          </ProtectedRoute>
        } />
        <Route 
          path="/users" 
          element={
            <ProtectedRoute requireAdmin>
              <UserPage />
            </ProtectedRoute>
          } 
        />
        <Route path="/users/change-password" element={
            <ProtectedRoute>
              <ChangePasswordPage />
            </ProtectedRoute>
          } />
        <Route 
          path="/shops" 
          element={
            <ProtectedRoute requireAdmin>
              <ShopPage />
            </ProtectedRoute>
          } 
        />
<Route 
          path="/permissions" 
          element={
            <ProtectedRoute requireAdmin>
              <PermissionPage />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/org-manage" 
          element={
            <ProtectedRoute requireAdmin>
              <OrgManagePage />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/register-audit" 
          element={
            <ProtectedRoute requireAdmin>
              <RegisterAuditPage />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/positions" 
          element={
            <ProtectedRoute requireAdmin>
              <PositionManagePage />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/database" 
          element={
            <ProtectedRoute requireAdmin>
              <DatabaseConfigPage />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/maintenance" 
          element={
            <ProtectedRoute requireAdmin>
              <MaintenancePage />
            </ProtectedRoute>
          } 
        />
        <Route path="/tasks" element={
          <ProtectedRoute>
            <TaskPage />
          </ProtectedRoute>
        } />
        <Route path="/tasks/:id" element={
          <ProtectedRoute>
            <TaskDetailPage />
          </ProtectedRoute>
        } />
        <Route path="/scores" element={
          <ProtectedRoute>
            <ScorePage />
          </ProtectedRoute>
        } />
        <Route path="/system" element={
          <ProtectedRoute requireAdmin>
            <SystemPage />
          </ProtectedRoute>
        } />
        <Route path="/coaching-stores" element={
          <ProtectedRoute>
            <CoachingStorePage />
          </ProtectedRoute>
        } />
        <Route path="/coaching" element={
          <ProtectedRoute>
            <CoachingPage />
          </ProtectedRoute>
        } />
        <Route path="/inspection" element={
          <ProtectedRoute>
            <InspectionPage />
          </ProtectedRoute>
        } />
        <Route path="/sales" element={
          <ProtectedRoute>
            <SalesPage />
          </ProtectedRoute>
        } />
        <Route path="/shop-diagnosis" element={
          <ProtectedRoute>
            <ShopDiagnosisPage />
          </ProtectedRoute>
        } />
        <Route path="/staff-sales-target" element={
          <ProtectedRoute>
            <StaffSalesTargetPage />
          </ProtectedRoute>
        } />
        <Route path="/monthly-target-decomposition" element={
          <ProtectedRoute>
            <MonthlyTargetDecomposition />
          </ProtectedRoute>
        } />
        <Route path="/finance-field" element={
          <ProtectedRoute>
            <FinanceFieldPage />
          </ProtectedRoute>
        } />
        <Route path="/annual-operation-dashboard" element={
          <ProtectedRoute>
            <AnnualOperationDashboard />
          </ProtectedRoute>
        } />
        <Route path="/staff-monthly-target" element={
          <ProtectedRoute>
            <StaffMonthlyTargetPage />
          </ProtectedRoute>
        } />
        <Route path="/data-extraction" element={
          <ProtectedRoute>
            <DataExtractionPage />
          </ProtectedRoute>
        } />
        <Route path="/best-seller" element={
          <ProtectedRoute>
            <BestSellerPage />
          </ProtectedRoute>
        } />
        <Route path="/direct-sales-summary" element={
          <ProtectedRoute>
            <DirectSalesSummaryPage />
          </ProtectedRoute>
        } />
        <Route path="/direct-sales-summary/supervisor" element={
          <ProtectedRoute>
            <DirectSalesSupervisorPage />
          </ProtectedRoute>
        } />
        <Route path="/direct-sales-summary/product-leader" element={
          <ProtectedRoute>
            <DirectSalesProductLeaderPage />
          </ProtectedRoute>
        } />
        <Route path="/direct-sales-summary/product-group" element={
          <ProtectedRoute>
            <DirectSalesProductGroupPage />
          </ProtectedRoute>
        } />
        <Route path="/daily-target-upload" element={
          <ProtectedRoute>
            <DailyTargetUploadPage />
          </ProtectedRoute>
        } />
        <Route path="/daily-product-target-upload" element={
          <ProtectedRoute>
            <DailyProductTargetUploadPage />
          </ProtectedRoute>
        } />
        <Route path="/purchase" element={
          <ProtectedRoute>
            <PurchasePage />
          </ProtectedRoute>
        } />
        <Route path="/purchase/previous-orders" element={
          <ProtectedRoute>
            <PreviousOrdersPage />
          </ProtectedRoute>
        } />
        <Route path="/purchase/previous-sales" element={
          <ProtectedRoute>
            <PreviousSalesPage />
          </ProtectedRoute>
        } />
        <Route path="/purchase/profit-evaluation" element={
          <ProtectedRoute>
            <ProfitEvaluationPage />
          </ProtectedRoute>
        } />
        <Route path="/purchase/supplier-evaluation" element={
          <ProtectedRoute>
            <SupplierEvaluationPage />
          </ProtectedRoute>
        } />
        <Route path="/purchase/suggested-code" element={
          <ProtectedRoute>
            <SuggestedCodePage />
          </ProtectedRoute>
        } />
        <Route path="/purchase/merchandise-plan" element={
          <ProtectedRoute>
            <MerchandisePlanPage />
          </ProtectedRoute>
        } />
        <Route path="/purchase/quarterly-evaluation" element={
              <ProtectedRoute>
                <QuarterlyEvaluationPage />
              </ProtectedRoute>
            } />
        <Route path="/wechat-push" element={
          <ProtectedRoute>
            <WechatPushPage />
          </ProtectedRoute>
        } />
        <Route path="/wechat-push/template" element={
          <ProtectedRoute>
            <WechatPushTemplatePage />
          </ProtectedRoute>
        } />
        <Route path="/wechat-push/recipients" element={
          <ProtectedRoute>
            <WechatPushRecipientsPage />
          </ProtectedRoute>
        } />
        <Route path="/wechat-push/settings" element={
          <ProtectedRoute>
            <WechatPushSettingsPage />
          </ProtectedRoute>
        } />
        <Route path="/wechat-push/logs" element={
          <ProtectedRoute>
            <WechatPushLogsPage />
          </ProtectedRoute>
        } />
        <Route path="/staff-channel" element={
          <ProtectedRoute>
            <StaffChannelPage />
          </ProtectedRoute>
        } />
        <Route path="/staff-channel/tasks" element={
          <ProtectedRoute requireAdmin>
            <FeedbackTaskPage />
          </ProtectedRoute>
        } />
        <Route path="/staff-channel/details" element={
          <ProtectedRoute>
            <FeedbackDetailPage />
          </ProtectedRoute>
        } />
        <Route path="/staff-channel/form/:id" element={
          <ProtectedRoute>
            <FeedbackFormPage />
          </ProtectedRoute>
        } />
        <Route path="/automation" element={
          <ProtectedRoute>
            <AutomationPage />
          </ProtectedRoute>
        } />
        <Route path="/automation/replenish" element={
          <ProtectedRoute>
            <AutoReplenishPage />
          </ProtectedRoute>
        } />
        <Route path="/automation/distribute" element={
          <ProtectedRoute>
            <AutoDistributePage />
          </ProtectedRoute>
        } />
        <Route path="/automation/merge" element={
          <ProtectedRoute>
            <AutoMergePage />
          </ProtectedRoute>
        } />
        <Route path="/automation/initial" element={
          <ProtectedRoute>
            <InitialMergeTablePage />
          </ProtectedRoute>
        } />
        <Route path="/automation/online-merge" element={
          <ProtectedRoute>
            <OnlineMergePage />
          </ProtectedRoute>
        } />
        <Route path="/data-manager/:table" element={
          <ProtectedRoute requireAdmin>
            <DataTableManagerPage />
          </ProtectedRoute>
        } />
<Route path="/douyin" element={<Navigate to="/douyin/fudai" replace />} />
        <Route path="/douyin/fudai" element={
          <ProtectedRoute>
            <FuDaiPage />
          </ProtectedRoute>
        } />
        <Route path="/douyin/haoping" element={
          <ProtectedRoute>
            <HaoPingPage />
          </ProtectedRoute>
        } />
        <Route path="/douyin/wazi" element={
          <ProtectedRoute>
            <WaziPage />
          </ProtectedRoute>
        } />
<Route path="/xixie" element={<Navigate to="/xixie/summary" replace />} />
        <Route path="/xixie/cost" element={
          <ProtectedRoute>
            <XixieCostUploadPage />
          </ProtectedRoute>
        } />
        <Route path="/xixie/invest" element={
          <ProtectedRoute>
            <XixieInvestUploadPage />
          </ProtectedRoute>
        } />
        <Route path="/xixie/writeoff" element={
          <ProtectedRoute>
            <XixieWriteoffUploadPage />
          </ProtectedRoute>
        } />
        <Route path="/xixie/summary" element={
          <ProtectedRoute>
            <XixieSummaryPage />
          </ProtectedRoute>
        } />
<Route path="/financial" element={<Navigate to="/financial/revenue-profit" replace />} />
        <Route path="/financial/revenue-profit" element={<ProtectedRoute><FinancialRevenueProfitPage /></ProtectedRoute>} />
        <Route path="/financial/store-cost" element={<ProtectedRoute><FinancialStoreCostPage /></ProtectedRoute>} />
        <Route path="/financial/rent-ratio" element={<ProtectedRoute><FinancialRentRatioPage /></ProtectedRoute>} />
        <Route path="/financial/input-output" element={<ProtectedRoute><FinancialInputOutputPage /></ProtectedRoute>} />
        <Route path="/financial/salary" element={<ProtectedRoute><FinancialSalaryPage /></ProtectedRoute>} />
        <Route path="/financial/no-cost-price-product" element={<ProtectedRoute><FinancialNoCostPricePage /></ProtectedRoute>} />
        <Route path="/score-warning" element={<ProtectedRoute><ScoreWarningPage /></ProtectedRoute>} />
        <Route path="/score-warning/check" element={<ProtectedRoute><ScoreWarningCheckPage /></ProtectedRoute>} />
        <Route path="/score-warning/score-table" element={<ProtectedRoute><ScoreWarningScoreTablePage /></ProtectedRoute>} />
        <Route path="/score-warning/warning-table" element={<ProtectedRoute><ScoreWarningWarningTablePage /></ProtectedRoute>} />
        <Route path="/score-warning/rectification" element={<ProtectedRoute><ScoreWarningRectificationPage /></ProtectedRoute>} />
        <Route path="/score-warning/suggestion" element={<ProtectedRoute><ScoreWarningSuggestionPage /></ProtectedRoute>} />
        <Route path="/warehouse" element={<ProtectedRoute><WarehousePage /></ProtectedRoute>} />
        <Route path="/warehouse/scan" element={<ProtectedRoute><WarehouseScanPage /></ProtectedRoute>} />
        <Route path="/reimbursement" element={<ProtectedRoute><ReimbursementPage /></ProtectedRoute>} />
        <Route path="/reimbursement/home" element={<ProtectedRoute><ReimbursementHomePage /></ProtectedRoute>} />
        <Route path="/reimbursement/budget" element={<ProtectedRoute><BudgetControlPage /></ProtectedRoute>} />
        <Route path="/reimbursement/voucher" element={<ProtectedRoute><ReimbursementVoucherPage /></ProtectedRoute>} />
        <Route path="/reimbursement/approval" element={<ProtectedRoute><ReimbursementApprovalPage /></ProtectedRoute>} />
        <Route path="/reimbursement/report" element={<ProtectedRoute><ReimbursementReportPage /></ProtectedRoute>} />
        <Route path="/reimbursement/expense-application" element={<ProtectedRoute><ExpenseApplicationPage /></ProtectedRoute>} />
        <Route path="/reimbursement/debt-query" element={<ProtectedRoute><DebtQueryPage /></ProtectedRoute>} />
        <Route path="/reimbursement/advance-payment" element={<ProtectedRoute><AdvancePaymentPage /></ProtectedRoute>} />
        <Route path="/reimbursement/payment-record" element={<ProtectedRoute><PaymentRecordPage /></ProtectedRoute>} />
        <Route path="/reimbursement/ledger-query" element={<ProtectedRoute><LedgerQueryPage /></ProtectedRoute>} />
        <Route path="/reimbursement/ledger-manage" element={<ProtectedRoute><LedgerManagePage /></ProtectedRoute>} />
        <Route path="/pk-task-order" element={
          <ProtectedRoute>
            <PkTaskOrderPage />
          </ProtectedRoute>
        } />
        <Route path="/pk-dimensions" element={
          <ProtectedRoute>
            <PkDimensionPage />
          </ProtectedRoute>
        } />
        <Route path="/pk-target" element={
          <ProtectedRoute>
            <PkTargetPage />
          </ProtectedRoute>
        } />
        <Route path="/pk-report" element={
          <ProtectedRoute>
            <PkReportPage />
          </ProtectedRoute>
        } />
        <Route path="/pk-data-table" element={
          <ProtectedRoute>
            <PkDataTablePage />
          </ProtectedRoute>
        } />
        <Route path="/pk-daily-target" element={
          <ProtectedRoute>
            <PkDailyTargetUploadPage />
          </ProtectedRoute>
        } />
        <Route path="/pk-daily-followup" element={
          <ProtectedRoute>
            <PkDailyFollowupPage />
          </ProtectedRoute>
        } />
        <Route path="/asset" element={<Navigate to="/asset/fixed-assets" replace />} />
        <Route path="/asset/fixed-assets" element={
          <ProtectedRoute>
            <FixedAssetPage />
          </ProtectedRoute>
        } />
        <Route path="/asset/vehicle-apply" element={
          <ProtectedRoute>
            <VehicleApplyPage />
          </ProtectedRoute>
        } />
        <Route path="/asset/vehicle-manage" element={
          <ProtectedRoute>
            <VehicleManagePage />
          </ProtectedRoute>
        } />
        <Route path="/asset/authorized-persons" element={
          <ProtectedRoute>
            <AuthorizedPersonPage />
          </ProtectedRoute>
        } />
        <Route path="/asset/growth-classroom" element={
          <ProtectedRoute>
            <GrowthClassroomPage />
          </ProtectedRoute>
        } />
        <Route path="/shoe-feedback" element={<ShoeFeedbackPage />} />
        <Route path="/shoe-feedback/manage" element={
          <ProtectedRoute>
            <ShoeFeedbackManagePage />
          </ProtectedRoute>
        } />
        <Route path="/hourly-performance" element={
          <ProtectedRoute>
            <HourlyPerformancePage />
          </ProtectedRoute>
        } />
        {/* ===== 新层级框架占位路由：基础资料（人事绩效） ===== */}
        <Route path="/base/onboarding" element={<ProtectedRoute><OnboardingManagePage /></ProtectedRoute>} />
        <Route path="/base/onboarding-badge" element={<ProtectedRoute><OnboardingBadgePage /></ProtectedRoute>} />
        <Route path="/base/onboarding-card-adjust" element={<ProtectedRoute><OnboardingCardAdjustPage /></ProtectedRoute>} />
        <Route path="/base/regularization" element={<ProtectedRoute><RegularizationManagePage /></ProtectedRoute>} />
        <Route path="/base/transfer" element={<ProtectedRoute><PlaceholderPage title="调岗管理" portalCn="基础资料" /></ProtectedRoute>} />
        <Route path="/base/resignation" element={<ProtectedRoute><ResignationPage /></ProtectedRoute>} />
        {/* ===== 新层级框架占位路由：考勤（人事绩效） ===== */}
        <Route path="/attendance/clock-in" element={<ProtectedRoute><PlaceholderPage title="打卡" portalCn="考勤" /></ProtectedRoute>} />
        <Route path="/attendance/schedule" element={<ProtectedRoute><PlaceholderPage title="排班" portalCn="考勤" /></ProtectedRoute>} />
        <Route path="/attendance/report" element={<ProtectedRoute><PlaceholderPage title="考勤报表" portalCn="考勤" /></ProtectedRoute>} />
        {/* ===== 新层级框架占位路由：自动薪资（人事绩效） ===== */}
        <Route path="/payroll/salary-scheme" element={<ProtectedRoute><PlaceholderPage title="薪资方案" portalCn="自动薪资" /></ProtectedRoute>} />
        <Route path="/payroll/salary-calculation" element={<ProtectedRoute><PlaceholderPage title="薪资核算" portalCn="自动薪资" /></ProtectedRoute>} />
        <Route path="/payroll/salary-archive" element={<ProtectedRoute><PlaceholderPage title="薪资档案管理" portalCn="自动薪资" /></ProtectedRoute>} />
        {/* ===== 新层级框架占位路由：工作台（消息工作台） ===== */}
        <Route path="/workbench/todo-approvals" element={<ProtectedRoute><PlaceholderPage title="我的待办审批" portalCn="工作台" /></ProtectedRoute>} />
        <Route path="/workbench/my-applications" element={<ProtectedRoute><PlaceholderPage title="我发起的申请" portalCn="工作台" /></ProtectedRoute>} />
        <Route path="/workbench/done-tasks" element={<ProtectedRoute><PlaceholderPage title="已办任务查询" portalCn="工作台" /></ProtectedRoute>} />
        <Route path="/workbench/notifications" element={<ProtectedRoute><PlaceholderPage title="消息通知中心" portalCn="工作台" /></ProtectedRoute>} />
        <Route path="/workbench/config" element={<ProtectedRoute><PlaceholderPage title="个人工作台配置" portalCn="工作台" /></ProtectedRoute>} />
        <Route path="/workbench/favorites" element={<ProtectedRoute><PlaceholderPage title="快捷功能收藏" portalCn="工作台" /></ProtectedRoute>} />
        {/* ===== 新层级框架占位路由：会员报表（销售业务） ===== */}
        <Route path="/member-report" element={<ProtectedRoute><PlaceholderPage title="会员报表" portalCn="销售管理" /></ProtectedRoute>} />
      </Routes>
    </Suspense>
  )
}

export default App
