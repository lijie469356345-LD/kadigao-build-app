import { useState, useEffect } from 'react';
import { reimbursementApi } from '../../api/reimbursement';
import { X, Banknote, CheckCircle2, Loader2 } from 'lucide-react';

interface PaymentDialogProps {
  sourceType: 'reimbursement' | 'advance' | 'advance_payment';
  sourceId: number;
  sourceNo?: string;
  payee?: string;
  amount?: number;
  onSuccess?: () => void;
  onClose: () => void;
}

function PaymentDialog({ sourceType, sourceId, sourceNo, payee, amount, onSuccess, onClose }: PaymentDialogProps) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    ledgerId: 0,
    ledgerName: '',
    amount: amount || 0,
    payDate: new Date().toISOString().slice(0, 10),
    payMethod: '银行转账',
    remark: '',
  });

  useEffect(() => {
    reimbursementApi.ledgerList({ status: 'active' }).then((data: any) => {
      if (!data.error && !data.message) setAccounts(data);
    });
  }, []);

  const handleLedgerChange = (ledgerId: number) => {
    const acc = accounts.find(a => a.id === ledgerId);
    setForm({ ...form, ledgerId, ledgerName: acc ? `${acc.accountName}(${acc.bankName})` : '' });
  };

  const handleSubmit = async () => {
    if (!form.ledgerId) { alert('请选择付款账簿'); return; }
    if (!form.amount || form.amount <= 0) { alert('请输入付款金额'); return; }
    setLoading(true);
    try {
      const result = await reimbursementApi.paymentCreate({
        sourceType,
        sourceId,
        sourceNo,
        payee,
        amount: form.amount,
        ledgerId: form.ledgerId,
        ledgerName: form.ledgerName,
        payDate: form.payDate,
        payMethod: form.payMethod,
        remark: form.remark,
      });
      if (result.error || result.message) {
        alert(result.message || '付款失败');
      } else {
        alert('付款成功');
        onSuccess?.();
      }
    } catch {
      alert('付款失败，请重试');
    }
    setLoading(false);
  };

  const sourceLabel = sourceType === 'reimbursement' ? '报销单' : sourceType === 'advance' ? '借款申请' : '预付款';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Banknote className="w-5 h-5 text-blue-600" />出纳付款
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {/* 内容 */}
        <div className="p-6 space-y-4">
          {/* 来源信息 */}
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div className="text-xs text-blue-600 mb-1">付款来源</div>
            <div className="text-sm text-blue-800 font-medium">{sourceLabel}：{sourceNo || sourceId}</div>
            {payee && <div className="text-sm text-blue-700">收款人：{payee}</div>}
          </div>

          {/* 账簿选择 */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">付款账簿 *</label>
            <select value={form.ledgerId} onChange={e => handleLedgerChange(Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value={0}>请选择账簿</option>
              {accounts.map((a: any) => (
                <option key={a.id} value={a.id}>{a.accountName} ({a.bankName || '现金'}) - 余额¥{Number(a.balance).toFixed(2)}</option>
              ))}
            </select>
            {accounts.length === 0 && <p className="text-xs text-red-500 mt-1">暂无可用账簿，请先在"账簿管理"中添加</p>}
          </div>

          {/* 金额 */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">付款金额 *</label>
            <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>

          {/* 付款日期 */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">付款日期 *</label>
            <input type="date" value={form.payDate} onChange={e => setForm({ ...form, payDate: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>

          {/* 付款方式 */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">付款方式</label>
            <select value={form.payMethod} onChange={e => setForm({ ...form, payMethod: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="银行转账">银行转账</option>
              <option value="现金">现金</option>
              <option value="支票">支票</option>
              <option value="电子支付">电子支付</option>
            </select>
          </div>

          {/* 备注 */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">备注</label>
            <input value={form.remark} onChange={e => setForm({ ...form, remark: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="付款说明" />
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100 text-sm">取消</button>
          <button onClick={handleSubmit} disabled={loading} className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {loading ? '付款中...' : '确认付款'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PaymentDialog;
