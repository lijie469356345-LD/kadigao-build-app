import Layout from '../../components/Layout';

function SuggestedCodePage() {
  return (
    <Layout title="建议配码" subtitle="根据数据分析生成配码建议">
      <div className="w-full">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">建议配码</h2>
          <div className="bg-gray-50 rounded-lg p-8 text-center">
            <div className="text-6xl mb-4">👖</div>
            <p className="text-gray-500">建议配码功能开发中</p>
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default SuggestedCodePage;
