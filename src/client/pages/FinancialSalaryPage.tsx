import FinancialAnalysisView from '../components/FinancialAnalysisView';

// 工资分析：在职人员/平均工资/总费用/人均业绩/人均盈利 均暂无数据源，占位 '-'
export default function FinancialSalaryPage() {
  return (
    <FinancialAnalysisView
      title="工资分析"
      subtitle="工资分析报表"
      mode="grouped"
      metrics={[
        { label: '在职人员', key: '在职人员', type: 'count' },
        { label: '平均工资', key: '平均工资', type: 'amount' },
        { label: '总费用', key: '总费用', type: 'amount' },
        { label: '人均业绩', key: '人均业绩', type: 'amount' },
        { label: '人均盈利', key: '人均盈利', type: 'amount' },
      ]}
    />
  );
}