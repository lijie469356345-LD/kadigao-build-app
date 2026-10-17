import FinancialAnalysisView from '../components/FinancialAnalysisView';

// 营收利润分析：营收真实；毛利率/毛利/费用额/净 暂无数据源占位 '-'
export default function FinancialRevenueProfitPage() {
  return (
    <FinancialAnalysisView
      title="营收利润分析"
      subtitle="营收与利润分析报表"
      mode="grouped"
      metrics={[
        { label: '营收', key: '营收', type: 'amount' },
        { label: '毛利率', key: '毛利率', type: 'pct' },
        { label: '毛利', key: '毛利', type: 'amount' },
        { label: '费用额', key: '费用额', type: 'amount' },
        { label: '净利', key: '净利', type: 'amount' },
      ]}
    />
  );
}