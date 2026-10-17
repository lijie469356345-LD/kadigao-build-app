import axios from './axios';

// 保存月目标分解
export const saveMonthlyTargets = (data: {
  year: number;
  month: number;
  items: Array<{
    shopName: string;
    districtManager: string;
    supervisor: string;
    monthlyTarget: number;
    dailyTargets: Array<{
      dayIndex: number;
      dayOfWeek: string;
      coefficient: number;
      target: number;
      group: string;
    }>;
  }>;
  operator: string;
  groupName?: string;
}) => {
  return axios.post('/monthly-target/save', data);
};

// 查询已保存的月目标分解
export const getMonthlyTargets = (params: {
  year: number;
  month: number;
  groupName?: string;
}) => {
  return axios.get('/monthly-target/list', { params });
};

// 查询某年月的分解比例（前段占比）
export const getMonthlyTargetRatio = (params: {
  year: number;
  month: number;
}) => {
  return axios.get('/monthly-target/ratio', { params });
};

// 保存某年月的分解配置（前段占比 0~1 + 前/后段截止日）
export const saveMonthlyTargetRatio = (data: {
  year: number;
  month: number;
  ratio: number;
  firstEnd?: number;
  secondEnd?: number;
}) => {
  return axios.post('/monthly-target/ratio', data);
};

// 清空某年某月的月目标分解（仅区经/管理员）
export const clearMonthlyTargets = (data: {
  year: number;
  month: number;
  operator: string;
  groupName?: string;
}) => {
  return axios.post('/monthly-target/clear', data);
};

// 查询某店铺的日目标明细
export const getDailyTargets = (targetId: number) => {
  return axios.get(`/monthly-target/daily/${targetId}`);
};

// 提交变更申请
export const submitChangeRequest = (data: {
  targetId?: number;
  year: number;
  month: number;
  shopName: string;
  districtManager?: string;
  supervisor?: string;
  oldTarget?: number;
  newTarget: number;
  reason?: string;
  applicant: string;
  applicantGroup?: string;
}) => {
  return axios.post('/monthly-target/change-request', data);
};

// 审批变更申请
export const approveChangeRequest = (data: {
  requestId: number;
  action: 'approve' | 'reject';
  approver: string;
  approverGroup?: string;
  comment?: string;
  newDailyTargets?: Array<{
    dayIndex: number;
    dayOfWeek: string;
    coefficient: number;
    target: number;
    group: string;
  }>;
}) => {
  return axios.post('/monthly-target/approve', data);
};

// 查询变更申请列表
export const getChangeRequests = (params: {
  year?: number;
  month?: number;
  groupName?: string;
  status?: string;
}) => {
  return axios.get('/monthly-target/change-requests', { params });
};

// 按日期范围查询日目标汇总（供销售报表用）
export const fetchDailyTargetsByRange = (params: {
  startDate: string;
  endDate: string;
  groupName?: string;
  shopNames?: string;
}) => {
  return axios.get('/monthly-target/daily-targets', { params });
};
