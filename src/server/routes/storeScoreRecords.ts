import { Router, Request, Response } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { JwtUserPayload } from '../services/jwt';
import { getStandardVisibleShopNames } from '../services/permissionService';
import { dispatchCustomNotification } from '../services/push/PushDispatcher';

const router = Router();

let ensured = false;
async function ensureTable(): Promise<void> {
  if (ensured) return;
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'StoreScoreRecords')
    CREATE TABLE StoreScoreRecords (
      id INT IDENTITY(1,1) PRIMARY KEY,
      shopName NVARCHAR(200),
      address NVARCHAR(200),
      supervisor NVARCHAR(100),
      staffCount NVARCHAR(50),
      evalMonth NVARCHAR(50),
      evaluator NVARCHAR(100),
      fullScore INT DEFAULT 0,
      totalScore INT DEFAULT 0,
      scoresJson NVARCHAR(MAX),
      rectificationJson NVARCHAR(MAX),
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE()
    )
  `);
  ensured = true;
}

// 按用户身份获取授权门店集合；未传组返回 null（不限制）
// v3：走标准组织隔离（sys_user_role → sys_org），GroupPermissions 已下线
async function scopeStoreSet(groupName?: string, user?: JwtUserPayload | null): Promise<Set<string> | null> {
  // 用户组列已删：groupName 恒 ''，改为基于 JWT 身份计算门店范围（null=全部可见，[]=无权限）
  if (user) {
    const pool = await getPool();
    const visible = await getStandardVisibleShopNames(pool, groupName, user);
    if (visible === null) return null; // 全部可见
    return new Set(visible);           // [] = 空集（无权限）
  }
  return null;
}

// 历史记录列表（仅头部与总分）
router.get('/', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const pool = await getPool();
    const groupName = typeof req.query.groupName === 'string' ? req.query.groupName : '';
    const allow = await scopeStoreSet(groupName, req.user || null);
    const r = await pool.request().query(`
      SELECT id, shopName, address, supervisor, staffCount, evalMonth, evaluator,
             totalScore, fullScore, createdAt, updatedAt
      FROM StoreScoreRecords
      ORDER BY createdAt DESC
    `);
    let rows: any[] = r.recordset || [];
    if (allow) rows = rows.filter((x: any) => allow.has(x.shopName));
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// 取店仓全店铺（含地址与各筛选维度），供打分页联动筛选与地址自动带出
// 需在 GET /:id 之前注册，避免被 /:id 匹配
router.get('/shops', async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const groupName = typeof req.query.groupName === 'string' ? req.query.groupName : '';
    const allow = await scopeStoreSet(groupName, req.user || null);
    const r = await pool.request().query(`
      SELECT DISTINCT 店铺名称 AS shopName, 店铺代码 AS shopCode,
             ISNULL(地址,'') AS address,
             ISNULL(仓库类别,'') AS warehouse,
             ISNULL(区域,'') AS area,
             ISNULL(区经,'') AS districtManager,
             ISNULL(经销商,'') AS dealer,
             ISNULL(督导,'') AS supervisor
      FROM 店仓全
      WHERE 仓库类别 IN ('直营','山东直营','加盟') AND ISNULL(店铺名称,'') <> ''
      ORDER BY 店铺名称
    `);
    let rows: any[] = r.recordset || [];
    if (allow) rows = rows.filter((x: any) => allow.has(x.shopName));
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// 单条完整记录（含评分 JSON）
router.get('/:id', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const pool = await getPool();
    const allow = await scopeStoreSet(typeof req.query.groupName === 'string' ? req.query.groupName : '', req.user || null);
    const r = await pool.request()
      .input('id', sql.Int, Number(req.params.id))
      .query('SELECT * FROM StoreScoreRecords WHERE id = @id');
    if (!r.recordset || r.recordset.length === 0) {
      res.status(404).json({ message: '记录不存在' }); return;
    }
    const row = r.recordset[0];
    if (allow && !allow.has(row.shopName)) { res.status(403).json({ message: '无权查看该门店记录' }); return; }
    let scores: Record<string, number> = {};
    try { scores = JSON.parse(row.scoresJson || '{}'); } catch { /* ignore */ }
    res.json({ ...row, scores });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 新增记录
router.post('/', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const pool = await getPool();
    const {
      shopName = '', address = '', supervisor = '', staffCount = '',
      evalMonth = '', evaluator = '', fullScore = 0, totalScore = 0, scores = {},
      rectification = null,
    } = req.body;
    const scoresJson = JSON.stringify(scores || {});
    const rectJson = rectification ? JSON.stringify(rectification) : null;
    const param = pool.request()
      .input('shopName', sql.NVarChar, String(shopName))
      .input('address', sql.NVarChar, String(address))
      .input('supervisor', sql.NVarChar, String(supervisor))
      .input('staffCount', sql.NVarChar, String(staffCount))
      .input('evalMonth', sql.NVarChar, String(evalMonth))
      .input('evaluator', sql.NVarChar, String(evaluator))
      .input('fullScore', sql.Int, Number(fullScore))
      .input('totalScore', sql.Int, Number(totalScore))
      .input('scoresJson', sql.NVarChar(sql.MAX), scoresJson)
      .input('rectificationJson', sql.NVarChar(sql.MAX), rectJson);
    const r = await param.query(`
      INSERT INTO StoreScoreRecords
        (shopName, address, supervisor, staffCount, evalMonth, evaluator,
         fullScore, totalScore, scoresJson, rectificationJson)
      VALUES
        (@shopName, @address, @supervisor, @staffCount, @evalMonth, @evaluator,
         @fullScore, @totalScore, @scoresJson, @rectificationJson);
      SELECT SCOPE_IDENTITY() AS id;
    `);
    const id = r.recordset?.[0]?.id;
    res.status(201).json({ id });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 更新记录（回改历史条）
router.put('/:id', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const pool = await getPool();
    const id = Number(req.params.id);
    const {
      shopName, address, supervisor, staffCount, evalMonth,
      evaluator, fullScore, totalScore, scores, rectification,
    } = req.body;
    const scoresJson = JSON.stringify(scores || {});
    const rectJson = rectification ? JSON.stringify(rectification) : null;
    const reqSql = pool.request()
      .input('id', sql.Int, id)
      .input('shopName', sql.NVarChar, String(shopName))
      .input('address', sql.NVarChar, String(address))
      .input('supervisor', sql.NVarChar, String(supervisor))
      .input('staffCount', sql.NVarChar, String(staffCount))
      .input('evalMonth', sql.NVarChar, String(evalMonth))
      .input('evaluator', sql.NVarChar, String(evaluator))
      .input('fullScore', sql.Int, Number(fullScore))
      .input('totalScore', sql.Int, Number(totalScore))
      .input('scoresJson', sql.NVarChar(sql.MAX), scoresJson)
      .input('rectificationJson', sql.NVarChar(sql.MAX), rectJson);
    await reqSql.query(`
      UPDATE StoreScoreRecords SET
        shopName = @shopName, address = @address, supervisor = @supervisor,
        staffCount = @staffCount, evalMonth = @evalMonth, evaluator = @evaluator,
        fullScore = @fullScore, totalScore = @totalScore,
        scoresJson = @scoresJson, rectificationJson = @rectificationJson,
        updatedAt = GETDATE()
      WHERE id = @id
    `);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 删除记录
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, Number(req.params.id))
      .query('DELETE FROM StoreScoreRecords WHERE id = @id');
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 企微推送整改报告（复用企微自定义通知）
router.post('/push', async (req: Request, res: Response) => {
  try {
    const { message, recipients } = req.body;
    if (!message) { res.status(400).json({ message: '推送内容不能为空' }); return; }
    const recipientOverride = Array.isArray(recipients)
      ? recipients.filter((r: any) => r && r.wechatAccount).map((r: any) => ({ name: r.name, wechatAccount: r.wechatAccount }))
      : [];
    const r = await dispatchCustomNotification(String(message), 'manual', {
      recipientOverride,
      templateTitle: '店铺优化评估整改报告',
    });
    res.json({ ok: true, summary: r.summary, detail: r.detail });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

export default router;