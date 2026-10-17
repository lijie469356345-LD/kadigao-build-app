// ============================================================
// 统一推送调度器（PushDispatcher）
// 各业务模块调用的唯一入口，负责：
//   1) 查找模块的 SchemaProvider
//   2) 加载源数据
//   3) 获取模板配置
//   4) 渲染消息
//   5) 确定接收人
//   6) 调用企微 API 推送
//   7) 写入日志/历史记录
// 能力与 wechatPushService.pushInspectionLog 等价，但模块无关。
// ============================================================

import sql from 'mssql';
import { getPool } from '../../../config/db';
import { pushModuleRegistry, PushTemplateField } from './PushModuleRegistry';
import { getSettings, isApiConfigured } from '../wechatPushService';
import type { WechatSettingsRow } from '../wechatPushService';

// 企微 API 相关
import axios from 'axios';
import FormData from 'form-data';
import sharp from 'sharp';

// ============================================================
// 企微 API 调用层（从 wechatPushService 抽取通用部分）
// ============================================================

const WECHAT_API_BASE = 'https://qyapi.weixin.qq.com';
const MAX_RETRY = 2;
const RETRY_INTERVAL_MS = 5000;

interface AccessToken { token: string; expiresAt: number; }
let _tokenCache: AccessToken | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function buildAxiosProxy(proxyUrl?: string): any | undefined {
  if (!proxyUrl) return undefined;
  try {
    const u = new URL(proxyUrl);
    return {
      protocol: u.protocol === 'https:' ? 'https' : 'http',
      host: u.hostname,
      port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80),
      auth: u.username
        ? { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password || '') }
        : undefined,
    };
  } catch { return undefined; }
}

async function getAccessToken(settings: WechatSettingsRow): Promise<string> {
  if (!settings.wechatCorpId || !settings.wechatSecret) {
    throw new Error('企业微信 CorpID 或 Secret 未配置');
  }
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt > now + 60000) {
    return _tokenCache.token;
  }
  const proxyCfg = buildAxiosProxy(settings.proxyUrl);
  const url = `${WECHAT_API_BASE}/cgi-bin/gettoken?corpid=${encodeURIComponent(settings.wechatCorpId)}&corpsecret=${encodeURIComponent(settings.wechatSecret)}`;
  const resp = await axios.get(url, { proxy: proxyCfg, timeout: 15000 });
  const json: any = resp.data;
  if (json.errcode !== 0) {
    throw new Error(`获取 access_token 失败: errcode=${json.errcode}, errmsg=${json.errmsg}`);
  }
  _tokenCache = {
    token: json.access_token,
    expiresAt: now + (Number(json.expires_in) || 7200) * 1000,
  };
  return _tokenCache.token;
}

async function sendTextMessage(settings: WechatSettingsRow, account: string, content: string): Promise<void> {
  if (!settings.wechatAgentId) throw new Error('AgentId 未配置');
  const token = await getAccessToken(settings);
  const url = `${WECHAT_API_BASE}/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`;
  const body = {
    touser: account,
    msgtype: 'text',
    agentid: Number(settings.wechatAgentId) || 0,
    text: { content },
    safe: 0,
    enable_id_trans: 0,
    // 不开启企微端重复检查：开启后 10 分钟(600s)内内容完全相同的消息会被企微静默丢弃、
    // 但仍返回 errcode=0，造成"日志 success 但实际未送达"的假象；
    // 系统自身的去重（hasBeenPushed / circleUnpushedSourceIds）已足够，allowRepush 模块还要重复推送。
    enable_duplicate_check: 0,
    duplicate_check_interval: 0,
  };
  const resp = await axios.post(url, body, {
    headers: { 'Content-Type': 'application/json' },
    proxy: buildAxiosProxy(settings.proxyUrl),
    timeout: 15000,
  });
  const json: any = resp.data;
  if (json.errcode !== 0) {
    const err = new Error(`推送失败 errcode=${json.errcode}, errmsg=${json.errmsg}`);
    (err as any).errcode = json.errcode;
    throw err;
  }
  // errcode=0 不代表送达：企微对无效成员(不存在/未关注应用)返回 invaliduser，
  // 该部分用户实际未投递，必须显式判失败，否则会出现"日志 success 但企微没收到"的假象。
  const invalid = (json.invaliduser || '').trim();
  if (invalid) {
    const err = new Error(`企微返回无效用户 invaliduser=${invalid}（未送达）`);
    (err as any).errcode = 81013; // 81013: 非法的 UserID
    throw err;
  }
}

function isRetryable(err: any): boolean {
  const code = err?.errcode;
  if (code === 429 || code === 20001 || code === 20002 || code === 301006) return true;
  const msg = String(err?.message || '').toLowerCase();
  return /timeout|socket|econnreset|econnrefused|rate.?limit|429/.test(msg);
}

async function pushToSingle(
  settings: WechatSettingsRow,
  account: string,
  content: string
): Promise<{ success: boolean; error: string; retryCount: number }> {
  let lastErr = '';
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      await sendTextMessage(settings, account, content);
      return { success: true, error: '', retryCount: attempt };
    } catch (err: any) {
      lastErr = err?.message || String(err);
      if (attempt >= MAX_RETRY) break;
      if (!isRetryable(err)) break;
      await sleep(RETRY_INTERVAL_MS);
    }
  }
  return { success: false, error: lastErr, retryCount: MAX_RETRY };
}

// ============================================================
// 简易模板渲染（{变量} 替换）
// ============================================================

function renderTemplate(templateStr: string, data: Record<string, any>): string {
  let result = templateStr;
  for (const [key, val] of Object.entries(data)) {
    let display: string;
    if (val === null || val === undefined) {
      display = '无';
    } else if (Array.isArray(val)) {
      // 数组：展开为多行列表，每行 "键：值"
      display = val.map((item: any, _idx: number) => {
        if (typeof item === 'object' && item !== null) {
          return Object.entries(item).map(([k, v]) => `${k}：${v}`).join('  ');
        }
        return String(item);
      }).join('\n');
    } else if (typeof val === 'object') {
      display = Object.entries(val).map(([k, v]) => `${k}：${v}`).join('  ');
    } else {
      display = String(val);
    }
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), display);
  }
  // 时间占位符
  result = result.replace(/\{time\}/g, new Date().toLocaleString('zh-CN'));
  // 清理未替换的占位符
  result = result.replace(/\{[a-zA-Z0-9_]+\}/g, '无');
  return result;
}

/**
 * 按模板文本渲染推送消息：headerTemplate + bodyTemplate + footerTemplate 拼接后替换占位符。
 * 模型：优先使用用户模板真实文本（与模板编辑器预览一致），而非硬编码排版。
 */
function renderFromTemplate(
  header: string | undefined,
  body: string | undefined,
  footer: string | undefined,
  data: Record<string, any>,
  fallback: string
): string {
  const parts = [header, body, footer].filter(p => p !== undefined && p !== null && String(p).trim() !== '');
  if (parts.length === 0) return fallback;
  const rendered = renderTemplate(parts.join('\n'), data);
  return rendered || fallback;
}

// ============================================================
// 接收人获取（复用 wechatPushService 逻辑）
// ============================================================

import {
  getRecipientsBySupervisorHierarchy,
} from '../wechatPushService';

// ============================================================
// 渲染上下文：从字段列表 + loadRenderData 结果拼装消息文本
// ============================================================

function renderMessageFromData(
  data: Record<string, any>,
  fields: PushTemplateField[],
  moduleName: string
): string {
  const lines: string[] = [];
  const basicFields = fields.filter(f => f.category === 'basic');
  const detailFields = fields.filter(f => f.category === 'detail');

  lines.push(`【${moduleName}】`);

  for (const f of basicFields) {
    const val = data[f.fieldKey.replace(/[{}]/g, '')];
    const display = val !== undefined && val !== null && val !== '' ? String(val) : '无';
    lines.push(`${f.fieldName}：${display}`);
  }

  for (const f of detailFields) {
    const key = f.fieldKey.replace(/[{}]/g, '');
    const val = data[key];
    if (val === undefined || val === null || val === '') continue;
    lines.push('');
    lines.push(`${f.fieldName}：`);
    if (Array.isArray(val)) {
      val.forEach((item: any, idx: number) => {
        if (typeof item === 'object') {
          const parts = Object.entries(item)
            .map(([k, v]) => `${k}：${v}`).join('，');
          lines.push(`  ${idx + 1}. ${parts}`);
        } else {
          lines.push(`  ${idx + 1}. ${String(item)}`);
        }
      });
    } else if (typeof val === 'object') {
      for (const [k, v] of Object.entries(val)) {
        lines.push(`  ${k}：${v}`);
      }
    } else {
      lines.push(`  ${String(val)}`);
    }
  }

  // 计算字段
  const calculatedFields = fields.filter(f => f.category === 'calculated');
  if (calculatedFields.length > 0) {
    lines.push('');
    lines.push('--- 业绩指标 ---');
    for (const f of calculatedFields) {
      const key = f.fieldKey.replace(/[{}]/g, '');
      const val = data[key];
      const display = val !== undefined && val !== null && val !== '' ? String(val) : '暂无数据';
      lines.push(`${f.fieldName}：${display}`);
    }
  }

  lines.push('');
  lines.push('————系统自动推送，无需回复————');

  let result = lines.join('\n');
  if (Buffer.byteLength(result, 'utf8') > 2000) {
    let head = '';
    let bytes = 0;
    for (const ch of result) {
      const b = Buffer.byteLength(ch, 'utf8');
      if (bytes + b > 1950) break;
      head += ch;
      bytes += b;
    }
    result = head + '\n...(内容过长已截断)';
  }
  return result;
}

// ============================================================
// 日志写入
// ============================================================

async function writeLog(params: {
  moduleCode: string; sourceId: number | string; sourceTable: string; sourceTitle?: string;
  supervisor?: string; destination?: string;
  recipientName: string; recipientAccount: string;
  messageContent: string; status: string; errorDetail?: string;
  retryCount?: number; triggeredBy: string; triggeredAt: Date;
}): Promise<number | null> {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('moduleCode', sql.NVarChar, params.moduleCode)
      .input('sourceId', sql.NVarChar, String(params.sourceId))
      .input('sourceTable', sql.NVarChar, params.sourceTable)
      .input('sourceTitle', sql.NVarChar, params.sourceTitle || '')
      .input('supervisor', sql.NVarChar, params.supervisor || '')
      .input('destination', sql.NVarChar, params.destination || '')
      .input('recipientName', sql.NVarChar, params.recipientName)
      .input('recipientAccount', sql.NVarChar, params.recipientAccount)
      .input('messageContent', sql.NVarChar, params.messageContent)
      .input('status', sql.NVarChar, params.status)
      .input('errorDetail', sql.NVarChar, params.errorDetail || '')
      .input('retryCount', sql.Int, params.retryCount || 0)
      .input('triggeredBy', sql.NVarChar, params.triggeredBy)
      .input('triggeredAt', sql.DateTime, params.triggeredAt)
      .query(`
        INSERT INTO WechatPushLogsV2
          (moduleCode, sourceId, sourceTable, sourceTitle, supervisor, destination,
           recipientName, recipientAccount, messageContent, status, errorDetail,
           retryCount, triggeredBy, triggeredAt)
        OUTPUT INSERTED.id
        VALUES (@moduleCode, @sourceId, @sourceTable, @sourceTitle, @supervisor, @destination,
                @recipientName, @recipientAccount, @messageContent, @status, @errorDetail,
                @retryCount, @triggeredBy, @triggeredAt)
      `);
    return result.recordset?.[0]?.id ?? null;
  } catch (err) {
    console.warn('[PushDispatcher] writeLog 失败:', (err as Error).message);
    return null;
  }
}

async function updateLogStatus(id: number, status: string, errorDetail: string, retryCount: number): Promise<void> {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, id)
      .input('status', sql.NVarChar, status)
      .input('errorDetail', sql.NVarChar, errorDetail || '')
      .input('retryCount', sql.Int, retryCount)
      .query('UPDATE WechatPushLogsV2 SET status = @status, errorDetail = @errorDetail, retryCount = @retryCount WHERE id = @id');
  } catch (err) {
    console.warn('[PushDispatcher] updateLogStatus 失败:', (err as Error).message);
  }
}

async function hasBeenPushed(moduleCode: string, sourceId: number | string): Promise<boolean> {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('m', sql.NVarChar, moduleCode)
      .input('s', sql.NVarChar, String(sourceId))
      .query('SELECT id FROM WechatPushHistoryV2 WHERE moduleCode = @m AND sourceId = @s');
    return (result.recordset || []).length > 0;
  } catch { return false; }
}

async function markAsPushed(moduleCode: string, sourceId: number | string, sourceTable: string, pushedBy: string): Promise<void> {
  try {
    const pool = await getPool();
    await pool.request()
      .input('m', sql.NVarChar, moduleCode)
      .input('s', sql.NVarChar, String(sourceId))
      .input('t', sql.NVarChar, sourceTable)
      .input('b', sql.NVarChar, pushedBy)
      .query(`
        IF EXISTS (SELECT 1 FROM WechatPushHistoryV2 WHERE moduleCode = @m AND sourceId = @s)
          UPDATE WechatPushHistoryV2 SET pushedAt = GETDATE(), pushedBy = @b WHERE moduleCode = @m AND sourceId = @s
        ELSE
          INSERT INTO WechatPushHistoryV2 (moduleCode, sourceId, sourceTable, pushedBy) VALUES (@m, @s, @t, @b)
      `);
  } catch (err) {
    console.warn('[PushDispatcher] markAsPushed 失败:', (err as Error).message);
  }
}

// ============================================================
// 核心：按模块推送单条数据
// ============================================================

export interface PushOptions {
  forceRepush?: boolean;
  recipientOverride?: { name: string; wechatAccount: string }[];
  /** 模板配置覆盖 */
  templateTitle?: string;
  templatePushMode?: 'detail' | 'summary';
  templateSelectedFields?: string[];
  /** 模板正文（headerTemplate）：推送时优先按模板文本渲染，而非硬编码排版 */
  templateHeader?: string;
  /** 模板中段（bodyTemplate） */
  templateBody?: string;
  /** 模板尾部（footerTemplate） */
  templateFooter?: string;
}

export interface PushResultItem {
  recipient: string;
  account: string;
  success: boolean;
  error: string;
  retryCount: number;
}

export async function dispatchPush(
  moduleCode: string,
  sourceId: number | string,
  pushedBy: 'auto' | 'polling' | 'manual',
  options?: PushOptions
): Promise<{ summary: string; detail: PushResultItem[] }> {
  const provider = pushModuleRegistry.getProvider(moduleCode);
  if (!provider) {
    return { summary: `未找到模块 ${moduleCode} 的SchemaProvider（可能未注册）`, detail: [] };
  }

  const settings = await getSettings();
  const triggeredAt = new Date();

  // 0) 重复推送拦截（模块 allowRepush=true 时不过滤已推送，有数据就推直到查无数据）
  if (!options?.forceRepush && !provider.allowRepush) {
    const already = await hasBeenPushed(moduleCode, sourceId);
    if (already) {
      return { summary: `模块 ${moduleCode} 的源数据(sourceId=${sourceId})已推送过`, detail: [] };
    }
  }

  // 1) 全局开关
  if (!settings.enabled && pushedBy !== 'manual') {
    return { summary: '推送开关已关闭', detail: [] };
  }

  // 2) 加载数据
  let data: Record<string, any>;
  try {
    data = await provider.loadRenderData(sourceId, await getPool());
  } catch (err: any) {
    return { summary: `加载数据失败: ${err.message}`, detail: [] };
  }
  if (!data) {
    return { summary: `未找到数据 (sourceId=${sourceId}, table=${provider.sourceTable})`, detail: [] };
  }

  // 3) 获取字段 + 渲染消息（若指定了模板的 selectedFields，则按模板字段渲染）
  const providerFields = provider.getAvailableFields();
  const selectedKeys = options?.templateSelectedFields;
  const fields = selectedKeys && selectedKeys.length > 0
    ? providerFields.filter((f: any) => selectedKeys.includes(f.fieldKey))
    : providerFields;

  // 未巡店 / 调休日志：从推送内容中移除所有明细字段（核心事项、店铺问题等）
  const isNoInspection = data['_isNoInspection'] === true;
  let tplHeader = options?.templateHeader;
  let tplBody = options?.templateBody;
  let tplFooter = options?.templateFooter;
  if (isNoInspection) {
    const detailKeys = providerFields
      .filter((f: any) => f.category === 'detail')
      .map((f: any) => f.fieldKey.replace(/[{}]/g, ''));
    // 从 data 中删除明细字段，使 fallback 渲染跳过它们
    for (const dk of detailKeys) {
      delete data[dk];
    }
    // 从模板文本中删除包含明细占位符的整行
    const detailPlaceholders = providerFields
      .filter((f: any) => f.category === 'detail')
      .map((f: any) => f.fieldKey);
    const stripDetailLines = (text: string | undefined): string | undefined => {
      if (!text) return text;
      return text.split('\n')
        .filter(line => !detailPlaceholders.some(p => line.includes(p)))
        .join('\n');
    };
    tplHeader = stripDetailLines(tplHeader);
    tplBody = stripDetailLines(tplBody);
    tplFooter = stripDetailLines(tplFooter);
  }

  const fallbackMessage = renderMessageFromData(data, fields, provider.moduleName);
  // 模板模式：优先使用模板正文（headerTemplate）渲染，与用户在模板编辑器预览的一致
  const message = tplHeader
    ? renderFromTemplate(tplHeader, tplBody, tplFooter, data, fallbackMessage)
    : fallbackMessage;

  // 4) 接收人：优先级 选项覆盖 > 店铺权限组 > 经理+管理组兜底
  let recipients: { name: string; wechatAccount: string }[] = [];
  let recipientSource = '';

  if (options?.recipientOverride && options.recipientOverride.length > 0) {
    recipients = options.recipientOverride;
    recipientSource = '手动指定';
  } else {
    const supervisorName = String(data['supervisor'] || '').trim();
    if (supervisorName) {
      const hierarchy = await getRecipientsBySupervisorHierarchy(supervisorName);
      recipients = hierarchy.list;
      recipientSource = hierarchy.rawGroups.length > 0
        ? `督导上级(${hierarchy.rawGroups.join('/')})`
        : '督导上级';
    }
  }

  if (recipients.length === 0) {
    const errMsg = `未找到任何接收人`;
    await writeLog({
      moduleCode, sourceId, sourceTable: provider.sourceTable,
      sourceTitle: data['_title'] || `${provider.moduleName}#${sourceId}`,
      supervisor: data['supervisor'] || '', destination: data['destination'] || '',
      recipientName: '(系统)', recipientAccount: '(系统)',
      messageContent: message, status: 'skipped',
      errorDetail: errMsg, triggeredBy: pushedBy, triggeredAt,
    });
    return { summary: errMsg, detail: [] };
  }

  // 5) 检查 API 配置
  const apiOk = isApiConfigured(settings);

  // 6) 逐个推送
  const detail: PushResultItem[] = [];
  for (const recipient of recipients) {
    const logIdOut = await writeLog({
      moduleCode, sourceId, sourceTable: provider.sourceTable,
      sourceTitle: data['_title'] || `${provider.moduleName}#${sourceId}`,
      supervisor: data['supervisor'] || '', destination: data['destination'] || '',
      recipientName: recipient.name, recipientAccount: recipient.wechatAccount,
      messageContent: message, status: 'pending',
      triggeredBy: pushedBy, triggeredAt,
    });

    let success = false;
    let error = '';
    let retry = 0;

    if (apiOk) {
      const res = await pushToSingle(settings, recipient.wechatAccount, message);
      success = res.success;
      error = res.error;
      retry = res.retryCount;
    } else {
      error = '企业微信API未配置';
    }

    if (logIdOut) {
      await updateLogStatus(logIdOut, success ? 'success' : 'failed', error, retry);
    }
    detail.push({ recipient: recipient.name, account: recipient.wechatAccount, success, error, retryCount: retry });
  }

  // 7) 标记已推送
  if (detail.some(d => d.success)) {
    await markAsPushed(moduleCode, sourceId, provider.sourceTable, pushedBy);
  }

  const okCount = detail.filter(d => d.success).length;
  return {
    summary: `推送完成（${recipientSource}）：共 ${detail.length} 人，成功 ${okCount} 人`,
    detail,
  };
}

// ============================================================
// 汇总推送：多条记录聚合为一条消息，发送一次
// ============================================================

/** 汇总统计结构 */
interface SummaryStats {
  count: number;
  sums: Record<string, number>;
  texts: Record<string, Set<string>>;
  dateMin: string;
  dateMax: string;
}

function aggregateField(dataList: Record<string, any>[], fields: PushTemplateField[]): SummaryStats {
  const stats: SummaryStats = { count: dataList.length, sums: {}, texts: {}, dateMin: '', dateMax: '' };

  for (const f of fields) {
    const key = f.fieldKey.replace(/[{}]/g, '');
    if (f.fieldType === 'number') {
      stats.sums[key] = 0;
    }
    if (f.fieldType === 'text' || f.fieldType === 'date' || f.fieldType === 'datetime') {
      stats.texts[key] = new Set();
    }
  }

  for (const data of dataList) {
    for (const f of fields) {
      const key = f.fieldKey.replace(/[{}]/g, '');
      const val = data[key];
      if (val === undefined || val === null || val === '') continue;

      if (f.fieldType === 'number') {
        const num = Number(val);
        if (!isNaN(num)) stats.sums[key] = (stats.sums[key] || 0) + num;
      } else if (f.fieldType === 'text') {
        stats.texts[key]?.add(String(val));
      } else if (f.fieldType === 'date' || f.fieldType === 'datetime') {
        const s = String(val).trim();
        if (s && s !== '无' && s !== '暂无数据') {
          stats.texts[key]?.add(s);
          if (!stats.dateMin || s < stats.dateMin) stats.dateMin = s;
          if (!stats.dateMax || s > stats.dateMax) stats.dateMax = s;
        }
      }
    }
  }

  return stats;
}

function computeRate(key: string, raw: Record<string, number>, stats: SummaryStats): string | null {
  const amt = raw['_salesAmount'] || 0;
  const target = raw['_salesTarget'] || 0;
  const qty = raw['_salesQuantity'] || 0;
  const orders = raw['_orderCount'] || 0;
  const customers = raw['_customerCount'] || 0;
  const oldAmt = raw['_oldMemberAmount'] || 0;

  switch (key) {
    case 'salesTarget': return target > 0 ? `${target.toFixed(0)}元（合计）` : null;
    case 'salesAmount': return amt > 0 ? `${amt.toFixed(0)}元（合计）` : null;
    case 'achievementRate': return target > 0 ? `${(amt / target * 100).toFixed(1)}%` : null;
    case 'salesQuantity': return qty > 0 ? `${qty}件（合计）` : null;
    case 'orderCount': return orders > 0 ? `${orders}单（合计）` : null;
    case 'unitPrice': return customers > 0 ? `${(amt / customers).toFixed(0)}元` : null;
    case 'avgItemPrice': return qty > 0 ? `${(amt / qty).toFixed(0)}元` : null;
    case 'attachmentRate': return orders > 0 ? (qty / orders).toFixed(1) : null;
    case 'giftCount': return `${raw['_giftCount'] || 0}个（合计）`;
    case 'newMemberCount': return `${raw['_newMemberCount'] || 0}人（合计）`;
    case 'mainProductCount': return `${raw['_mainProductCount'] || 0}件（合计）`;
    case 'oldMemberAmount': return oldAmt > 0 ? `${oldAmt.toFixed(0)}元（合计）` : null;
    case 'birthdayMemberCount': return `${raw['_birthdayMemberCount'] || 0}人（合计）`;
    case 'customerCount': return customers > 0 ? `${customers}人（合计）` : null;
    default: {
      // 尝试直接取合计
      const sum = stats.sums[key];
      if (sum !== undefined && sum !== 0) return Number(sum).toFixed(2);
      // 尝试原始字段
      const rawVal = raw['_' + key] || raw[key];
      if (rawVal !== undefined && rawVal !== 0) return String(rawVal);
      return null;
    }
  }
}

function renderSummaryMessage(
  dataList: Record<string, any>[],
  fields: PushTemplateField[],
  moduleName: string
): string {
  const stats = aggregateField(dataList, fields);
  // 聚合原始数值（_前缀字段），用于重新计算比率
  const raw: Record<string, number> = {};
  for (const d of dataList) {
    for (const [k, v] of Object.entries(d)) {
      if (k.startsWith('_') && typeof v === 'number') {
        raw[k] = (raw[k] || 0) + v;
      }
    }
    // 也累加显示用的数值字段
    for (const [k, v] of Object.entries(d)) {
      if (!k.startsWith('_') && typeof v === 'number') {
        raw[k] = (raw[k] || 0) + v;
      }
    }
  }

  const lines: string[] = [];

  lines.push(`【${moduleName}汇总】`);
  lines.push('');
  lines.push(`共 ${stats.count} 条记录`);

  const basicFields = fields.filter(f => f.category === 'basic');
  const calculatedFields = fields.filter(f => f.category === 'calculated');

  // 基本信息：文本字段取第一条（如门店名只展示第一个），数字字段汇总
  for (const f of basicFields) {
    const key = f.fieldKey.replace(/[{}]/g, '');
    if (f.fieldType === 'number') {
      const sum = stats.sums[key];
      if (sum !== undefined && sum !== 0) {
        lines.push(`${f.fieldName}：${Number(sum).toFixed(2)}（合计）`);
      }
    } else if (f.fieldType === 'text') {
      const vals = stats.texts[key];
      if (vals && vals.size > 0) {
        const allVals = Array.from(vals);
        if (allVals.length <= 4) {
          lines.push(`${f.fieldName}：${allVals.join('、')}`);
        } else {
          // 明细较多时逐条完整列出，方便核对全部商品
          lines.push(`${f.fieldName}（${allVals.length}个）：`);
          lines.push(allVals.join('、'));
        }
      }
    } else if (f.fieldType === 'date' || f.fieldType === 'datetime') {
      if (stats.dateMin && stats.dateMax) {
        if (stats.dateMin === stats.dateMax) {
          lines.push(`${f.fieldName}：${stats.dateMin}`);
        } else {
          lines.push(`${f.fieldName}：${stats.dateMin} ~ ${stats.dateMax}`);
        }
      }
    }
  }

  // 计算字段：从原始合计重新计算比率
  if (calculatedFields.length > 0) {
    const computedLines: string[] = [];
    for (const f of calculatedFields) {
      const key = f.fieldKey.replace(/[{}]/g, '');
      const val = computeRate(key, raw, stats);
      if (val !== null) {
        computedLines.push(`${f.fieldName}：${val}`);
      }
    }
    if (computedLines.length > 0) {
      lines.push('');
      lines.push('--- 合计 ---');
      lines.push(...computedLines);
    }
  }

  lines.push('');
  lines.push('————系统自动推送，无需回复————');

  let result = lines.join('\n');
  if (Buffer.byteLength(result, 'utf8') > 2000) {
    let head = '';
    let bytes = 0;
    for (const ch of result) {
      const b = Buffer.byteLength(ch, 'utf8');
      if (bytes + b > 1950) break;
      head += ch;
      bytes += b;
    }
    result = head + '\n...(内容过长已截断)';
  }
  return result;
}

/**
 * 按字段分组去重聚合渲染汇总消息（模板正文驱动）：
 * 只聚合模板正文（header + body）中实际勾选的占位符字段（如 {productCode}/{year}），
 * 未在模板中出现的字段一律不推送；模板字面文本（"商品代码："、"预估成本：缺失"）原样保留，
 * 占位符替换为该列去重后的汇总值（顿号并列）。
 * 例：模板「商品代码：{productCode}\n年份：{year}」+ 121 条数据
 *   => 「商品代码：WL001、WL002、…\n年份：2025、2026」
 * 支持特殊占位符：{time}（当前时间）、{count}（数据条数）。
 * 字节策略：整体超预算时从值最多的字段行逐步收缩（每行至少 1 个值），
 * 优先保留首个字段（通常为商品代码）完整；最终仍超则按字节安全截断并保留 footer。
 * 模板未勾选任何字段时：模板正文非空则直接以模板原文推送，模板为空则回退全字段聚合。
 */
function renderGroupedByFieldSummary(
  dataList: Record<string, any>[],
  fields: PushTemplateField[],
  moduleName: string,
  tpl?: { header?: string; body?: string; footer?: string }
): string {
  const footerText = (tpl?.footer != null && tpl.footer.trim() !== ''
      ? tpl.footer
      : '\n————系统自动推送，无需回复————')
    .replace(/\{time\}/g, new Date().toLocaleString('zh-CN'));
  const headTpl = (tpl?.header || '') + (tpl?.body ? '\n' + tpl.body : '');
  const MAX_BYTES = 2000;
  const TRUNC = '\n...(内容过长已截断)';
  const budget = MAX_BYTES - Buffer.byteLength(footerText, 'utf8') - Buffer.byteLength(TRUNC, 'utf8');

  // 模板正文勾选的字段：按占位符出现顺序去重（排除 {time} 特殊占位符）
  const placeholderKeys = Array.from(new Set(
    (headTpl.match(/\{([a-zA-Z0-9_]+)\}/g) || []).map(p => p.slice(1, -1))
  )).filter(k => k !== 'time');
  // 模板没勾选字段：模板正文非空则直接按模板原文推送；模板为空才回退全字段聚合
  const keys: string[] = placeholderKeys.length > 0
    ? placeholderKeys
    : (headTpl.trim() === ''
        ? fields.map(f => f.fieldKey.replace(/[{}]/g, ''))
        : []);

  // 按模板勾选字段聚合去重（保留出现顺序）
  const agg = new Map<string, { label: string; values: string[]; total: number }>();
  for (const key of keys) {
    const f = fields.find(x => x.fieldKey.replace(/[{}]/g, '') === key);
    const seen = new Set<string>();
    for (const d of dataList) {
      const val = d[key];
      if (val === undefined || val === null) continue;
      const s = String(val).trim();
      if (s === '' || (f && f.fieldType === 'number' && Number(val) === 0)) {
        // 数值 0 与空值视为"无成本价"本身特征，合并展示为"缺失"
        continue;
      }
      seen.add(s);
    }
    agg.set(key, { label: f?.fieldName || key, values: Array.from(seen), total: seen.size });
  }

  // 渲染：模板占位符替换为该字段去重汇总值（顿号并列；空则"缺失"）
  const render = (): string => {
    let text = headTpl
      .split('{time}').join(new Date().toLocaleString('zh-CN'))
      .split('{count}').join(String(dataList.length));
    for (const key of keys) {
      const a = agg.get(key);
      if (!a) continue;
      const valueText = a.values.length === 0
        ? '缺失'
        : a.values.join('、');
      text = text.split(`{${key}}`).join(valueText);
    }
    return text;
  };

  // 收缩过程：若整体超预算，优先收缩非首个字段（商品代码行尽量完整显示），
  // 每行至少保留 1 个值；非首字段全部收到 1 个值仍超预算，才收缩首字段。
  let guard = 0;
  for (;;) {
    const text = render();
    if (Buffer.byteLength(text, 'utf8') <= budget) {
      return text + footerText;
    }
    let targetKey: string | null = null;
    for (let i = keys.length > 1 ? 1 : 0; i < keys.length; i++) {
      const a = agg.get(keys[i])!;
      if (a.values.length > 1 && (!targetKey || a.values.length > agg.get(targetKey)!.values.length)) {
        targetKey = keys[i];
      }
    }
    // 非首字段都已只剩 1 个值，才允许收缩首个字段（商品代码）
    if (!targetKey && keys.length > 1 && agg.get(keys[0])!.values.length > 1) {
      targetKey = keys[0];
    }
    if (!targetKey) break; // 所有行都只剩 1 个值仍超预算，交给最终兜底
    const a = agg.get(targetKey)!;
    a.values = a.values.slice(0, Math.ceil(a.values.length / 2));
    if (++guard > 200) break;
  }

  // 最终兜底：按字节安全截断正文，保留 footer
  let result = render();
  if (Buffer.byteLength(result, 'utf8') > budget) {
    let head = '';
    let bytes = 0;
    for (const ch of result) {
      const b = Buffer.byteLength(ch, 'utf8');
      if (bytes + b > budget) break;
      head += ch;
      bytes += b;
    }
    result = head;
  }

  return result + TRUNC + footerText;
}

/** 汇总推送：多条数据聚合后一次性推送给所有接收人 */
// ============================================================
// 自定义通知推送：不依赖源数据，直接发送模板文本
// ============================================================
export async function dispatchCustomNotification(
  messageContent: string,
  pushedBy: 'manual' | 'auto',
  options?: PushOptions
): Promise<{ summary: string; detail: PushResultItem[] }> {
  const settings = await getSettings();
  const triggeredAt = new Date();

  if (!settings.enabled && pushedBy !== 'manual') {
    return { summary: '推送开关已关闭', detail: [] };
  }

  // 接收人：仅模板/手动指定，不再走管理组兜底
  let recipients: { name: string; wechatAccount: string }[] = [];
  if (options?.recipientOverride && options.recipientOverride.length > 0) {
    recipients = options.recipientOverride;
  }
  if (recipients.length === 0) {
    return { summary: '未找到任何接收人', detail: [] };
  }

  const apiOk = isApiConfigured(settings);
  const detail: PushResultItem[] = [];

  for (const recipient of recipients) {
    // 写 pending 日志
    const logIdOut = await writeLog({
      moduleCode: 'custom_notification', sourceId: 0, sourceTable: '(无)',
      sourceTitle: options?.templateTitle || '自定义通知',
      supervisor: '', destination: '',
      recipientName: recipient.name, recipientAccount: recipient.wechatAccount,
      messageContent, status: 'pending',
      triggeredBy: pushedBy, triggeredAt,
    });

    let success = false;
    let error = '';
    let retry = 0;

    if (apiOk) {
      const res = await pushToSingle(settings, recipient.wechatAccount, messageContent);
      success = res.success; error = res.error; retry = res.retryCount;
    } else {
      error = '企业微信API未配置';
    }

    if (logIdOut) {
      await updateLogStatus(logIdOut, success ? 'success' : 'failed', error, retry);
    }
    detail.push({
      recipient: recipient.name, account: recipient.wechatAccount,
      success, error, retryCount: retry,
    });
  }

  const okCount = detail.filter(d => d.success).length;
  return {
    summary: `自定义通知推送完成：共 ${detail.length} 人，成功 ${okCount} 人`,
    detail,
  };
}

export async function dispatchSummaryPush(
  moduleCode: string,
  sourceIds: (number | string)[],
  pushedBy: 'auto' | 'polling' | 'manual',
  options?: PushOptions
): Promise<{ summary: string; detail: PushResultItem[] }> {
  const provider = pushModuleRegistry.getProvider(moduleCode);
  if (!provider) {
    return { summary: `未找到模块 ${moduleCode}`, detail: [] };
  }

  const settings = await getSettings();
  const triggeredAt = new Date();

  if (!settings.enabled && pushedBy !== 'manual') {
    return { summary: '推送开关已关闭', detail: [] };
  }

  // 加载所有数据
  const pool = await getPool();
  const dataList: Record<string, any>[] = [];
  for (const sourceId of sourceIds) {
    try {
      const data = await provider.loadRenderData(sourceId, pool);
      if (data && Object.keys(data).length > 0) {
        dataList.push(data);
      }
    } catch { /* skip failed loads */ }
  }

  if (dataList.length === 0) {
    return { summary: '没有可汇总的数据', detail: [] };
  }

  // 渲染汇总消息：使用模板选中的字段（如果有）
  const allFields = provider.getAvailableFields();
  const selectedFieldKeys = options?.templateSelectedFields;
  const fields = selectedFieldKeys && selectedFieldKeys.length > 0
    ? allFields.filter(f => selectedFieldKeys.includes(f.fieldKey))
    : allFields;
  let message: string;
  if (provider.summaryGroupedByField) {
    // 商品清单类（如无成本价商品）：只按模板正文勾选的字段聚合去重，
    // 未勾选字段不推送；模板字面文本原样保留。
    message = renderGroupedByFieldSummary(dataList, fields, provider.moduleName, {
      header: options?.templateHeader,
      body: options?.templateBody,
      footer: options?.templateFooter,
    });
  } else if (options?.templateHeader || options?.templateBody) {
    // 模板模式：逐条数据按模板正文渲染（每条之间空行分隔），
    // 与明细模式使用同一模板，保证用户设置的文本真正生效；
    // 模板里没有逐条占位符时退化为汇总渲染，内容过长时按企微 2048 字节上限截断。
    const headerStr = options?.templateHeader || '';
    const bodyStr = options?.templateBody || '';
    const hasPlaceholder = fields.some(f =>
      headerStr.includes(f.fieldKey.replace(/[{}]/g, '')) ||
      bodyStr.includes(f.fieldKey.replace(/[{}]/g, ''))
    );
    if (hasPlaceholder) {
      const cards: string[] = [];
      for (const d of dataList) {
        cards.push(renderFromTemplate(options.templateHeader, options.templateBody, '', d, ''));
      }
      const footer = options.templateFooter || '————系统自动推送，无需回复————';
      message = cards.filter(Boolean).join('\n\n') + '\n' + footer.replace(/\{time\}/g, new Date().toLocaleString('zh-CN'));
    } else {
      message = renderSummaryMessage(dataList, fields, options?.templateTitle || provider.moduleName);
    }
  } else {
    message = renderSummaryMessage(dataList, fields, options?.templateTitle || provider.moduleName);
  }
  if (Buffer.byteLength(message, 'utf8') > 2000) {
    // 企微单条 text 上限约 2048 字节：模板逐条渲染可能超长，
    // 按字节安全截断正文并保留尾部（footer 提示），避免截断后模板尾部丢失。
    const tail = (options?.templateFooter || '\n————系统自动推送，无需回复————')
      .replace(/\{time\}/g, new Date().toLocaleString('zh-CN'));
    const tailBytes = Buffer.byteLength(tail, 'utf8');
    const tailLen = tail.length;
    // 预算：正文最多占 (2000 - tailBytes - 截断提示) 字节；逐字符累积直到超预算
    const budget = Math.max(80, 2000 - tailBytes - Buffer.byteLength('\n...(内容过多已截断，仅展示部分)\n', 'utf8'));
    let head = '';
    let bytes = 0;
    for (const ch of message) {
      const b = Buffer.byteLength(ch, 'utf8');
      if (bytes + b > budget) break;
      head += ch;
      bytes += b;
    }
    // 尽量在商品卡片边界截断（按连续两个换行切分）
    const cards = head.split('\n\n');
    if (cards.length > 1) {
      cards.pop(); // 丢弃半截卡片
      head = cards.join('\n\n');
    }
    message = head + '\n...(内容过多已截断，仅展示部分)\n' + tail.replace(/^\n+/, '');
  }

  // 接收人：优先使用模板指定的接收人，否则按督导上级链
  let recipients: { name: string; wechatAccount: string }[] = [];
  if (options?.recipientOverride && options.recipientOverride.length > 0) {
    recipients = options.recipientOverride;
  } else {
    const supervisorName = String(dataList[0]?.['supervisor'] || '').trim();
    if (supervisorName) {
      const hierarchy = await getRecipientsBySupervisorHierarchy(supervisorName);
      recipients = hierarchy.list;
    }
  }
  if (recipients.length === 0) {
    return { summary: '未找到任何接收人', detail: [] };
  }

  const apiOk = isApiConfigured(settings);
  const detail: PushResultItem[] = [];

  for (const recipient of recipients) {
    const logIdOut = await writeLog({
      moduleCode, sourceId: sourceIds[0], sourceTable: provider.sourceTable,
      sourceTitle: `${provider.moduleName}汇总(${dataList.length}条)`,
      supervisor: '', destination: dataList[0]?.['destination'] || dataList[0]?.['shopName'] || '',
      recipientName: recipient.name, recipientAccount: recipient.wechatAccount,
      messageContent: message, status: 'pending',
      triggeredBy: pushedBy, triggeredAt,
    });

    let success = false;
    let error = '';
    let retry = 0;

    if (apiOk) {
      const res = await pushToSingle(settings, recipient.wechatAccount, message);
      success = res.success;
      error = res.error;
      retry = res.retryCount;
    } else {
      error = '企业微信API未配置';
    }

    if (logIdOut) {
      await updateLogStatus(logIdOut, success ? 'success' : 'failed', error, retry);
    }

    detail.push({ recipient: recipient.name, account: recipient.wechatAccount, success, error, retryCount: retry });
  }

  // 标记每条源数据为已推送
  for (const sourceId of sourceIds) {
    if (detail.some(d => d.success)) {
      await markAsPushed(moduleCode, sourceId, provider.sourceTable, pushedBy);
    }
  }

  const okCount = detail.filter(d => d.success).length;
  return {
    summary: `汇总推送完成：${dataList.length}条聚合为1条消息，共 ${detail.length} 人，成功 ${okCount} 人`,
    detail,
  };
}
