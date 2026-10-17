import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Shield, Plus, Trash2, Edit2, Loader2, Save, X, Search, Users, KeyRound,
  ChevronDown, CheckCircle2, Link2, Download,
} from 'lucide-react';
import Layout from '../components/Layout';
import {
  getRoles, createRole, updateRole, deleteRole,
  getMenuCatalog, getRoleMenus, saveRoleMenus,
  getPermUsers, saveUserRoles, getOrgTree, exportPermData,
} from '../../api/adminPerm';

const DATA_SCOPE_LABELS: Record<number, string> = {
  1: '本人数据',
  2: '本组织',
  3: '本组织及下级',
  4: '指定组织',
  5: '全局数据',
};

interface RoleItem {
  role_id: number;
  role_name: string;
  role_code: string;
  default_data_scope: number;
  status: number;
  userCount: number;
  menuCount: number;
}

interface CatalogPortal { portalEn: string; portalCn: string; masterPortalEn?: string; masterPortalCn?: string; defaultRoute: string; menus: { menuEn: string; menuCn: string; routePath: string }[] }
interface MasterCatalog { masterPortalEn: string; masterPortalCn: string; portals: CatalogPortal[] }

function PermissionPage() {
  const [tab, setTab] = useState<'roles' | 'users'>('roles');

  // ---- 角色 ----
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);

  // 角色表单
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleItem | null>(null);
  const [roleName, setRoleName] = useState('');
  const [roleCode, setRoleCode] = useState('');
  const [roleScope, setRoleScope] = useState(3);
  const [savingRole, setSavingRole] = useState(false);

  // 菜单授权（三层：主门户 → 门户 → 菜单）
  const [catalogMasters, setCatalogMasters] = useState<MasterCatalog[]>([]);
  const [roleGrants, setRoleGrants] = useState<Set<string>>(new Set());
  const [menuLoading, setMenuLoading] = useState(false);
  const [savingMenus, setSavingMenus] = useState(false);
  const [expandedMasters, setExpandedMasters] = useState<Set<string>>(new Set());
  const [expandedPortals, setExpandedPortals] = useState<Set<string>>(new Set());

  // ---- 用户 ----
  const [users, setUsers] = useState<any[]>([]);
  const [userKw, setUserKw] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [allRoles, setAllRoles] = useState<RoleItem[]>([]);
  const [orgNodes, setOrgNodes] = useState<any[]>([]);
  const [assignUser, setAssignUser] = useState<any>(null);
  const [assignRoles, setAssignRoles] = useState<Map<number, { roleId: number; orgId: number | null; dataScope: number | null }>>(new Map());
  const [savingAssign, setSavingAssign] = useState(false);

  // ---- 导出 ----
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { blob, filename } = await exportPermData(tab, tab === 'users' ? userKw : '');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert('导出失败：' + (e?.response?.data?.error || e?.response?.data?.message || e.message));
    } finally {
      setExporting(false);
    }
  };

  const loadRoles = useCallback(async () => {
    setRolesLoading(true);
    try {
      const res = await getRoles();
      setRoles(res.roles);
      setAllRoles(res.roles);
      setSelectedRoleId(prev => {
        if (prev && res.roles.some((r: RoleItem) => r.role_id === prev)) return prev;
        return res.roles.length > 0 ? res.roles[0].role_id : null;
      });
    } catch (e: any) {
      alert('加载角色失败: ' + (e?.response?.data?.message || e.message));
    } finally {
      setRolesLoading(false);
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      const res = await getMenuCatalog();
      if (Array.isArray(res.masters)) {
        setCatalogMasters(res.masters.map(m => ({
          masterPortalEn: m.masterPortalEn,
          masterPortalCn: m.masterPortalCn,
          portals: m.portals.map(p => ({ ...p, masterPortalEn: m.masterPortalEn, masterPortalCn: m.masterPortalCn })),
        })));
        setExpandedMasters(new Set(res.masters.map(m => m.masterPortalEn)));
        setExpandedPortals(new Set(res.masters.flatMap(m => m.portals.map(p => p.portalEn))));
      } else if (Array.isArray(res.portals)) {
        // 兼容旧版接口：无 masters 时合并为单层
        setCatalogMasters([{ masterPortalEn: 'all', masterPortalCn: '全部门户', portals: res.portals }]);
        setExpandedMasters(new Set(['all']));
        setExpandedPortals(new Set(res.portals.map(p => p.portalEn)));
      }
    } catch (e: any) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadRoles();
    loadCatalog();
  }, []);

  const loadRoleMenus = useCallback(async (roleId: number) => {
    setMenuLoading(true);
    try {
      const res = await getRoleMenus(roleId);
      setRoleGrants(new Set(res.grants.map(g => `${g.portal_en}::${g.menu_en}`)));
    } catch (e: any) {
      console.error(e);
    } finally {
      setMenuLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedRoleId) loadRoleMenus(selectedRoleId);
  }, [selectedRoleId]);

  // ---- 角色表单 ----
  const openRoleForm = (role?: RoleItem) => {
    setEditingRole(role || null);
    setRoleName(role?.role_name || '');
    setRoleCode(role?.role_code || '');
    setRoleScope(role?.default_data_scope ?? 3);
    setShowRoleForm(true);
  };

  const handleSaveRole = async () => {
    if (!roleName.trim() || !roleCode.trim()) { alert('角色名称与编码必填'); return; }
    setSavingRole(true);
    try {
      if (editingRole) {
        await updateRole(editingRole.role_id, { roleName: roleName.trim(), roleCode: roleCode.trim(), dataScope: roleScope });
      } else {
        const res = await createRole({ roleName: roleName.trim(), roleCode: roleCode.trim(), dataScope: roleScope });
        setSelectedRoleId(res.roleId);
      }
      setShowRoleForm(false);
      await loadRoles();
    } catch (e: any) {
      alert((e?.response?.data?.message || e?.message || '保存失败'));
    } finally {
      setSavingRole(false);
    }
  };

  const handleDeleteRole = async (role: RoleItem) => {
    if (!window.confirm(`确定删除角色「${role.role_name}」吗？\n存在用户绑定或为内置角色时会被拒绝。`)) return;
    try {
      await deleteRole(role.role_id);
      await loadRoles();
    } catch (e: any) {
      alert((e?.response?.data?.message || e?.message || '删除失败'));
    }
  };

  // ---- 菜单授权 ----
  const toggleGrant = (portalEn: string, menuEn: string) => {
    const key = `${portalEn}::${menuEn}`;
    setRoleGrants(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const togglePortalAll = (portal: CatalogPortal) => {
    setRoleGrants(prev => {
      const next = new Set(prev);
      const allOn = portal.menus.every(m => next.has(`${portal.portalEn}::${m.menuEn}`));
      portal.menus.forEach(m => {
        const k = `${portal.portalEn}::${m.menuEn}`;
        if (allOn) next.delete(k); else next.add(k);
      });
      return next;
    });
  };

  // 主门户全选：组内所有门户的全部菜单
  const toggleMasterAll = (master: MasterCatalog) => {
    setRoleGrants(prev => {
      const next = new Set(prev);
      const keys = master.portals.flatMap(p => p.menus.map(m => `${p.portalEn}::${m.menuEn}`));
      if (keys.length === 0) return next;
      const allOn = keys.every(k => next.has(k));
      keys.forEach(k => { if (allOn) next.delete(k); else next.add(k); });
      return next;
    });
  };

  const handleSaveMenus = async () => {
    if (!selectedRoleId) return;
    setSavingMenus(true);
    try {
      const grants = Array.from(roleGrants).map(k => {
        const [portalEn, menuEn] = k.split('::');
        return { portalEn, menuEn };
      });
      const res = await saveRoleMenus(selectedRoleId, grants);
      alert(`保存成功，共授权 ${res.inserted} 个菜单`);
      await loadRoleMenus(selectedRoleId);
      await loadRoles();
    } catch (e: any) {
      alert((e?.response?.data?.message || e?.message || '保存失败'));
    } finally {
      setSavingMenus(false);
    }
  };

  const selectedRole = roles.find(r => r.role_id === selectedRoleId);

  // ---- 用户分配 ----
  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await getPermUsers({ kw: userKw });
      setUsers(res.users);
    } catch (e: any) {
      console.error(e);
    } finally {
      setUsersLoading(false);
    }
  }, [userKw]);

  useEffect(() => {
    if (tab === 'users') loadUsers();
  }, [tab, userKw]);

  const openAssign = async (u: any) => {
    setAssignUser(u);
    const m = new Map<number, { roleId: number; orgId: number | null; dataScope: number | null }>();
    u.roles.forEach((r: any) => {
      m.set(r.roleId, { roleId: r.roleId, orgId: r.orgId ?? null, dataScope: r.dataScope ?? null });
    });
    setAssignRoles(m);
    // 加载组织树
    try {
      const res = await getOrgTree();
      setOrgNodes(res.nodes);
    } catch (e: any) {
      console.error(e);
    }
  };

  const toggleAssignRole = (roleId: number) => {
    setAssignRoles(prev => {
      const next = new Map(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.set(roleId, { roleId, orgId: null, dataScope: null });
      return next;
    });
  };

  const setAssignOrg = (roleId: number, orgId: number | null) => {
    setAssignRoles(prev => {
      const next = new Map(prev);
      const cur = next.get(roleId);
      if (cur) next.set(roleId, { ...cur, orgId });
      return next;
    });
  };

  const setAssignScope = (roleId: number, dataScope: number | null) => {
    setAssignRoles(prev => {
      const next = new Map(prev);
      const cur = next.get(roleId);
      if (cur) next.set(roleId, { ...cur, dataScope });
      return next;
    });
  };

  const handleSaveAssign = async () => {
    if (!assignUser) return;
    setSavingAssign(true);
    try {
      const payload = Array.from(assignRoles.values()).map(r => ({
        roleId: r.roleId,
        orgId: r.orgId || null,
        dataScope: r.dataScope || null,
      }));
      const res = await saveUserRoles(assignUser.userCode, payload);
      alert(`保存成功：${assignUser.userName} 分配 ${res.inserted} 个角色（重新登录后生效）`);
      setAssignUser(null);
      await loadUsers();
    } catch (e: any) {
      alert((e?.response?.data?.message || e?.message || '保存失败'));
    } finally {
      setSavingAssign(false);
    }
  };

  // 组织选项（层级缩进）
  const orgOptions = useMemo(() => {
    const byParent = new Map<number, any[]>();
    orgNodes.forEach(n => {
      const p = n.parent_org_id ?? 0;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p)!.push(n);
    });
    const list: { orgId: number; label: string; depth: number }[] = [];
    const walk = (parentId: number, depth: number) => {
      (byParent.get(parentId) || []).sort((a, b) => a.org_level - b.org_level || a.org_id - b.org_id).forEach(n => {
        list.push({ orgId: n.org_id, label: `${n.org_name}${n.shop_code ? `（${n.shop_code}）` : ''}`, depth });
        walk(n.org_id, depth + 1);
      });
    };
    walk(0, 0);
    return list;
  }, [orgNodes]);

  return (
    <Layout title="权限管理" subtitle="v3 角色、菜单授权与用户组织分配（重启不覆盖）">
      <div className="px-4">
        {/* Tabs */}
        <div className="flex items-center justify-between gap-3 mb-5 border-b border-gray-200">
          <div className="flex gap-2">
            <button
              onClick={() => setTab('roles')}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === 'roles' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <span className="flex items-center gap-1.5"><KeyRound size={15} /> 角色与菜单授权</span>
            </button>
            <button
              onClick={() => setTab('users')}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === 'users' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <span className="flex items-center gap-1.5"><Users size={15} /> 用户角色分配</span>
            </button>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {exporting ? '导出中...' : '导出 Excel'}
          </button>
        </div>

        {tab === 'roles' && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* 角色列表 */}
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2"><Shield size={18} className="text-blue-500" /> 角色（{roles.length}）</h3>
                <button onClick={() => openRoleForm()} className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white text-sm rounded-lg hover:bg-primary/90">
                  <Plus size={15} /> 新增角色
                </button>
              </div>
              <div className="space-y-1 max-h-[65vh] overflow-y-auto">
                {rolesLoading ? (
                  <div className="py-10 text-center text-gray-400">加载中...</div>
                ) : roles.map(r => (
                  <div
                    key={r.role_id}
                    onClick={() => setSelectedRoleId(r.role_id)}
                    className={`group flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                      selectedRoleId === r.role_id ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">{r.role_name}</div>
                      <div className="text-xs text-gray-400 truncate">
                        {r.role_code} · 数据范围：{DATA_SCOPE_LABELS[r.default_data_scope] || r.default_data_scope}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-[10px] bg-blue-50 text-blue-600 rounded-full px-2 py-0.5">{r.userCount} 人</span>
                      <button onClick={(e) => { e.stopPropagation(); openRoleForm(r); }} className="p-1 text-gray-300 hover:text-blue-500" title="编辑">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteRole(r); }} className="p-1 text-gray-300 hover:text-red-500" title="删除">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 菜单授权矩阵 */}
            <div className="lg:col-span-3 bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-800">
                  菜单授权 {selectedRole && <span className="text-primary">「{selectedRole.role_name}」</span>}
                  {selectedRole && <span className="text-xs font-normal text-gray-400 ml-2">已选 {roleGrants.size} 项</span>}
                </h3>
                <button
                  onClick={handleSaveMenus}
                  disabled={!selectedRoleId || savingMenus || menuLoading}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 disabled:opacity-40"
                >
                  {savingMenus ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} 保存授权
                </button>
              </div>
              {!selectedRole ? (
                <div className="py-10 text-center text-gray-400">请选择左侧角色</div>
              ) : menuLoading ? (
                <div className="py-10 text-center text-gray-400">加载授权中...</div>
              ) : (
                <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
                  {catalogMasters.map(master => {
                    const masterOpen = expandedMasters.has(master.masterPortalEn);
                    const masterAllOn = master.portals.length > 0 && master.portals.every(p => p.menus.length > 0 && p.menus.every(m => roleGrants.has(`${p.portalEn}::${m.menuEn}`)));
                    const masterAnyOn = master.portals.some(p => p.menus.some(m => roleGrants.has(`${p.portalEn}::${m.menuEn}`)));
                    return (
                      <div key={master.masterPortalEn} className="border border-gray-200 rounded-xl overflow-hidden">
                        {/* 主门户组头 */}
                        <div className="flex items-center justify-between bg-gradient-to-r from-blue-50 to-transparent px-3 py-2.5">
                          <button
                            onClick={() => setExpandedMasters(prev => {
                              const s = new Set(prev);
                              if (s.has(master.masterPortalEn)) s.delete(master.masterPortalEn); else s.add(master.masterPortalEn);
                              return s;
                            })}
                            className="flex items-center gap-2 text-sm font-bold text-gray-800"
                          >
                            <ChevronDown size={15} className={`transition-transform ${masterOpen ? '' : '-rotate-90'}`} />
                            {master.masterPortalCn}
                            <span className="text-[10px] text-gray-400 font-normal">（{master.portals.length} 个门户 / {master.portals.reduce((n, p) => n + p.menus.length, 0)} 个菜单）</span>
                          </button>
                          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={masterAllOn}
                              ref={(el) => { if (el) el.indeterminate = !masterAllOn && masterAnyOn; }}
                              onChange={() => toggleMasterAll(master)}
                              className="rounded"
                            />
                            主门户全选
                          </label>
                        </div>
                        {masterOpen && (
                          <div className="space-y-3 p-3 bg-gray-50/50">
                            {master.portals.map(portal => {
                              const allOn = portal.menus.length > 0 && portal.menus.every(m => roleGrants.has(`${portal.portalEn}::${m.menuEn}`));
                              const someOn = portal.menus.some(m => roleGrants.has(`${portal.portalEn}::${m.menuEn}`));
                              const isOpen = expandedPortals.has(portal.portalEn);
                              return (
                                <div key={portal.portalEn} className="border border-gray-100 rounded-lg overflow-hidden bg-white">
                                  <div className="flex items-center justify-between bg-gray-50 px-3 py-2">
                                    <button
                                      onClick={() => setExpandedPortals(prev => {
                                        const s = new Set(prev);
                                        if (s.has(portal.portalEn)) s.delete(portal.portalEn); else s.add(portal.portalEn);
                                        return s;
                                      })}
                                      className="flex items-center gap-2 text-sm font-medium text-gray-800"
                                    >
                                      <ChevronDown size={15} className={`transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                                      {portal.portalCn}
                                      <span className="text-[10px] text-gray-400 font-normal">({portal.portalEn})</span>
                                    </button>
                                    <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={allOn}
                                        ref={(el) => { if (el) el.indeterminate = !allOn && someOn; }}
                                        onChange={() => togglePortalAll(portal)}
                                        className="rounded"
                                      />
                                      全选
                                    </label>
                                  </div>
                                  {isOpen && (
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 p-3 bg-white">
                                      {portal.menus.map(m => {
                                        const on = roleGrants.has(`${portal.portalEn}::${m.menuEn}`);
                                        return (
                                          <label
                                            key={m.menuEn}
                                            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer border text-sm transition-colors ${
                                              on ? 'border-primary/40 bg-primary/5 text-primary' : 'border-gray-100 text-gray-600 hover:bg-gray-50'
                                            }`}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={on}
                                              onChange={() => toggleGrant(portal.portalEn, m.menuEn)}
                                              className="rounded"
                                            />
                                            <span className="truncate">{m.menuCn}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="flex justify-end pt-1">
                    <button
                      onClick={handleSaveMenus}
                      disabled={savingMenus}
                      className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 disabled:opacity-40"
                    >
                      {savingMenus ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} 保存授权
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'users' && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2"><Users size={18} className="text-blue-500" /> 用户角色分配（用户全 + sys_user_role）</h3>
              <div className="relative w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={userKw}
                  onChange={(e) => setUserKw(e.target.value)}
                  placeholder="搜索工号/姓名/手机号/角色/组织/数据范围..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/30 outline-none"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-3 text-left font-medium text-gray-600">工号</th>
                    <th className="px-3 py-3 text-left font-medium text-gray-600">姓名</th>
                    <th className="px-3 py-3 text-left font-medium text-gray-600">手机号</th>
                    <th className="px-3 py-3 text-left font-medium text-gray-600">管理员</th>
                    <th className="px-3 py-3 text-left font-medium text-gray-600">角色（组织 / 数据范围）</th>
                    <th className="px-3 py-3 text-left font-medium text-gray-600">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {usersLoading ? (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">加载中...</td></tr>
                  ) : users.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">暂无数据</td></tr>
                  ) : users.map(u => (
                    <tr key={u.userCode} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 text-gray-600">{u.userCode}</td>
                      <td className="px-3 py-2.5 text-gray-800 font-medium">{u.userName}</td>
                      <td className="px-3 py-2.5 text-gray-600">{u.phone}</td>
                      <td className="px-3 py-2.5">
                        {u.isAdmin ? <span className="text-[10px] bg-red-100 text-red-600 rounded-full px-2 py-0.5">是</span> : <span className="text-[10px] bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">否</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1 max-w-md">
                          {u.roles.length === 0 ? <span className="text-xs text-gray-300">未分配</span> : u.roles.map((r: any) => (
                            <span key={r.roleId} className="text-[10px] bg-blue-50 text-blue-600 rounded-full px-2 py-0.5 whitespace-nowrap">
                              {r.roleName}
                              {r.orgName ? `·${r.orgName}` : ''}
                              {r.dataScope ? `·${DATA_SCOPE_LABELS[r.dataScope] || ''}` : ''}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => openAssign(u)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs hover:bg-blue-100"
                        >
                          <Link2 size={13} /> 分配角色
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 角色表单弹窗 */}
      {showRoleForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">{editingRole ? '编辑角色' : '新增角色'}</h3>
              <button onClick={() => setShowRoleForm(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">角色名称 <span className="text-red-500">*</span></label>
                <input value={roleName} onChange={(e) => setRoleName(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">角色编码 <span className="text-red-500">*</span></label>
                <input value={roleCode} onChange={(e) => setRoleCode(e.target.value)} disabled={!!editingRole} placeholder="如 ops_director" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-gray-50 disabled:text-gray-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">默认数据范围</label>
                <select value={roleScope} onChange={(e) => setRoleScope(Number(e.target.value))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                  {Object.entries(DATA_SCOPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button onClick={() => setShowRoleForm(false)} className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">取消</button>
              <button onClick={handleSaveRole} disabled={savingRole} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50">
                {savingRole ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} 保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 用户角色分配弹窗 */}
      {assignUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">
                角色分配：{assignUser.userName} <span className="text-sm font-normal text-gray-400">（{assignUser.userCode}）</span>
              </h3>
              <button onClick={() => setAssignUser(null)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
            </div>
            <div className="text-xs text-gray-400 mb-3">一个用户可分配多个角色（取并集），每行列出的组织与数据范围为该角色的归属；重新登录后生效。</div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {allRoles.map(r => {
                const assigned = assignRoles.has(r.role_id);
                const cfg = assignRoles.get(r.role_id);
                return (
                  <div key={r.role_id} className={`border rounded-xl p-3 transition-colors ${assigned ? 'border-primary/40 bg-primary/5' : 'border-gray-100'}`}>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={assigned}
                        onChange={() => toggleAssignRole(r.role_id)}
                        className="rounded"
                      />
                      <span className="text-sm font-medium text-gray-800">{r.role_name}</span>
                      <span className="text-xs text-gray-400">{r.role_code} · 默认：{DATA_SCOPE_LABELS[r.default_data_scope] || '-'}</span>
                    </label>
                    {assigned && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 pl-6">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">归属组织</label>
                          <select
                            value={cfg?.orgId ?? ''}
                            onChange={(e) => setAssignOrg(r.role_id, e.target.value ? Number(e.target.value) : null)}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white"
                          >
                            <option value="">（不指定，按登录身份判定）</option>
                            {orgOptions.map(o => (
                              <option key={o.orgId} value={o.orgId}>{'　'.repeat(o.depth)}{o.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">数据范围</label>
                          <select
                            value={cfg?.dataScope ?? ''}
                            onChange={(e) => setAssignScope(r.role_id, e.target.value ? Number(e.target.value) : null)}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white"
                          >
                            <option value="">（跟随角色默认）</option>
                            {Object.entries(DATA_SCOPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-3 justify-end mt-5 pt-4 border-t border-gray-100">
              <button onClick={() => setAssignUser(null)} className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">取消</button>
              <button
                onClick={handleSaveAssign}
                disabled={savingAssign}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {savingAssign ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} 保存分配
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

export default PermissionPage;