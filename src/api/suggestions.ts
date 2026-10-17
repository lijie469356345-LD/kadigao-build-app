import axios from './axios';

export interface SuggestionReply {
  id: number; suggestionId: number; senderId: string; senderName: string;
  role: string; senderType: string; replyType: string; text: string; images: string; createdAt?: string;
}

export interface Suggestion {
  id: number; code: string; title: string; category: string; urgent: number;
  content: string; images: string; mode: string; identity: string; shopName: string;
  reporterId: string; reporterName: string; currentLevel: number; currentLevelName: string;
  status: string; escalateSource?: string; escalateReason?: string; createdAt?: string; updatedAt?: string;
}

export const STATUSES = ['待处理', '待补充材料', '已办结', '驳回'];
export const CATEGORIES = ['门店运营', '货品问题', '制度流程', '薪资绩效', '设备故障', '管理建议', '投诉类', '其他'];

export const submitSuggestion = async (data: any) => {
  const res = await axios.post('/suggestions/submit', data);
  return res.data;
};
export const getSuggestions = async (params?: { status?: string; reporterId?: string; role?: number; viewerName?: string; viewerId?: string; keyword?: string; groupName?: string }) => {
  const res = await axios.get('/suggestions', { params: params || {} });
  return res.data as Suggestion[];
};
export const getSuggestionWhoami = async (name?: string) => {
  const res = await axios.get('/suggestions/whoami', { params: name ? { name } : {} });
  return res.data as { level: number };
};
export const getSuggestion = async (id: number) => {
  const res = await axios.get(`/suggestions/${id}`);
  return res.data as Suggestion & { replies: SuggestionReply[] };
};
export const postSuggestionMsg = async (id: number, data: any) => {
  const res = await axios.post(`/suggestions/${id}/reply`, data);
  return res.data;
};
export const suggestionAction = async (id: number, data: { action: string; text?: string; images?: string; senderName?: string }) => {
  const res = await axios.post(`/suggestions/${id}/action`, data);
  return res.data;
};
export const suggestionSupplement = async (id: number, data: { text?: string; images?: string }) => {
  const res = await axios.post(`/suggestions/${id}/supplement`, data);
  return res.data;
};
export const uploadSuggestionFiles = async (files: File[]) => {
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  const res = await axios.post('/suggestions/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  return res.data.urls as string[];
};