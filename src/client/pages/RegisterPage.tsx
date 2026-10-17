import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, Building2, CheckCircle2, ChevronLeft, KeyRound, Loader2, MapPin, Package, Phone, Search, ShieldCheck, Store, User, UserPlus, Users, X } from 'lucide-react';
import { getGuideCandidates, getRegisterOptions, submitRegisterApply, checkPhoneStatus, type GuideCandidate } from '../../api/register';

// ============================================================
// 注册引导定位流程（方案 v4 · 统一兜底话术）
// 前置字段 → 职能范围三分支 → 分支链路提问 → 候选列表单选 → 提交
// 任一路径组织搜不到：先提示重新输入，再次无果一律弹出「联系刘邓新增组织」
// ============================================================

const FUNC_DIRS = ['运营', '财务', '人事', '会员', '商品', '采购', '稽查', '数据', '其他'] as const;

const LEVEL_LABEL: Record<number, string> = {
  1: '公司',
  2: '总监',
  3: '职能组',
  4: '区经/门店',
  5: '督导组',
  6: '门店/经销商',
  7: '门店',
};

const TYPE_LABEL: Record<string, string> = {
  company: '公司',
  director: '总监',
  group: '职能组',
  shop: '门店',
  supervisor_group: '督导组',
  dealer_group: '经销商组',
};

function RegisterPage() {
  const navigate = useNavigate();
  // —— 前置字段 ——
  const [userName, setUserName] = useState('');
  const [phone, setPhone] = useState('');
  const [warehouseType, setWarehouseType] = useState('');
  const [warehouseTypes, setWarehouseTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ message: string; userCode: string } | null>(null);
  const [phoneBlocked, setPhoneBlocked] = useState<{ message: string } | null>(null);

  // —— 引导步骤：0 前置字段 / 1 职能范围 / 2 分支提问+候选+提交 ——
  const [step, setStep] = useState(0);
  const [branch, setBranch] = useState<'shop' | 'dealer' | 'supervisor' | 'func' | null>(null);

  // 分支 A 店长/店员/经销商（经销商 = 门店老板，按「经销商_老板姓名」匹配经销商组节点）
  const [shopRole, setShopRole] = useState<'店长' | '店员' | '经销商' | null>(null);
  // 分支 A' 经销商
  const [dealerName, setDealerName] = useState('');
  // 分支 B 督导/区经
  const [superRole, setSuperRole] = useState<'督导' | '区经' | null>(null);
  // 分支 C 公司职能岗
  const [funcDir, setFuncDir] = useState<string>('');
  const [funcLevel, setFuncLevel] = useState<'总监' | '专员' | null>(null);
  // 门店/督导链路的区域输入共用
  const [regionInput, setRegionInput] = useState('');

  // —— 候选与提交 ——
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<GuideCandidate[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<GuideCandidate | null>(null);
  const [searchState, setSearchState] = useState<'idle' | 'empty' | 'found'>('idle');
  const [showFallback, setShowFallback] = useState(false);
  const noMatchRef = useRef(0);
  const searchTimer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    getRegisterOptions()
      .then(d => { if (alive) setWarehouseTypes(d.warehouseTypes || []); })
      .catch(() => { if (alive) setError('下拉数据加载失败，请刷新重试'); });
    return () => { alive = false; };
  }, []);

  // —— 候选查询（输入防抖 350ms；职能分支选项即触发） ——
  const doSearch = useCallback(async () => {
    if (!branch) return;
    let params: Parameters<typeof getGuideCandidates>[0];
    if (branch === 'shop') {
      if (!shopRole) return;
      // 经销商：按「经销商_老板姓名」匹配经销商组节点（不依赖区域/仓库类别）
      if (shopRole === '经销商') {
        if (!dealerName.trim()) return;
        params = { scope: 'dealer', dealerName: dealerName.trim() };
      } else {
        if (!regionInput.trim()) return;
        params = { scope: 'shop', warehouseType, region: regionInput.trim() };
      }
    } else if (branch === 'dealer') {
      if (!dealerName.trim()) return;
      params = { scope: 'dealer', dealerName: dealerName.trim() };
    } else if (branch === 'supervisor') {
      if (!superRole || !regionInput.trim()) return;
      params = { scope: 'supervisor', role: superRole, region: regionInput.trim() };
    } else {
      if (!funcDir || !funcLevel) return;
      params = { scope: 'func', funcDir, level: funcLevel, warehouseType };
    }
    setSearching(true);
    try {
      const d = await getGuideCandidates(params);
      const list = d.candidates || [];
      setCandidates(list);
      if (list.length > 0) {
        noMatchRef.current = 0;
        setSearchState('found');
        setSelectedOrg(null);
        setError('');
      } else {
        setSearchState('empty');
        setSelectedOrg(null);
        noMatchRef.current += 1;
        // 连续两次无匹配 → 统一兜底：联系管理员新增组织
        if (noMatchRef.current >= 2) setShowFallback(true);
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || '候选查询失败，请稍后重试');
      setSearchState('idle');
    } finally {
      setSearching(false);
    }
  }, [branch, warehouseType, regionInput, shopRole, dealerName, superRole, funcDir, funcLevel]);

  useEffect(() => {
    if (step !== 2 || !branch) return;
    const ready =
      (branch === 'shop' && !!shopRole && (shopRole === '经销商' ? dealerName.trim().length > 0 : regionInput.trim().length > 0)) ||
      (branch === 'dealer' && dealerName.trim().length > 0) ||
      (branch === 'supervisor' && !!superRole && regionInput.trim().length > 0) ||
      (branch === 'func' && !!funcDir && !!funcLevel);
    if (!ready) { setSearchState('idle'); return; }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(doSearch, branch === 'func' ? 0 : 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [step, branch, shopRole, regionInput, dealerName, superRole, funcDir, funcLevel, doSearch]);

  const resetAll = () => {
    setStep(0);
    setBranch(null);
    setShopRole(null);
    setDealerName('');
    setSuperRole(null);
    setFuncDir('');
    setFuncLevel(null);
    setRegionInput('');
    setCandidates([]);
    setSelectedOrg(null);
    setSearchState('idle');
    setShowFallback(false);
    noMatchRef.current = 0;
    setError('');
  };

  const tryBasic = async () => {
    setError('');
    if (!userName.trim()) return setError('请填写姓名');
    if (!/^1\d{10}$/.test(phone.trim())) return setError('请填写正确的 11 位手机号');
    if (!warehouseType) return setError('请选择仓库类别');
    // 手机号注册状态检查：pending/approved 拦截
    try {
      const chk = await checkPhoneStatus(phone.trim());
      if (chk.status === 'pending') {
        setPhoneBlocked({ message: '您的申请已提交，不能再次提交申请' });
        return;
      }
      if (chk.status === 'approved') {
        setPhoneBlocked({ message: '您的注册申请已审核通过，请直接登录' });
        return;
      }
      if (chk.status === 'exists') {
        setPhoneBlocked({ message: '该手机号已注册，请直接登录' });
        return;
      }
    } catch {
      // 检查失败不阻断流程，由提交时后端兜底
    }
    setStep(1);
  };

  const chooseBranch = (b: 'shop' | 'dealer' | 'supervisor' | 'func') => {
    setBranch(b);
    setStep(2);
    setCandidates([]);
    setSelectedOrg(null);
    setSearchState('idle');
    noMatchRef.current = 0;
    setError('');
    if (b !== 'shop') setShopRole(null);
    if (b !== 'dealer') setDealerName('');
    if (b !== 'supervisor') setSuperRole(null);
    if (b !== 'func') { setFuncDir(''); setFuncLevel(null); }
    if (b !== 'shop' && b !== 'supervisor') setRegionInput('');
  };

  /** 注册链路 → 职位（12 项中可唯一对应的自动填充；区经/会员/其他无对应项留空由审核人补充） */
  const calcPosition = (): string => {
    if (branch === 'shop') return shopRole || '';
    if (branch === 'dealer') return '经销商';
    if (branch === 'supervisor') return superRole === '督导' ? '督导' : '';
    if (branch === 'func') return (['运营', '财务', '人事', '商品', '采购', '稽查', '数据'] as const).includes(funcDir as any) ? funcDir : '';
    return '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!selectedOrg) return setError('请选择组织');
    setSubmitting(true);
    try {
      const res = await submitRegisterApply({ userName: userName.trim(), phone: phone.trim(), warehouseType, orgId: selectedOrg.orgId, position: calcPosition() });
      if (res.ok) {
        setSuccess({ message: res.message || '注册申请已提交，请等待管理员审核', userCode: res.userCode || '' });
      } else {
        setError(res.message || '提交失败');
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h1 className="text-xl font-bold text-gray-800">申请提交成功</h1>
              <p className="text-gray-500 mt-2">{success.message}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <KeyRound className="w-4 h-4 text-primary" />
                <span>系统为您生成的工号：</span>
              </div>
              <p className="text-2xl font-bold text-primary mt-1 text-center font-mono">{success.userCode}</p>
              <p className="text-xs text-gray-400 mt-2 text-center">审核通过后使用该工号（或手机号）登录，初始密码 8888</p>
            </div>
            <button
              onClick={() => navigate('/login')}
              className="w-full bg-primary hover:bg-primary-dark text-white font-medium py-3 px-4 rounded-lg transition-all"
            >
              返回登录
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phoneBlocked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <ShieldCheck className="w-8 h-8 text-amber-600" />
              </div>
              <h1 className="text-xl font-bold text-gray-800">无法提交申请</h1>
              <p className="text-gray-500 mt-2">{phoneBlocked.message}</p>
            </div>
            <button
              onClick={() => navigate('/login')}
              className="w-full bg-primary hover:bg-primary-dark text-white font-medium py-3 px-4 rounded-lg transition-all"
            >
              返回登录
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <button
          onClick={() => navigate('/login')}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/10 border border-white/30 text-white/95 hover:bg-white/20 hover:text-white backdrop-blur-sm mb-5 text-sm transition-all"
        >
          <ArrowLeft size={16} />
          返回登录
        </button>
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="text-center mb-5">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <UserPlus className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800">账号注册</h1>
            <p className="text-gray-500 mt-2">填写信息提交申请，由管理员审核开通</p>
          </div>

          {/* 步骤指示 */}
          <div className="mb-5 flex items-center justify-center gap-2">
            {[
              { no: 1, label: '基础信息' },
              { no: 2, label: '职能范围' },
              { no: 3, label: '组织确认' },
            ].map((s, i) => (
              <div key={s.no} className="flex items-center gap-2">
                {i > 0 && <div className={`w-6 h-px ${step >= i ? 'bg-primary' : 'bg-gray-200'}`} />}
                <div className="flex items-center gap-1.5">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${step >= i ? 'bg-primary text-white' : 'bg-gray-200 text-gray-500'}`}>
                    {s.no}
                  </div>
                  <span className={`text-xs ${step >= i ? 'text-primary font-medium' : 'text-gray-400'}`}>{s.label}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mb-5 flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
            <BadgeCheck className="w-5 h-5 text-blue-500 shrink-0" />
            <p className="text-sm text-blue-700">
              工号由系统自动生成（<span className="font-mono">RG</span> + 序号），审核通过后生效，无需填写。
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
          )}

          {/* 第 1 步：前置字段 */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">姓名</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="请输入真实姓名"
                    className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">手机号</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="请输入 11 位手机号"
                    maxLength={11}
                    className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">仓库类别</label>
                <div className="relative">
                  <Package className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <select
                    value={warehouseType}
                    onChange={(e) => setWarehouseType(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none bg-white"
                  >
                    <option value="">请选择仓库类别</option>
                    {warehouseTypes.map(w => <option key={w} value={w}>{w}</option>)}
                  </select>
                </div>
              </div>

              <button
                type="button"
                disabled={loading}
                onClick={tryBasic}
                className="w-full bg-primary hover:bg-primary-dark text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                下一步
              </button>
            </div>
          )}

          {/* 第 2 步：职能范围 */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700 mb-1">请问您的大致职能范围是？</p>
              {[
                { key: 'shop' as const, icon: <Store className="w-6 h-6 text-green-600" />, title: '店长 / 店员 / 经销商', desc: '门店一线岗位' },
                { key: 'supervisor' as const, icon: <ShieldCheck className="w-6 h-6 text-amber-600" />, title: '督导 / 区经', desc: '区域管理岗位' },
                { key: 'func' as const, icon: <Building2 className="w-6 h-6 text-violet-600" />, title: '公司职能岗', desc: '总部职能部门' },
              ].map(b => (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => chooseBranch(b.key)}
                  className="w-full flex items-center gap-4 p-4 border border-gray-200 rounded-xl hover:border-primary hover:bg-primary/5 transition-all text-left"
                >
                  <div className="w-11 h-11 bg-gray-50 rounded-lg flex items-center justify-center shrink-0">{b.icon}</div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-800">{b.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{b.desc}</p>
                  </div>
                  <ChevronLeft className="w-5 h-5 text-gray-300 rotate-180" />
                </button>
              ))}
              <button
                type="button"
                onClick={() => setStep(0)}
                className="w-full flex items-center justify-center gap-1 text-sm text-gray-400 hover:text-gray-600 py-2 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                上一步
              </button>
            </div>
          )}

          {/* 第 3 步：分支提问 + 候选 + 提交 */}
          {step === 2 && branch && (
            <div className="space-y-4">
              {/* 分支 A：店长/店员/经销商 */}
              {branch === 'shop' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">请问您的身份是？</label>
                    <div className="grid grid-cols-3 gap-3">
                      {(['店长', '店员', '经销商'] as const).map(r => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setShopRole(r)}
                          className={`py-2.5 rounded-lg border text-sm font-medium transition-all ${shopRole === r ? 'bg-primary text-white border-primary' : 'border-gray-200 text-gray-600 hover:border-primary/50'}`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                  {shopRole === '经销商' ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">请问老板的姓名是？</label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                          type="text"
                          value={dealerName}
                          onChange={(e) => setDealerName(e.target.value)}
                          placeholder="请输入老板姓名，如：杜艳磊"
                          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
                        />
                      </div>
                      <p className="mt-1 text-xs text-gray-400">按「经销商_老板姓名」匹配经销商节点</p>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">请问您所在的区域是？</label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                          type="text"
                          value={regionInput}
                          onChange={(e) => setRegionInput(e.target.value)}
                          placeholder="如：洛阳、郑州、平舆、山东泰安"
                          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
                        />
                      </div>
                      <p className="mt-1 text-xs text-gray-400">输入区域后自动匹配候选门店</p>
                    </div>
                  )}
                </>
              )}

              {/* 分支 A'：经销商 */}
              {branch === 'dealer' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">请问老板的姓名是？</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      value={dealerName}
                      onChange={(e) => setDealerName(e.target.value)}
                      placeholder="请输入老板姓名，如：杜艳磊"
                      className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-400">按「经销商_老板姓名」匹配经销商组节点</p>
                </div>
              )}

              {/* 分支 B：督导/区经 */}
              {branch === 'supervisor' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">请问您是督导还是区经？</label>
                    <div className="grid grid-cols-2 gap-3">
                      {(['督导', '区经'] as const).map(r => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setSuperRole(r)}
                          className={`py-2.5 rounded-lg border text-sm font-medium transition-all ${superRole === r ? 'bg-primary text-white border-primary' : 'border-gray-200 text-gray-600 hover:border-primary/50'}`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">请问您所管理的区域是？</label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="text"
                        value={regionInput}
                        onChange={(e) => setRegionInput(e.target.value)}
                        placeholder="如：洛阳、郑州、平舆"
                        className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
                      />
                    </div>
                    <p className="mt-1 text-xs text-gray-400">系统按区域下辖门店反查对应{superRole || '区经/督导'}节点</p>
                  </div>
                </>
              )}

              {/* 分支 C：公司职能岗 */}
              {branch === 'func' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">请选择您的职能方向</label>
                    <div className="grid grid-cols-4 gap-2">
                      {FUNC_DIRS.map(d => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setFuncDir(d)}
                          className={`py-2 rounded-lg border text-sm transition-all ${funcDir === d ? 'bg-primary text-white border-primary' : 'border-gray-200 text-gray-600 hover:border-primary/50'}`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">请问您是？</label>
                    <div className="grid grid-cols-2 gap-3">
                      {(['总监', '专员'] as const).map(r => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setFuncLevel(r)}
                          className={`py-2.5 rounded-lg border text-sm font-medium transition-all ${funcLevel === r ? 'bg-primary text-white border-primary' : 'border-gray-200 text-gray-600 hover:border-primary/50'}`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* 上一步（回职能范围） */}
              <button
                type="button"
                onClick={() => { setStep(1); setBranch(null); setCandidates([]); setSelectedOrg(null); setSearchState('idle'); noMatchRef.current = 0; }}
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                上一步
              </button>

              {/* 候选结果区 */}
              {searchState === 'found' && (
                <div className="border border-gray-200 rounded-xl p-4">
                  <p className="text-sm font-medium text-gray-800 mb-3 flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-primary" />
                    请您选择您的组织层级（{candidates.length} 个匹配）
                  </p>
                  <div className="max-h-64 overflow-y-auto space-y-2">
                    {candidates.map(c => (
                      <button
                        key={c.orgId}
                        type="button"
                        onClick={() => setSelectedOrg(c)}
                        className={`w-full flex items-center gap-2.5 p-3 rounded-lg border text-left transition-all ${selectedOrg?.orgId === c.orgId ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-gray-200 hover:border-primary/40'}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{c.orgName}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            L{c.orgLevel} · {TYPE_LABEL[c.orgType] || c.orgType}
                            {c.warehouseType ? ` · ${c.warehouseType}` : ''}
                          </p>
                        </div>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${selectedOrg?.orgId === c.orgId ? 'border-primary' : 'border-gray-300'}`}>
                          {selectedOrg?.orgId === c.orgId && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {searchState === 'empty' && !showFallback && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  <Search className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-amber-700">
                    {branch === 'func'
                      ? <>该职能方向暂无对应{funcLevel || ''}节点，请<button type="button" className="underline font-medium" onClick={() => { setFuncDir(''); setFuncLevel(null); setCandidates([]); setSelectedOrg(null); setSearchState('idle'); }}>重新选择职能方向</button></>
                      : '未找到匹配的组织，请核对区域/姓名后重新输入'}
                    {branch !== 'func' && <span className="text-amber-500/80 block mt-0.5 text-xs">再次无匹配时将引导您联系管理员新增组织</span>}
                  </p>
                </div>
              )}

              {/* 提交 */}
              {selectedOrg && (
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                    <p className="text-xs text-green-600 mb-1">已选择组织</p>
                    <p className="text-sm font-semibold text-gray-800">
                      {selectedOrg.orgName}
                      <span className="text-xs font-normal text-gray-400 ml-1.5">
                        L{selectedOrg.orgLevel} · {TYPE_LABEL[selectedOrg.orgType] || selectedOrg.orgType}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedOrg(null)}
                    className="w-full text-sm text-gray-400 hover:text-gray-600 py-1 transition-colors"
                  >
                    重新选择
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-primary hover:bg-primary-dark text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>提交中...</span>
                      </>
                    ) : (<span>提交申请</span>)}
                  </button>
                </form>
              )}

              {searching && (
                <div className="flex items-center justify-center gap-2 text-sm text-gray-400 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  正在匹配组织...
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex items-center justify-center gap-1 text-sm text-gray-400">
            <Users size={14} />
            提交后将由管理员审核，审核结果请联系管理员
          </div>
        </div>
      </div>

      {/* 统一兜底弹窗：请联系管理员新增组织 */}
      {showFallback && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <div className="text-center mb-4">
              <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Building2 className="w-7 h-7 text-amber-500" />
              </div>
              <h3 className="text-lg font-bold text-gray-800">未找到匹配的组织</h3>
              <p className="text-sm text-gray-500 mt-2 leading-relaxed">
                请联系后台管理员 <span className="font-semibold text-gray-800">刘邓</span> 反馈新增组织，
                待组织创建完成后再进行注册。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => { setShowFallback(false); setSearchState('empty'); }}
                className="py-2.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                返回重试
              </button>
              <button
                type="button"
                onClick={() => { setShowFallback(false); resetAll(); }}
                className="py-2.5 rounded-lg bg-primary hover:bg-primary-dark text-white text-sm font-medium transition-colors"
              >
                重新填写
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RegisterPage;