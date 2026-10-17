import { useState, useEffect, useCallback } from 'react';
import { reimbursementApi } from '../../api/reimbursement';
import Layout from '../components/Layout';
import { Plus, TrendingDown } from 'lucide-react';

function BudgetControlPage() {
  const [budgets, setBudgets] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ budgetType: 'department', targetName: '', budgetYear: new Date().getFullYear(), budgetMonth: undefined as number | undefined, totalBudget: 0, remark: '' });

  const loadBudgets = useCallback(async () => {
    const data = await reimbursementApi.budgets();
    if (!data.error && !data.message) setBudgets(data);
  }, []);

  useEffect(() => {
    loadBudgets();
  }, [loadBudgets]);

  const handleSave = async () => {
    if (!form.targetName.trim()) { alert('请输入部门/项目名称'); return; }
    await reimbursementApi.createBudget(form);
    setForm({ budgetType: 'department', targetName: '', budgetYear: new Date().getFullYear(), budgetMonth: undefined, totalBudget: 0, remark: '' });
    setShowForm(false);
    loadBudgets();
  };

  return (
    <Layout title="预算管控" subtitle="部门/项目预算设置与余额">
      <div className="p-4 max-w-4xl mx-auto">
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-lime-600" />预算配置
            </h3>
            <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 px-3 py-1.5 bg-lime-50 text-lime-700 border border-lime-200 rounded-lg hover:bg-lime-100 text-sm">
              <Plus className="w-4 h-4" />新建预算
            </button>
          </div>
          {showForm && (
            <div className="mb-4 p-4 bg-gray-50 rounded-lg grid grid-cols-2 gap-3">
              <select value={form.budgetType} onChange={e => setForm({ ...form, budgetType: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="department">部门预算</option>
                <option value="project">项目预算</option>
              </select>
              <input value={form.targetName} onChange={e => setForm({ ...form, targetName: e.target.value })} placeholder="部门/项目名称" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <input type="number" value={form.budgetYear} onChange={e => setForm({ ...form, budgetYear: Number(e.target.value) })} placeholder="年份" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <input type="number" value={form.totalBudget} onChange={e => setForm({ ...form, totalBudget: Number(e.target.value) })} placeholder="预算总额" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <input value={form.remark} onChange={e => setForm({ ...form, remark: e.target.value })} placeholder="备注" className="col-span-2 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <button onClick={handleSave} className="px-4 py-2 bg-lime-600 text-white rounded-lg hover:bg-lime-700 text-sm">保存</button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm">取消</button>
            </div>
          )}
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600"><tr>
              <th className="px-3 py-2 text-left">类型</th><th className="px-3 py-2 text-left">名称</th>
              <th className="px-3 py-2 text-right">预算总额</th><th className="px-3 py-2 text-right">已用</th>
              <th className="px-3 py-2 text-right">剩余</th><th className="px-3 py-2 text-left">使用率</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {budgets.map(b => {
                const remaining = Number(b.totalBudget) - Number(b.usedAmount);
                const pct = b.totalBudget > 0 ? (b.usedAmount / b.totalBudget * 100).toFixed(1) : '0';
                return (
                  <tr key={b.id}>
                    <td className="px-3 py-2">{b.budgetType === 'department' ? '部门' : '项目'}</td>
                    <td className="px-3 py-2">{b.targetName}</td>
                    <td className="px-3 py-2 text-right">¥{Number(b.totalBudget).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">¥{Number(b.usedAmount).toFixed(2)}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${remaining < 0 ? 'text-red-600' : ''}`}>¥{remaining.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-gray-200 rounded-full h-2"><div className={`h-2 rounded-full ${Number(pct) > 80 ? 'bg-red-500' : Number(pct) > 50 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${Math.min(Number(pct), 100)}%` }} /></div>
                        <span className="text-xs">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {budgets.length === 0 && <tr><td colSpan={6} className="text-center text-gray-400 py-8">暂无预算配置</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}

export default BudgetControlPage;
