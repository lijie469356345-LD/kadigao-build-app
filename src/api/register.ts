import axios from './axios';

// ============================================================
// 注册审核 API（对应后端 /api/register）
// 公开：options（下拉数据源）、apply（提交注册申请）
// 管理（需登录且授权 registerAudit 菜单）：applications / approve / reject
// ============================================================

export interface RegisterOption {
  orgId: number;
  orgName: string;
  orgType: string;
  orgLevel: number;
  warehouseType?: string;
}

export const getRegisterOptions = async () => {
  const res = await axios.get('/register/options');
  return res.data as { warehouseTypes: string[]; orgs: RegisterOption[] };
};

/** 手机号注册状态检查：ok=可注册 / pending=审核中 / approved=已通过 / rejected=已驳回 / exists=已存在用户 / invalid=格式不对 */
export const checkPhoneStatus = async (phone: string) => {
  const res = await axios.get('/register/check-phone', { params: { phone } });
  return res.data as { status: 'ok' | 'pending' | 'approved' | 'rejected' | 'exists' | 'invalid' };
};

export const submitRegisterApply = async (payload: {
  userName: string;
  phone: string;
  warehouseType: string;
  orgId: number;
  /** 注册引导链路确定的职位（12 项中可对应时传入，后端落 register_apply.position，补充资料弹窗自动带出） */
  position?: string;
}) => {
  const res = await axios.post('/register/apply', payload);
  return res.data as { ok: boolean; message: string; id?: number; userCode?: string };
};

// ============================================================
// 注册引导候选过滤（方案 v4，公开接口）
// scope: shop 门店 | dealer 经销商组 | supervisor 区经/督导 | func 公司职能岗
// ============================================================
export interface GuideCandidate {
  orgId: number;
  orgName: string;
  orgType: string;
  orgLevel: number;
  warehouseType: string;
}

export const getGuideCandidates = async (params: {
  scope: 'shop' | 'dealer' | 'supervisor' | 'func';
  warehouseType?: string;
  region?: string;
  role?: '区经' | '督导';
  dealerName?: string;
  funcDir?: string;
  level?: '总监' | '专员';
}) => {
  const res = await axios.get('/register/guide/candidates', { params });
  return res.data as { candidates: GuideCandidate[] };
};

export interface RegisterApplication {
  id: number;
  applyNo: string;
  userCode: string;
  userName: string;
  phone: string;
  warehouseType: string;
  orgId: number | null;
  orgName: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectReason: string;
  approver: string;
  approverName: string;
  approveTime: string;
  createTime: string;
  // 补充资料字段（与「用户管理」用户全表可编辑字段对应；岗位已删除）
  position?: string;
  wechatAccount?: string;
  store?: string;
  isAdmin?: string;
  password?: string;
}

export const getRegisterApplications = async (status?: string) => {
  const res = await axios.get('/register/applications', { params: { status } });
  return res.data as { applications: RegisterApplication[] };
};

export const approveRegisterApply = async (id: number, payload: { roleId?: number; orgId?: number }) => {
  const res = await axios.post(`/register/applications/${id}/approve`, payload);
  return res.data as { ok: boolean; message: string };
};

export const rejectRegisterApply = async (id: number, reason: string) => {
  const res = await axios.post(`/register/applications/${id}/reject`, { reason });
  return res.data as { ok: boolean; message: string };
};

/** 补充资料：补齐「用户管理」中用户需填写的全部字段（审核人代为录入）
 *  字段键名与用户管理一致（中文列名），勿用 isAdmin/position——authMiddleware 会覆盖身份敏感参数 */
export const supplementRegisterApply = async (id: number, payload: {
  '用户名称': string;
  '手机号': string;
  '仓库类别': string;
  orgId: number | null;
  '职位': string;
  '企微账号': string;
  '密码': string;
  '管理员': string;
}) => {
  const res = await axios.post(`/register/applications/${id}/supplement`, payload);
  return res.data as { ok: boolean; message: string };
};