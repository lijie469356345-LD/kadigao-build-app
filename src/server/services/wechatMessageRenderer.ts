// ============================================================
// 企业微信消息模板渲染引擎
// 功能：根据模板 + 巡店日志数据生成格式化文本消息
// 模板规则：
//   - {变量} 占位符
//   - 空的基础字段显示「无」，不整行删除
//   - 7 大类核查项，若某类下无任何条目，整类隐藏
//   - 时间字段统一格式 YYYY-MM-DD HH:mm
//   - 图片地址为空不显示图片标识
// ============================================================

import sql from 'mssql';
import { getPool } from '../../config/db';

/** 7 大类核查项与中文标题映射（与需求文档一致） */
export const CHECK_MODULES: { key: string; title: string }[] = [
  { key: 'coreItems',         title: '核心事项' },
  { key: 'shopIssues',        title: '店铺问题' },
  { key: 'teachingTraining',  title: '带教培训' },
  { key: 'competitorInfo',    title: '竞品信息' },
  { key: 'marketResearch',    title: '市场调研' },
  { key: 'staffCollection',   title: '外部人员收集' },
  { key: 'marketChanges',     title: '市场变化' },
];

/** 模板配置（从数据库读取） */
export interface WechatTemplateConfigRow {
  title: string;
  headerTemplate: string;
  itemTemplate: string;
  singleItemLine: string;
  photoLineTemplate: string;
  footerTemplate: string;
}

/** 核查项条目扁平结构 */
interface FlatItem {
  item: string;
  result: string;
  photo: string;
}

/** 扁平化日志数据（渲染输入） */
export interface InspectionLogForRender {
  id: number;
  supervisor: string;
  date: string;
  departure: string;
  destination: string;
  arrivalTime: string;
  departureTime: string;
  remarks: string;
  items: Record<string, FlatItem[]>;
}

/** 读取模板配置（数据库不存在时用硬编码默认值） */
export async function getTemplateConfig(): Promise<WechatTemplateConfigRow> {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT title, headerTemplate, itemTemplate, singleItemLine, photoLineTemplate, footerTemplate
      FROM WechatPushTemplate
      WHERE id = 1
    `);
    if (result.recordset && result.recordset.length > 0) {
      const row = result.recordset[0];
      return {
        title: row.title || '',
        headerTemplate: row.headerTemplate || '',
        itemTemplate: row.itemTemplate || '',
        singleItemLine: row.singleItemLine || '',
        photoLineTemplate: row.photoLineTemplate || '',
        footerTemplate: row.footerTemplate || '',
      };
    }
  } catch (err) {
    // 表可能不存在，降级使用默认模板
    console.warn('[WechatMessageRenderer] 读取模板配置失败，使用默认模板:',
      (err as Error).message);
  }
  return getDefaultTemplate();
}

/** 默认内置模板（与需求文档一致） */
export function getDefaultTemplate(): WechatTemplateConfigRow {
  return {
    title: '【巡店自动通知】',
    headerTemplate:
      '督导：{supervisor}\n' +
      '巡店日期：{date}\n' +
      '出发地：{departure}\n' +
      '目的地：{destination}\n' +
      '到店时间：{arrivalTime}\n' +
      '离店时间：{departureTime}',
    itemTemplate: '{order}.{title}:\n{itemsText}',
    singleItemLine: '  · {item}：{result}{photoLine}',
    photoLineTemplate: '（图片：{photo}）',
    footerTemplate: '\n巡店结论：{remarks}\n————系统自动推送，无需回复————',
  };
}

/** 空值友好渲染：undefined/null/空串 -> "无" */
function orEmpty(val: string | undefined | null): string {
  if (val === undefined || val === null) return '';
  return String(val);
}

function orWu(val: string | undefined | null): string {
  const v = orEmpty(val).trim();
  return v === '' ? '无' : v;
}

/** 时间字段格式化为 YYYY-MM-DD HH:mm；
 *  输入支持：Date 对象、ISO 字符串、YYYY-MM-DD、HH:mm、HH:mm:ss、空（返回"无"）
 */
export function formatDateTime(raw: string | undefined | null): string {
  if (raw === undefined || raw === null) return '无';
  const s = String(raw).trim();
  if (s === '') return '无';

  // 纯时间 HH:mm / HH:mm:ss
  if (/^\d{1,2}:\d{1,2}(:\d{1,2})?$/.test(s)) {
    const [h, m] = s.split(':');
    const pad = (n: string) => n.padStart(2, '0');
    return `${pad(h)}:${pad(m)}`;
  }

  let d: Date | null = null;
  try {
    const t = new Date(s);
    if (!isNaN(t.getTime())) d = t;
  } catch { /* ignore */ }

  if (!d) {
    // 直接回显原文
    return s;
  }
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const DD = String(d.getDate()).padStart(2, '0');
  const HH = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  // 如果原数据无时间部分，只保留日期
  if (!/\d{1,2}:\d{1,2}/.test(s)) {
    return `${yyyy}-${MM}-${DD}`;
  }
  return `${yyyy}-${MM}-${DD} ${HH}:${mm}`;
}

/** 简单的 {变量} 占位符替换 */
function applyVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key) => {
    return vars[key] !== undefined ? vars[key] : `{${key}}`;
  });
}

/** 从数据库读取完整巡店日志数据（用于渲染） */
export async function loadInspectionLogForRender(logId: number): Promise<InspectionLogForRender | null> {
  try {
    const pool = await getPool();

    const logResult = await pool.request()
      .input('logId', sql.Int, logId)
      .query(`
        SELECT id, supervisor, date, departure, destination,
               arrivalTime, departureTime, remarks, status, signature
        FROM StoreInspectionLogs
        WHERE id = @logId
      `);
    if (!logResult.recordset || logResult.recordset.length === 0) {
      return null;
    }
    const log = logResult.recordset[0];

    const itemsResult = await pool.request()
      .input('logId', sql.Int, logId)
      .query(`
        SELECT moduleType, itemIndex, itemContent, itemResult, photoPath, photoName
        FROM StoreInspectionLogItems
        WHERE logId = @logId
        ORDER BY moduleType, itemIndex
      `);

    const items: Record<string, FlatItem[]> = {};
    CHECK_MODULES.forEach(m => { items[m.key] = []; });

    (itemsResult.recordset || []).forEach((row: any) => {
      const key = row.moduleType;
      if (!items[key]) items[key] = [];
      items[key].push({
        item: orEmpty(row.itemContent),
        result: orEmpty(row.itemResult),
        photo: orEmpty(row.photoPath),
      });
    });

    const dateStr = log.date instanceof Date
      ? `${log.date.getFullYear()}-${String(log.date.getMonth()+1).padStart(2,'0')}-${String(log.date.getDate()).padStart(2,'0')}`
      : String(log.date || '');

    return {
      id: log.id,
      supervisor: orEmpty(log.supervisor),
      date: dateStr,
      departure: orEmpty(log.departure),
      destination: orEmpty(log.destination),
      arrivalTime: orEmpty(log.arrivalTime),
      departureTime: orEmpty(log.departureTime),
      remarks: orEmpty(log.remarks),
      items,
    };
  } catch (err) {
    console.error('[WechatMessageRenderer] 读取巡店日志失败:', err);
    return null;
  }
}

/** 渲染选项 */
export interface RenderOptions {
  /** 为 true 时不渲染图片行（用于纯文本推送场景） */
  skipPhotos?: boolean;
}

/** 核心渲染：将巡店日志按模板生成文本消息 */
export function renderMessage(
  log: InspectionLogForRender,
  tpl?: WechatTemplateConfigRow,
  options?: RenderOptions
): string {
  const template = tpl || getDefaultTemplate();

  const headerVars: Record<string, string> = {
    supervisor: orWu(log.supervisor),
    date: orWu(log.date),
    departure: orWu(log.departure),
    destination: orWu(log.destination),
    arrivalTime: formatDateTime(log.arrivalTime),
    departureTime: formatDateTime(log.departureTime),
  };

  const header = applyVars(template.headerTemplate, headerVars);

  // 7 大类核查项渲染
  const sectionBlocks: string[] = [];
  let orderCounter = 0;
  for (const mod of CHECK_MODULES) {
    const list = log.items[mod.key] || [];
    // 过滤：事项或结果至少有一个非空才算有内容
    const valid = list.filter(x => (x.item || '').trim() !== '' || (x.result || '').trim() !== '');
    if (valid.length === 0) continue;

    orderCounter += 1;
    const lines: string[] = [];
    for (const it of valid) {
      const photoVal = (it.photo || '').trim();
      const photoText = (!options?.skipPhotos && photoVal !== '')
        ? (photoVal.startsWith('data:image')
            ? '（图片）' // base64 不显示长串；真实图片已通过 image 消息单独推送
            : applyVars(template.photoLineTemplate, { photo: photoVal }))
        : '';
      const itemVars: Record<string, string> = {
        item: orWu(it.item),
        result: orWu(it.result),
        photoLine: photoText,
      };
      lines.push(applyVars(template.singleItemLine, itemVars));
    }
    const blockVars: Record<string, string> = {
      order: String(orderCounter),
      title: mod.title,
      itemsText: lines.join('\n'),
    };
    sectionBlocks.push(applyVars(template.itemTemplate, blockVars));
  }

  const itemsSection = sectionBlocks.length > 0 ? '\n\n' + sectionBlocks.join('\n') : '';

  const footerVars: Record<string, string> = {
    remarks: orWu(log.remarks),
  };
  const footer = applyVars(template.footerTemplate, footerVars);

  const full = `${template.title}\n${header}${itemsSection}${footer}`;
  // 企业微信文本消息不要过长，超过 2000 字截断加提示
  if (full.length > 2000) {
    return full.substring(0, 1990) + '\n...(内容过长已截断)';
  }
  return full;
}

/** 校验核心必填字段是否完整：督导、目的地、到店时间 任意为空 -> 返回缺失字段列表 */
export function getMissingCoreFields(log: InspectionLogForRender): string[] {
  const missing: string[] = [];
  if (!log.supervisor || !log.supervisor.trim()) missing.push('督导');
  if (!log.destination || !log.destination.trim()) missing.push('目的地');
  if (!log.arrivalTime || !log.arrivalTime.trim()) missing.push('到店时间');
  return missing;
}
