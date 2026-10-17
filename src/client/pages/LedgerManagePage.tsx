import { useState, useEffect, useCallback } from 'react';
import { reimbursementApi } from '../../api/reimbursement';
import Layout from '../components/Layout';
import { Plus, Edit2, Trash2, Wallet, Banknote, Landmark, X, CheckCircle2 } from 'lucide-react';

const ACCOUNT_TYPES = [
  { value: 'bank', label: '银行账户' },
  { value: 'cash', label: '现金' },
  { value: 'alipay', label: '支付宝' },
  { value: 'wechat', label: '微信' },
];

function LedgerManagePage() {
  const [list, setList] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const loadData = useCallback(async () => {
    const data = await reimbursementApi.ledgerList();
    if (!data.error && !data.message) setList(data);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleNew = () => {
    setEditing({
      accountName: '',
      accountHolder: '',
      accountNo: '',
      bankName: '',
      accountType: 'bank',
      balance: 0,
      status: 'active',
      remark: '',
    });
    setShowForm(true);
  };

  const handleEdit = (item: any) => {
    setEditing({ ...item });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.accountName.trim()) { alert('请输入账簿名称'); return; }
    if (editing.id) {
      await reimbursementApi.ledgerUpdate(editing.id, editing);
    } else {
      await reimbursementApi.ledgerCreate(editing);
    }
    setShowForm(false);
    setEditing(null);
    loadData();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除此账簿？')) return;
    await reimbursementApi.ledgerDelete(id);
    loadData();
  };

  const handleToggleStatus = async (item: any) => {
    const newStatus = item.status === 'active' ? 'inactive' : 'active';
    await reimbursementApi.ledgerUpdate(item.id, { ...item, status: newStatus });
    loadData();
  };

  const totalBalance = list.filter((a: any) => a.status === 'active').reduce((s: number, a: any) => s + Number(a.balance || 0), 0);

  return (
    <Layout title="账簿管理" subtitle="银行卡及付款账簿管理">
      <div className="p-4 max-w-5xl mx-auto space-y-6">
        {/* 统计 */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
            <div className="p-3 rounded-full bg-lime-50"><Wallet className="w-5 h-5 text-lime-600" /></div>
            <div><div className="text-2xl font-bold text-gray-800">{list.length}</div><div className="text-xs text-gray-500">账簿总数</div></div>
          </div>
          <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
            <div className="p-3 rounded-full bg-blue-50"><Landmark className="w-5 h-5 text-blue-600" /></div>
            <div><div className="text-2xl font-bold text-gray-800">{list.filter((a: any) => a.status === 'active').length}</div><div className="text-xs text-gray-500">启用中</div></div>
          </div>
          <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
            <div className="p-3 rounded-full bg-green-50"><Banknote className="w-5 h-5 text-green-600" /></div>
            <div><div className="text-2xl font-bold text-lime-600">¥{totalBalance.toFixed(2)}</div><div className="text-xs text-gray-500">总余额</div></div>
          </div>
        </div>

        {/* 操作栏 */}
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Wallet className="w-5 h-5 text-lime-600" />账簿列表</h3>
          <button onClick={handleNew} className="flex items-center gap-2 px-4 py-2 bg-lime-600 text-white rounded-lg hover:bg-lime-700 transition">
            <Plus className="w-4 h-4" />新建账簿
          </button>
        </div>

        {/* 表单 */}
        {showForm && editing && (
          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">账簿名称 *</label>
                <input value={editing.accountName} onChange={e => setEditing({ ...editing, accountName: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="如：工商银行基本户" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">户主名</label>
                <input value={editing.accountHolder} onChange={e => setEditing({ ...editing, accountHolder: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="银行卡户主姓名" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">银行名称</label>
                <input value={editing.bankName} onChange={e => setEditing({ ...editing, bankName: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="如：工商银行" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">账号</label>
                <input value={editing.accountNo} onChange={e => setEditing({ ...editing, accountNo: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="银行卡号" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">账簿类型</label>
                <select value={editing.accountType} onChange={e => setEditing({ ...editing, accountType: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">期初余额</label>
                <input type="number" value={editing.balance} onChange={e => setEditing({ ...editing, balance: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">状态</label>
                <select value={editing.status} onChange={e => setEditing({ ...editing, status: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="active">启用</option>
                  <option value="inactive">停用</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">备注</label>
              <input value={editing.remark} onChange={e => setEditing({ ...editing, remark: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="开户行、用途等" />
            </div>
            <div className="flex gap-3">
              <button onClick={handleSave} className="flex items-center gap-1 px-4 py-2 bg-lime-600 text-white rounded-lg hover:bg-lime-700 text-sm"><CheckCircle2 className="w-4 h-4" />保存</button>
              <button onClick={() => { setShowForm(false); setEditing(null); }} className="flex items-center gap-1 px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm"><X className="w-4 h-4" />取消</button>
            </div>
          </div>
        )}

        {/* 列表 */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 text-left">账簿名称</th>
                <th className="px-4 py-3 text-left">户主名</th>
                <th className="px-4 py-3 text-left">银行</th>
                <th className="px-4 py-3 text-left">账号</th>
                <th className="px-4 py-3 text-left">类型</th>
                <th className="px-4 py-3 text-right">余额</th>
                <th className="px-4 py-3 text-center">状态</th>
                <th className="px-4 py-3 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">暂无账簿，点击"新建账簿"开始</td></tr>
              ) : list.map((item: any) => {
                const typeLabel = ACCOUNT_TYPES.find(t => t.value === item.accountType)?.label || item.accountType;
                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{item.accountName}</td>
                    <td className="px-4 py-3">{item.accountHolder || '-'}</td>
                    <td className="px-4 py-3">{item.bankName || '-'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{item.accountNo || '-'}</td>
                    <td className="px-4 py-3">{typeLabel}</td>
                    <td className="px-4 py-3 text-right font-semibold text-lime-600">¥{Number(item.balance).toFixed(2)}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => handleToggleStatus(item)} className={`px-2 py-1 rounded text-xs ${item.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                        {item.status === 'active' ? '启用' : '停用'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => handleEdit(item)} className="text-gray-400 hover:text-lime-600"><Edit2 className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(item.id)} className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}

export default LedgerManagePage;
