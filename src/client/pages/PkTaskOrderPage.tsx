import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { getPkTaskOrders, createPkTaskOrder, updatePkTaskOrder, deletePkTaskOrder, PkTaskOrder } from '../../api/pk';
import { Plus, Trash2, Save, ClipboardList, AlertTriangle } from 'lucide-react';

// 本地日期 YYYY-MM-DD
function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function PkTaskOrderPage() {
  const [rows, setRows] = useState<PkTaskOrder[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getPkTaskOrders();
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (e: any) {
      alert(e?.response?.data?.error || '加载任务单失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    try {
      const today = todayStr();
      await createPkTaskOrder({ orderName: '', docDate: today, pkStartDate: today, pkEndDate: today, remark: '' });
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || '新增任务单失败');
    }
  };

  const setRow = (index: number, patch: Partial<PkTaskOrder>) => {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, ...patch } : r));
  };

  const handleSave = async (row: PkTaskOrder) => {
    if (!String(row.orderName).trim()) { alert('任务单名称不能为空'); return; }
    if (!row.pkStartDate) { alert('请填写 PK 开始日期'); return; }
    try {
      const data = {
        orderName: String(row.orderName).trim(),
        docDate: row.docDate || undefined,
        pkStartDate: row.pkStartDate || undefined,
        pkEndDate: row.pkEndDate || undefined,
        remark: row.remark || '',
      };
      if (row.id) {
        await updatePkTaskOrder(row.id, data);
      }
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || '保存任务单失败');
    }
  };

  const handleDelete = async (row: PkTaskOrder) => {
    const msg = `确定删除任务单「${row.orderName}」？\n` +
      `该操作将同时删除其下 ${row.targetCount} 条 PK店铺目标、${row.dimCount} 个 PK维度配置，且不可恢复！`;
    if (!confirm(msg)) return;
    try {
      const res = await deletePkTaskOrder(row.id);
      alert(`已删除任务单「${row.orderName}」，级联删除 ${res.data?.deletedTargets ?? 0} 条店铺目标、${res.data?.deletedDims ?? 0} 个维度。`);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || '删除任务单失败');
    }
  };

  const th = 'px-4 py-3 text-left text-sm font-medium text-gray-600 whitespace-nowrap';
  const td = 'px-4 py-3 text-sm text-gray-800 align-middle';
  const inputCls = 'border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 w-full';

  return (
    <Layout title="PK任务单" subtitle="先建立 PK任务单（制单日期 / PK日期 / 任务单名称），之后才能录入 PK店铺目标；删除任务单会同步删除其下的店铺目标与维度配置">
      <div className="p-4">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-sm font-medium">
            <ClipboardList size={14} /> 已建 {rows.length} 个任务单
          </span>
          <button
            onClick={handleAdd}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-blue-700"
          >
            <Plus size={14} /> 新建任务单
          </button>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-600 rounded-lg text-sm">
            <AlertTriangle size={14} /> PK店铺目标 / PK维度设定 / PK报表 均按任务单独立组织
          </span>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
          {loading && <div className="p-8 text-center text-gray-400 text-sm">加载中...</div>}
          {!loading && rows.length === 0 && (
            <div className="px-6 py-12 text-center">
              <p className="text-gray-400 text-sm mb-3">还没有 PK任务单，点击「新建任务单」创建后即可录入店铺目标与维度</p>
              <button onClick={handleAdd} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">新建任务单</button>
            </div>
          )}
          {rows.length > 0 && (
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className={th}>任务单名称</th>
                  <th className={th}>制单日期</th>
                  <th className={th}>PK开始日期</th>
                  <th className={th}>PK截止日期</th>
                  <th className={th}>备注</th>
                  <th className={th}>店铺目标</th>
                  <th className={th}>维度</th>
                  <th className={th}>创建人 / 时间</th>
                  <th className={`${th} w-40`}>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={row.id || `new-${rowIndex}`} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                    <td className={td}>
                      <input value={row.orderName} onChange={e => setRow(rowIndex, { orderName: e.target.value })} className={`${inputCls} w-52`} placeholder="如：2026年10月PK" />
                    </td>
                    <td className={td}>
                      <input type="date" value={row.docDate || ''} onChange={e => setRow(rowIndex, { docDate: e.target.value })} className={inputCls} />
                    </td>
                    <td className={td}>
                      <input type="date" value={row.pkStartDate || ''} onChange={e => setRow(rowIndex, { pkStartDate: e.target.value })} className={inputCls} />
                    </td>
                    <td className={td}>
                      <input type="date" value={row.pkEndDate || ''} onChange={e => setRow(rowIndex, { pkEndDate: e.target.value })} className={inputCls} />
                    </td>
                    <td className={td}>
                      <input value={row.remark || ''} onChange={e => setRow(rowIndex, { remark: e.target.value })} className={inputCls} placeholder="备注（可选）" />
                    </td>
                    <td className={`${td} text-center`}>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${row.targetCount > 0 ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                        {row.targetCount} 条
                      </span>
                    </td>
                    <td className={`${td} text-center`}>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${row.dimCount > 0 ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>
                        {row.dimCount} 个
                      </span>
                    </td>
                    <td className={td}>
                      <div className="text-xs text-gray-500">
                        {row.createdBy ? <div>{row.createdBy}</div> : null}
                        {row.createdAt ? <div className="text-gray-400">{row.createdAt}</div> : null}
                      </div>
                    </td>
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleSave(row)}
                          className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm flex items-center gap-1 hover:bg-teal-700"
                        >
                          <Save size={13} /> 保存
                        </button>
                        <button
                          onClick={() => handleDelete(row)}
                          className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-sm flex items-center gap-1 hover:bg-red-100"
                          title="删除任务单（同步删除其下店铺目标与维度）"
                        >
                          <Trash2 size={13} /> 删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
}

export default PkTaskOrderPage;