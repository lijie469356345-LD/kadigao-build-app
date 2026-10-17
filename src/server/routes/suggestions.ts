import { Router, Request, Response } from 'express';
import sql from 'mssql';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { getPool } from '../../config/db';
import { getStandardVisibleShopNames } from '../services/permissionService';
import { dispatchCustomNotification } from '../services/push/PushDispatcher';

const router = Router();
let ensured = false;
const LEVELS = ['督导', '区经', '总监', '老板'];
const BOSS_NAMES = ['伊登泽', '刘姿君'];

async function ensureTable(): Promise<void> {
  if (ensured) return;
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ShopSuggestions')
    CREATE TABLE ShopSuggestions (
      id INT IDENTITY(1,1) PRIMARY KEY,
      code NVARCHAR(50) NOT NULL,
      title NVARCHAR(300),
      category NVARCHAR(50),
      urgent INT DEFAULT 0,
      content NVARCHAR(MAX),
      images NVARCHAR(MAX),
      mode NVARCHAR(20) DEFAULT '普通',
      privacy NVARCHAR(20) DEFAULT '实名',
      shopName NVARCHAR(200),
      reporterId NVARCHAR(100),
      reporterName NVARCHAR(100),
      currentLevel INT DEFAULT 1,
      currentLevelName NVARCHAR(50) DEFAULT '督导',
      status NVARCHAR(20) DEFAULT '待处理',
      supplementReq NVARCHAR(2000),
      supplementText NVARCHAR(MAX),
      supplementImages NVARCHAR(MAX),
      rejectReason NVARCHAR(2000),
      escalateReason NVARCHAR(2000),
      createdBy NVARCHAR(200),
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE()
    )
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SuggestionReplies')
    CREATE TABLE SuggestionReplies (
      id INT IDENTITY(1,1) PRIMARY KEY,
      suggestionId INT NOT NULL,
      senderId NVARCHAR(100),
      senderName NVARCHAR(200),
      role NVARCHAR(50),
      senderType NVARCHAR(20) DEFAULT 'submit',
      replyType NVARCHAR(20) DEFAULT 'reply',
      text NVARCHAR(MAX),
      images NVARCHAR(MAX),
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);
  ensured = true;
  try { await pool.request().query(`IF COL_LENGTH('ShopSuggestions','escalateSource') IS NULL ALTER TABLE ShopSuggestions ADD escalateSource NVARCHAR(20)`); } catch (_e) {}
  try { await pool.request().query(`IF COL_LENGTH('ShopSuggestions','escalateLog') IS NULL ALTER TABLE ShopSuggestions ADD escalateLog NVARCHAR(MAX)`); } catch (_e) {}
  ensured = true;
}

const upload = multer({
  storage: multer.diskStorage({
    destination(_req: any, _file: any, cb: any) {
      const dir = path.resolve(process.cwd(), 'uploads');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req: any, file: any, cb: any) {
      const ext = path.extname(file.originalname) || '.png';
      cb(null, 'sug_' + Date.now() + '_' + Math.round(Math.random() * 1e6) + ext);
    },
  }),
});

// 多图上传
router.post('/upload', upload.array('files', 9), (req: Request, res: Response) => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    res.json({ urls: files.map((f) => '/uploads/' + f.filename) });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

function newCode(): string {
  const d = new Date();
  return `SG${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

// 按人名自动解析其管辖门店（督导→督导店；联系人→其门店），界面不展示门店选择
async function resolveShopName(name: string): Promise<string> {
  if (!name) return '';
  try {
    const pool = await getPool();
    const r = await pool.request().input('n', sql.NVarChar, name).query(`SELECT TOP 1 店铺名称 shopName FROM 店仓全 WHERE (ISNULL(督导,'')=@n OR ISNULL(联系人,'')=@n) AND ISNULL(店铺名称,'')<>''`);
    return r.recordset?.[0]?.shopName || '';
  } catch (_e) { return ''; }
}

// 提交新工单
router.post('/submit', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const pool = await getPool();
    const {
      title = '', category = '其他', urgent = 0, content = '', images = '',
      mode = '普通', identity = '实名', shopName = '', reporterId = '', reporterName = '',
    } = req.body;
    const startLevel = mode === '私密' ? 3 : 1; // 普通=督导，私密=总监
    // 所属门店：界面不选择，系统自动默认管辖门店（督导按督导店），不显示
    let effShopName = String(shopName || '').trim();
    if (!effShopName) effShopName = await resolveShopName(String(reporterName || ''));
    const code = newCode();
    await pool.request()
      .input('code', sql.NVarChar, code)
      .input('title', sql.NVarChar, String(title || ''))
      .input('category', sql.NVarChar, String(category))
      .input('urgent', sql.Int, Number(urgent) ? 1 : 0)
      .input('content', sql.NVarChar(sql.MAX), String(content))
      .input('images', sql.NVarChar(sql.MAX), String(images || ''))
      .input('mode', sql.NVarChar, String(mode))
      .input('privacy', sql.NVarChar, String(identity))
      .input('shopName', sql.NVarChar, effShopName)
      .input('reporterId', sql.NVarChar, String(reporterId || ''))
      .input('reporterName', sql.NVarChar, String(reporterName || ''))
      .input('level', sql.Int, startLevel)
      .input('levelName', sql.NVarChar, LEVELS[startLevel - 1])
      .input('status', sql.NVarChar, '待处理')
      .query(`INSERT INTO ShopSuggestions
        (code, title, category, urgent, content, images, mode, privacy, shopName, reporterId, reporterName, currentLevel, currentLevelName, status, createdAt, updatedAt)
        VALUES (@code, @title, @category, @urgent, @content, @images, @mode, @privacy, @shopName, @reporterId, @reporterName, @level, @levelName, @status, GETDATE(), GETDATE());
        SELECT SCOPE_IDENTITY() AS id`);
    res.status(201).json({ code });
    pushSug(`【店铺建议·新工单】${code}`, `新工单：${String(title)}｜${effShopName || '待归属'}｜${mode}｜${urgent ? '紧急' : '普通'}，开始处理：${LEVELS[startLevel - 1]}`, { shopName: effShopName, reporterName }).catch(() => {});
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 按登录人姓名自动识别层级（督导/区经；用于列表默认可见层级）
router.get('/whoami', async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const n = String(req.query.name || '');
    if (!n) { res.json({ level: 0 }); return; }
    if (BOSS_NAMES.includes(n)) { res.json({ level: 4 }); return; }
    const r = await pool.request().input('n', sql.NVarChar, n).query(`
      SELECT CASE
        WHEN EXISTS(SELECT 1 FROM 店仓全 WHERE ISNULL(督导,'')=@n AND ISNULL(督导,'')<>'') THEN 1
        WHEN EXISTS(SELECT 1 FROM 店仓全 WHERE ISNULL(区经,'')=@n AND ISNULL(区经,'')<>'') THEN 2
        ELSE 0 END AS lvl`);
    res.json({ level: Number(r.recordset?.[0]?.lvl) || 0 });
  } catch (_e) { res.json({ level: 0 }); }
});

// 工单列表（支持状态/我的筛选）
router.get('/', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    await autoUpgrade();
    const pool = await getPool();
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const mine = typeof req.query.reporterId === 'string' ? req.query.reporterId : '';
    const role = typeof req.query.role === 'string' ? Number(req.query.role) : 0;
    const viewerName = typeof req.query.viewerName === 'string' ? req.query.viewerName : '';
    const viewerId = typeof req.query.viewerId === 'string' ? req.query.viewerId : '';
    const groupName = typeof req.query.groupName === 'string' ? req.query.groupName : '';
    const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : '';
    let where = ' 1=1 ';
    const p = pool.request();
    if (status) { where += ' AND status = @s'; p.input('s', sql.NVarChar, status); }
    if (keyword) {
      where += ` AND (code LIKE @kw OR title LIKE @kw OR shopName LIKE @kw OR reporterName LIKE @kw
        OR shopName IN (SELECT 店铺名称 FROM 店仓全 WHERE ISNULL(督导,'') LIKE @kw OR ISNULL(区经,'') LIKE @kw))`;
      p.input('kw', sql.NVarChar, `%${keyword}%`);
    }
    if (mine) { where += ' AND reporterId = @r'; p.input('r', sql.NVarChar, mine); }
    else if (role) {
      // 可看到：自己的工单（创建者始终可见）OR 达到当前层级；层级范围按“用户组授权门店”中转（用组）
      let cond = '( currentLevel >= @lv';
      p.input('lv', sql.Int, role);
      if (role === 1 || role === 2) {
        if (groupName) {
          // v3：标准组织隔离返回可见店铺；null=全部；[]=无权限
          const visible = await getStandardVisibleShopNames(pool, groupName, req.user || null);
          if (visible === null) {
            // 全部可见：不追加店铺过滤
          } else if (visible.length === 0) {
            cond += ' AND 1=0';
          } else {
            const list = visible.map(s => `'${String(s).replace(/'/g, "''")}'`).join(', ');
            cond += ` AND shopName IN (${list})`;
          }
        }
        else if (role === 1) { cond += ' AND shopName IN (SELECT 店铺名称 FROM 店仓全 WHERE 督导 = @vn)'; p.input('vn', sql.NVarChar, viewerName); }
        else if (role === 2) { cond += ' AND shopName IN (SELECT 店铺名称 FROM 店仓全 WHERE 区经 = @vn)'; p.input('vn', sql.NVarChar, viewerName); }
      }
      cond += ' )';
      if (viewerId) { cond += ' OR reporterId = @vid'; p.input('vid', sql.NVarChar, viewerId); }
      where += ' AND (' + cond + ')';
    }
    const rSet = await p.query(`SELECT * FROM ShopSuggestions WHERE ${where} ORDER BY createdAt DESC`);
    res.json((rSet.recordset || []).map(maskRow));
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 超时自动升级：待处理超时（紧急24h / 普通72h）未处理则升到上级（并记录为"超时"来源）
async function autoUpgrade(): Promise<void> {
  try {
    const pool = await getPool();
    const rows = (await pool.request().query(`SELECT id, code, shopName, reporterName, urgent, currentLevel, title, createdAt, escalateLog FROM ShopSuggestions WHERE status = '待处理'`)).recordset || [];
    for (const r of rows) {
      const d = new Date(r.createdAt);
      if (!d.getTime()) continue;
      const hours = (Date.now() - d.getTime()) / 3600000;
      const urgent = Number(r.urgent) === 1;
      const level = Number(r.currentLevel);
      const lim = urgent ? 24 : 72;
      if (hours >= lim && level < 4) {
        const target = urgent ? 4 : Math.min(4, level + 1);
        await pool.request()
          .input('id', sql.Int, r.id).input('level', sql.Int, target)
          .input('levelName', sql.NVarChar, LEVELS[target - 1])
          .input('src', sql.NVarChar, '超时').input('reason', sql.NVarChar, `超过${Math.round(hours)}小时未处理，自动升级`)
          .input('elog', sql.NVarChar(sql.MAX), (() => { try { const arr = JSON.parse(r.escalateLog || '[]'); arr.push({ from: level, to: target, by: '系统(超时)', source: '超时', reason: `超过${Math.round(hours)}小时未处理，自动升级`, time: new Date().toLocaleString('zh-CN') }); return JSON.stringify(arr); } catch (_e) { return r.escalateLog || '[]'; } })())
          .query('UPDATE ShopSuggestions SET currentLevel=@level, currentLevelName=@levelName, escalateSource=@src, escalateReason=@reason, escalateLog=@elog, updatedAt=GETDATE() WHERE id=@id');
        await pushSug(`【店铺建议·超时自动升级】工单 ${r.code}（${r.title}）`, `超时${Math.round(hours)}小时未处理，已升级至${LEVELS[target - 1]}。店铺：${r.shopName}`, r);
      }
    }
    // 老板层待处理超过 3 天未确认 → 自动确认（办结）
    const bossRows = (await pool.request().query(`SELECT id, code, shopName, title, updatedAt FROM ShopSuggestions WHERE status = '待处理' AND currentLevel = 4`)).recordset || [];
    for (const b of bossRows) {
      const t = new Date(b.updatedAt);
      if (!t.getTime()) continue;
      if ((Date.now() - t.getTime()) >= 3 * 24 * 3600 * 1000) {
        await pool.request().input('id', sql.Int, b.id)
          .query(`UPDATE ShopSuggestions SET status = N'已办结', updatedAt = GETDATE() WHERE id = @id`);
        await pushSug(`【店铺建议·老板超时自动办结】工单 ${b.code}`, `老板 3 天未确认，系统已自动办结。门店：${b.shopName}`, b).catch(() => {});
      }
    }
  } catch (_e) { /* best effort */ }
}

// —— 企业微信提醒（尽力而为） ——
async function pushSug(title: string, message: string, sug: any): Promise<void> {
  try {
    const accounts = await resolveSuggestAccounts(sug.shopName || '', String(sug.reporterName || ''));
    if (!accounts.length) return;
    await dispatchCustomNotification(message, 'auto', { templateTitle: title, recipientOverride: accounts.map((a) => ({ name: '', wechatAccount: a })) });
  } catch (_e) { /* 推送尽力而为 */ }
}
async function resolveShopAccounts(shopName: string): Promise<string[]> {
  const pool = await getPool();
  const r = await pool.request().input('sn', sql.NVarChar, shopName).query(`
    SELECT DISTINCT 企微账号 wc FROM 用户全
    WHERE ISNULL(企微账号,'')<>'' AND 用户名称 IN (
      SELECT 督导 FROM 店仓全 WHERE 店铺名称=@sn
      UNION SELECT 区经 FROM 店仓全 WHERE 店铺名称=@sn
      UNION SELECT 经销商 FROM 店仓全 WHERE 店铺名称=@sn
      UNION SELECT 联系人 FROM 店仓全 WHERE 店铺名称=@sn
    )`);
  return Array.from(new Set((r.recordset || []).map((x: any) => x.wc).filter(Boolean)));
}
async function resolveUserAccount(name: string): Promise<string[]> {
  if (!String(name || '').trim() || name === '匿名') return [];
  const pool = await getPool();
  const r = await pool.request().input('n', sql.NVarChar, String(name)).query(`SELECT DISTINCT ISNULL(企微账号,'') wc FROM 用户全 WHERE 用户名称=@n AND ISNULL(企微账号,'')<>''`);
  return Array.from(new Set((r.recordset || []).map((x: any) => x.wc).filter(Boolean)));
}
async function resolveSuggestAccounts(shopName: string, reporterName: string): Promise<string[]> {
  const a = await resolveShopAccounts(shopName);
  const b = await resolveUserAccount(reporterName);
  return Array.from(new Set([...a, ...b]));
}

// 详情 + 留言
router.get('/:id', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    await autoUpgrade();
    const pool = await getPool();
    const id = Number(req.params.id);
    const s = await pool.request().input('id', sql.Int, id)
      .query('SELECT * FROM ShopSuggestions WHERE id = @id');
    if (!s.recordset || s.recordset.length === 0) { res.status(404).json({ message: '工单不存在' }); return; }
    const replies = await pool.request().input('id', sql.Int, id)
      .query('SELECT * FROM SuggestionReplies WHERE suggestionId = @id ORDER BY createdAt');
    res.json({ ...maskRow(s.recordset[0]), replies: replies.recordset || [] });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 留言（仅留言，不改工单状态）
router.post('/:id/reply', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const pool = await getPool();
    const id = Number(req.params.id);
    const { text = '', images = '', senderId = '', senderName = '', senderType = 'handler' } = req.body;
    const cur = await pool.request().input('id', sql.Int, id).query('SELECT * FROM ShopSuggestions WHERE id = @id');
    if (!cur.recordset || cur.recordset.length === 0) { res.status(404).json({ message: '工单不存在' }); return; }
    const rId = await pool.request()
      .input('sid', sql.Int, id)
      .input('senderId', sql.NVarChar, String(senderId || ''))
      .input('senderName', sql.NVarChar, String(senderName || ''))
      .input('senderType', sql.NVarChar, senderType === 'submit' ? 'submit' : 'handler')
      .input('text', sql.NVarChar(sql.MAX), String(text))
      .input('images', sql.NVarChar(sql.MAX), String(images || ''))
      .query(`INSERT INTO SuggestionReplies (suggestionId, senderId, senderName, senderType, replyType, text, images, createdAt)
              VALUES (@sid, @senderId, @senderName, @senderType, N'留言', @text, @images, GETDATE()); SELECT SCOPE_IDENTITY() AS id`);
    res.json({ ok: true, id: rId.recordset[0]?.id });
    pushSug(`【店铺建议·新留言】工单 ${cur.recordset[0].code}`, `有新留言：${text || '(图片)'}`, cur.recordset[0]).catch(() => {});
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 工单操作（独立，不写留言）：待补充材料 / 已办结 / 驳回 / 升级上一级
router.post('/:id/action', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const pool = await getPool();
    const id = Number(req.params.id);
    const { action, text = '', images = '', senderName = '' } = req.body;
    const cur = await pool.request().input('id', sql.Int, id).query('SELECT * FROM ShopSuggestions WHERE id = @id');
    if (!cur.recordset || cur.recordset.length === 0) { res.status(404).json({ message: '工单不存在' }); return; }
    const row = cur.recordset[0];
    if (row.status === '已办结' || row.status === '驳回') { res.status(400).json({ message: '该工单已终态，不能重复操作' }); return; }

    let status = row.status;
    let level = Number(row.currentLevel);
    let source: string | null = row.escalateSource;
    let supplementReq: string | null = row.supplementReq;
    let rejectReason: string | null = row.rejectReason;
    let escalateReason: string | null = row.escalateReason;
    let escalateLog: any[] = [];
    try { escalateLog = JSON.parse(row.escalateLog || '[]'); } catch (_e) {}
    const prevLevel = level;
    let didEscalate = false;

    if (action === '待补充材料' || action === '补充材料') { status = '待补充材料'; supplementReq = text && images ? text + '|' + images : (text || ''); }
    else if (action === '已办结') { status = '已办结'; }
    else if (action === '驳回') {
      if (!String(text || '').trim()) { res.status(400).json({ message: '驳回必须填写理由' }); return; }
      status = '驳回'; rejectReason = String(text);
    } else if (action === '升级') {
      if (level < LEVELS.length) {
        let tl = level + 1;
        // 若非强建督导=区经为同一人时，督导升到区经后仍是同一个人处理，则直接继续升一层
        if (tl === 2) {
          try {
            const o = await pool.request().input('sn', sql.NVarChar, String(row.shopName || '')).query('SELECT TOP 1 ISNULL(督导,\'*\') 督导, ISNULL(区经,\'#\') 区经 FROM 店仓全 WHERE 店铺名称=@sn');
            const rr = o.recordset && o.recordset[0];
            if (rr && rr['督导'] !== '*' && rr['督导'] === rr['区经']) { tl = Math.min(4, tl + 1); }
          } catch (_e) { /* ignore */ }
        }
        if (tl > level && tl <= LEVELS.length) { level = tl; status = '待处理'; didEscalate = true; escalateReason = String(text || (level > 2 ? '督导与区经为同一人，已直接跳升至上层' : '')); source = '升级'; }
        else if (level >= LEVELS.length) { /* 一到底，不能再升 */ }
        else { status = '待处理'; didEscalate = true; escalateReason = String(text || ''); source = '升级'; }
      }
    } else { res.status(400).json({ message: '未知操作' }); return; }

    // 升级留痕：谁、何时、什么原因（不覆盖历史）
    if (didEscalate) {
      escalateLog.push({ from: prevLevel, to: level, by: String(senderName || '').trim() || '处理人', source: '升级', reason: String(text || ''), time: new Date().toLocaleString('zh-CN') });
    }

    await pool.request()
      .input('id', sql.Int, id)
      .input('status', sql.NVarChar, status)
      .input('level', sql.Int, level)
      .input('levelName', sql.NVarChar, LEVELS[level - 1])
      .input('src', sql.NVarChar, source)
      .input('elog', sql.NVarChar(sql.MAX), JSON.stringify(escalateLog))
      .input('supplementReq', sql.NVarChar(sql.MAX), supplementReq)
      .input('rejectReason', sql.NVarChar(sql.MAX), rejectReason)
      .input('escalateReason', sql.NVarChar(sql.MAX), escalateReason)
      .query('UPDATE ShopSuggestions SET status=@status, currentLevel=@level, currentLevelName=@levelName, escalateSource=@src, escalateLog=@elog, supplementReq=@supplementReq, rejectReason=@rejectReason, escalateReason=@escalateReason, updatedAt=GETDATE() WHERE id=@id');
    res.json({ ok: true, status, level });
    pushSug(`【店铺建议·${status}】工单 ${row.code}`, `${action === '升级' ? '已升级至' + LEVELS[level - 1] + (escalateReason ? '，说明：' + escalateReason : '') : ''}${text ? '·' + text : ''}｜门店：${row.shopName}`, row).catch(() => {});
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 提交人补充材料（文本 + 图片）
router.post('/:id/supplement', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const pool = await getPool();
    const id = Number(req.params.id);
    const { text = '', images = '' } = req.body;
    const cur = await pool.request().input('id', sql.Int, id).query('SELECT * FROM ShopSuggestions WHERE id = @id');
    if (!cur.recordset || cur.recordset.length === 0) { res.status(404).json({ message: '工单不存在' }); return; }
    const row = cur.recordset[0];
    if (row.status === '已办结' || row.status === '驳回') { res.status(400).json({ message: '该工单已终态，不能补充' }); return; }
    const oldText = row.supplementText || '';
    const oldImgs = row.supplementImages || '';
    await pool.request()
      .input('id', sql.Int, id)
      .input('supplementText', sql.NVarChar(sql.MAX), oldText + (oldText ? '\n' : '') + String(text))
      .input('supplementImages', sql.NVarChar(sql.MAX), oldImgs ? oldImgs + ',' + String(images) : String(images))
      .input('status', sql.NVarChar, '待处理')   // 补充后回到待处理
      .query('UPDATE ShopSuggestions SET supplementText=@supplementText, supplementImages=@supplementImages, status=@status, updatedAt=GETDATE() WHERE id=@id');
    res.json({ ok: true });
    pushSug(`【店铺建议·已补充材料】工单 ${row.code}`, `提交人已补充材料：${String(text || '(图片)')}`, row).catch(() => {});
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 匿名脱敏
function maskRow(row: any): any {
  const r = { ...row };
  if (r.privacy === '匿名') { r.reporterName = '匿名'; r.reporterId = ''; }
  if (r.createdAt) r.createdAt = new Date(r.createdAt).toLocaleString('zh-CN');
  if (r.updatedAt) r.updatedAt = new Date(r.updatedAt).toLocaleString('zh-CN');
  return r;
}

// 超时自动升级定时器（每 60 秒扫描一次）
setInterval(() => { autoUpgrade().catch(() => {}); }, 60000);

export { autoUpgrade };
export default router;