// ============================================================
// 企业微信推送核心服务
//   - 调用企业微信"应用消息"官方API（text 类型）
//   - 支持接口限流自适应 + 重试（最多重试2次，每次间隔5秒）
//   - 推送结果写入 WechatPushLogs 表
//   - 支持标记「已推送历史」，避免同一巡店日志重复推送
// ============================================================

import sql from 'mssql';
import axios from 'axios';
import FormData from 'form-data';
import sharp from 'sharp';
import { getPool } from '../../config/db';
import {
  loadInspectionLogForRender,
  renderMessage,
  getTemplateConfig,
  getMissingCoreFields,
  CHECK_MODULES,
} from './wechatMessageRenderer';

/** 推送接收人（从 DB 读取） */
export interface RecipientRow {
  id: number;
  wechatAccount: string;
  name: string;
  isEnabled: boolean;
}

/** 企微全局配置 */
export interface WechatSettingsRow {
  id: number;
  enabled: boolean;
  pollingEnabled: boolean;
  pollingInterval: number;
  wechatCorpId?: string;
  wechatSecret?: string;
  wechatAgentId?: string;
  /** HTTP/HTTPS 代理出口（如 http://user:pass@ip:port ），留空则直连 */
  proxyUrl?: string;
}

/** 企微 access_token 缓存 */
interface AccessToken {
  token: string;
  expiresAt: number; // ms
}
let _tokenCache: AccessToken | null = null;

const MAX_RETRY = 0;
const RETRY_INTERVAL_MS = 5000;
const WECHAT_API_BASE = 'https://qyapi.weixin.qq.com';

/** 休眠 */
function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** 读取全局设置（表不存在时用默认值） */
export async function getSettings(): Promise<WechatSettingsRow> {
  const defaultRow: WechatSettingsRow = {
    id: 1,
    enabled: true,
    pollingEnabled: true,
    pollingInterval: 30,
  };
  try {
    const pool = await getPool();
    const colCheck = await pool.request().query(`
      SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'WechatPushSettings' AND COLUMN_NAME = 'proxyUrl'
    `);
    const hasProxy = (colCheck.recordset && colCheck.recordset[0] && Number(colCheck.recordset[0].c) > 0);
    const sql = hasProxy
      ? `SELECT id, enabled, pollingEnabled, pollingInterval,
                wechatCorpId, wechatSecret, wechatAgentId, proxyUrl
         FROM WechatPushSettings WHERE id = 1`
      : `SELECT id, enabled, pollingEnabled, pollingInterval,
                wechatCorpId, wechatSecret, wechatAgentId
         FROM WechatPushSettings WHERE id = 1`;
    const result = await pool.request().query(sql);
    if (result.recordset && result.recordset.length > 0) {
      const r: any = result.recordset[0];
      return {
        id: r.id,
        enabled: r.enabled === 1 || r.enabled === true,
        pollingEnabled: r.pollingEnabled === 1 || r.pollingEnabled === true,
        pollingInterval: Number(r.pollingInterval) || 30,
        wechatCorpId: r.wechatCorpId || undefined,
        wechatSecret: r.wechatSecret || undefined,
        wechatAgentId: r.wechatAgentId || undefined,
        proxyUrl: hasProxy ? (r.proxyUrl || undefined) : undefined,
      };
    }
  } catch (err) {
    console.warn('[WechatPushService] 读取设置失败，使用默认值:',
      (err as Error).message);
  }
  return defaultRow;
}

/** 读取已启用的接收人列表（仅用于手动测试 / 兼容旧逻辑） */
export async function getEnabledRecipients(): Promise<RecipientRow[]> {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT id, wechatAccount, name, isEnabled
      FROM WechatPushRecipients
      WHERE isEnabled = 1
      ORDER BY id
    `);
    return (result.recordset || []).map((r: any) => ({
      id: Number(r.id),
      wechatAccount: String(r.wechatAccount || ''),
      name: String(r.name || ''),
      isEnabled: r.isEnabled === 1 || r.isEnabled === true,
    }));
  } catch (err) {
    console.warn('[WechatPushService] 读取接收人失败:', (err as Error).message);
    return [];
  }
}

/**
 * 督导→区经→总监 三级上级推送接收人
 * 根据巡店日志中的督导姓名，查找其在 sys_org 组织架构中的上级链路：
 *   督导组(supervisor_group) → 区经组(group) → 总监(director)
 * 每级上级中有企微账号的用户都会收到推送，按企微账号去重，排除督导本人。
 */
export async function getRecipientsBySupervisorHierarchy(
  supervisorName: string
): Promise<{
  list: { name: string; wechatAccount: string; groupName: string }[];
  rawGroups: string[];
}> {
  const list: { name: string; wechatAccount: string; groupName: string }[] = [];
  const seen = new Set<string>();
  const groups: string[] = [];
  const trimmedName = (supervisorName || '').trim();
  if (!trimmedName) return { list, rawGroups: groups };

  try {
    const pool = await getPool();

    // 1) 查督导用户 -> org_id（优先取 supervisor_group 类型的组织绑定）
    const supResult = await pool.request()
      .input('supervisorName', sql.NVarChar, trimmedName)
      .query(`
        SELECT TOP 1 u.用户代码, ur.org_id,
               o.org_name, o.org_type, o.parent_org_id
        FROM 用户全 u
        LEFT JOIN sys_user_role ur ON ur.user_code = u.用户代码
        LEFT JOIN sys_org o ON o.org_id = ur.org_id AND o.del_flag = 0
        WHERE u.用户名称 = @supervisorName
        ORDER BY CASE WHEN o.org_type = 'supervisor_group' THEN 0
                      WHEN o.org_type = 'group' THEN 1
                      WHEN o.org_type = 'director' THEN 2
                      ELSE 3 END
      `);

    if (!supResult.recordset.length || !supResult.recordset[0]['org_id']) {
      console.log(`[WechatPush] 督导"${trimmedName}"未关联组织节点，无法解析上级推送接收人`);
      return { list, rawGroups: groups };
    }

    const supervisorOrgId = supResult.recordset[0]['org_id'];
    const supervisorUserCode = String(supResult.recordset[0]['用户代码'] || '').trim();

    // 2) 沿 parent_org_id 向上遍历，收集所有祖先 org_id
    const ancestorOrgIds: number[] = [];
    const visited = new Set<number>();
    let currentParentId: number | null = supResult.recordset[0]['parent_org_id'];

    while (currentParentId && !visited.has(currentParentId)) {
      visited.add(currentParentId);
      const orgResult = await pool.request()
        .input('orgId', sql.Int, currentParentId)
        .query(`SELECT org_id, parent_org_id, org_name, org_type FROM sys_org WHERE org_id = @orgId AND del_flag = 0`);
      if (!orgResult.recordset.length) break;
      const org = orgResult.recordset[0];
      const orgType = String(org['org_type'] || '');
      // 只收区经组(group)和总监(director)级别，公司(company)级不推
      if (orgType === 'group' || orgType === 'director') {
        ancestorOrgIds.push(org['org_id']);
        groups.push(org['org_name'] || '');
      }
      if (orgType === 'company' || !org['parent_org_id']) break;
      currentParentId = org['parent_org_id'];
    }

    if (ancestorOrgIds.length === 0) {
      console.log(`[WechatPush] 督导"${trimmedName}"的组织节点无上级，无法找到区经/总监推送接收人`);
      return { list, rawGroups: groups };
    }

    // 3) 查每个祖先 org 下绑定的用户（有企微账号，排除督导本人）
    const placeholders = ancestorOrgIds.map((_, i) => `@oid${i}`).join(',');
    const req = pool.request();
    ancestorOrgIds.forEach((id, i) => req.input(`oid${i}`, sql.Int, id));
    req.input('supUserCode', sql.NVarChar, supervisorUserCode);
    const userResult = await req.query(`
      SELECT DISTINCT u.用户名称, u.企微账号, o.org_name AS group_name
      FROM sys_user_role ur
      JOIN sys_org o ON o.org_id = ur.org_id AND o.del_flag = 0
      JOIN 用户全 u ON u.用户代码 = ur.user_code
      WHERE ur.org_id IN (${placeholders})
        AND ISNULL(u.企微账号, '') <> ''
        AND u.用户代码 IS NOT NULL AND u.用户代码 <> ''
        AND u.用户代码 <> @supUserCode
      ORDER BY u.用户名称
    `);

    for (const r of userResult.recordset || []) {
      const name = String(r['用户名称'] || '').trim();
      const account = String(r['企微账号'] || '').trim();
      const groupName = String(r['group_name'] || '').trim();
      if (!account || seen.has(account)) continue;
      seen.add(account);
      list.push({ name, wechatAccount: account, groupName });
    }

    console.log(`[WechatPush] 督导"${trimmedName}"上级推送接收人共 ${list.length} 人，层级: ${groups.join(' -> ')}`);
    return { list, rawGroups: groups };
  } catch (err) {
    console.error('[WechatPush] getRecipientsBySupervisorHierarchy 失败:', err);
    return { list, rawGroups: groups };
  }
}

/** 判断某条巡店日志是否已推送过 */
export async function hasBeenPushed(logId: number): Promise<boolean> {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('logId', sql.Int, logId)
      .query('SELECT logId FROM WechatPushHistory WHERE logId = @logId');
    return result.recordset && result.recordset.length > 0;
  } catch {
    return false;
  }
}

/** 标记某条巡店日志为"已推送" */
export async function markAsPushed(logId: number, pushedBy: string): Promise<void> {
  try {
    const pool = await getPool();
    await pool.request()
      .input('logId', sql.Int, logId)
      .input('pushedBy', sql.NVarChar, pushedBy)
      .query(`
        IF EXISTS (SELECT 1 FROM WechatPushHistory WHERE logId = @logId)
          UPDATE WechatPushHistory SET pushedAt = GETDATE(), pushedBy = @pushedBy WHERE logId = @logId
        ELSE
          INSERT INTO WechatPushHistory (logId, pushedBy) VALUES (@logId, @pushedBy)
      `);
    // 同步写入 V2 去重表，避免 V1/V2 双跑导致重复推送
    await pool.request()
      .input('mod', sql.NVarChar, 'inspection_log')
      .input('sid', sql.Int, logId)
      .input('tbl', sql.NVarChar, 'StoreInspectionLogs')
      .input('by', sql.NVarChar, pushedBy)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM WechatPushHistoryV2 WHERE moduleCode=@mod AND sourceId=@sid)
          INSERT INTO WechatPushHistoryV2 (moduleCode, sourceId, sourceTable, pushedBy) VALUES (@mod, @sid, @tbl, @by)
      `);
  } catch (err) {
    console.warn('[WechatPushService] markAsPushed 失败（可能表尚未创建）:',
      (err as Error).message);
  }
}

/** 写入推送日志（单人一条） */
export async function writePushLog(params: {
  logId: number;
  supervisor: string;
  destination: string;
  recipientName: string;
  recipientAccount: string;
  status: 'pending' | 'success' | 'failed' | 'skipped';
  message: string;
  errorDetail?: string;
  retryCount?: number;
  triggeredAt: Date;
}): Promise<number | null> {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('logId', sql.Int, params.logId)
      .input('supervisor', sql.NVarChar, params.supervisor || '')
      .input('destination', sql.NVarChar, params.destination || '')
      .input('recipientName', sql.NVarChar, params.recipientName || '')
      .input('recipientAccount', sql.NVarChar, params.recipientAccount || '')
      .input('status', sql.NVarChar, params.status)
      .input('message', sql.NVarChar, params.message || '')
      .input('errorDetail', sql.NVarChar, params.errorDetail || '')
      .input('retryCount', sql.Int, params.retryCount || 0)
      .input('triggeredAt', sql.DateTime, params.triggeredAt)
      .query(`
        INSERT INTO WechatPushLogs
          (logId, supervisor, destination, recipientName, recipientAccount,
           status, message, errorDetail, retryCount, triggeredAt)
        OUTPUT INSERTED.id
        VALUES
          (@logId, @supervisor, @destination, @recipientName, @recipientAccount,
           @status, @message, @errorDetail, @retryCount, @triggeredAt)
      `);
    return result.recordset && result.recordset[0] ? Number(result.recordset[0].id) : null;
  } catch (err) {
    console.warn('[WechatPushService] writePushLog 失败（可能表尚未创建）:',
      (err as Error).message);
    return null;
  }
}

/** 更新推送日志状态 */
export async function updatePushLogStatus(
  id: number,
  status: 'success' | 'failed',
  errorDetail: string,
  retryCount: number
): Promise<void> {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, id)
      .input('status', sql.NVarChar, status)
      .input('errorDetail', sql.NVarChar, errorDetail || '')
      .input('retryCount', sql.Int, retryCount)
      .query(`
        UPDATE WechatPushLogs
        SET status = @status, errorDetail = @errorDetail, retryCount = @retryCount
        WHERE id = @id
      `);
  } catch (err) {
    console.warn('[WechatPushService] updatePushLogStatus 失败:', (err as Error).message);
  }
}

/** 获取企微 access_token（带缓存） */
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

/** 把形如 http://user:pass@ip:port 的字符串解析成 axios.proxy 配置；无则返回 undefined */
function buildAxiosProxy(proxyUrl?: string): any | undefined {
  if (!proxyUrl) return undefined;
  try {
    const u = new URL(proxyUrl);
    const isHttps = u.protocol === 'https:';
    return {
      protocol: isHttps ? 'https' : 'http',
      host: u.hostname,
      port: Number(u.port) || (isHttps ? 443 : 80),
      auth: u.username
        ? { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password || '') }
        : undefined,
    };
  } catch (_e) {
    console.warn('[WechatPushService] proxyUrl 解析失败，将直连:', proxyUrl);
    return undefined;
  }
}

/** 调用企微应用消息 API 推送给单个用户 */
async function sendTextMessageSingle(
  settings: WechatSettingsRow,
  account: string,
  content: string
): Promise<void> {
  if (!settings.wechatAgentId) {
    throw new Error('企业微信 AgentId 未配置');
  }
  const token = await getAccessToken(settings);
  const url = `${WECHAT_API_BASE}/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`;
  const body = {
    touser: account,
    msgtype: 'text',
    agentid: Number(settings.wechatAgentId) || 0,
    text: { content },
    safe: 0,
    enable_id_trans: 0,
    // 不开启企微端重复检查：开启后 10 分钟内内容完全相同的消息会被企微静默丢弃
    // 但仍返回 errcode=0，造成"日志 success 但实际未送达"的假象
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
  // errcode=0 不代表送达：企微对无效成员返回 invaliduser，该部分实际未投递
  const invalid = (json.invaliduser || '').trim();
  if (invalid) {
    const err = new Error(`企微返回无效用户 invaliduser=${invalid}（未送达）`);
    (err as any).errcode = 81013;
    throw err;
  }
}

/**
 * 把 base64 图片（dataURL）上传到企业微信临时素材库，返回 media_id。
 * 上传前用 sharp 压缩（最长边 1280 / 800，jpeg quality 80/60），控制体积避免超 2MB 限制。
 */
async function uploadImageToWechat(base64Data: string, settings: WechatSettingsRow): Promise<string> {
  if (!settings.wechatCorpId || !settings.wechatSecret) {
    throw new Error('企业微信 CorpID 或 Secret 未配置');
  }
  const matches = base64Data.match(/^data:image\/([a-zA-Z+]+);base64,(.*)$/);
  if (!matches) throw new Error('图片格式不支持（需 dataURL base64）');
  const isPng = matches[1].toLowerCase() === 'png';
  const raw = Buffer.from(matches[2], 'base64');

  let buffer: any = raw;
  try {
    buffer = await sharp(raw)
      .rotate() // 按 EXIF 方向自动转正
      .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch (e) {
    console.warn('[WechatPushService] sharp 压缩失败，使用原图:', (e as Error).message);
  }
  // 仍超 2MB 则二次压缩
  if (buffer.length > 2 * 1024 * 1024) {
    try {
      buffer = await sharp(buffer)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 60 })
        .toBuffer();
    } catch { /* ignore */ }
  }

  const token = await getAccessToken(settings);
  const url = `${WECHAT_API_BASE}/cgi-bin/media/upload?access_token=${encodeURIComponent(token)}&type=image`;
  const form = new FormData();
  form.append('media', buffer, {
    filename: `inspection.${isPng ? 'png' : 'jpg'}`,
    contentType: isPng ? 'image/png' : 'image/jpeg',
  });
  const resp = await axios.post(url, form, {
    headers: { ...form.getHeaders() },
    proxy: buildAxiosProxy(settings.proxyUrl),
    timeout: 20000,
    maxContentLength: 10 * 1024 * 1024,
    maxBodyLength: 10 * 1024 * 1024,
  });
  const json: any = resp.data;
  if (json.errcode !== 0) {
    throw new Error(`上传图片素材失败 errcode=${json.errcode}, errmsg=${json.errmsg}`);
  }
  return json.media_id as string;
}

/** 调用企微应用消息 API 给单个用户发送 image 消息（media_id 形式，真正显示图片） */
async function sendImageMessageSingle(
  settings: WechatSettingsRow,
  account: string,
  mediaId: string
): Promise<void> {
  if (!settings.wechatAgentId) {
    throw new Error('企业微信 AgentId 未配置');
  }
  const token = await getAccessToken(settings);
  const url = `${WECHAT_API_BASE}/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`;
  const body = {
    touser: account,
    msgtype: 'image',
    agentid: Number(settings.wechatAgentId) || 0,
    image: { media_id: mediaId },
    safe: 0,
    enable_id_trans: 0,
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
    const err = new Error(`图片消息推送失败 errcode=${json.errcode}, errmsg=${json.errmsg}`);
    (err as any).errcode = json.errcode;
    throw err;
  }
  const invalid = (json.invaliduser || '').trim();
  if (invalid) {
    const err = new Error(`企微返回无效用户 invaliduser=${invalid}（未送达）`);
    (err as any).errcode = 81013;
    throw err;
  }
}

/** 企微接口错误码是否可重试（限流/超时等） */
function isRetryable(err: any): boolean {
  const code = err?.errcode;
  if (code === 429 || code === 20001 || code === 20002 || code === 301006) return true;
  const msg = String(err?.message || '').toLowerCase();
  return /timeout|socket|econnreset|econnrefused|rate.?limit|429/.test(msg);
}

/** 推送给单个接收人（含重试），返回 {success, error, retryCount} */
export async function pushToSingleRecipient(
  settings: WechatSettingsRow,
  account: string,
  content: string
): Promise<{ success: boolean; error: string; retryCount: number }> {
  let lastErr = '';
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      await sendTextMessageSingle(settings, account, content);
      return { success: true, error: '', retryCount: attempt };
    } catch (err: any) {
      lastErr = err?.message || String(err);
      console.warn(`[WechatPushService] 推送失败（第${attempt + 1}次）: ${lastErr}`);
      if (attempt >= MAX_RETRY) break;
      if (!isRetryable(err)) break; // 非可重试错误直接放弃
      await sleep(RETRY_INTERVAL_MS);
    }
  }
  return { success: false, error: lastErr, retryCount: MAX_RETRY };
}

/** 检查接口配置是否足够用于推送（CorpID/Secret/AgentID 全配置） */
export function isApiConfigured(settings: WechatSettingsRow): boolean {
  return Boolean(settings.wechatCorpId && settings.wechatSecret && settings.wechatAgentId);
}

/**
 * 核心入口：为一条巡店日志生成消息并推送给所有启用的接收人
 * @param logId 巡店日志ID
 * @param pushedBy 触发来源：'auto'（提交时）、'polling'（轮询兜底）、'manual'（手动）
 * @param options.recipientIds 可选：只推送给指定接收人；不传则推给全部启用的接收人
 * @param options.forceRepush 可选：是否忽略已推送历史，强行再推一次（默认 false）
 */
export async function pushInspectionLog(
  logId: number,
  pushedBy: 'auto' | 'polling' | 'manual',
  options?: { recipientIds?: number[]; forceRepush?: boolean }
): Promise<{ summary: string; detail: any[] }> {
  const log = await loadInspectionLogForRender(logId);
  if (!log) {
    return { summary: `巡店日志 ${logId} 不存在`, detail: [] };
  }

  const settings = await getSettings();
  const triggeredAt = new Date();

  // 0) 未巡店 / 调休 / 不巡店 检测：跳过核心字段校验，直接推送
  const isNoInspection =
    String(log.departure || '').includes('未巡店') ||
    String(log.destination || '').includes('未巡店') ||
    String(log.remarks || '').includes('调休') ||
    String(log.remarks || '').includes('不巡店');

  // 1) 核心必填字段校验（未巡店/调休日志跳过）
  if (!isNoInspection) {
    const missing = getMissingCoreFields(log);
    if (missing.length > 0) {
      const errMsg = `核心字段缺失（${missing.join('/')}），未推送`;
      await writePushLog({
        logId,
        supervisor: log.supervisor,
        destination: log.destination,
        recipientName: '(系统)',
        recipientAccount: '(系统)',
        status: 'skipped',
        message: errMsg,
        errorDetail: errMsg,
        retryCount: 0,
        triggeredAt,
      });
      return { summary: errMsg, detail: [] };
    }
  }

  // 2) 重复推送拦截
  if (!options?.forceRepush) {
    const already = await hasBeenPushed(logId);
    if (already) {
      return { summary: `该巡店日志(logId=${logId})已推送过，跳过重复推送`, detail: [] };
    }
  }

  // 3) 全局推送开关
  if (!settings.enabled && pushedBy !== 'manual') {
    return { summary: '系统推送开关已关闭，本次未推送', detail: [] };
  }

  // 4) 渲染消息
  const tpl = await getTemplateConfig();
  const message = renderMessage(log, tpl);

  // 4.5) 收集所有带图核查项的图片（base64），用于发送 image 消息
  const MAX_IMAGES = 9;
  const photos: string[] = [];
  for (const mod of CHECK_MODULES) {
    const items = log.items[mod.key] || [];
    for (const it of items) {
      const p = (it.photo || '').trim();
      if (p && p.startsWith('data:image')) photos.push(p);
    }
  }
  const photosToSend = photos.slice(0, MAX_IMAGES);

  // 5) 获取接收人：督导→区经→总监 三级上级推送
  let recipients: { name: string; wechatAccount: string; groupName?: string }[] = [];
  let recipientSource = '';
  const hierarchy = await getRecipientsBySupervisorHierarchy(log.supervisor);
  recipients = hierarchy.list;
  recipientSource = hierarchy.rawGroups.length > 0
    ? `督导上级(${hierarchy.rawGroups.join('/')})`
    : '督导上级';

  if (recipients.length === 0) {
    const errMsg = `未找到任何接收人（督导=${log.supervisor} 无对应权限组，且经理/管理组也无可用企微账号）`;
    await writePushLog({
      logId,
      supervisor: log.supervisor,
      destination: log.destination,
      recipientName: '(系统)',
      recipientAccount: '(系统)',
      status: 'skipped',
      message,
      errorDetail: errMsg,
      retryCount: 0,
      triggeredAt,
    });
    return { summary: errMsg, detail: [] };
  }

  // 6) API 未配置：只写日志标记"失败-接口未配置"，便于管理员补全后手动触发
  const apiOk = isApiConfigured(settings);

  const detail: any[] = [];

  // 6.0) 预先上传图片素材，拿到 media_id（一次上传，多个接收人复用）
  let mediaIds: string[] = [];
  if (apiOk && photosToSend.length > 0) {
    for (const p of photosToSend) {
      try {
        const mid = await uploadImageToWechat(p, settings);
        mediaIds.push(mid);
      } catch (e) {
        console.warn(`[WechatPush] 图片素材上传失败: ${(e as Error).message}`);
      }
    }
  }

  for (const recipient of recipients) {
    const logIdOut = await writePushLog({
      logId,
      supervisor: log.supervisor,
      destination: log.destination,
      recipientName: recipient.name,
      recipientAccount: recipient.wechatAccount,
      status: 'pending',
      message,
      triggeredAt,
    });

    let success = false;
    let error = '';
    let retryCount = 0;

    if (apiOk) {
      const res = await pushToSingleRecipient(settings, recipient.wechatAccount, message);
      success = res.success;
      error = res.error;
      retryCount = res.retryCount;

      // 文本发送成功后，逐张发送 image 消息（真正的图片）
      if (success && mediaIds.length > 0) {
        for (const mid of mediaIds) {
          try {
            await sendImageMessageSingle(settings, recipient.wechatAccount, mid);
          } catch (imgErr) {
            console.warn(`[WechatPush] 图片消息发送失败(${recipient.name}): ${(imgErr as Error).message}`);
          }
        }
      }
    } else {
      error = '企业微信接口尚未配置（CorpID/Secret/AgentID）';
    }

    if (logIdOut) {
      await updatePushLogStatus(logIdOut, success ? 'success' : 'failed', error, retryCount);
    }
    detail.push({
      recipient: recipient.name,
      account: recipient.wechatAccount,
      success,
      error,
      retryCount,
    });
  }

  // 7) 至少有一人推送成功，即标记为已推送
  if (detail.some((d) => d.success)) {
    await markAsPushed(logId, pushedBy);
  }
  const okCount = detail.filter((d) => d.success).length;
  const imageInfo = mediaIds.length > 0 ? `；图片消息 ${mediaIds.length} 张` : '';
  return {
    summary: `推送完成（${recipientSource}）：共 ${detail.length} 人，成功 ${okCount} 人${imageInfo}`,
    detail,
  };
}

// 通用媒体消息发送能力：图片 / 视频 / 文件（PPT、Excel、PDF、文档等）
// ============================================================

/**
 * 上传任意媒体文件（图片/视频/文件）到企业微信临时素材库，返回 media_id
 * @param buffer 文件二进制内容
 * @param filename 文件名（含扩展名）
 * @param mediaType 企微素材类型: image | voice | video | file
 */
export async function uploadMediaToWechat(
  buffer: Buffer,
  filename: string,
  mediaType: string,
  settings: WechatSettingsRow
): Promise<string> {
  if (!settings.wechatCorpId || !settings.wechatSecret) {
    throw new Error('企业微信 CorpID 或 Secret 未配置');
  }
  const token = await getAccessToken(settings);
  const url = `${WECHAT_API_BASE}/cgi-bin/media/upload?access_token=${encodeURIComponent(token)}&type=${encodeURIComponent(mediaType)}`;
  const form = new FormData();
  form.append('media', buffer, {
    filename,
    contentType: getContentType(filename),
  });
  const resp = await axios.post(url, form, {
    headers: { ...form.getHeaders() },
    proxy: buildAxiosProxy(settings.proxyUrl),
    timeout: 30000,
    maxContentLength: 30 * 1024 * 1024,
    maxBodyLength: 30 * 1024 * 1024,
  });
  const json: any = resp.data;
  if (json.errcode !== 0) {
    throw new Error(`上传素材失败 errcode=${json.errcode}, errmsg=${json.errmsg}`);
  }
  return json.media_id as string;
}

/** 根据文件扩展名推断 Content-Type */
function getContentType(filename: string): string {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp',
    mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pdf: 'application/pdf', txt: 'text/plain', zip: 'application/zip', rar: 'application/x-rar-compressed',
  };
  return map[ext] || 'application/octet-stream';
}

/**
 * 发送媒体消息给单个用户
 * @param msgtype 企业微信消息类型: image | video | file
 */
export async function sendMediaMessage(
  settings: WechatSettingsRow,
  account: string,
  msgtype: 'image' | 'video' | 'file',
  mediaId: string,
  title?: string,
  description?: string
): Promise<void> {
  if (!settings.wechatAgentId) throw new Error('企业微信 AgentId 未配置');
  const token = await getAccessToken(settings);
  const url = `${WECHAT_API_BASE}/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`;
  let body: any;
  if (msgtype === 'image') {
    body = { image: { media_id: mediaId } };
  } else if (msgtype === 'video') {
    body = { video: { media_id: mediaId, title: title || '', description: description || '' } };
  } else {
    // file 类型：文件消息（支持PPT/Word/Excel/PDF）
    body = { file: { media_id: mediaId } };
  }
  const payload = {
    touser: account,
    msgtype,
    agentid: Number(settings.wechatAgentId) || 0,
    ...body,
    safe: 0,
    enable_id_trans: 0,
    enable_duplicate_check: 0,
    duplicate_check_interval: 0,
  };
  const resp = await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json' },
    proxy: buildAxiosProxy(settings.proxyUrl),
    timeout: 15000,
  });
  const json: any = resp.data;
  if (json.errcode !== 0) {
    throw new Error(`媒体消息推送失败 errcode=${json.errcode}, errmsg=${json.errmsg}`);
  }
  const invalid = (json.invaliduser || '').trim();
  if (invalid) {
    throw new Error(`企微返回无效用户 invaliduser=${invalid}（未送达）`);
  }
}
