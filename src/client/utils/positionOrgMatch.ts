// ============================================================
// 职位 → 组织 自动匹配（表驱动）
//
// 使用场景：注册审核（通过弹窗/补充资料）与用户管理（新增/编辑）中选择职位时，
//   按职位自动带出候选归属组织（审核人/管理员仍可手动修改）。
//
// 「职位 → 组织类型」映射不再写死在这里，而是由职位表 sys_position 维护：
//   - org_type   目标组织类型（sys_org.org_type），支持 | 组合多个类型
//                company / supervisor_group / dealer_group / shop / director / group
//   - org_name_kw 组织名称关键词过滤（| 分隔，OR 语义；空表示不过滤）
//   调用方需传入职位表加载的映射列表（positionItems / PositionItem[]）。
//
// 仍保留在代码里的只是「运行时收窄启发式」：
//   - 督导/经销商 → 按申请人姓名收窄到「督导_姓名/经销商_姓名」节点
//   - 门店 → 按申请人店铺名/仓库类别收窄
//   这些依赖候选人具体信息（姓名/店铺/仓库），不属于职位表的静态映射。
// ============================================================

export interface OrgNodeLight {
  orgId: number;
  orgName: string;
  orgType: string;
  orgLevel: number;
  warehouseType?: string;
  shopName?: string;
}

/** 归一化：用户管理 getOrgTree 节点 → 轻量组织节点 */
export function toOrgLight(n: any): OrgNodeLight {
  return {
    orgId: Number(n.org_id ?? n.orgId),
    orgName: String(n.org_name ?? n.orgName ?? ''),
    orgType: String(n.org_type ?? n.orgType ?? ''),
    orgLevel: Number(n.org_level ?? n.orgLevel ?? 1),
    warehouseType: n.warehouse_type ?? n.warehouseType ?? '',
    shopName: n.shop_name ?? n.shopName ?? '',
  };
}

/** 职位→组织映射条目（与职位表 /positions/options 返回一致） */
export interface PositionOrgMapItem {
  positionName: string;
  orgType: string | null;   // 目标组织类型（| 组合）；null = 未配置，不自动带出
  orgNameKw: string | null; // 组织名称关键词（| 分隔 OR）；null = 不过滤
}

/** 名称关键词（'a|b'）→ 正则；空/未配置返回 null（不过滤） */
function kwRegex(kw: string | null | undefined): RegExp | null {
  if (!kw) return null;
  const parts = String(kw).split('|').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  return new RegExp(parts.map(escapeRegex).join('|'));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 按职位自动带出候选归属组织（表驱动）。
 * @param position 职位名
 * @param orgs     组织树轻量节点（全量）
 * @param hints    候选人附加信息（姓名/仓库类别/店铺名），用于督导/经销商/门店收窄
 * @param posMap   职位表映射列表（建议传 loadPositionItems() 结果；不传时职位无映射则返回空）
 */
export function matchOrgsByPosition(
  position: string | undefined,
  orgs: OrgNodeLight[],
  hints?: { userName?: string; warehouseType?: string; shopName?: string },
  posMap?: PositionOrgMapItem[],
): OrgNodeLight[] {
  if (!position) return [];
  const name = (hints?.userName || '').trim();
  const wt = (hints?.warehouseType || '').trim();
  const sn = (hints?.shopName || '').trim();
  const list = orgs.filter(o => o.orgName);
  const byType = (t: string) => list.filter(o => o.orgType === t);
  const inName = (arr: OrgNodeLight[], kw: RegExp | null) => (kw ? arr.filter(o => kw.test(o.orgName)) : arr);

  // —— 表驱动取映射：职位表维护「职位 → 组织类型 / 名称关键词」——
  const map = posMap?.find(i => i.positionName === position);
  if (!map?.orgType) return []; // 职位未配置组织映射 → 空，由操作人手动选择

  const targetTypes = map.orgType.split('|').map(s => s.trim()).filter(Boolean);
  // 候选 = 各目标类型组织，再按名称关键词过滤（关键词为空则不过滤）
  let cands = targetTypes.flatMap(t => byType(t));
  cands = inName(cands, kwRegex(map.orgNameKw));
  if (cands.length === 0) return cands;

  // —— 运行时收窄启发式（依赖候选人信息，不属于职位表静态映射）——
  const hasType = (t: string) => targetTypes.includes(t);

  // 督导/经销商：优先按姓名收窄到「督导_姓名 / 经销商_姓名」节点
  if (hasType('supervisor_group') && name) {
    const exact = cands.filter(o => o.orgName.includes(name));
    if (exact.length > 0) return exact;
  }
  if (hasType('dealer_group') && name) {
    const exact = cands.filter(o => o.orgName.includes(name));
    if (exact.length > 0) return exact;
  }
  // 门店：优先按店铺名/仓库类别收窄
  if (hasType('shop')) {
    if (sn) {
      const m = cands.filter(o => o.orgName.includes(sn) || ((o.shopName || '') && o.shopName!.includes(sn)));
      if (m.length > 0) return m;
    } else if (wt) {
      const m = cands.filter(o => (o.warehouseType || '') === wt || (o.warehouseType || '').includes(wt));
      if (m.length > 0) return m;
    }
  }
  return cands;
}