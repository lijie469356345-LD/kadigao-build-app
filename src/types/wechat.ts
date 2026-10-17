// ============================================================
// 企业微信推送 - 类型定义
// ============================================================

/** 接收人配置 */
export interface WechatRecipient {
  id?: number;
  wechatAccount: string;        // 企业微信账号/工号
  name: string;                 // 姓名
  isEnabled: boolean;           // 是否启用（临时剔除功能）
  createdAt?: string;
  updatedAt?: string;
}

/** 推送日志 */
export interface WechatPushLog {
  id?: number;
  logId: number;                // 巡店日志ID
  supervisor: string;           // 督导
  destination: string;          // 目的地/店铺
  recipientName: string;        // 接收人姓名
  recipientAccount: string;     // 接收人账号
  status: 'pending' | 'success' | 'failed' | 'skipped';
  message: string;              // 推送内容（冗余存储）
  errorDetail?: string;         // 失败原因
  retryCount: number;           // 重试次数
  triggeredAt: string;          // 实际推送触发时间
  createdAt?: string;
}

/** 消息模板配置 */
export interface WechatTemplateConfig {
  title: string;                // 标题
  headerTemplate: string;       // 头部信息模板
  itemTemplate: string;         // 单个核查项模板
  footerTemplate: string;       // 页脚
}

/** 推送总开关配置 */
export interface WechatPushSettings {
  enabled: boolean;             // 全局开关
  pollingEnabled: boolean;      // 轮询兜底开关
  pollingInterval: number;      // 轮询间隔(秒)，默认30
  wechatCorpId?: string;        // 企业微信CorpID
  wechatSecret?: string;        // 企业微信Secret
  wechatAgentId?: string;       // 应用AgentId
}

/** 推送摘要（用于日志查询） */
export interface WechatPushSummary {
  totalToday: number;
  successToday: number;
  failedToday: number;
  pending: number;
  lastPushTime?: string;
  lastPushLogId?: number;
}

/** 推送请求（单次手动触发） */
export interface WechatPushRequest {
  logId: number;
  recipientIds?: number[];      // 指定接收人，不传则用全部启用的
}
