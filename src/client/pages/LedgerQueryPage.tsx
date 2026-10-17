import { useState, useEffect, useCallback } from 'react';
import { reimbursementApi } from '../../api/reimbursement';
import Layout from '../components/Layout';
import { Search, Wallet, Download, ChevronDown, ChevronRight, Banknote } from 'lucide-react';

const SOURCE_TYPE_MAP: Record<string, string> = {
  reimbursement: '报销单',
  advance: '借款申请',
  advance_payment: '预付款',
};

function LedgerQueryPage() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [details, setDetails] = useState<any[]>([]);
  const [summary, setSummary] = useState<any[]>([]);
  const [expandedLedger, setExpandedLedger] = useState<number | null>(null);
  const [filters, setFilters] = useState({ ledgerId: '', startDate: '', endDate: '', sourceType: '' });

  const loadAccounts = useCallback(async () => {
    const data = await reimbursementApi.ledgerList();
    if (!data.error && !data.message) setAccounts(data);
  }, []);

  const loadPayments = useCallback(async () => {
    const params: Record<string, string> = {};
    if (filters.ledgerId) params.ledgerId = filters.ledgerId;
    if (filters.startDate) params.startDate = filters.startDate;
    if (filters.endDate) params.endDate = filters.endDate;
    if (filters.sourceType) params.sourceType = filters.sourceType;
    const data = await reimbursementApi.ledgerPayments(params);
    if (!data.error && !data.message) {
      setDetails(data.details || []);
      setSummary(data.summary || []);
    }
  }, [filters]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { loadPayments(); }, [loadPayments]);

  const handleExport = () => {
    const headers = ['付款单号', '来源类型', '来源单号', '收款人', '金额', '付款日期', '付款方式', '备注'];
    const rows = details.map((r: any) => [
      r.payNo, SOURCE_TYPE_MAP[r.sourceType] || r.sourceType, r.sourceNo || '', r.payee || '',
      Number(r.amount).toFixed(2), r.payDate?.slice(0, 10) || '', r.payMethod || '', r.remark || ''
    ]);
    const csv = [headers, ...rows].map(row => row.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = '账簿付款明细.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const filteredDetails = expandedLedger ? details.filter((d: any) => d.ledgerId === expandedLedger) : details;
  const grandTotal = summary.reduce((s: number, r: any) => s + Number(r.totalAmount || 0), 0);
  const grandCount = summary.reduce((s: number, r: any) => s + Number(r.payCount || 0), 0);

  return (
    <Layout title="账簿查询" subtitle="银行卡付款明细与汇总">
      <div className="p-4 max-w-7xl mx-auto space-y-6">
        {/* 总览统计 */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
            <div className="p-3 rounded-full bg-lime-50"><Wallet className="w-5 h-5 text-lime-600" /></div>
            <div><div className="text-2xl font-bold text-gray-800">{accounts.length}</div><div className="text-xs text-gray-500">账簿数量</div></div>
          </div>
          <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
            <div className="p-3 rounded-full bg-blue-50"><Banknote className="w-5 h-5 text-blue-600" /></div>
            <div><div className="text-2xl font-bold text-gray-800">{grandCount}</div><div className="text-xs text-gray-500">付款笔数</div></div>
          </div>
          <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
            <div className="p-3 rounded-full bg-red-50"><Download className="w-5 h-5 text-red-600" /></div>
            <div><div className="text-2xl font-bold text-lime-600">¥{grandTotal.toFixed(2)}</div><div className="text-xs text-gray-500">付款总额</div></div>
          </div>
        </div>

        {/* 筛选 */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">账簿</label>
            <select value={filters.ledgerId} onChange={e => setFilters({ ...filters, ledgerId: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">全部账簿</option>
              {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.accountName}{a.accountHolder ? ` (${a.accountHolder})` : a.bankName ? ` (${a.bankName})` : ''}</option>)}
            </select>
          </div>
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
            <Download className="w-4 h-4" />导出明细
          </button>
        </div>

        {/* 汇总表 */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b">
            <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2"><Wallet className="w-4 h-4 text-lime-600" />账簿汇总</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 text-left"></th>
                <th className="px-4 py-3 text-left">账簿名称</th>
                <th className="px-4 py-3 text-left">户主名</th>
                <th className="px-4 py-3 text-left">银行</th>
                <th className="px-4 py-3 text-left">账号</th>
                <th className="px-4 py-3 text-left">类型</th>
                <th className="px-4 py-3 text-right">付款笔数</th>
                <th className="px-4 py-3 text-right">付款总额</th>
                <th className="px-4 py-3 text-right">余额</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {summary.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400">暂无数据</td></tr>
              ) : summary.map((s: any) => {
                const expanded = expandedLedger === s.ledgerId;
                return (
                  <>
                    <tr key={s.ledgerId} className={`hover:bg-gray-50 cursor-pointer ${expanded ? 'bg-lime-50' : ''}`} onClick={() => setExpandedLedger(expanded ? null : s.ledgerId)}>
                      <td className="px-4 py-3">{expanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}</td>
                      <td className="px-4 py-3 font-medium">{s.accountName}</td>
                      <td className="px-4 py-3">{s.accountHolder || '-'}</td>
                      <td className="px-4 py-3">{s.bankName || '-'}</td>
                      <td className="px-4 py-3 font-mono text-xs">{s.accountNo || '-'}</td>
                      <td className="px-4 py-3">{s.accountType === 'cash' ? '现金' : '银行'}</td>
                      <td className="px-4 py-3 text-right">{s.payCount}</td>
                      <td className="px-4 py-3 text-right font-semibold text-red-600">¥{Number(s.totalAmount).toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-lime-600">¥{(Number(s.totalAmount) + 0).toFixed(2)}</td>
                    </tr>
                    {expanded && filteredDetails.length > 0 && (
                      <tr key={`${s.ledgerId}-detail`}>
                        <td colSpan={9} className="px-8 py-3 bg-gray-50">
                          <table className="w-full text-xs">
                            <thead className="text-gray-500"><tr>
                              <th className="px-2 py-2 text-left">付款单号</th>
                              <th className="px-2 py-2 text-left">来源</th>
                              <th className="px-2 py-2 text-left">收款人</th>
                              <th className="px-2 py-2 text-right">金额</th>
                              <th className="px-2 py-2 text-left">日期</th>
                              <th className="px-2 py-2 text-left">方式</th>
                              <th className="px-2 py-2 text-left">备注</th>
                            </tr></thead>
                            <tbody className="divide-y divide-gray-200">
                              {filteredDetails.map((d: any) => (
                                <tr key={d.id}>
                                  <td className="px-2 py-2 font-mono">{d.payNo}</td>
                                  <td className="px-2 py-2">{SOURCE_TYPE_MAP[d.sourceType] || d.sourceType} {d.sourceNo || ''}</td>
                                  <td className="px-2 py-2">{d.payee || '-'}</td>
                                  <td className="px-2 py-2 text-right font-semibold">¥{Number(d.amount).toFixed(2)}</td>
                                  <td className="px-2 py-2">{d.payDate?.slice(0, 10)}</td>
                                  <td className="px-2 py-2">{d.payMethod || '-'}</td>
                                  <td className="px-2 py-2 text-gray-500">{d.remark || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}

export default LedgerQueryPage;
