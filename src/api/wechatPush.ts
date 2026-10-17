import axios from './axios';

export interface WechatRecipient {
  id: number;
  wechatAccount: string;
  name: string;
  isEnabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface WechatPushLogRow {
  id: number; logId: number; supervisor: string; destination: string;
  recipientName: string; recipientAccount: string; status: string;
  errorDetail?: string; retryCount: number; triggeredAt: string; createdAt: string;
}

export interface WechatSettings {
  id?: number; enabled: boolean; pollingEnabled: boolean; pollingInterval: number;
  wechatCorpId?: string; wechatSecret?: string; wechatAgentId?: string; proxyUrl?: string;
}

export interface WechatTemplateConfig {
  id?: number; moduleName: string; title: string;
  headerTemplate: string; itemTemplate: string; singleItemLine: string;
  photoLineTemplate: string; footerTemplate: string;
  recipientGroup?: string; recipientPosition?: string; isDefault?: boolean;
}

export interface WechatRecipientUser {
  userCode: string; userName: string; phone: string;
  groupName: string; position: string; wechatAccount: string;
}

export const getWechatSettings = async () => (await axios.get('/wechat-push/settings')).data;
export const updateWechatSettings = async (s: WechatSettings) => (await axios.put('/wechat-push/settings', s)).data;

// Templates (multi)
export const getWechatTemplates = async (): Promise<WechatTemplateConfig[]> => {
  const resp = await axios.get('/wechat-push/template');
  // 兼容新旧格式
  const data = resp.data;
  if (Array.isArray(data)) return data;
  if (data.template) return [{ moduleName: '巡店日志', ...data.template, isDefault: true }];
  return [];
};
export const createWechatTemplate = async (tpl: WechatTemplateConfig) => (await axios.post('/wechat-push/template', tpl)).data;
export const updateWechatTemplate = async (id: number, tpl: WechatTemplateConfig) => (await axios.put(`/wechat-push/template/${id}`, tpl)).data;
export const deleteWechatTemplate = async (id: number) => (await axios.delete(`/wechat-push/template/${id}`)).data;
export const previewWechatTemplate = async (params: any) => (await axios.post('/wechat-push/template/preview', params)).data;

// Recipients（组织/角色维度筛选，岗位已下线；groupName=组织名、position=角色名聚合）
export const getWechatRecipients = async (params?: { search?: string; roleId?: number | string; orgId?: number | string }) =>
  (await axios.get('/wechat-push/recipients', { params })).data;

export const getWechatRecipientsOld = async () => {
  const resp = await axios.get('/wechat-push/recipients');
  return resp.data;
};
export const addWechatRecipient = async (r: { wechatAccount: string; name: string; isEnabled?: boolean }) =>
  (await axios.post('/wechat-push/recipients', r)).data;
export const updateWechatRecipient = async (id: number, r: { wechatAccount?: string; name?: string; isEnabled?: boolean }) =>
  (await axios.put(`/wechat-push/recipients/${id}`, r)).data;
export const removeWechatRecipient = async (id: number) => (await axios.delete(`/wechat-push/recipients/${id}`)).data;

// Logs
export const getWechatPushLogs = async (params?: any) => (await axios.get('/wechat-push/logs', { params })).data;
export const pushWechat = async (logId: number, payload?: any) => (await axios.post(`/wechat-push/push/${logId}`, payload || {})).data;
export const pushWechatBatch = async (payload: { logIds: number[] }) => (await axios.post('/wechat-push/push-batch', payload)).data;

export const getWechatPushStatus = async () => (await axios.get('/wechat-push/status')).data;
export const triggerPolling = async () => (await axios.post('/wechat-push/poller/trigger')).data;
export const getWechatStatus = getWechatPushStatus;
export const triggerWechatPoller = triggerPolling;
export const initWechatPush = async () => (await axios.post('/wechat-push/init')).data;
export const pushBatchLogs = async (logIds: number[]) => (await axios.post('/wechat-push/push-batch', { logIds })).data;

// ==================== 媒体文件上传与推送 ====================

/** 上传媒体文件到企微素材库，返回 { media_id, type } */
export const uploadWechatMedia = async (file: File) => {
  const form = new FormData();
  form.append('media', file);
  return (await axios.post('/wechat-push/media/upload', form)).data;
};

/** 发送媒体消息给指定用户 */
export const sendWechatMedia = async (params: {
  recipients: string[];
  mediaId: string;
  msgtype?: 'image' | 'video' | 'file';
  text?: string;
}) => (await axios.post('/wechat-push/media/send', params)).data;

/** 获取服务器上已有的视频列表（来自 shipin 文件夹） */
export const getShipinVideos = async (): Promise<{ ok: boolean; total: number; files: { index: number; name: string; sizeMB: string; url: string }[] }> =>
  (await axios.get('/shipin/list')).data;
