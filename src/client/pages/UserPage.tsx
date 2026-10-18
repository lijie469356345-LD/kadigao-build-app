import { useEffect, useState, useRef } from 'react';
import { Search, Edit2, Trash2, X, Save, RefreshCw, Download, Upload, Plus, AlertTriangle, Link2, Loader2, UserPlus, LogOut } from 'lucide-react';
import { getUsers, updateUser, deleteUserByCode, createUser, bulkImportUsers, clearUsers } from '../../api/users';
import { registerResignation, getResignations } from '../../api/resignation';
import { getPermUsers, saveUserRoles, getOrgTree, getRoles, bindStoreShops } from '../../api/adminPerm';
import type { User } from '../../types';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { useDataCacheStore } from '../../store/dataCacheStore';
import * as XLSX from 'xlsx';
import { POSITION_OPTIONS, POSITION_DEFAULT_ORG_MAP, loadPositionItems, type PositionItem } from '../utils/userPositions';
import { toOrgLight, matchOrgsByPosition } from '../utils/positionOrgMatch';

const PAGE_KEY = 'userPage';

// 数据范围档位（与 permissionService 一致：1本人/2本组织/3本组织及下级/4指定组织/5全局）
const DATA_SCOPE_LABELS: Record<number, string> = {
  1: '本人数据',
  2: '本组织',
  3: '本组织及下级',
  4: '指定组织',
  5: '全局数据',
};

// 列名别名映射：兼容导出文件的"工号/姓名/电话"等中文标签和"用户代码/userCode"等字段名
const COLUMN_ALIASES: Record<string, string> = {
  '工号': '用户代码', '用户代码': '用户代码', 'userCode': '用户代码',
  '姓名': '用户名称', '用户名称': '用户名称', 'userName': '用户名称',
  '电话': '手机号', '手机': '手机号', '手机号': '手机号', 'phone': '手机号',
  '密码': '密码', 'password': '密码',
  '管理员': '管理员', 'isAdmin': '管理员',
  '企微账号': '企微账号',
  '仓库类别': '仓库类别',
  '店铺': '组织',
  '职位': '职位',
  '组织': '组织', '归属组织': '组织', '组织名称': '组织', 'orgName': '组织',
};

// 用户全表可编辑字段（新增/编辑弹窗按此渲染）
const USER_FIELDS: { key: string; label: string }[] = [
  { key: '用户代码', label: '工号' },
  { key: '用户名称', label: '姓名' },
  { key: '手机号', label: '电话' },
  { key: '密码', label: '密码' },
  { key: '组织', label: '组织（归属组织，自动决定可见数据范围）' },
  { key: '职位', label: '职位' },
  { key: '企微账号', label: '企微账号' },
  { key: '仓库类别', label: '仓库类别' },
];

// 「组织」选择器：组织树全量节点下拉 + 模糊搜索（层级缩进展示，选中即绑定用户归属组织）
function OrgTreeSelect({ value, onChange, options, placeholder }: {
  value: number | string | null;
  onChange: (orgId: number, orgName: string) => void;
  options: { orgId: number; label: string; depth: number }[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const cur = options.find(o => o.orgId === Number(value));
  const q = open ? kw : (cur ? cur.label : '');
  const filtered = q.trim() ? options.filter(o => o.label.toLowerCase().includes(q.trim().toLowerCase())) : options;

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        value={q}
        placeholder={placeholder || '搜索选择组织...'}
        onFocus={() => { setOpen(true); setKw(''); }}
        onChange={(e) => { setKw(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { const first = filtered[0]; if (first) { onChange(first.orgId, first.label); setOpen(false); } } }}
        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
      />
      {open && (
        <div className="absolute z-20 w-full mt-1 max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
          {filtered.map(o => (
            <div
              key={o.orgId}
              onMouseDown={() => { onChange(o.orgId, o.label); setOpen(false); }}
              className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-primary/10 ${Number(value) === o.orgId ? 'bg-primary/10 font-medium' : ''}`}
              style={{ paddingLeft: `${12 + o.depth * 16}px` }}
            >
              {o.depth > 0 && <span className="text-gray-300 mr-1">{'└'}</span>}
              {o.label}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-400">未找到匹配组织</div>
          )}
        </div>
      )}
    </div>
  );
}

// 「角色」筛选器：可搜索下拉，选择后过滤用户列表（与其他筛选项交互一致）
function RoleFilterSelect({ value, onChange, roles }: {
  value: number | null;
  onChange: (v: number | null) => void;
  roles: { roleId: number; roleName: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = roles.find(r => r.roleId === value);
  const q = open ? kw : (selected ? selected.roleName : '');
  const filtered = q.trim() ? roles.filter(r => r.roleName.toLowerCase().includes(q.trim().toLowerCase())) : roles;

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        value={q}
        placeholder="角色..."
        onFocus={() => { setOpen(true); setKw(''); }}
        onChange={(e) => { setKw(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { const first = filtered[0]; if (first) { onChange(first.roleId); setOpen(false); } } }}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none text-sm"
      />
      {value != null && (
        <button
          onClick={() => onChange(null)}
          className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-red-500"
          title="清除角色筛选"
        >
          <X size={14} />
        </button>
      )}
      {open && (
        <div className="absolute z-20 w-full mt-1 max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
          {filtered.map(r => (
            <div
              key={r.roleId}
              onMouseDown={() => { onChange(r.roleId); setOpen(false); }}
              className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-primary/10 ${value === r.roleId ? 'bg-primary/10 font-medium' : ''}`}
            >
              {r.roleName}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-400">未找到匹配角色</div>
          )}
        </div>
      )}
    </div>
  );
}

function UserPage() {
  const { user } = useAuthStore();
  const { pageCache, setPageCache, clearPageCache } = useDataCacheStore();
  const isAdmin = user?.isAdmin === '是';
  const canManagePerm = isAdmin || (user?.roleCodes || []).includes('super_admin') || (user?.roleCodes || []).includes('data_admin');
  const cached = pageCache[PAGE_KEY];
  const [users, setUsers] = useState<User[]>(cached?.users || []);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [columns, setColumns] = useState<string[]>(cached?.columns || []);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  // 离职登记：已离职用户代码集合 + 确认弹窗
  const [resignedCodes, setResignedCodes] = useState<Set<string>>(new Set());
  const [showResignConfirm, setShowResignConfirm] = useState(false);
  const [userToResign, setUserToResign] = useState<User | null>(null);
  const [resignRemark, setResignRemark] = useState('');
  const [resigning, setResigning] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasData, setHasData] = useState(!!cached);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUser, setNewUser] = useState<Record<string, string>>({
    '用户代码': '', '用户名称': '', '手机号': '', '密码': '8888', '管理员': '否',
    '企微账号': '', '仓库类别': '', '组织': '', '职位': '',
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const pageSize = 20;

  // 角色筛选项（全量角色，供「角色」可搜索下拉使用）
  const [roleFilter, setRoleFilter] = useState<number | null>(null);
  const [roleFilterOptions, setRoleFilterOptions] = useState<{ roleId: number; roleName: string }[]>([]);
  // 职位下拉选项：优先从职位表加载（含组织映射，供职位→组织自动带出），接口不可用回退内置 12 项
  const [positionItems, setPositionItems] = useState<PositionItem[]>(
    POSITION_OPTIONS.map(p => ({
      positionName: p,
      roleId: null,
      orgType: POSITION_DEFAULT_ORG_MAP[p]?.orgType ?? null,
      orgNameKw: POSITION_DEFAULT_ORG_MAP[p]?.orgNameKw ?? null,
    })),
  );
  const positionOptions = positionItems.map(i => i.positionName);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const items = await loadPositionItems();
        if (alive && items.length > 0) setPositionItems(items);
      } catch (e) { /* 职位加载失败不阻塞页面，回退内置列表 */ }
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await getRoles();
        // 后端 /roles 返回 role_id/role_name（snake_case），此处归一化为 roleId/roleName 供筛选器使用
        if (alive) setRoleFilterOptions((d.roles || []).map(r => ({ roleId: r.role_id ?? r.roleId, roleName: r.role_name ?? r.roleName })));
      } catch (e) { /* 角色加载失败不阻塞页面 */ }
    })();
    return () => { alive = false; };
  }, []);

  // 组织树节点（新增/编辑弹窗「组织」下拉数据，懒加载：打开弹窗时拉取全树节点）
  const [orgTreeLoading, setOrgTreeLoading] = useState(false);
  const ensureOrgTree = async () => {
    if (orgNodes.length > 0 || orgTreeLoading) return;
    setOrgTreeLoading(true);
    try {
      const orgRes = await getOrgTree();
      setOrgNodes(orgRes.nodes || []);
    } catch (e) { /* 组织树加载失败不阻塞弹窗 */ }
    finally { setOrgTreeLoading(false); }
  };

  // ---- 权限分配（角色+组织节点+数据范围，写 sys_user_role） ----
  const [assignUser, setAssignUser] = useState<any | null>(null);
  const [allRoles, setAllRoles] = useState<any[]>([]);
  const [orgNodes, setOrgNodes] = useState<any[]>([]);
  const [assignMap, setAssignMap] = useState<Map<number, { roleId: number; orgId: number | null; dataScope: number | null }>>(new Map());
  const [savingAssign, setSavingAssign] = useState(false);
  // 权限弹窗数据加载失败提示（如当前账号非 super_admin/data_admin 时接口 403，避免弹窗静默空白）
  const [assignLoadError, setAssignLoadError] = useState<string | null>(null);

  // 组织选项（层级缩进）
  const orgOptions = (() => {
    const byParent = new Map<number, any[]>();
    orgNodes.forEach((n: any) => {
      const p = n.parent_org_id ?? 0;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p)!.push(n);
    });
    const list: { orgId: number; label: string; depth: number }[] = [];
    const walk = (parentId: number, depth: number) => {
      (byParent.get(parentId) || []).sort((a, b) => a.org_level - b.org_level || a.org_id - b.org_id).forEach((n: any) => {
        list.push({ orgId: n.org_id, label: `${n.org_name}${n.shop_code ? `（${n.shop_code}）` : ''}`, depth });
        walk(n.org_id, depth + 1);
      });
    };
    walk(0, 0);
    return list;
  })();

  useEffect(() => {
    if (!pageCache[PAGE_KEY]) {
      loadUsers();
    }
    loadResigned();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const data = await getUsers();

      // 合并 sys_user_role 聚合数据（角色/组织节点/数据范围）——存在 roles 字段
      try {
        const perm = await getPermUsers({ kw: '' });
        const roleMap = new Map<string, any>();
        (perm.users || []).forEach((pu: any) => roleMap.set(String(pu.userCode).trim(), pu.roles || []));
        data.forEach((u: any) => {
          const roles = roleMap.get(String(u.userCode).trim());
          if (roles) (u as any).roles = roles;
        });
      } catch (e) {
        console.error('合并权限数据失败:', e);
      }

      setUsers(data);

      if (data.length > 0) {
        const firstUser = data[0];
        const allColumns = Object.keys(firstUser).filter(col => col !== 'roles' && col !== 'password' && col !== 'groupName' && col !== 'groupId');
        const priorityColumns = ['userCode', 'userName', 'phone', 'isAdmin', 'createdAt', 'updatedAt', 'lastLogin'];
        const remainingColumns = allColumns.filter(col => !priorityColumns.includes(col));
        const cols = [...priorityColumns, ...remainingColumns];
        setColumns(cols);
        setPageCache(PAGE_KEY, { users: data, columns: cols });
      }
      setHasData(true);
    } catch (error) {
      console.error('获取用户列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    clearPageCache(PAGE_KEY);
    loadUsers();
  };

  // 拉取已离职用户代码集合（用户管理页标记「已离职」标识）
  const loadResigned = async () => {
    try {
      const list = await getResignations();
      setResignedCodes(new Set(list.map(r => String(r.userCode).trim())));
    } catch (e) {
      console.error('加载离职列表失败:', e);
    }
  };

  const handleResign = (user: User) => {
    setResignRemark('');
    setUserToResign(user);
    setShowResignConfirm(true);
  };

  const confirmResign = async () => {
    if (!userToResign || !userToResign.userCode) return;
    setResigning(true);
    try {
      const res = await registerResignation(userToResign.userCode, resignRemark);
      alert(res.message || '离职登记成功');
      setShowResignConfirm(false);
      setUserToResign(null);
      if (resignedCodes.size === 0) {
        setResignedCodes(new Set([String(userToResign.userCode).trim()]));
      } else {
        const next = new Set(resignedCodes);
        next.add(String(userToResign.userCode).trim());
        setResignedCodes(next);
      }
    } catch (err: any) {
      alert((err?.response?.data?.message || err?.message || '离职登记失败'));
    } finally {
      setResigning(false);
    }
  };

  // ---- 权限分配逻辑 ----
  const openAssign = async (u: any) => {
    setAssignUser(u);
    setAssignLoadError(null);
    const m = new Map<number, { roleId: number; orgId: number | null; dataScope: number | null }>();
    (u.roles || []).forEach((r: any) => {
      m.set(r.roleId, { roleId: r.roleId, orgId: r.orgId ?? null, dataScope: r.dataScope ?? null });
    });
    setAssignMap(m);
    try {
      const [roleRes, orgRes] = await Promise.all([getRoles(), getOrgTree()]);
      // 后端 /roles 返回 role_id/role_name（snake_case），归一化为 roleId/roleName 供弹窗渲染与 assignMap 对照
      setAllRoles((roleRes.roles || []).map((r: any) => ({
        roleId: r.role_id ?? r.roleId,
        roleName: r.role_name ?? r.roleName,
        description: r.description ?? r.role_desc ?? '',
        orgId: r.org_id ?? r.orgId ?? null,
        dataScope: r.data_scope ?? r.dataScope ?? null,
      })));
      setOrgNodes(orgRes.nodes || []);
    } catch (e: any) {
      console.error(e);
      const msg = e?.response?.data?.message || e?.message || '未知错误';
      setAssignLoadError(msg);
      setAllRoles([]);
      setOrgNodes([]);
    }
  };

  const toggleAssignRole = (roleId: number) => {
    setAssignMap(prev => {
      const next = new Map(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.set(roleId, { roleId, orgId: null, dataScope: null });
      return next;
    });
  };

  const setAssignOrg = (roleId: number, orgId: number | null) => {
    setAssignMap(prev => {
      const next = new Map(prev);
      const cur = next.get(roleId);
      if (cur) next.set(roleId, { ...cur, orgId });
      return next;
    });
  };

  const setAssignScope = (roleId: number, dataScope: number | null) => {
    setAssignMap(prev => {
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
      const payload = Array.from(assignMap.values()).map(r => ({
        roleId: r.roleId,
        orgId: r.orgId || null,
        dataScope: r.dataScope || null,
      }));
      const res = await saveUserRoles(assignUser.userCode, payload);
      alert(`保存成功：${assignUser.userName} 关联 ${res.inserted} 个角色（用户重新登录后生效）`);
      setAssignUser(null);
      handleRefresh();
    } catch (e: any) {
      alert((e?.response?.data?.message || e?.message || '保存失败'));
    } finally {
      setSavingAssign(false);
    }
  };

  const handleExport = () => {
    const rows = [columns.map(c => getColumnLabel(c))];
    filteredUsers.forEach(u => {
      rows.push(columns.map(c => {
        if (c === '组织') {
          const roles = (u as any)?.roles;
          const orgVal = (u as any)['组织'];
          return String(orgVal != null && orgVal !== '' ? orgVal : (Array.isArray(roles) && roles.length > 0 ? (roles[0].orgName || '') : ''));
        }
        const v = u[c as keyof User];
        if (c === 'isAdmin') return v ? '是' : '否';
        return v != null ? String(v) : '';
      }));
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '用户列表');
    XLSX.writeFile(wb, `用户列表_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const filteredUsers = users.filter((u) => {
    const searchLower = searchTerm.toLowerCase();
    const kwOk = Object.values(u).some(value => 
      value != null && String(value).toLowerCase().includes(searchLower)
    );
    const roleOk = !roleFilter || ((u as any).roles || []).some((r: any) => r.roleId === roleFilter);
    return kwOk && roleOk;
  });

  // 最近三日入职区：以今日 0 点为界向前推 2 天（即近 3 个自然日）的滚动窗口，
  // 每日随日期自动轮转 —— 新的一天入职用户进入、第 4 天前的用户自动滑出
  const recentUsers = users
    .filter((u) => {
      if (!u.createdAt) return false;
      const d = new Date(u.createdAt as any);
      if (isNaN(d.getTime())) return false;
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const windowStart = new Date(todayStart.getTime() - 2 * 24 * 3600 * 1000);
      return d >= windowStart;
    })
    .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime());

  const totalPages = Math.ceil(filteredUsers.length / pageSize);
  const paginatedUsers = filteredUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const getColumnLabel = (col: string): string => {
    const labelMap: Record<string, string> = {
      userCode: '工号',
      userName: '姓名',
      phone: '电话',
      isAdmin: '管理员',
      id: 'ID',
      password: '密码',
      lastLogin: '最后登录',
      createdAt: '创建时间',
      updatedAt: '更新时间',
      '组织': '组织',
    };
    return labelMap[col] || col;
  };

  const formatCellValue = (user: User, col: string): React.ReactNode => {
    // 「组织」列：展示用户归属组织（用户全.组织 为主，sys_user_role 主角色绑定兜底，自动决定数据可见范围）
    if (col === '组织') {
      const roles = (user as any)?.roles;
      const orgVal = (user as any)['组织'];
      const orgName = orgVal != null && orgVal !== '' ? String(orgVal) : (Array.isArray(roles) && roles.length > 0 ? (roles[0].orgName || '') : '');
      return orgName || '-';
    }
    const value = user[col as keyof User];
    
    if (col === 'isAdmin') {
      return (
        <span className={`px-2 py-1 text-xs rounded-full ${value ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
          {value ? '是' : '否'}
        </span>
      );
    }
    
    if (value === null || value === undefined) {
      return '-';
    }
    
    const dateValue = typeof value === 'string' ? new Date(value) : value;
    if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
      if (col === 'lastLogin') {
        return dateValue.toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        });
      }
      return dateValue.toLocaleDateString('zh-CN');
    }
    
    return String(value);
  };

  const handleEdit = (user: User) => {
    const roles = (user as any)?.roles;
    const primary = Array.isArray(roles) && roles.length > 0 ? roles[0] : null;
    setEditingUser({ ...user, _orgId: primary?.orgId ?? null, _orgName: primary?.orgName ?? '' });
    setShowEditModal(true);
    ensureOrgTree();
  };

  const handleSaveEdit = async () => {
    if (!editingUser || !editingUser.userCode) return;
    const payload: Record<string, any> = {
      '用户代码': editingUser.userCode,
      '用户名称': editingUser.userName ?? '',
      '手机号': editingUser.phone ?? '',
      '密码': editingUser.password ?? '',
      '管理员': editingUser.isAdmin === '是' ? '是' : '否',
      '组织': (editingUser as any)._orgName ?? (editingUser as any)['组织'] ?? '',
      '职位': (editingUser as any)['职位'] ?? '',
      '企微账号': (editingUser as any)['企微账号'] ?? '',
      '仓库类别': (editingUser as any)['仓库类别'] ?? '',
    };
    try {
      await updateUser(editingUser.userCode, payload);
      // 组织归属绑定：更新该用户主角色（roles[0]）绑定的组织节点 org_id（写 sys_user_role，自动继承该组织数据范围）
      const orgId = (editingUser as any)._orgId ?? null;
      const roles = (editingUser as any)?.roles || [];
      if (roles.length > 0) {
        const newRoles = roles.map((r: any, i: number) => i === 0 ? { ...r, orgId } : r);
        await saveUserRoles(editingUser.userCode, newRoles.map((r: any) => ({
          roleId: r.roleId,
          orgId: r.orgId ?? null,
          dataScope: r.dataScope ?? null,
        })));
      } else if (orgId) {
        alert('已保存用户资料；该用户尚未配置角色，组织归属请在「配置组织与角色」中为账号指定角色后生效');
      }
      setShowEditModal(false);
      setEditingUser(null);
      handleRefresh();
    } catch (error) {
      console.error('更新用户失败:', error);
      alert('更新用户失败');
    }
  };

  const handleDelete = (user: User) => {
    setUserToDelete(user);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!userToDelete || !userToDelete.userCode) return;

    try {
      await deleteUserByCode(userToDelete.userCode);
      setUsers(users.filter(u => u.userCode !== userToDelete.userCode));
      setShowDeleteConfirm(false);
      setUserToDelete(null);
    } catch (error) {
      console.error('删除用户失败:', error);
      alert('删除用户失败');
    }
  };

  // 打开新增弹窗：自动计算下一个递增工号
  const openAddModal = () => {
    let maxNum = 0;
    users.forEach(u => {
      const code = String(u.userCode || '').trim();
      // 只识别纯数字且非手机号（长度<11）的工号
      if (/^\d+$/.test(code) && code.length < 11) {
        const n = parseInt(code, 10);
        if (n > maxNum) maxNum = n;
      }
    });
    const next = maxNum + 1;
    setNewUser({
      '用户代码': String(next).padStart(3, '0'),
      '用户名称': '', '手机号': '', '密码': '8888', '管理员': '否',
      '企微账号': '', '仓库类别': '', '组织': '', '职位': '',
    });
    setShowAddModal(true);
    ensureOrgTree();
  };

  const handleAddSave = async () => {
    if (!String(newUser['用户代码'] || '').trim()) { alert('工号不能为空'); return; }
    try {
      // 剥离前端辅助键（_orgId/_orgName），仅提交用户全表字段
      const { _orgId, _orgName, ...clean } = newUser as any;
      await createUser(clean as any);
      const orgId = (newUser as any)._orgId;
      if (orgId) {
        alert('用户已创建；该用户尚未配置角色，组织归属请在列表「配置组织与角色」中为账号指定角色后生效');
      }
      setShowAddModal(false);
      setNewUser({
        '用户代码': '', '用户名称': '', '手机号': '', '密码': '8888', '管理员': '否',
        '企微账号': '', '仓库类别': '', '组织': '', '职位': '',
      });
      handleRefresh();
    } catch (error: any) {
      console.error('新增用户失败:', error);
      alert('新增用户失败: ' + (error?.response?.data?.message || error?.message || ''));
    }
  };

  const handleImportClick = () => {
    if (!window.confirm('请准备 Excel 文件，首行为列名（用户代码、用户名称、手机号、密码、管理员、企微账号、仓库类别、职位、组织）。其中「组织」列可选：填写组织名称或ID即可写入该用户组织归属并同步角色绑定（仅对已配置角色的用户生效）；旧表头若含「店铺」列将按「组织」列处理。确定导入？')) return;
    fileRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
      if (json.length === 0) { alert('Excel 无数据'); return; }
      // 列名标准化：把"工号/姓名/电话"等别名映射为后端识别的字段名
      const normalized = json.map(row => {
        const r: Record<string, any> = {};
        Object.keys(row).forEach(k => {
          const key = COLUMN_ALIASES[k.trim()] || k.trim();
          r[key] = row[k];
        });
        return r;
      });
      if (!window.confirm(`共解析到 ${normalized.length} 条用户，确定导入？`)) return;
      const res = await bulkImportUsers(normalized);
      alert(res.message || `成功导入 ${res.count} 条`);
      handleRefresh();
    } catch (err: any) {
      console.error('导入失败:', err);
      alert('导入失败: ' + (err?.response?.data?.message || err?.message || ''));
    } finally {
      e.target.value = '';
    }
  };

  const handleClear = async () => {
    if (!window.confirm('确定清空所有用户数据吗？此操作不可撤销！')) return;
    if (!window.confirm('再次确认：清空后所有用户将无法登录，确定继续？')) return;
    try {
      const res = await clearUsers();
      alert(res.message || '已清空所有用户');
      handleRefresh();
    } catch (err: any) {
      alert('清空失败: ' + (err?.response?.data?.message || err?.message || ''));
    }
  };

  // ---- 「组织」列同步：按用户主角色绑定回填「组织」列（保证用户全与用户管理展示一致） ----
  const handleBindStore = async () => {
    if (!canManagePerm) return;
    try {
      const prev = await bindStoreShops(true);
      let msg = `预览：将按主角色绑定回填 ${prev.bound} 人「组织」列，已一致跳过 ${prev.already} 人，绑定组织缺失 ${prev.unmatched} 人（组织列保持现状）\n`;
      prev.warnings.forEach(w => { if (w.level === 'info') msg += w.text + '\n'; });
      const warnBad = prev.warnings.filter(w => w.level === 'warn');
      if (warnBad.length) msg += '注意：' + warnBad.map(w => w.text).join('\n') + '\n';
      msg += '\n确定执行同步吗？（将按各用户主角色绑定的组织回填「组织」列，仅改用户全表，不动角色绑定）';
      if (!window.confirm(msg)) return;
      const res = await bindStoreShops(false);
      const infoTxt = res.warnings.filter(w => w.level === 'info').map(w => w.text).join('\n');
      alert(`${res.ok ? '同步完成' : '同步失败'}\n${infoTxt || `回填 ${res.bound} 人、跳过 ${res.already} 人、未匹配 ${res.unmatched} 人`}`);
      handleRefresh();
    } catch (e: any) {
      alert('组织同步失败: ' + (e?.response?.data?.error || e?.message || ''));
    }
  };

  return (
    <Layout title="用户管理" subtitle="管理系统用户">
      <div className="px-4">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3 flex-1 max-w-2xl">
            <div className="relative max-w-md w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                placeholder="搜索用户..."
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
              />
            </div>
            <div className="w-52">
              <RoleFilterSelect value={roleFilter} onChange={(v) => { setRoleFilter(v); setCurrentPage(1); }} roles={roleFilterOptions} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"><Download size={18} /> 导出</button>
            <button onClick={handleImportClick} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"><Upload size={18} /> 批量导入</button>
            {canManagePerm && (
              <>
                <button onClick={handleBindStore} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700" title="按各用户主角色绑定的组织回填「组织」列，保证与用户管理展示一致">
                  <Link2 size={18} /> 同步组织
                </button>
              </>
            )}
            <button onClick={openAddModal} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark"><Plus size={18} /> 新增用户</button>
            <button onClick={handleClear} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"><AlertTriangle size={18} /> 清空数据</button>
            <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            <span>刷新数据</span>
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportFile} />
          </div>
        </div>

        {/* 最近三日入职区：手动导入/新增的用户进入此区，每日轮转，供人事快速调整岗位/权限 */}
        <div className="mb-6 bg-gradient-to-r from-indigo-50/60 via-purple-50/50 to-transparent border border-indigo-100 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <UserPlus size={18} className="text-indigo-600" />
              <h3 className="text-base font-semibold text-gray-800">最近三日入职区</h3>
              <span className="text-xs text-gray-400">每日轮转 · 展示近 3 个自然日新增用户</span>
            </div>
            <span className="text-xs px-2.5 py-1 bg-indigo-600 text-white rounded-full">{recentUsers.length} 人</span>
          </div>

          {loading ? (
            <div className="py-4 text-center text-gray-400 text-sm">加载中...</div>
          ) : recentUsers.length === 0 ? (
            <div className="py-4 text-center text-gray-400 text-sm">近 3 日暂无新增用户</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {recentUsers.map((ru) => {
                const roles = (ru as any)?.roles || [];
                const orgVal = (ru as any)['组织'];
                const recentOrg = orgVal != null && orgVal !== '' ? String(orgVal) : (roles.length > 0 ? (roles[0].orgName || '') : '');
                const joined = ru.createdAt ? new Date(ru.createdAt as any) : null;
                return (
                  <div key={ru.id} className="bg-white rounded-xl shadow-sm border border-indigo-100 p-3.5 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-800 truncate">{ru.userName || '-'}</span>
                          {ru.isAdmin && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 whitespace-nowrap">管理员</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">{ru.userCode}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs font-medium text-indigo-600">{joined ? joined.toLocaleDateString('zh-CN') : '-'}</div>
                        <div className="text-[10px] text-gray-400">入职日期</div>
                      </div>
                    </div>
                    <div className="mt-3 space-y-1.5 text-xs text-gray-500">
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-400 shrink-0">组织:</span>
                        <span className="truncate">{recentOrg || '-'}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-400 shrink-0">角色:</span>
                        {roles.length > 0 ? (
                          <span className="flex flex-wrap gap-1">
                            {roles.slice(0, 2).map((r: any) => (
                              <span key={r.roleId} className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 text-[10px]">{r.roleName}</span>
                            ))}
                            {roles.length > 2 && <span className="text-[10px] text-gray-400">+{roles.length - 2}</span>}
                          </span>
                        ) : (
                          <span className="text-gray-300">未配置</span>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
                      {canManagePerm && (
                        <button
                          onClick={() => openAssign(ru)}
                          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
                          title="配置组织与角色（权限调整）"
                        >
                          <Link2 size={13} /> 配置权限
                        </button>
                      )}
                      <button
                        onClick={() => handleEdit(ru)}
                        className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                        title="编辑用户（岗位调整）"
                      >
                        <Edit2 size={13} /> 调整岗位
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                {columns.map((col) => (
                  <th key={col} className="px-4 py-4 text-left text-sm font-medium text-gray-600 whitespace-nowrap">
                    {getColumnLabel(col)}
                  </th>
                ))}
                <th className="px-4 py-4 text-left text-sm font-medium text-gray-600 whitespace-nowrap">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={columns.length + 1 || 1} className="px-4 py-8 text-center text-gray-400">
                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p>加载中...</p>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 1 || 1} className="px-4 py-8 text-center text-gray-400">
                    <p>暂无数据</p>
                  </td>
                </tr>
              ) : (
                paginatedUsers.map((userItem) => (
                  <tr key={userItem.id} className="hover:bg-gray-50 transition-colors">
                    {columns.map((col) => (
                      <td key={col} className="px-4 py-4 text-gray-800 whitespace-nowrap">
                        {formatCellValue(userItem, col)}
                      </td>
                    ))}
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {canManagePerm && (
                          <button
                            onClick={() => openAssign(userItem)}
                            className="p-2 text-purple-500 hover:bg-purple-50 rounded-lg transition-colors"
                            title="配置组织与角色（权限隔离）"
                          >
                            <Link2 size={16} />
                          </button>
                        )}
                        {resignedCodes.has(String(userItem.userCode).trim()) ? (
                          <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-500 whitespace-nowrap">
                            已离职
                          </span>
                        ) : (
                          <>
                            <button
                              onClick={() => handleEdit(userItem)}
                              className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                              title="修改"
                            >
                              <Edit2 size={16} />
                            </button>
                            {isAdmin && (
                              <>
                                <button
                                  onClick={() => handleResign(userItem)}
                                  className="p-2 text-orange-500 hover:bg-orange-50 rounded-lg transition-colors"
                                  title="离职登记（进入离职管理）"
                                >
                                  <LogOut size={16} />
                                </button>
                                <button
                                  onClick={() => handleDelete(userItem)}
                                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                  title="删除"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-200 bg-gray-50 mt-4">
            <span className="text-xs text-gray-500">共 {filteredUsers.length} 条，第 {currentPage}/{totalPages} 页</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className="px-2 py-0.5 text-xs border rounded disabled:opacity-30">首页</button>
              <button onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="px-2 py-0.5 text-xs border rounded disabled:opacity-30">上一页</button>
              {(() => {
                const pages: (number | string)[] = [];
                if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) pages.push(i); }
                else {
                  pages.push(1);
                  if (currentPage > 3) pages.push('...');
                  for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
                  if (currentPage < totalPages - 2) pages.push('...');
                  pages.push(totalPages);
                }
                return pages.map((p, i) => p === '...' ? <span key={'e'+i} className="px-1 text-gray-400 text-xs">...</span> :
                  <button key={p} onClick={() => setCurrentPage(p as number)} className={`px-2 py-0.5 text-xs border rounded ${p === currentPage ? 'bg-primary text-white' : ''}`}>{p}</button>);
              })()}
              <button onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages} className="px-2 py-0.5 text-xs border rounded disabled:opacity-30">下一页</button>
              <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage >= totalPages} className="px-2 py-0.5 text-xs border rounded disabled:opacity-30">末页</button>
            </div>
          </div>
        )}

        {showEditModal && editingUser && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-800">编辑用户</h3>
                <button
                  onClick={() => { setShowEditModal(false); setEditingUser(null); }}
                  className="p-1 hover:bg-gray-100 rounded-lg"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                {USER_FIELDS.map(f => {
                  const EN: Record<string, string> = { 用户代码: 'userCode', 用户名称: 'userName', 手机号: 'phone', 密码: 'password' };
                  const en = EN[f.key];
                  const curVal = en ? String((editingUser as any)[en] ?? '') : String((editingUser as any)[f.key] ?? '');
                  return (
                    <div key={f.key}>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}{f.key === '用户代码' && <span className="text-red-500"> *</span>}</label>
                      {f.key === '组织' ? (
                        <OrgTreeSelect
                          value={(editingUser as any)._orgId ?? null}
                          onChange={(orgId, orgName) => setEditingUser({ ...editingUser, _orgId: orgId, _orgName: orgName })}
                          options={orgOptions}
                          placeholder="搜索选择归属组织..."
                        />
                      ) : f.key === '职位' ? (
                        <select
                          value={curVal}
                          onChange={(e) => {
                            const pos = e.target.value;
                            const next: any = { ...editingUser, '职位': pos };
                            // 职位 → 组织自动带出（仅当尚未手动选择归属组织时）
                            if (!next._orgId && pos) {
                              const cands = matchOrgsByPosition(pos, orgNodes.map(toOrgLight), { userName: String(editingUser['用户名称'] ?? '') }, positionItems);
                              if (cands.length > 0) { next._orgId = cands[0].orgId; next._orgName = cands[0].orgName; }
                            }
                            setEditingUser(next);
                          }}
                          className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-white"
                        >
                          <option value="">请选择职位</option>
                          {positionOptions.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={curVal}
                          onChange={(e) => setEditingUser({ ...editingUser, ...(en ? { [en]: e.target.value } : { [f.key]: e.target.value }) })}
                          className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                        />
                      )}
                    </div>
                  );
                })}
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingUser.isAdmin === '是'}
                      onChange={(e) => setEditingUser({ ...editingUser, isAdmin: e.target.checked ? '是' : '否' })}
                      className="rounded"
                    />
                    <span className="text-sm font-medium text-gray-700">管理员</span>
                  </label>
                </div>
              </div>
              <div className="flex gap-3 justify-end mt-6">
                <button
                  onClick={() => { setShowEditModal(false); setEditingUser(null); }}
                  className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
                >
                  <Save size={16} />
                  保存
                </button>
              </div>
            </div>
          </div>
        )}

        {showDeleteConfirm && userToDelete && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-sm">
              <h3 className="text-lg font-bold text-gray-800 mb-2">确认删除</h3>
              <p className="text-gray-600 mb-4">确定要删除用户 "{userToDelete.userName}" 吗？此操作不可撤销。</p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => { setShowDeleteConfirm(false); setUserToDelete(null); }}
                  className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={confirmDelete}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        )}

        {showResignConfirm && userToResign && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-sm">
              <h3 className="text-lg font-bold text-gray-800 mb-2">离职登记</h3>
              <p className="text-gray-600 mb-3">
                确定将用户「{userToResign.userName}」（{userToResign.userCode}）登记离职吗？
                登记后将出现在「离职管理」列表中。
              </p>
              <textarea
                value={resignRemark}
                onChange={(e) => setResignRemark(e.target.value)}
                placeholder="离职原因/备注（选填）"
                rows={3}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none text-sm mb-4 resize-none"
              />
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => { setShowResignConfirm(false); setUserToResign(null); }}
                  className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={confirmResign}
                  disabled={resigning}
                  className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
                >
                  {resigning ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
                  确认离职
                </button>
              </div>
            </div>
          </div>
        )}

        {showAddModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-800">新增用户</h3>
                <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
              </div>
              <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                {USER_FIELDS.map(f => (
                  <div key={f.key}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {f.label}{f.key === '用户代码' && <span className="text-red-500"> *</span>}
                    </label>
                    {f.key === '组织' ? (
                      <OrgTreeSelect
                        value={(newUser as any)._orgId ?? null}
                        onChange={(orgId, orgName) => setNewUser({ ...newUser, _orgId: String(orgId), _orgName: orgName })}
                        options={orgOptions}
                        placeholder="搜索选择归属组织..."
                      />
                    ) : f.key === '职位' ? (
                      <select
                        value={newUser['职位'] || ''}
                        onChange={(e) => {
                          const pos = e.target.value;
                          const next: any = { ...newUser, '职位': pos };
                          // 职位 → 组织自动带出（仅当尚未手动选择归属组织时）
                          if (!next._orgId && pos) {
                            const cands = matchOrgsByPosition(pos, orgNodes.map(toOrgLight), { userName: String(newUser['用户名称'] ?? '') }, positionItems);
                            if (cands.length > 0) { next._orgId = String(cands[0].orgId); next._orgName = cands[0].orgName; }
                          }
                          setNewUser(next);
                        }}
                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-white"
                      >
                        <option value="">请选择职位</option>
                        {positionOptions.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={newUser[f.key] || ''}
                        onChange={(e) => setNewUser({ ...newUser, [f.key]: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                      />
                    )}
                  </div>
                ))}
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={newUser['管理员'] === '是'} onChange={(e) => setNewUser({ ...newUser, '管理员': e.target.checked ? '是' : '否' })} className="rounded" />
                    <span className="text-sm font-medium text-gray-700">管理员</span>
                  </label>
                </div>
              </div>
              <div className="flex gap-3 justify-end mt-6">
                <button onClick={() => setShowAddModal(false)} className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">取消</button>
                <button onClick={handleAddSave} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90">
                  <Save size={16} /> 保存
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 权限分配弹窗：角色 + 组织节点 + 数据范围（写 sys_user_role） */}
        {assignUser && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-bold text-gray-800">配置权限隔离 - {assignUser.userName}（{assignUser.userCode}）</h3>
                <button onClick={() => setAssignUser(null)} className="p-1 hover:bg-gray-100 rounded-lg">
                  <X size={20} />
                </button>
              </div>
              {assignLoadError ? (
                <div className="flex-1 overflow-y-auto">
                  <div className="border border-red-200 bg-red-50 rounded-lg p-4 text-sm text-red-600">
                    <p className="font-medium mb-1">权限数据加载失败，无法配置</p>
                    <p className="mb-2">{assignLoadError}</p>
                    <p className="text-red-400 text-xs">
                      请确认当前登录账号为「超级管理员」或「数据管理员」（组织管理/权限管理均受此限制）。
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-2">
                <div className="text-xs text-gray-500 mb-1">
                  勾选角色后，为该角色指定「归属组织节点」与「数据范围」；保存后用户重新登录即生效。一人多角色取数据范围最高档。
                </div>
                {allRoles.length === 0 ? (
                  <div className="border border-gray-200 bg-gray-50 rounded-lg p-4 text-sm text-gray-500">
                    暂无可分配角色（角色列表为空）。
                  </div>
                ) : (
                allRoles.map((role) => {
                  const cur = assignMap.get(role.roleId);
                  const checked = !!cur;
                  return (
                    <div key={role.roleId} className={`border rounded-lg p-3 ${checked ? 'border-primary bg-primary/5' : 'border-gray-200'}`}>
                      <label className="flex items-center gap-2 cursor-pointer mb-1">
                        <input type="checkbox" checked={checked} onChange={() => toggleAssignRole(role.roleId)} className="rounded" />
                        <span className="text-sm font-medium text-gray-800">{role.roleName}</span>
                        {role.description && <span className="text-xs text-gray-400">（{role.description}）</span>}
                      </label>
                      {checked && (
                        <div className="flex gap-3 ml-6 flex-wrap mt-1">
                          <div className="flex-1 min-w-[220px]">
                            <label className="block text-xs text-gray-500 mb-1">归属组织节点</label>
                            <select
                              value={cur.orgId ?? ''}
                              onChange={(e) => setAssignOrg(role.roleId, e.target.value ? Number(e.target.value) : null)}
                              className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-primary/50"
                            >
                              <option value="">（未指定）</option>
                              {orgOptions.map(o => (
                                <option key={o.orgId} value={o.orgId}>
                                  {'　'.repeat(o.depth)}{o.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex-1 min-w-[150px]">
                            <label className="block text-xs text-gray-500 mb-1">数据范围</label>
                            <select
                              value={cur.dataScope ?? ''}
                              onChange={(e) => setAssignScope(role.roleId, e.target.value ? Number(e.target.value) : null)}
                              className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-primary/50"
                            >
                              <option value="">（使用角色默认）</option>
                              {Object.entries(DATA_SCOPE_LABELS).map(([v, lbl]) => (
                                <option key={v} value={v}>{lbl}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
                )}
              </div>
              )}
              <div className="flex gap-3 justify-end mt-6">
                <button onClick={() => setAssignUser(null)} className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">取消</button>
                <button
                  onClick={handleSaveAssign}
                  disabled={savingAssign}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
                >
                  {savingAssign ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  保存配置
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default UserPage;
