import { useState, useEffect, useCallback } from 'react';
import { reimbursementApi } from '../../api/reimbursement';
import Layout from '../components/Layout';
import { Search, Download, Receipt, CheckCircle2, FileText } from 'lucide-react';

const SOURCE_TYPE_MAP: Record<string, string> = {
  reimbursement: '报销单',
  payment: '付款记录',
};

function ReimbursementVoucherPage() {
  const [list, setList] = useState<any[]>([]);
  const [filters, setFilters] = useState({ startDate: '', endDate: '', keyword: '', sourceType: '' });

  const loadData = useCallback(async () => {
    const params: Record<string, string> = {};
    if (filters.startDate) params.startDate = filters.startDate;
    if (filters.endDate) params.endDate = filters.endDate;
    if (filters.keyword) params.keyword = filters.keyword;
    if (filters.sourceType) params.sourceType = filters.sourceType;
    const data = await reimbursementApi.voucherList(params);
    if (!data.error && !data.message) setList(data);
  }, [filters]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleExport = () => {
    const headers = ['凭证号', '凭证日期', '来源类型', '来源单号', '借方科目', '贷方科目', '金额', '摘要', '关联人员'];
    const rows = list.map((r: any) => [
      r.voucherNo, r.voucherDate?.slice(0, 10) || '',
      SOURCE_TYPE_MAP[r.sourceType] || r.sourceType || '-', r.sourceNo || '-',
      r.debitSubject || '-', r.creditSubject || '-',
      Number(r.amount).toFixed(2), r.summary || '', r.sourcePerson || '-',
    ]);
    const csv = [headers, ...rows].map(row => row.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = '凭证记录.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const totalAmount = list.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

  return (
    <Layout title="凭证记录" subtitle="费用凭证查询与管理">
      <div className="p-4 max-w-7xl mx-auto space-y-6">
        {/* 统计 */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl shadow p-4">
            <div className="text-sm text-gray-500">凭证总数</div>
            <div className="text-2xl font-bold text-gray-800 mt-1">{list.length}</div>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <div className="text-sm text-gray-500">凭证金额合计</div>
            <div className="text-2xl font-bold text-lime-600 mt-1">¥{totalAmount.toFixed(2)}</div>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <div className="text-sm text-gray-500">付款凭证</div>
            <div className="text-2xl font-bold text-blue-600 mt-1">{list.filter((r: any) => r.sourceType === 'payment').length}</div>
          </div>
        </div>

        {/* 筛选 */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">来源类型</label>
            <select value={filters.sourceType} onChange={e => setFilters({ ...filters, sourceType: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">全部</option>
              <option value="reimbursement">报销单</option>
              <option value="payment">付款记录</option>
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
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">关键词</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={filters.keyword} onChange={e => setFilters({ ...filters, keyword: e.target.value })} placeholder="搜索凭证号、摘要、科目..." className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
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
                <th className="px-4 py-3 text-left">凭证号</th>
                <th className="px-4 py-3 text-left">凭证日期</th>
                <th className="px-4 py-3 text-left">来源类型</th>
                <th className="px-4 py-3 text-left">来源单号</th>
                <th className="px-4 py-3 text-left">借方科目</th>
                <th className="px-4 py-3 text-left">贷方科目</th>
                <th className="px-4 py-3 text-right">金额</th>
                <th className="px-4 py-3 text-left">摘要</th>
                <th className="px-4 py-3 text-left">关联人员</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                  <Receipt className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                  暂无凭证记录
                </td></tr>
              ) : list.map((r: any) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-lime-700">{r.voucherNo}</td>
                  <td className="px-4 py-3">{r.voucherDate?.slice(0, 10)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${r.sourceType === 'payment' ? 'bg-blue-50 text-blue-600' : 'bg-lime-50 text-lime-600'}`}>
                      {SOURCE_TYPE_MAP[r.sourceType] || r.sourceType || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{r.sourceNo || '-'}</td>
                  <td className="px-4 py-3">{r.debitSubject || '-'}</td>
                  <td className="px-4 py-3">{r.creditSubject || '-'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-800">¥{Number(r.amount).toFixed(2)}</td>
                  <td className="px-4 py-3 text-gray-600 max-w-xs truncate" title={r.summary}>{r.summary || '-'}</td>
                  <td className="px-4 py-3">{r.sourcePerson || '-'}</td>
                </tr>
              ))}
            </tbody>
            {list.length > 0 && (
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={6} className="px-4 py-3 text-right font-bold text-gray-700">合计</td>
                  <td className="px-4 py-3 text-right font-bold text-lime-600">¥{totalAmount.toFixed(2)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </Layout>
  );
}

export default ReimbursementVoucherPage;
