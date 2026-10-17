// ============================================================
// 组织架构导出 / 导入服务
// 导出：将 sys_org 全量（del_flag=0）导出为 xlsx，列与 sys_org 关键字段一一对应，可直接回导。
// 导入：解析 xlsx → 逐行校验（必填/类型/枚举/存在性/环检测）→ 按 org_id / 唯一键判重
//       （新增-更新判定，幂等复用）→ 事务内落库 → 全树重建 ancestors/org_level。
// 两种模式（以最新文件为最终目标态，保证导入后与文件一致）：
//   - diff   （默认，差异调整）：文件的增/改生效；文件之外现有节点软删（del_flag=1），老框架向新文件对齐
//   - replace（清除重建）：同 diff 的“文件即真源”对齐，但额外强制要求文件包含根节点（防误清空整棵树），
//             并更醒目地提示将被清理的绑定数量；文件 org_id 命中的软删节点直接复活复用（保留用户/店铺范围绑定）
// 安全：不物理删数据（统一软删）；dryRun 只算计划不落库；失败事务回滚；悬空绑定（指向被删组织的
//       sys_user_role / org_shop_bind）在导入事务内一并清理。
// 幂等：重复导入同一文件不产生重复节点（已存在的按 org_id 更新，缺失 id 的新增行按唯一键复用）。
// ============================================================
import sql from 'mssql';
import * as XLSX from 'xlsx';

export const ORG_TYPES = ['company', 'director', 'group', 'supervisor_group', 'dealer_group', 'shop_group', 'shop'] as const;

export type ImportMode = 'diff' | 'replace';

export interface ExportResult {
  filename: string;
  buffer: Buffer;
  rowCount: number;
}

export interface ImportWarn { level: 'warn' | 'info'; text: string }
export interface ImportError { row: number; text: string }
export interface ImportPlanRow {
  orgId: string;            // 文件内 org_id（空=新增/自增；delete 行=库节点 id）
  orgName: string; orgType: string; parentOrgId: string; status: number;
  action: 'create' | 'update' | 'delete';
  matchedOrgId?: number;    // 命中库中已有节点（update 时落库目标 id）
  reason?: string;
}
export interface ImportResult {
  ok: boolean;
  dryRun: boolean;
  mode: ImportMode;
  totalRows: number;
  errors: ImportError[];
  warnings: ImportWarn[];
  plan: ImportPlanRow[];
  willCleanUserBinds: number;  // 指向将被删除组织的用户绑定条数（前瞻/实际清理数）
  willCleanShopBinds: number;  // 指向将被删除组织的店铺范围绑定条数
  summary?: { create: number; update: number; delete: number; shops: number; groups: number };
}

// ---------------- 导出 ----------------
export async function exportOrgToXlsx(pool: sql.ConnectionPool): Promise<ExportResult> {
  const r = await pool.request().query(`
    SELECT org_id, parent_org_id, org_name, org_type, org_level, ancestors,
           warehouse_type, business_line, function_line, org_code, shop_code, shop_name, status
    FROM sys_org WHERE del_flag = 0
    ORDER BY org_level, ancestors, org_id`);
  const rows = r.recordset.map(x => ({
    org_id: x.org_id, parent_org_id: x.parent_org_id ?? '',
    org_name: x.org_name ?? '', org_type: x.org_type ?? '',
    org_level: x.org_level ?? '', ancestors: x.ancestors ?? '',
    warehouse_type: x.warehouse_type ?? '', business_line: x.business_line ?? '',
    function_line: x.function_line ?? '', org_code: x.org_code ?? '',
    shop_code: x.shop_code ?? '', shop_name: x.shop_name ?? '',
    status: x.status ?? 1,
  }));
  const header = [
    'org_id', 'parent_org_id', 'org_name', 'org_type', 'org_level', 'ancestors',
    'warehouse_type', 'business_line', 'function_line', 'org_code', 'shop_code', 'shop_name', 'status',
  ];
  const aoa = [header, ...rows.map(x => header.map(h => x[h as keyof typeof x]))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 8 }, { wch: 14 }, { wch: 30 }, { wch: 16 }, { wch: 9 }, { wch: 26 },
    { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 8 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '组织架构');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const dateStr = new Date().toISOString().slice(0, 10);
  return { filename: `组织架构_${dateStr}.xlsx`, buffer: buf, rowCount: rows.length };
}

// ---------------- 导入 ----------------
interface RawRow { [key: string]: any }

/** 表头别名归一：支持英文列名与常见中文表头 */
const HEADER_ALIAS: Record<string, string> = {
  org_id: 'org_id', 组织ID: 'org_id', 节点ID: 'org_id',
  parent_org_id: 'parent_org_id', 上级组织ID: 'parent_org_id', 父组织ID: 'parent_org_id', 上级ID: 'parent_org_id',
  org_name: 'org_name', 组织名称: 'org_name', 节点名称: 'org_name', 名称: 'org_name',
  org_type: 'org_type', 组织类型: 'org_type', 类型: 'org_type',
  org_level: 'org_level', 层级: 'org_level', 组织层级: 'org_level',
  ancestors: 'ancestors', 祖先链: 'ancestors', 上级链: 'ancestors',
  warehouse_type: 'warehouse_type', 仓库类别: 'warehouse_type', 仓库类型: 'warehouse_type',
  business_line: 'business_line', 业务线: 'business_line',
  function_line: 'function_line', 职能线: 'function_line',
  org_code: 'org_code', 组织编码: 'org_code', 编码: 'org_code',
  shop_code: 'shop_code', 店铺代码: 'shop_code', 店仓编码: 'shop_code',
  shop_name: 'shop_name', 店铺名称: 'shop_name', 店仓名称: 'shop_name',
  status: 'status', 状态: 'status',
};

const normHeader = (h: any): string => {
  const s = String(h ?? '').trim();
  return HEADER_ALIAS[s] || s;
};

const toNum = (v: any): number | null | 'BAD' => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : 'BAD';
};

interface FileRow {
  row: number;
  orgId: number | null;
  parentOrgId: number | null;
  orgName: string;
  orgType: string;
  warehouseType: string;
  businessLine: string;
  functionLine: string;
  orgCode: string;
  shopCode: string;
  shopName: string;
  status: number;
}

/** 唯一键（新增判重/幂等复用）：shop 用 parent+shop_code，其余用 parent+name+type */
const uniqKey = (f: { parentOrgId: number | null; orgName: string; orgType: string; shopCode: string }) =>
  f.orgType === 'shop'
    ? `shop|${f.parentOrgId ?? 'NULL'}|${f.shopCode}`
    : `${f.orgType}|${f.parentOrgId ?? 'NULL'}|${f.orgName}`;

export async function importOrgFromXlsx(pool: sql.ConnectionPool, buffer: Buffer, opts: { dryRun?: boolean; mode?: ImportMode } = {}): Promise<ImportResult> {
  const dryRun = !!opts.dryRun;
  const mode: ImportMode = opts.mode === 'replace' ? 'replace' : 'diff';
  const result: ImportResult = { ok: false, dryRun, mode, totalRows: 0, errors: [], warnings: [], plan: [], willCleanUserBinds: 0, willCleanShopBinds: 0 };

  // ---- 1) 解析 xlsx ----
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'buffer' });
  } catch (e: any) {
    result.errors.push({ row: 0, text: '文件解析失败，请使用「导出组织架构」生成的 xlsx 文件（或兼容格式）：' + String(e?.message || e) });
    return result;
  }
  const wsName = wb.SheetNames?.[0];
  if (!wsName) {
    result.errors.push({ row: 0, text: '文件中没有工作表' });
    return result;
  }
  const ws = wb.Sheets[wsName];
  const sheetRows = XLSX.utils.sheet_to_json<RawRow>(ws, { defval: '' });
  if (sheetRows.length === 0) {
    result.errors.push({ row: 0, text: '工作表为空，没有可导入的数据行' });
    return result;
  }

  // 归一化列名
  const items: RawRow[] = sheetRows.map((raw, idx) => {
    const norm: RawRow = {};
    for (const k of Object.keys(raw)) {
      const nk = normHeader(k);
      if (norm[nk] === undefined) norm[nk] = raw[k];
    }
    norm['__row'] = idx + 2; // 表头占第 1 行，数据从第 2 行起
    return norm;
  });
  result.totalRows = items.length;

  // ---- 2) 逐行校验 ----
  const err = (row: number, text: string) => result.errors.push({ row, text });
  const fileRows: FileRow[] = [];
  const seenOrgId = new Map<number, number>(); // org_id -> 行号

  for (const it of items) {
    const row = it['__row'];
    const orgName = String(it['org_name'] ?? '').trim();
    if (!orgName) { err(row, 'org_name(组织名称) 不能为空'); continue; }

    const orgType = String(it['org_type'] ?? '').trim();
    if (!orgType) { err(row, 'org_type(组织类型) 不能为空'); continue; }
    if (!(ORG_TYPES as readonly string[]).includes(orgType)) {
      err(row, `org_type(组织类型) 非法：「${orgType}」，可选：${ORG_TYPES.join(' / ')}`); continue;
    }

    const orgIdN = toNum(it['org_id']);
    if (orgIdN === 'BAD') { err(row, 'org_id(组织ID) 必须是正整数或空'); continue; }
    const orgId = orgIdN as number | null;
    if (orgId !== null) {
      const dup = seenOrgId.get(orgId);
      if (dup) { err(row, `org_id(组织ID) ${orgId} 与第 ${dup} 行重复`); continue; }
      seenOrgId.set(orgId, row);
    }

    const parentN = toNum(it['parent_org_id']);
    if (parentN === 'BAD') { err(row, 'parent_org_id(上级组织ID) 必须是正整数或空'); continue; }
    const parentOrgId = parentN as number | null;

    // 仅校验层级/祖先链格式（值以重建为准）
    const lvlRaw = String(it['org_level'] ?? '').trim();
    const ancRaw = String(it['ancestors'] ?? '').trim();
    if (!(lvlRaw === '' || /^\d+$/.test(lvlRaw))) err(row, 'org_level(层级) 必须是正整数或空');
    if (!(ancRaw === '' || ancRaw === '/' || /^\/\d+(\/\d+)*\/$/.test(ancRaw))) err(row, 'ancestors(祖先链) 格式非法（应为 /1/2/ 形式或空）');

    const statusN = toNum(it['status']);
    if (statusN === 'BAD') { err(row, 'status(状态) 必须是正整数或空'); continue; }
    const status = (statusN as number | null) ?? 1;

    fileRows.push({
      row, orgId, parentOrgId, orgName, orgType,
      warehouseType: String(it['warehouse_type'] ?? '').trim(),
      businessLine: String(it['business_line'] ?? '').trim(),
      functionLine: String(it['function_line'] ?? '').trim(),
      orgCode: String(it['org_code'] ?? '').trim(),
      shopCode: String(it['shop_code'] ?? '').trim(),
      shopName: String(it['shop_name'] ?? '').trim(),
      status,
    });
  }
  if (result.errors.length > 0) {
    result.warnings.push({ level: 'warn', text: `发现 ${result.errors.length} 处校验错误，未做任何写入（请修正后重试）` });
    return result;
  }

  // ---- 3) 库中现有节点快照 ----
  const dbRes = await pool.request().query(`
    SELECT org_id, parent_org_id, org_name, org_type, shop_code, status, del_flag
    FROM sys_org`);
  const dbById = new Map<number, any>();
  const keyToDb = new Map<string, any>(); // 唯一键 -> 存活节点（del_flag=0）
  for (const x of dbRes.recordset) {
    dbById.set(x.org_id, x);
    if (x.del_flag === 0) {
      const k = x.org_type === 'shop'
        ? `shop|${x.parent_org_id ?? 'NULL'}|${x.shop_code ?? ''}`
        : `${x.org_type}|${x.parent_org_id ?? 'NULL'}|${x.org_name ?? ''}`;
      if (!keyToDb.has(k)) keyToDb.set(k, x);
    }
  }

  // ---- 4) 新增/更新判定 + 父存在性校验 ----
  // fileIdMap: 文件内 org_id -> 落库目标 id（update 行=自身 id；create 行=待分配后回填）
  const fileIdMap = new Map<number, number>();
  const planOf = new Map<number, ImportPlanRow>(); // row -> plan

  for (const f of fileRows) {
    const dbHit = f.orgId !== null ? dbById.get(f.orgId) : undefined;
    if (dbHit && dbHit.del_flag === 0) {
      // 文件 org_id 命中存活节点 → 更新
      planOf.set(f.row, { orgId: String(f.orgId), orgName: f.orgName, orgType: f.orgType, parentOrgId: f.parentOrgId === null ? '' : String(f.parentOrgId), status: f.status, action: 'update', matchedOrgId: dbHit.org_id });
      fileIdMap.set(dbHit.org_id, dbHit.org_id);
      continue;
    }
    if (dbHit && dbHit.del_flag === 1) {
      // 文件 org_id 命中已软删节点 → 直接复活复用其 id（保留既有用户/店铺范围绑定），字段以文件为准
      planOf.set(f.row, { orgId: String(f.orgId), orgName: f.orgName, orgType: f.orgType, parentOrgId: f.parentOrgId === null ? '' : String(f.parentOrgId), status: f.status, action: 'update', matchedOrgId: dbHit.org_id, reason: 'org_id 命中已删除节点，复活并覆盖' });
      fileIdMap.set(dbHit.org_id, dbHit.org_id);
      result.warnings.push({ level: 'info', text: `第 ${f.row} 行 org_id=${f.orgId} 为已软删节点，将复活复用该 id` });
      continue;
    }
    // 未命中 → 唯一键幂等复用
    const keyHit = keyToDb.get(uniqKey(f));
    if (keyHit && f.orgId !== null) {
      // 文件给了 org_id 但库中无此 id，而唯一键命中另一节点 → 按该节点更新并映射文件 id
      planOf.set(f.row, { orgId: String(f.orgId), orgName: f.orgName, orgType: f.orgType, parentOrgId: f.parentOrgId === null ? '' : String(f.parentOrgId), status: f.status, action: 'update', matchedOrgId: keyHit.org_id, reason: '按唯一键匹配到既有节点，更新之' });
      fileIdMap.set(f.orgId, keyHit.org_id);
      result.warnings.push({ level: 'info', text: `第 ${f.row} 行 org_id=${f.orgId} 不存在，按唯一键匹配到节点(id=${keyHit.org_id})执行更新` });
      continue;
    }
    if (keyHit) {
      // org_id 为空但唯一键命中 → 更新
      planOf.set(f.row, { orgId: '', orgName: f.orgName, orgType: f.orgType, parentOrgId: f.parentOrgId === null ? '' : String(f.parentOrgId), status: f.status, action: 'update', matchedOrgId: keyHit.org_id });
      continue;
    }
    // → 新增
    planOf.set(f.row, { orgId: f.orgId === null ? '' : String(f.orgId), orgName: f.orgName, orgType: f.orgType, parentOrgId: f.parentOrgId === null ? '' : String(f.parentOrgId), status: f.status, action: 'create' });
  }

  // 父存在性：parent 必须在库中存活 或 在本文件 create 行中
  const fileCreateIds = new Set<number>();
  for (const f of fileRows) if (planOf.get(f.row)!.action === 'create' && f.orgId !== null) fileCreateIds.add(f.orgId);
  for (const f of fileRows) {
    if (f.parentOrgId === null) continue;
    const dbP = dbById.get(f.parentOrgId);
    if (dbP && dbP.del_flag === 0) continue;
    if (fileCreateIds.has(f.parentOrgId)) continue;
    if (dbP && dbP.del_flag === 1) {
      err(f.row, `parent_org_id(上级组织ID) ${f.parentOrgId} 已被删除，子节点不能挂载其下`);
      continue;
    }
    err(f.row, `parent_org_id(上级组织ID) ${f.parentOrgId} 在库中不存在且不在本文件中`);
  }
  if (result.errors.length > 0) {
    result.warnings.push({ level: 'warn', text: `发现 ${result.errors.length} 处引用错误，未做任何写入` });
    return result;
  }

  // ---- 4.5) 删除集合计算：文件未触及的现有节点 → 软删（保证导入后与文件一致） ----
  const touchedIds = new Set<number>();
  for (const f of fileRows) {
    const pl = planOf.get(f.row)!;
    if (pl.action === 'update' && pl.matchedOrgId) touchedIds.add(pl.matchedOrgId);
  }
  const deleteCandidates: any[] = [];
  for (const x of dbRes.recordset) {
    if (x.del_flag === 0 && !touchedIds.has(x.org_id)) deleteCandidates.push(x);
  }
  const deleteIdSet = new Set(deleteCandidates.map(x => x.org_id));
  const deletePlanRows: ImportPlanRow[] = deleteCandidates.map(x => ({
    orgId: String(x.org_id), orgName: x.org_name || '', orgType: x.org_type || '',
    parentOrgId: x.parent_org_id == null ? '' : String(x.parent_org_id), status: x.status ?? 1,
    action: 'delete',
    reason: mode === 'replace' ? '清除重建：文件外节点将移除' : '差异调整：文件外节点将移除（老框架向新文件对齐）',
  }));

  // 校验：文件行引用的父节点不得位于删除集合（文件缺少祖先节点行）
  if (fileRows.some(f => f.parentOrgId !== null && deleteIdSet.has(f.parentOrgId))) {
    const refs = [...new Set(fileRows.filter(f => f.parentOrgId !== null && deleteIdSet.has(f.parentOrgId!)).map(f => f.parentOrgId))];
    err(0, `文件缺少被引用上级节点：${refs.join('、')} 在文件中不存在但被下级行引用，无法导入（请把父节点行加入文件，或调整其下级 parent_org_id）`);
  }

  // replace 模式强制要求文件中包含根节点（parent 为空的顶级行），防止误清空整棵树
  if (mode === 'replace' && !fileRows.some(f => f.parentOrgId === null)) {
    err(0, '清除重建模式要求文件必须包含根节点（parent_org_id 为空的顶级组织行），否则会清空整棵组织树，已中止');
  }

  if (result.errors.length > 0) {
    result.warnings.push({ level: 'warn', text: `发现 ${result.errors.length} 处引用错误，未做任何写入` });
    return result;
  }

  // 悬空绑定统计：指向将被删除组织的 sys_user_role / org_shop_bind 条数
  if (deleteCandidates.length > 0) {
    const delIds = deleteCandidates.map(x => x.org_id);
    const inClause = delIds.map((_, i) => `@d${i}`).join(',');
    const bindReq = pool.request();
    delIds.forEach((id, i) => bindReq.input(`d${i}`, sql.Int, id));
    const bc = await bindReq.query(`
      SELECT
        (SELECT COUNT(*) FROM sys_user_role WHERE org_id IN (${inClause})) AS ub,
        (SELECT COUNT(*) FROM org_shop_bind WHERE org_id IN (${inClause})) AS sb`);
    result.willCleanUserBinds = bc.recordset[0]?.ub ?? 0;
    result.willCleanShopBinds = bc.recordset[0]?.sb ?? 0;
  }

  // ---- 5) 环检测（Kahn 拓扑，文件行间父子边 + 父亲引用 create 行） ----
  {
    const indeg = new Map<number, number>();
    const children = new Map<number, number[]>();
    for (const f of fileRows) { indeg.set(f.row, 0); children.set(f.row, []); }
    for (const f of fileRows) {
      if (f.parentOrgId === null) continue;
      const isFileCreate = fileCreateIds.has(f.parentOrgId);
      if (!isFileCreate) continue; // 引用的库节点不在环内
      const parentRow = fileRows.find(x => x.orgId === f.parentOrgId)?.row;
      if (parentRow === undefined) continue;
      children.get(parentRow)!.push(f.row);
      indeg.set(f.row, (indeg.get(f.row) || 0) + 1);
    }
    const q: number[] = [...indeg.entries()].filter(([, d]) => d === 0).map(([r]) => r);
    let visited = 0;
    while (q.length > 0) {
      const r = q.shift()!;
      visited++;
      for (const c of children.get(r) || []) {
        const d = (indeg.get(c) || 0) - 1;
        indeg.set(c, d);
        if (d === 0) q.push(c);
      }
    }
    if (visited !== fileRows.length) {
      const inCycle = [...indeg.entries()].filter(([, d]) => d > 0).map(([r]) => r);
      result.errors.push({ row: 0, text: '检测到组织层级循环引用（涉及第 ' + inCycle.join('、') + ' 行），请检查 parent_org_id' });
      result.warnings.push({ level: 'warn', text: '存在循环引用，未做任何写入' });
      return result;
    }
  }

  // ---- 6) 计划统计 ----
  let create = 0, update = 0;
  for (const f of fileRows) {
    const pl = planOf.get(f.row)!;
    if (pl.action === 'create') create++; else update++;
    result.plan.push(pl);
  }
  // 追加删除计划行（文件未触及节点）
  for (const d of deletePlanRows) result.plan.push(d);
  const deleteCount = deletePlanRows.length;
  result.summary = {
    create, update, delete: deleteCount,
    shops: fileRows.filter(x => x.orgType === 'shop').length,
    groups: fileRows.filter(x => x.orgType !== 'shop').length,
  };

  if (dryRun) {
    result.ok = true;
    const modeName = mode === 'replace' ? '清除重建' : '差异调整';
    const delTxt = deleteCount > 0
      ? `、删除 ${deleteCount} 个文件外节点${result.willCleanUserBinds + result.willCleanShopBinds > 0 ? `（将清理用户组织绑定 ${result.willCleanUserBinds} 条、店铺范围绑定 ${result.willCleanShopBinds} 条）` : ''}`
      : '';
    result.warnings.unshift({ level: 'info', text: `预览(${modeName})：共 ${fileRows.length} 行，新增 ${create} 个节点、更新 ${update} 个节点${delTxt}（导入后组织架构将与文件保持一致）` });
    return result;
  }

  // ---- 7) 事务落库 + 层级重建 ----
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const exec = (q: string, inputs: [string, any, any][]) => {
      const req = tx.request();
      for (const [n, v, t] of inputs) req.input(n, t, v);
      return req.query(q);
    };

    // 7.1 拓扑序确定：父先子后（仅文件 create 行之间的依赖；update 行目标已存在,可任意序）
    const topoOrder: number[] = [];
    {
      const indeg = new Map<number, number>();
      const children = new Map<number, number[]>();
      for (const f of fileRows) { indeg.set(f.row, 0); children.set(f.row, []); }
      for (const f of fileRows) {
        if (f.parentOrgId === null || !fileCreateIds.has(f.parentOrgId)) continue;
        const parentRow = fileRows.find(x => x.orgId === f.parentOrgId)?.row;
        if (parentRow === undefined) continue;
        children.get(parentRow)!.push(f.row);
        indeg.set(f.row, (indeg.get(f.row) || 0) + 1);
      }
      const q: number[] = [...indeg.entries()].filter(([, d]) => d === 0).map(([r]) => r);
      while (q.length > 0) {
        const r = q.shift()!;
        topoOrder.push(r);
        for (const c of children.get(r) || []) {
          const d = (indeg.get(c) || 0) - 1;
          indeg.set(c, d);
          if (d === 0) q.push(c);
        }
      }
      // 拓扑序中未包含的行（依赖库节点的行）追加在后
      for (const f of fileRows) if (!topoOrder.includes(f.row)) topoOrder.push(f.row);
    }

    for (const row of topoOrder) {
      const f = fileRows.find(x => x.row === row)!;
      const pl = planOf.get(row)!;
      // parent 实际 id：优先文件映射（create 行插入后回填），否则用文件值（库中 id）
      const parentActual: number | null = f.parentOrgId === null
        ? null
        : (fileIdMap.get(f.parentOrgId) ?? dbById.get(f.parentOrgId)?.org_id ?? (fileCreateIds.has(f.parentOrgId) ? null : f.parentOrgId));
      if (f.parentOrgId !== null && parentActual === null) {
        throw new Error(`第 ${f.row} 行：上级节点 id=${f.parentOrgId} 无法解析实际 id`);
      }

      if (pl.action === 'create') {
        const ins = await exec(`
          INSERT INTO sys_org (parent_org_id, org_name, org_type, org_level, ancestors, warehouse_type, business_line, function_line, org_code, shop_code, shop_name, status, del_flag, create_time, update_time)
          OUTPUT INSERTED.org_id
          VALUES (@p, @n, @t, 1, '', @wt, @bl, @fl, @oc, @sc, @sn, @st, 0, GETDATE(), GETDATE())`,
          [['p', parentActual, sql.Int], ['n', f.orgName, sql.NVarChar(200)], ['t', f.orgType, sql.NVarChar(50)],
           ['wt', f.warehouseType || null, sql.NVarChar(100)], ['bl', f.businessLine || null, sql.NVarChar(100)], ['fl', f.functionLine || null, sql.NVarChar(100)],
           ['oc', f.orgCode || null, sql.NVarChar(200)], ['sc', f.shopCode || null, sql.NVarChar(200)], ['sn', f.shopName || null, sql.NVarChar(400)],
           ['st', f.status, sql.Int]]);
        const newId = ins.recordset[0]?.org_id;
        if (!newId) throw new Error(`第 ${f.row} 行插入失败`);
        pl.matchedOrgId = newId;
        if (f.orgId !== null) fileIdMap.set(f.orgId, newId);
      } else {
        const targetId = pl.matchedOrgId!;
        await exec(`
          UPDATE sys_org SET
            org_name = @n, org_type = @t, parent_org_id = @p,
            warehouse_type = @wt, business_line = @bl, function_line = @fl,
            org_code = @oc, shop_code = @sc, shop_name = @sn, status = @st,
            del_flag = 0, update_time = GETDATE()
          WHERE org_id = @id`,
          [['id', targetId, sql.Int], ['n', f.orgName, sql.NVarChar(200)], ['t', f.orgType, sql.NVarChar(50)],
           ['p', parentActual, sql.Int], ['wt', f.warehouseType || null, sql.NVarChar(100)], ['bl', f.businessLine || null, sql.NVarChar(100)], ['fl', f.functionLine || null, sql.NVarChar(100)],
           ['oc', f.orgCode || null, sql.NVarChar(200)], ['sc', f.shopCode || null, sql.NVarChar(200)], ['sn', f.shopName || null, sql.NVarChar(400)],
           ['st', f.status, sql.Int]]);
      }
    }

    // 7.1.1 删除文件外的现有节点（统一软删，保证导入后与文件一致）
    if (deleteCandidates.length > 0) {
      const delIds = deleteCandidates.map(x => x.org_id);
      const inClause = delIds.map((_, i) => `@x${i}`).join(',');
      const delReq = tx.request();
      delIds.forEach((id, i) => delReq.input(`x${i}`, sql.Int, id));
      await delReq.query(`UPDATE sys_org SET del_flag = 1, update_time = GETDATE() WHERE org_id IN (${inClause}) AND del_flag = 0`);
    }

    // 7.2 全树重建 ancestors / org_level（孤儿节点保持原样）
    const allRes = await tx.request().query(`SELECT org_id, parent_org_id, org_level, ancestors FROM sys_org WHERE del_flag = 0`);
    const nodes = allRes.recordset;
    const parentOf = new Map<number, number | null>();
    const children = new Map<number, number[]>();
    for (const n of nodes) {
      parentOf.set(n.org_id, n.parent_org_id ?? null);
      children.set(n.org_id, []);
    }
    for (const n of nodes) {
      const p = n.parent_org_id;
      if (p !== null && parentOf.has(p)) children.get(p)!.push(n.org_id);
    }
    const roots = nodes.filter(n => n.parent_org_id === null || !parentOf.has(n.parent_org_id));
    const levelOf = new Map<number, number>();
    const ancOf = new Map<number, string>();
    const order: number[] = [];
    const pending: number[] = [];
    for (const r of roots) { levelOf.set(r.org_id, 1); ancOf.set(r.org_id, '/'); pending.push(r.org_id); }
    while (pending.length > 0) {
      const cur = pending.shift()!;
      order.push(cur);
      for (const cid of children.get(cur) || []) {
        const lv = (levelOf.get(cur) || 1) + 1;
        levelOf.set(cid, lv);
        ancOf.set(cid, (ancOf.get(cur) || '/') + cur + '/');
        pending.push(cid);
      }
    }
    for (const n of nodes) {
      if (!levelOf.has(n.org_id) || !ancOf.has(n.org_id)) continue; // 孤儿：父不存在/被删,保持原样
      const nl = levelOf.get(n.org_id)!;
      const na = ancOf.get(n.org_id)!;
      if (nl !== n.org_level || na !== (n.ancestors || '')) {
        const reqPar = tx.request();
        reqPar.input('id', sql.Int, n.org_id).input('lvl', sql.Int, nl).input('anc', sql.NVarChar(400), na);
        await reqPar.query(`UPDATE sys_org SET org_level = @lvl, ancestors = @anc, update_time = GETDATE() WHERE org_id = @id AND del_flag = 0`);
      }
    }

    // 7.3 清理悬空绑定：指向已删除组织的用户组织绑定 / 店铺范围绑定
    if (deleteCandidates.length > 0) {
      const delIds = deleteCandidates.map(x => x.org_id);
      const inClause = delIds.map((_, i) => `@y${i}`).join(',');
      const cleanReq = tx.request();
      delIds.forEach((id, i) => cleanReq.input(`y${i}`, sql.Int, id));
      const r1 = await cleanReq.query(`DELETE FROM sys_user_role WHERE org_id IN (${inClause})`);
      const r2 = await cleanReq.query(`DELETE FROM org_shop_bind WHERE org_id IN (${inClause})`);
      result.willCleanUserBinds = r1.rowsAffected[0] ?? 0;
      result.willCleanShopBinds = r2.rowsAffected[0] ?? 0;
    }

    await tx.commit();
  } catch (e: any) {
    try { await tx.rollback(); } catch { /* ignore */ }
    result.ok = false;
    result.warnings.push({ level: 'warn', text: '导入失败，已整体回滚：' + String(e?.message || e) });
    return result;
  }

  result.ok = true;
  const modeName = mode === 'replace' ? '清除重建' : '差异调整';
  const delTxt = deleteCount > 0
    ? `、删除 ${deleteCount} 个文件外节点${result.willCleanUserBinds + result.willCleanShopBinds > 0 ? `（清理用户组织绑定 ${result.willCleanUserBinds} 条、店铺范围绑定 ${result.willCleanShopBinds} 条）` : ''}`
    : '、未删除节点';
  result.warnings.unshift({ level: 'info', text: `导入完成(${modeName})：新增 ${create} 个节点、更新 ${update} 个节点${delTxt}，组织层级(ancestors/org_level)已重建，导入后组织架构与文件一致` });
  return result;
}