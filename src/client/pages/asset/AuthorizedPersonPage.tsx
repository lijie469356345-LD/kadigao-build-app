import { useState, useEffect, useCallback, useRef } from 'react';
import Layout from '../../components/Layout';
import { authorizedPersonApi } from '../../../api/assetManagement';
import {
  Plus, Edit, Trash2, Search, CheckCircle2, X, Loader2,
  BadgeCheck, FileImage, AlertCircle, Upload, Eye,
} from 'lucide-react';

// ============================================================
// 类型定义
// ============================================================
interface AuthorizedPerson {
  id: number;
  personName: string;
  phone: string;
  dept: string;
  remark: string;
  certCount?: number;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: any;
}

interface Certificate {
  id: number;
  personId: number;
  certType: string;
  certNo: string;
  issueDate: string;
  expiryDate: string;
  filePath: string;
  fileName: string;
  remark: string;
  createdByName: string;
  createdAt: string;
  [key: string]: any;
}

// ============================================================
// 常量
// ============================================================
const CERT_TYPE_OPTIONS = [
  '驾驶证', '身份证', '护照', '行驶证', '从业资格证',
  '健康证', '特种设备操作证', '电工证', '焊工证', '其他',
];

const EMPTY_PERSON_FORM = {
  personName: '',
  phone: '',
  dept: '',
  remark: '',
};

const EMPTY_CERT_FORM = {
  certType: '驾驶证',
  certNo: '',
  issueDate: '',
  expiryDate: '',
  remark: '',
};

// ============================================================
// 工具函数
// ============================================================
function formatDate(d: string | undefined | null): string {
  if (!d) return '-';
  return String(d).slice(0, 10);
}

function isExpiringSoon(expiryDate: string): boolean {
  if (!expiryDate) return false;
  const d = new Date(expiryDate);
  const now = new Date();
  const diff = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 30;
}

function isExpired(expiryDate: string): boolean {
  if (!expiryDate) return false;
  const d = new Date(expiryDate);
  return d.getTime() < Date.now();
}

// ============================================================
// 主组件
// ============================================================
function AuthorizedPersonPage() {
  const [persons, setPersons] = useState<AuthorizedPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ ...EMPTY_PERSON_FORM });
  const [saving, setSaving] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<AuthorizedPerson | null>(null);
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [certsLoading, setCertsLoading] = useState(false);
  const [showCertModal, setShowCertModal] = useState(false);
  const [certForm, setCertForm] = useState({ ...EMPTY_CERT_FORM });
  const [certSaving, setCertSaving] = useState(false);
  const [certFile, setCertFile] = useState<File | null>(null);
  const certFileRef = useRef<HTMLInputElement>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (keyword) params.keyword = keyword;
      const res = await authorizedPersonApi.list(params);
      if (res.data.ok) setPersons(res.data.data || []);
    } catch (e: any) { alert(e.response?.data?.error || e.message || '获取数据失败'); }
    setLoading(false);
  }, [keyword]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSearch = () => { loadData(); };

  const handleReset = () => { setKeyword(''); };

  const handleAdd = () => {
    setEditingId(null);
    setFormData({ ...EMPTY_PERSON_FORM });
    setShowModal(true);
  };

  const handleEdit = (person: AuthorizedPerson) => {
    setEditingId(person.id);
    setFormData({
      personName: person.personName || '',
      phone: person.phone || '',
      dept: person.dept || '',
      remark: person.remark || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (person: AuthorizedPerson) => {
    if (!confirm(`确定删除授权人「${person.personName}」及其所有证件？此操作不可撤销。`)) return;
    try {
      const res = await authorizedPersonApi.remove(person.id);
      if (res.data.ok) { alert('删除成功'); loadData(); }
      else alert(res.data.error || '删除失败');
    } catch (e: any) { alert(e.response?.data?.error || e.message || '删除失败'); }
  };

  const handleSave = async () => {
    if (!formData.personName.trim()) { alert('请输入姓名'); return; }
    setSaving(true);
    try {
      const payload = { ...formData };
      let res;
      if (editingId) {
        res = await authorizedPersonApi.update(editingId, payload);
      } else {
        res = await authorizedPersonApi.create(payload);
      }
      if (res.data.ok) {
        alert(editingId ? '更新成功' : '新增成功');
        setShowModal(false);
        loadData();
      } else {
        alert(res.data.error || '保存失败');
      }
    } catch (e: any) { alert(e.response?.data?.error || e.message || '保存失败'); }
    setSaving(false);
  };

  const handleViewCerts = async (person: AuthorizedPerson) => {
    setSelectedPerson(person);
    setCertsLoading(true);
    try {
      const res = await authorizedPersonApi.getCertificates(person.id);
      if (res.data.ok) setCerts(res.data.data || []);
    } catch (e: any) { alert(e.response?.data?.error || e.message); }
    setCertsLoading(false);
  };

  const handleAddCert = () => {
    setCertForm({ ...EMPTY_CERT_FORM });
    setCertFile(null);
    setShowCertModal(true);
  };

  const handleSaveCert = async () => {
    if (!selectedPerson) return;
    if (!certForm.certType.trim()) { alert('请选择证件类型'); return; }
    if (!certFile) { alert('请上传证件图片'); return; }
    setCertSaving(true);
    try {
      const res = await authorizedPersonApi.uploadCertificate(selectedPerson.id, certFile, certForm);
      if (res.data.ok) {
        alert('证件上传成功');
        setShowCertModal(false);
        setCertFile(null);
        handleViewCerts(selectedPerson);
        loadData();
      } else {
        alert(res.data.error || '上传失败');
      }
    } catch (e: any) { alert(e.response?.data?.error || e.message || '上传失败'); }
    setCertSaving(false);
  };

  const handleDeleteCert = async (cert: Certificate) => {
    if (!confirm(`确定删除该证件（${cert.certType}）？`)) return;
    try {
      const res = await authorizedPersonApi.removeCertificate(cert.id);
      if (res.data.ok && selectedPerson) {
        handleViewCerts(selectedPerson);
        loadData();
      } else alert(res.data.error || '删除失败');
    } catch (e: any) { alert(e.response?.data?.error || e.message); }
  };

  return (
    <Layout title="授权人管理" subtitle="管理驾照、证件等授权类资质">
      <div className="p-2 sm:p-4 lg:p-6">
        {/* 筛选栏 */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-gray-500 mb-1">关键词</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
                  placeholder="姓名/电话/部门"
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <button onClick={handleSearch} className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
              <Search className="w-4 h-4" />查询
            </button>
            <button onClick={handleReset} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 text-sm">
              重置
            </button>
            <button onClick={handleAdd} className="flex items-center gap-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
              <Plus className="w-4 h-4" />新增授权人
            </button>
          </div>
        </div>

        {/* 授权人列表 */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              <span className="ml-2 text-gray-500">加载中...</span>
            </div>
          ) : persons.length === 0 ? (
            <div className="py-16 text-center text-gray-400">
              <BadgeCheck className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>暂无授权人记录</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-3 text-left">姓名</th>
                    <th className="px-3 py-3 text-left">电话</th>
                    <th className="px-3 py-3 text-left">部门</th>
                    <th className="px-3 py-3 text-center">证件数</th>
                    <th className="px-3 py-3 text-left">备注</th>
                    <th className="px-3 py-3 text-left">创建人</th>
                    <th className="px-3 py-3 text-left">创建时间</th>
                    <th className="px-3 py-3 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {persons.map(p => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-3 py-3 font-medium text-gray-800">{p.personName}</td>
                      <td className="px-3 py-3 text-gray-600">{p.phone || '-'}</td>
                      <td className="px-3 py-3 text-gray-600">{p.dept || '-'}</td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${(p.certCount || 0) > 0 ? 'text-blue-600 bg-blue-50' : 'text-gray-400 bg-gray-50'}`}>
                          {p.certCount || 0}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-gray-500 text-xs max-w-[120px] truncate" title={p.remark || ''}>{p.remark || '-'}</td>
                      <td className="px-3 py-3 text-gray-600">{p.createdByName || '-'}</td>
                      <td className="px-3 py-3 text-gray-500">{formatDate(p.createdAt)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleViewCerts(p)}
                            className="p-1.5 text-gray-400 hover:text-purple-600 rounded hover:bg-purple-50"
                            title="查看证件"
                          >
                            <FileImage className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleEdit(p)}
                            className="p-1.5 text-gray-400 hover:text-green-600 rounded hover:bg-green-50"
                            title="编辑"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(p)}
                            className="p-1.5 text-gray-400 hover:text-red-600 rounded hover:bg-red-50"
                            title="删除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 新增/编辑授权人弹窗 */}
        {showModal && (
          <Modal title={editingId ? '编辑授权人' : '新增授权人'} onClose={() => setShowModal(false)}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="姓名" required>
                <input
                  type="text"
                  value={formData.personName}
                  onChange={e => setFormData({ ...formData, personName: e.target.value })}
                  className="form-input"
                />
              </Field>
              <Field label="电话">
                <input
                  type="text"
                  value={formData.phone}
                  onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  className="form-input"
                />
              </Field>
              <Field label="部门">
                <input
                  type="text"
                  value={formData.dept}
                  onChange={e => setFormData({ ...formData, dept: e.target.value })}
                  className="form-input"
                />
              </Field>
              <Field label="备注">
                <input
                  type="text"
                  value={formData.remark}
                  onChange={e => setFormData({ ...formData, remark: e.target.value })}
                  className="form-input"
                />
              </Field>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </Modal>
        )}

        {/* 证件列表弹窗 */}
        {selectedPerson && (
          <Modal title={`证件管理 - ${selectedPerson.personName}`} onClose={() => setSelectedPerson(null)} wide>
            {certsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm text-gray-500">
                    共 <span className="font-semibold text-blue-600">{certs.length}</span> 个证件
                    {certs.some(c => isExpired(c.expiryDate)) && (
                      <span className="ml-3 text-red-600 font-medium">有证件已过期</span>
                    )}
                    {certs.some(c => isExpiringSoon(c.expiryDate)) && (
                      <span className="ml-3 text-amber-600 font-medium">有证件即将到期</span>
                    )}
                  </div>
                  <button
                    onClick={handleAddCert}
                    className="flex items-center gap-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                  >
                    <Plus className="w-4 h-4" />上传证件
                  </button>
                </div>

                {certs.length === 0 ? (
                  <div className="py-12 text-center text-gray-400">
                    <FileImage className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                    <p>暂无证件记录，点击"上传证件"添加</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {certs.map(c => {
                      const expired = isExpired(c.expiryDate);
                      const expiringSoon = isExpiringSoon(c.expiryDate);
                      return (
                        <div key={c.id} className="border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow">
                          {/* 证件图片预览 */}
                          <div className="bg-gray-50 h-40 flex items-center justify-center overflow-hidden">
                            {c.filePath ? (
                              <img
                                src={c.filePath}
                                alt={c.certType}
                                className="w-full h-full object-contain cursor-pointer"
                                onClick={() => setPreviewImage(c.filePath)}
                              />
                            ) : (
                              <FileImage className="w-10 h-10 text-gray-300" />
                            )}
                          </div>
                          {/* 证件信息 */}
                          <div className="p-3 space-y-1 text-sm">
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-gray-800">{c.certType}</span>
                              {expired && <span className="text-xs px-2 py-0.5 bg-red-100 text-red-600 rounded">已过期</span>}
                              {expiringSoon && !expired && <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-600 rounded">即将到期</span>}
                            </div>
                            {c.certNo && <div className="text-gray-600">证件号：{c.certNo}</div>}
                            <div className="text-gray-500 text-xs">
                              有效期：{formatDate(c.issueDate)} ~ {formatDate(c.expiryDate)}
                            </div>
                            {c.remark && <div className="text-gray-500 text-xs truncate" title={c.remark}>{c.remark}</div>}
                            <div className="flex items-center gap-2 pt-2">
                              {c.filePath && (
                                <a
                                  href={c.filePath}
                                  download
                                  className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded"
                                >
                                  <Eye className="w-3 h-3" />下载
                                </a>
                              )}
                              <button
                                onClick={() => handleDeleteCert(c)}
                                className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded ml-auto"
                              >
                                <Trash2 className="w-3 h-3" />删除
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </Modal>
        )}

        {/* 上传证件弹窗 */}
        {showCertModal && selectedPerson && (
          <Modal title={`上传证件 - ${selectedPerson.personName}`} onClose={() => setShowCertModal(false)}>
            <div className="space-y-4">
              <Field label="证件类型" required>
                <select
                  value={certForm.certType}
                  onChange={e => setCertForm({ ...certForm, certType: e.target.value })}
                  className="form-input"
                >
                  {CERT_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="证件编号">
                <input
                  type="text"
                  value={certForm.certNo}
                  onChange={e => setCertForm({ ...certForm, certNo: e.target.value })}
                  placeholder="如：驾驶证号码"
                  className="form-input"
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="发证日期">
                  <input
                    type="date"
                    value={certForm.issueDate}
                    onChange={e => setCertForm({ ...certForm, issueDate: e.target.value })}
                    className="form-input"
                  />
                </Field>
                <Field label="到期日期">
                  <input
                    type="date"
                    value={certForm.expiryDate}
                    onChange={e => setCertForm({ ...certForm, expiryDate: e.target.value })}
                    className="form-input"
                  />
                </Field>
              </div>
              <Field label="备注">
                <input
                  type="text"
                  value={certForm.remark}
                  onChange={e => setCertForm({ ...certForm, remark: e.target.value })}
                  className="form-input"
                />
              </Field>
              <Field label="证件图片" required>
                <div
                  onClick={() => certFileRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30"
                >
                  {certFile ? (
                    <div className="flex items-center justify-center gap-2 text-sm text-blue-600">
                      <CheckCircle2 className="w-4 h-4" />
                      {certFile.name}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-400">
                      <Upload className="w-8 h-8 mx-auto mb-2" />
                      点击上传证件图片（JPG/PNG等）
                    </div>
                  )}
                </div>
                <input
                  ref={certFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) setCertFile(f); e.target.value = ''; }}
                />
              </Field>
            </div>
            <div className="mt-2 p-3 bg-blue-50 rounded-lg text-xs text-blue-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>支持 JPG、PNG 等图片格式，文件不超过 20MB。</span>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
              <button onClick={() => setShowCertModal(false)} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">
                取消
              </button>
              <button
                onClick={handleSaveCert}
                disabled={certSaving}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {certSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {certSaving ? '上传中...' : '上传证件'}
              </button>
            </div>
          </Modal>
        )}

        {/* 图片大图预览 */}
        {previewImage && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
            onClick={() => setPreviewImage(null)}
          >
            <img src={previewImage} alt="证件预览" className="max-w-full max-h-[90vh] object-contain rounded-lg" />
            <button className="absolute top-4 right-4 text-white p-2 rounded-full hover:bg-white/10" onClick={() => setPreviewImage(null)}>
              <X className="w-6 h-6" />
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}

// ============================================================
// 通用组件
// ============================================================
function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className={`bg-white rounded-lg shadow-xl max-h-[90vh] overflow-y-auto ${wide ? 'max-w-5xl' : 'max-w-2xl'} w-full`}>
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white z-10">
          <h3 className="text-lg font-bold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="block text-sm text-gray-600 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

export default AuthorizedPersonPage;
