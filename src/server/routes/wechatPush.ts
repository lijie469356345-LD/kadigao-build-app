// ============================================================
// 企业微信推送管理 API 路由
//
// 包含：
//   GET  /api/wechat-push/settings              读取当前配置
//   PUT  /api/wechat-push/settings              更新配置（含开关/企微API参数）
//   GET  /api/wechat-push/template              读取消息模板
//   PUT  /api/wechat-push/template              更新消息模板
//   POST /api/wechat-push/template/preview      模板实时预览（传入模拟数据）
//   GET  /api/wechat-push/recipients            获取所有接收人
//   POST /api/wechat-push/recipients            新增接收人
//   PUT  /api/wechat-push/recipients/:id        更新接收人
//   DELETE /api/wechat-push/recipients/:id      删除接收人
//   GET  /api/wechat-push/logs                  获取推送日志（支持筛选）
//   POST /api/wechat-push/push/:logId           手动推送某条巡店日志
//   GET  /api/wechat-push/status                获取轮询/运行状态
//   POST /api/wechat-push/poller/trigger        立即触发一次轮询扫描
//
// 所有写操作建议由管理员账号完成。
// ============================================================

import { Router, Request, Response } from 'express';
import multer from 'multer';
import sql from 'mssql';
import axios from 'axios';
import { getPool } from '../../config/db';
import {
  loadInspectionLogForRender,
  renderMessage,
  getDefaultTemplate,
  getMissingCoreFields,
} from '../services/wechatMessageRenderer';
import {
  getSettings,
  pushInspectionLog,
  isApiConfigured,
  uploadMediaToWechat,
  sendMediaMessage,
} from '../services/wechatPushService';
import {
  runOnce,
  getPollerStatus,
  startPollingService,
  resetPollerTimer,
} from '../services/wechatPushPoller';

const router = Router();

// ---------- 初始化 SQL：创建企微推送相关表（幂等） ----------
const TABLE_DEFS = [
  {
    name: 'WechatPushRecipients',
    create: `CREATE TABLE WechatPushRecipients (
  id INT IDENTITY(1,1) PRIMARY KEY,
  wechatAccount NVARCHAR(100) NOT NULL,
  name NVARCHAR(50) NOT NULL,
  isEnabled BIT NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL DEFAULT GETDATE(),
  updatedAt DATETIME NOT NULL DEFAULT GETDATE()
)`,
    init: [],
  },
  {
    name: 'WechatPushLogs',
    create: `CREATE TABLE WechatPushLogs (
  id INT IDENTITY(1,1) PRIMARY KEY,
  logId INT NOT NULL,
  supervisor NVARCHAR(100),
  destination NVARCHAR(200),
  recipientName NVARCHAR(50) NOT NULL,
  recipientAccount NVARCHAR(100) NOT NULL,
  status NVARCHAR(20) NOT NULL,
  message NVARCHAR(MAX) NOT NULL,
  errorDetail NVARCHAR(MAX),
  retryCount INT NOT NULL DEFAULT 0,
  triggeredAt DATETIME NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT GETDATE()
)`,
    init: [
      'CREATE NONCLUSTERED INDEX IX_WechatPushLogs_logId ON WechatPushLogs (logId)',
      'CREATE NONCLUSTERED INDEX IX_WechatPushLogs_status ON WechatPushLogs (status)',
      'CREATE NONCLUSTERED INDEX IX_WechatPushLogs_createdAt ON WechatPushLogs (createdAt)',
    ],
  },
  {
    name: 'WechatPushSettings',
    create: `CREATE TABLE WechatPushSettings (
  id INT PRIMARY KEY DEFAULT 1,
  enabled BIT NOT NULL DEFAULT 1,
  pollingEnabled BIT NOT NULL DEFAULT 1,
  pollingInterval INT NOT NULL DEFAULT 30,
  wechatCorpId NVARCHAR(200),
  wechatSecret NVARCHAR(500),
  wechatAgentId NVARCHAR(100),
  updatedAt DATETIME NOT NULL DEFAULT GETDATE()
)`,
    init: [`INSERT INTO WechatPushSettings (id, enabled, pollingEnabled, pollingInterval) VALUES (1, 1, 1, 30)`],
  },
  {
    name: 'WechatPushTemplate',
    // 多模板模式：去掉单行限制，支持按模块配置不同模板
    create: `CREATE TABLE WechatPushTemplate (
  id INT IDENTITY(1,1) PRIMARY KEY,
  moduleName NVARCHAR(100) NOT NULL DEFAULT N'巡店日志',
  title NVARCHAR(200) NOT NULL DEFAULT N'【巡店自动通知】',
  headerTemplate NVARCHAR(1000) NOT NULL DEFAULT N'督导：{supervisor}
巡店日期：{date}
出发地：{departure}
目的地：{destination}
到店时间：{arrivalTime}
离店时间：{departureTime}',
  itemTemplate NVARCHAR(1000) NOT NULL DEFAULT N'{order}.{title}:
{itemsText}',
  singleItemLine NVARCHAR(1000) NOT NULL DEFAULT N'  · {item}：{result}{photoLine}',
  photoLineTemplate NVARCHAR(500) NOT NULL DEFAULT N'（图片：{photo}）',
  footerTemplate NVARCHAR(500) NOT NULL DEFAULT N'
巡店结论：{remarks}
————系统自动推送，无需回复————',
  recipientGroup NVARCHAR(200),
  recipientPosition NVARCHAR(100),
  isDefault BIT NOT NULL DEFAULT 0,
  updatedAt DATETIME NOT NULL DEFAULT GETDATE()
)`,
    init: [`INSERT INTO WechatPushTemplate (moduleName, isDefault) VALUES (N'巡店日志', 1)`],
  },
  {
    name: 'WechatPushHistory',
    create: `CREATE TABLE WechatPushHistory (
  logId INT PRIMARY KEY,
  pushedAt DATETIME NOT NULL DEFAULT GETDATE(),
  pushedBy NVARCHAR(100)
)`,
    init: [],
  },
];

async function ensureTables() {
  try {
    const pool = await getPool();
    let createdCount = 0;
    for (const def of TABLE_DEFS) {
      const existsResult = await pool
        .request()
        .input('tableName', sql.NVarChar, def.name)
        .query(
          `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @tableName`
        );
      const exists = (existsResult.recordset || []).length > 0;
      if (exists) continue;
      await pool.request().query(def.create);
      for (const s of def.init) {
        try { await pool.request().query(s); } catch (_e) { /* ignore */ }
      }
      createdCount++;
    }
    return { ok: true, created: createdCount };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// 路由启动时自动建表（不阻塞，后台异步执行）
setTimeout(() => {
  void ensureTables().then((r: { ok: boolean; created?: number; error?: string }) => {
    const createdCount = r.created || 0;
    if (r.ok) {
      console.log(
        createdCount > 0
          ? `[WechatPushRouter] 已创建 ${createdCount} 张表`
          : '[WechatPushRouter] 数据库表均已存在，无需创建'
      );
    } else {
      console.warn('[WechatPushRouter] 初始化失败（可能数据库暂不可用）：', r.error);
    }
  });
}, 2000);

router.post('/init', async (_req, res) => {
  const r = await ensureTables();
  if (r.ok) {
    resetPollerTimer();
    void startPollingService();
    res.json({ ok: true, created: r.created || 0, message: '表结构已创建/验证完成' });
  } else {
    res.status(500).json({ ok: false, error: r.error });
  }
});

// ---------- 通用安全函数：查询失败时空返回 ----------
async function querySafe(pool: sql.ConnectionPool, sqlText: string): Promise<any[]> {
  try {
    const r = await pool.request().query(sqlText);
    return r.recordset || [];
  } catch (err) {
    console.warn('[WechatPushRouter] SQL 执行失败（可能表尚未创建）:', (err as Error).message);
    return [];
  }
}

// ---------- 读取 & 更新系统设置 ----------
router.get('/settings', async (_req, res) => {
  try {
    const pool = await getPool();
    // 检查 proxyUrl 列是否存在（兼容旧库）
    const hasProxy = ((
      await querySafe(pool, `
        SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'WechatPushSettings' AND COLUMN_NAME = 'proxyUrl'
      `)
    )[0]?.c || 0) > 0;

    const colSql = hasProxy
      ? `SELECT id, enabled, pollingEnabled, pollingInterval, wechatCorpId, wechatSecret, wechatAgentId, proxyUrl, updatedAt
         FROM WechatPushSettings WHERE id = 1`
      : `SELECT id, enabled, pollingEnabled, pollingInterval, wechatCorpId, wechatSecret, wechatAgentId, updatedAt
         FROM WechatPushSettings WHERE id = 1`;
    const row = (await querySafe(pool, colSql))[0];

    const settings = row
      ? {
          id: row.id,
          enabled: row.enabled === 1 || row.enabled === true,
          pollingEnabled: row.pollingEnabled === 1 || row.pollingEnabled === true,
          pollingInterval: Number(row.pollingInterval) || 30,
          wechatCorpId: row.wechatCorpId || '',
          wechatSecret: '******',
          wechatAgentId: row.wechatAgentId || '',
          proxyUrl: hasProxy ? (row.proxyUrl || '') : '',
          updatedAt: row.updatedAt,
        }
      : {
          id: 1,
          enabled: true,
          pollingEnabled: true,
          pollingInterval: 30,
          wechatCorpId: '',
          wechatSecret: '',
          wechatAgentId: '',
          proxyUrl: '',
          updatedAt: null,
        };

    const apiOk = isApiConfigured(await getSettings());

    // 获取本机出网 IP，方便用户粘贴到企微可信IP白名单
    // 注意：此处必须直连（不走代理），因为代理IP会改变检测结果
    const ipSources = [
      { url: 'https://api.ipify.org?format=json', parse: (d: any) => d?.ip || '' },
      { url: 'https://api.myip.com', parse: (d: any) => d?.ip || '' },
      { url: 'https://ipinfo.io/json', parse: (d: any) => d?.ip || '' },
    ];
    let publicIp = '';
    let ipError = '';

    for (const { url, parse } of ipSources) {
      try {
        const resp = await axios.get(url, {
          timeout: 3000,
          proxy: false, // 强制直连，不走代理配置
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        const ip = parse(resp.data);
        if (ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
          publicIp = ip;
          ipError = '';
          break;
        }
      } catch (err: any) {
        ipError = err?.message || `无法访问 ${url}`;
      }
    }

    if (!publicIp && ipError) {
      publicIp = `检测失败: ${ipError} — 可手动在浏览器访问 https://api.ipify.org 获取本机公网IP后填到企微可信IP`;
    }

    res.json({ settings, apiConfigured: apiOk, publicIp });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const {
      enabled,
      pollingEnabled,
      pollingInterval,
      wechatCorpId,
      wechatSecret,
      wechatAgentId,
      proxyUrl,
    } = req.body;

    const pool = await getPool();

    // 确保 proxyUrl 列存在（旧库自动升级）
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'WechatPushSettings' AND COLUMN_NAME = 'proxyUrl')
      ALTER TABLE WechatPushSettings ADD proxyUrl NVARCHAR(500) NULL
    `);

    const existing = (
      await querySafe(pool, `SELECT id, wechatSecret FROM WechatPushSettings WHERE id = 1`)
    )[0];

    const newEnabled = enabled === true || enabled === 1 ? 1 : 0;
    const newPollingEnabled = pollingEnabled === true || pollingEnabled === 1 ? 1 : 0;
    const newInterval = Math.max(30, Number(pollingInterval) || 30);
    const keepSecret = !wechatSecret || wechatSecret === '******';
    const finalSecret = keepSecret ? (existing?.wechatSecret || '') : wechatSecret;

    if (existing) {
      await pool.request()
        .input('enabled', sql.Bit, newEnabled)
        .input('pollingEnabled', sql.Bit, newPollingEnabled)
        .input('pollingInterval', sql.Int, newInterval)
        .input('corpId', sql.NVarChar, wechatCorpId || '')
        .input('secret', sql.NVarChar, finalSecret || '')
        .input('agentId', sql.NVarChar, wechatAgentId || '')
        .input('proxyUrl', sql.NVarChar, proxyUrl || '')
        .query(`
          UPDATE WechatPushSettings SET
            enabled = @enabled,
            pollingEnabled = @pollingEnabled,
            pollingInterval = @pollingInterval,
            wechatCorpId = @corpId,
            wechatSecret = @secret,
            wechatAgentId = @agentId,
            proxyUrl = @proxyUrl,
            updatedAt = GETDATE()
          WHERE id = 1
        `);
    } else {
      await pool.request()
        .input('enabled', sql.Bit, newEnabled)
        .input('pollingEnabled', sql.Bit, newPollingEnabled)
        .input('pollingInterval', sql.Int, newInterval)
        .input('corpId', sql.NVarChar, wechatCorpId || '')
        .input('secret', sql.NVarChar, finalSecret || '')
        .input('agentId', sql.NVarChar, wechatAgentId || '')
        .input('proxyUrl', sql.NVarChar, proxyUrl || '')
        .query(`
          INSERT INTO WechatPushSettings
            (id, enabled, pollingEnabled, pollingInterval, wechatCorpId, wechatSecret, wechatAgentId, proxyUrl)
          VALUES (1, @enabled, @pollingEnabled, @pollingInterval, @corpId, @secret, @agentId, @proxyUrl)
        `);
    }

    // 配置变化后重启轮询（使用新的间隔）
    resetPollerTimer();
    if (newPollingEnabled) void startPollingService();

    res.json({ ok: true, message: '设置已更新' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------- 消息模板 CRUD ----------
router.get('/template', async (_req, res) => {
  try {
    const pool = await getPool();
    const row = (
      await querySafe(pool, `
        SELECT title, headerTemplate, itemTemplate, singleItemLine,
               photoLineTemplate, footerTemplate, updatedAt
        FROM WechatPushTemplate WHERE id = 1
      `)
    )[0];
    if (row) {
      res.json({ template: row });
    } else {
      res.json({ template: { ...getDefaultTemplate() } });
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.put('/template', async (req, res) => {
  try {
    const { title, headerTemplate, itemTemplate, singleItemLine, photoLineTemplate, footerTemplate } = req.body;
    const pool = await getPool();
    const existing = (
      await querySafe(pool, `SELECT id FROM WechatPushTemplate WHERE id = 1`)
    )[0];

    if (existing) {
      await pool.request()
        .input('title', sql.NVarChar, title || '')
        .input('header', sql.NVarChar, headerTemplate || '')
        .input('item', sql.NVarChar, itemTemplate || '')
        .input('single', sql.NVarChar, singleItemLine || '')
        .input('photo', sql.NVarChar, photoLineTemplate || '')
        .input('footer', sql.NVarChar, footerTemplate || '')
        .query(`
          UPDATE WechatPushTemplate SET
            title = @title, headerTemplate = @header, itemTemplate = @item,
            singleItemLine = @single, photoLineTemplate = @photo,
            footerTemplate = @footer, updatedAt = GETDATE()
          WHERE id = 1
        `);
    } else {
      await pool.request()
        .input('title', sql.NVarChar, title || '')
        .input('header', sql.NVarChar, headerTemplate || '')
        .input('item', sql.NVarChar, itemTemplate || '')
        .input('single', sql.NVarChar, singleItemLine || '')
        .input('photo', sql.NVarChar, photoLineTemplate || '')
        .input('footer', sql.NVarChar, footerTemplate || '')
        .query(`
          INSERT INTO WechatPushTemplate
            (id, title, headerTemplate, itemTemplate, singleItemLine, photoLineTemplate, footerTemplate)
          VALUES (1, @title, @header, @item, @single, @photo, @footer)
        `);
    }
    res.json({ ok: true, message: '模板已更新' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/template/preview', async (req, res) => {
  try {
    // 支持两种模式：
    //   1) 传 logId：用真实巡店日志渲染
    //   2) 不传 logId：用一个内置 mock 数据渲染
    const { logId, template } = req.body;

    let log = null as any;
    if (logId) {
      log = await loadInspectionLogForRender(Number(logId));
      if (!log) {
        res.status(404).json({ error: '巡店日志不存在' });
        return;
      }
    } else {
      log = {
        id: 0,
        supervisor: '张督导',
        date: '2025-01-01',
        departure: '总部',
        destination: '时代广场六店',
        arrivalTime: '2025-01-01 10:00',
        departureTime: '2025-01-01 18:00',
        remarks: '整体运营情况良好，有待提升陈列。',
        items: {
          coreItems: [{ item: '员工到岗', result: '全部到岗', photo: '' }],
          shopIssues: [{ item: '货架整理', result: '部分乱', photo: 'https://example.com/img.jpg' }],
          teachingTraining: [],
          competitorInfo: [{ item: '竞品活动', result: '买一送一', photo: '' }],
          marketResearch: [],
          staffCollection: [],
          marketChanges: [],
        },
      };
    }

    const missing = getMissingCoreFields(log);
    const tplOverride = template && typeof template === 'object' && template.headerTemplate ? template : undefined;
    const message = renderMessage(log, tplOverride);
    res.json({ message, missing });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------- 接收人 CRUD (组织/角色维度筛选) ----------
router.get('/recipients', async (req, res) => {
  try {
    const pool = await getPool();
    const { search, roleId, orgId } = req.query;
    // 从用户全表获取可推送的用户（有企微账号的）；按角色/组织筛选（岗位维度已下线）
    let query = `SELECT u.用户代码 as userCode, u.用户名称 as userName, u.手机号 as phone,
              ISNULL((SELECT STUFF((SELECT DISTINCT '、' + org_name FROM sys_org so
                 JOIN sys_user_role ur2 ON ur2.org_id = so.org_id AND ur2.user_code = u.用户代码
                 WHERE so.del_flag = 0 FOR XML PATH('')), 1, 1, '')), '') as groupName,
              ISNULL((SELECT STUFF((SELECT DISTINCT '、' + role_name FROM sys_role sr
                 JOIN sys_user_role ur3 ON ur3.role_id = sr.role_id AND ur3.user_code = u.用户代码
                 WHERE sr.del_flag = 0 FOR XML PATH('')), 1, 1, '')), '') as position,
              u.企微账号 as wechatAccount
      FROM 用户全 u
      WHERE u.企微账号 IS NOT NULL AND u.企微账号 <> ''`;
    const params: any[] = [];
    if (roleId && String(roleId) !== '') {
      query += ` AND EXISTS (SELECT 1 FROM sys_user_role ur WHERE ur.user_code = u.用户代码 AND ur.role_id = @roleId)`;
      params.push({ name: 'roleId', type: sql.Int, value: Number(roleId) });
    }
    if (orgId && String(orgId) !== '') {
      const orgIdNum = Number(orgId);
      query += ` AND EXISTS (SELECT 1 FROM sys_user_role ur WHERE ur.user_code = u.用户代码
                 AND (ur.org_id = @orgId OR EXISTS (SELECT 1 FROM sys_org so WHERE so.org_id = ur.org_id
                   AND so.ancestors LIKE @orgPath AND so.del_flag = 0)))`;
      params.push({ name: 'orgId', type: sql.Int, value: orgIdNum });
      params.push({ name: 'orgPath', type: sql.NVarChar, value: `%/${orgIdNum}/%` });
    }
    if (search && typeof search === 'string') {
      query += ` AND (u.用户代码 LIKE @s1 OR u.用户名称 LIKE @s2 OR u.手机号 LIKE @s3)`;
      params.push({ name: 's1', type: sql.NVarChar, value: `%${search}%` });
      params.push({ name: 's2', type: sql.NVarChar, value: `%${search}%` });
      params.push({ name: 's3', type: sql.NVarChar, value: `%${search}%` });
    }
    query += ` ORDER BY u.用户名称`;
    const request = pool.request();
    params.forEach(p => request.input(p.name, p.type, p.value));
    const rows = await request.query(query);
    res.json(rows.recordset);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/recipients', async (req, res) => {
  try {
    const { wechatAccount, name, isEnabled } = req.body;
    if (!wechatAccount || !name) {
      res.status(400).json({ error: 'wechatAccount 和 name 必填' });
      return;
    }
    const pool = await getPool();
    const result = await pool.request()
      .input('account', sql.NVarChar, String(wechatAccount).trim())
      .input('name', sql.NVarChar, String(name).trim())
      .input('enabled', sql.Bit, isEnabled === false || isEnabled === 0 ? 0 : 1)
      .query(`
        INSERT INTO WechatPushRecipients (wechatAccount, name, isEnabled)
        OUTPUT INSERTED.id, INSERTED.wechatAccount, INSERTED.name, INSERTED.isEnabled
        VALUES (@account, @name, @enabled)
      `);
    res.json({ ok: true, recipient: result.recordset[0] });
  } catch (err: any) {
    // 唯一索引冲突（账号重复）
    if (/duplicate key/i.test(err?.message || '')) {
      res.status(400).json({ error: '企业微信账号已存在' });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

router.put('/recipients/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { wechatAccount, name, isEnabled } = req.body;
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, id)
      .input('account', sql.NVarChar, String(wechatAccount || '').trim())
      .input('name', sql.NVarChar, String(name || '').trim())
      .input('enabled', sql.Bit, isEnabled === false || isEnabled === 0 ? 0 : 1)
      .query(`
        UPDATE WechatPushRecipients SET
          wechatAccount = @account, name = @name, isEnabled = @enabled, updatedAt = GETDATE()
        WHERE id = @id
      `);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.delete('/recipients/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, id)
      .query(`DELETE FROM WechatPushRecipients WHERE id = @id`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------- 推送日志查询 ----------
router.get('/logs', async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      supervisor,
      status,
      page = '1',
      pageSize = '50',
    } = req.query;

    const pool = await getPool();
    const clauses: string[] = [];
    const inputs: { name: string; type: any; value: any }[] = [];

    if (startDate && typeof startDate === 'string') {
      clauses.push('createdAt >= @startDate');
      inputs.push({ name: 'startDate', type: sql.DateTime, value: new Date(startDate) });
    }
    if (endDate && typeof endDate === 'string') {
      clauses.push('createdAt <= @endDate');
      inputs.push({ name: 'endDate', type: sql.DateTime, value: new Date(endDate) });
    }
    if (supervisor && typeof supervisor === 'string') {
      clauses.push('supervisor LIKE @supervisor');
      inputs.push({ name: 'supervisor', type: sql.NVarChar, value: `%${supervisor}%` });
    }
    if (status && typeof status === 'string' && status !== 'all') {
      clauses.push('status = @status');
      inputs.push({ name: 'status', type: sql.NVarChar, value: status });
    }

    const where = clauses.length > 0 ? ' WHERE ' + clauses.join(' AND ') : '';

    const reqCount = pool.request();
    inputs.forEach((i) => reqCount.input(i.name, i.type, i.value));
    const countResult = await reqCount.query(
      `SELECT COUNT(*) AS c FROM WechatPushLogs${where}`
    );
    const total = Number((countResult.recordset || [])[0]?.c || 0);

    const pageNum = Math.max(1, Number(page) || 1);
    const size = Math.min(200, Math.max(10, Number(pageSize) || 50));
    const offset = (pageNum - 1) * size;

    const reqData = pool.request();
    inputs.forEach((i) => reqData.input(i.name, i.type, i.value));
    const data =
      (
        await reqData.query(`
          SELECT TOP ${size} * FROM (
            SELECT id, logId, supervisor, destination,
                   recipientName, recipientAccount, status,
                   errorDetail, retryCount, triggeredAt, createdAt
            FROM WechatPushLogs${where}
          ) AS filtered
          WHERE id NOT IN (
            SELECT TOP ${offset} id FROM WechatPushLogs${where} ORDER BY createdAt DESC
          )
          ORDER BY createdAt DESC
        `)
      ).recordset || [];

    res.json({ total, page: pageNum, pageSize: size, logs: data });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------- 手动推送 ----------
router.post('/push/:logId', async (req, res) => {
  try {
    const { logId } = req.params;
    const { recipientIds, forceRepush } = req.body;
    const result = await pushInspectionLog(Number(logId), 'manual', {
      recipientIds: Array.isArray(recipientIds)
        ? recipientIds.map((x) => Number(x))
        : undefined,
      forceRepush: forceRepush === true || forceRepush === 1,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------- 批量手动推送（需求4：选择多条日志再次推送） ----------
router.post('/push-batch', async (req, res) => {
  try {
    const { logIds, forceRepush } = req.body;
    if (!Array.isArray(logIds) || logIds.length === 0) {
      res.status(400).json({ error: 'logIds 必须为非空数组' });
      return;
    }
    const doForce = forceRepush === true || forceRepush === 1;
    const results: any[] = [];
    for (const id of logIds) {
      try {
        const r = await pushInspectionLog(Number(id), 'manual', { forceRepush: doForce });
        results.push({ logId: Number(id), summary: r.summary });
      } catch (e) {
        results.push({ logId: Number(id), summary: `推送异常：${(e as Error).message}` });
      }
    }
    const successCount = results.filter((r) => /成功/.test(r.summary)).length;
    res.json({ ok: true, total: logIds.length, successCount, results });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------- 企业微信消息回调接口 ----------
// 用于：企微后台"接收消息服务器URL"配置时的GET验证 + POST接收消息
// 用法：企微后台填 URL = https://你的域名/api/wechat-push/callback
//       Token = 自定义字符串（与下方 WX_CALLBACK_TOKEN 一致）
//       EncodingAESKey = 企微后台"随机生成"的43位 Base64 字符串
// 安全模式：兼容安全模式（加密）和明文模式
import {
  verifySignature,
  decryptEchostr,
  parseEncryptedMessage,
  buildPassiveReply,
  encryptMsg,
  generateSignature,
} from '../services/wechatCallbackCrypto';

const WX_CALLBACK_TOKEN = 'kadiantongwechat';
const WX_AES_KEY = '7GIrztkMbk5M8TDns8HjBQ4XqOf3BqKLLXm5LSnjjiv'; // 企微后台生成后替换
const WX_CORP_ID = 'ww0dfb932920dec9eb';

// 回调配置
function getCallbackConfig() {
  return {
    token: WX_CALLBACK_TOKEN,
    encodingAESKey: WX_AES_KEY,
    corpId: WX_CORP_ID,
  };
}

// GET: 企微后台保存回调URL时的验证请求
router.get('/callback', (req, res) => {
  try {
    const { msg_signature, timestamp, nonce, echostr } = req.query;

    if (!echostr) {
      res.status(400).send('Missing echostr');
      return;
    }

    const echostrStr = String(echostr);
    const config = getCallbackConfig();

    // 检查是否加密（echostr 很长表示加密，很短表示明文模式）
    if (msg_signature && echostrStr.length > 40) {
      // 安全模式：有 msg_signature 且 echostr 较长 → 校验签名并解密
      console.log('[WxCallback] 收到加密GET验证请求');
      const sigOk = verifySignature(
        config.token,
        String(timestamp || ''),
        String(nonce || ''),
        echostrStr,
        String(msg_signature || '')
      );
      if (!sigOk) {
        console.warn('[WxCallback] 签名校验失败');
        res.status(403).send('Signature verification failed');
        return;
      }
      const decrypted = decryptEchostr(config.encodingAESKey, echostrStr);
      console.log('[WxCallback] 校验通过，echostr解密成功');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(decrypted);
    } else {
      // 明文模式：直接返回 echostr
      console.log('[WxCallback] 收到明文GET验证请求');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(echostrStr);
    }
  } catch (err) {
    console.error('[WxCallback] GET验证异常:', err);
    res.status(500).send('Server error');
  }
});

// POST: 接收企业微信推送的用户消息
router.post('/callback', async (req, res) => {
  try {
    const config = getCallbackConfig();

    // 获取原始 XML body
    let xmlBody = '';
    if (typeof req.body === 'string') {
      xmlBody = req.body;
    } else if (Buffer.isBuffer(req.body)) {
      xmlBody = req.body.toString('utf8');
    } else if (req.body && typeof req.body === 'object') {
      xmlBody = JSON.stringify(req.body);
    }

    if (!xmlBody) {
      res.status(400).send('Empty body');
      return;
    }

    // 判断是否加密（包含 <Encrypt> 则是加密模式）
    const isEncrypted = xmlBody.includes('<Encrypt>');

    let msg: { fromUserName: string; toUserName: string; content: string; msgType: string; createTime: string; rawXml: string } | null = null;

    if (isEncrypted) {
      // 安全模式：校验签名 + 解密
      const sigMatch = xmlBody.match(/<MsgSignature><!\[CDATA\[(.*?)\]\]><\/MsgSignature>/);
      const tsMatch = xmlBody.match(/<TimeStamp>(.*?)<\/TimeStamp>/);
      const nonceMatch = xmlBody.match(/<Nonce><!\[CDATA\[(.*?)\]\]><\/Nonce>/);
      const encMatch = xmlBody.match(/<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/);

      if (sigMatch && tsMatch && nonceMatch && encMatch) {
        const sigOk = verifySignature(
          config.token,
          tsMatch[1],
          nonceMatch[1],
          encMatch[1],
          sigMatch[1]
        );
        if (!sigOk) {
          console.warn('[WxCallback] POST签名校验失败');
          res.status(403).send('Signature failed');
          return;
        }
      }

      msg = parseEncryptedMessage(xmlBody, config);
    } else {
      // 明文模式：直接解析XML
      const getTag = (tag: string) => {
        const m = xmlBody.match(new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]></${tag}>`));
        if (m) return m[1];
        const m2 = xmlBody.match(new RegExp(`<${tag}>(.*?)</${tag}>`));
        return m2 ? m2[1] : '';
      };
      msg = {
        fromUserName: getTag('FromUserName'),
        toUserName: getTag('ToUserName'),
        content: getTag('Content'),
        msgType: getTag('MsgType'),
        createTime: getTag('CreateTime'),
        rawXml: xmlBody,
      };
    }

    if (!msg) {
      res.status(400).send('Parse failed');
      return;
    }

    console.log(`[WxCallback] 收到消息: From=${msg.fromUserName}, Type=${msg.msgType}, Content=${msg.content}`);

    // 消息处理与回复
    if (msg.msgType === 'text' && msg.content) {
      const replyContent = await handleTextMessage(msg.fromUserName, msg.content);

      if (replyContent) {
        if (isEncrypted) {
          const replyXml = buildPassiveReply(
            msg.fromUserName,
            msg.toUserName,
            replyContent,
            config
          );
          res.setHeader('Content-Type', 'application/xml; charset=utf-8');
          res.send(replyXml);
          console.log(`[WxCallback] 被动回复(加密): ${replyContent}`);
        } else {
          const ts = String(Math.floor(Date.now() / 1000));
          const plainReply =
            `<xml>` +
            `<ToUserName><![CDATA[${msg.fromUserName}]]></ToUserName>` +
            `<FromUserName><![CDATA[${msg.toUserName}]]></FromUserName>` +
            `<CreateTime>${ts}</CreateTime>` +
            `<MsgType><![CDATA[text]]></MsgType>` +
            `<Content><![CDATA[${replyContent}]]></Content>` +
            `</xml>`;
          res.setHeader('Content-Type', 'application/xml; charset=utf-8');
          res.send(plainReply);
          console.log(`[WxCallback] 被动回复(明文): ${replyContent}`);
        }
        return;
      }
    }

    // 无回复：返回空
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send('');
  } catch (err) {
    console.error('[WxCallback] POST异常:', err);
    res.status(500).send('');
  }
});

// ==================== 消息处理逻辑 ====================

/**
 * 处理用户发送的文本消息，返回被动回复内容
 * 同时将用户消息写入数据库，可在推送日志页面查看
 */
async function handleTextMessage(userId: string, content: string): Promise<string> {
  const text = content.trim();

  // 记录用户消息到数据库
  try {
    const pool = await getPool();
    await pool.request()
      .input('mod', sql.NVarChar, 'custom_notification')
      .input('sid', sql.Int, 0)
      .input('tbl', sql.NVarChar, '(无)')
      .input('title', sql.NVarChar, `用户回复: ${userId}`)
      .input('sup', sql.NVarChar, userId)
      .input('dest', sql.NVarChar, '企微会话')
      .input('rname', sql.NVarChar, userId)
      .input('racct', sql.NVarChar, userId)
      .input('msg', sql.NVarChar, `[用户消息] ${text}`)
      .input('status', sql.NVarChar, 'success')
      .input('err', sql.NVarChar, '')
      .input('retry', sql.Int, 0)
      .input('by', sql.NVarChar, 'callback_reply')
      .query(`INSERT INTO WechatPushLogsV2 (moduleCode, sourceId, sourceTable, sourceTitle, supervisor, destination, recipientName, recipientAccount, messageContent, status, errorDetail, retryCount, triggeredBy, triggeredAt)
              VALUES (@mod, @sid, @tbl, @title, @sup, @dest, @rname, @racct, @msg, @status, @err, @retry, @by, GETDATE())`);
  } catch (_e) { /* 表可能未创建，忽略 */ }

  // 回复逻辑
  if (text === '收到' || text === 'ok' || text === 'OK' || text === '好的') {
    return `✅ 已确认收到！\n\n你的UserID: ${userId}\n确认时间: ${new Date().toLocaleString('zh-CN')}`;
  }

  if (text === '测试' || text === 'test') {
    return `✅ 测试成功！\n你的UserID: ${userId}\n时间: ${new Date().toLocaleString('zh-CN')}\n\n回复关键字：\n· 收到 — 确认回执\n· 帮助 — 查看命令`;
  }

  if (text === '帮助' || text === 'help') {
    return `📋 可用命令：\n· 收到 — 确认回执\n· 测试 — 测试连接\n· 帮助 — 查看此列表`;
  }

  // 默认回复
  return `已收到你的消息：「${text}」\n回复「帮助」查看可用命令`;
}

// ==================== 主动推送接口 ====================

export async function sendTextToUser(
  userId: string,
  content: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const pool = await getPool?.();
    let corpId = WX_CORP_ID;
    let secret = '';
    let agentId = '';

    if (pool) {
      const settings = await pool.request().query(
        `SELECT wechatCorpId, wechatSecret, wechatAgentId FROM WechatPushSettings WHERE id = 1`
      );
      if (settings.recordset?.length) {
        corpId = settings.recordset[0].wechatCorpId || corpId;
        secret = settings.recordset[0].wechatSecret || '';
        agentId = settings.recordset[0].wechatAgentId || '';
      }
    }

    if (!secret || !agentId) {
      return { ok: false, error: '企业微信 API 未完整配置' };
    }

    const tokenResp = await axios.get(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`,
      { timeout: 10000 }
    );
    if (tokenResp.data.errcode !== 0) {
      return { ok: false, error: `获取token失败: ${tokenResp.data.errmsg}` };
    }

    const sendResp = await axios.post(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${tokenResp.data.access_token}`,
      {
        touser: userId,
        msgtype: 'text',
        agentid: Number(agentId),
        text: { content },
        safe: 0,
      },
      { timeout: 10000 }
    );

    if (sendResp.data.errcode === 0) return { ok: true };

    const ec = sendResp.data.errcode;
    if (ec === 81013) return { ok: false, error: `用户 ${userId} 不在应用可见范围（81013）` };
    if (ec === 81012) return { ok: false, error: `用户 ${userId} 未关注应用（81012）` };
    if (ec === 60020) return { ok: false, error: `IP白名单限制（60020）` };
    return { ok: false, error: `发送失败 errcode=${ec}: ${sendResp.data.errmsg}` };
  } catch (err: any) {
    return { ok: false, error: `请求异常: ${err.message}` };
  }
}

/**
 * 批量群发文本消息：将大量接收人分为≤500人的批次，用企业微信 touser 合并发送。
 * 单次调用不再逐个循环，大幅降低耗时（1000人从数分钟降到几秒）。
 * 若某批包含不在可见范围的用户（errcode=81013），自动降级为单发以定位失败者。
 */
export async function sendTextToMany(
  userIds: string[],
  content: string
): Promise<{ ok: boolean; total: number; success: number; failed: Array<{ user: string; error: string }> }> {
  const CHUNK = 500;
  const failed: Array<{ user: string; error: string }> = [];
  let success = 0;

  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK).filter(Boolean);
    if (chunk.length === 0) continue;
    try {
      const pool = await getPool?.();
      let corpId = WX_CORP_ID;
      let secret = '';
      let agentId = '';
      if (pool) {
        const settings = await pool.request().query(
          `SELECT wechatCorpId, wechatSecret, wechatAgentId FROM WechatPushSettings WHERE id = 1`
        );
        if (settings.recordset?.length) {
          corpId = settings.recordset[0].wechatCorpId || corpId;
          secret = settings.recordset[0].wechatSecret || '';
          agentId = settings.recordset[0].wechatAgentId || '';
        }
      }
      if (!secret || !agentId) {
        chunk.forEach(u => failed.push({ user: u, error: '企微未完整配置' }));
        continue;
      }
      const tokenResp = await axios.get(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`, { timeout: 10000 });
      if (tokenResp.data.errcode !== 0) { chunk.forEach(u => failed.push({ user: u, error: tokenResp.data.errmsg })); continue; }
      const token = tokenResp.data.access_token;

      const sendResp = await axios.post(
        `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
        { touser: chunk.join('|'), msgtype: 'text', agentid: Number(agentId), text: { content }, safe: 0 },
        { timeout: 15000 }
      );
      const ec = sendResp.data.errcode;
      if (ec === 0) {
        success += chunk.length;
      } else if (ec === 81013 || ec === 81012) {
        // 有成员不在可见范围/未关注，单发定位
        for (const u of chunk) {
          const r = await sendTextToUser(u, content);
          if (r.ok) success++;
          else failed.push({ user: u, error: r.error || `errcode=${ec}` });
        }
      } else {
        chunk.forEach(u => failed.push({ user: u, error: `errcode=${ec}: ${sendResp.data.errmsg}` }));
      }
    } catch (err: any) {
      // 网络异常：本批全部失败，逐个补发以免整体超时
      for (const u of chunk) {
        try { const r = await sendTextToUser(u, content); if (r.ok) success++; else failed.push({ user: u, error: r.error || '发送失败' }); }
        catch (e: any) { failed.push({ user: u, error: e.message }); }
      }
    }
  }

  return { ok: failed.length === 0, total: userIds.length, success, failed };
}

// POST /api/wechat-push/send-to-user — 测试主动推送
router.post('/send-to-user', async (req, res) => {
  try {
    const { userId, content } = req.body;
    if (!userId || !content) {
      res.status(400).json({ error: 'userId 和 content 必填' });
      return;
    }
    res.json(await sendTextToUser(String(userId), String(content)));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// 媒体文件上传 + 推送（图片/视频/文件/PPT/Excel/PDF）
// ============================================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

/** 企业微信临时素材限制：图片2MB、语音2MB、视频10MB、普通文件20MB */
const WECHAT_MEDIA_LIMITS = { image: 2 * 1024 * 1024, video: 10 * 1024 * 1024, file: 20 * 1024 * 1024 };

// 上传用途 → 企微素材 type
function mediaTypeForUpload(msgtype: string): string {
  if (msgtype === 'image') return 'image';
  if (msgtype === 'video') return 'video';
  return 'file';
}

// POST /api/wechat-push/media/upload — 上传媒体文件到企微素材库，返回 media_id
router.post('/media/upload', upload.single('media'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: '未收到文件（字段名 media）' });
      return;
    }
    const settings = await getSettings();
    const ext = (req.file.originalname.split('.').pop() || '').toLowerCase();
    const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'bmp'];
    const VIDEO_EXT = ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm', 'm4v'];
    let msgType: 'image' | 'video' | 'file';
    if (IMAGE_EXT.includes(ext)) msgType = 'image';
    else if (VIDEO_EXT.includes(ext)) msgType = 'video';
    else msgType = 'file';

    // 企业微信临时素材大小限制
    const limit = WECHAT_MEDIA_LIMITS[msgType];
    if (req.file.size > limit) {
      const sizeMB = (req.file.size / 1024 / 1024).toFixed(1);
      const limitMB = (limit / 1024 / 1024).toFixed(0);
      const limitLabel = msgType === 'image' ? '2MB' : msgType === 'video' ? '10MB' : '20MB';
      res.status(400).json({ error: `文件过大（${sizeMB}MB），企业微信${msgType === 'image' ? '图片' : msgType === 'video' ? '视频' : '文件'}上限为 ${limitLabel}。请压缩后重试` });
      return;
    }

    const media_type = mediaTypeForUpload(msgType); // image | video | file
    const media_id = await uploadMediaToWechat(
      req.file.buffer,
      req.file.originalname || `upload.${ext}`,
      media_type,
      settings
    );
    res.json({ ok: true, media_id, type: msgType, filename: req.file.originalname, size: req.file.size });
  } catch (err: any) {
    // 区分 multer 上传超限
    if (err?.name === 'MulterError' && err?.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: '文件超过上传大小限制（25MB），请压缩后重试' });
      return;
    }
    const msg = String(err?.message || err || '上传失败');
    res.status(500).json({ error: msg });
  }
});

// POST /api/wechat-push/media/send — 发送媒体消息给指定用户数组
// body: { recipients: string[], mediaId, msgtype: 'image'|'video'|'file', text?: string, filename?: string }
router.post('/media/send', async (req, res) => {
  try {
    const { recipients, mediaId: mediaIdRaw, msgtype = 'file', text = '' } = req.body;
    if (!Array.isArray(recipients) || recipients.length === 0) {
      res.status(400).json({ error: 'recipients 必填' });
      return;
    }
    let mediaId = String(mediaIdRaw || '');
    const settings = await getSettings();
    const msgType = (msgtype === 'image' || msgtype === 'video') ? msgtype : 'file';
    const textContent = String(text || '').trim();
    // 仅文本模式：mediaId 为空则只推送文字（用于推送视频链接等纯文本内容）
    const pureText = !mediaId;
    if (pureText && !textContent) {
      res.status(400).json({ error: 'mediaId 与 text 至少提供一个' });
      return;
    }
    const accts = recipients.map(s => String(s || '').trim()).filter(Boolean);
    const results: any[] = [];

    if (pureText) {
      // 批量群发：将大量接收人合并为 touser 分批发送，秒级完成，避免单个循环超时
      const batch = await sendTextToMany(accts, textContent);
      for (const acct of accts) {
        const f = batch.failed.find((x: any) => x.user === acct);
        results.push(f ? { recipient: acct, ok: false, error: f.error } : { recipient: acct, ok: true });
        await writeMediaLog(acct, 'text', textContent);
      }
      res.json({ ok: true, total: results.length, success: batch.success, detail: results });
      return;
    }

    // 媒体消息：仍需逐个发送（图片/文件等，量通常不大）
    for (const acct of accts) {
      try {
        if (textContent) {
          const t = await sendTextToUser(acct, textContent);
          if (!t.ok) throw new Error(t.error);
        }
        await sendMediaMessage(settings, acct, msgType, mediaId);
        await writeMediaLog(acct, msgType, textContent);
        results.push({ recipient: acct, ok: true });
      } catch (e: any) {
        results.push({ recipient: acct, ok: false, error: e.message, errcode: e.errcode || 0 });
      }
    }
    const okCount = results.filter(r => r.ok).length;
    res.json({ ok: true, total: results.length, success: okCount, detail: results });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 记录媒体推送日志到 WechatPushLogsV2
async function writeMediaLog(account: string, name: string, text: string) {
  try {
    const pool = await getPool();
    await pool.request()
      .input('mod', sql.NVarChar, 'custom_notification')
      .input('sid', sql.Int, 0)
      .input('tbl', sql.NVarChar, '(无)')
      .input('title', sql.NVarChar, '媒体推送')
      .input('sup', sql.NVarChar, account)
      .input('dest', sql.NVarChar, '企微媒体推送')
      .input('rname', sql.NVarChar, account)
      .input('racct', sql.NVarChar, account)
      .input('msg', sql.NVarChar, `[${name}] ${text}`.trim())
      .input('status', sql.NVarChar, 'success')
      .input('err', sql.NVarChar, '')
      .input('retry', sql.Int, 0)
      .input('by', sql.NVarChar, 'media_push')
      .query(`INSERT INTO WechatPushLogsV2 (moduleCode, sourceId, sourceTable, sourceTitle, supervisor, destination, recipientName, recipientAccount, messageContent, status, errorDetail, retryCount, triggeredBy, triggeredAt)
              VALUES (@mod, @sid, @tbl, @title, @sup, @dest, @rname, @racct, @msg, @status, @err, @retry, @by, GETDATE())`);
  } catch { /* ignore */ }
}

// ---------- 状态 & 轮询 ----------
router.get('/status', async (_req, res) => {
  try {
    const settings = await getSettings();
    const poller = getPollerStatus();
    res.json({
      enabled: settings.enabled,
      pollingEnabled: settings.pollingEnabled,
      pollingInterval: settings.pollingInterval,
      apiConfigured: isApiConfigured(settings),
      poller,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/poller/trigger', async (_req, res) => {
  try {
    const result = await runOnce();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
