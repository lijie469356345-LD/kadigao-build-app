import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, Edit, Trash2, Search, RefreshCw, Download, Upload, ArrowLeft, X, Save, Database, AlertTriangle, ArrowUp, ArrowDown } from 'lucide-react';
import Layout from '../components/Layout';
import {
  getTableSchema, getTableRows, createRow, updateRow, deleteRow, bulkImport, clearTable,
  TableSchema, ColumnInfo,
} from '../../api/tableManager';
import * as XLSX from 'xlsx';

const EDITABLE_FILTERS = ['id', 'createdAt', 'updatedAt'];

// 岗位模块表 moduleId 对应的中文名称
const MODULE_NAME_MAP: Record<string, string> = {
  system: '系统管理',
  purchase: '采购管理',
  dashboard: '仪表盘',
  inspection: '巡店管理',
  sales: '销售管理',
  pk: 'PK管理',
  staffChannel: '培训反馈',
  automation: '自动化管理',
  directSales: '运营工作汇报',
  coaching: '陪跑跟进',
  douyin: '抖音专区',
  xixie: '洗鞋养护专区',
  financial: '财务年度评估',
  score: '店铺评分预警',
  warehouse: '仓库管理',
  landing: '落地页',
  coutcome: '费用',
  kefu: '客服',
};

export default function DataTableManagerPage() {
  const { table } = useParams<{ table: string }>();
  const navigate = useNavigate();
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingRow, setEditingRow] = useState<Record<string, any> | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const isModuleTable = table === 'PositionModules';

  const load = async () => {
    if (!table) return;
    setLoading(true);
    try {
      const [s, r] = await Promise.all([getTableSchema(table), getTableRows(table)]);
      setSchema(s);
      setRows(r);
    } catch (e: any) {
      alert(e?.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [table]);

  if (!table) return null;

  const pk = schema?.pk || 'id';
  const columns = schema?.columns || [];
  const editableCols = columns.filter(c => !c.isIdentity && !EDITABLE_FILTERS.includes(c.name));

  const filteredRows = rows.filter(r => {
    if (!search) return true;
    const kw = search.toLowerCase();
    return Object.values(r).some(v => v != null && String(v).toLowerCase().includes(kw));
  });

  const handleSort = (col: string) => {
    if (sortKey === col) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col);
      setSortDir('asc');
    }
  };

  const sortedRows = useMemo(() => {
    if (!sortKey) return filteredRows;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return String(va).localeCompare(String(vb), 'zh-CN') * dir;
    });
  }, [filteredRows, sortKey, sortDir]);

  const openAdd = () => {
    setEditingRow(null);
    setForm({});
    setShowModal(true);
  };

  const openEdit = (row: Record<string, any>) => {
    setEditingRow(row);
    setForm({ ...row });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!table) return;
    setSaving(true);
    try {
      if (editingRow) {
        await updateRow(table, editingRow[pk], form);
      } else {
        await createRow(table, form);
      }
      setShowModal(false);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: Record<string, any>) => {
    if (!table) return;
    if (!window.confirm('确定删除这条记录吗？')) return;
    try {
      await deleteRow(table, row[pk]);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || '删除失败');
    }
  };

  const handleExport = () => {
    if (columns.length === 0) return;
    const header = columns.map(c => c.name);
    const data = filteredRows.map(r => columns.map(c => r[c.name] != null ? String(r[c.name]) : ''));
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, schema?.title || table);
    XLSX.writeFile(wb, `${schema?.title || table}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleImportClick = () => {
    if (!window.confirm('导入将追加数据。选择"确定"后请选择 Excel 文件（首行为列名）。')) return;
    fileRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !table) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
      if (json.length === 0) { alert('Excel 无数据'); return; }
      if (!window.confirm(`共解析到 ${json.length} 条数据，确定追加导入吗？`)) return;
      const res = await bulkImport(table, json, 'append');
      alert(`导入成功 ${res.count} 条`);
      load();
    } catch (err: any) {
      alert(err?.response?.data?.error || '导入失败，请检查 Excel 列名是否与表字段一致');
    } finally {
      e.target.value = '';
    }
  };

  const handleClear = async () => {
    if (!table) return;
    if (!window.confirm(`确定清空「${schema?.title || table}」表的所有数据吗？此操作不可撤销！`)) return;
    if (!window.confirm('再次确认：清空后数据将无法恢复，确定继续？')) return;
    try {
      await clearTable(table);
      alert('已清空所有数据');
      load();
    } catch (err: any) {
      alert(err?.response?.data?.error || '清空失败');
    }
  };

  const formatValue = (v: any, col: ColumnInfo): string => {
    if (v === null || v === undefined) return '';
    if (col.type === 'datetime' || col.type === 'datetime2' || col.type === 'date') {
      const d = new Date(v);
      return isNaN(d.getTime()) ? String(v) : d.toLocaleString('zh-CN', { hour12: false });
    }
    return String(v);
  };

  const visibleCols = columns.filter(c => !c.isIdentity);

  return (
    <Layout title={schema?.title || '数据表管理'} subtitle={`管理数据库表 ${table}`}>
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <button onClick={() => navigate('/system')} className="flex items-center gap-1 px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
            <ArrowLeft size={16} /> 返回
          </button>
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-3 py-2 flex-1 max-w-xs">
            <Search size={16} className="text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索..." className="outline-none text-sm flex-1" />
          </div>
          <button onClick={load} className="flex items-center gap-1 px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
            <RefreshCw size={14} /> 刷新
          </button>
          <div className="flex-1" />
          <button onClick={handleExport} className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
            <Download size={14} /> 下载
          </button>
          <button onClick={handleImportClick} className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            <Upload size={14} /> 批量导入
          </button>
          <button onClick={openAdd} className="flex items-center gap-1 px-3 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-dark">
            <Plus size={14} /> 新增
          </button>
          <button onClick={handleClear} className="flex items-center gap-1 px-3 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">
            <AlertTriangle size={14} /> 清空数据
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportFile} />
        </div>

        <div className="bg-white rounded-xl shadow-sm overflow-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-12">#</th>
                {visibleCols.map(c => (
                  <th key={c.name} onClick={() => handleSort(c.name)}
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap cursor-pointer select-none hover:text-gray-700">
                    <span className="inline-flex items-center gap-1">
                      {c.name}
                      {sortKey === c.name && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </span>
                  </th>
                ))}
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 w-24">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={visibleCols.length + 2} className="text-center py-12 text-gray-400">加载中...</td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={visibleCols.length + 2} className="text-center py-12 text-gray-400">
                  <Database size={32} className="mx-auto mb-2 opacity-30" />暂无数据
                </td></tr>
              ) : sortedRows.map((row, i) => (
                <tr key={row[pk]} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-sm text-gray-400">{i + 1}</td>
                  {visibleCols.map(c => {
                    const val = formatValue(row[c.name], c);
                    const tip = isModuleTable && c.name === 'moduleId' ? (`${MODULE_NAME_MAP[String(row[c.name]||'')] || '未映射'}　(moduleId: ${row[c.name] ?? ''})`) : val;
                    return (
                      <td key={c.name} className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap max-w-[260px] truncate" title={tip}>
                        {val || '-'}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => openEdit(row)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded"><Edit size={14} /></button>
                      <button onClick={() => handleDelete(row)} className="p-1.5 text-red-500 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 text-xs text-gray-400">共 {filteredRows.length} 条记录</div>

        {showModal && (
          <div className="fixed inset-0 bg-black/30 flex items-start justify-center z-50 pt-16" onClick={() => setShowModal(false)}>
            <div className="bg-white rounded-xl shadow-xl w-[640px] max-h-[82vh] overflow-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h3 className="text-lg font-semibold">{editingRow ? '编辑记录' : '新增记录'}</h3>
                <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                {editableCols.map(c => {
                  const isModuleField = isModuleTable && (c.name === 'moduleId' || c.name === 'moduleName' || c.name === '模块名称');
                  if (isModuleField) {
                    return (
                      <div key={c.name}>
                        <label className="block text-xs font-medium text-gray-500 mb-1">{c.name}</label>
                        <select
                          value={form[c.name] != null ? String(form[c.name]) : ''}
                          onChange={e => {
                            const val = e.target.value;
                            const newForm = { ...form, [c.name]: val };
                            if (c.name === 'moduleId') {
                              newForm['moduleName'] = MODULE_NAME_MAP[val] || '';
                              newForm['模块名称'] = MODULE_NAME_MAP[val] || '';
                            } else if (c.name === 'moduleName' || c.name === '模块名称') {
                              const mid = Object.entries(MODULE_NAME_MAP).find(([, n]) => n === val)?.[0];
                              if (mid) {
                                newForm['moduleId'] = mid;
                                if ('moduleName' in form || editableCols.some(col => col.name === 'moduleName')) newForm['moduleName'] = val;
                                if ('模块名称' in form || editableCols.some(col => col.name === '模块名称')) newForm['模块名称'] = val;
                              }
                            }
                            setForm(newForm);
                          }}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                        >
                          <option value="">请选择...</option>
                          {Object.entries(MODULE_NAME_MAP).map(([mid, mname]) => (
                            <option key={mid} value={c.name === 'moduleId' ? mid : mname}>
                              {mname} ({mid})
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  }
                  return (
                    <div key={c.name}>
                      <label className="block text-xs font-medium text-gray-500 mb-1">{c.name}</label>
                      <input
                        value={form[c.name] != null ? String(form[c.name]) : ''}
                        onChange={e => setForm({ ...form, [c.name]: e.target.value })}
                        placeholder={c.name}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      />
                    </div>
                  );
                })}
                {editableCols.length === 0 && <p className="text-sm text-gray-400">该表没有可编辑字段</p>}
              </div>
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm">取消</button>
                <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 px-4 py-2 bg-primary text-white rounded-lg text-sm disabled:opacity-50">
                  <Save size={14} /> {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
