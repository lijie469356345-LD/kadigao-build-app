import FinancialAnalysisView from '../components/FinancialAnalysisView';

// 投入产出分析：业绩金额真实，费用与费用/业绩暂无数据源占位 '-'
export default function FinancialInputOutputPage() {
  return (
    <FinancialAnalysisView
      title="投入产出分析"
      subtitle="投入产出分析报表"
      mode="grouped"
      metrics={[
        { label: '业绩金额', key: '营收', type: 'amount' },
        { label: '费用', key: '费用', type: 'amount' },
        { label: '费用/业绩', key: '费用业绩', type: 'pct' },
      ]}
    />
  );
}