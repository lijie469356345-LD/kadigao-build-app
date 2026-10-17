import { useState, useEffect, useCallback } from 'react';
import { reimbursementApi } from '../../api/reimbursement';
import Layout from '../components/Layout';
import { Receipt, Download, CheckCircle2 } from 'lucide-react';

const SOURCE_TYPE_MAP: Record<string, string> = {
  reimbursement: '报销单',
  advance: '借款申请',
  advance_payment: '预付款',
};

function PaymentRecordPage() {
  const [list, setList] = useState<any[]>([]);
  const [filters, setFilters] = useState({ sourceType: '', startDate: '', endDate: '' });

  const loadData = useCallback(async () => {
    const params: Record<string, string> = {};
    if (filters.sourceType) params.sourceType = filters.sourceType;
    if (filters.startDate) params.startDate = filters.startDate;
    if (filters.endDate) params.endDate = filters.endDate;
    const data = await reimbursementApi.paymentList(params);
    if (!data.error && !data.message) setList(data);
  }, [filters]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleGenerateVoucher = async (id: number) => {
    const result = await reimbursementApi.paymentGenerateVoucher(id);
    if (result.success) {
      alert(`凭证已生成，凭证号：${result.voucherNo}`);
      loadData();
    } else if (result.message) {
      alert(result.message);
    }
  };

  const handleExport = () => {
    const headers = ['付款单号', '来源类型', '来源单号', '收款人', '金额', '账簿', '付款日期', '付款方式', '凭证号', '备注'];
    const rows = list.map((r: any) => [
      r.payNo, SOURCE_TYPE_MAP[r.sourceType] || r.sourceType, r.sourceNo || '', r.payee || '',
      Number(r.amount).toFixed(2), r.ledgerName || '', r.payDate?.slice(0, 10) || '',
      r.payMethod || '', r.voucherId ? `BV${r.voucherId}` : '无', r.remark || ''
    ]);
    const csv = [headers, ...rows].map(row => row.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = '付款记录.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const totalAmount = list.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

  return (
    <Layout title="付款记录" subtitle="出纳付款记录与凭证生成">
      <div className="p-4 max-w-7xl mx-auto space-y-6">
        {/* 统计 */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl shadow p-4">
            <div className="text-sm text-gray-500">付款笔数</div>
            <div className="text-2xl font-bold text-gray-800 mt-1">{list.length}</div>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <div className="text-sm text-gray-500">付款总额</div>
            <div className="text-2xl font-bold text-lime-600 mt-1">¥{totalAmount.toFixed(2)}</div>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <div className="text-sm text-gray-500">已生成凭证</div>
            <div className="text-2xl font-bold text-green-600 mt-1">{list.filter((r: any) => r.voucherId).length}</div>
          </div>
        </div>

        {/* 筛选与导出 */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">来源类型</label>
            <select value={filters.sourceType} onChange={e => setFilters({ ...filters, sourceType: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">全部</option>
              <option value="reimbursement">报销单</option>
              <option value="advance">借款申请</option>
              <option value="advance_payment">预付款</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">开始日期</label>
            <input type="date" value={filters.startDate} onChange={e => setFilters({ ...filters, startDate: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">结束日期</label>
            <input type="date" value={filters.endDate} onChange={e => setFilters({ ...filters, endDate: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button onClick={handleExport} className="flex items-center gap-1 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm">
            <Download className="w-4 h-4" />导出CSV
          </button>
        </div>

        {/* 列表 */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 text-left">付款单号</th>
                <th className="px-4 py-3 text-left">来源类型</th>
                <th className="px-4 py-3 text-left">来源单号</th>
                <th className="px-4 py-3 text-left">收款人</th>
                <th className="px-4 py-3 text-right">金额</th>
                <th className="px-4 py-3 text-left">付款账簿</th>
                <th className="px-4 py-3 text-left">付款日期</th>
                <th className="px-4 py-3 text-left">付款方式</th>
                <th className="px-4 py-3 text-center">凭证</th>
                <th className="px-4 py-3 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">暂无付款记录</td></tr>
              ) : list.map((r: any) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{r.payNo}</td>
                  <td className="px-4 py-3">{SOURCE_TYPE_MAP[r.sourceType] || r.sourceType}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.sourceNo || '-'}</td>
                  <td className="px-4 py-3">{r.payee || '-'}</td>
                  <td className="px-4 py-3 text-right font-semibold">¥{Number(r.amount).toFixed(2)}</td>
                  <td className="px-4 py-3">{r.ledgerName || '-'}</td>
                  <td className="px-4 py-3">{r.payDate?.slice(0, 10)}</td>
                  <td className="px-4 py-3">{r.payMethod || '-'}</td>
                  <td className="px-4 py-3 text-center">
                    {r.voucherId ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-600 rounded text-xs"><CheckCircle2 className="w-3 h-3" />已生成</span>
                    ) : (
                      <span className="text-xs text-gray-400">未生成</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {!r.voucherId && (
                      <button onClick={() => handleGenerateVoucher(r.id)} className="flex items-center gap-1 text-xs px-2 py-1 bg-lime-50 text-lime-700 rounded hover:bg-lime-100">
                        <Receipt className="w-3.5 h-3.5" />生成凭证
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}

export default PaymentRecordPage;
