// ============================================================
// 推送队列消费服务
// 从 WechatPushQueue 表轮询消费，支持重试和优先级。
// ============================================================

import sql from 'mssql';
import { getPool } from '../../../config/db';
import { dispatchPush } from './PushDispatcher';

let _queueTimer: NodeJS.Timeout | null = null;
let _isProcessing = false;
const SCAN_INTERVAL_SEC = 10; // 每10秒扫一次队列

/** 启动队列消费 */
export function startQueueService(): void {
  if (_queueTimer) return;
  console.log('[PushQueueService] 队列消费服务已启动，扫描间隔 10 秒');
  _queueTimer = setInterval(() => { void processQueue(); }, SCAN_INTERVAL_SEC * 1000);
}

/** 停止队列消费 */
export function stopQueueService(): void {
  if (_queueTimer) {
    clearInterval(_queueTimer);
    _queueTimer = null;
  }
}

/** 向队列中添加一个推送任务 */
export async function enqueuePush(
  moduleCode: string,
  sourceId: number | string,
  sourceTable: string,
  priority: number = 0
): Promise<void> {
  try {
    const pool = await getPool();
    const sid = String(sourceId);
    // 去重：同模块+源ID已经在队列中则跳过
    const exists = await pool.request()
      .input('m', sql.NVarChar, moduleCode)
      .input('s', sql.NVarChar, sid)
      .query(`SELECT id FROM WechatPushQueue WHERE moduleCode = @m AND sourceId = @s AND status IN ('queued', 'processing')`);
    if ((exists.recordset || []).length > 0) return;

    await pool.request()
      .input('m', sql.NVarChar, moduleCode)
      .input('s', sql.NVarChar, sid)
      .input('t', sql.NVarChar, sourceTable)
      .input('p', sql.Int, priority)
      .query(`
        INSERT INTO WechatPushQueue (moduleCode, sourceId, sourceTable, priority, status, nextAttemptAt)
        VALUES (@m, @s, @t, @p, 'queued', DATEADD(SECOND, 5, GETDATE()))
      `);
  } catch (err) {
    console.error('[PushQueueService] enqueuePush 失败:', (err as Error).message);
  }
}

/** 处理队列表中的待推送任务 */
async function processQueue(): Promise<void> {
  if (_isProcessing) return;
  _isProcessing = true;
  try {
    const pool = await getPool();
    // 取待处理的条目（最多10条）
    const items = await pool.request().query(`
      SELECT TOP 10 id, moduleCode, sourceId, sourceTable, priority, attemptCount, maxAttempts
      FROM WechatPushQueue
      WHERE status = 'queued' AND nextAttemptAt <= GETDATE()
      ORDER BY priority DESC, nextAttemptAt ASC
    `);

    for (const item of (items.recordset || [])) {
      const id = Number(item.id);
      const moduleCode = String(item.moduleCode);
      const sourceId = String(item.sourceId);
      const attemptCount = Number(item.attemptCount);
      const maxAttempts = Number(item.maxAttempts);

      // 标记为处理中
      await pool.request()
        .input('id', sql.Int, id)
        .query(`UPDATE WechatPushQueue SET status = 'processing', attemptCount = attemptCount + 1, updatedAt = GETDATE() WHERE id = @id`);

      try {
        const result = await dispatchPush(moduleCode, sourceId, 'polling');
        if (result.detail.some(d => d.success)) {
          // 成功：从队列移除
          await pool.request().input('id', sql.Int, id).query(`UPDATE WechatPushQueue SET status = 'completed', updatedAt = GETDATE() WHERE id = @id`);
        } else {
          throw new Error(result.summary);
        }
      } catch (err: any) {
        const newAttempt = attemptCount + 1;
        if (newAttempt >= maxAttempts) {
          // 超过最大重试次数，标记失败
          await pool.request()
            .input('id', sql.Int, id)
            .input('err', sql.NVarChar, err?.message || String(err))
            .query(`UPDATE WechatPushQueue SET status = 'failed', lastError = @err, updatedAt = GETDATE() WHERE id = @id`);
        } else {
          // 退避重试：5*2^n 秒后重试
          const delaySec = 5 * Math.pow(2, newAttempt);
          await pool.request()
            .input('id', sql.Int, id)
            .input('delay', sql.Int, delaySec)
            .input('err', sql.NVarChar, err?.message || String(err))
            .query(`UPDATE WechatPushQueue SET status = 'queued', nextAttemptAt = DATEADD(SECOND, @delay, GETDATE()), lastError = @err, updatedAt = GETDATE() WHERE id = @id`);
        }
      }
    }
  } catch (err) {
    console.error('[PushQueueService] processQueue 异常:', (err as Error).message);
  } finally {
    _isProcessing = false;
  }
}

/** 获取队列状态 */
export function getQueueStatus(): { processing: boolean; timerRunning: boolean } {
  return {
    processing: _isProcessing,
    timerRunning: _queueTimer !== null,
  };
}
