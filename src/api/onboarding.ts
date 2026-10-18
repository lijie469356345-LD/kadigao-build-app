import axios from './axios';

// ============================================================
// 入职管理 API（对应后端 /api/onboarding）
// 公开：options（下拉数据源）、apply（新员工提交入职）
// 管理（需登录且授权 onboarding 菜单）：records / review / admin-open / issue /
//   confirm-probation / apply-badge / badge-ledger / reimburse / card-adjust / timeout-logs
// ============================================================

export interface OnboardingOptions {
  supervisors: { userCode: string; userName: string }[];
  shops: { orgId: number; orgName: string; warehouseType: string }[];
  levels: string[];
  salarySchemes: { id: number; schemeName: string; schemeDesc: string }[];
}

export interface OnboardingRecord {
  id: number;
  applyNo: string;
  userCode: string;
  phone: string;
  userName: string;
  gender: string;
  idCard: string;
  birthday: string;
  education: string;
  emergencyContact: string;
  emergencyPhone: string;
  address: string;
  email: string;
  resumeText: string;
  materials: string[];
  status: string;
  supervisorCode: string;
  supervisorName: string;
  reviewerCode: string;
  reviewerName: string;
  reviewTime: string;
  rejectReason: string;
  shopId: number | null;
  shopName: string;
  level: string;
  salarySchemeId: number | null;
  salarySchemeName: string;
  gradeTime: string;
  adminUserCode: string;
  adminBojunAccount: string;
  adminGroupQr: string;
  adminMemberQr: string;
  memberCode: string;
  adminFinishTime: string;
  issueTime: string;
  probationStart: string;
  probationEnd: string;
  probationConfirmTime: string;
  probationConfirmBy: string;
  badgeApplyTime: string;
  badgeNo: string;
  badgeAmount: number | null;
  wecomQr: string;
  day3Warned: number;
  day7Logged: number;
  remark: string;
  createTime: string;
  daysElapsed: number | null;
  deadlineDays: number | null;
}

export interface BadgeLedgerItem {
  id: number;
  recordId: number;
  applyNo: string;
  userName: string;
  phone: string;
  shopName: string;
  level: string;
  badgeNo: string;
  status: string;
  maker: string;
  amount: number | null;
  reimburseNo: string;
  applyTime: string;
  submitMakeTime: string;
  madeTime: string;
  reimburseTime: string;
  financeReviewer: string;
  remark: string;
}

export interface ReimburseItem {
  id: number;
  ledgerId: number;
  recordId: number;
  reimburseNo: string;
  amount: number;
  status: string;
  applyTime: string;
  financeReviewer: string;
  financeReviewTime: string;
  userName: string;
  applyNo: string;
  shopName: string;
  badgeNo: string;
  remark: string;
}

export interface CardAdjustItem {
  id: number;
  userName: string;
  userCode: string;
  phone: string;
  memberCode: string;
  adjustType: string;
  adjustTypeLabel: string;
  reason: string;
  submitter: string;
  status: string;
  handler: string;
  handleTime: string;
  remark: string;
  createTime: string;
}

export interface TimeoutLogItem {
  id: number;
  recordId: number;
  applyNo: string;
  warnType: string;
  warnTypeLabel: string;
  warnTime: string;
  content: string;
  userName: string;
  supervisorName: string;
}

// ---------- 公开 ----------
export const getOnboardingOptions = async () => {
  const res = await axios.get('/onboarding/options');
  return res.data as OnboardingOptions;
};

/** 佐证材料图片上传（公开，扫码页无登录态），返回 /uploads/onboarding/ 相对路径 */
export const uploadOnboardingImage = async (file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  const res = await axios.post('/onboarding/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  return res.data as { ok: boolean; url: string; message?: string };
};

export const applyOnboarding = async (payload: {
  userName: string;
  phone: string;
  gender?: string;
  idCard?: string;
  birthday?: string;
  education?: string;
  emergencyContact?: string;
  emergencyPhone?: string;
  address?: string;
  email?: string;
  resumeText?: string;
  materials?: string[];
  supervisorCode: string;
}) => {
  const res = await axios.post('/onboarding/apply', payload);
  return res.data as { ok: boolean; message: string; id?: number; userCode?: string };
};

// ---------- 管理：记录列表 / 详情（status 支持逗号分隔多状态，如 'account_ready,probation'） ----------
export const getOnboardingRecords = async (status?: string) => {
  const res = await axios.get('/onboarding/records', { params: status ? { status } : {} });
  return res.data as { records: OnboardingRecord[] };
};

export const getOnboardingRecord = async (id: number) => {
  const res = await axios.get(`/onboarding/records/${id}`);
  return res.data as { record: OnboardingRecord };
};

// ---------- 管理：督导初审（驳回/同意+定级） ----------
export const reviewOnboarding = async (
  id: number,
  payload: { action: 'reject' | 'approve'; reason?: string; shopId?: number; level?: string; salarySchemeId?: number },
) => {
  const res = await axios.post(`/onboarding/records/${id}/review`, payload);
  return res.data as { ok: boolean; message: string };
};

// ---------- 管理：行政快速建用户（一键集成 4 项） ----------
export const adminOpenOnboarding = async (
  id: number,
  payload: { adminUserCode?: string; bojunAccount?: string; groupQr?: string; memberCode?: string; password?: string; confirm: boolean },
) => {
  const res = await axios.post(`/onboarding/records/${id}/admin-open`, payload);
  return res.data as { ok: boolean; message: string; adminUserCode?: string };
};

// ---------- 管理：督导下发（进入 15 天考核期） ----------
export const issueOnboarding = async (id: number) => {
  const res = await axios.post(`/onboarding/records/${id}/issue`);
  return res.data as { ok: boolean; message: string };
};

// ---------- 管理：督导确认考核 ----------
export const confirmProbation = async (id: number, payload: { result: 'pass' | 'fail'; reason?: string }) => {
  const res = await axios.post(`/onboarding/records/${id}/confirm-probation`, payload);
  return res.data as { ok: boolean; message: string };
};

// ---------- 管理：督导提交工牌制作申请（转正后，含员工个人企微二维码） ----------
export const applyBadge = async (id: number, payload: { badgeNo?: string; amount?: number; wecomQr?: string }) => {
  const res = await axios.post(`/onboarding/records/${id}/apply-badge`, payload);
  return res.data as { ok: boolean; message: string };
};

// ---------- 管理：工牌台账 ----------
export const getBadgeLedger = async (status?: string) => {
  const res = await axios.get('/onboarding/badge-ledger', { params: status ? { status } : {} });
  return res.data as { ledgers: BadgeLedgerItem[] };
};

export const submitBadgeMaking = async (id: number, payload: { maker: string; amount?: number; remark?: string }) => {
  const res = await axios.post(`/onboarding/badge-ledger/${id}/submit-making`, payload);
  return res.data as { ok: boolean; message: string };
};

/** 批量提交多条待制作工牌：统一广告公司，逐条金额 → 每人生成报销单并流转财务 */
export const batchSubmitBadgeMaking = async (payload: { ids: number[]; maker: string; amounts: Record<number, number>; remark?: string }) => {
  const res = await axios.post('/onboarding/badge-ledger/batch-submit-making', payload);
  return res.data as { ok: boolean; message: string };
};

// ---------- 管理：工牌报销单 ----------
export const getReimburses = async (status?: string) => {
  const res = await axios.get('/onboarding/reimburse', { params: status ? { status } : {} });
  return res.data as { reimburses: ReimburseItem[] };
};

export const financeReview = async (id: number, payload: { action: 'approve' | 'reject'; remark?: string }) => {
  const res = await axios.post(`/onboarding/reimburse/${id}/finance-review`, payload);
  return res.data as { ok: boolean; message: string };
};

// ---------- 管理：内购卡调整提醒（仅列表，记录由入职/离职流程自动写入） ----------
export const getCardAdjusts = async (status?: string) => {
  const res = await axios.get('/onboarding/card-adjust', { params: status ? { status } : {} });
  return res.data as { adjusts: CardAdjustItem[] };
};

/** 内购卡调整「确认已处理」：会员专员在会员系统完成调整后回填状态 */
export const markCardAdjustDone = async (id: number, payload?: { remark?: string }) => {
  const res = await axios.post(`/onboarding/card-adjust/${id}/mark-done`, payload || {});
  return res.data as { ok: boolean; message: string };
};

// ---------- 管理：超时台账 ----------
export const getTimeoutLogs = async () => {
  const res = await axios.get('/onboarding/timeout-logs');
  return res.data as { logs: TimeoutLogItem[] };
};