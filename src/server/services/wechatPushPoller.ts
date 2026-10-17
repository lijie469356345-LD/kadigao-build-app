// ============================================================
// 轮询兜底服务：当数据库触发器不可用时，每隔 pollingInterval 秒
// 扫描 StoreInspectionLogs 表，找出新提交的已签字日志 -> 推送。
// ============================================================

import sql from 'mssql';
import { getPool } from '../../config/db';
import { getSettings, hasBeenPushed, pushInspectionLog } from './wechatPushService';

/** 延迟（秒）：数据入库后，延迟多少秒再读取、推送 */
const PUSH_DELAY_SECONDS = 10;

/** 单例：避免多次启动 */
let _pollerTimer: NodeJS.Timeout | null = null;
let _isRunning = false;
/** 上次扫描时间点（SQL Server DATETIME 兼容字符串） */
let _lastScanTime: string | null = null;
/** 推送起点：只推送此 ID 之后的新日志 */
let _cutoffId = 0;

/** 重置轮询周期（修改配置后会用到） */
export function resetPollerTimer() {
  if (_pollerTimer) {
    clearInterval(_pollerTimer);
    _pollerTimer = null;
  }
}

/** 启动轮询服务（在 server.ts 启动时调用一次） */
export async function startPollingService(): Promise<void> {
  if (_pollerTimer) return;
  const settings = await getSettings();
  const interval = Math.max(30, Number(settings.pollingInterval) || 30);
  // 初始化扫描起点：当前时间往前推一点，避免冷启动时扫一堆历史数据
  _lastScanTime = new Date(Date.now() - 60 * 1000).toISOString();
  // 设置推送起点：只推从此 ID 之后的新日志
  try {
    const pool = await getPool();
    const r = await pool.request().query(`SELECT ISNULL(MAX(id), 0) AS maxId FROM StoreInspectionLogs`);
    _cutoffId = Number(r.recordset[0].maxId);
    console.log(`[WechatPoller] 推送起点: ID > ${_cutoffId}，历史日志不再推送`);
  } catch { _cutoffId = 0; }
  console.log(`[WechatPoller] 轮询服务已启动，间隔 ${interval} 秒`);
  _pollerTimer = setInterval(() => {
    void runOnce();
  }, interval * 1000);
}

/** 单次扫描：供轮询内部调用，也可被测试/手动触发 */
export async function runOnce(): Promise<{ scanned: number; pushed: number }> {
  if (_isRunning) {
    return { scanned: 0, pushed: 0 };
  }
  _isRunning = true;
  let scanned = 0;
  let pushed = 0;
  try {
    const settings = await getSettings();
    if (!settings.enabled || !settings.pollingEnabled) {
      // 全局关闭 -> 不扫
      return { scanned: 0, pushed: 0 };
    }

    const pool = await getPool();
    // 选：状态为 submitted、并且 createdAt 已经超过 PUSH_DELAY_SECONDS 秒
    // 且从未进入过 WechatPushHistory 的日志
    const result = await pool.request().query(`
      SELECT id, supervisor, destination, createdAt, status
      FROM StoreInspectionLogs
      WHERE status = 'submitted'
        AND id > ${_cutoffId}
        AND createdAt <= DATEADD(SECOND, -${PUSH_DELAY_SECONDS}, GETDATE())
      ORDER BY createdAt ASC
    `);
    const rows = result.recordset || [];
    scanned = rows.length;

    for (const row of rows) {
      const logId = Number(row.id);
      const already = await hasBeenPushed(logId);
      if (already) continue;
      // 单独异步推送，不阻塞循环；错误被内部吞掉并写日志
      setTimeout(async () => {
        try {
          await pushInspectionLog(logId, 'polling');
        } catch (err) {
          console.error(`[WechatPoller] 推送 logId=${logId} 异常:`, err);
        }
      }, 0);
      pushed++;
    }
    _lastScanTime = new Date().toISOString();
  } catch (err) {
    console.error('[WechatPoller] 扫描异常:', err);
  } finally {
    _isRunning = false;
  }
  return { scanned, pushed };
}

/** 获取轮询状态 */
export function getPollerStatus(): { enabled: boolean; running: boolean; lastScan: string | null } {
  return {
    enabled: _pollerTimer !== null,
    running: _isRunning,
    lastScan: _lastScanTime,
  };
}
