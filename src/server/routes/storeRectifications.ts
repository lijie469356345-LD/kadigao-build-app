import { Router, Request, Response } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { JwtUserPayload } from '../services/jwt';
import { getStandardVisibleShopNames } from '../services/permissionService';
import { buildRectification } from '../../utils/scoreForm';

const router = Router();
let ensured = false;

async function ensureTable(): Promise<void> {
  if (ensured) return;
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'StoreRectificationItems')
    CREATE TABLE StoreRectificationItems (
      id INT IDENTITY(1,1) PRIMARY KEY,
      recordId INT NOT NULL,
      shopName NVARCHAR(200),
      evalMonth NVARCHAR(50),
      project NVARCHAR(100),
      section NVARCHAR(100),
      content NVARCHAR(1000),
      gap INT DEFAULT 0,
      status NVARCHAR(20) DEFAULT '待整改',
      remark NVARCHAR(500),
      updatedBy NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE()
    )
  `);
  ensured = true;
}

// 从打分记录计算扣分项，并与整改表做同步（新增缺失、清理已消除的未完成项）
async function syncRectifications(): Promise<void> {
  const pool = await getPool();
  const recs = await pool.request().query(`SELECT id, shopName, evalMonth, scoresJson FROM StoreScoreRecords`);
  const items = await pool.request().query(`SELECT * FROM StoreRectificationItems`);

  const existingByRecord = new Map<number, any[]>();
  for (const it of items.recordset || []) {
    const k = Number(it.recordId);
    if (!existingByRecord.has(k)) existingByRecord.set(k, []);
    existingByRecord.get(k)!.push(it);
  }

  const toInsert: any[] = [];
  const toDelete: number[] = [];
  const isEmptyKey = (project: string, section: string, content: string) => `${project}||${section}||${content}`;

  for (const row of recs.recordset || []) {
    let scores: Record<string, number> = {};
    try { scores = JSON.parse(row.scoresJson || '{}'); } catch { /* ignore */ }
    const blocks = buildRectification(scores).blocks; // score < full 的项

    const existing = existingByRecord.get(Number(row.id)) || [];
    const existingKey = new Set(existing.map((it) => isEmptyKey(it.project, it.section, it.content)));
    const wantKeys = new Set(blocks.map((b) => isEmptyKey(b.project, b.section, b.content)));

    // 对已存在但已消除扣分、且未完成 的项：删除（完成已解除的保留）
    for (const it of existing) {
      if (it.status !== '已完成' && !wantKeys.has(isEmptyKey(it.project, it.section, it.content))) {
        toDelete.push(Number(it.id));
      }
    }
    // 新增缺失的扣分项
    for (const b of blocks) {
      if (!existingKey.has(isEmptyKey(b.project, b.section, b.content))) {
        toInsert.push({
          recordId: Number(row.id), shopName: row.shopName, evalMonth: row.evalMonth,
          project: b.project, section: b.section, content: b.content, gap: b.gap,
          status: '待整改',
        });
      }
    }
  }

  for (const id of toDelete) {
    await pool.request().input('id', sql.Int, id).query('DELETE FROM StoreRectificationItems WHERE id = @id');
  }
  for (const r of toInsert) {
    await pool.request()
      .input('recordId', sql.Int, r.recordId)
      .input('shopName', sql.NVarChar, r.shopName)
      .input('evalMonth', sql.NVarChar, r.evalMonth)
      .input('project', sql.NVarChar, r.project)
      .input('section', sql.NVarChar, r.section)
      .input('content', sql.NVarChar, r.content)
      .input('gap', sql.Int, r.gap)
      .input('status', sql.NVarChar, r.status)
      .query(`INSERT INTO StoreRectificationItems
        (recordId, shopName, evalMonth, project, section, content, gap, status)
        VALUES (@recordId, @shopName, @evalMonth, @project, @section, @content, @gap, @status)`);
  }
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

router.get('/', async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    await ensureTable();
    await syncRectifications();
    const groupName = typeof req.query.groupName === 'string' ? req.query.groupName : '';
    const allow = await scopeStoreSet(groupName, req.user || null);
    const r = await pool.request().query(`
      SELECT id, recordId, shopName, evalMonth, project, section, content, gap,
             status, remark, updatedAt
      FROM StoreRectificationItems
      ORDER BY CASE status WHEN '待整改' THEN 0 WHEN '整改中' THEN 1 ELSE 2 END, updatedAt DESC
    `);
    let items: any[] = r.recordset || [];
    if (allow) items = items.filter((x: any) => allow.has(x.shopName));
    const count = (s: string) => items.filter((x) => x.status === s).length;
    const pending = count('待整改');
    const inProgress = count('整改中');
    const done = count('已完成');
    const shops = new Set(items.filter((x) => x.status !== '已完成').map((x) => x.shopName));
    const effectiveTotal = pending + inProgress + done;
    let records: any[] = (await pool.request().query(`
      SELECT r.id, r.shopName, r.evalMonth, r.totalScore, r.fullScore,
             r.createdAt,
             COUNT(i.id) AS deductCount,
             COALESCE(SUM(i.gap), 0) AS deductTotal,
             SUM(CASE WHEN i.status = '已完成' THEN 1 ELSE 0 END) AS doneCount
      FROM StoreRectificationItems i
      JOIN StoreScoreRecords r ON r.id = i.recordId
      GROUP BY r.id, r.shopName, r.evalMonth, r.totalScore, r.fullScore, r.createdAt
      ORDER BY r.createdAt DESC
    `)).recordset;
    if (allow) records = records.filter((x: any) => allow.has(x.shopName));
    res.json({
      summary: {
        total: effectiveTotal,
        pending,
        inProgress,
        done,
        openShops: shops.size,
        completionRate: effectiveTotal ? Math.round((done / effectiveTotal) * 100) : 100,
      },
      records,
      items,
    });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 更新单条整改项状态/备注
router.put('/:id', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const pool = await getPool();
    const id = Number(req.params.id);
    const { status, remark } = req.body;
    const upd: string[] = ['updatedAt = GETDATE()'];
    const input = pool.request();
    input.input('id', sql.Int, id);
    if (typeof status === 'string') { upd.push('status = @status'); input.input('status', sql.NVarChar, status); }
    if (typeof remark === 'string') { upd.push('remark = @remark'); input.input('remark', sql.NVarChar, remark); }
    await input.query(`UPDATE StoreRectificationItems SET ${upd.join(', ')} WHERE id = @id`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 批量：按打分记录id批量标记状态（用于“一齐完成”）
router.post('/bulk', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const pool = await getPool();
    const { recordIds, status } = req.body;
    if (!Array.isArray(recordIds) || recordIds.length === 0) {
      res.status(400).json({ message: 'recordIds 必须为数组' }); return;
    }
    const st = String(status || '已完成');
    // 转换参数化，用参数占位生成 IN 列表
    const params = pool.request();
    params.input('status', sql.NVarChar, st);
    const inList = recordIds.map((_, i) => `@id${i}`).join(',');
    recordIds.forEach((id, i) => params.input(`id${i}`, sql.Int, Number(id)));
    await params.query(`
      UPDATE StoreRectificationItems SET status = @status
      WHERE recordId IN (${inList})
    `);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const pool = await getPool();
    await pool.request().input('id', sql.Int, Number(req.params.id))
      .query(`DELETE FROM StoreRectificationItems WHERE id = @id`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

export default router;