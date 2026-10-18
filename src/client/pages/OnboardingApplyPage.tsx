import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { applyOnboarding, getOnboardingOptions, uploadOnboardingImage } from '../../api/onboarding';

/** 随内容自动拓展高度的文本域（内容增多时高度自动增高） */
function AutoTextarea({ value, onChange, className, placeholder, minRows = 1 }: {
  value: string; onChange: (v: string) => void; className?: string; placeholder?: string; minRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(el.scrollHeight, minRows * 24) + 'px';
  };
  useEffect(() => { resize(); }, [value]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      className={`${className || ''} resize-none overflow-hidden`}
      value={value}
      placeholder={placeholder}
      onChange={(e) => { onChange(e.target.value); }}
      onInput={resize}
    />
  );
}

/**
 * 入职管理 · 阶段一：新员工自主信息录入（发起入职）
 * 前台专属入职二维码扫码进入本页；无 Layout，公开访问。
 * 资料提交成功 → 系统自动生成入职初始记录（待督导初审）并推送负责督导。
 */
export default function OnboardingApplyPage() {
  const navigate = useNavigate();
  const [supervisors, setSupervisors] = useState<{ userCode: string; userName: string }[]>([]);
  const [loadingOpt, setLoadingOpt] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    userName: '',
    phone: '',
    gender: '',
    idCard: '',
    birthday: '',
    education: '',
    emergencyContact: '',
    emergencyPhone: '',
    address: '',
    email: '',
    resumeText: '',
    materials: '',
    supervisorCode: '',
  });
  // 佐证材料图片：上传后展示缩略图，提交时与文本材料合并
  const [materialImages, setMaterialImages] = useState<string[]>([]);
  const [uploadingImg, setUploadingImg] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getOnboardingOptions()
      .then((d) => setSupervisors(d.supervisors || []))
      .catch(() => setSupervisors([]))
      .finally(() => setLoadingOpt(false));
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const inputCls =
    'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary';

  const handleSelectImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError('');
    const list = Array.from(files).filter((f) => /^image\/(jpeg|png|gif|webp)$/i.test(f.type));
    if (list.length === 0) return setError('仅支持 jpg/png/gif/webp 格式图片');
    if (list.some((f) => f.size > 5 * 1024 * 1024)) return setError('单张图片不能超过 5MB，请压缩后重试');
    setUploadingImg(true);
    try {
      const urls: string[] = [];
      for (const f of list) {
        const r = await uploadOnboardingImage(f);
        if (r.ok && r.url) urls.push(r.url);
        else throw new Error(r.message || '上传失败');
      }
      setMaterialImages((prev) => [...prev, ...urls]);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || '图片上传失败，请重试');
    } finally {
      setUploadingImg(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    setError('');
    setSuccess('');
    if (!form.userName.trim()) return setError('请填写姓名');
    if (!/^1\d{10}$/.test(form.phone)) return setError('请填写正确的 11 位手机号');
    if (!form.supervisorCode) return setError('请选择负责督导');
    setSubmitting(true);
    try {
      const textMaterials = form.materials
        .split(/[\n,，;；]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const materials = [...textMaterials, ...materialImages];
      const res = await applyOnboarding({
        userName: form.userName.trim(),
        phone: form.phone.trim(),
        gender: form.gender,
        idCard: form.idCard.trim(),
        birthday: form.birthday,
        education: form.education,
        emergencyContact: form.emergencyContact,
        emergencyPhone: form.emergencyPhone,
        address: form.address,
        email: form.email,
        resumeText: form.resumeText,
        materials,
        supervisorCode: form.supervisorCode,
      });
      if (res.ok) {
        setSuccess(`提交成功！您的入职工号为 ${res.userCode}。流程已进入「待督导初审」，请保持手机畅通。`);
        setForm({
          userName: '', phone: '', gender: '', idCard: '', birthday: '', education: '',
          emergencyContact: '', emergencyPhone: '', address: '', email: '', resumeText: '', materials: '', supervisorCode: '',
        });
        setMaterialImages([]);
      } else {
        setError(res.message || '提交失败');
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-md p-6 sm:p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-800">卡迪高 · 新员工入职登记</h1>
          <p className="text-sm text-gray-500 mt-2">请如实填写个人基础信息、入职资料与佐证材料，提交后将推送至负责督导初审（3-7 个自然日内完成）</p>
        </div>

        {success && (
          <div className="mb-4 p-4 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">{success}</div>
        )}
        {error && (
          <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">{error}</div>
        )}

        {/* 基础信息 */}
        <h2 className="text-base font-semibold text-gray-800 mb-3 border-b pb-2">一、个人基础信息</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm text-gray-600 mb-1">姓名 <span className="text-red-500">*</span></label>
            <input className={inputCls} value={form.userName} onChange={(e) => set('userName', e.target.value)} placeholder="与身份证一致" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">手机号 <span className="text-red-500">*</span></label>
            <input className={inputCls} value={form.phone} onChange={(e) => set('phone', e.target.value)} maxLength={11} placeholder="11 位大陆手机号" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">性别</label>
            <select className={inputCls} value={form.gender} onChange={(e) => set('gender', e.target.value)}>
              <option value="">请选择</option>
              <option value="男">男</option>
              <option value="女">女</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">身份证号</label>
            <input className={inputCls} value={form.idCard} onChange={(e) => set('idCard', e.target.value)} placeholder="选填" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">出生日期</label>
            <input type="date" className={inputCls} value={form.birthday} onChange={(e) => set('birthday', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">学历</label>
            <select className={inputCls} value={form.education} onChange={(e) => set('education', e.target.value)}>
              <option value="">请选择</option>
              {['初中及以下', '高中/中专', '大专', '本科', '硕士及以上'].map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">紧急联系人</label>
            <input className={inputCls} value={form.emergencyContact} onChange={(e) => set('emergencyContact', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">紧急联系电话</label>
            <input className={inputCls} value={form.emergencyPhone} onChange={(e) => set('emergencyPhone', e.target.value)} maxLength={11} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm text-gray-600 mb-1">常住地址</label>
            <input className={inputCls} value={form.address} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm text-gray-600 mb-1">电子邮箱</label>
            <input className={inputCls} value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
        </div>

        {/* 入职资料 */}
        <h2 className="text-base font-semibold text-gray-800 mb-3 border-b pb-2">二、入职资料</h2>
        <div className="mb-6 grid gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">自我评价 / 工作经历简述</label>
            <AutoTextarea className={`${inputCls}`} minRows={3} value={form.resumeText} onChange={(v) => set('resumeText', v)} placeholder="可简述工作经历、技能特长等" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">佐证材料（文字说明）</label>
            <AutoTextarea className={`${inputCls}`} minRows={2} value={form.materials} onChange={(v) => set('materials', v)} placeholder="每行填写一个材料名称，如：身份证复印件&#10;毕业证照片&#10;离职证明（如适用）" />
            <p className="text-xs text-gray-400 mt-1">支持每行一条，或用逗号分隔（身份证、学历证书、体检报告等）</p>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">佐证材料（图片上传）</label>
            <div className="flex flex-wrap gap-3 items-start">
              {materialImages.map((url, i) => (
                <div key={url} className="relative w-24 h-24 rounded-lg overflow-hidden border border-gray-200 group">
                  <img src={url} alt={`佐证材料${i + 1}`} className="w-full h-full object-cover" />
                  <button type="button" onClick={() => setMaterialImages((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs leading-none hover:bg-red-600">×</button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImg}
                className="w-24 h-24 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 flex flex-col items-center justify-center gap-1 text-xs disabled:opacity-50"
              >
                {uploadingImg ? (
                  <><span className="animate-spin inline-block">◌</span>上传中</>
                ) : (
                  <><span className="text-xl leading-none">＋</span>上传图片</>
                )}
              </button>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple className="hidden"
                onChange={(e) => handleSelectImages(e.target.files)} />
            </div>
            <p className="text-xs text-gray-400 mt-1">支持 jpg/png/gif/webp，单张不超过 5MB，可多选（身份证、毕业证、体检报告等照片）</p>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">负责督导 <span className="text-red-500">*</span></label>
            <select className={inputCls} value={form.supervisorCode} onChange={(e) => set('supervisorCode', e.target.value)} disabled={loadingOpt}>
              <option value="">{loadingOpt ? '督导列表加载中...' : '请选择负责督导'}</option>
              {supervisors.map((s) => (
                <option key={s.userCode} value={s.userCode}>{s.userName}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={() => navigate('/login')}
            className="px-6 py-2.5 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50"
          >
            返回登录
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-8 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
          >
            {submitting ? '提交中...' : '提交入职申请'}
          </button>
        </div>
      </div>
    </div>
  );
}