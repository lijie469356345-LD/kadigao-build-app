// ============================================================
// 组织架构自动同步（从店铺档案自动维护）
// 用途：将业务线的「区经组XX」组织架构按店铺档案口径自动重建并同步迁移用户归属。
// 层级口径（与店铺档案/店仓选择完全一致，DataExtraction「店铺信息_区域区经督导」SQL）：
//   - 直营 / 山东直营：区经 → 督导 → 店铺（dealerLevel=false）
//   - 加盟：区经 → 督导 → 经销商 → 店铺（dealerLevel=true，经销商=档案经销商字段）
// 口径：外层按 warehouseType 过滤；加盟由 DataExtraction 内层限定「标准专卖店」。
// 幂等：按 parent+name/shop_code 判重，可反复执行；新增店铺只需再次执行本服务。
// 安全：不做任何删除；已挂到其他组织的店铺/用户行不自动移动，仅报告。
// 模式：dryRun=true 只计算返回计划；dryRun=false 在事务内落库，失败自动回滚。
// ============================================================
import sql from 'mssql';
import { loadShopArchiveBaseSQL } from './shopArchiveSource';

// 店仓全 → 用户全 异名映射（历史档案中个别名字不一致，以用户全为准）
const NAME_ALIAS: Record<string, string> = { '宋蛟龙': '宋姣龙' };
const normName = (raw: string) => NAME_ALIAS[raw] || raw;

export interface SyncWarn { level: 'warn' | 'info'; text: string }
export interface SyncNodePlan {
  kind: 'areaManager' | 'supervisor' | 'dealer' | 'shop';
  name: string; orgName: string; parentName: string;
  action: 'create' | 'exists' | 'skip';
  orgId?: number; shopCode?: string; reason?: string;
}
export interface SyncUserPlan {
  userCode: string; userName: string; roleCode: string;
  action: 'move' | 'insert' | 'skip';
  fromOrgId?: number | null; toOrgName: string; reason?: string;
}
export interface SyncResult {
  ok: boolean;
  dryRun: boolean;
  targetOrg: { orgId: number; orgName: string; orgLevel: number; ancestors: string } | null;
  scope: string;
  shopTotal: number;
  nodes: SyncNodePlan[];
  users: SyncUserPlan[];
  warnings: SyncWarn[];
  alreadyBoundShops: number;
  summary?: { areaManagers: number; supervisors: number; dealers: number; shops: number; usersMoved: number; usersInserted: number };
}

export async function syncOrgFromArchive(pool: sql.ConnectionPool, opts: {
  dryRun?: boolean;
  parentOrgId?: number | null;
  warehouseType?: string;
  /** true=启用经销商层级（区经→督导→经销商→店铺），false=区经→督导→店铺 */
  dealerLevel?: boolean;
  /** 经销商账号识别方式：从 sys_user_role 的 dealer 角色 + org 节点（org_name LIKE '经销商_%'）反推归属 */
  dealerGroupPrefix?: string;
}): Promise<SyncResult> {
  const dryRun = !!opts.dryRun;
  const warehouseType = opts.warehouseType || '直营';
  const dealerLevel = !!opts.dealerLevel;
  const result: SyncResult = {
    ok: false, dryRun, targetOrg: null, scope: warehouseType, shopTotal: 0,
    nodes: [], users: [], warnings: [], alreadyBoundShops: 0,
  };

  let tx: sql.Transaction | null = null;
  try {
    // ---------- 1) 目标父节点（区经组直营/区经组加盟/区经组山东） ----------
    let targetId: number;
    if (opts.parentOrgId) {
      targetId = Number(opts.parentOrgId);
    } else {
      const t = await pool.request()
        .input('nm', sql.NVarChar, '区经组直营')
        .query(`SELECT org_id FROM sys_org WHERE org_name = @nm AND org_type = 'group' AND del_flag = 0`);
      if (t.recordset.length === 0) {
        return { ...result, warnings: [{ level: 'warn', text: '未找到目标组织「区经组直营」，请检查组织框架' }] };
      }
      targetId = t.recordset[0].org_id;
    }
    const tRow = await pool.request().input('id', sql.Int, targetId).query(
      `SELECT org_id, org_name, org_level, ancestors, business_line, function_line FROM sys_org WHERE org_id = @id AND del_flag = 0`);
    if (tRow.recordset.length === 0) {
      return { ...result, warnings: [{ level: 'warn', text: '目标组织节点不存在(org_id=' + targetId + ')' }] };
    }
    const target = tRow.recordset[0];
    const bizLine = target.business_line || 'direct';
    const fnLine = target.function_line || '运营';
    result.targetOrg = { orgId: target.org_id, orgName: target.org_name, orgLevel: target.org_level, ancestors: target.ancestors };
    const targetPrefix = (target.ancestors || '') + target.org_id + '/';
    // 业务线总监节点 id（target.ancestors=/1/3/ 时总监=3），用于 ops_director 联动迁移判断
    const ancParts = String(target.ancestors || '').split('/').filter(Boolean).map(Number);
    const bizDirectorId = ancParts[ancParts.length - 1] || 3;

    // ---------- 2) 读取店铺档案（口径一致，取目标仓库类别） ----------
    const baseSQL = await loadShopArchiveBaseSQL(pool);
    const fromMatch = baseSQL.match(/\bFROM\b/i);
    const fullSQL = fromMatch && fromMatch.index
      ? baseSQL.slice(0, fromMatch.index) + ', 店铺ID as shopId, 店铺代码 as shopCode' + ' ' + baseSQL.slice(fromMatch.index)
      : baseSQL;
    const shopsRes = await pool.request()
      .input('wt', sql.NVarChar, warehouseType)
      .query(`
        SELECT shopId, shopCode, shopName, warehouseType, area, districtManager, supervisor, dealer
        FROM ( ${fullSQL} ) t
        WHERE warehouseType = @wt
        ORDER BY districtManager, supervisor, dealer, shopCode
      `);
    const shops = shopsRes.recordset;
    result.shopTotal = shops.length;

    // ---------- 3) 档案 → 区经/督导(/经销商) 结构推导 ----------
    // am -> (sp -> (dl -> shops[]))；dealerLevel=false 时 dl 固定为 ''
    const amMap = new Map<string, Map<string, Map<string, any[]>>>();
    for (const s of shops) {
      const amRaw = String(s.districtManager || '').trim();
      const spRaw = String(s.supervisor || '').trim();
      const dlRaw = dealerLevel ? String(s.dealer || '').trim() : '';
      const am = normName(amRaw);
      const sp = normName(spRaw);
      if (!am || !sp) {
        result.warnings.push({ level: 'warn', text: `店铺 ${s.shopCode}( ${s.shopName} ) 缺少区经或督导，跳过` });
        continue;
      }
      if (dealerLevel && !dlRaw) {
        result.warnings.push({ level: 'warn', text: `店铺 ${s.shopCode}( ${s.shopName} ) 缺少经销商，跳过` });
        continue;
      }
      if (!amMap.has(am)) amMap.set(am, new Map());
      const sps = amMap.get(am)!;
      if (!sps.has(sp)) sps.set(sp, new Map());
      const dls = sps.get(sp)!;
      if (!dls.has(dlRaw)) dls.set(dlRaw, []);
      dls.get(dlRaw)!.push(s);
    }

    // ---------- 4) 现有树快照（目标子树内全部节点，判重用） ----------
    const subRows = await pool.request()
      .input('id', sql.Int, target.org_id)
      .input('p', sql.NVarChar, targetPrefix)
      .query(`
        SELECT org_id, parent_org_id, org_name, org_type, org_level, ancestors, shop_code, shop_name
        FROM sys_org
        WHERE del_flag = 0 AND (org_id = @id OR ancestors LIKE @p + '%')
      `);
    // children: parentId -> Map(org_name -> node)
    const childrenMap = new Map<number, Map<string, any>>();
    // shop: shop_code -> node
    const shopByCode = new Map<string, any>();
    for (const n of subRows.recordset) {
      if (n.org_id === target.org_id) continue;
      const parent = n.parent_org_id;
      if (!childrenMap.has(parent)) childrenMap.set(parent, new Map());
      childrenMap.get(parent)!.set(String(n.org_name).trim(), n);
      if (n.org_type === 'shop' && n.shop_code) shopByCode.set(String(n.shop_code).trim(), n);
    }
    // 全树已绑定店铺（目标子树之外）→ 用于跳过已绑定的店
    const gRes2 = await pool.request()
      .input('p', sql.NVarChar, targetPrefix)
      .query(`SELECT shop_code FROM sys_org
        WHERE org_type = 'shop' AND del_flag = 0 AND shop_code IS NOT NULL
          AND NOT (ancestors = @p OR ancestors LIKE @p + '%')`);
    const globalShopIds = new Set<string>();
    for (const g of gRes2.recordset) globalShopIds.add(String(g.shop_code).trim());

    // ---------- 5) 用户全名称 → 用户代码（规范名匹配：区经/督导） ----------
    const allNames = new Set<string>();
    for (const am of amMap.keys()) allNames.add(am);
    for (const sps of amMap.values()) for (const sp of sps.keys()) allNames.add(sp);
    const userCodeByName = new Map<string, string>();
    if (allNames.size > 0) {
      const nameList = [...allNames];
      for (let i = 0; i < nameList.length; i += 200) {
        const batch = nameList.slice(i, i + 200);
        const ph = batch.map((_, idx) => `@n${idx}`).join(',');
        const req = pool.request();
        batch.forEach((n, idx) => req.input(`n${idx}`, sql.NVarChar, n));
        const r = await req.query(`SELECT 用户代码, 用户名称 FROM 用户全 WHERE 用户名称 IN (${ph})`);
        for (const u of r.recordset) {
          const nm = String(u['用户名称'] || '').trim();
          const code = String(u['用户代码'] || '').trim();
          if (nm && code && !userCodeByName.has(nm)) userCodeByName.set(nm, code);
        }
      }
    }
    // 经销商归属账号：【2026-09 下线用户组】不再按 用户全.用户组 = 前缀+经销商名 匹配；
    // 改为从 sys_user_role 持 dealer 角色 + org 节点（org_name LIKE '经销商_%'）反推：
    //   org_name = 经销商_郑州XX → ref = 郑州XX（经销商名），user_code = 该角色行用户
    const dealerUsersByKey = new Map<string, string[]>(); // 经销商名 -> 用户代码[]
    const allDealerUserCodes = new Set<string>();
    if (dealerLevel) {
      const g = await pool.request()
        .query(`
          SELECT ur.user_code, o.org_name
          FROM sys_user_role ur
          JOIN sys_role r ON ur.role_id = r.role_id AND r.del_flag = 0
          JOIN sys_org o ON ur.org_id = o.org_id AND o.del_flag = 0
          WHERE r.role_code = 'dealer' AND o.org_name LIKE N'经销商_%'
        `);
      for (const u of g.recordset) {
        const ref = String(u['org_name'] || '').replace(/^经销商[_ ]*/, '').trim();
        const code = String(u['user_code'] || '').trim();
        if (!ref || !code) continue;
        if (!dealerUsersByKey.has(ref)) dealerUsersByKey.set(ref, []);
        dealerUsersByKey.get(ref)!.push(code);
        allDealerUserCodes.add(code);
      }
      if (dealerUsersByKey.size === 0) {
        result.warnings.push({ level: 'info', text: '未在 sys_user_role 找到持 dealer 角色且绑定经销商组织的账号，经销商归属将跳过' });
      }
    }

    // ---------- 6) 角色 ID（area_manager/supervisor/ops_director/dealer） ----------
    const roleRes = await pool.request().query(
      `SELECT role_id, role_code FROM sys_role WHERE role_code IN ('area_manager','supervisor','ops_director','dealer') AND del_flag = 0`);
    const roleId: Record<string, number> = {};
    for (const rr of roleRes.recordset) roleId[rr.role_code] = rr.role_id;
    if (!roleId.area_manager || !roleId.supervisor) {
      return { ...result, warnings: [...result.warnings, { level: 'warn', text: '缺少 area_manager/supervisor 角色定义，无法同步用户归属' }] };
    }
    if (dealerLevel && !roleId.dealer) {
      return { ...result, warnings: [...result.warnings, { level: 'warn', text: '缺少 dealer 角色定义，无法同步经销商归属' }] };
    }

    // ---------- 7) 现有 sys_user_role 快照（目标区经/督导/经销商用户的行） ----------
    const involvedCodes = new Set<string>();
    for (const am of amMap.keys()) { const c = userCodeByName.get(am); if (c) involvedCodes.add(c); }
    for (const sps of amMap.values()) for (const sp of sps.keys()) { const c = userCodeByName.get(sp); if (c) involvedCodes.add(c); }
    for (const c of allDealerUserCodes) involvedCodes.add(c);
    const urRows: any[] = [];
    if (involvedCodes.size > 0) {
      const codeList = [...involvedCodes];
      for (let i = 0; i < codeList.length; i += 200) {
        const batch = codeList.slice(i, i + 200);
        const ph = batch.map((_, idx) => `@u${idx}`).join(',');
        const req = pool.request();
        batch.forEach((c, idx) => req.input(`u${idx}`, sql.NVarChar, c));
        const r = await req.query(`
          SELECT ur.id, ur.user_code, ur.role_id, ur.org_id, ur.data_scope, r.role_code
          FROM sys_user_role ur
          LEFT JOIN sys_role r ON ur.role_id = r.role_id AND r.del_flag = 0
          WHERE ur.user_code IN (${ph})
        `);
        urRows.push(...r.recordset);
      }
    }

    // ---------- 8) 事务（dryRun 不落库） ----------
    if (!dryRun) {
      tx = new sql.Transaction(pool);
      await tx.begin();
    }
    let drySeq = 0;
    const q = () => (tx ? tx.request() : pool.request());
    const insertNode = async (parentId: number, orgName: string, orgType: string, level: number, ancestors: string,
      extra: { shopCode?: string | null; shopName?: string | null; warehouseType?: string | null; businessLine?: string | null; functionLine?: string | null; orgCode?: string | null }): Promise<number | null> => {
      if (tx) {
        const req = tx.request();
        req.input('pp', sql.Int, parentId).input('nm', sql.NVarChar, orgName).input('typ', sql.NVarChar, orgType)
          .input('lvl', sql.Int, level).input('anc', sql.NVarChar, ancestors)
          .input('sc', sql.NVarChar, extra.shopCode || null).input('sn', sql.NVarChar, extra.shopName || null)
          .input('wt', sql.NVarChar, extra.warehouseType || null).input('bl', sql.NVarChar, extra.businessLine || null)
          .input('fl', sql.NVarChar, extra.functionLine || null).input('oc', sql.NVarChar, extra.orgCode || null);
        const r = await req.query(`
          INSERT INTO sys_org (parent_org_id, org_name, org_type, org_level, ancestors, shop_code, shop_name, warehouse_type, business_line, function_line, org_code)
          OUTPUT INSERTED.org_id
          VALUES (@pp, @nm, @typ, @lvl, @anc, @sc, @sn, @wt, @bl, @fl, @oc)`);
        return r.recordset[0]?.org_id ?? null;
      }
      drySeq -= 1; // dryRun：返回负数模拟 id，用于推导后续层级
      return drySeq;
    };
    const moveUserRole = async (entryId: number, orgId: number) => {
      if (tx) {
        const req = tx.request();
        req.input('id', sql.Int, entryId).input('oid', sql.Int, orgId);
        await req.query(`UPDATE sys_user_role SET org_id = @oid, update_time = GETDATE() WHERE id = @id`);
      }
    };
    const insertUserRole = async (userCode: string, roleIdN: number, orgId: number) => {
      if (tx) {
        const req = tx.request();
        req.input('uc', sql.NVarChar, userCode).input('rid', sql.Int, roleIdN).input('oid', sql.Int, orgId);
        await req.query(`INSERT INTO sys_user_role (user_code, role_id, org_id, update_time) VALUES (@uc, @rid, @oid, GETDATE())`);
      }
    };
    const inBizLine = (anc: string) => {
      const parts = String(anc || '').split('/').filter(Boolean).map(Number);
      return parts.includes(bizDirectorId);
    };

    let newAm = 0, newSp = 0, newDl = 0, newShop = 0, movedUsers = 0, insertedUsers = 0;

    for (const [amName, sps] of amMap) {
      // ---- 区经节点 ----
      const amOrgName = `区经_${amName}`;
      let amNode: any = childrenMap.get(target.org_id)?.get(amOrgName);
      if (amNode && amNode.org_type !== 'group') {
        result.nodes.push({ kind: 'areaManager', name: amName, orgName: amOrgName, parentName: target.org_name, action: 'skip', orgId: amNode.org_id, reason: `已存在同名节点但类型为 ${amNode.org_type}，不覆盖` });
        result.warnings.push({ level: 'warn', text: `「${amOrgName}」已存在但类型不符(${amNode.org_type})，跳过该区经` });
        continue;
      }
      if (!amNode) {
        const amId = await insertNode(target.org_id, amOrgName, 'group', target.org_level + 1, targetPrefix,
          { businessLine: bizLine, functionLine: fnLine, orgCode: userCodeByName.get(amName) || null });
        if (amId) {
          amNode = { org_id: amId, org_name: amOrgName, org_type: 'group', org_level: target.org_level + 1, ancestors: targetPrefix };
          if (!childrenMap.has(target.org_id)) childrenMap.set(target.org_id, new Map());
          childrenMap.get(target.org_id)!.set(amOrgName, amNode);
          newAm++;
          result.nodes.push({ kind: 'areaManager', name: amName, orgName: amOrgName, parentName: target.org_name, action: 'create', orgId: amId });
        }
      } else {
        result.nodes.push({ kind: 'areaManager', name: amName, orgName: amOrgName, parentName: target.org_name, action: 'exists', orgId: amNode.org_id });
      }
      if (!amNode) continue;

      // ---- 区经用户归属（area_manager 行迁移 / 补齐 + ops_director 联动收敛） ----
      const amUserCode = userCodeByName.get(amName);
      if (amUserCode) {
        const amEntries = urRows.filter(r => String(r.user_code) === amUserCode && r.role_code === 'area_manager');
        if (amEntries.length > 0) {
          for (const e of amEntries) {
            if (e.org_id !== amNode.org_id) {
              result.users.push({ userCode: amUserCode, userName: amName, roleCode: 'area_manager', action: 'move', fromOrgId: e.org_id, toOrgName: amOrgName });
              await moveUserRole(e.id, amNode.org_id);
              movedUsers++;
            }
          }
        } else {
          result.users.push({ userCode: amUserCode, userName: amName, roleCode: 'area_manager', action: 'insert', toOrgName: amOrgName });
          await insertUserRole(amUserCode, roleId.area_manager, amNode.org_id);
          insertedUsers++;
          const dirEntries = urRows.filter(r => String(r.user_code) === amUserCode && r.role_code === 'ops_director');
          for (const de of dirEntries) {
            const orgAncRes = await q()
              .input('oid', sql.Int, de.org_id || 0)
              .query(`SELECT ancestors FROM sys_org WHERE org_id = @oid AND del_flag = 0`).catch(() => ({ recordset: [] as any[] }));
            const anc = orgAncRes.recordset[0]?.ancestors || '';
            if (de.org_id !== amNode.org_id && (de.org_id === bizDirectorId || inBizLine(anc))) {
              result.users.push({ userCode: amUserCode, userName: amName, roleCode: 'ops_director', action: 'move', fromOrgId: de.org_id, toOrgName: amOrgName, reason: '联动收敛数据范围' });
              await moveUserRole(de.id, amNode.org_id);
              movedUsers++;
            }
          }
        }
      } else {
        result.warnings.push({ level: 'warn', text: `区经「${amName}」在用户全中未找到，仅建组织节点不迁移归属` });
      }

      // ---- 督导节点 ----
      for (const [spName, dls] of sps) {
        const spOrgName = `督导_${spName}`;
        let spNode: any = childrenMap.get(amNode.org_id)?.get(spOrgName);
        if (spNode && spNode.org_type !== 'supervisor_group') {
          result.nodes.push({ kind: 'supervisor', name: spName, orgName: spOrgName, parentName: amOrgName, action: 'skip', orgId: spNode.org_id, reason: '同名节点类型不符' });
          result.warnings.push({ level: 'warn', text: `「${spOrgName}」已存在但类型不符(${spNode.org_type})，跳过该督导` });
          continue;
        }
        if (!spNode) {
          const spId = await insertNode(amNode.org_id, spOrgName, 'supervisor_group', amNode.org_level + 1, amNode.ancestors + amNode.org_id + '/',
            { businessLine: bizLine, functionLine: fnLine, orgCode: userCodeByName.get(spName) || null });
          if (spId) {
            spNode = { org_id: spId, org_name: spOrgName, org_type: 'supervisor_group', org_level: amNode.org_level + 1, ancestors: amNode.ancestors + amNode.org_id + '/' };
            if (!childrenMap.has(amNode.org_id)) childrenMap.set(amNode.org_id, new Map());
            childrenMap.get(amNode.org_id)!.set(spOrgName, spNode);
            newSp++;
            result.nodes.push({ kind: 'supervisor', name: spName, orgName: spOrgName, parentName: amOrgName, action: 'create', orgId: spId });
          }
        } else {
          result.nodes.push({ kind: 'supervisor', name: spName, orgName: spOrgName, parentName: amOrgName, action: 'exists', orgId: spNode.org_id });
        }
        if (!spNode) continue;

        // ---- 督导用户归属（supervisor 行迁移） ----
        const spUserCode = userCodeByName.get(spName);
        if (spUserCode) {
          const spEntries = urRows.filter(r => String(r.user_code) === spUserCode && r.role_code === 'supervisor');
          for (const e of spEntries) {
            if (e.org_id !== spNode.org_id) {
              result.users.push({ userCode: spUserCode, userName: spName, roleCode: 'supervisor', action: 'move', fromOrgId: e.org_id, toOrgName: spOrgName });
              await moveUserRole(e.id, spNode.org_id);
              movedUsers++;
            }
          }
        }

        // ---- 经销商节点（仅 dealerLevel） ----
        for (const [dlName, spShops] of dls) {
          let dlNode: any = null;
          let dlOrgName = spOrgName;
          if (dealerLevel) {
            dlOrgName = `经销商_${dlName}`;
            dlNode = childrenMap.get(spNode.org_id)?.get(dlOrgName);
            if (dlNode && dlNode.org_type !== 'dealer_group') {
              result.nodes.push({ kind: 'dealer', name: dlName, orgName: dlOrgName, parentName: spOrgName, action: 'skip', orgId: dlNode.org_id, reason: '同名节点类型不符' });
              result.warnings.push({ level: 'warn', text: `「${dlOrgName}」已存在但类型不符(${dlNode.org_type})，跳过该经销商` });
              continue;
            }
            if (!dlNode) {
              const dlId = await insertNode(spNode.org_id, dlOrgName, 'dealer_group', spNode.org_level + 1, spNode.ancestors + spNode.org_id + '/',
                { businessLine: bizLine, functionLine: fnLine });
              if (dlId) {
                dlNode = { org_id: dlId, org_name: dlOrgName, org_type: 'dealer_group', org_level: spNode.org_level + 1, ancestors: spNode.ancestors + spNode.org_id + '/' };
                if (!childrenMap.has(spNode.org_id)) childrenMap.set(spNode.org_id, new Map());
                childrenMap.get(spNode.org_id)!.set(dlOrgName, dlNode);
                newDl++;
                result.nodes.push({ kind: 'dealer', name: dlName, orgName: dlOrgName, parentName: spOrgName, action: 'create', orgId: dlId });
              }
            } else {
              result.nodes.push({ kind: 'dealer', name: dlName, orgName: dlOrgName, parentName: spOrgName, action: 'exists', orgId: dlNode.org_id });
            }
            if (!dlNode) continue;

            // ---- 经销商用户归属（dealer 行迁移 / 补齐） ----
            const dlUserCodes = dealerUsersByKey.get(dlName) || [];
            if (dlUserCodes.length === 0) {
              result.warnings.push({ level: 'info', text: `经销商「${dlName}」无归属账号，仅建组织节点` });
            }
            for (const uc of dlUserCodes) {
              const dlEntries = urRows.filter(r => String(r.user_code) === uc && r.role_code === 'dealer');
              if (dlEntries.length > 0) {
                for (const e of dlEntries) {
                  if (e.org_id !== dlNode.org_id) {
                    result.users.push({ userCode: uc, userName: dlName, roleCode: 'dealer', action: 'move', fromOrgId: e.org_id, toOrgName: dlOrgName });
                    await moveUserRole(e.id, dlNode.org_id);
                    movedUsers++;
                  }
                }
              } else {
                result.users.push({ userCode: uc, userName: dlName, roleCode: 'dealer', action: 'insert', toOrgName: dlOrgName });
                await insertUserRole(uc, roleId.dealer, dlNode.org_id);
                insertedUsers++;
              }
            }
          }

          // ---- 店铺叶子 ----
          const shopParent = dlNode || spNode;
          const shopParentName = dlNode ? dlOrgName : spOrgName;
          for (const s of spShops) {
            const code = String(s.shopCode || '').trim();
            const name = String(s.shopName || '').trim();
            if (shopByCode.has(code)) {
              const ex = shopByCode.get(code);
              if (ex.parent_org_id === shopParent.org_id) {
                result.nodes.push({ kind: 'shop', name, orgName: name, parentName: shopParentName, action: 'exists', orgId: ex.org_id, shopCode: code });
              } else {
                result.nodes.push({ kind: 'shop', name, orgName: name, parentName: shopParentName, action: 'skip', shopCode: code, reason: `已绑定在其他组织(${ex.org_name})，不自动移动` });
                result.warnings.push({ level: 'info', text: `店铺 ${code}( ${name} ) 已绑定在别处，未自动移动` });
              }
              continue;
            }
            if (globalShopIds.has(code)) {
              result.alreadyBoundShops++;
              result.nodes.push({ kind: 'shop', name, orgName: name, parentName: shopParentName, action: 'skip', shopCode: code, reason: `该店铺已绑定在${target.org_name}之外的组织` });
              result.warnings.push({ level: 'info', text: `店铺 ${code}( ${name} ) 已绑定在${target.org_name}之外，跳过` });
              continue;
            }
            const shopId = await insertNode(shopParent.org_id, name, 'shop', shopParent.org_level + 1, shopParent.ancestors + shopParent.org_id + '/',
              { shopCode: code, shopName: name, warehouseType: warehouseType, businessLine: bizLine, functionLine: fnLine });
            if (shopId) {
              newShop++;
              shopByCode.set(code, { org_id: shopId, parent_org_id: shopParent.org_id, org_name: name });
              result.nodes.push({ kind: 'shop', name, orgName: name, parentName: shopParentName, action: 'create', orgId: shopId, shopCode: code });
            }
          }
        }
      }
    }

    if (tx) await tx.commit();

    // ---------- 9) 汇总 ----------
    const summary = { areaManagers: newAm, supervisors: newSp, dealers: newDl, shops: newShop, usersMoved: movedUsers, usersInserted: insertedUsers };
    if (!dryRun) {
      const dlPart = dealerLevel ? `、经销商 ${newDl} 个` : '';
      result.warnings.unshift({ level: 'info', text: `执行完成：新增区经 ${newAm} 个、督导 ${newSp} 个${dlPart}、店铺 ${newShop} 家；迁移用户归属 ${movedUsers} 人次、补齐角色 ${insertedUsers} 人次` });
    }
    result.ok = true;
    result.summary = summary;
    return result;
  } catch (err) {
    if (tx) {
      try { await tx.rollback(); } catch { /* 忽略回滚异常 */ }
    }
    result.ok = false;
    result.warnings.push({ level: 'warn', text: '同步失败，已回滚：' + String(err) });
    return result;
  }
}

// ============================================================
// 职能组门店镜像
// 用途：将某仓库类别（如直营）的全部店铺按档案口径镜像绑定到「职能组」节点下
//       （如 会员组直营 / 商品组直营 / 门店组直营），解决职能组归属用户看不到门店业绩的问题。
// 机制：见店权限 = 用户归属组织节点子树下所有 org_type='shop' 叶子；本服务给目标组节点
//       直接挂 shop 叶子，同一店铺可同时挂于区经组与多个职能组下（权限可见性不冲突）。
// 幂等：按 (parent_org_id, shop_code) 判重，可反复执行；新增店铺只需再次执行本服务。
// 安全：不做任何删除；不移动既有的店铺绑定；目标组必须为 group 类型节点。
// 模式：dryRun=true 只计算返回计划；dryRun=false 在事务内落库，失败自动回滚。
// ============================================================
export interface FuncGroupSyncGroup {
  groupOrgId: number;
  groupName: string;
  bound: number;   // 已在组下的店（跳过）
  created: number; // 本次计划/实际新增
}
export interface FuncGroupSyncResult {
  ok: boolean;
  dryRun: boolean;
  warehouseType: string;
  shopTotal: number;
  groups: FuncGroupSyncGroup[];
  warnings: SyncWarn[];
  summary?: { created: number; skipped: number; groups: number };
}

export async function syncFunctionGroupShops(pool: sql.ConnectionPool, opts: {
  dryRun?: boolean;
  warehouseType?: string;
  groupOrgIds: number[];
}): Promise<FuncGroupSyncResult> {
  const dryRun = !!opts.dryRun;
  const warehouseType = opts.warehouseType || '直营';
  const groupOrgIds = (opts.groupOrgIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  const result: FuncGroupSyncResult = {
    ok: false, dryRun, warehouseType, shopTotal: 0, groups: [], warnings: [],
  };

  try {
    if (groupOrgIds.length === 0) {
      result.warnings.push({ level: 'warn', text: '未指定目标职能组（groupOrgIds 必填）' });
      return result;
    }
    // 1) 目标职能组节点校验（必须是 group 类型存活节点）
    const ph = groupOrgIds.map((_, i) => `@g${i}`).join(',');
    const groupReq = pool.request();
    groupOrgIds.forEach((id, i) => groupReq.input(`g${i}`, sql.Int, id));
    const groupRows = await groupReq.query(`
      SELECT org_id, org_name, org_type, org_level, ancestors, business_line, function_line
      FROM sys_org WHERE org_id IN (${ph}) AND del_flag = 0`);
    const groupById = new Map<number, any>();
    for (const g of groupRows.recordset) groupById.set(g.org_id, g);
    const validIds: number[] = [];
    for (const id of groupOrgIds) {
      const g = groupById.get(id);
      if (!g) {
        result.warnings.push({ level: 'warn', text: `目标组织 ${id} 不存在或已删除，跳过` });
        continue;
      }
      if (g.org_type !== 'group') {
        result.warnings.push({ level: 'warn', text: `目标组织「${g.org_name}」类型为 ${g.org_type}，仅支持 group 类型，跳过` });
        continue;
      }
      validIds.push(id);
    }
    if (validIds.length === 0) {
      result.warnings.push({ level: 'warn', text: '没有可用的目标职能组，未做任何写入' });
      return result;
    }

    // 2) 读取店铺档案（口径与归档同步一致，取目标仓库类别）
    const baseSQL = await loadShopArchiveBaseSQL(pool);
    const fromMatch = baseSQL.match(/\bFROM\b/i);
    const fullSQL = fromMatch && fromMatch.index
      ? baseSQL.slice(0, fromMatch.index) + ', 店铺ID as shopId, 店铺代码 as shopCode' + ' ' + baseSQL.slice(fromMatch.index)
      : baseSQL;
    const shopsRes = await pool.request()
      .input('wt', sql.NVarChar, warehouseType)
      .query(`
        SELECT shopId, shopCode, shopName
        FROM ( ${fullSQL} ) t
        WHERE warehouseType = @wt
        ORDER BY shopCode`);
    const shops = shopsRes.recordset;
    result.shopTotal = shops.length;
    if (shops.length === 0) {
      result.warnings.push({ level: 'warn', text: `店铺档案中仓库类别「${warehouseType}」没有店铺，未做任何写入` });
      return result;
    }

    // 3) 对每个职能组计算绑定计划（已绑定跳过 / 需新增）
    interface GroupPlan { group: any; bound: number; created: number; insertList: any[] }
    const plans: GroupPlan[] = [];
    for (const id of validIds) {
      const g = groupById.get(id);
      const gPrefix = (g.ancestors || '') + g.org_id + '/';
      const existRes = await pool.request()
        .input('id', sql.Int, g.org_id).input('p', sql.NVarChar, gPrefix)
        .query(`SELECT shop_code FROM sys_org WHERE del_flag = 0
          AND (org_id = @id OR ancestors LIKE @p + '%') AND org_type = 'shop' AND shop_code IS NOT NULL`);
      const existCodes = new Set<string>();
      for (const r of existRes.recordset) existCodes.add(String(r.shop_code).trim());
      const list: any[] = [];
      let bound = 0;
      for (const s of shops) {
        const code = String(s.shopCode).trim();
        if (existCodes.has(code)) { bound++; continue; }
        list.push(s);
      }
      plans.push({ group: g, bound, created: list.length, insertList: list });
    }

    const totalCreated = plans.reduce((a, p) => a + p.created, 0);
    const totalBound = plans.reduce((a, p) => a + p.bound, 0);
    result.groups = plans.map(p => ({ groupOrgId: p.group.org_id, groupName: p.group.org_name, bound: p.bound, created: p.created }));
    result.summary = { created: totalCreated, skipped: totalBound, groups: plans.length };

    if (dryRun) {
      result.ok = true;
      result.warnings.unshift({ level: 'info', text: `预览：店铺档案「${warehouseType}」共 ${shops.length} 家店；将在 ${plans.length} 个职能组下新增 ${totalCreated} 个店铺节点、跳过已绑定 ${totalBound} 个` });
      return result;
    }

    // 4) 事务落库
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      for (const p of plans) {
        const g = p.group;
        const gPrefix = (g.ancestors || '') + g.org_id + '/';
        const gLvl = (g.org_level || 1) + 1;
        const bizLine = g.business_line || 'direct';
        const fnLine = g.function_line || '运营';
        for (const s of p.insertList) {
          const req = tx.request();
          req.input('pp', sql.Int, g.org_id)
            .input('nm', sql.NVarChar, String(s.shopName || '').trim())
            .input('lvl', sql.Int, gLvl).input('anc', sql.NVarChar, gPrefix)
            .input('sc', sql.NVarChar, String(s.shopCode).trim())
            .input('sn', sql.NVarChar, String(s.shopName || '').trim())
            .input('wt', sql.NVarChar, warehouseType)
            .input('bl', sql.NVarChar, bizLine).input('fl', sql.NVarChar, fnLine);
          await req.query(`
            INSERT INTO sys_org (parent_org_id, org_name, org_type, org_level, ancestors,
              shop_code, shop_name, warehouse_type, business_line, function_line, status, del_flag, create_time, update_time)
            VALUES (@pp, @nm, 'shop', @lvl, @anc, @sc, @sn, @wt, @bl, @fl, 1, 0, GETDATE(), GETDATE())`);
        }
      }
      await tx.commit();
    } catch (txErr) {
      try { await tx.rollback(); } catch { /* ignore */ }
      throw txErr;
    }

    result.ok = true;
    result.warnings.unshift({ level: 'info', text: `执行完成：${plans.length} 个职能组下共新增 ${totalCreated} 个店铺节点（` + plans.map(p => `${p.group.org_name} +${p.created}`).join('，') + `），跳过已绑定 ${totalBound} 个；未删除/移动任何既有数据` });
    return result;
  } catch (err) {
    result.ok = false;
    result.warnings.push({ level: 'warn', text: '职能组镜像失败，已回滚：' + String(err) });
    return result;
  }
}