import FinancialAnalysisView from '../components/FinancialAnalysisView';

// 租售比分析：本期/同期业绩真实，租金与租售比暂无数据源占位 '-'
export default function FinancialRentRatioPage() {
  return (
    <FinancialAnalysisView
      title="租售比分析"
      subtitle="租售比分析报表"
      mode="rent"
    />
  );
}