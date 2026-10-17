import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Building, Store, ChevronRight, ChevronDown, Plus, Edit2, Trash2, RefreshCw,
  Search, ArrowRightLeft, X, Save, Loader2, FolderTree, MapPin, Link2, Unlink, User,
  Download, Upload, CheckSquare,
} from 'lucide-react';
import Layout from '../components/Layout';
import {
  getOrgTree, createOrg, updateOrg, deleteOrg, moveOrg, getShopSource, getShopFilters, unbindShopOrg,
  getOrgVisibleShops, bindOrgVisibleShops, unbindOrgVisibleShop,
  getOrgUsers, addOrgUser, updateOrgUserOrg, removeOrgUser, getRoles, getPermUsers, syncOrgFromArchive,
  exportOrgArchive, importOrgArchive, previewShopScopeSync, runShopScopeSync,
} from '../../api/adminPerm';

interface OrgNode {
  org_id: number;
  parent_org_id: number | null;
  org_name: string;
  org_type: string;
  org_level: number;
  ancestors: string;
  area_name?: string;
  warehouse_type?: string;
  business_line?: string;
  function_line?: string;
  org_code?: string;
  shop_code?: string;
  shop_name?: string;
  status?: number;
  del_flag?: number;
  userCount?: number;
}

const ORG_TYPE_LABELS: Record<string, string> = {
  company: '公司',
  director: '总监',
  group: '部门组',
  supervisor_group: '督导组',
  dealer_group: '经销商组',
  shop_group: '门店组',
  shop: '店铺',
};

const ORG_TYPE_COLORS: Record<string, string> = {
  company: 'bg-purple-100 text-purple-600',
  director: 'bg-blue-100 text-blue-600',
  group: 'bg-cyan-100 text-cyan-600',
  supervisor_group: 'bg-amber-100 text-amber-600',
  dealer_group: 'bg-orange-100 text-orange-600',
  shop_group: 'bg-green-100 text-green-600',
  shop: 'bg-pink-100 text-pink-600',
};

const DATA_SCOPE_LABELS: Record<number, string> = {
  1: '本人数据',
  2: '本部门数据',
  3: '本部门及以下',
  4: '全部数据',
  5: '自定义数据权限',
};

function buildTree(nodes: OrgNode[]): Map<number, OrgNode[]> {
  const map = new Map<number, OrgNode[]>();
  for (const n of nodes) {
    const parent = n.parent_org_id ?? 0;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent)!.push(n);
  }
  // 按层级排序
  map.forEach(list => list.sort((a, b) => (a.org_level - b.org_level) || (a.org_id - b.org_id)));
  return map;
}

function OrgManagePage() {
  const [nodes, setNodes] = useState<OrgNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // 新建/编辑弹窗
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<OrgNode | null>(null);
  const [formParentId, setFormParentId] = useState<number | null>(null);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('group');
  const [formBusinessLine, setFormBusinessLine] = useState('');
  const [formFunctionLine, setFormFunctionLine] = useState('');
  const [formWarehouseType, setFormWarehouseType] = useState('');
  const [formOrgCode, setFormOrgCode] = useState('');
  const [saving, setSaving] = useState(false);

  // 移动弹窗
  const [showMove, setShowMove] = useState(false);
  const [moveTarget, setMoveTarget] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);

  // 店铺归属
  const [shopSearch, setShopSearch] = useState('');
  const [shopSupervisor, setShopSupervisor] = useState('');
  const [shopAreaManager, setShopAreaManager] = useState('');
  const [shopDealer, setShopDealer] = useState('');
  const [shopArea, setShopArea] = useState('');
  const [shopWarehouseType, setShopWarehouseType] = useState('');
  // 搜索请求序号：切换组织/筛选词后丢弃旧请求的过期响应，避免旧组织数据覆盖当前列表
  const shopSearchSeqRef = useRef(0);
  const [filterOptions, setFilterOptions] = useState<{
    supervisors: string[]; areaManagers: string[]; dealers: string[]; areas: string[]; warehouseTypes: string[];
  }>({ supervisors: [], areaManagers: [], dealers: [], areas: [], warehouseTypes: [] });
  const [shops, setShops] = useState<any[]>([]);
  const [shopLoading, setShopLoading] = useState(false);
  const [selectedShopCodes, setSelectedShopCodes] = useState<Set<string>>(new Set());
  const [boundShopNodes, setBoundShopNodes] = useState<OrgNode[]>([]);
  // 本组织可见绑定店铺（org_shop_bind：与树挂载解耦，可多次绑定）
  const [visibleBoundShops, setVisibleBoundShops] = useState<{ orgId: number; shopCode: string; shopName: string }[]>([]);
  const [binding, setBinding] = useState(false);
  // 店铺范围同步（组织架构直属挂载店铺 → org_shop_bind 固化）
  const [syncingScope, setSyncingScope] = useState(false);

  // 用户归属弹窗（人头/人数穿透：调整 sys_user_role 的 org_id，不改用户表）
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [userModalOrg, setUserModalOrg] = useState<OrgNode | null>(null);
  const [orgEntries, setOrgEntries] = useState<any[]>([]);
  const [orgUserCount, setOrgUserCount] = useState(0);
  const [orgUsersLoading, setOrgUsersLoading] = useState(false);
  // 门店组（shop_group）聚合标记：true 表示归属用户按「门店组店铺 ↔ 用户店铺」自动匹配汇总，只读，禁止调整
  const [orgAggregated, setOrgAggregated] = useState(false);
  const [orgAggregatedWt, setOrgAggregatedWt] = useState('');
  // 添加用户
  const [candKw, setCandKw] = useState('');
  const [candidates, setCandidates] = useState<any[]>([]);
  const [candLoading, setCandLoading] = useState(false);
  const [pickUser, setPickUser] = useState<any>(null);
  const [pickRoleId, setPickRoleId] = useState('');
  const [allRoles, setAllRoles] = useState<any[]>([]);
  const [addingOrgUser, setAddingOrgUser] = useState(false);
  // 调整/移出归属
  const [adjustingId, setAdjustingId] = useState<number | null>(null);
  const [targetOrgId, setTargetOrgId] = useState<string>('');
  const [savingAdjust, setSavingAdjust] = useState(false);

  // 组织架构归档同步（店铺档案 → 区经/督导/经销商/店铺 自动维护）
  const [syncing, setSyncing] = useState(false);
  const [syncBiz, setSyncBiz] = useState('直营');

  // 组织架构导出 / 导入（导出 xlsx 可直接回导；导入先预览后确认执行）
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  // 导入模式：diff=对比现有框架调整（只增/改/删文件外节点，默认）；replace=清除现有框架按文件重建
  const [importMode, setImportMode] = useState<'diff' | 'replace'>('diff');
  const importFileRef = useRef<HTMLInputElement>(null);

  // 业务线同步配置：parent 节点名 / 档案仓库类别 / 是否含经销商层级
  const SYNC_BIZ_LINES = [
    { label: '直营', parentName: '区经组直营', warehouseType: '直营', dealerLevel: false, levelDesc: '区经 → 督导 → 店铺' },
    { label: '加盟', parentName: '区经组加盟', warehouseType: '加盟', dealerLevel: true, levelDesc: '区经 → 督导 → 经销商 → 店铺' },
    { label: '山东', parentName: '区经组山东', warehouseType: '山东直营', dealerLevel: false, levelDesc: '区经 → 督导 → 店铺' },
  ];

  const tree = useMemo(() => buildTree(nodes), [nodes]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getOrgTree();
      setNodes(res.nodes);
      // 默认全部折叠（不预展开任何层级）；用户可点击箭头逐层展开，或用「展开到第N层」快捷按钮
      setExpanded(prev => prev.size > 0 ? prev : new Set());
      if (!selectedId && res.nodes.length > 0) setSelectedId(res.nodes[0].org_id);
    } catch (e: any) {
      console.error(e);
      alert('加载组织树失败: ' + (e?.response?.data?.message || e.message));
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { load(); }, []);

  const nodeById = useMemo(() => {
    const m = new Map<number, OrgNode>();
    nodes.forEach(n => m.set(n.org_id, n));
    return m;
  }, [nodes]);

  const selected = selectedId ? nodeById.get(selectedId) : null;

  // 选中节点变动时刷新其店铺子节点 + 本组织可见绑定
  useEffect(() => {
    if (!selected) return;
    const bound = nodes.filter(n => n.parent_org_id === selected.org_id && n.org_type === 'shop');
    setBoundShopNodes(bound);
    getOrgVisibleShops(selected.org_id)
      .then(res => setVisibleBoundShops(Array.isArray(res && res.shops) ? res.shops : []))
      .catch(err => { console.error('加载可见绑定失败', err); setVisibleBoundShops([]); });
  }, [selectedId, nodes]);

  useEffect(() => {
    if (selected && showForm && !showMove) {
      // 仅在打开编辑时预填
    }
  }, [selected]);

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 层级快捷展开：全部收起 / 展开到第N层 / 展开全部
  const collapseAll = () => setExpanded(new Set<number>());
  const expandToLevel = (level: number) => {
    setExpanded(new Set(nodes.filter(n => n.org_level <= level).map(n => n.org_id)));
  };
  const expandAll = () => setExpanded(new Set(nodes.map(n => n.org_id)));

  // 渲染树
  const renderTree = (parentId: number, depth: number): React.ReactNode => {
    const children = tree.get(parentId) || [];
    if (children.length === 0) return null;
    return (
      <ul className={depth > 0 ? 'ml-4 border-l border-gray-100 pl-2' : ''}>
        {children.map((n: OrgNode) => {
          const hasChildren = (tree.get(n.org_id) || []).length > 0;
          const isOpen = expanded.has(n.org_id);
          const isSelected = selectedId === n.org_id;
          const isShop = n.org_type === 'shop';
          return (
            <li key={n.org_id}>
              <div
                className={`group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer text-sm transition-colors ${
                  isSelected ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-gray-50 text-gray-700'
                }`}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                onClick={() => setSelectedId(n.org_id)}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); toggleExpand(n.org_id); }}
                  className="p-0.5 hover:bg-gray-200 rounded"
                >
                  {hasChildren ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="inline-block w-3.5" />}
                </button>
                {isShop ? <Store size={15} className="text-pink-500" /> : <Building size={15} className="text-blue-500" />}
                <span className="truncate">{n.org_name}</span>
                <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] ${ORG_TYPE_COLORS[n.org_type] || 'bg-gray-100 text-gray-500'}`}>
                  {ORG_TYPE_LABELS[n.org_type] || n.org_type}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); openUserModal(n); }}
                  title="点击调整该组织的用户归属"
                  className={`ml-auto flex items-center gap-0.5 text-[10px] rounded-full px-1.5 py-0.5 transition-colors ${
                    (n.userCount || 0) > 0
                      ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                      : 'text-gray-400 bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  <User size={10} /> {n.userCount || 0}
                </button>
                {!isShop && n.org_type !== 'company' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(n); }}
                    title="删除该层组织（有子组织或用户绑定时会被拒绝）"
                    className="p-1 text-gray-300 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 rounded transition-all"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              {isOpen && renderTree(n.org_id, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

  const openAdd = (parent: OrgNode) => {
    setEditing(null);
    setFormParentId(parent.org_id);
    setFormName('');
    setFormType('group');
    setFormBusinessLine('');
    setFormFunctionLine('');
    setFormWarehouseType('');
    setFormOrgCode('');
    setShowForm(true);
  };

  const openEdit = (node: OrgNode) => {
    if (node.org_type === 'shop') { alert('店铺叶子节点请通过店铺归属管理调整'); return; }
    setEditing(node);
    setFormParentId(node.parent_org_id);
    setFormName(node.org_name);
    setFormType(node.org_type);
    setFormBusinessLine(node.business_line || '');
    setFormFunctionLine(node.function_line || '');
    setFormWarehouseType(node.warehouse_type || '');
    setFormOrgCode(node.org_code || '');
    setShowForm(true);
  };

  const handleSaveForm = async () => {
    if (!formName.trim()) { alert('组织名称不能为空'); return; }
    if (!formParentId) { alert('缺少父组织'); return; }
    setSaving(true);
    try {
      if (editing) {
        await updateOrg(editing.org_id, {
          name: formName.trim(),
          orgType: formType,
          businessLine: formBusinessLine || undefined,
          functionLine: formFunctionLine || undefined,
          warehouseType: formWarehouseType || undefined,
          orgCode: formOrgCode || undefined,
        });
      } else {
        await createOrg({
          parentId: formParentId,
          name: formName.trim(),
          orgType: formType,
          businessLine: formBusinessLine || undefined,
          functionLine: formFunctionLine || undefined,
          warehouseType: formWarehouseType || undefined,
          orgCode: formOrgCode || undefined,
        });
      }
      setShowForm(false);
      // 展开父节点
      setExpanded(prev => { const s = new Set(prev); s.add(formParentId); return s; });
      await load();
    } catch (e: any) {
      console.error(e);
      alert((e?.response?.data?.message || e?.message || '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (node: OrgNode) => {
    if (!window.confirm(`确定删除组织「${node.org_name}」吗？\n存在子组织、用户绑定、店铺范围绑定、审批流引用或用户归属引用时会被拒绝。`)) return;
    try {
      await deleteOrg(node.org_id);
      await load();
    } catch (e: any) {
      alert((e?.response?.data?.message || e?.message || '删除失败'));
    }
  };

  const handleMove = async () => {
    if (!selected || !moveTarget) return;
    setMoving(true);
    try {
      await moveOrg(selected.org_id, moveTarget);
      setShowMove(false);
      await load();
    } catch (e: any) {
      alert((e?.response?.data?.message || e?.message || '移动失败'));
    } finally {
      setMoving(false);
    }
  };

  // 店铺搜索
  const searchShops = async () => {
    const seq = ++shopSearchSeqRef.current;
    setShopLoading(true);
    try {
      const res = await getShopSource({
        kw: shopSearch,
        supervisor: shopSupervisor,
        areaManager: shopAreaManager,
        dealer: shopDealer,
        area: shopArea,
        warehouseType: shopWarehouseType,
        orgId: selected ? selected.org_id : undefined,
      });
      if (seq !== shopSearchSeqRef.current) return; // 已有更新的请求，丢弃本次过期结果
      setShops(Array.isArray(res && res.shops) ? res.shops : []);
      setSelectedShopCodes(new Set());
    } catch (e: any) {
      if (seq !== shopSearchSeqRef.current) return;
      console.error(e);
      alert('加载店铺失败');
    } finally {
      if (seq === shopSearchSeqRef.current) setShopLoading(false);
    }
  };

  const searchShopsDebounced = useMemo(() => {
    let timer: any;
    return () => {
      clearTimeout(timer);
      timer = setTimeout(searchShops, 300);
    };
  }, [shopSearch, shopSupervisor, shopAreaManager, shopDealer, shopArea, shopWarehouseType, selectedId]);

  useEffect(() => {
    if (selected && selected.org_type !== 'shop') {
      searchShopsDebounced();
    }
  }, [shopSearch, shopSupervisor, shopAreaManager, shopDealer, shopArea, shopWarehouseType, selectedId]);

  // 加载筛选项取值（接口异常或格式不符时保留空数组，避免渲染崩溃）
  useEffect(() => {
    getShopFilters()
      .then(res => {
        const f = res && res.filters;
        if (!f || !Array.isArray(f.supervisors) || !Array.isArray(f.areaManagers) || !Array.isArray(f.dealers) || !Array.isArray(f.areas) || !Array.isArray(f.warehouseTypes)) {
          console.error('店仓筛选项返回格式异常', res);
          return;
        }
        setFilterOptions({ supervisors: f.supervisors, areaManagers: f.areaManagers, dealers: f.dealers, areas: f.areas, warehouseTypes: f.warehouseTypes });
      })
      .catch(err => console.error('加载店仓筛选项失败', err));
  }, []);

  const toggleShopSelect = (code: string) => {
    setSelectedShopCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };

  // 可选店铺 = 未在本组织可见绑定中（树挂载不限制：同一店可绑到多个组织）
  const selectableShops = shops.filter(s => !s.visibleBound);
  const allShopSelected = selectableShops.length > 0 && selectableShops.every(s => selectedShopCodes.has(s.shopCode));

  const handleToggleSelectAll = () => {
    setSelectedShopCodes(prev => {
      const next = new Set(prev);
      if (allShopSelected) {
        selectableShops.forEach(s => next.delete(s.shopCode));
      } else {
        selectableShops.forEach(s => next.add(s.shopCode));
      }
      return next;
    });
  };

  const handleBind = async () => {
    if (!selected || selectedShopCodes.size === 0) return;
    if (!window.confirm(`确认将 ${selectedShopCodes.size} 家店铺添加到「${selected.org_name}」的店铺范围吗？（店铺范围只影响查看权限：该组织及下级用户可见这些店铺的销售/报表/日志，不参与管理、审批与任务下发）`)) return;
    setBinding(true);
    try {
      const res = await bindOrgVisibleShops(selected.org_id, Array.from(selectedShopCodes));
      alert(`已添加到店铺范围：新增 ${res.inserted} 家，跳过 ${res.skipped} 家（已存在）`);
      setSelectedShopCodes(new Set());
      await load();
    } catch (e: any) {
      alert((e?.response?.data?.message || e?.message || '添加失败'));
    } finally {
      setBinding(false);
    }
  };

  // 店铺范围同步：把组织架构直属挂载店铺固化为店铺范围绑定（先预览再确认执行）
  const handleSyncShopScope = async () => {
    try {
      const prev = await previewShopScopeSync();
      if (!prev.ok) { alert('预览失败：' + (prev.error || '未知错误')); return; }
      const p = prev.plan || { directPlanned: 0, selfPlanned: 0 };
      const total = p.directPlanned + p.selfPlanned;
      if (total === 0) { alert('当前组织架构与店铺范围一致，无需同步'); return; }
      if (!window.confirm(`将从组织架构同步 ${p.directPlanned} 家直属挂载店铺 + ${p.selfPlanned} 家店铺自身到店铺范围（仅新增不覆盖，幂等可重复执行，用于补齐店铺范围）？`)) return;
      setSyncingScope(true);
      const res = await runShopScopeSync();
      if (!res.ok) { alert('同步失败：' + (res.error || '未知错误')); return; }
      alert(`店铺范围同步完成：新增直属挂载 ${res.result?.directInserted || 0} 家、店铺自身 ${res.result?.selfInserted || 0} 家（${res.warnings?.join('；') || ''}）`);
      await load();
    } catch (e: any) {
      alert((e?.response?.data?.message || e?.message || '同步失败'));
    } finally {
      setSyncingScope(false);
    }
  };

  // 解绑：树挂载叶子走软删；可见绑定走 org_shop_bind 删除
  const handleUnbind = async (shopNode: OrgNode) => {
    if (!window.confirm(`确定解绑店铺「${shopNode.org_name}」吗？解除后该店铺从组织树移除，用户绑定时将被拒绝。`)) return;
    try {
      await unbindShopOrg(shopNode.org_id);
      await load();
    } catch (e: any) {
      alert((e?.response?.data?.message || e?.message || '解绑失败'));
    }
  };

  const handleUnbindVisible = async (item: { shopCode: string; shopName: string }) => {
    if (!selected) return;
    if (!window.confirm(`确定解除「${selected.org_name}」对店铺「${item.shopName}」的可见绑定吗？`)) return;
    try {
      await unbindOrgVisibleShop(selected.org_id, [item.shopCode]);
      const res = await getOrgVisibleShops(selected.org_id);
      setVisibleBoundShops(Array.isArray(res && res.shops) ? res.shops : []);
    } catch (e: any) {
      alert((e?.response?.data?.message || e?.message || '解绑失败'));
    }
  };

  // ---- 用户归属（穿透）：只调 sys_user_role 的 org_id，用户表本身不动 ----
  const loadOrgUsers = useCallback(async (orgId: number) => {
    setOrgUsersLoading(true);
    try {
      const res = await getOrgUsers(orgId);
      setOrgEntries(Array.isArray(res.entries) ? res.entries : []);
      setOrgUserCount(res.userCount || 0);
      setOrgAggregated(!!res.autoAggregated);
      setOrgAggregatedWt(res.warehouseType || '');
    } catch (e: any) {
      console.error(e);
      alert('加载用户归属失败: ' + (e?.response?.data?.message || e.message));
    } finally {
      setOrgUsersLoading(false);
    }
  }, []);

  const openUserModal = async (node: OrgNode) => {
    setUserModalOrg(node);
    setUserModalOpen(true);
    setAdjustingId(null);
    setTargetOrgId('');
    setCandKw('');
    setCandidates([]);
    setPickUser(null);
    setPickRoleId('');
    await loadOrgUsers(node.org_id);
    if (allRoles.length === 0) {
      try {
        const res = await getRoles();
        setAllRoles(Array.isArray(res.roles) ? res.roles : []);
      } catch (e: any) {
        console.error(e);
      }
    }
  };

  const searchCandidates = async () => {
    setCandLoading(true);
    try {
      const res = await getPermUsers({ kw: candKw });
      setCandidates(Array.isArray(res.users) ? res.users : []);
    } catch (e: any) {
      console.error(e);
      alert('搜索用户失败');
    } finally {
      setCandLoading(false);
    }
  };

  const handleAddOrgUser = async () => {
    if (!userModalOrg || !pickUser || !pickRoleId) { alert('请先选择用户和角色'); return; }
    setAddingOrgUser(true);
    try {
      const res = await addOrgUser(userModalOrg.org_id, { userCode: pickUser.userCode, roleId: Number(pickRoleId) });
      alert(res.action === 'moved' ? `已将「${pickUser.userName}」该角色归属挪到本组织` : `已添加「${pickUser.userName}」到本组织`);
      setPickUser(null);
      setPickRoleId('');
      setCandKw('');
      setCandidates([]);
      await loadOrgUsers(userModalOrg.org_id);
      await load();
    } catch (e: any) {
      alert((e?.response?.data?.message || e.message || '添加失败'));
    } finally {
      setAddingOrgUser(false);
    }
  };

  const handleAdjustOrgUser = async (entryId: number) => {
    if (!userModalOrg) return;
    const target = targetOrgId === '' ? null : Number(targetOrgId);
    if (targetOrgId !== '' && !target) { alert('请选择目标组织'); return; }
    setSavingAdjust(true);
    try {
      await updateOrgUserOrg(userModalOrg.org_id, entryId, target);
      alert(target === null ? '已将该用户移出本组织（角色保留）' : '归属组织已调整');
      setAdjustingId(null);
      setTargetOrgId('');
      await loadOrgUsers(userModalOrg.org_id);
      await load();
    } catch (e: any) {
      alert((e?.response?.data?.message || e.message || '调整失败'));
    } finally {
      setSavingAdjust(false);
    }
  };

  const handleRemoveOrgUser = async (entry: any) => {
    if (!userModalOrg) return;
    if (!window.confirm(`确定彻底删除「${entry.user_name || entry.user_code}」的「${entry.role_name || ''}」归属记录吗？\n该用户的这条角色绑定将一并移除。`)) return;
    try {
      const res = await removeOrgUser(userModalOrg.org_id, entry.id);
      if (!res.deleted) { alert('未找到该归属记录，可能已被调整'); }
      await loadOrgUsers(userModalOrg.org_id);
      await load();
    } catch (e: any) {
      alert((e?.response?.data?.message || e.message || '删除失败'));
    }
  };

  // 组织架构归档同步：按所选业务线先预览（dryRun），确认后正式执行；后期新增店铺只需再点一次即可自动维护
  const handleSyncFromArchive = async () => {
    if (syncing) return;
    const cfg = SYNC_BIZ_LINES.find(c => c.label === syncBiz) || SYNC_BIZ_LINES[0];
    const parentNode = nodes.find(n => n.org_name === cfg.parentName && n.org_type === 'group');
    if (!parentNode) {
      alert(`未找到组织节点「${cfg.parentName}」，请检查组织框架`);
      return;
    }
    setSyncing(true);
    try {
      const payload = { parentOrgId: parentNode.org_id, warehouseType: cfg.warehouseType, dealerLevel: cfg.dealerLevel };
      const preview = await syncOrgFromArchive({ ...payload, dryRun: true });
      if (!preview.ok) {
        alert('预览失败：' + (preview.warnings?.map(w => w.text).join('\n') || '未知错误'));
        return;
      }
      const s = preview.summary ?? { areaManagers: 0, supervisors: 0, dealers: 0, shops: 0, usersMoved: 0, usersInserted: 0 };
      const warns = (preview.warnings || []).filter(w => w.level === 'warn').map(w => '· ' + w.text);
      const dlPart = cfg.dealerLevel ? `、经销商 ${s.dealers ?? 0} 个` : '';
      const msg = [
        `【预览】店铺档案（仓库类别=${preview.scope || cfg.warehouseType}）共 ${preview.shopTotal} 家店`,
        `将新增：区经 ${s.areaManagers} 个、督导 ${s.supervisors} 个${dlPart}、店铺 ${s.shops} 家`,
        `用户归属：迁移 ${s.usersMoved} 人次、补齐角色 ${s.usersInserted} 人次`,
        warns.length ? '\n提示：\n' + warns.join('\n') : '',
        `\n确认执行后将按店铺档案重建「${cfg.parentName}」下 ${cfg.levelDesc} 多层结构，并自动同步用户归属。后期新增店铺后再次点击本按钮即可自动维护。是否执行？`,
      ].join('\n');
      if (!window.confirm(msg)) return;

      const res = await syncOrgFromArchive({ ...payload, dryRun: false });
      if (!res.ok) {
        alert('同步失败，已回滚：\n' + (res.warnings?.map(w => w.text).join('\n') || ''));
        return;
      }
      const rs = res.summary;
      const info = (res.warnings || []).map(w => '· ' + w.text).join('\n');
      alert(
        `【执行完成】新增区经 ${rs?.areaManagers ?? 0} 个、督导 ${rs?.supervisors ?? 0} 个${dlPart}、店铺 ${rs?.shops ?? 0} 家；` +
        `迁移用户归属 ${rs?.usersMoved ?? 0} 人次、补齐角色 ${rs?.usersInserted ?? 0} 人次。` +
        (info ? '\n' + info : '')
      );
      await load();
      // 展开所选业务线整棵子树便于查看
      const gNode = nodes.find(n => n.org_name === cfg.parentName);
      if (gNode) {
        const sub = nodes.filter(n => n.ancestors?.includes(`/${gNode.org_id}/`) || n.org_id === gNode.org_id);
        setExpanded(prev => {
          const next = new Set(prev);
          sub.forEach(n => next.add(n.org_id));
          next.add(gNode.org_id);
          return next;
        });
        setSelectedId(gNode.org_id);
      }
    } catch (e: any) {
      alert('同步失败：' + (e?.response?.data?.error || e?.response?.data?.message || e.message));
    } finally {
      setSyncing(false);
    }
  };

  // 组织架构导出：下载 xlsx（含全部层级字段，可直接回导）
  const handleExportOrg = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { blob, filename } = await exportOrgArchive();
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

  // 组织架构导入：先 dryRun 预览（校验+计划），确认后正式执行；同文件重复导入幂等
  // mode=diff：以文件为准对比调整现有框架（新增/更新/删除文件外节点）
  // mode=replace：清除现有框架后按文件重建（删除文件外全部节点）
  const handleImportFile = async (file: File) => {
    if (importing) return;
    const mode = importMode;
    setImporting(true);
    try {
      const preview = await importOrgArchive(file, true, mode);
      if (!preview.ok) {
        const errs = (preview.errors || []).map(e => `第 ${e.row} 行：${e.text}`).join('\n');
        alert('导入文件校验未通过，未做任何写入：\n' + (errs || '文件无法解析'));
        return;
      }
      const s = preview.summary ?? { create: 0, update: 0, delete: 0, shops: 0, groups: 0 };
      const warns = (preview.warnings || []).filter(w => w.level === 'warn').map(w => '· ' + w.text);
      const delCount = s.delete ?? 0;
      const delBinds = (preview.willCleanUserBinds ?? 0) + (preview.willCleanShopBinds ?? 0);
      const isReplace = mode === 'replace';
      const actionName = (a: string) => (a === 'create' ? '新增' : a === 'delete' ? '删除' : '更新');
      const planBrief = preview.plan.slice(0, 10).map(p =>
        `${actionName(p.action)} ${p.orgName}（${p.orgType}${p.matchedOrgId ? `, id=${p.matchedOrgId}` : ''}${p.reason ? `：${p.reason}` : ''}）`
      ).join('\n');
      const more = preview.plan.length > 10 ? `\n……等共 ${preview.plan.length} 行` : '';
      const modeName = isReplace ? '清除重建' : '差异调整';
      const msg = [
        `【导入预览 · ${modeName}模式】文件共 ${preview.totalRows} 行`,
        `新增 ${s.create} 个、更新 ${s.update} 个、删除 ${delCount} 个（店铺 ${s.shops} 个、组织 ${s.groups} 个）`,
        isReplace
          ? '将清除现有框架中文件未包含的全部节点，再按文件重建；正式执行后与文件完全一致'
          : '以文件为准对比调整现有框架：仅对文件外的现有节点做删除，其余新增/更新',
        (delBinds > 0)
          ? `将被删除节点关联的 ${preview.willCleanUserBinds ?? 0} 条用户绑定、${preview.willCleanShopBinds ?? 0} 条店铺范围绑定一并清理`
          : '',
        warns.length ? '\n提示：\n' + warns.join('\n') : '',
        `\n预览明细：\n${planBrief}${more}`,
      ].join('\n');
      const confirmText = isReplace
        ? `${msg}\n\n【危险操作】将删除文件外 ${delCount} 个节点并重建框架，删除不可恢复。确认执行？`
        : `${msg}\n\n确认执行导入？`;
      if (!window.confirm(confirmText)) return;

      const res = await importOrgArchive(file, false, mode);
      if (!res.ok) {
        alert('导入失败，已整体回滚：\n' + (res.warnings?.map(w => w.text).join('\n') || ''));
        return;
      }
      const rs = res.summary;
      const info = (res.warnings || []).map(w => '· ' + w.text).join('\n');
      alert(
        `【导入完成 · ${modeName}模式】新增 ${rs?.create ?? 0} 个节点、更新 ${rs?.update ?? 0} 个节点、删除 ${rs?.delete ?? 0} 个节点。` +
        (info ? '\n' + info : '')
      );
      await load();
    } catch (e: any) {
      alert('导入失败：' + (e?.response?.data?.error || e?.response?.data?.message || e.message));
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  // 组织选项（层级缩进，供调整归属选择）
  const orgOptions = useMemo(() => {
    const byParent = new Map<number, any[]>();
    nodes.forEach(n => {
      const p = n.parent_org_id ?? 0;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p)!.push(n);
    });
    const list: { orgId: number; label: string; depth: number }[] = [];
    const walk = (parentId: number, depth: number) => {
      (byParent.get(parentId) || []).sort((a, b) => a.org_level - b.org_level || a.org_id - b.org_id).forEach((n: OrgNode) => {
        list.push({ orgId: n.org_id, label: `${n.org_name}${n.shop_code ? `（${n.shop_code}）` : ''}`, depth });
        walk(n.org_id, depth + 1);
      });
    };
    walk(0, 0);
    return list;
  }, [nodes]);

  const isShop = selected?.org_type === 'shop';

  return (
    <Layout title="组织管理" subtitle="调整组织框架、设定店铺归属（v3 组织树，重启不覆盖）">
      <div className="px-4">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* 左侧组织树 */}
          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <FolderTree size={18} className="text-blue-500" /> 组织框架
              </h3>
              <button onClick={load} disabled={loading} className="p-2 text-gray-400 hover:text-primary rounded-lg">
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              </button>
              <select
                value={syncBiz}
                onChange={e => setSyncBiz(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 bg-white focus:outline-none focus:border-primary"
                title="选择要同步的业务线（区经/督导/经销商均按店铺档案匹配）"
              >
                {SYNC_BIZ_LINES.map(c => (
                  <option key={c.label} value={c.label}>{c.label}</option>
                ))}
              </select>
              <button
                onClick={handleSyncFromArchive}
                disabled={syncing}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                title={`按店铺档案自动维护所选业务线（${SYNC_BIZ_LINES.find(c => c.label === syncBiz)?.levelDesc}；先预览后执行，后期新增店铺后再次点击即可自动同步）`}
              >
                <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
                {syncing ? '同步中' : '归档同步'}
              </button>
              <button
                onClick={handleExportOrg}
                disabled={exporting}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50 transition-colors"
                title="导出组织架构为 xlsx（含全部层级字段，可直接回导）"
              >
                <Download size={13} className={exporting ? 'animate-pulse' : ''} />
                {exporting ? '导出中' : '导出'}
              </button>
              <label
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200"
                title="导入模式：差异调整=对比现有框架增/改/删，最终与文件一致；清除重建=删除现有框架后按文件重建"
              >
                <select
                  value={importMode}
                  onChange={e => setImportMode(e.target.value as 'diff' | 'replace')}
                  disabled={importing}
                  className="bg-transparent outline-none cursor-pointer text-xs"
                >
                  <option value="diff">差异调整</option>
                  <option value="replace">清除重建</option>
                </select>
              </label>
              <button
                onClick={() => importFileRef.current?.click()}
                disabled={importing}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-50 transition-colors"
                title={`导入组织架构（xlsx，先预览校验后确认执行；当前模式：${importMode === 'replace' ? '清除重建' : '差异调整'}，最终与文件一致）`}
              >
                <Upload size={13} className={importing ? 'animate-pulse' : ''} />
                {importing ? '导入中' : '导入'}
              </button>
              <input
                ref={importFileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleImportFile(f);
                }}
              />
            </div>
            <div className="flex items-center flex-wrap gap-1.5 mb-2">
              <button
                onClick={collapseAll}
                className="px-2 py-1 rounded-md text-[11px] font-medium border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
                title="折叠全部层级"
              >
                全部收起
              </button>
              {[1, 2, 3, 4, 5].map(lv => (
                <button
                  key={lv}
                  onClick={() => expandToLevel(lv)}
                  className="px-2 py-1 rounded-md text-[11px] font-medium border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                  title={`展开到第 ${lv} 层`}
                >
                  展开{lv}层
                </button>
              ))}
              <button
                onClick={expandAll}
                className="px-2 py-1 rounded-md text-[11px] font-medium border border-blue-500 bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                title="展开全部层级"
              >
                展开全部
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {loading && nodes.length === 0 ? (
                <div className="py-10 text-center text-gray-400">加载中...</div>
              ) : renderTree(0, 0)}
            </div>
          </div>

          {/* 右侧详情 */}
          <div className="lg:col-span-3 space-y-4">
            {!selected ? (
              <div className="bg-white rounded-xl shadow-sm p-10 text-center text-gray-400">选择左侧组织节点查看详情</div>
            ) : (
              <>
                {/* 基本信息 */}
                <div className="bg-white rounded-xl shadow-sm p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        {isShop ? <Store size={18} className="text-pink-500" /> : <Building size={18} className="text-blue-500" />}
                        {selected.org_name}
                      </h3>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${ORG_TYPE_COLORS[selected.org_type] || 'bg-gray-100 text-gray-500'}`}>
                          {ORG_TYPE_LABELS[selected.org_type] || selected.org_type}
                        </span>
                        {selected.warehouse_type && (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">仓库类别：{selected.warehouse_type}</span>
                        )}
                        {selected.shop_code && (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-pink-50 text-pink-600">店铺代码：{selected.shop_code}</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3 text-xs text-gray-600">
                        <div>业务线：<span className="text-gray-800">{selected.business_line || '-'}</span></div>
                        <div>职能线：<span className="text-gray-800">{selected.function_line || '-'}</span></div>
                        <div>组织编码：<span className="text-gray-800">{selected.org_code || '-'}</span></div>
                        <div>层级：<span className="text-gray-800">L{selected.org_level}</span></div>
                        <button
                          onClick={() => openUserModal(selected)}
                          title="点击调整该组织的用户归属"
                          className="text-left hover:text-primary transition-colors"
                        >
                          绑定用户：<span className="text-gray-800 font-medium">{selected.userCount || 0} 人</span>
                        </button>
                      </div>
                    </div>
                    {!isShop && (
                      <div className="flex flex-col gap-2">
                        <button onClick={() => openAdd(selected)} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-sm rounded-lg hover:bg-primary/90">
                          <Plus size={15} /> 新增下级
                        </button>
                        <div className="flex gap-2">
                          <button onClick={() => openEdit(selected)} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 text-sm rounded-lg hover:bg-blue-100">
                            <Edit2 size={15} /> 编辑
                          </button>
                          <button
                            onClick={() => { setShowMove(true); setMoveTarget(null); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-50 text-cyan-600 text-sm rounded-lg hover:bg-cyan-100"
                          >
                            <ArrowRightLeft size={15} /> 移动
                          </button>
                          <button
                            onClick={() => handleDelete(selected)}
                            disabled={selected.org_type === 'company'}
                            title={selected.org_type === 'company' ? '公司根节点不可删除' : '删除该组织'}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-500 text-sm rounded-lg hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Trash2 size={15} /> 删除
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 店铺归属管理（非店铺节点）：所属店铺=管理层级；店铺范围=查看权限 */}
                {!isShop && (
                  <div className="bg-white rounded-xl shadow-sm p-4">
                    <h3 className="font-semibold text-gray-800 flex items-center gap-2 mb-3">
                      <MapPin size={18} className="text-green-500" /> 店铺管理（{selected.org_name}）
                    </h3>
                    <div className="text-xs text-gray-500 bg-blue-50/60 border border-blue-100 rounded-lg p-2.5 mb-4">
                      两个概念相互独立：<span className="text-pink-600 font-medium">所属店铺</span>（组织树挂载）表达管理层级——管理、审批、调整、下发任务等运营关系，由组织框架解决；<span className="text-green-600 font-medium">店铺范围</span>只影响查看权限——该组织及下级用户可查看这些店铺的销售/报表/日志，<span className="text-green-700">不参与任何管理、审批、任务</span>。
                    </div>

                    {/* 已绑定/已配置 */}
                    <div className="mb-4">
                      {boundShopNodes.length === 0 && visibleBoundShops.length === 0 ? (
                        <div className="text-xs text-gray-400 bg-gray-50 rounded-lg p-3">该组织暂无所属店铺，请在下方搜索添加</div>
                      ) : (
                        <>
                          {visibleBoundShops.length > 0 && (
                            <div className="mb-4">
                              <div className="flex items-center justify-between mb-2">
                                <div className="text-sm font-medium text-green-700">店铺范围（{visibleBoundShops.length}）——查看权限，不参与管理/审批</div>
                                <button
                                  onClick={handleSyncShopScope}
                                  disabled={syncingScope}
                                  className="flex items-center gap-1 px-2.5 py-1 bg-green-50 text-green-600 text-xs rounded-lg hover:bg-green-100 disabled:opacity-50"
                                  title="把组织架构树直属挂载店铺固化为店铺范围（幂等，仅新增不覆盖）"
                                >
                                  <RefreshCw size={13} className={syncingScope ? 'animate-spin' : ''} /> 从组织架构同步店铺范围
                                </button>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {visibleBoundShops.map((v) => (
                                  <div key={'vb-' + v.shopCode} className="flex items-center justify-between bg-green-50/70 border border-green-100 rounded-lg px-3 py-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <Store size={14} className="text-green-600 flex-shrink-0" />
                                      <span className="text-sm text-gray-800 truncate">{v.shopName}</span>
                                      {v.shopCode && <span className="text-[10px] text-gray-400 flex-shrink-0">{v.shopCode}</span>}
                                    </div>
                                    <button onClick={() => handleUnbindVisible(v)} className="text-red-400 hover:text-red-600 p-1" title="移出店铺范围（仅影响查看，不影响管理层级）">
                                      <Unlink size={14} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {boundShopNodes.length > 0 && (
                            <div>
                              <div className="text-sm font-medium text-pink-700 mb-2">所属店铺（{boundShopNodes.length}）——管理层级：管理/审批/任务下发</div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {boundShopNodes.map((s) => (
                                  <div key={s.org_id} className="flex items-center justify-between bg-pink-50/60 border border-pink-100 rounded-lg px-3 py-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <Store size={14} className="text-pink-500 flex-shrink-0" />
                                      <span className="text-sm text-gray-800 truncate">{s.org_name}</span>
                                      {s.shop_code && <span className="text-[10px] text-gray-400 flex-shrink-0">{s.shop_code}</span>}
                                    </div>
                                    <button onClick={() => handleUnbind(s)} className="text-red-400 hover:text-red-600 p-1" title="解除所属店铺（组织树挂载，即解除管理层级，同时需注意其店铺范围绑定）">
                                      <Unlink size={14} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* 搜索与添加（添加到店铺范围） */}
                    <div>
                      <div className="text-sm font-medium text-gray-600 mb-2">从店仓全搜索添加到「店铺范围」</div>
                      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 mb-3">
                        <div className="relative col-span-2 md:col-span-1">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            value={shopSearch}
                            onChange={(e) => setShopSearch(e.target.value)}
                            placeholder="搜索店铺代码/名称..."
                            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/30 outline-none"
                          />
                        </div>
                        <select
                          value={shopSupervisor}
                          onChange={(e) => setShopSupervisor(e.target.value)}
                          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                        >
                          <option value="">全部督导</option>
                          {filterOptions.supervisors.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                        <select
                          value={shopAreaManager}
                          onChange={(e) => setShopAreaManager(e.target.value)}
                          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                        >
                          <option value="">全部区经</option>
                          {filterOptions.areaManagers.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                        <select
                          value={shopDealer}
                          onChange={(e) => setShopDealer(e.target.value)}
                          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                        >
                          <option value="">全部经销商</option>
                          {filterOptions.dealers.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                        <select
                          value={shopArea}
                          onChange={(e) => setShopArea(e.target.value)}
                          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                        >
                          <option value="">全部区域</option>
                          {filterOptions.areas.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                        <select
                          value={shopWarehouseType}
                          onChange={(e) => setShopWarehouseType(e.target.value)}
                          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                        >
                          <option value="">全部仓库类别</option>
                          {filterOptions.warehouseTypes.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                        <button onClick={searchShops} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 col-span-2 md:col-span-1">
                          查询
                        </button>
                      </div>

                      <div className="max-h-52 overflow-auto border border-gray-100 rounded-lg">
                        {shopLoading ? (
                          <div className="p-6 text-center text-gray-400 text-sm">搜索中...</div>
                        ) : shops.length === 0 ? (
                          <div className="p-6 text-center text-gray-400 text-sm">无店铺，可输入关键词查询（最多 500 条）</div>
                        ) : (
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr>
                                <th className="w-9 px-2 py-2">
                                  <input
                                    type="checkbox"
                                    checked={allShopSelected}
                                    disabled={selectableShops.length === 0}
                                    onChange={handleToggleSelectAll}
                                    title={allShopSelected ? '取消全选当前结果' : '全选当前结果'}
                                    className="w-4 h-4 rounded border-gray-300 accent-blue-600 cursor-pointer disabled:cursor-not-allowed"
                                  />
                                </th>
                                <th className="px-2 py-2 text-left font-medium text-gray-600 whitespace-nowrap">店铺名称</th>
                                <th className="px-2 py-2 text-left font-medium text-gray-600 whitespace-nowrap">代码</th>
                                <th className="px-2 py-2 text-left font-medium text-gray-600 whitespace-nowrap">督导</th>
                                <th className="px-2 py-2 text-left font-medium text-gray-600 whitespace-nowrap">区经</th>
                                <th className="px-2 py-2 text-left font-medium text-gray-600 whitespace-nowrap">经销商</th>
                                <th className="px-2 py-2 text-left font-medium text-gray-600 whitespace-nowrap">区域</th>
                                <th className="px-2 py-2 text-left font-medium text-gray-600 whitespace-nowrap">仓库类别</th>
                                <th className="px-2 py-2 text-left font-medium text-gray-600 whitespace-nowrap">归属状态</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {shops.map((s) => {
                                const rowSelected = selectedShopCodes.has(s.shopCode);
                                const rowDisabled = !!s.visibleBound;
                                return (
                                <tr
                                  key={s.shopCode}
                                  onClick={() => { if (!rowDisabled) toggleShopSelect(s.shopCode); }}
                                  className={[
                                    rowDisabled
                                      ? 'bg-gray-50 opacity-55 cursor-not-allowed'
                                      : (rowSelected ? 'bg-blue-100/70 hover:bg-blue-100' : 'hover:bg-blue-50'),
                                    'cursor-pointer transition-colors',
                                  ].filter(Boolean).join(' ')}
                                >
                                  <td className="px-2 py-1.5">
                                    <input
                                      type="checkbox"
                                      checked={rowSelected}
                                      disabled={rowDisabled}
                                      onChange={() => toggleShopSelect(s.shopCode)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-4 h-4 rounded border-gray-300 accent-blue-600 cursor-pointer disabled:cursor-not-allowed"
                                    />
                                  </td>
                                  <td className="px-2 py-1.5 text-gray-800 max-w-[180px] truncate" title={s.shopName}>{s.shopName}</td>
                                  <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{s.shopCode}</td>
                                  <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{s.supervisor || '-'}</td>
                                  <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{s.areaManager || '-'}</td>
                                  <td className="px-2 py-1.5 text-gray-500 max-w-[140px] truncate" title={s.dealer}>{s.dealer || '-'}</td>
                                  <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{s.area || '-'}</td>
                                  <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{s.warehouseType || '-'}</td>
                                  <td className="px-2 py-1.5">
                                    {s.visibleBound ? (
                                      <span className="text-[10px] text-green-600 bg-green-50 rounded-full px-2 py-0.5 whitespace-nowrap">已在店铺范围</span>
                                    ) : s.boundOrgId ? (
                                      <span className="text-[10px] text-amber-600 bg-amber-50 rounded-full px-2 py-0.5 whitespace-nowrap" title="店铺已作为所属店铺挂在其他组织下（管理层级），不影响本组织店铺范围">所属：{s.boundOrgName}（可加）</span>
                                    ) : (
                                      <span className="text-[10px] text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">未配置</span>
                                    )}
                                  </td>
                                </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={handleToggleSelectAll}
                            disabled={selectableShops.length === 0}
                            className={[
                              'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium border-2 transition-colors',
                              allShopSelected
                                ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
                                : 'border-blue-600 bg-blue-50 text-blue-600 hover:bg-blue-100',
                              'disabled:opacity-40 disabled:cursor-not-allowed',
                            ].join(' ')}
                          >
                            <CheckSquare size={14} />
                            {allShopSelected ? '取消全选' : '全选'}
                          </button>
                          <span className="text-xs text-gray-500">共 {shops.length} 家，可选 {selectableShops.length} 家，已选 {selectedShopCodes.size} 家</span>
                        </div>
                        <button
                          onClick={handleBind}
                          disabled={selectedShopCodes.size === 0 || binding}
                          className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-40"
                        >
                          {binding ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
                          添加到店铺范围
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* 新增/编辑弹窗 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">{editing ? '编辑组织' : '新增组织'}</h3>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">上级组织</label>
                <div className="px-3 py-2 bg-gray-50 rounded-lg text-sm text-gray-700">
                  {formParentId ? nodeById.get(formParentId)?.org_name || formParentId : '-'}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">组织名称 <span className="text-red-500">*</span></label>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/30 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">组织类型</label>
                <select value={formType} onChange={(e) => setFormType(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                  {Object.entries(ORG_TYPE_LABELS).filter(([k]) => k !== 'shop').map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">业务线</label>
                  <input value={formBusinessLine} onChange={(e) => setFormBusinessLine(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">职能线</label>
                  <input value={formFunctionLine} onChange={(e) => setFormFunctionLine(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">仓库类别</label>
                  <input value={formWarehouseType} onChange={(e) => setFormWarehouseType(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">组织编码</label>
                  <input value={formOrgCode} onChange={(e) => setFormOrgCode(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">取消</button>
              <button onClick={handleSaveForm} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} 保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 移动弹窗 */}
      {showMove && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">移动「{selected.org_name}」</h3>
              <button onClick={() => setShowMove(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">目标上级组织</label>
              <select value={moveTarget ?? ''} onChange={(e) => setMoveTarget(Number(e.target.value))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                <option value="">请选择...</option>
                {nodes.filter(n => n.org_type !== 'shop' && n.org_id !== selected.org_id).map(n => (
                  <option key={n.org_id} value={n.org_id}>{'　'.repeat(Math.max(0, n.org_level - 1))}{n.org_name}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-2">移动后其名下所有下级组织与店铺同步调整层级；不能移动到自身或自己的下级。</p>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowMove(false)} className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">取消</button>
              <button onClick={handleMove} disabled={!moveTarget || moving} className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-50">
                {moving ? <Loader2 size={16} className="animate-spin" /> : <ArrowRightLeft size={16} />} 确认移动
              </button>
            </div>
          </div>
        </div>
      )}
    {/* 用户归属弹窗（人头/人数穿透） */}
      {userModalOpen && userModalOrg && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <User size={18} className="text-amber-500" /> 用户归属：{userModalOrg.org_name}
                <span className="text-xs font-normal text-gray-400">
                  {orgAggregated
                    ? `（${orgUserCount} 人，按店铺自动匹配${orgAggregatedWt ? ` · ${orgAggregatedWt}` : ''}）`
                    : `（${orgUserCount} 人 / ${orgEntries.length} 条角色绑定）`}
                </span>
              </h3>
              <button onClick={() => setUserModalOpen(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
            </div>
            {orgAggregated ? (
              <p className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-3">
                该门店组的归属用户按「门店组业务线下店铺名称 ↔ 用户管理「组织」列」自动匹配汇总，随店铺/用户变动实时更新，无需手动维护；
                此处为只读视图，不可添加/调整/删除（避免破坏店长店员按本店的数据隔离权限）。
              </p>
            ) : (
              <p className="text-xs text-gray-400 mb-3">
                此操作只调整用户与组织的<strong>归属关系</strong>（角色绑定数据），不会修改用户表资料。移出组织后用户仍保留角色，可重新归属。
              </p>
            )}

            {/* 已归属用户列表 */}
            <div className="text-sm font-medium text-gray-600 mb-2">已归属用户</div>
            <div className="max-h-48 overflow-auto border border-gray-100 rounded-lg mb-4">
              {orgUsersLoading ? (
                <div className="p-6 text-center text-gray-400 text-sm">加载中...</div>
              ) : orgEntries.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-sm">{orgAggregated ? '该门店组业务线下无匹配用户' : '该组织下暂无用户归属，可在下方添加'}</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">用户</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">手机号</th>
                      {orgAggregated && <th className="px-3 py-2 text-left font-medium text-gray-600">匹配店铺</th>}
                      <th className="px-3 py-2 text-left font-medium text-gray-600">角色</th>
                      {!orgAggregated && <th className="px-3 py-2 text-left font-medium text-gray-600">数据范围</th>}
                      {!orgAggregated && <th className="px-3 py-2 text-left font-medium text-gray-600 w-64">操作</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {orgEntries.map((en: any) => (
                      <tr key={en.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <div className="text-gray-800 font-medium">{en.user_name || '-'}</div>
                          <div className="text-[10px] text-gray-400">{en.user_code}</div>
                        </td>
                        <td className="px-3 py-2 text-gray-500">{en.phone || '-'}</td>
                        {orgAggregated && <td className="px-3 py-2 text-gray-500">{en.store_name || '-'}</td>}
                        <td className="px-3 py-2 text-gray-500">{orgAggregated ? (en.role_name || '按门店自动匹配') : (en.role_name || '-')}</td>
                        {!orgAggregated && (
                          <td className="px-3 py-2 text-gray-500">{en.data_scope ? (DATA_SCOPE_LABELS[en.data_scope] || en.data_scope) : (en.default_data_scope ? (DATA_SCOPE_LABELS[en.default_data_scope] || en.default_data_scope) : '-')}</td>
                        )}
                        {!orgAggregated && (
                          <td className="px-3 py-2">
                            {adjustingId === en.id ? (
                              <div className="flex items-center gap-1.5">
                                <select
                                  value={targetOrgId}
                                  onChange={(e) => setTargetOrgId(e.target.value)}
                                  className="px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white"
                                >
                                  <option value="">（移出本组织）</option>
                                  {orgOptions.map(o => (
                                    <option key={o.orgId} value={o.orgId}>{'　'.repeat(o.depth)}{o.label}</option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => handleAdjustOrgUser(en.id)}
                                  disabled={savingAdjust}
                                  className="px-2 py-1 bg-primary text-white text-xs rounded-lg hover:bg-primary/90 disabled:opacity-50"
                                >
                                  保存
                                </button>
                                <button
                                  onClick={() => { setAdjustingId(null); setTargetOrgId(''); }}
                                  className="px-2 py-1 border border-gray-200 text-xs rounded-lg hover:bg-gray-50"
                                >
                                  取消
                                </button>
                              </div>
                            ) : (
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => { setAdjustingId(en.id); setTargetOrgId(''); }}
                                  className="px-2 py-1 bg-cyan-50 text-cyan-600 text-xs rounded-lg hover:bg-cyan-100"
                                >
                                  调整归属
                                </button>
                                <button
                                  onClick={() => handleRemoveOrgUser(en)}
                                  className="px-2 py-1 bg-red-50 text-red-500 text-xs rounded-lg hover:bg-red-100"
                                >
                                  删除
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* 添加用户（门店组聚合节点只读，隐藏添加操作） */}
            {!orgAggregated && (
            <>
            <div className="text-sm font-medium text-gray-600 mb-2">添加用户到本组织</div>
            <div className="flex gap-2 mb-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={candKw}
                  onChange={(e) => setCandKw(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') searchCandidates(); }}
                  placeholder="搜索工号/姓名/手机号..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/30 outline-none"
                />
              </div>
              <button onClick={searchCandidates} disabled={candLoading} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">
                {candLoading ? '搜索中...' : '搜索'}
              </button>
            </div>
            {candidates.length > 0 && (
              <div className="max-h-36 overflow-auto border border-gray-100 rounded-lg mb-2">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="w-8 px-2 py-1.5"></th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-600">用户</th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-600">手机号</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {candidates.map((c: any) => (
                      <tr key={c.userCode} className={`hover:bg-gray-50 cursor-pointer ${pickUser?.userCode === c.userCode ? 'bg-primary/5' : ''}`} onClick={() => setPickUser(c)}>
                        <td className="px-2 py-1.5">
                          <input type="radio" checked={pickUser?.userCode === c.userCode} onChange={() => setPickUser(c)} className="accent-[var(--primary,#2563eb)]" />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="text-gray-800">{c.userName}</div>
                          <div className="text-[10px] text-gray-400">{c.userCode}</div>
                        </td>
                        <td className="px-2 py-1.5 text-gray-500">{c.phone || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center gap-3 mt-1">
              <select
                value={pickRoleId}
                onChange={(e) => setPickRoleId(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
              >
                <option value="">选择角色...</option>
                {allRoles.map(r => <option key={r.role_id} value={r.role_id}>{r.role_name}</option>)}
              </select>
              <button
                onClick={handleAddOrgUser}
                disabled={!pickUser || !pickRoleId || addingOrgUser}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-40"
              >
                {addingOrgUser ? <Loader2 size={15} className="animate-spin" /> : <User size={15} />}
                添加到本组织
              </button>
            </div>
            </>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}

export default OrgManagePage;