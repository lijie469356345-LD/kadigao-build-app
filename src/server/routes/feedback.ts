import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { guardHighRiskWrite, guardLogin } from '../middlewares/authMiddleware';

const router = Router();

// 任务单管理为管理域：enforce=true 时强制登录；创建/修改/删除/执行需特权身份
// 明细表（details）为手机端匿名业务（员工扫码填写），保持公开访问

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function genTaskNo(): string {
  const d = new Date();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `RW${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${rand}`;
}
function genDetailNo(): string {
  const d = new Date();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `RD${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${rand}`;
}

async function ensureTables(pool: sql.ConnectionPool) {
  try {
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'FeedbackTasks')
      BEGIN
        CREATE TABLE FeedbackTasks (
          id INT IDENTITY(1,1) PRIMARY KEY,
          taskNo NVARCHAR(50) NOT NULL,
          title NVARCHAR(200) NOT NULL,
          remark NVARCHAR(MAX),
          startTime DATE,
          endTime DATE,
          items NVARCHAR(MAX),
          status NVARCHAR(20) DEFAULT 'draft',
          hideDefaultDetail INT DEFAULT 0,
          createdBy NVARCHAR(100),
          createdByName NVARCHAR(100),
          createdAt DATETIME DEFAULT GETDATE(),
          updatedAt DATETIME DEFAULT GETDATE()
        )
      END
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'FeedbackDetails')
      BEGIN
        CREATE TABLE FeedbackDetails (
          id INT IDENTITY(1,1) PRIMARY KEY,
          detailNo NVARCHAR(50) NOT NULL,
          taskId INT NOT NULL,
          taskNo NVARCHAR(50),
          taskTitle NVARCHAR(200),
          userName NVARCHAR(100),
          shopName NVARCHAR(200),
          phone NVARCHAR(50),
          answers NVARCHAR(MAX),
          signature NVARCHAR(MAX),
          remark NVARCHAR(MAX),
          isDefault INT DEFAULT 0,
          status NVARCHAR(20) DEFAULT 'draft',
          startTime DATE,
          endTime DATE,
          createdAt DATETIME DEFAULT GETDATE(),
          updatedAt DATETIME DEFAULT GETDATE()
        )
      END
    `);

    // 兼容老表：如果存在旧字段需要补齐
    try {
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeedbackTasks') AND name = 'hideDefaultDetail')
        ALTER TABLE FeedbackTasks ADD hideDefaultDetail INT DEFAULT 0
      `);
    } catch (_e) { /* ignore */ }
    try {
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeedbackDetails') AND name = 'detailNo')
        ALTER TABLE FeedbackDetails ADD detailNo NVARCHAR(50)
      `);
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeedbackDetails') AND name = 'shopName')
        ALTER TABLE FeedbackDetails ADD shopName NVARCHAR(200)
      `);
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeedbackDetails') AND name = 'phone')
        ALTER TABLE FeedbackDetails ADD phone NVARCHAR(50)
      `);
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('FeedbackDetails') AND name = 'isDefault')
        ALTER TABLE FeedbackDetails ADD isDefault INT DEFAULT 0
      `);
    } catch (_e) { /* ignore */ }
  } catch (err) {
    console.log('feedback tables setup error:', (err as Error).message);
  }
}

function normalizeTask(row: any) {
  let items: any[] = [];
  if (row.items) {
    try { items = JSON.parse(row.items); } catch (_e) { items = []; }
  }
  return {
    id: row.id,
    taskNo: row.taskNo,
    title: row.title,
    remark: row.remark || '',
    startTime: row.startTime ? new Date(row.startTime).toISOString().split('T')[0] : '',
    endTime: row.endTime ? new Date(row.endTime).toISOString().split('T')[0] : '',
    items,
    status: row.status || 'draft',
    hideDefaultDetail: !!row.hideDefaultDetail,
    createdBy: row.createdBy || '',
    createdByName: row.createdByName || '',
    createdAt: row.createdAt ? new Date(row.createdAt).toLocaleString() : '',
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '',
  };
}
function normalizeDetail(row: any) {
  let answers: any[] = [];
  if (row.answers) {
    try { answers = JSON.parse(row.answers); } catch (_e) { answers = []; }
  }
  return {
    id: row.id,
    detailNo: row.detailNo || '',
    taskId: row.taskId,
    taskNo: row.taskNo || '',
    taskTitle: row.taskTitle || '',
    userName: row.userName || '',
    shopName: row.shopName || '',
    phone: row.phone || '',
    answers,
    signature: row.signature || '',
    remark: row.remark || '',
    isDefault: !!row.isDefault,
    status: row.status || 'draft',
    startTime: row.startTime ? new Date(row.startTime).toISOString().split('T')[0] : '',
    endTime: row.endTime ? new Date(row.endTime).toISOString().split('T')[0] : '',
    createdAt: row.createdAt ? new Date(row.createdAt).toLocaleString() : '',
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '',
  };
}

// ============ 任务单（管理域） ============
router.get('/tasks', guardLogin, async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const result = await pool.request().query(`
      SELECT * FROM FeedbackTasks ORDER BY createdAt DESC
    `);
    res.json(result.recordset.map(normalizeTask));
  } catch (error: any) {
    console.error('tasks list error:', error.message);
    res.status(500).json({ message: '获取任务单失败', error: error.message });
  }
});

router.get('/tasks/:id', guardLogin, async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const result = await pool.request()
      .input('id', sql.Int, parseInt(req.params.id))
      .query('SELECT * FROM FeedbackTasks WHERE id = @id');
    if (result.recordset.length === 0) {
      return res.status(404).json({ message: '任务单不存在' });
    }
    res.json(normalizeTask(result.recordset[0]));
  } catch (error: any) {
    console.error('task detail error:', error.message);
    res.status(500).json({ message: '获取任务单失败', error: error.message });
  }
});

router.post('/tasks', guardHighRiskWrite, async (req, res) => {
  const { title, remark, startTime, endTime, items, createdBy, createdByName } = req.body;
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const taskNo = genTaskNo();
    const result = await pool.request()
      .input('taskNo', sql.NVarChar, taskNo)
      .input('title', sql.NVarChar, title || '')
      .input('remark', sql.NVarChar, remark || '')
      .input('startTime', sql.Date, startTime ? new Date(startTime) : null)
      .input('endTime', sql.Date, endTime ? new Date(endTime) : null)
      .input('items', sql.NVarChar, JSON.stringify(items || []))
      .input('status', sql.NVarChar, 'draft')
      .input('hideDefaultDetail', sql.Int, 0)
      .input('createdBy', sql.NVarChar, createdBy || '')
      .input('createdByName', sql.NVarChar, createdByName || '')
      .query(`
        INSERT INTO FeedbackTasks (taskNo, title, remark, startTime, endTime, items, status, hideDefaultDetail, createdBy, createdByName, createdAt, updatedAt)
        OUTPUT INSERTED.*
        VALUES (@taskNo, @title, @remark, @startTime, @endTime, @items, @status, @hideDefaultDetail, @createdBy, @createdByName, GETDATE(), GETDATE())
      `);
    res.status(201).json(normalizeTask(result.recordset[0]));
  } catch (error: any) {
    console.error('create task error:', error.message);
    res.status(500).json({ message: '创建任务单失败', error: error.message });
  }
});

router.put('/tasks/:id', guardHighRiskWrite, async (req, res) => {
  const { id } = req.params;
  const { title, remark, startTime, endTime, items, status, hideDefaultDetail } = req.body;
  try {
    const pool = await getPool();
    await ensureTables(pool);

    // 保护：已 submitted 的任务单不能修改（但是管理员可以关闭或更改状态）
    const current = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT status FROM FeedbackTasks WHERE id = @id');
    if (current.recordset.length === 0) {
      return res.status(404).json({ message: '任务单不存在' });
    }

    const result = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .input('title', sql.NVarChar, title || '')
      .input('remark', sql.NVarChar, remark || '')
      .input('startTime', sql.Date, startTime ? new Date(startTime) : null)
      .input('endTime', sql.Date, endTime ? new Date(endTime) : null)
      .input('items', sql.NVarChar, JSON.stringify(items || []))
      .input('status', sql.NVarChar, status || 'draft')
      .input('hideDefaultDetail', sql.Int, hideDefaultDetail ? 1 : 0)
      .input('updatedAt', sql.DateTime, new Date())
      .query(`
        UPDATE FeedbackTasks
        SET title = @title, remark = @remark, startTime = @startTime, endTime = @endTime,
            items = @items, status = @status, hideDefaultDetail = @hideDefaultDetail, updatedAt = @updatedAt
        OUTPUT INSERTED.*
        WHERE id = @id
      `);
    res.json(normalizeTask(result.recordset[0]));
  } catch (error: any) {
    console.error('update task error:', error.message);
    res.status(500).json({ message: '更新任务单失败', error: error.message });
  }
});

router.delete('/tasks/:id', guardHighRiskWrite, async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    // 同时清理明细表
    await pool.request().input('id', sql.Int, parseInt(req.params.id))
      .query('DELETE FROM FeedbackDetails WHERE taskId = @id');
    await pool.request().input('id', sql.Int, parseInt(req.params.id))
      .query('DELETE FROM FeedbackTasks WHERE id = @id');
    res.json({ message: '删除成功' });
  } catch (error: any) {
    console.error('delete task error:', error.message);
    res.status(500).json({ message: '删除任务单失败', error: error.message });
  }
});

// 执行任务单 -> 生成默认反馈表
router.post('/tasks/:id/execute', guardHighRiskWrite, async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const id = parseInt(req.params.id);

    const taskRes = await pool.request().input('id', sql.Int, id)
      .query('SELECT * FROM FeedbackTasks WHERE id = @id');
    if (taskRes.recordset.length === 0) {
      return res.status(404).json({ message: '任务单不存在' });
    }
    const task = normalizeTask(taskRes.recordset[0]);

    // 检查是否已存在默认反馈表
    const existingRes = await pool.request().input('taskId', sql.Int, id)
      .input('isDefault', sql.Int, 1)
      .query('SELECT * FROM FeedbackDetails WHERE taskId = @taskId AND isDefault = @isDefault');
    if (existingRes.recordset.length > 0) {
      // 已存在默认反馈表：只改任务状态
      await pool.request().input('id', sql.Int, id)
        .input('status', sql.NVarChar, 'running')
        .input('updatedAt', sql.DateTime, new Date())
        .query('UPDATE FeedbackTasks SET status = @status, updatedAt = @updatedAt WHERE id = @id');
      return res.json({ message: '任务已执行（默认反馈表已存在）', detail: normalizeDetail(existingRes.recordset[0]) });
    }

    const defaultAnswers = (task.items || []).map((it: any) => ({
      itemId: it.id,
      question: it.question,
      answer: it.requiredAnswer || '',
    }));

    const insertRes = await pool.request()
      .input('detailNo', sql.NVarChar, genDetailNo())
      .input('taskId', sql.Int, id)
      .input('taskNo', sql.NVarChar, task.taskNo)
      .input('taskTitle', sql.NVarChar, task.title)
      .input('userName', sql.NVarChar, '(默认反馈表)')
      .input('shopName', sql.NVarChar, '')
      .input('phone', sql.NVarChar, '')
      .input('answers', sql.NVarChar, JSON.stringify(defaultAnswers))
      .input('signature', sql.NVarChar, '')
      .input('remark', sql.NVarChar, '系统默认反馈表 - 用于员工参考')
      .input('isDefault', sql.Int, 1)
      .input('status', sql.NVarChar, 'submitted')
      .input('startTime', sql.Date, task.startTime ? new Date(task.startTime) : null)
      .input('endTime', sql.Date, task.endTime ? new Date(task.endTime) : null)
      .query(`
        INSERT INTO FeedbackDetails (detailNo, taskId, taskNo, taskTitle, userName, shopName, phone, answers, signature, remark, isDefault, status, startTime, endTime, createdAt, updatedAt)
        OUTPUT INSERTED.*
        VALUES (@detailNo, @taskId, @taskNo, @taskTitle, @userName, @shopName, @phone, @answers, @signature, @remark, @isDefault, @status, @startTime, @endTime, GETDATE(), GETDATE())
      `);

    await pool.request().input('id', sql.Int, id)
      .input('status', sql.NVarChar, 'running')
      .input('updatedAt', sql.DateTime, new Date())
      .query('UPDATE FeedbackTasks SET status = @status, updatedAt = @updatedAt WHERE id = @id');

    res.json({ message: '执行成功，已生成默认反馈表', detail: normalizeDetail(insertRes.recordset[0]) });
  } catch (error: any) {
    console.error('execute task error:', error.message);
    res.status(500).json({ message: '执行失败', error: error.message });
  }
});

// ============ 明细表（含匿名访问） ============
router.get('/details', async (req, res) => {
  const { taskId, hideExpired } = req.query;
  try {
    const pool = await getPool();
    await ensureTables(pool);

    // 先拉取任务单：用于判断是否过期
    let taskFilter: any[] = [];
    const tasksRes = await pool.request().query('SELECT id, endTime, status FROM FeedbackTasks');
    const taskMap: Record<number, any> = {};
    tasksRes.recordset.forEach((r: any) => { taskMap[r.id] = r; });

    let query = 'SELECT * FROM FeedbackDetails';
    let params: { name: string; type: any; value: any }[] = [];
    let clauses: string[] = [];
    if (taskId) {
      clauses.push('taskId = @taskId');
      params.push({ name: 'taskId', type: sql.Int, value: parseInt(taskId as string) });
    }
    if (clauses.length > 0) {
      query += ' WHERE ' + clauses.join(' AND ');
    }
    query += ' ORDER BY createdAt DESC';

    const req2 = pool.request();
    params.forEach(p => req2.input(p.name, p.type, p.value));
    const result = await req2.query(query);

    // 过滤：截止时间之后的任务，对应的明细不对外展示（前端可按 hideExpired 自行处理）
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const rows = result.recordset.map(normalizeDetail).map((d: any) => {
      const t = taskMap[d.taskId];
      let expired = false;
      if (t && t.endTime) {
        const end = new Date(t.endTime); end.setHours(23, 59, 59, 999);
        if (today.getTime() > end.getTime()) expired = true;
      }
      return { ...d, expired };
    });

    if (hideExpired === '1' || hideExpired === 'true') {
      res.json(rows.filter((d: any) => !d.expired));
    } else {
      res.json(rows);
    }
  } catch (error: any) {
    console.error('details list error:', error.message);
    res.status(500).json({ message: '获取反馈明细失败', error: error.message });
  }
});

router.get('/details/:id', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const result = await pool.request()
      .input('id', sql.Int, parseInt(req.params.id))
      .query('SELECT * FROM FeedbackDetails WHERE id = @id');
    if (result.recordset.length === 0) return res.status(404).json({ message: '明细不存在' });
    res.json(normalizeDetail(result.recordset[0]));
  } catch (error: any) {
    res.status(500).json({ message: '获取明细失败', error: error.message });
  }
});

// 生成默认反馈表（点击"我要反馈"的第一步），不提交，状态为 draft
router.post('/details/generate', async (req, res) => {
  const { taskId, userName, shopName, phone } = req.body;
  try {
    const pool = await getPool();
    await ensureTables(pool);
    if (!taskId) return res.status(400).json({ message: '缺少任务单ID' });

    const taskRes = await pool.request().input('id', sql.Int, parseInt(taskId))
      .query('SELECT * FROM FeedbackTasks WHERE id = @id');
    if (taskRes.recordset.length === 0) return res.status(404).json({ message: '任务单不存在' });
    const task = normalizeTask(taskRes.recordset[0]);

    const answers = (task.items || []).map((it: any) => ({
      itemId: it.id, question: it.question, answer: '',
    }));

    const insertRes = await pool.request()
      .input('detailNo', sql.NVarChar, genDetailNo())
      .input('taskId', sql.Int, parseInt(taskId))
      .input('taskNo', sql.NVarChar, task.taskNo)
      .input('taskTitle', sql.NVarChar, task.title)
      .input('userName', sql.NVarChar, userName || '')
      .input('shopName', sql.NVarChar, shopName || '')
      .input('phone', sql.NVarChar, phone || '')
      .input('answers', sql.NVarChar, JSON.stringify(answers))
      .input('signature', sql.NVarChar, '')
      .input('remark', sql.NVarChar, '')
      .input('isDefault', sql.Int, 0)
      .input('status', sql.NVarChar, 'draft')
      .input('startTime', sql.Date, task.startTime ? new Date(task.startTime) : null)
      .input('endTime', sql.Date, task.endTime ? new Date(task.endTime) : null)
      .query(`
        INSERT INTO FeedbackDetails (detailNo, taskId, taskNo, taskTitle, userName, shopName, phone, answers, signature, remark, isDefault, status, startTime, endTime, createdAt, updatedAt)
        OUTPUT INSERTED.*
        VALUES (@detailNo, @taskId, @taskNo, @taskTitle, @userName, @shopName, @phone, @answers, @signature, @remark, @isDefault, @status, @startTime, @endTime, GETDATE(), GETDATE())
      `);
    res.status(201).json(normalizeDetail(insertRes.recordset[0]));
  } catch (error: any) {
    console.error('generate detail error:', error.message);
    res.status(500).json({ message: '生成默认反馈表失败', error: error.message });
  }
});

// 更新草稿明细（只允许 status=draft 的明细更新）
router.put('/details/:id', async (req, res) => {
  const { userName, shopName, phone, answers, remark } = req.body;
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const id = parseInt(req.params.id);

    const current = await pool.request().input('id', sql.Int, id)
      .query('SELECT * FROM FeedbackDetails WHERE id = @id');
    if (current.recordset.length === 0) return res.status(404).json({ message: '明细不存在' });
    if (current.recordset[0].status === 'submitted') {
      return res.status(409).json({ message: '签字提交后不允许再修改' });
    }

    const result = await pool.request()
      .input('id', sql.Int, id)
      .input('userName', sql.NVarChar, userName || '')
      .input('shopName', sql.NVarChar, shopName || '')
      .input('phone', sql.NVarChar, phone || '')
      .input('answers', sql.NVarChar, JSON.stringify(answers || []))
      .input('remark', sql.NVarChar, remark || '')
      .input('updatedAt', sql.DateTime, new Date())
      .query(`
        UPDATE FeedbackDetails
        SET userName = @userName, shopName = @shopName, phone = @phone,
            answers = @answers, remark = @remark, updatedAt = @updatedAt
        OUTPUT INSERTED.*
        WHERE id = @id
      `);
    res.json(normalizeDetail(result.recordset[0]));
  } catch (error: any) {
    res.status(500).json({ message: '更新明细失败', error: error.message });
  }
});

// 提交：要求签字 + 所有问题有答案；提交后状态变为 submitted，不允许再改
router.post('/details/:id/submit', async (req, res) => {
  const { signature, userName, shopName, phone, answers, remark } = req.body;
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const id = parseInt(req.params.id);

    const current = await pool.request().input('id', sql.Int, id)
      .query('SELECT * FROM FeedbackDetails WHERE id = @id');
    if (current.recordset.length === 0) return res.status(404).json({ message: '明细不存在' });
    if (current.recordset[0].status === 'submitted') {
      return res.status(409).json({ message: '该反馈已签字提交，不可重复提交' });
    }

    const parsedAnswers: any[] = Array.isArray(answers) && answers.length > 0 ? answers :
      (current.recordset[0].answers ? JSON.parse(current.recordset[0].answers) : []);
    for (const a of parsedAnswers) {
      if (!a.answer || !String(a.answer).trim()) {
        return res.status(400).json({ message: '每个问题的反馈必填' });
      }
    }
    if (!signature || !String(signature).trim()) {
      return res.status(400).json({ message: '必须签字后才能提交' });
    }
    if (!userName || !shopName || !phone) {
      return res.status(400).json({ message: '用户、所属店铺、手机号必填' });
    }

    const result = await pool.request()
      .input('id', sql.Int, id)
      .input('userName', sql.NVarChar, userName)
      .input('shopName', sql.NVarChar, shopName)
      .input('phone', sql.NVarChar, phone)
      .input('answers', sql.NVarChar, JSON.stringify(parsedAnswers))
      .input('signature', sql.NVarChar, signature)
      .input('remark', sql.NVarChar, remark || '')
      .input('status', sql.NVarChar, 'submitted')
      .input('updatedAt', sql.DateTime, new Date())
      .query(`
        UPDATE FeedbackDetails
        SET userName = @userName, shopName = @shopName, phone = @phone,
            answers = @answers, signature = @signature, remark = @remark,
            status = @status, updatedAt = @updatedAt
        OUTPUT INSERTED.*
        WHERE id = @id
      `);
    res.json(normalizeDetail(result.recordset[0]));
  } catch (error: any) {
    console.error('submit detail error:', error.message);
    res.status(500).json({ message: '提交失败', error: error.message });
  }
});

router.delete('/details/:id', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const id = parseInt(req.params.id);
    const existing = await pool.request().input('id', sql.Int, id)
      .query('SELECT id, status FROM FeedbackDetails WHERE id = @id');
    if (!existing.recordset || existing.recordset.length === 0) {
      return res.status(404).json({ message: '反馈明细不存在' });
    }
    if (existing.recordset[0].status === 'submitted') {
      return res.status(400).json({ message: '已提交的反馈明细不允许删除' });
    }
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM FeedbackDetails WHERE id = @id');
    res.json({ message: '删除成功' });
  } catch (error: any) {
    res.status(500).json({ message: '删除明细失败', error: error.message });
  }
});

export default router;
