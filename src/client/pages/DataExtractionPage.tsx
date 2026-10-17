import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Search, RefreshCw, Database, X, Copy } from 'lucide-react';
import Layout from '../components/Layout';
import { getDataExtractions, getCategories, createDataExtraction, updateDataExtraction, deleteDataExtraction, DataExtractionItem } from '../../api/dataExtraction';

const emptyForm: DataExtractionItem = { fieldName: '', sqlQuery: '', params: '', description: '', category: '' };

export default function DataExtractionPage() {
  const [items, setItems] = useState<DataExtractionItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<DataExtractionItem | null>(null);
  const [form, setForm] = useState<DataExtractionItem>({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [data, cats] = await Promise.all([
        getDataExtractions(keyword || undefined, catFilter || undefined),
        getCategories(),
      ]);
      setItems(data);
      setCategories(cats);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [catFilter]);

  const openAdd = () => { setEditItem(null); setForm({ ...emptyForm }); setShowModal(true); };
  const openEdit = (item: DataExtractionItem) => { setEditItem(item); setForm({ ...item }); setShowModal(true); };
  const copyItem = (item: DataExtractionItem) => {
    setEditItem(null);
    setForm({ ...item, fieldName: item.fieldName + '_副本', id: undefined });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.fieldName.trim() || !form.sqlQuery.trim()) { alert('字段名称和SQL语句为必填'); return; }
    setSaving(true);
    try {
      if (editItem?.id) {
        await updateDataExtraction(editItem.id, form);
      } else {
        await createDataExtraction(form);
      }
      setShowModal(false);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || '保存失败');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`确定删除 "${name}" 吗？`)) return;
    try { await deleteDataExtraction(id); load(); }
    catch (e: any) { alert(e?.response?.data?.error || '删除失败'); }
  };

  return (
    <Layout title="数据提取" subtitle="管理和维护查询语句台账">
      <div className="p-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-3 py-2 flex-1 max-w-xs">
            <Search size={16} className="text-gray-400" />
            <input
              value={keyword} onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') load(); }}
              placeholder="搜索字段名/说明/SQL..."
              className="outline-none text-sm flex-1"
            />
          </div>
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
            <option value="">全部分类</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={load} className="flex items-center gap-1 px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
            <RefreshCw size={14} /> 搜索
          </button>
          <div className="flex-1" />
          <button onClick={openAdd} className="flex items-center gap-1 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-dark">
            <Plus size={16} /> 新增字段
          </button>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-12">#</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">字段名称</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">分类</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">参数</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">说明</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">SQL语句(前100字)</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 w-24">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">加载中...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">
                  <Database size={32} className="mx-auto mb-2 opacity-30" />暂无数据，点击"新增字段"开始
                </td></tr>
              ) : items.map((item, i) => (
                <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-sm text-gray-400">{i + 1}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-800">{item.fieldName}</td>
                  <td className="px-4 py-3 text-sm">
                    {item.category && <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">{item.category}</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{item.params || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 max-w-[200px] truncate">{item.description || '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-400 font-mono max-w-[300px] truncate">{item.sqlQuery?.substring(0, 100)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => copyItem(item)} className="p-1.5 text-green-500 hover:bg-green-50 rounded" title="复制">
                        <Copy size={14} />
                      </button>
                      <button onClick={() => openEdit(item)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded">
                        <Edit size={14} />
                      </button>
                      <button onClick={() => item.id && handleDelete(item.id, item.fieldName)} className="p-1.5 text-red-500 hover:bg-red-50 rounded">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 text-xs text-gray-400">共 {items.length} 条记录</div>

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/30 flex items-start justify-center z-50 pt-20" onClick={() => setShowModal(false)}>
            <div className="bg-white rounded-xl shadow-xl w-[720px] max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h3 className="text-lg font-semibold">{editItem?.id ? '编辑字段' : '新增字段'}</h3>
                <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">字段名称 <span className="text-red-500">*</span></label>
                    <input value={form.fieldName} onChange={e => setForm({ ...form, fieldName: e.target.value })}
                      placeholder="唯一标识，如：店铺销售金额" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">分类</label>
                    <div className="flex gap-1">
                      <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                        placeholder="如：销售报表" className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                        list="cat-list" />
                      <datalist id="cat-list">{categories.map(c => <option key={c} value={c} />)}</datalist>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">所需参数</label>
                  <input value={form.params} onChange={e => setForm({ ...form, params: e.target.value })}
                    placeholder="逗号分隔，如：startDate,endDate,shopName" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">字段说明</label>
                  <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                    placeholder="描述这个字段的用途..." className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">SQL查询语句 <span className="text-red-500">*</span></label>
                  <textarea value={form.sqlQuery} onChange={e => setForm({ ...form, sqlQuery: e.target.value })}
                    placeholder="完整SQL，用 @参数名 占位..." rows={10}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono resize-none" />
                  <p className="text-xs text-gray-400 mt-1">使用 @参数名 作为占位符，如 @startDate、@endDate</p>
                </div>
              </div>
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm">取消</button>
                <button onClick={handleSave} disabled={saving}
                  className="px-4 py-2 bg-primary text-white rounded-lg text-sm disabled:opacity-50">
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
