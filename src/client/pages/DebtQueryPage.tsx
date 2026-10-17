import { useState, useEffect, useCallback, Fragment } from 'react';
import { reimbursementApi } from '../../api/reimbursement';
import Layout from '../components/Layout';
import {
  Search, ChevronDown, ChevronRight, Wallet, TrendingDown,
  FileText, Receipt, AlertCircle, Download
} from 'lucide-react';

interface DebtSummary {
  employeeId: string;
  employeeName: string;
  groupName: string;
  totalAdvance: number;
  totalReimbDeduction: number;
  debt: number;
}

interface AdvanceDetail {
  id: number;
  advanceNo: string;
  advanceAmount: number;
  deductedAmount: number;
  balance: number;
  advanceDate: string;
  date: string;
  expenseType: string;
  applyReason: string;
  approvalStatus: string;
  type: 'advance';
}

interface ReimbursementDetail {
  id: number;
  reimburseNo: string;
  reimburseDate: string;
  date: string;
  totalAmount: number;
  advanceDeduction: number;
  actualPayable: number;
  status: string;
  reason: string;
  type: 'reimbursement';
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待审批',
  approved: '已批准',
  rejected: '已驳回',
  draft: '草稿',
  submitted: '待审批',
  finance_reviewing: '财务审核中',
  finance_approved: '财务已批',
  finance_rejected: '财务驳回',
  paid: '已付款',
};

function DebtQueryPage() {
  const [list, setList] = useState<DebtSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchKey, setSearchKey] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ advances: AdvanceDetail[]; reimbursements: ReimbursementDetail[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [debTypeFilter, setDebtTypeFilter] = useState<'all' | 'hasDebt' | 'noDebt'>('all');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await reimbursementApi.debtSummary();
      if (!data.error && !data.message) setList(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRowClick = async (emp: DebtSummary) => {
    if (expandedId === emp.employeeId) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(emp.employeeId);
    setDetailLoading(true);
    setDetail(null);
    try {
      const data = await reimbursementApi.debtDetail(emp.employeeId);
      if (!data.error && !data.message) {
        setDetail(data);
      }
    } catch { /* ignore */ }
    setDetailLoading(false);
  };

  // 统计汇总
  const totals = list.reduce((acc, r) => ({
    advance: acc.advance + r.totalAdvance,
    reimb: acc.reimb + r.totalReimbDeduction,
    debt: acc.debt + r.debt,
  }), { advance: 0, reimb: 0, debt: 0 });

  const filteredList = list.filter(r => {
    if (debTypeFilter === 'hasDebt' && r.debt <= 0) return false;
    if (debTypeFilter === 'noDebt' && r.debt > 0) return false;
    if (searchKey) {
      const k = searchKey.toLowerCase();
      return r.employeeName?.toLowerCase().includes(k)
        || r.employeeId?.toLowerCase().includes(k);
    }
    return true;
  });

  const handleExport = () => {
    const headers = ['用户代码', '用户名称', '预支总额', '报销冲抵', '欠款'];
    const rows = filteredList.map(r => [
      r.employeeId, r.employeeName,
      r.totalAdvance.toFixed(2), r.totalReimbDeduction.toFixed(2), r.debt.toFixed(2)
    ]);
    const csv = [headers, ...rows].map(row => row.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `欠款查询_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Layout title="欠款查询" subtitle="预支欠款与报销冲抵统计">
      <div className="p-4 md:p-6">
        {/* 统计卡片 */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Wallet className="w-4 h-4 text-blue-500" />
              <span>预支总额</span>
            </div>
            <div className="text-2xl font-bold text-blue-600 mt-1">¥{totals.advance.toFixed(2)}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Receipt className="w-4 h-4 text-green-500" />
              <span>报销冲抵</span>
            </div>
            <div className="text-2xl font-bold text-green-600 mt-1">¥{totals.reimb.toFixed(2)}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <TrendingDown className="w-4 h-4 text-red-500" />
              <span>净欠款</span>
            </div>
            <div className={`text-2xl font-bold mt-1 ${totals.debt > 0 ? 'text-red-600' : 'text-green-600'}`}>¥{totals.debt.toFixed(2)}</div>
          </div>
        </div>

        {/* 工具栏 */}
        <div className="bg-white rounded-lg shadow p-4 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              {[
                { key: 'all', label: '全部' },
                { key: 'hasDebt', label: '有欠款' },
                { key: 'noDebt', label: '无欠款' },
              ].map(t => (
                <button
                  key={t.key}
                  onClick={() => setDebtTypeFilter(t.key as any)}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors ${debTypeFilter === t.key ? 'bg-white text-lime-600 font-medium shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜索用户名称/代码"
                value={searchKey}
                onChange={e => setSearchKey(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-lime-500"
              />
            </div>

            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 text-sm"
            >
              <Download className="w-4 h-4" />
              <span>导出</span>
            </button>
          </div>
        </div>

        {/* 汇总表 */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left w-8"></th>
                  <th className="px-4 py-3 text-left">用户</th>
                  <th className="px-4 py-3 text-right">预支总额</th>
                  <th className="px-4 py-3 text-right">报销冲抵</th>
                  <th className="px-4 py-3 text-right">欠款</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                      <div className="animate-pulse">加载中...</div>
                    </td>
                  </tr>
                ) : filteredList.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                      <FileText className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                      暂无欠款记录
                    </td>
                  </tr>
                ) : filteredList.map(r => (
                  <Fragment key={r.employeeId}>
                    <tr
                      onClick={() => handleRowClick(r)}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        {expandedId === r.employeeId ? (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800">{r.employeeName || '-'}</div>
                        <div className="text-xs text-gray-400">{r.employeeId}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-blue-600">¥{r.totalAdvance.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-medium text-green-600">¥{r.totalReimbDeduction.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-bold ${r.debt > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          ¥{r.debt.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                    {expandedId === r.employeeId && (
                      <tr key={`${r.employeeId}-detail`}>
                        <td colSpan={5} className="px-4 py-4 bg-gray-50">
                          {detailLoading ? (
                            <div className="text-center text-gray-400 py-4 animate-pulse">加载明细中...</div>
                          ) : detail ? (
                            <div className="space-y-4">
                              {/* 预支记录 */}
                              <div>
                                <h4 className="flex items-center gap-2 text-sm font-bold text-gray-700 mb-2">
                                  <Wallet className="w-4 h-4 text-blue-500" />
                                  预支记录（{detail.advances.length} 条）
                                </h4>
                                {detail.advances.length === 0 ? (
                                  <p className="text-xs text-gray-400 pl-6">无预支记录</p>
                                ) : (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs border border-gray-200 rounded">
                                      <thead className="bg-white text-gray-500">
                                        <tr>
                                          <th className="px-3 py-2 text-left">日期</th>
                                          <th className="px-3 py-2 text-left">编号</th>
                                          <th className="px-3 py-2 text-left">费用类型</th>
                                          <th className="px-3 py-2 text-right">预支金额</th>
                                          <th className="px-3 py-2 text-right">已抵扣</th>
                                          <th className="px-3 py-2 text-right">余额</th>
                                          <th className="px-3 py-2 text-left">事由</th>
                                          <th className="px-3 py-2 text-left">状态</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {detail.advances.map(a => (
                                          <tr key={a.id} className="hover:bg-blue-50">
                                            <td className="px-3 py-2 text-gray-600">{a.date}</td>
                                            <td className="px-3 py-2 font-mono text-gray-500">{a.advanceNo || '-'}</td>
                                            <td className="px-3 py-2">
                                              <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">{a.expenseType || '其他'}</span>
                                            </td>
                                            <td className="px-3 py-2 text-right font-medium text-blue-600">¥{Number(a.advanceAmount).toFixed(2)}</td>
                                            <td className="px-3 py-2 text-right text-gray-500">¥{Number(a.deductedAmount || 0).toFixed(2)}</td>
                                            <td className="px-3 py-2 text-right font-medium text-amber-600">¥{Number(a.balance || 0).toFixed(2)}</td>
                                            <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate" title={a.applyReason}>{a.applyReason || '-'}</td>
                                            <td className="px-3 py-2">
                                              <span className="text-xs text-gray-500">{STATUS_LABELS[a.approvalStatus] || a.approvalStatus}</span>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>

                              {/* 报销冲抵记录 */}
                              <div>
                                <h4 className="flex items-center gap-2 text-sm font-bold text-gray-700 mb-2">
                                  <Receipt className="w-4 h-4 text-green-500" />
                                  报销冲抵记录（{detail.reimbursements.length} 条）
                                </h4>
                                {detail.reimbursements.length === 0 ? (
                                  <p className="text-xs text-gray-400 pl-6">无报销冲抵记录</p>
                                ) : (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs border border-gray-200 rounded">
                                      <thead className="bg-white text-gray-500">
                                        <tr>
                                          <th className="px-3 py-2 text-left">日期</th>
                                          <th className="px-3 py-2 text-left">编号</th>
                                          <th className="px-3 py-2 text-right">报销总额</th>
                                          <th className="px-3 py-2 text-right">冲抵预支</th>
                                          <th className="px-3 py-2 text-right">实际应付</th>
                                          <th className="px-3 py-2 text-left">事由</th>
                                          <th className="px-3 py-2 text-left">状态</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {detail.reimbursements.map(rm => (
                                          <tr key={rm.id} className="hover:bg-green-50">
                                            <td className="px-3 py-2 text-gray-600">{rm.date}</td>
                                            <td className="px-3 py-2 font-mono text-gray-500">{rm.reimburseNo || '-'}</td>
                                            <td className="px-3 py-2 text-right text-gray-600">¥{Number(rm.totalAmount || 0).toFixed(2)}</td>
                                            <td className="px-3 py-2 text-right font-medium text-green-600">¥{Number(rm.advanceDeduction || 0).toFixed(2)}</td>
                                            <td className="px-3 py-2 text-right text-gray-500">¥{Number(rm.actualPayable || 0).toFixed(2)}</td>
                                            <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate" title={rm.reason}>{rm.reason || '-'}</td>
                                            <td className="px-3 py-2">
                                              <span className="text-xs text-gray-500">{STATUS_LABELS[rm.status] || rm.status}</span>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="text-center text-red-400 py-4 flex items-center justify-center gap-2">
                              <AlertCircle className="w-4 h-4" />
                              <span>加载明细失败</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default DebtQueryPage;
