import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ClipboardEdit, Loader2, RefreshCw, Save, ShieldCheck, UserCheck, UserX } from 'lucide-react';
import Layout from '../components/Layout';
import { getRegisterApplications, approveRegisterApply, rejectRegisterApply, supplementRegisterApply, getRegisterOptions, type RegisterApplication, type RegisterOption } from '../../api/register';
import { getRoles } from '../../api/adminPerm';
import { POSITION_OPTIONS, POSITION_DEFAULT_ORG_MAP, loadPositionItems, type PositionItem } from '../utils/userPositions';
import { toOrgLight, matchOrgsByPosition } from '../utils/positionOrgMatch';

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: '待审核', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: '已通过', cls: 'bg-green-100 text-green-700' },
  rejected: { label: '已拒绝', cls: 'bg-red-100 text-red-600' },
};

const PAGE_SIZE = 10;

// 注：职位 → 角色 仅认职位表 sys_position.role_id（表驱动），无任何兜底规则；
// 职位未配置关联角色时由 openApprove 直接报错拦截，不回退默认角色/名称包含规则
// （配置入口：人事绩效 → 基础资料 → 职位管理 → 编辑关联角色）

/** 按申请单职位取职位表维护的关联角色 id（表驱动，无兜底）；未配置/角色不存在返回 null，由调用方报错拦截 */
function findRoleIdByPosition(
  position: string | undefined,
  roles: { roleId: number; roleName: string }[],
  positionItems?: PositionItem[],
): number | null {
  if (!position) return null;
  const item = positionItems?.find(i => i.positionName === position);
  if (item?.roleId != null && roles.some(r => r.roleId === item.roleId)) return item.roleId;
  return null;
}

function RegisterAuditPage() {
  const [statusFilter, setStatusFilter] = useState<string>(''); // '' = 全部
  const [applications, setApplications] = useState<RegisterApplication[]>([]);
  const [roles, setRoles] = useState<{ roleId: number; roleName: string }[]>([]);
  // 职位下拉（职位表驱动；含关联角色 roleId，接口不可用回退内置 12 项）
  const [positionItems, setPositionItems] = useState<PositionItem[]>(
    POSITION_OPTIONS.map(p => ({
      positionName: p,
      roleId: null,
      orgType: POSITION_DEFAULT_ORG_MAP[p]?.orgType ?? null,
      orgNameKw: POSITION_DEFAULT_ORG_MAP[p]?.orgNameKw ?? null,
    })),
  );
  const [orgs, setOrgs] = useState<RegisterOption[]>([]);
  const [warehouseTypes, setWarehouseTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  // 通过弹窗
  const [approving, setApproving] = useState<RegisterApplication | null>(null);
  const [approveRoleId, setApproveRoleId] = useState<number>(10);
  const [approveOrgId, setApproveOrgId] = useState<number | null>(null);
  const [savingApprove, setSavingApprove] = useState(false);
  // 拒绝弹窗
  const [rejecting, setRejecting] = useState<RegisterApplication | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [savingReject, setSavingReject] = useState(false);
  // 补充资料弹窗（补齐「用户管理」中用户需要填写的字段，由审核人代为录入；店铺字段已移除）
  const [supplementing, setSupplementing] = useState<RegisterApplication | null>(null);
  const [savingSupplement, setSavingSupplement] = useState(false);
  const [supForm, setSupForm] = useState<{
    userName: string; phone: string; warehouseType: string; orgId: number | null;
    position: string; wechatAccount: string;
    password: string; isAdmin: boolean;
  }>({
    userName: '', phone: '', warehouseType: '', orgId: null,
    position: '', wechatAccount: '',
    password: '8888', isAdmin: false,
  });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [appRes, orgRes, roleRes] = await Promise.all([
        getRegisterApplications(statusFilter || undefined),
        getRegisterOptions(),
        getRoles(),
      ]);
      setApplications(appRes.applications || []);
      setOrgs(orgRes.orgs || []);
      setWarehouseTypes(orgRes.warehouseTypes || []);
      const rs = (roleRes.roles || []).map((r: any) => ({
        roleId: r.role_id ?? r.roleId,
        roleName: r.role_name ?? r.roleName,
      }));
      setRoles(rs);
      if (rs.length > 0 && !rs.some(r => r.roleId === approveRoleId)) {
        const staff = rs.find(r => r.roleName.includes('普通员工')) || rs[0];
        setApproveRoleId(staff.roleId);
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || '加载失败，请确认您拥有注册审核菜单权限');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter]);

  // 职位下拉数据（仅加载一次，与审核列表独立）
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const items = await loadPositionItems();
        if (alive && items.length > 0) setPositionItems(items);
      } catch (e) { /* 回退内置列表 */ }
    })();
    return () => { alive = false; };
  }, []);

  const openApprove = (app: RegisterApplication) => {
    // 职位 → 角色：仅认职位表 role_id，未配置直接报错拦截（不做任何兜底回退）
    const matched = findRoleIdByPosition(app.position, roles, positionItems);
    if (matched == null) {
      setError(`职位「${app.position || '未填写'}」未配置关联角色，无法确定审核角色。请先到「人事绩效 → 基础资料 → 职位管理」为该职位配置关联角色后再审核。`);
      return;
    }
    setApproving(app);
    setApproveRoleId(matched);
    // 审核通过时「归属组织」默认与「申请组织」保持一致（避免审批歧义）；审核人如需调整可手动修改
    setApproveOrgId(app.orgId);
  };

  const handleApprove = async () => {
    if (!approving) return;
    if (!approveOrgId) return setError('请选择组织');
    setSavingApprove(true);
    try {
      const res = await approveRegisterApply(approving.id, { roleId: approveRoleId, orgId: approveOrgId });
      alert(res.message || '审核通过');
      setApproving(null);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.message || '审核失败');
    } finally {
      setSavingApprove(false);
    }
  };

  const handleReject = async () => {
    if (!rejecting) return;
    if (!rejectReason.trim()) return setError('请填写拒绝原因');
    setSavingReject(true);
    try {
      const res = await rejectRegisterApply(rejecting.id, rejectReason.trim());
      alert(res.message || '已拒绝');
      setRejecting(null);
      setRejectReason('');
      load();
    } catch (e: any) {
      alert(e?.response?.data?.message || '拒绝失败');
    } finally {
      setSavingReject(false);
    }
  };

  const openSupplement = (app: RegisterApplication) => {
    setSupplementing(app);
    setSupForm({
      userName: app.userName || '',
      phone: app.phone || '',
      warehouseType: app.warehouseType || '',
      orgId: app.orgId ?? null,
      // 职位自动带出注册引导时确定的职能范围（register_apply.position），无对应项时留空由审核人补选
      position: app.position || '',
      wechatAccount: app.wechatAccount || '',
      password: app.password || '8888',
      isAdmin: app.isAdmin === '是',
    });
    setError('');
  };

  const handleSupplementSave = async () => {
    if (!supplementing) return;
    if (!supForm.userName.trim()) return setError('请填写姓名');
    if (!/^1\d{10}$/.test(supForm.phone.trim())) return setError('请填写正确的 11 位手机号');
    if (!supForm.warehouseType) return setError('请选择仓库类别');
    if (!supForm.orgId) return setError('请选择组织');
    setSavingSupplement(true);
    try {
      const res = await supplementRegisterApply(supplementing.id, {
        '用户名称': supForm.userName.trim(),
        '手机号': supForm.phone.trim(),
        '仓库类别': supForm.warehouseType,
        orgId: supForm.orgId,
        '职位': supForm.position.trim(),
        '企微账号': supForm.wechatAccount.trim(),
        '密码': supForm.password.trim(),
        '管理员': supForm.isAdmin ? '是' : '否',
      });
      alert(res.message || '补充资料已保存');
      setSupplementing(null);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.message || '保存失败');
    } finally {
      setSavingSupplement(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(applications.length / PAGE_SIZE));
  const pageRows = applications.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pendingCount = applications.filter(a => a.status === 'pending').length;

  const tabs = [
    { key: '', label: '全部' },
    { key: 'pending', label: `待审核${pendingCount > 0 ? ` (${pendingCount})` : ''}` },
    { key: 'approved', label: '已通过' },
    { key: 'rejected', label: '已拒绝' },
  ];

  return (
    <Layout title="注册审核" subtitle="审核前台/后台人员注册申请，通过后自动开通账号">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex gap-2 bg-white rounded-lg border border-gray-200 p-1">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => { setStatusFilter(t.key); setPage(1); }}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${statusFilter === t.key ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            <RefreshCw size={15} /> 刷新
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500">
                  <th className="px-4 py-3 text-left font-medium">申请编号</th>
                  <th className="px-4 py-3 text-left font-medium">姓名</th>
                  <th className="px-4 py-3 text-left font-medium">手机号</th>
                  <th className="px-4 py-3 text-left font-medium">仓库类别</th>
                  <th className="px-4 py-3 text-left font-medium">组织</th>
                  <th className="px-4 py-3 text-left font-medium">职位</th>
                  <th className="px-4 py-3 text-left font-medium">工号</th>
                  <th className="px-4 py-3 text-left font-medium">提交时间</th>
                  <th className="px-4 py-3 text-left font-medium">状态</th>
                  <th className="px-4 py-3 text-left font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="px-4 py-10 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-primary inline" />
                    <span className="ml-2 text-gray-400">加载中...</span>
                  </td></tr>
                ) : pageRows.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">
                    {statusFilter ? `暂无${STATUS_META[statusFilter]?.label || ''}申请` : '暂无注册申请'}
                  </td></tr>
                ) : pageRows.map(app => (
                  <tr key={app.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{app.applyNo}</td>
                    <td className="px-4 py-3 font-medium">{app.userName}</td>
                    <td className="px-4 py-3">{app.phone}</td>
                    <td className="px-4 py-3">{app.warehouseType}</td>
                    <td className="px-4 py-3 max-w-[200px] truncate" title={app.orgName}>{app.orgName}</td>
                    <td className="px-4 py-3">{app.position || <span className="text-gray-300">-</span>}</td>
                    <td className="px-4 py-3 font-mono">{app.userCode}</td>
                    <td className="px-4 py-3 text-gray-500">{app.createTime}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_META[app.status]?.cls || 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_META[app.status]?.label || app.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {app.status === 'pending' ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => openSupplement(app)}
                            className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-blue-600 text-white text-xs hover:bg-blue-700"
                            title="补齐用户管理中用户需要填写的全部字段，保存后通过审核将按此创建用户"
                          >
                            <ClipboardEdit size={13} /> 补充资料
                          </button>
                          <button
                            onClick={() => openApprove(app)}
                            className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-green-600 text-white text-xs hover:bg-green-700"
                          >
                            <UserCheck size={13} /> 通过
                          </button>
                          <button
                            onClick={() => { setRejecting(app); setRejectReason(''); setError(''); }}
                            className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-red-500 text-white text-xs hover:bg-red-600"
                          >
                            <UserX size={13} /> 拒绝
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">
                          {app.status === 'approved'
                            ? <>已审核{app.approverName ? ` · ${app.approverName}` : ''}</>
                            : app.status === 'rejected'
                              ? (app.rejectReason || '已拒绝')
                              : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {applications.length > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <span className="text-xs text-gray-400">共 {applications.length} 条，第 {page}/{totalPages} 页</span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="p-1.5 border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50 disabled:opacity-40"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="p-1.5 border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50 disabled:opacity-40"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 通过弹窗 */}
        {approving && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-green-600" /> 审核通过
                </h3>
                <button onClick={() => setApproving(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 text-sm space-y-1.5">
                <p><span className="text-gray-500">姓名：</span><b>{approving.userName}</b></p>
                <p><span className="text-gray-500">手机号：</span>{approving.phone}</p>
                <p><span className="text-gray-500">仓库类别：</span>{approving.warehouseType}</p>
                <p><span className="text-gray-500">申请组织：</span>{approving.orgName}</p>
                <p><span className="text-gray-500">职位：</span>{approving.position || '未填'}</p>
                <p><span className="text-gray-500">系统工号：</span><span className="font-mono">{approving.userCode}</span></p>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">分配角色</label>
                  <select
                    value={approveRoleId}
                    onChange={(e) => setApproveRoleId(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/40 outline-none bg-white"
                  >
                    {roles.map(r => <option key={r.roleId} value={r.roleId}>{r.roleName}</option>)}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">已按申请职位{approving?.position ? `「${approving.position}」` : ''}自动带出对应角色，可手动修改</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">归属组织（可修改）</label>
                  <select
                    value={approveOrgId ?? ''}
                    onChange={(e) => setApproveOrgId(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/40 outline-none bg-white"
                  >
                    <option value="">请选择组织</option>
                    {orgs.map(o => (
                      <option key={o.orgId} value={o.orgId}>
                        {'　'.repeat(Math.max(0, o.orgLevel - 1))}{o.orgName}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">默认沿用申请时选择的组织；账号开通后将绑定该组织，数据可见范围由角色决定</p>
                </div>
              </div>
              <div className="flex gap-3 justify-end mt-6">
                <button onClick={() => setApproving(null)} className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm">取消</button>
                <button
                  onClick={handleApprove}
                  disabled={savingApprove}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
                >
                  {savingApprove ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                  确认通过并开通
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 补充资料弹窗：补齐「用户管理」中用户需填写的全部字段，由审核人代为录入 */}
        {supplementing && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <ClipboardEdit className="w-5 h-5 text-blue-600" /> 补充资料
                </h3>
                <button onClick={() => setSupplementing(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-700">
                补齐「用户管理」中用户需要填写的全部字段，由审核人代为录入；保存后点「通过」将按此创建用户。
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 text-sm space-y-1.5">
                <p><span className="text-gray-500">申请编号：</span><span className="font-mono text-xs">{supplementing.applyNo}</span></p>
                <p><span className="text-gray-500">系统工号：</span><span className="font-mono">{supplementing.userCode}</span></p>
                <p><span className="text-gray-500">提交时间：</span>{supplementing.createTime}</p>
              </div>
              <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">姓名 <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={supForm.userName}
                      onChange={(e) => setSupForm({ ...supForm, userName: e.target.value })}
                      placeholder="申请人姓名"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/40 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">手机号 <span className="text-red-500">*</span></label>
                    <input
                      type="tel"
                      maxLength={11}
                      value={supForm.phone}
                      onChange={(e) => setSupForm({ ...supForm, phone: e.target.value })}
                      placeholder="11 位手机号"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/40 outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">仓库类别 <span className="text-red-500">*</span></label>
                  <select
                    value={supForm.warehouseType}
                    onChange={(e) => setSupForm({ ...supForm, warehouseType: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/40 outline-none bg-white"
                  >
                    <option value="">请选择仓库类别</option>
                    {warehouseTypes.map(w => <option key={w} value={w}>{w}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">归属组织 <span className="text-red-500">*</span></label>
                  <select
                    value={supForm.orgId ?? ''}
                    onChange={(e) => setSupForm({ ...supForm, orgId: Number(e.target.value) || null })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/40 outline-none bg-white"
                  >
                    <option value="">请选择组织</option>
                    {orgs.map(o => (
                      <option key={o.orgId} value={o.orgId}>
                        {'　'.repeat(Math.max(0, o.orgLevel - 1))}{o.orgName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">职位</label>
                    <select
                      value={supForm.position}
                      onChange={(e) => {
                        const pos = e.target.value;
                        const next = { ...supForm, position: pos };
                        // 职位 → 组织自动带出（仅当尚未手动选择组织时）
                        if (!next.orgId && pos) {
                          const cands = matchOrgsByPosition(pos, orgs.map(toOrgLight), { userName: supplementing?.userName || '', warehouseType: next.warehouseType }, positionItems);
                          if (cands.length > 0) next.orgId = cands[0].orgId;
                        }
                        setSupForm(next);
                      }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/40 outline-none bg-white"
                    >
                      <option value="">请选择职位</option>
                      {positionItems.map(p => <option key={p.positionName} value={p.positionName}>{p.positionName}</option>)}
                    </select>
                  </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">企微账号</label>
                  <input
                    type="text"
                    value={supForm.wechatAccount}
                    onChange={(e) => setSupForm({ ...supForm, wechatAccount: e.target.value })}
                    placeholder="企业微信账号"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/40 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">密码（初始登录密码）</label>
                  <input
                    type="text"
                    value={supForm.password}
                    onChange={(e) => setSupForm({ ...supForm, password: e.target.value })}
                    placeholder="默认 8888"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/40 outline-none"
                  />
                  <p className="text-xs text-gray-400 mt-1">留空表示使用默认密码 8888（不覆盖已设置的值）</p>
                </div>
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={supForm.isAdmin}
                      onChange={(e) => setSupForm({ ...supForm, isAdmin: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm font-medium text-gray-700">管理员</span>
                  </label>
                </div>
              </div>
              <div className="flex gap-3 justify-end mt-6">
                <button onClick={() => setSupplementing(null)} className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm">取消</button>
                <button
                  onClick={handleSupplementSave}
                  disabled={savingSupplement}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingSupplement ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  保存补充资料
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 拒绝弹窗 */}
        {rejecting && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-500" /> 拒绝申请
                </h3>
                <button onClick={() => setRejecting(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
              </div>
              <p className="text-sm text-gray-600 mb-3">
                拒绝 <b>{rejecting.userName}</b>（{rejecting.phone}）的注册申请，请填写原因：
              </p>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="例如：信息有误，请核对后重新提交"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-400/40 outline-none resize-none"
              />
              <div className="flex gap-3 justify-end mt-4">
                <button onClick={() => setRejecting(null)} className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm">取消</button>
                <button
                  onClick={handleReject}
                  disabled={savingReject}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 disabled:opacity-50"
                >
                  {savingReject ? <Loader2 size={15} className="animate-spin" /> : <UserX size={15} />}
                  确认拒绝
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default RegisterAuditPage;