import axios from './axios';

// ============================================================
// 职位管理 API（对应后端 /api/positions）
// sys_position 表：职位名称 + 关联角色（role_id）+ 组织映射（org_type/org_name_kw），页面可自行添加/删除
// ============================================================

export interface PositionRow {
  position_id: number;
  position_name: string;
  role_id: number | null;
  role_name: string | null;
  org_type: string | null;    // 职位→组织类型映射（| 组合多个类型；null 表示不自动带出）
  org_name_kw: string | null; // 组织名称关键词（| 分隔 OR；null 表示不过滤）
  status: number;
  create_time?: string;
  user_count: number; // 用户全表「职位」列引用人数
}

export const getPositionList = async () => {
  const res = await axios.get('/positions');
  return res.data as { positions: PositionRow[] };
};

export const getPositionOptions = async () => {
  const res = await axios.get('/positions/options');
  return res.data as { items: { position_name: string; role_id: number | null; org_type: string | null; org_name_kw: string | null }[] };
};

export const createPosition = async (payload: { positionName: string; roleId?: number | null; orgType?: string | null; orgNameKw?: string | null }) => {
  const res = await axios.post('/positions', payload);
  return res.data as { positionId: number };
};

export const updatePosition = async (id: number, payload: { roleId?: number | null; orgType?: string | null; orgNameKw?: string | null }) => {
  const res = await axios.put(`/positions/${id}`, payload);
  return res.data as { ok: boolean };
};

export const deletePosition = async (id: number) => {
  const res = await axios.delete(`/positions/${id}`);
  return res.data as { ok: boolean };
};