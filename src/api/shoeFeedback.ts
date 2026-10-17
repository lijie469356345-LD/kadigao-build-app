import axios from './axios';

// H5端：提交反馈（含文件上传）
export const submitShoeFeedback = async (data: FormData) => {
  const response = await axios.post('/shoe-feedback', data, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

// H5端：提交同意/不同意
export const decideShoeFeedback = async (id: number, data: { agree: boolean; disagreeDesc?: string }) => {
  const response = await axios.post(`/shoe-feedback/${id}/decide`, data);
  return response.data;
};

// H5端：作废（用户未决策就离开页面时调用）
export const voidShoeFeedback = async (feedbackNo: string) => {
  const response = await axios.post(`/shoe-feedback/${feedbackNo}/void`);
  return response.data;
};

// H5端：查询反馈状态
export const getShoeFeedback = async (feedbackNo: string) => {
  const response = await axios.get(`/shoe-feedback/${feedbackNo}`);
  return response.data;
};

// H5端：按手机号查询反馈状态（返回数组）
export const getShoeFeedbackByPhone = async (phone: string) => {
  const response = await axios.get(`/shoe-feedback/phone/${phone}`);
  return response.data;
};

// H5端：提交评价
export const rateShoeFeedback = async (feedbackNo: string, rating: string) => {
  const response = await axios.post(`/shoe-feedback/${feedbackNo}/rate`, { rating });
  return response.data;
};

// 后台：列表查询
export const getShoeFeedbackList = async (params: { status?: string; keyword?: string; agree?: string; pushed?: string; page?: number; pageSize?: number }) => {
  const response = await axios.get('/shoe-feedback', { params });
  return response.data;
};

// 后台：详情
export const getShoeFeedbackDetail = async (id: number) => {
  const response = await axios.get(`/shoe-feedback/detail/${id}`);
  return response.data;
};

// 后台：处理
export const handleShoeFeedback = async (id: number, remark?: string) => {
  const response = await axios.post(`/shoe-feedback/${id}/handle`, { remark });
  return response.data;
};

// 后台：完成（含补发张数明细）
export const completeShoeFeedback = async (id: number, remark: string, ticketDetails: { label: string; count: number }[]) => {
  const response = await axios.post(`/shoe-feedback/${id}/complete`, { remark, ticketDetails });
  return response.data;
};

// 后台：补发推送（对已完成记录再次推送通知；可传 ticketDetails 修改推送的补发张数）
export const repushShoeFeedback = async (id: number, ticketDetails?: { label: string; count: number }[]) => {
  const response = await axios.post(`/shoe-feedback/${id}/repush`, { ticketDetails });
  return response.data;
};

// 后台：导出（携带与列表一致的筛选条件，按筛选结果导出）
export const exportShoeFeedback = async (params: { status?: string; keyword?: string; agree?: string; pushed?: string } = {}) => {
  const response = await axios.get('/shoe-feedback/export', { params });
  return response.data;
};
