// ============================================================
// 时段业绩查询路由
//   GET  /api/hourly-performance/data       查询时段+店铺聚合业绩
//   PUT  /api/hourly-performance/target     更新今日业绩目标
// ============================================================

import { Router, Request, Response } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { dispatchCustomNotification } from '../services/push/PushDispatcher';

const router = Router();

// 陪跑跟进推送收件人（企微账号）
const PUSH_RECIPIENTS = ['wangjiahui', 'LiuDeng'];

// ============================================================
// 今日业绩目标存储（按天，用户自填）
// ============================================================

/** 幂等建表 */
async function ensureTargetTable(): Promise<void> {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'FA_HourlyTarget')
    CREATE TABLE FA_HourlyTarget (
      id INT IDENTITY(1,1) PRIMARY KEY,
      targetDate DATE NOT NULL,
      targetAmount DECIMAL(18,2) NOT NULL,
      updatedBy NVARCHAR(100),
      updatedByName NVARCHAR(100),
      updatedAt DATETIME DEFAULT GETDATE(),
      CONSTRAINT UQ_HourlyTarget_Date UNIQUE (targetDate)
    )
  `);
}

/** 获取指定日期的目标金额（无记录返回 0） */
async function getDailyTarget(dateStr: string): Promise<number> {
  const pool = await getPool();
  const res = await pool.request()
    .input('targetDate', sql.NVarChar, dateStr)
    .query('SELECT TOP 1 targetAmount FROM FA_HourlyTarget WHERE targetDate = @targetDate');
  if (res.recordset.length > 0) return Number(res.recordset[0].targetAmount);
  return 0;
}

/** 获取今天的日期字符串（yyyy-mm-dd，服务器本地时间） */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// 陪跑跟进店铺列表
const COACHING_SHOPS = [
  '洛阳宜阳二店_ZY',
  '巩义市新兴路店_ZY',
  '信阳固始踏月寺街店_ZY',
  '南阳方城卡迪高六店_ZY',
  '焦作万达广场店_ZY',
  '南阳内乡卡迪高四店_ZY',
  '洛阳景华路店_ZY',
  '郑州惠济万达店_ZY',
  '郑州工人路二店_ZY',
  '南阳邓州八店_ZY',
];

interface RawRow {
  小时: number;
  店铺名称: string;
  金额: number;
}

// 固定时段槽：每个槽统计该时段之前所有小时的累计汇总
// 10:00 → 0~9点, 12:00 → 0~11点, 14:00 → 0~13点, ... 22:00 → 0~21点
const TIME_SLOTS: { label: string; hours: number[] }[] = [
  { label: '10:00', hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
  { label: '12:00', hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { label: '14:00', hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
  { label: '16:00', hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
  { label: '18:00', hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17] },
  { label: '20:00', hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] },
  { label: '22:00', hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21] },
];

function fmtMoney(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
}

/** 按新模板构建推送消息 */
function buildPushMessage(rows: RawRow[], targetAmount: number): string | null {
  if (rows.length === 0) return null;

  // 按小时聚合
  const hourMap = new Map<number, number>();
  for (const r of rows) {
    hourMap.set(r.小时, (hourMap.get(r.小时) || 0) + r.金额);
  }

  // 按店铺聚合（累计）
  const shopMap = new Map<string, number>();
  for (const r of rows) {
    shopMap.set(r.店铺名称, (shopMap.get(r.店铺名称) || 0) + r.金额);
  }
  const byShop = Array.from(shopMap.entries()).sort((a, b) => b[1] - a[1]);
  const totalAmount = byShop.reduce((s, [, amt]) => s + amt, 0);

  // 构建消息
  const lines: string[] = [];
  lines.push('【陪跑跟进-时段业绩播报】');
  lines.push(`查询时间：${new Date().toLocaleString('zh-CN')}`);
  const targetLine = targetAmount > 0
    ? fmtMoney(targetAmount)
    : '未设置';
  lines.push(`今日业绩目标：${targetLine}`);
  lines.push('');
  lines.push('陪跑店铺时段业绩汇总');

  const currentHour = new Date().getHours();
  for (const slot of TIME_SLOTS) {
    const slotHour = parseInt(slot.label.split(':')[0], 10);
    if (currentHour < slotHour) {
      lines.push(`${slot.label}`);
      continue;
    }
    const slotSum = slot.hours.reduce((s, h) => s + (hourMap.get(h) || 0), 0);
    if (slotSum > 0) {
      lines.push(`${slot.label}  ${fmtMoney(slotSum)}元`);
    } else {
      lines.push(`${slot.label}`);
    }
  }

  lines.push('————————');
  lines.push('店铺业绩明细');
  for (const [shop, amt] of byShop) {
    const shortName = shop.replace(/_ZY$/, '');
    lines.push(`${shortName}  ${fmtMoney(amt)}元`);
  }

  lines.push('');
  lines.push(`合计：${fmtMoney(totalAmount)}元（${byShop.length}家店）`);

  let message = lines.join('\n');
  if (Buffer.byteLength(message, 'utf8') > 2000) {
    let head = '';
    let bytes = 0;
    for (const ch of message) {
      const b = Buffer.byteLength(ch, 'utf8');
      if (bytes + b > 1950) break;
      head += ch;
      bytes += b;
    }
    message = head + '\n...(内容过长已截断)';
  }
  return message;
}

/** 查询原始数据（共用） */
async function queryRawData(): Promise<RawRow[]> {
  const pool = await getPool();
  const shopParams = COACHING_SHOPS.map((_, i) => `@shop${i}`).join(',');
  const request = pool.request();
  COACHING_SHOPS.forEach((shop, i) => {
    request.input(`shop${i}`, sql.NVarChar, shop);
  });

  const result = await request.query(`
    SELECT DATEPART(HOUR, 创建时间) AS 小时,
           店铺名称,
           SUM(业绩金额) AS 金额
    FROM 有效业绩全
    WHERE 日期 >= GETDATE() - 1
      AND 店铺名称 IN (${shopParams})
    GROUP BY DATEPART(HOUR, 创建时间), 店铺名称
  `);

  return (result.recordset || []).map((r: any) => ({
    小时: Number(r['小时']),
    店铺名称: String(r['店铺名称']),
    金额: Number(r['金额']),
  }));
}

// GET /api/hourly-performance/data
router.get('/data', async (_req: Request, res: Response) => {
  try {
    await ensureTargetTable();
    const todayTarget = await getDailyTarget(todayStr());
    const rows = await queryRawData();

    // 按小时聚合
    const hourMap = new Map<number, number>();
    for (const r of rows) {
      hourMap.set(r.小时, (hourMap.get(r.小时) || 0) + r.金额);
    }

    // 第一区：固定7个时段槽，每个=该时段之前所有小时累计汇总（未到时段留空）
    const currentHour = new Date().getHours();
    const byHour = TIME_SLOTS.map((slot, idx) => {
      const slotHour = parseInt(slot.label.split(':')[0], 10);
      if (currentHour < slotHour) {
        return { hour: slot.label, hourNum: idx, amount: 0 };
      }
      const slotSum = slot.hours.reduce((s, h) => s + (hourMap.get(h) || 0), 0);
      return {
        hour: slot.label,
        hourNum: idx,
        amount: Math.round(slotSum * 100) / 100,
      };
    });

    // 第二区：按店铺聚合 -> 店铺总业绩
    const shopMap = new Map<string, number>();
    for (const r of rows) {
      shopMap.set(r.店铺名称, (shopMap.get(r.店铺名称) || 0) + r.金额);
    }
    const byShop = Array.from(shopMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([shop, amount]) => ({
        shopName: shop,
        amount: Math.round(amount * 100) / 100,
      }));

    const totalAmount = byShop.reduce((s, x) => s + x.amount, 0);

    res.json({
      ok: true,
      byHour,
      byShop,
      totalAmount: Math.round(totalAmount * 100) / 100,
      queryTime: new Date().toLocaleString('zh-CN'),
      shopCount: byShop.length,
      todayTarget,
    });
  } catch (error: any) {
    console.error('[hourly-performance] 查询失败:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// PUT /api/hourly-performance/target
// body: { targetAmount: number, targetDate?: string(yyyy-mm-dd) }
router.put('/target', async (req: Request, res: Response) => {
  try {
    await ensureTargetTable();
    const amount = Number(req.body?.targetAmount);
    if (!amount || amount <= 0 || isNaN(amount)) {
      return res.status(400).json({ ok: false, error: '请输入有效的目标金额' });
    }
    const dateStr = req.body?.targetDate ? String(req.body.targetDate) : todayStr();

    // 从 token 获取用户信息
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    let userName = 'system';
    try {
      const jwt = require('jsonwebtoken');
      const decoded: any = jwt.decode(token);
      if (decoded?.userName) userName = decoded.userName;
    } catch { /* ignore */ }

    const pool = await getPool();
    await pool.request()
      .input('targetDate', sql.NVarChar, dateStr)
      .input('targetAmount', sql.Decimal(18, 2), amount)
      .input('updatedBy', sql.NVarChar, userName)
      .input('updatedByName', sql.NVarChar, userName)
      .query(`
        MERGE INTO FA_HourlyTarget WITH (HOLDLOCK) AS t
        USING (SELECT @targetDate AS targetDate) AS s
        ON t.targetDate = s.targetDate
        WHEN MATCHED THEN
          UPDATE SET targetAmount = @targetAmount, updatedBy = @updatedBy, updatedByName = @updatedByName, updatedAt = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (targetDate, targetAmount, updatedBy, updatedByName, updatedAt)
          VALUES (@targetDate, @targetAmount, @updatedBy, @updatedByName, GETDATE());
      `);

    res.json({ ok: true, targetDate: dateStr, targetAmount: amount });
  } catch (error: any) {
    console.error('[hourly-performance] 保存目标失败:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;

// ============================================================
// 定时推送：每天 10:00-22:00 每隔 2 小时自动推送
// 触发时间：10:00, 12:00, 14:00, 16:00, 18:00, 20:00, 22:00
// ============================================================

const SCHEDULED_HOURS = [10, 12, 14, 16, 18, 20, 22];

let _hourlyTimer: NodeJS.Timeout | null = null;

/** 执行一次定时推送（供调度器和手动触发共用） */
export async function runScheduledPush(): Promise<{ ok: boolean; summary: string; detail: any }> {
  try {
    // 数据库级去重：检查当前时段是否已推送过（防止多进程重复触发）
    const pool = await getPool();
    const currentHour = new Date().getHours();
    const dupCheck = await pool.request()
      .input('moduleCode', sql.NVarChar, 'custom_notification')
      .input('triggeredBy', sql.NVarChar, 'auto')
      .input('currentHour', sql.Int, currentHour)
      .query(`
        SELECT COUNT(*) AS n FROM WechatPushLogsV2
        WHERE moduleCode = @moduleCode
          AND triggeredBy = @triggeredBy
          AND messageContent LIKE '%陪跑跟进-时段业绩播报%'
          AND CAST(triggeredAt AS DATE) = CAST(GETDATE() AS DATE)
          AND DATEPART(HOUR, triggeredAt) = @currentHour
      `);
    if (dupCheck.recordset[0].n > 0) {
      console.log(`[hourly-performance] 当前时段(${currentHour}:00)已推送过，跳过`);
      return { ok: false, summary: '当前时段已推送过', detail: null };
    }

    const rows = await queryRawData();

    await ensureTargetTable();
    const todayTarget = await getDailyTarget(todayStr());
    const message = buildPushMessage(rows, todayTarget);
    if (!message) {
      console.log('[hourly-performance] 定时推送：暂无数据，跳过');
      return { ok: false, summary: '暂无数据', detail: null };
    }

    const options = {
      recipientOverride: PUSH_RECIPIENTS.map((acc) => ({
        name: acc,
        wechatAccount: acc,
      })),
    };

    const pushResult = await dispatchCustomNotification(message, 'auto', options);
    console.log('[hourly-performance] 定时推送完成:', pushResult.summary);
    return { ok: true, summary: pushResult.summary, detail: pushResult.detail };
  } catch (err) {
    console.error('[hourly-performance] 定时推送失败:', (err as Error).message);
    return { ok: false, summary: (err as Error).message, detail: null };
  }
}

/** 启动定时推送调度器：每分钟检查是否到达整点 */
export function startHourlyPerformanceScheduler(): void {
  if (_hourlyTimer) {
    console.log('[hourly-performance] 调度器已运行，跳过');
    return;
  }
  console.log('[hourly-performance] 定时推送调度已启动，触发时间：10:00/12:00/14:00/16:00/18:00/20:00/22:00');

  const lastRunDate = { value: '' }; // 防止同一小时重复执行

  _hourlyTimer = setInterval(() => {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    // 仅在整点附近（0-2分）检查
    if (minute > 2) return;

    if (!SCHEDULED_HOURS.includes(hour)) return;

    const todayKey = `${now.toDateString()}-${hour}`;
    if (lastRunDate.value === todayKey) return;
    lastRunDate.value = todayKey;

    console.log(`[hourly-performance] 触发定时推送 (${hour}:00)`);
    void runScheduledPush();
  }, 60000); // 每分钟检查
}

/** 停止定时推送调度器 */
export function stopHourlyPerformanceScheduler(): void {
  if (_hourlyTimer) {
    clearInterval(_hourlyTimer);
    _hourlyTimer = null;
  }
}
