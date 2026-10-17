// ============================================================
// 触发器调度服务
// 按模板的 triggerType 定时/定量执行推送
//   - manual:       不自动触发（默认）
//   - scheduled:    按 triggerConfig.cron 定时执行
//   - on_create:    源表有新记录时触发（轮询检测新增）
//   - on_threshold: 累积到 triggerConfig.count 条后触发
// ============================================================

import sql from 'mssql';
import { getPool } from '../../../config/db';
import { dispatchPush, dispatchSummaryPush } from './PushDispatcher';
import { pushModuleRegistry } from './PushModuleRegistry';

let _triggerTimer: NodeJS.Timeout | null = null;
const SCAN_INTERVAL_MS = 60000; // 每分钟扫描一次

/** 启动触发器调度 */
export function startTriggerScheduler(): void {
  if (_triggerTimer) return;
  console.log('[TriggerScheduler] 触发器调度已启动，扫描间隔 60 秒');
  _triggerTimer = setInterval(() => { void scanTriggers(); }, SCAN_INTERVAL_MS);
}

/** 停止调度 */
export function stopTriggerScheduler(): void {
  if (_triggerTimer) { clearInterval(_triggerTimer); _triggerTimer = null; }
}

async function scanTriggers(): Promise<void> {
  try {
    const pool = await getPool();
    // 获取所有非 manual 的活跃模板（排除 inspection_log，该模块由旧版 wechatPushService 推送）
    const result = await pool.request().query(`
      SELECT id, moduleCode, templateName, pushMode, triggerType, triggerConfig, selectedRecipients, selectedFields, headerTemplate, bodyTemplate, footerTemplate, startTime, endTime
      FROM WechatPushTemplateV2
      WHERE isActive = 1 AND triggerType <> 'manual' AND triggerType IS NOT NULL
        AND moduleCode <> 'inspection_log'
    `);

    for (const tpl of (result.recordset || [])) {
      const triggerType = String(tpl.triggerType);
      let config: any = {};
      try { config = JSON.parse(String(tpl.triggerConfig || '{}')); } catch {}
      try { tpl.selectedRecipients = JSON.parse(String(tpl.selectedRecipients || '[]')); } catch { tpl.selectedRecipients = []; }
      try { tpl.selectedFields = JSON.parse(String(tpl.selectedFields || '[]')); } catch { tpl.selectedFields = []; }

      // 按时间范围过滤：不在生效区间内的模板跳过
      const now = new Date();
      if (tpl.startTime && new Date(tpl.startTime) > now) continue;
      if (tpl.endTime && new Date(tpl.endTime) < now) continue;

      switch (triggerType) {
        case 'scheduled':
          await handleScheduled(tpl, config, pool);
          break;
        case 'on_threshold':
          await handleThreshold(tpl, config, pool);
          break;
        case 'on_create':
          await handleOnCreate(tpl, config, pool);
          break;
      }
    }
  } catch (err) {
    console.error('[TriggerScheduler] 扫描异常:', (err as Error).message);
  }
}

// ============================================================
// 定时触发
// ============================================================
async function handleScheduled(tpl: any, config: any, pool: any): Promise<void> {
  const now = new Date();
  const lastRun = config.lastRun ? new Date(config.lastRun) : null;
  const cron = config.cron || '';

  // ============================================================
  // 特殊处理：时段业绩播报（多时段定时触发）
  // cron 格式: "10:00,12:00,14:00,16:00,18:00,20:00,22:00"
  // 使用 per-hour lastRuns 去重，防止同一小时重复推送
  // 走标准模板渲染流程（通过 HourlyPerformanceProvider 加载数据 + 模板渲染）
  // ============================================================
  if (String(tpl.moduleCode) === 'hourly_performance') {
    const times = cron.split(',').map((t: string) => t.trim());
    const matched = times.find((t: string) => {
      const m = t.match(/(\d{1,2}):(\d{2})/);
      if (!m) return false;
      const targetHour = parseInt(m[1]);
      const targetMinute = parseInt(m[2]);
      return now.getHours() === targetHour && now.getMinutes() >= targetMinute && now.getMinutes() < targetMinute + 2;
    });
    if (!matched) return;

    // per-hour 去重
    const hourKey = String(now.getHours());
    const lastRuns: Record<string, string> = config.lastRuns || {};
    const lastRunThisHour = lastRuns[hourKey] ? new Date(lastRuns[hourKey]) : null;
    if (lastRunThisHour && lastRunThisHour.toDateString() === now.toDateString()) return;

    // 更新 lastRuns 并持久化
    lastRuns[hourKey] = now.toISOString();
    const newConfig = { ...config, lastRuns, lastRun: now.toISOString() };
    await pool.request()
      .input('id', sql.Int, tpl.id)
      .input('conf', sql.NVarChar, JSON.stringify(newConfig))
      .query(`UPDATE WechatPushTemplateV2 SET triggerConfig = @conf, updatedAt = GETDATE() WHERE id = @id`);

    console.log(`[TriggerScheduler] 触发时段业绩播报 (${hourKey}:00)`);
    // 走标准模板渲染流程：传虚拟 sourceId=1，由 HourlyPerformanceProvider.loadRenderData 实时查询数据
    await executeTrigger(tpl, newConfig, pool, [1]);
    return;
  }

  // 简化的 cron 解析：支持 "每天HH:mm" 格式
  // 完整 cron 格式: "分 时 日 月 周"
  if (!cron) return;

  const parts = cron.trim().split(/\s+/);
  if (parts.length < 2) {
    // 尝试 "每天HH:mm" 格式
    const match = cron.match(/(\d{1,2}):(\d{2})/);
    if (match) {
      const targetHour = parseInt(match[1]);
      const targetMinute = parseInt(match[2]);
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();

      // 检查是否到了执行时间
      if (currentHour === targetHour && currentMinute >= targetMinute && currentMinute < targetMinute + 2) {
        // 防止重复执行（一天一次）
        if (lastRun && lastRun.toDateString() === now.toDateString()) return;
        await executeTrigger(tpl, config, pool);
      }
      return;
    }
    return;
  }

  // 标准 cron 解析
  const [min, hour] = parts;
  if (cronMatches(min, hour, now)) {
    if (lastRun && (now.getTime() - lastRun.getTime() < 60000)) return;
    await executeTrigger(tpl, config, pool);
  }
}

function cronMatches(min: string, hour: string, now: Date): boolean {
  const cm = now.getMinutes(), ch = now.getHours();
  if (min !== '*' && parseInt(min) !== cm) return false;
  if (hour !== '*' && parseInt(hour) !== ch) return false;
  return true;
}

// ============================================================
// 定量触发：源表累积 N 条新记录后推送
// ============================================================
async function handleThreshold(tpl: any, config: any, pool: any): Promise<void> {
  const threshold = config.count || 10;
  const moduleCode = String(tpl.moduleCode);

  // 查询 WechatPushModules 获取源表信息
  const modResult = await pool.request()
    .input('code', sql.NVarChar, moduleCode)
    .query('SELECT sourceTable, sourceIdField FROM WechatPushModules WHERE moduleCode = @code');
  if (!modResult.recordset || modResult.recordset.length === 0) return;

  const { sourceTable, sourceIdField } = modResult.recordset[0];
  const lastPushedId = config.lastPushedId || 0;

  // 统计新增记录数
  const countResult = await pool.request()
    .input('lastId', sql.Int, lastPushedId)
    .query(`SELECT COUNT(*) AS cnt FROM ${sourceTable} WHERE ${sourceIdField} > @lastId`);

  const newCount = Number(countResult.recordset?.[0]?.cnt || 0);
  if (newCount >= threshold) {
    await executeTrigger(tpl, config, pool);
  }
}

// ============================================================
// 数据新增触发：源表有任意新记录就推送
// ============================================================
async function handleOnCreate(tpl: any, config: any, pool: any): Promise<void> {
  const moduleCode = String(tpl.moduleCode);

  // inspection_log 由旧版 wechatPushService 推送，新版不参与
  if (moduleCode === 'inspection_log') return;

  const modResult = await pool.request()
    .input('code', sql.NVarChar, moduleCode)
    .query('SELECT sourceTable, sourceIdField, sourceFilter FROM WechatPushModules WHERE moduleCode = @code');
  if (!modResult.recordset || modResult.recordset.length === 0) return;

  const { sourceTable, sourceIdField, sourceFilter } = modResult.recordset[0];
  const lastProcessedId = config.lastProcessedId || 0;

  // 取最新的未推送记录；若模块配置了 sourceFilter（如 register 仅待审核），新增圈选同样受其约束
  const newResult = await pool.request()
    .input('lastId', sql.Int, lastProcessedId)
    .query(`SELECT TOP 20 ${sourceIdField} AS id FROM ${sourceTable} WHERE ${sourceIdField} > @lastId${sourceFilter ? ` AND (${sourceFilter})` : ''} ORDER BY ${sourceIdField} ASC`);

  const newIds = (newResult.recordset || []).map((r: any) => Number(r.id));
  if (newIds.length === 0) return;

  await executeTrigger(tpl, config, pool, newIds);
}

// ============================================================
// 执行推送
// ============================================================
async function executeTrigger(tpl: any, config: any, pool: any, sourceIds?: (number | string)[]): Promise<void> {
  const moduleCode = String(tpl.moduleCode);
  const pushMode = String(tpl.pushMode || 'detail');
  console.log(`[TriggerScheduler] 触发推送: ${tpl.templateName} (${moduleCode}) mode=${pushMode}`);

  try {
    if (!sourceIds) {
      // 获取全部符合条件的数据（不限制条数）；默认并排除已推送记录；
      // 若模块 allowRepush=true（如无成本价商品）则不过滤已推送，有数据就推直到查无数据；
      // 若配置了 dedupColumn 则按该列去重（每个业务键只推一条代表记录）。
      const modResult = await pool.request()
        .input('code', sql.NVarChar, moduleCode)
        .query('SELECT sourceTable, sourceIdField, sourceFilter, dedupColumn FROM WechatPushModules WHERE moduleCode = @code');
      if (modResult.recordset?.[0]) {
        const { sourceTable, sourceIdField, sourceFilter, dedupColumn } = modResult.recordset[0];

        // 模块配置了数据提取台账（如无成本价商品）：优先按台账最新 SQL 圈选，保证与数据提取页面数据一致
        const deRows = await pushModuleRegistry.queryModuleRowsByDataExtraction(moduleCode, pool);
        if (deRows) {
          const idField = String(sourceIdField || 'id');
          const ids: string[] = [];
          const seen = new Set<string>();
          for (const row of deRows) {
            const v = row[idField] ?? row[Object.keys(row)[0]];
            if (v === undefined || v === null) continue;
            const s = String(v);
            if (!seen.has(s)) { seen.add(s); ids.push(s); }
          }
          sourceIds = ids;
        } else {
        const whereClause = sourceFilter ? `(${sourceFilter})` : '1=1';
        const allowRepush = !!pushModuleRegistry.getProvider(moduleCode)?.allowRepush;
        let ids;
        if (dedupColumn) {
          // 按 dedupColumn 去重：同业务键取最小 sourceId
          ids = await pool.request()
            .input('mcode', sql.NVarChar, moduleCode)
            .query(`
            SELECT c.[${sourceIdField}] AS id FROM (
              SELECT [${sourceIdField}], ROW_NUMBER() OVER (PARTITION BY [${dedupColumn}] ORDER BY [${sourceIdField}]) AS rn
              FROM ${sourceTable}
              WHERE ${whereClause}
            ) c
            ${allowRepush ? '' : `
            LEFT JOIN WechatPushHistoryV2 h
              ON h.moduleCode = @mcode
             AND CAST(h.sourceId AS nvarchar(100)) = CAST(c.[${sourceIdField}] AS nvarchar(100))
            WHERE c.rn = 1 AND h.id IS NULL`}
            ${allowRepush ? 'WHERE c.rn = 1' : ''}
            ORDER BY c.[${sourceIdField}] DESC
          `);
        } else {
          // 不去重：全部符合条件的记录
          ids = await pool.request()
            .input('mcode', sql.NVarChar, moduleCode)
            .query(allowRepush
              ? `
            SELECT s.[${sourceIdField}] AS id
            FROM ${sourceTable} s
            WHERE ${whereClause}
            ORDER BY s.[${sourceIdField}] DESC
          `
              : `
            SELECT s.[${sourceIdField}] AS id
            FROM ${sourceTable} s
            LEFT JOIN WechatPushHistoryV2 h
              ON h.moduleCode = @mcode
             AND CAST(h.sourceId AS nvarchar(100)) = CAST(s.[${sourceIdField}] AS nvarchar(100))
            WHERE ${whereClause} AND h.id IS NULL
            ORDER BY s.[${sourceIdField}] DESC
          `);
        }
        sourceIds = (ids.recordset || []).map((r: any) => String(r.id));
        }
      }
    }

    if (!sourceIds || sourceIds.length === 0) {
      console.log(`[TriggerScheduler] ${tpl.templateName} 无数据处理，跳过推送`);
      return;
    }

    // 【指定企微人员】读取模板配置的 selectedRecipients（JSON 数组），作为接收人覆盖，
    // 与手动推送(/api/wechat-push-v2/push) / 重推(/repush) 行为保持一致；
    // 未配置时保持原有兜底逻辑（店铺权限组 / 经理+管理组）。
    let recipientOverride: { name: string; wechatAccount: string }[] | undefined;
    // 从数据库读出的是 JSON 字符串，需先解析
    let savedRecipients = tpl.selectedRecipients;
    if (typeof savedRecipients === 'string') {
      try { savedRecipients = JSON.parse(savedRecipients); } catch { savedRecipients = null; }
    }
    if (Array.isArray(savedRecipients)) {
      const valid = savedRecipients.filter((acc: any) => !!acc);
      if (valid.length > 0) {
        recipientOverride = valid.map((acc: any) => ({ name: String(acc), wechatAccount: String(acc) }));
      }
    }

    // 按模板 selectedFields 渲染消息格式（未配置则用模块全字段）
    let savedSelectedFields = tpl.selectedFields;
    if (typeof savedSelectedFields === 'string') {
      try { savedSelectedFields = JSON.parse(savedSelectedFields); } catch { savedSelectedFields = null; }
    }
    const templateSelectedFields: string[] | undefined = Array.isArray(savedSelectedFields) && savedSelectedFields.length > 0
      ? savedSelectedFields.map((f: any) => String(f).trim()).filter(Boolean)
      : undefined;

    if (pushMode === 'summary') {
      const r = await dispatchSummaryPush(moduleCode, sourceIds, 'auto', {
        recipientOverride,
        templateSelectedFields,
        templateHeader: tpl.headerTemplate || undefined,
        templateBody: tpl.bodyTemplate || undefined,
        templateFooter: tpl.footerTemplate || undefined,
      });
      console.log(`[TriggerScheduler] 汇总推送结果: ${r.summary}`);
    } else {
      for (const sourceId of sourceIds) {
        const r = await dispatchPush(moduleCode, sourceId, 'auto', {
          recipientOverride,
          templateSelectedFields,
          ...(tpl.headerTemplate ? {
            templateHeader: tpl.headerTemplate,
            templateBody: tpl.bodyTemplate,
            templateFooter: tpl.footerTemplate,
          } : {}),
        });
        console.log(`[TriggerScheduler] 明细推送 sourceId=${sourceId}: ${r.summary}`);
      }
    }

    // 更新 lastRun / lastProcessedId
    const lastId = sourceIds[sourceIds.length - 1];
    const newConfig = {
      ...config,
      lastRun: new Date().toISOString(),
      lastPushedId: lastId,
      lastProcessedId: lastId,
    };
    await pool.request()
      .input('id', sql.Int, tpl.id)
      .input('conf', sql.NVarChar, JSON.stringify(newConfig))
      .query(`UPDATE WechatPushTemplateV2 SET triggerConfig = @conf, updatedAt = GETDATE() WHERE id = @id`);
  } catch (err) {
    console.error(`[TriggerScheduler] 推送失败 ${tpl.templateName}:`, (err as Error).message);
  }
}
