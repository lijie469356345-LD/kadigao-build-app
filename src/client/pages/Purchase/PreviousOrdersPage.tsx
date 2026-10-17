import Layout from '../../components/Layout';

function PreviousOrdersPage() {
  return (
    <Layout title="往期订单" subtitle="查看历史采购订单记录">
      <div className="w-full">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">往期订单</h2>
          <div className="bg-gray-50 rounded-lg p-8 text-center">
            <div className="text-6xl mb-4">📋</div>
            <p className="text-gray-500">往期订单功能开发中</p>
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default PreviousOrdersPage;
