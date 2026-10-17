import { getPositionOptions } from '../../api/positions';

// 用户「职位」字段的可选值（内置默认 12 项；页面运行时优先从职位表加载，接口不可用时回退本列表）
export const POSITION_OPTIONS = [
  '公司',
  '运营',
  '督导',
  '经销商',
  '店长',
  '店员',
  '商品',
  '财务',
  '稽查',
  '人事',
  '采购',
  '数据',
] as const;

export type UserPosition = typeof POSITION_OPTIONS[number];

/** 内置默认「职位→组织映射」（与后端播种一致；仅在职位表接口不可用时兜底） */
export const POSITION_DEFAULT_ORG_MAP: Record<string, { orgType: string; orgNameKw: string }> = {
  '公司':   { orgType: 'company', orgNameKw: '' },
  '运营':   { orgType: 'director|group', orgNameKw: '运营|会员|区经' },
  '督导':   { orgType: 'supervisor_group', orgNameKw: '' },
  '经销商': { orgType: 'dealer_group', orgNameKw: '' },
  '店长':   { orgType: 'shop', orgNameKw: '' },
  '店员':   { orgType: 'shop', orgNameKw: '' },
  '商品':   { orgType: 'director|group', orgNameKw: '商品' },
  '财务':   { orgType: 'director|group', orgNameKw: '财务|出纳' },
  '稽查':   { orgType: 'director|group', orgNameKw: '稽查' },
  '人事':   { orgType: 'director|group', orgNameKw: '人事|行政' },
  '采购':   { orgType: 'director|group', orgNameKw: '采购' },
  '数据':   { orgType: 'director|group', orgNameKw: 'IT|数据' },
};

export interface PositionItem {
  positionName: string;
  roleId: number | null;
  orgType: string | null;    // 职位→组织类型映射（null 表示不自动带出组织）
  orgNameKw: string | null;  // 组织名称关键词（null 表示不过滤）
}

/**
 * 从职位表（sys_position）加载可选职位、关联角色及组织映射。
 * - 成功：返回职位表全部启用项（含 roleId/orgType，供职位→角色/职位→组织自动带出）
 * - 失败（未登录/网络等）：回退内置 12 项（含默认组织映射，保证带出逻辑仍可用）
 */
export async function loadPositionItems(): Promise<PositionItem[]> {
  try {
    const res = await getPositionOptions();
    const items = res.items || [];
    if (items.length > 0) {
      return items.map(i => ({
        positionName: String(i.position_name),
        roleId: i.role_id != null ? Number(i.role_id) : null,
        orgType: i.org_type != null && i.org_type !== '' ? String(i.org_type) : null,
        orgNameKw: i.org_name_kw != null && i.org_name_kw !== '' ? String(i.org_name_kw) : null,
      }));
    }
  } catch { /* 接口不可用回退内置 */ }
  return POSITION_OPTIONS.map(p => ({
    positionName: p,
    roleId: null,
    orgType: POSITION_DEFAULT_ORG_MAP[p]?.orgType ?? null,
    orgNameKw: POSITION_DEFAULT_ORG_MAP[p]?.orgNameKw ?? null,
  }));
}

/** 按职位名查「职位→组织映射」；找不到或未配置返回 null */
export function findPositionOrgMap(items: PositionItem[] | undefined, position: string | undefined): { orgType: string; orgNameKw: string } | null {
  if (!items || !position) return null;
  const it = items.find(i => i.positionName === position);
  if (!it?.orgType) return null;
  return { orgType: it.orgType, orgNameKw: it.orgNameKw ?? '' };
}