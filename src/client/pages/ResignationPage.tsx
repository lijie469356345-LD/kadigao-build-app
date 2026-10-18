import { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { getResignations, type ResignationRecord } from '../../api/resignation';
import { Loader2, Info, Search } from 'lucide-react';

const STATUS_LABELS: Record<string, string> = {
  pending: '待审批',
};

/**
 * 离职管理（登记列表）
 * 本轮范围：展示用户管理中登记的离职记录（身份/姓名/组织/手机号/登记时间/操作人）。
 * 离职审批流转（同意/驳回/交接等）等待流程确认后在本页扩展。
 */
export default function ResignationPage() {
  const [items, setItems] = useState<ResignationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getResignations();
      setItems(r);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = items.filter((it) => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return true;
    return [it.userName, it.userCode, it.orgName, it.phone, it.operatorName]
      .some(v => v && String(v).toLowerCase().includes(kw));
  });

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-100';

  return (
    <Layout title="离职管理" subtitle="用户管理中登记离职的员工将在此集中展示（审批流转待确认后扩展）">
      {items.length === 0 ? (
        <div className="mb-4 p-4 rounded-xl bg-blue-50 border border-blue-100 text-sm text-blue-700 flex gap-2">
          <Info size={18} className="shrink-0 mt-0.5" />
          <span>暂无离职记录。请在「用户管理」中对员工点击离职按钮登记，登记后自动出现在本列表。</span>
        </div>
      ) : (
        <div className="mb-4 p-4 rounded-xl bg-blue-50 border border-blue-100 text-sm text-blue-700 flex gap-2">
          <Info size={18} className="shrink-0 mt-0.5" />
          <span>共 {items.length} 条离职记录。离职审批流转流程待确认后在此页扩展（同意/驳回等）。</span>
        </div>
      )}

      {/* 离职记录列表 */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-800">离职登记列表</h3>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className={`${inputCls} pl-9 w-56`}
              placeholder="搜索姓名/工号/组织/手机号..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
        </div>
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">{keyword ? '未找到匹配记录' : '暂无离职记录'}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left">
                  <th className="px-3 py-2.5 font-medium">员工</th>
                  <th className="px-3 py-2.5 font-medium">组织/部门</th>
                  <th className="px-3 py-2.5 font-medium">手机号</th>
                  <th className="px-3 py-2.5 font-medium">状态</th>
                  <th className="px-3 py-2.5 font-medium">离职备注</th>
                  <th className="px-3 py-2.5 font-medium">登记时间</th>
                  <th className="px-3 py-2.5 font-medium">操作人</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => (
                  <tr key={it.id} className="border-t border-gray-100">
                    <td className="px-3 py-3">
                      <div className="text-gray-800 font-medium">{it.userName}</div>
                      <div className="text-xs text-gray-400">{it.userCode}</div>
                    </td>
                    <td className="px-3 py-3 text-gray-600">{it.orgName || '-'}</td>
                    <td className="px-3 py-3 text-gray-600">{it.phone || '-'}</td>
                    <td className="px-3 py-3">
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">
                        {STATUS_LABELS[it.status] || it.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-gray-500 max-w-52 truncate" title={it.remark || ''}>{it.remark || '-'}</td>
                    <td className="px-3 py-3 text-gray-500 text-xs">{it.resignTime}</td>
                    <td className="px-3 py-3 text-gray-600 text-xs">{it.operatorName || '-'}{it.operatorCode ? `（${it.operatorCode}）` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}