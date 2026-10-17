import FinancialAnalysisView from '../components/FinancialAnalysisView';

// 店铺费用分析：费用1~费用4（暂无数据源，先占位 '-'）
export default function FinancialStoreCostPage() {
  return (
    <FinancialAnalysisView
      title="店铺费用分析"
      subtitle="店铺费用分析报表"
      mode="grouped"
      metrics={['费用1', '费用2', '费用3', '费用4'].map(f => ({ label: f, key: f, type: 'amount' as const }))}
    />
  );
}