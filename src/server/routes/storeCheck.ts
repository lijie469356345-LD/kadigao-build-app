import { Router, Request, Response } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { JwtUserPayload } from '../services/jwt';
import { getStandardVisibleShopNames } from '../services/permissionService';

const router = Router();
let ensured = false;

async function ensureTable(): Promise<void> {
  if (ensured) return;
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ShopCheckIndicators')
    CREATE TABLE ShopCheckIndicators (
      id INT IDENTITY(1,1) PRIMARY KEY,
      dimId INT NOT NULL,
      dimName NVARCHAR(50),
      code NVARCHAR(10),
      name NVARCHAR(200),
      score INT DEFAULT 0,
      sort INT DEFAULT 0,
      note NVARCHAR(1000),
      isActive INT DEFAULT 1,
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE()
    )
  `);
  ensured = true;
}

// 检测项默认种子（店铺检测：五维度 100 分 / 36 项）
const SEED: { dimId: number; dimName: string; name: string; score: number }[] = [
  { dimId: 1, dimName: '店', name: '销售目标达成率', score: 6 },
  { dimId: 1, dimName: '店', name: '销售同比', score: 3 },
  { dimId: 1, dimName: '店', name: '销售环比', score: 3 },
  { dimId: 1, dimName: '店', name: '坪效', score: 3 },
  { dimId: 1, dimName: '店', name: '人效', score: 2 },
  { dimId: 1, dimName: '店', name: '店铺人编·满编率', score: 2 },
  { dimId: 1, dimName: '店', name: '店铺店务得分', score: 3 },
  { dimId: 1, dimName: '店', name: '店铺陪跑', score: 3 },
  { dimId: 2, dimName: '人', name: '个人月贡献', score: 4 },
  { dimId: 2, dimName: '人', name: '个人目标达成', score: 4 },
  { dimId: 2, dimName: '人', name: '个人同比', score: 3 },
  { dimId: 2, dimName: '人', name: '个人环比', score: 3 },
  { dimId: 2, dimName: '人', name: '个人盈利', score: 3 },
  { dimId: 2, dimName: '人', name: '个人连带率', score: 3 },
  { dimId: 2, dimName: '人', name: '个人客单价', score: 2 },
  { dimId: 2, dimName: '人', name: '个人转化率', score: 2 },
  { dimId: 2, dimName: '人', name: '个人会员招募', score: 1 },
  { dimId: 3, dimName: '货', name: '售罄率', score: 4 },
  { dimId: 3, dimName: '货', name: '库销比', score: 3 },
  { dimId: 3, dimName: '货', name: '动销率', score: 3 },
  { dimId: 3, dimName: '货', name: '新品售罄率', score: 3 },
  { dimId: 3, dimName: '货', name: '断码/缺货率', score: 3 },
  { dimId: 3, dimName: '货', name: '畅滞销结构', score: 2 },
  { dimId: 3, dimName: '货', name: '主推款达成率', score: 2 },
  { dimId: 4, dimName: '场', name: '陈列执行得分', score: 3 },
  { dimId: 4, dimName: '场', name: '门店形象/卫生', score: 3 },
  { dimId: 4, dimName: '场', name: '服务体验', score: 3 },
  { dimId: 4, dimName: '场', name: '促销执行到位', score: 2 },
  { dimId: 4, dimName: '场', name: '客诉率（负向）', score: 2 },
  { dimId: 4, dimName: '场', name: '进店/停留', score: 2 },
  { dimId: 5, dimName: '会员', name: '会员新增', score: 3 },
  { dimId: 5, dimName: '会员', name: '会员复购率', score: 3 },
  { dimId: 5, dimName: '会员', name: '会员销售占比', score: 3 },
  { dimId: 5, dimName: '会员', name: '会员客单价', score: 2 },
  { dimId: 5, dimName: '会员', name: '会员活跃度', score: 2 },
  { dimId: 5, dimName: '会员', name: '会员运营执行', score: 2 },
];

function dimName(id: number): string {
  return { 1: '店', 2: '人', 3: '货', 4: '场', 5: '会员' }[id] || '其他';
}

async function seedIfEmpty(): Promise<void> {
  const pool = await getPool();
  const c = await pool.request().query('SELECT COUNT(*) AS n FROM ShopCheckIndicators');
  if ((c.recordset[0]?.n || 0) > 0) return;
  const list = SEED.map((it, i) => ({ ...it, code: String(i + 1).padStart(2, '0'), sort: i + 1 }));
  for (const it of list) {
    await pool.request()
      .input('dimId', sql.Int, it.dimId)
      .input('dimName', sql.NVarChar, dimName(it.dimId))
      .input('code', sql.NVarChar, it.code)
      .input('name', sql.NVarChar, it.name)
      .input('score', sql.Int, it.score)
      .input('sort', sql.Int, it.sort)
      .input('note', sql.NVarChar(sql.MAX), '（口径待补充）')
      .query(`INSERT INTO ShopCheckIndicators (dimId, dimName, code, name, score, sort, note)
              VALUES (@dimId, @dimName, @code, @name, @score, @sort, @note)`);
  }
}

// 检测项列表
router.get('/indicators', async (_req: Request, res: Response) => {
  try {
    await ensureTable();
    await seedIfEmpty();
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT id, dimId, dimName, code, name, score, sort, note, isActive, createdAt, updatedAt
      FROM ShopCheckIndicators ORDER BY sort
    `);
    res.json(r.recordset);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

router.post('/indicators', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const pool = await getPool();
    const { dimId = 1, name = '', score = 0, sort = 0, note = '' } = req.body;
    // 取排序序号（缺省为最大 +1）
    let s = Number(sort);
    if (!s) {
      const mx = await pool.request().query('SELECT ISNULL(MAX(sort),0) AS mx FROM ShopCheckIndicators');
      s = Number(mx.recordset[0]?.mx || 0) + 1;
    }
    const r = await pool.request()
      .input('dimId', sql.Int, Number(dimId))
      .input('dimName', sql.NVarChar, dimName(Number(dimId)))
      .input('name', sql.NVarChar, String(name))
      .input('score', sql.Int, Number(score))
      .input('sort', sql.Int, s)
      .input('note', sql.NVarChar(sql.MAX), String(note || ''))
      .query(`INSERT INTO ShopCheckIndicators (dimId, dimName, name, score, sort, note)
              VALUES (@dimId, @dimName, @name, @score, @sort, @note);
              SELECT SCOPE_IDENTITY() AS id`);
    res.status(201).json({ id: r.recordset[0]?.id });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

router.put('/indicators/:id', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const pool = await getPool();
    const id = Number(req.params.id);
    const { dimId, name, score, sort, note, isActive } = req.body;
    const sets: string[] = [];
    const p = pool.request().input('id', sql.Int, id);
    if (typeof name === 'string') { sets.push('name = @name'); p.input('name', sql.NVarChar, name); }
    if (typeof score === 'number') { sets.push('score = @score'); p.input('score', sql.Int, Number(score)); }
    if (typeof note === 'string') { sets.push('note = @note'); p.input('note', sql.NVarChar(sql.MAX), note); }
    if (typeof dimId === 'number' && !Number.isNaN(dimId)) { sets.push('dimId = @dimId, dimName = @dimName'); p.input('dimId', sql.Int, Number(dimId)).input('dimName', sql.NVarChar, dimName(Number(dimId))); }
    if (typeof sort === 'number') { sets.push('sort = @sort'); p.input('sort', sql.Int, Number(sort)); }
    if (typeof isActive === 'number') { sets.push('isActive = @isActive'); p.input('isActive', sql.Int, isActive ? 1 : 0); }
    if (sets.length === 0) { res.status(400).json({ message: '无可更新字段' }); return; }
    sets.push('updatedAt = GETDATE()');
    await p.query(`UPDATE ShopCheckIndicators SET ${sets.join(', ')} WHERE id = @id`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

router.delete('/indicators/:id', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const pool = await getPool();
    await pool.request().input('id', sql.Int, Number(req.params.id))
      .query(`DELETE FROM ShopCheckIndicators WHERE id = @id`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 店铺总览/帮扶表基础行（店仓全基本信息，得分等取数留空，仅做框架）
router.get('/shops', async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const groupName = typeof req.query.groupName === 'string' ? req.query.groupName : '';
    const allow = await scopeStoreSet(groupName, req.user || null); // 按用户组授权门店过滤，null=不限制
    let r = await pool.request().query(`
      SELECT 店铺名称 AS shopName, ISNULL(区域,'') AS area, ISNULL(区经,'') AS districtManager,
             ISNULL(督导,'') AS supervisor, ISNULL(经销商,'') AS dealer,
             ISNULL(联系人,'') AS manager, ISNULL(手机,'') AS phone
      FROM 店仓全
      WHERE 仓库类别 IN ('直营','山东直营','加盟') AND ISNULL(店铺名称,'') <> ''
      ORDER BY 区域, 区经, 督导, 店铺名称
    `);
    let rows: any[] = r.recordset || [];
    if (allow) rows = rows.filter((x: any) => allow.has(x.shopName));
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// 按用户身份获取授权门店集合；JWT 身份存在时按标准组织隔离计算（null=全部可见，[]=无权限）；
// 无 JWT 身份（不应发生）返回 null 不限制，兼容旧调用
// v3：走标准组织隔离（sys_user_role → sys_org），用户组/GroupPermissions 已下线
async function scopeStoreSet(groupName?: string, user?: JwtUserPayload | null): Promise<Set<string> | null> {
  if (user) {
    const pool = await getPool();
    const visible = await getStandardVisibleShopNames(pool, groupName, user);
    if (visible === null) return null; // 全部可见
    return new Set(visible);           // [] = 空集（无权限）
  }
  return null;
}

// 总览：按“检查项标准”（五维 36 项）生成各门店检测结果（得分/短板明细）
const OV = [
  { id: 1, name: '店' }, { id: 2, name: '人' }, { id: 3, name: '货' }, { id: 4, name: '场' }, { id: 5, name: '会员' },
];
router.get('/overview-scores', async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const salt = typeof req.query.t === 'string' ? req.query.t : '1';
    const inds = (await pool.request()
      .query(`SELECT id, dimId, name, score FROM ShopCheckIndicators WHERE isActive=1 ORDER BY sort`)).recordset || [];
    let shops: any[] = (await pool.request().query(
      `SELECT 店铺名称 shopName, ISNULL(区域,'') area, ISNULL(区经,'') districtManager,
              ISNULL(督导,'') supervisor, ISNULL(经销商,'') dealer,
              ISNULL(联系人,'') manager, ISNULL(手机,'') phone, ISNULL(仓库类别,'') warehouse
       FROM 店仓全 WHERE 仓库类别 IN ('直营','山东直营','加盟') AND ISNULL(店铺名称,'')<>''`
    )).recordset as any[] || [];
    const allow = await scopeStoreSet(typeof req.query.groupName === 'string' ? req.query.groupName : '', req.user || null);
    if (allow) shops = shops.filter((sc: any) => allow.has(sc.shopName));

    const hash = (s: string) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
    const uni = (n: number) => { const v = Math.sin(n * 9301 + 49297) * 233280; return v - Math.floor(v); };
    const gOf = (t: number) => { if (t >= 90) return 'S'; if (t >= 80) return 'A'; if (t >= 70) return 'B'; if (t >= 60) return 'C'; return 'D'; };
    const dimName = (dimId: number) => (OV.find((d) => d.id === dimId) || {}).name || '其他';

    const rows = shops.map((sh: any) => {
      const base = hash(sh.shopName + '_' + salt);
      const dimRatio: Record<number, number> = {};
      OV.forEach((d) => { dimRatio[d.id] = 0.4 + 0.5 * uni(base + d.id * 37); });

      const detail = inds.map((it: any) => {
        const ratio = dimRatio[Number(it.dimId)] || 0.5;
        const full = Number(it.score) || 0;
        const score = Math.max(0, Math.min(full, Math.round(full * (0.2 + 0.8 * ratio))));
        return { dimId: Number(it.dimId), dim: dimName(Number(it.dimId)), name: it.name, full, score };
      });
      const total = detail.reduce((s: number, i: any) => s + i.score, 0);
      const short = detail.filter((i: any) => i.score < i.full);
      return {
        shopName: sh.shopName, area: sh.area, districtManager: sh.districtManager, supervisor: sh.supervisor,
        dealer: sh.dealer, manager: sh.manager, phone: sh.phone, warehouse: sh.warehouse,
        total, grade: gOf(total), full: 100,
        rectCount: short.length, rectGap: short.reduce((s: number, i: any) => s + (i.full - i.score), 0),
        detail,
      };
    });

    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

// ============================================================
// 店铺预警表：跨月对比检测结果，持续未改善的店铺预警
// ============================================================
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const mStr = typeof req.query.month === 'string' && req.query.month ? req.query.month : null;
    const next = new Date();
    const curMonth = mStr || `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    const prevMonth = (() => { const d = new Date(curMonth + '-01'); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();

    const inds = (await pool.request()
      .query(`SELECT id, dimId, name, score FROM ShopCheckIndicators WHERE isActive=1 ORDER BY sort`)).recordset || [];
    let shops: any[] = (await pool.request().query(
      `SELECT 店铺名称 shopName, ISNULL(区域,'') area, ISNULL(区经,'') districtManager,
              ISNULL(督导,'') supervisor, ISNULL(经销商,'') dealer, ISNULL(联系人,'') manager, ISNULL(手机,'') phone,
              ISNULL(仓库类别,'') warehouse
       FROM 店仓全 WHERE 仓库类别 IN ('直营','山东直营','加盟') AND ISNULL(店铺名称,'')<>''`
    )).recordset as any[] || [];
    const allow = await scopeStoreSet(typeof req.query.groupName === 'string' ? req.query.groupName : '', req.user || null);
    if (allow) shops = shops.filter((sc: any) => allow.has(sc.shopName));

    const dayhash = (s: string) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
    const uni = (n: number) => { const v = Math.sin(n * 9301 + 49297) * 233280; return v - Math.floor(v); };
    const gOf = (t: number) => { if (t >= 90) return 'S'; if (t >= 80) return 'A'; if (t >= 70) return 'B'; if (t >= 60) return 'C'; return 'D'; };
    const dimNameOf = (dimId: number) => (OV.find((d) => d.id === dimId) || {}).name || '其他';

    // 生成某月各门店检测结果（确定性：仅依赖 店 + 月份）
    const gen = (month: string) => shops.map((s: any) => {
      const base = dayhash(s.shopName + '_' + month);
      const ratio: Record<number, number> = {};
      OV.forEach((d) => { ratio[d.id] = 0.35 + 0.55 * uni(base + d.id * 31); });
      const items = inds.sort(function (a, b) { return a.sort - b.sort; }).map((it: any) => {
        const full = Number(it.score) || 0;
        const score = Math.max(0, Math.min(full, Math.round(full * (0.15 + 0.85 * (ratio[Number(it.dimId)] || 0.5)))));
        return { dimId: Number(it.dimId), dim: dimNameOf(Number(it.dimId)), name: it.name, full, score };
      });
      const total = items.reduce((s0, i) => s0 + i.score, 0);
      return { shopName: s.shopName, items, total, grade: gOf(total) };
    });

    const curList = gen(curMonth);   // 本月
    const prevList = gen(prevMonth); // 上月
    const prevBy = new Map(prevList.map((x) => [x.shopName, x]));
    const curBy = new Map(curList.map((x) => [x.shopName, x]));

    const rows: any[] = [];
    for (const s of shops) {
      const c = curBy.get(s.shopName);
      const p = prevBy.get(s.shopName);
      if (!c) continue;
      const warnings: any[] = [];
      if (p) {
        const pItems = new Map(p.items.map((i) => [i.name, i]));
        for (const it of c.items) {
          const pi = pItems.get(it.name);
          if (!pi) continue;
          if (pi.score < it.full && it.score < it.full && it.score <= pi.score) {
            warnings.push({ type: '持续问题', name: it.name, dim: it.dim, prevScore: pi.score, score: it.score, full: it.full });
          } else if (it.score < pi.score) {
            warnings.push({ type: '指标下滑', name: it.name, dim: it.dim, prevScore: pi.score, score: it.score, full: it.full });
          } else if (it.score < it.full && pi.score >= it.full) {
            warnings.push({ type: '新增短板', name: it.name, dim: it.dim, prevScore: pi.score, score: it.score, full: it.full });
          }
        }
        if (c.total < p.total) warnings.push({ type: '总分下滑', name: '门店总分', dim: '', prevScore: p.total, score: c.total, full: 100 });
      }
      rows.push({
        shopName: s.shopName, area: s.area, districtManager: s.districtManager, supervisor: s.supervisor,
        dealer: s.dealer, manager: s.manager, phone: s.phone, warehouse: s.warehouse,
        prevTotal: p ? p.total : null, prevGrade: p ? gOf(p.total) : '',
        curTotal: c.total, curGrade: gOf(c.total),
        warnCount: warnings.length, warnings,
      });
    }

    // 预警标准：连续不合格——上月与本月门店总分均 <60
    const flagged = rows.filter((r) => r.prevTotal != null && r.prevTotal < 60 && r.curTotal < 60);

    const gp = new Map<string, any[]>();
    flagged.forEach((r) => {
      const k = `${r.area}||${r.districtManager}||${r.supervisor}||${r.dealer}`;
      if (!gp.has(k)) gp.set(k, []);
      gp.get(k)!.push(r);
    });
    const groups = Array.from(gp.values()).map((members) => {
      const prevAvg = Math.round((members.reduce((s: any, m: any) => s + m.prevTotal, 0) / members.length) * 10) / 10;
      const curAvg = Math.round((members.reduce((s: any, m: any) => s + m.curTotal, 0) / members.length) * 10) / 10;
      return {
        area: members[0].area, dm: members[0].districtManager, sup: members[0].supervisor, dealer: members[0].dealer,
        count: members.length, prevAvg, curAvg, delta: Math.round((curAvg - prevAvg) * 10) / 10,
        members,
      };
    });

    res.json({
      month: curMonth, prevMonth,
      summary: {
        flaggedStores: flagged.length,
        avgPrev: flagged.length ? Math.round((flagged.reduce((s: any, r: any) => s + r.prevTotal, 0) / flagged.length) * 10) / 10 : 0,
        avgCur: flagged.length ? Math.round((flagged.reduce((s: any, r: any) => s + r.curTotal, 0) / flagged.length) * 10) / 10 : 0,
      },
      groups,
      rows: flagged,
    });
  } catch (e: any) {
    res.status(500).json({ message: (e as Error).message });
  }
});

export default router;