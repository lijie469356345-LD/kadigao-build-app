// 企微推送 V2 API 客户端（多门户多模块）
import axios from './axios';

export interface PushModule {
  moduleCode: string; moduleName: string; portalCode: string; portalName: string;
  sourceTable: string; sourceIdField: string; isActive: boolean; pollingEnabled: boolean;
  fieldCount: number;
}

export interface PushTemplateField {
  fieldKey: string; fieldName: string; fieldType: string;
  category: 'basic' | 'detail' | 'calculated'; sortOrder: number;
  sourceColumn?: string; sourceTable?: string;
  description?: string;
}

export interface PushTemplate {
  id?: number; moduleCode: string; templateName: string;
  title: string; headerTemplate: string; bodyTemplate: string;
  footerTemplate: string; selectedFields: string[]; selectedRecipients?: string[];
  isDefault: boolean; isActive: boolean;
  pushMode?: string; triggerType?: string; triggerConfig?: any;
  dataSourceMode?: 'skip_query' | 'realtime';
  startTime?: string | null;  // 生效开始时间
  endTime?: string | null;     // 生效结束时间
  createdAt?: string; updatedAt?: string;
}

export interface PushLogV2 {
  id: number; moduleCode: string; sourceId: number; sourceTable: string;
  sourceTitle: string; supervisor: string; destination: string;
  recipientName: string; recipientAccount: string;
  messageContent: string; status: string; errorDetail: string;
  retryCount: number; triggeredBy: string; triggeredAt: string; createdAt: string;
  acked?: number;
}

export interface PushLogGroup {
  moduleCode: string; total: number; successCount: number;
  failedCount: number; pendingCount: number; skippedCount: number;
}

export interface PushSettings {
  settings: {
    enabled: boolean; pollingEnabled: boolean; pollingInterval: number;
    wechatCorpId: string; wechatSecret: string; wechatAgentId: string; proxyUrl: string;
  };
  apiConfigured: boolean;
  modules: PushModule[];
}

// 模块
export const getModules = async (): Promise<PushModule[]> =>
  (await axios.get('/wechat-push-v2/modules')).data;

export const getModuleFields = async (code: string): Promise<{ moduleCode: string; fields: PushTemplateField[]; grouped: Record<string, PushTemplateField[]> }> =>
  (await axios.get(`/wechat-push-v2/modules/${code}/fields`)).data;

// 模板
export const getTemplates = async (moduleCode: string): Promise<PushTemplate[]> =>
  (await axios.get(`/wechat-push-v2/modules/${moduleCode}/templates`)).data;

export const getAllTemplates = async (): Promise<PushTemplate[]> =>
  (await axios.get('/wechat-push-v2/templates')).data;

export const createTemplate = async (moduleCode: string, tpl: Partial<PushTemplate>) =>
  (await axios.post(`/wechat-push-v2/modules/${moduleCode}/templates`, tpl)).data;

export const updateTemplate = async (id: number, tpl: Partial<PushTemplate>) =>
  (await axios.put(`/wechat-push-v2/templates/${id}`, tpl)).data;

export const deleteTemplate = async (id: number) =>
  (await axios.delete(`/wechat-push-v2/templates/${id}`)).data;

export const previewTemplate = async (params: any) =>
  (await axios.post('/wechat-push-v2/templates/preview', params)).data;

// 推送
export const manualPush = async (moduleCode: string, sourceIds: number[], forceRepush?: boolean, templateId?: number) =>
  (await axios.post('/wechat-push-v2/push', { moduleCode, sourceIds, forceRepush, templateId })).data;

export const rePushLogs = async (logIds: number[], mode?: string) =>
  (await axios.post('/wechat-push-v2/repush', { logIds, mode })).data;

// 日志
export const getPushLogs = async (params?: {
  moduleCode?: string; status?: string; startDate?: string; endDate?: string;
  keyword?: string; page?: number; pageSize?: number; groupBy?: string;
}) => {
  const resp = await axios.get('/wechat-push-v2/logs', { params });
  return resp.data as { total: number; page: number; pageSize: number; logs: PushLogV2[]; groups: PushLogGroup[] };
};

export const deletePushLog = async (id: number) => (await axios.delete(`/wechat-push-v2/logs/${id}`)).data;
export const batchDeletePushLogs = async (ids: number[]) => (await axios.post('/wechat-push-v2/logs/batch-delete', { ids })).data;

export const getPushStats = async () =>
  (await axios.get('/wechat-push-v2/logs/stats')).data;

// 设置
export const getSettings = async (): Promise<PushSettings> =>
  (await axios.get('/wechat-push-v2/settings')).data;

export const updateSettings = async (s: any) =>
  (await axios.put('/wechat-push-v2/settings', s)).data;

export const testConnection = async () =>
  (await axios.post('/wechat-push-v2/test-connection')).data;

export const getPublicIp = async (): Promise<{ ip: string; error?: string }> =>
  (await axios.get('/wechat-push-v2/public-ip')).data;

export const initV2 = async () =>
  (await axios.post('/wechat-push-v2/init')).data;

// 源数据查询（手动推送用）
export const getSourceData = async (moduleCode: string, params?: { keyword?: string; page?: number; pageSize?: number }) => {
  const resp = await axios.get(`/wechat-push-v2/modules/${moduleCode}/source-data`, { params });
  return resp.data as { total: number; page: number; pageSize: number; sourceTable: string; sourceIdField: string; rows: any[] };
};

// 接收人选项（组织/角色维度，岗位已下线）
export interface RecipientRoleOption { roleId: number; roleCode: string; roleName: string; }
export interface RecipientOrgOption { orgId: number; orgName: string; orgType: string; orgLevel: number; }
export const getRecipientOptions = async (): Promise<{ groups: string[]; roles: RecipientRoleOption[]; orgs: RecipientOrgOption[] }> =>
  (await axios.get('/wechat-push-v2/recipient-options')).data;

// groupName=组织名聚合、position=角色名聚合（历史字段名保留，语义为组织/角色）
export interface RecipientUser {
  userCode: string; userName: string; groupName: string; position: string; wechatAccount: string;
}
export const searchRecipients = async (params: { roleId?: number | string; orgId?: number | string; keyword?: string }): Promise<{ total: number; withWechat: RecipientUser[]; withoutWechat: RecipientUser[] }> =>
  (await axios.get('/wechat-push-v2/recipient-search', { params })).data;
