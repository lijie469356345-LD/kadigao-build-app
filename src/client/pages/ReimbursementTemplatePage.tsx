import { useState, useEffect, useCallback } from 'react';
import { reimbursementApi } from '../../api/reimbursement';
import Layout from '../components/Layout';
import { Plus, Trash2, FileText } from 'lucide-react';

const REIMBURSE_TYPES = ['差旅费', '业务招待', '办公费', '交通费', '培训费', '其他'];

function ReimbursementTemplatePage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ templateName: '', reimburseType: '差旅费', reason: '', isPublic: true });

  const loadTemplates = useCallback(async () => {
    const data = await reimbursementApi.templates();
    if (!data.error && !data.message) setTemplates(data);
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleSave = async () => {
    if (!form.templateName.trim()) { alert('请输入模板名称'); return; }
    await reimbursementApi.createTemplate(form);
    setForm({ templateName: '', reimburseType: '差旅费', reason: '', isPublic: true });
    setShowForm(false);
    loadTemplates();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除此模板？')) return;
    await reimbursementApi.deleteTemplate(id);
    loadTemplates();
  };

  return (
    <Layout title="模板管理" subtitle="报销模板配置与管理">
      <div className="p-4 max-w-4xl mx-auto">
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <FileText className="w-5 h-5 text-lime-600" />报销模板
            </h3>
            <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 px-3 py-1.5 bg-lime-50 text-lime-700 border border-lime-200 rounded-lg hover:bg-lime-100 text-sm">
              <Plus className="w-4 h-4" />新建模板
            </button>
          </div>
          {showForm && (
            <div className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
              <input value={form.templateName} onChange={e => setForm({ ...form, templateName: e.target.value })} placeholder="模板名称" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <select value={form.reimburseType} onChange={e => setForm({ ...form, reimburseType: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                {REIMBURSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="默认事由" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <div className="flex gap-3">
                <button onClick={handleSave} className="px-4 py-2 bg-lime-600 text-white rounded-lg hover:bg-lime-700 text-sm">保存</button>
                <button onClick={() => setShowForm(false)} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm">取消</button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {templates.map(tpl => (
              <div key={tpl.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                <div>
                  <span className="font-medium text-sm">{tpl.templateName}</span>
                  <span className="text-xs text-gray-500 ml-2">{tpl.reimburseType} | {tpl.reason}</span>
                </div>
                <button onClick={() => handleDelete(tpl.id)} className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            {templates.length === 0 && <p className="text-center text-gray-400 py-4">暂无模板</p>}
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default ReimbursementTemplatePage;
