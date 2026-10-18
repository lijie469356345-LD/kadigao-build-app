import { Router, Request, Response } from 'express';
import sql from 'mssql';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getPool } from '../../config/db';
import { authMiddleware } from '../middlewares/authMiddleware';
import { dispatchCustomNotification } from '../services/push/PushDispatcher';

const router = Router();
let ensured = false;

// ==================== 自动作废定时器 ====================
// 将 evaluating 状态超过 3 分钟未决策的记录标记为 voided
let _voidTimer: NodeJS.Timeout | null = null;

export function startVoidScheduler(): void {
  if (_voidTimer) return;
  console.log('[ShoeFeedback] 自动作废调度已启动，扫描间隔 60 秒');
  _voidTimer = setInterval(() => { void autoVoidStale(); }, 60 * 1000);
}

export function stopVoidScheduler(): void {
  if (_voidTimer) { clearInterval(_voidTimer); _voidTimer = null; }
}

async function autoVoidStale(): Promise<void> {
  try {
    const pool = await getPool();
    await pool.request()
      .input('voidedStatus', sql.NVarChar, 'voided')
      .input('updatedAt', sql.DateTime, new Date())
      .query(`
        UPDATE XS_ShoeFeedback
        SET status = @voidedStatus, updatedAt = @updatedAt
        WHERE status = 'evaluating' AND DATEDIFF(MINUTE, createdAt, GETDATE()) > 3
      `);
  } catch (err) {
    console.error('[ShoeFeedback] 自动作废异常:', (err as Error).message);
  }
}

// 文件上传配置
const upload = multer({
  storage: multer.diskStorage({
    destination(_req: any, _file: any, cb: any) {
      const dir = path.resolve(process.cwd(), 'uploads', 'shoe-feedback');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req: any, file: any, cb: any) {
      const ext = path.extname(file.originalname);
      cb(null, `sfb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 150 * 1024 },
});

// 确保表存在
async function ensureTables() {
  if (ensured) return;
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'XS_ShoeFeedback')
    CREATE TABLE XS_ShoeFeedback (
      id INT IDENTITY(1,1) PRIMARY KEY,
      feedbackNo NVARCHAR(50) NOT NULL,
      rechargeDate NVARCHAR(20),
      rechargeAmount NVARCHAR(20),
      paymentProofPath NVARCHAR(500),
      usedTicketCount INT DEFAULT 0,
      estimatedTickets INT DEFAULT 0,
      agreeStatus NVARCHAR(20) DEFAULT '',
      disagreeDesc NVARCHAR(MAX) DEFAULT '',
      status NVARCHAR(20) DEFAULT 'pending',
      submitterName NVARCHAR(100) DEFAULT '',
      submitterPhone NVARCHAR(50) DEFAULT '',
      handlerName NVARCHAR(100) DEFAULT '',
      handlerRemark NVARCHAR(MAX) DEFAULT '',
      handlerId NVARCHAR(20) DEFAULT '',
      rating NVARCHAR(20) DEFAULT '',
      handledAt DATETIME NULL,
      completedAt DATETIME NULL,
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE()
    )
  `);
  // 如果表已存在，补加可能缺失的列
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('XS_ShoeFeedback') AND name = 'rating')
    ALTER TABLE XS_ShoeFeedback ADD rating NVARCHAR(20) DEFAULT ''
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('XS_ShoeFeedback') AND name = 'handlerId')
    ALTER TABLE XS_ShoeFeedback ADD handlerId NVARCHAR(20) DEFAULT ''
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('XS_ShoeFeedback') AND name = 'ticketDetails')
    ALTER TABLE XS_ShoeFeedback ADD ticketDetails NVARCHAR(MAX) DEFAULT ''
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('XS_ShoeFeedback') AND name = 'expiredTicketCount')
    ALTER TABLE XS_ShoeFeedback ADD expiredTicketCount NVARCHAR(30) DEFAULT ''
  `);
  ensured = true;
}

// 生成反馈编号
function generateFeedbackNo(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SFB${y}${m}${d}${rand}`;
}

// 计算预估补发券数
// 规则: 每月赠送1张洗鞋券，正常消耗 = 本月 - 充值月，剩余 = 12 - 正常消耗
function calcEstimatedTickets(rechargeDateStr: string, _usedCount: number): number {
  const rechargeDate = new Date(rechargeDateStr);
  const now = new Date();
  const monthDiff = Math.max(0, (now.getFullYear() - rechargeDate.getFullYear()) * 12 + (now.getMonth() - rechargeDate.getMonth()));
  // 正常消耗 = 本月 - 充值月
  const normalConsumed = monthDiff;
  // 剩余 = 12 - 正常消耗
  const remaining = Math.max(0, 12 - normalConsumed);
  return remaining;
}

// ==================== H5 端接口 ====================

// 创建反馈（H5表单提交）
router.post('/', upload.single('paymentProof'), async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();

    const { rechargeDate, rechargeAmount, usedTicketCount, expiredTicketCount, submitterName, submitterPhone } = req.body;
    if (!rechargeDate) return res.status(400).json({ message: '请选择充值时间' });
    if (!submitterPhone) return res.status(400).json({ message: '请输入手机号' });

    // 时间范围校验
    const recharge = new Date(rechargeDate);
    const startDate = new Date('2025-06-01');
    const endDate = new Date('2026-06-05');
    // 不在受理范围内
    if (recharge < startDate || recharge > endDate) {
      const feedbackNo = generateFeedbackNo();
      await pool.request()
        .input('feedbackNo', sql.NVarChar, feedbackNo)
        .input('rechargeDate', sql.NVarChar, rechargeDate)
        .input('rechargeAmount', sql.NVarChar, rechargeAmount || '')
        .input('paymentProofPath', sql.NVarChar, req.file ? `/uploads/shoe-feedback/${req.file.filename}` : '')
        .input('usedTicketCount', sql.Int, parseInt(usedTicketCount) || 0)
        .input('expiredTicketCount', sql.NVarChar, String(expiredTicketCount || ''))
        .input('estimatedTickets', sql.Int, 0)
        .input('agreeStatus', sql.NVarChar, '')
        .input('disagreeDesc', sql.NVarChar, '')
        .input('status', sql.NVarChar, 'voided')
        .input('submitterName', sql.NVarChar, submitterName || '')
        .input('submitterPhone', sql.NVarChar, submitterPhone || '')
        .query(`
          INSERT INTO XS_ShoeFeedback
            (feedbackNo, rechargeDate, rechargeAmount, paymentProofPath, usedTicketCount, expiredTicketCount,
             estimatedTickets, agreeStatus, disagreeDesc, status, submitterName, submitterPhone)
          VALUES
            (@feedbackNo, @rechargeDate, @rechargeAmount, @paymentProofPath, @usedTicketCount, @expiredTicketCount,
             @estimatedTickets, @agreeStatus, @disagreeDesc, @status, @submitterName, @submitterPhone)
        `);
      return res.json({
        feedbackNo,
        inRange: false,
        message: '对不起，您的充值礼包时间不在受理范围内，感谢您的反馈',
        status: 'voided',
      });
    }

    // 在受理范围内 - 计算预估补发券数
    const estimated = calcEstimatedTickets(rechargeDate, parseInt(usedTicketCount) || 0);
    const feedbackNo = generateFeedbackNo();

    await pool.request()
      .input('feedbackNo', sql.NVarChar, feedbackNo)
      .input('rechargeDate', sql.NVarChar, rechargeDate)
      .input('rechargeAmount', sql.NVarChar, rechargeAmount || '')
      .input('paymentProofPath', sql.NVarChar, req.file ? `/uploads/shoe-feedback/${req.file.filename}` : '')
      .input('usedTicketCount', sql.Int, parseInt(usedTicketCount) || 0)
      .input('expiredTicketCount', sql.NVarChar, String(expiredTicketCount || ''))
      .input('estimatedTickets', sql.Int, estimated)
      .input('agreeStatus', sql.NVarChar, '')
      .input('disagreeDesc', sql.NVarChar, '')
      .input('status', sql.NVarChar, 'evaluating')
      .input('submitterName', sql.NVarChar, submitterName || '')
      .input('submitterPhone', sql.NVarChar, submitterPhone || '')
      .query(`
        INSERT INTO XS_ShoeFeedback
          (feedbackNo, rechargeDate, rechargeAmount, paymentProofPath, usedTicketCount, expiredTicketCount,
           estimatedTickets, agreeStatus, disagreeDesc, status, submitterName, submitterPhone)
        VALUES
          (@feedbackNo, @rechargeDate, @rechargeAmount, @paymentProofPath, @usedTicketCount, @expiredTicketCount,
           @estimatedTickets, @agreeStatus, @disagreeDesc, @status, @submitterName, @submitterPhone)
      `);

    return res.json({
      feedbackNo,
      inRange: true,
      estimatedTickets: estimated,
      message: '收到您的反馈，系统正在评估',
      status: 'evaluating',
    });
  } catch (error: any) {
    console.error('创建洗鞋反馈失败:', error);
    res.status(500).json({ message: '提交失败: ' + (error.message || '未知错误') });
  }
});

// 提交同意/不同意（评估后）
router.post('/:id/decide', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const id = parseInt(req.params.id);
    const { agree, disagreeDesc } = req.body;

    const result = await pool.request()
      .input('id', sql.Int, id)
      .input('agreeStatus', sql.NVarChar, agree ? 'agree' : 'disagree')
      .input('disagreeDesc', sql.NVarChar, agree ? '' : (disagreeDesc || ''))
      .input('status', sql.NVarChar, 'submitted')
      .input('updatedAt', sql.DateTime, new Date())
      .query(`
        UPDATE XS_ShoeFeedback
        SET agreeStatus = @agreeStatus,
            disagreeDesc = @disagreeDesc,
            status = @status,
            updatedAt = @updatedAt
        WHERE id = @id
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: '反馈记录不存在' });
    }

    res.json({ ok: true, status: 'submitted' });
  } catch (error: any) {
    res.status(500).json({ message: '操作失败: ' + (error.message || '') });
  }
});

// H5 作废（用户未选择同意/不同意就关闭页面时调用）
router.post('/:feedbackNo/void', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const result = await pool.request()
      .input('feedbackNo', sql.NVarChar, req.params.feedbackNo)
      .input('voidedStatus', sql.NVarChar, 'voided')
      .input('updatedAt', sql.DateTime, new Date())
      .query(`
        UPDATE XS_ShoeFeedback
        SET status = @voidedStatus, updatedAt = @updatedAt
        WHERE feedbackNo = @feedbackNo AND status = 'evaluating'
      `);
    if (result.rowsAffected[0] === 0) {
      return res.json({ ok: false, message: '记录状态已变更，无需作废' });
    }
    res.json({ ok: true, message: '已作废' });
  } catch (error: any) {
    res.status(500).json({ message: '作废失败: ' + (error.message || '') });
  }
});

// 后台导出Excel（必须在 /:feedbackNo 之前注册，避免被动态路由拦截）
// 与列表接口同一套筛选条件（status/agree/pushed/keyword），按筛选结果导出、不导出全部
router.get('/export', authMiddleware, async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { status, keyword, agree, pushed } = req.query;

    const req2 = pool.request();
    let where = ' WHERE 1=1';
    if (status && status !== 'all') {
      where += ' AND status = @status';
      req2.input('status', sql.NVarChar, status);
    }
    if (agree && agree !== 'all') {
      if (agree === 'agree' || agree === 'disagree') {
        where += ' AND agreeStatus = @agreeStatus';
        req2.input('agreeStatus', sql.NVarChar, agree);
      } else if (agree === 'unset') {
        where += " AND (agreeStatus IS NULL OR agreeStatus = '')";
      }
    }
    if (pushed && (pushed === 'pushed' || pushed === 'unpushed')) {
      const pushExists = `EXISTS (SELECT 1 FROM WechatPushLogsV2 WHERE moduleCode = 'custom_notification' AND sourceTitle = '洗鞋反馈补发通知' AND status = 'success' AND messageContent LIKE '%' + XS_ShoeFeedback.feedbackNo + '%')`;
      where += pushed === 'pushed' ? ` AND ${pushExists}` : ` AND NOT ${pushExists}`;
    }
    if (keyword) {
      where += ' AND (feedbackNo LIKE @kw OR submitterName LIKE @kw OR submitterPhone LIKE @kw)';
      req2.input('kw', sql.NVarChar, `%${keyword}%`);
    }
    const result = await req2.query(`SELECT * FROM XS_ShoeFeedback${where} ORDER BY createdAt DESC`);
    const rows = result.recordset.map((r: any) => ({
      '反馈编号': r.feedbackNo,
      '充值时间': r.rechargeDate,
      '充值金额': r.rechargeAmount,
      '已用券数': r.usedTicketCount,
      '过期券数': r.expiredTicketCount || '',
      '预估补发': r.estimatedTickets,
      '同意状态': r.agreeStatus === 'agree' ? '同意' : (r.agreeStatus === 'disagree' ? '不同意' : ''),
      '不同意见描述': r.disagreeDesc,
      '提交人': r.submitterName,
      '提交人手机': r.submitterPhone,
      '处理人': r.handlerName,
      '处理备注': r.handlerRemark,
      '补发明细': r.ticketDetails || '',
      '状态': r.status === 'pending' ? '待处理' : (r.status === 'evaluating' ? '评估中' : (r.status === 'submitted' ? '已提交' : (r.status === 'accepted' ? '已受理' : (r.status === 'voided' ? '已作废' : '已完成')))),
      '创建时间': r.createdAt,
      '处理时间': r.handledAt,
      '完成时间': r.completedAt,
    }));
    res.json({ rows });
  } catch (error: any) {
    res.status(500).json({ message: '导出失败: ' + (error.message || '') });
  }
});

// 后台详情（必须在 /:feedbackNo 之前注册，避免被动态路由拦截）
router.get('/detail/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, parseInt(req.params.id))
      .query('SELECT * FROM XS_ShoeFeedback WHERE id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: '记录不存在' });
    }

    const r = result.recordset[0];
    res.json({
      id: r.id,
      feedbackNo: r.feedbackNo,
      rechargeDate: r.rechargeDate,
      rechargeAmount: r.rechargeAmount,
      paymentProofPath: r.paymentProofPath,
      usedTicketCount: r.usedTicketCount,
      expiredTicketCount: r.expiredTicketCount || '',
      estimatedTickets: r.estimatedTickets,
      agreeStatus: r.agreeStatus,
      disagreeDesc: r.disagreeDesc,
      status: r.status,
      submitterName: r.submitterName,
      submitterPhone: r.submitterPhone,
      handlerName: r.handlerName,
      handlerRemark: r.handlerRemark,
      ticketDetails: r.ticketDetails,
      createdAt: r.createdAt,
      handledAt: r.handledAt,
      completedAt: r.completedAt,
    });
  } catch (error: any) {
    res.status(500).json({ message: '查询失败: ' + (error.message || '') });
  }
});

// H5 查询反馈状态（按手机号，返回数组）
router.get('/phone/:phone', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const result = await pool.request()
      .input('phone', sql.NVarChar, req.params.phone)
      .query('SELECT * FROM XS_ShoeFeedback WHERE submitterPhone = @phone ORDER BY createdAt DESC');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: '未找到该手机号的反馈记录' });
    }

    const rows = result.recordset.map((row: any) => {
      // 实际补发总张数 = 推送的补发券合计（ticketDetails 中 count 之和，不分次数）
      const td = row.ticketDetails ? (typeof row.ticketDetails === 'string' ? JSON.parse(row.ticketDetails) : row.ticketDetails) : null;
      let actualTickets = 0;
      if (Array.isArray(td) && td.length > 0) {
        actualTickets = td.reduce((sum: number, t: any) => sum + (Number(t.count) || 0), 0);
      }
      return {
        id: row.id,
        feedbackNo: row.feedbackNo,
        rechargeDate: row.rechargeDate,
        rechargeAmount: row.rechargeAmount,
        paymentProofPath: row.paymentProofPath,
        usedTicketCount: row.usedTicketCount,
        expiredTicketCount: row.expiredTicketCount || '',
        estimatedTickets: row.estimatedTickets,
        agreeStatus: row.agreeStatus,
        disagreeDesc: row.disagreeDesc,
        status: row.status,
        submitterName: row.submitterName,
        submitterPhone: row.submitterPhone,
        handlerName: row.handlerName,
        handlerId: row.handlerId,
        handlerRemark: row.handlerRemark,
        ticketDetails: row.ticketDetails,
        actualTickets,
        rating: row.rating,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        handledAt: row.handledAt,
        completedAt: row.completedAt,
      };
    });

    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ message: '查询失败: ' + (error.message || '') });
  }
});

// H5 提交评价
router.post('/:feedbackNo/rate', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { rating } = req.body;
    if (!rating) return res.status(400).json({ message: '请选择评价' });

    const result = await pool.request()
      .input('feedbackNo', sql.NVarChar, req.params.feedbackNo)
      .input('rating', sql.NVarChar, rating)
      .input('updatedAt', sql.DateTime, new Date())
      .query(`
        UPDATE XS_ShoeFeedback
        SET rating = @rating, updatedAt = @updatedAt
        WHERE feedbackNo = @feedbackNo
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: '反馈记录不存在' });
    }

    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ message: '评价失败: ' + (error.message || '') });
  }
});

// H5 查询反馈状态（按编号）
router.get('/:feedbackNo', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const result = await pool.request()
      .input('feedbackNo', sql.NVarChar, req.params.feedbackNo)
      .query('SELECT * FROM XS_ShoeFeedback WHERE feedbackNo = @feedbackNo');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: '反馈记录不存在' });
    }

    const row = result.recordset[0];
    // 实际补发总张数 = 推送的补发券合计（ticketDetails 中 count 之和，不分次数）
    const td = row.ticketDetails ? (typeof row.ticketDetails === 'string' ? JSON.parse(row.ticketDetails) : row.ticketDetails) : null;
    let actualTickets = 0;
    if (Array.isArray(td) && td.length > 0) {
      actualTickets = td.reduce((sum: number, t: any) => sum + (Number(t.count) || 0), 0);
    }
    res.json({
      id: row.id,
      feedbackNo: row.feedbackNo,
      rechargeDate: row.rechargeDate,
      rechargeAmount: row.rechargeAmount,
      paymentProofPath: row.paymentProofPath,
      usedTicketCount: row.usedTicketCount,
      expiredTicketCount: row.expiredTicketCount || '',
      estimatedTickets: row.estimatedTickets,
      agreeStatus: row.agreeStatus,
      disagreeDesc: row.disagreeDesc,
      status: row.status,
      submitterName: row.submitterName,
      submitterPhone: row.submitterPhone,
      handlerName: row.handlerName,
      handlerId: row.handlerId,
      handlerRemark: row.handlerRemark,
      ticketDetails: row.ticketDetails,
      actualTickets,
      rating: row.rating,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      handledAt: row.handledAt,
      completedAt: row.completedAt,
    });
  } catch (error: any) {
    res.status(500).json({ message: '查询失败: ' + (error.message || '') });
  }
});

// ==================== 后台管理接口 ====================

// 后台列表查询
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { status, keyword, agree, pushed, page, pageSize } = req.query;
    const pn = parseInt(page as string) || 1;
    const ps = parseInt(pageSize as string) || 20;

    const req2 = pool.request()
      .input('pn', sql.Int, pn)
      .input('ps', sql.Int, ps);
    let where = ' WHERE 1=1';
    if (status && status !== 'all') {
      where += ' AND status = @status';
      req2.input('status', sql.NVarChar, status);
    }
    if (agree && agree !== 'all') {
      if (agree === 'agree' || agree === 'disagree') {
        where += ' AND agreeStatus = @agreeStatus';
        req2.input('agreeStatus', sql.NVarChar, agree);
      } else if (agree === 'unset') {
        // 未决策：agreeStatus 为空
        where += " AND (agreeStatus IS NULL OR agreeStatus = '')";
      }
    }
    if (pushed && (pushed === 'pushed' || pushed === 'unpushed')) {
      // 已推送：WechatPushLogsV2 中存在该反馈编号的成功推送记录
      const pushExists = `EXISTS (SELECT 1 FROM WechatPushLogsV2 WHERE moduleCode = 'custom_notification' AND sourceTitle = '洗鞋反馈补发通知' AND status = 'success' AND messageContent LIKE '%' + XS_ShoeFeedback.feedbackNo + '%')`;
      where += pushed === 'pushed' ? ` AND ${pushExists}` : ` AND NOT ${pushExists}`;
    }
    if (keyword) {
      where += ' AND (feedbackNo LIKE @kw OR submitterName LIKE @kw OR submitterPhone LIKE @kw)';
      req2.input('kw', sql.NVarChar, `%${keyword}%`);
    }
    const result = await req2.query(`SELECT * FROM XS_ShoeFeedback${where} ORDER BY createdAt DESC OFFSET (@pn - 1) * @ps ROWS FETCH NEXT @ps ROWS ONLY`);

    const req3 = pool.request();
    let countWhere = ' WHERE 1=1';
    if (status && status !== 'all') {
      countWhere += ' AND status = @status';
      req3.input('status', sql.NVarChar, status);
    }
    if (agree && agree !== 'all') {
      if (agree === 'agree' || agree === 'disagree') {
        countWhere += ' AND agreeStatus = @agreeStatus';
        req3.input('agreeStatus', sql.NVarChar, agree);
      } else if (agree === 'unset') {
        countWhere += " AND (agreeStatus IS NULL OR agreeStatus = '')";
      }
    }
    if (pushed && (pushed === 'pushed' || pushed === 'unpushed')) {
      const pushExists = `EXISTS (SELECT 1 FROM WechatPushLogsV2 WHERE moduleCode = 'custom_notification' AND sourceTitle = '洗鞋反馈补发通知' AND status = 'success' AND messageContent LIKE '%' + XS_ShoeFeedback.feedbackNo + '%')`;
      countWhere += pushed === 'pushed' ? ` AND ${pushExists}` : ` AND NOT ${pushExists}`;
    }
    if (keyword) {
      countWhere += ' AND (feedbackNo LIKE @kw OR submitterName LIKE @kw OR submitterPhone LIKE @kw)';
      req3.input('kw', sql.NVarChar, `%${keyword}%`);
    }
    const countResult = await req3.query(`SELECT COUNT(*) AS total FROM XS_ShoeFeedback${countWhere}`);
    const total = countResult.recordset[0].total;

    // 查推送状态：查 WechatPushLogsV2 中 sourceTitle 包含反馈编号的记录
    const feedbackNos = result.recordset.map((r: any) => r.feedbackNo);
    let pushMap: Record<string, { pushed: boolean; pushedAt: string | null; recipients: string[] }> = {};
    if (feedbackNos.length > 0) {
      for (const fn of feedbackNos) {
        const r2 = await pool.request()
          .input('fn', sql.NVarChar, `%${fn}%`)
          .query(`SELECT TOP 5 recipientName, status, triggeredAt FROM WechatPushLogsV2 WHERE moduleCode = 'custom_notification' AND sourceTitle = '洗鞋反馈补发通知' AND messageContent LIKE @fn ORDER BY id DESC`);
        if (r2.recordset.length > 0) {
          pushMap[fn] = {
            pushed: r2.recordset.some(r => r.status === 'success'),
            pushedAt: r2.recordset[0].triggeredAt,
            recipients: r2.recordset.map(r => r.recipientName),
          };
        }
      }
    }

    res.json({
      list: result.recordset.map((r: any) => {
        const td = r.ticketDetails ? (typeof r.ticketDetails === 'string' ? JSON.parse(r.ticketDetails) : r.ticketDetails) : null;
        let ticketSummary = '';
        let ticketTotal = 0;
        if (Array.isArray(td) && td.length > 0) {
          ticketSummary = td.map((t: any) => `${t.label}: ${t.count}张`).join('，');
          ticketTotal = td.reduce((sum: number, t: any) => sum + (Number(t.count) || 0), 0);
        }
        const pushInfo = pushMap[r.feedbackNo] || { pushed: false, pushedAt: null, recipients: [] };
        return {
          id: r.id,
          feedbackNo: r.feedbackNo,
          rechargeDate: r.rechargeDate,
          rechargeAmount: r.rechargeAmount,
          paymentProofPath: r.paymentProofPath,
          usedTicketCount: r.usedTicketCount,
      expiredTicketCount: r.expiredTicketCount || '',
          estimatedTickets: r.estimatedTickets,
          agreeStatus: r.agreeStatus,
          disagreeDesc: r.disagreeDesc,
          status: r.status,
          submitterName: r.submitterName,
          submitterPhone: r.submitterPhone,
          handlerName: r.handlerName,
          handlerRemark: r.handlerRemark,
          ticketDetails: r.ticketDetails,
          ticketSummary,
          ticketTotal,
          pushed: pushInfo.pushed,
          pushedAt: pushInfo.pushedAt,
          pushRecipients: pushInfo.recipients.join('、'),
          createdAt: r.createdAt,
          handledAt: r.handledAt,
          completedAt: r.completedAt,
        };
      }),
      total,
      page: pn,
      pageSize: ps,
    });
  } catch (error: any) {
    res.status(500).json({ message: '查询失败: ' + (error.message || '') });
  }
});

// 后台处理（状态 submitted → accepted）
router.post('/:id/handle', authMiddleware, async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const id = parseInt(req.params.id);
    const { remark } = req.body;
    const handlerName = req.user?.userName || '';
    const handlerId = req.user?.userId || '0001';

    const result = await pool.request()
      .input('id', sql.Int, id)
      .input('handlerName', sql.NVarChar, handlerName)
      .input('handlerId', sql.NVarChar, handlerId)
      .input('handlerRemark', sql.NVarChar, remark || '')
      .input('status', sql.NVarChar, 'accepted')
      .input('handledAt', sql.DateTime, new Date())
      .input('updatedAt', sql.DateTime, new Date())
      .query(`
        UPDATE XS_ShoeFeedback
        SET handlerName = @handlerName,
            handlerId = @handlerId,
            handlerRemark = @handlerRemark,
            status = @status,
            handledAt = @handledAt,
            updatedAt = @updatedAt
        WHERE id = @id AND status = 'submitted'
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(400).json({ message: '处理失败：记录不存在或状态不允许处理' });
    }

    res.json({ ok: true, message: '已处理' });
  } catch (error: any) {
    res.status(500).json({ message: '处理失败: ' + (error.message || '') });
  }
});

// 后台完成（状态 accepted → completed）
router.post('/:id/complete', authMiddleware, async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const id = parseInt(req.params.id);
    const { remark, ticketDetails } = req.body;
    const handlerName = req.user?.userName || '';

    // ticketDetails 是数组 [{label:'第一次', count:5}, ...]，存为 JSON 字符串
    const ticketDetailsJson = Array.isArray(ticketDetails) ? JSON.stringify(ticketDetails) : '';

    const result = await pool.request()
      .input('id', sql.Int, id)
      .input('handlerName', sql.NVarChar, handlerName)
      .input('handlerRemark', sql.NVarChar, remark || '')
      .input('ticketDetails', sql.NVarChar, ticketDetailsJson)
      .input('status', sql.NVarChar, 'completed')
      .input('completedAt', sql.DateTime, new Date())
      .input('updatedAt', sql.DateTime, new Date())
      .query(`
        UPDATE XS_ShoeFeedback
        SET handlerName = @handlerName,
            handlerRemark = @handlerRemark,
            ticketDetails = @ticketDetails,
            status = @status,
            completedAt = @completedAt,
            updatedAt = @updatedAt
        WHERE id = @id AND status = 'accepted'
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(400).json({ message: '完成失败：记录不存在或状态不允许完成' });
    }

    // 查询该记录的会员信息，用于推送通知
    const detailResult = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT feedbackNo, rechargeDate, rechargeAmount, submitterName, submitterPhone, usedTicketCount, expiredTicketCount, estimatedTickets FROM XS_ShoeFeedback WHERE id = @id');
    const detail = detailResult.recordset[0];

    // 构造推送消息内容
    let ticketSummary = '无';
    let totalTickets = 0;
    if (Array.isArray(ticketDetails) && ticketDetails.length > 0) {
      ticketSummary = ticketDetails.map((t: any) => `${t.label}: ${t.count} 张`).join('\n');
      totalTickets = ticketDetails.reduce((sum: number, t: any) => sum + (Number(t.count) || 0), 0);
    }

    const messageContent = [
      '【洗鞋反馈补发通知】',
      `反馈编号：${detail?.feedbackNo || ''}`,
      `会员姓名：${detail?.submitterName || ''}`,
      `手机号：${detail?.submitterPhone || ''}`,
      `充值时间：${detail?.rechargeDate || ''}`,
      `充值金额：${detail?.rechargeAmount || ''}`,
      `预估补发：${detail?.estimatedTickets ?? 0} 张`,
      `实际补发明细：`,
      ticketSummary,
      `合计补发：${totalTickets} 张，共 ${Array.isArray(ticketDetails) ? ticketDetails.length : 0} 次`,
      `处理人：${handlerName}`,
      `处理备注：${remark || '无'}`,
    ].join('\n');

    // 推送给韩会玲
    try {
      await dispatchCustomNotification(messageContent, 'manual', {
        templateTitle: '洗鞋反馈补发通知',
        recipientOverride: [
          { name: '韩会玲', wechatAccount: 'HanHuiLing' },
        ],
      });
    } catch (pushErr: any) {
      console.error('[ShoeFeedback] 补发推送失败:', pushErr.message);
    }

    res.json({ ok: true, message: '已完成，推送已发送' });
  } catch (error: any) {
    res.status(500).json({ message: '完成失败: ' + (error.message || '') });
  }
});

// 后台补发推送（对已完成记录重新发送补发通知，供未推送/推送失败的单据再次补推）
router.post('/:id/repush', authMiddleware, async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const id = parseInt(req.params.id);

    const result = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT feedbackNo, rechargeDate, rechargeAmount, submitterName, submitterPhone,
               usedTicketCount, expiredTicketCount, estimatedTickets, ticketDetails,
               handlerName, handlerRemark, status
        FROM XS_ShoeFeedback WHERE id = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: '反馈记录不存在' });
    }
    const r = result.recordset[0];
    if (r.status !== 'completed') {
      return res.status(400).json({ message: '仅已完成记录可补发推送' });
    }

    // 构造补发明细摘要（与 complete 接口口径一致）
    // 支持调用方传入新明细以「修改推送的补发张数」；未传则沿用已完成时保存的明细
    let ticketSummary = '无';
    let totalTickets = 0;
    let detailCount = 0;
    const incoming = (req.body && req.body.ticketDetails) || null;
    let useDetails: { label: string; count: number }[] | null = null;
    if (Array.isArray(incoming)) {
      const valid = (incoming as any[])
        .map((t: any) => ({ label: String(t?.label ?? ''), count: Number(t?.count) || 0 }))
        .filter((t: any) => t.count > 0);
      if (valid.length > 0) useDetails = valid;
    }
    if (useDetails) {
      // 推送按新张数，并写回数据库，保证「实际补发」列与推送通知一致
      await pool.request()
        .input('id', sql.Int, id)
        .input('ticketDetails', sql.NVarChar, JSON.stringify(useDetails))
        .input('updatedAt', sql.DateTime, new Date())
        .query('UPDATE XS_ShoeFeedback SET ticketDetails = @ticketDetails, updatedAt = @updatedAt WHERE id = @id');
      ticketSummary = useDetails.map((t) => `${t.label}: ${t.count} 张`).join('\n');
      totalTickets = useDetails.reduce((sum, t) => sum + t.count, 0);
      detailCount = useDetails.length;
    } else if (r.ticketDetails) {
      try {
        const td = typeof r.ticketDetails === 'string' ? JSON.parse(r.ticketDetails) : r.ticketDetails;
        if (Array.isArray(td) && td.length > 0) {
          ticketSummary = td.map((t: any) => `${t.label}: ${t.count} 张`).join('\n');
          totalTickets = td.reduce((sum: number, t: any) => sum + (Number(t.count) || 0), 0);
          detailCount = td.length;
        }
      } catch { /* 历史脏数据忽略解析错误 */ }
    }

    const messageContent = [
      '【洗鞋反馈补发通知】',
      `反馈编号：${r.feedbackNo || ''}`,
      `会员姓名：${r.submitterName || ''}`,
      `手机号：${r.submitterPhone || ''}`,
      `充值时间：${r.rechargeDate || ''}`,
      `充值金额：${r.rechargeAmount || ''}`,
      `预估补发：${r.estimatedTickets ?? 0} 张`,
      `实际补发明细：`,
      ticketSummary,
      `合计补发：${totalTickets} 张，共 ${detailCount} 次`,
      `处理人：${r.handlerName || ''}`,
      `处理备注：${r.handlerRemark || '无'}`,
    ].join('\n');

    // 推送给韩会玲
    let pushResult: { summary: string; detail: any[] } = { summary: '推送失败', detail: [] };
    try {
      pushResult = await dispatchCustomNotification(messageContent, 'manual', {
        templateTitle: '洗鞋反馈补发通知',
        recipientOverride: [
          { name: '韩会玲', wechatAccount: 'HanHuiLing' },
        ],
      });
    } catch (pushErr: any) {
      console.error('[ShoeFeedback] 补发推送失败:', (pushErr as Error).message);
      return res.status(500).json({ message: '补发推送失败: ' + ((pushErr as Error).message || '') });
    }

    res.json({ ok: true, message: pushResult.summary, pushDetail: pushResult.detail });
  } catch (error: any) {
    res.status(500).json({ message: '补发推送失败: ' + (error.message || '') });
  }
});

export default router;
