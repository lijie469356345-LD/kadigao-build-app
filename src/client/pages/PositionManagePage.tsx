import { useEffect, useState } from 'react';
import { Plus, Trash2, X, RefreshCw, Link2, ShieldCheck, Loader2, Pencil, Briefcase } from 'lucide-react';
import Layout from '../components/Layout';
import { getPositionList, createPosition, updatePosition, deletePosition, type PositionRow } from '../../api/positions';
import { getRoles, createRole } from '../../api/adminPerm';

// 数据范围档位（与 permissionService 一致：1本人/2本组织/3本组织及下级/4指定组织/5全局）
const DATA_SCOPE_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '1 - 本人数据' },
  { value: 2, label: '2 - 本组织' },
  { value: 3, label: '3 - 本组织及下级' },
  { value: 4, label: '4 - 指定组织' },
  { value: 5, label: '5 - 全局数据' },
];

interface RoleOption { roleId: number; roleName: string; roleCode: string }

// 职位→组织类型选项（值 = sys_position.org_type 存储值；与 positionOrgMatch 匹配器约定一致）
const ORG_TYPE_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'company', label: '公司（总公司）', hint: '自动带出总公司' },
  { value: 'supervisor_group', label: '督导组（督导_姓名）', hint: '按申请人姓名优先匹配督导组' },
  { value: 'dealer_group', label: '经销商组（经销商_姓名）', hint: '按申请人姓名优先匹配经销商组' },
  { value: 'shop', label: '门店', hint: '按申请人店铺名/仓库类别收窄门店' },
  { value: 'director|group', label: '职能总监 + 职能专员组', hint: '按下方关键词匹配总监与专员组组织名称' },
];

const ORG_TYPE_LABELS: Record<string, string> = Object.fromEntries(ORG_TYPE_OPTIONS.map(o => [o.value, o.label]));

function PositionManagePage() {
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 新增/编辑弹窗
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<PositionRow | null>(null);
  const [positionName, setPositionName] = useState('');
  const [roleId, setRoleId] = useState<string>('');
  // 职位→组织映射（表驱动「自动带出归属组织」）
  const [orgType, setOrgType] = useState<string>('');
  const [orgNameKw, setOrgNameKw] = useState('');
  const [saving, setSaving] = useState(false);
  // 新建角色模式
  const [newRoleMode, setNewRoleMode] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleCode, setNewRoleCode] = useState('');
  const [newRoleScope, setNewRoleScope] = useState(3);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [posRes, roleRes] = await Promise.all([getPositionList(), getRoles()]);
      setPositions(posRes.positions || []);
      setRoles((roleRes.roles || []).map((r: any) => ({
        roleId: r.role_id ?? r.roleId,
        roleName: r.role_name ?? r.roleName,
        roleCode: r.role_code ?? r.roleCode ?? '',
      })));
    } catch (e: any) {
      setError(e?.response?.data?.message || '加载失败，请确认您拥有职位管理菜单权限');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const openAdd = () => {
    setEditing(null);
    setPositionName('');
    setRoleId('');
    setOrgType('');
    setOrgNameKw('');
    setNewRoleMode(false);
    setNewRoleName('');
    setNewRoleCode('');
    setNewRoleScope(3);
    setShowModal(true);
  };

  const openEdit = (p: PositionRow) => {
    setEditing(p);
    setPositionName(p.position_name);
    setRoleId(p.role_id != null ? String(p.role_id) : '');
    setOrgType(p.org_type ?? '');
    setOrgNameKw(p.org_name_kw ?? '');
    setNewRoleMode(false);
    setNewRoleName('');
    setNewRoleCode('');
    setNewRoleScope(3);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (newRoleMode) {
      if (!newRoleName.trim()) { alert('请填写新角色名称'); return; }
      if (!newRoleCode.trim()) { alert('请填写新角色编码'); return; }
    }
    if (!editing && !positionName.trim()) { alert('请填写职位名称'); return; }
    setSaving(true);
    try {
      let targetRoleId: number | null = roleId ? Number(roleId) : null;
      if (newRoleMode) {
        const roleRes = await createRole({
          roleName: newRoleName.trim(),
          roleCode: newRoleCode.trim(),
          dataScope: newRoleScope,
        } as any);
        targetRoleId = roleRes.roleId;
      }
      if (editing) {
        await updatePosition(editing.position_id, {
          roleId: targetRoleId,
          orgType: orgType || null,
          orgNameKw: orgNameKw.trim() || null,
        });
        alert('已更新关联角色与组织映射');
      } else {
        await createPosition({
          positionName: positionName.trim(),
          roleId: targetRoleId,
          orgType: orgType || null,
          orgNameKw: orgNameKw.trim() || null,
        });
        alert(newRoleMode ? '职位创建成功，已关联新建角色' : '职位创建成功');
      }
      setShowModal(false);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: PositionRow) => {
    if (!window.confirm(`确定删除职位「${p.position_name}」吗？`)) return;
    try {
      await deletePosition(p.position_id);
      alert('删除成功');
      load();
    } catch (e: any) {
      // 后端 409：职位仍有用户使用，提示具体用户
      alert(e?.response?.data?.message || '删除失败');
    }
  };

  return (
    <Layout title="职位管理" subtitle="维护用户职位字典，删除前将校验在册用户引用">
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="text-sm text-gray-500">
            共 <span className="font-semibold text-gray-800">{positions.length}</span> 个职位
            {roles.length > 0 && <span className="ml-2">· 已关联组织角色 {roles.length} 个</span>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={load}
              className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-2"
            >
              <RefreshCw size={16} /> 刷新
            </button>
            <button
              onClick={openAdd}
              className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 flex items-center gap-2"
            >
              <Plus size={16} /> 新增职位
            </button>
          </div>
        </div>

        {error && <div className="mb-4 px-4 py-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> 加载中...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-3 pr-4 font-medium">职位名称</th>
                  <th className="py-3 pr-4 font-medium">关联角色</th>
                  <th className="py-3 pr-4 font-medium">自动带出组织</th>
                  <th className="py-3 pr-4 font-medium">使用人数</th>
                  <th className="py-3 pr-4 font-medium">创建时间</th>
                  <th className="py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(p => (
                  <tr key={p.position_id} className="border-b border-gray-100 hover:bg-gray-50/60">
                    <td className="py-3 pr-4 font-medium text-gray-800 flex items-center gap-2">
                      <Briefcase size={15} className="text-gray-400" />
                      {p.position_name}
                    </td>
                    <td className="py-3 pr-4">
                      {p.role_name ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-600 rounded-full text-xs">
                          <ShieldCheck size={13} /> {p.role_name}
                        </span>
                      ) : (
                        <span className="text-gray-400">未关联</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {p.org_type ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-xs">
                          {ORG_TYPE_LABELS[p.org_type] ?? p.org_type}
                          {p.org_name_kw && <span className="ml-1 text-emerald-500 font-mono">{p.org_name_kw}</span>}
                        </span>
                      ) : (
                        <span className="text-gray-400">未配置</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {p.user_count > 0 ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs bg-amber-100 text-amber-700">
                          {p.user_count} 人
                        </span>
                      ) : (
                        <span className="text-gray-400">0 人</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-gray-500">
                      {p.create_time ? String(p.create_time).slice(0, 10) : '-'}
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => openEdit(p)}
                        className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg mr-1"
                        title="编辑关联角色与组织映射"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(p)}
                        className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title={p.user_count > 0 ? '该职位有用户使用，无法删除' : '删除职位'}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
                {positions.length === 0 && (
                  <tr><td colSpan={6} className="py-10 text-center text-gray-400">暂无职位，点击右上角「新增职位」创建</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">{editing ? '编辑职位' : '新增职位'}</h3>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">职位名称</label>
                <input
                  type="text"
                  value={positionName}
                  disabled={!!editing}
                  onChange={(e) => setPositionName(e.target.value)}
                  placeholder="如：仓管、陈列师"
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none disabled:bg-gray-50 disabled:text-gray-400"
                />
                {editing && <p className="text-xs text-gray-400 mt-1">职位名称创建后不可修改，只能调整关联角色</p>}
              </div>

              {!newRoleMode ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    关联组织角色 <span className="text-xs text-gray-400 font-normal">（用于注册审核/用户管理按职位自动带出角色）</span>
                  </label>
                  <select
                    value={roleId}
                    onChange={(e) => setRoleId(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-white"
                  >
                    <option value="">暂不关联角色</option>
                    {roles.map(r => (
                      <option key={r.roleId} value={r.roleId}>{r.roleName}（{r.roleCode}）</option>
                    ))}
                  </select>
                  <button
                    onClick={() => setNewRoleMode(true)}
                    className="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                  >
                    <Plus size={14} /> 没有合适的角色？直接新建角色
                  </button>
                </div>
              ) : (
                <div className="border border-blue-100 bg-blue-50/50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-blue-700 flex items-center gap-1">
                      <ShieldCheck size={15} /> 新建角色
                    </span>
                    <button onClick={() => setNewRoleMode(false)} className="text-sm text-gray-400 hover:text-gray-600">返回选择已有角色</button>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">角色名称</label>
                    <input
                      type="text"
                      value={newRoleName}
                      onChange={(e) => setNewRoleName(e.target.value)}
                      placeholder="如：仓管员"
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">角色编码</label>
                    <input
                      type="text"
                      value={newRoleCode}
                      onChange={(e) => setNewRoleCode(e.target.value)}
                      placeholder="如：warehouse_guard（英文小写，全局唯一）"
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">默认数据范围</label>
                    <select
                      value={newRoleScope}
                      onChange={(e) => setNewRoleScope(Number(e.target.value))}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-white"
                    >
                      {DATA_SCOPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <div className="border border-gray-100 rounded-lg p-4 space-y-3 bg-gray-50/50">
                <label className="block text-sm font-medium text-gray-700">
                  自动带出组织{' '}
                  <span className="text-xs text-gray-400 font-normal">
                    （注册审核/用户管理中选该职位时，自动带出归属组织候选；表驱动，可随时调整）
                  </span>
                </label>
                <select
                  value={orgType}
                  onChange={(e) => { setOrgType(e.target.value); if (!e.target.value) setOrgNameKw(''); }}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-white"
                >
                  <option value="">不自动带出（手动选择组织）</option>
                  {ORG_TYPE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                {orgType && (
                  <>
                    <p className="text-xs text-gray-400">{ORG_TYPE_OPTIONS.find(o => o.value === orgType)?.hint}</p>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        组织名称关键词 <span className="text-xs text-gray-400 font-normal">（可选，多个用 | 分隔）</span>
                      </label>
                      <input
                        type="text"
                        value={orgNameKw}
                        onChange={(e) => setOrgNameKw(e.target.value)}
                        placeholder="如：运营|会员|区经（留空表示不按名称过滤）"
                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">取消</button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 size={16} />}
                {saving ? '保存中...' : (editing ? '保存' : '创建职位')}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

export default PositionManagePage;