import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { buildMergedData } from './merge';

const router = Router();

// 尺码列表
const SIZE_COLS = ['31','32','33','34','35','36','37','38','39','40','41','42','43','44','45','46'];

/**
 * 自动创建调拨记录表（如果不存在）
 */
async function ensureTransferTable() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='线上调拨记录' AND xtype='U')
    CREATE TABLE [dbo].[线上调拨记录] (
      [id] INT IDENTITY(1,1) PRIMARY KEY,
      [商品代码颜色名称] NVARCHAR(200),
      [商品代码] NVARCHAR(50),
      [颜色名称] NVARCHAR(50),
      [调出店铺] NVARCHAR(100),
      [调入店铺] NVARCHAR(100),
      [31] INT DEFAULT 0, [32] INT DEFAULT 0, [33] INT DEFAULT 0,
      [34] INT DEFAULT 0, [35] INT DEFAULT 0, [36] INT DEFAULT 0,
      [37] INT DEFAULT 0, [38] INT DEFAULT 0, [39] INT DEFAULT 0,
      [40] INT DEFAULT 0, [41] INT DEFAULT 0, [42] INT DEFAULT 0,
      [43] INT DEFAULT 0, [44] INT DEFAULT 0, [45] INT DEFAULT 0,
      [46] INT DEFAULT 0,
      [创建时间] DATETIME DEFAULT GETDATE(),
      [操作人] NVARCHAR(50),
      [备注] NVARCHAR(500)
    )
  `);
  console.log('线上调拨记录表已就绪');
}

// 模块加载时自动建表
ensureTransferTable().catch(err => console.error('建表失败:', err.message));

/**
 * POST /api/online-merge/query
 * 查询并货数据（复用初始并货表逻辑）
 */
router.post('/query', async (req, res) => {
  try {
    const { year, season } = req.body;
    const allData = await buildMergedData(year, season);
    res.json({ success: true, data: allData, total: allData.length });
  } catch (error: any) {
    console.error('线上并货查询失败:', error);
    res.status(500).json({ success: false, message: error.message || '查询失败' });
  }
});

/**
 * POST /api/online-merge/transfer
 * 批量创建调拨记录
 * Body: { transfers: [{ 商品代码颜色名称, 商品代码, 颜色名称, 调出店铺, 调入店铺, 尺码: {...}, 操作人, 备注 }] }
 */
router.post('/transfer', async (req, res) => {
  try {
    const { transfers } = req.body;
    if (!transfers || !Array.isArray(transfers) || transfers.length === 0) {
      return res.status(400).json({ success: false, message: '请提供有效的调拨数据' });
    }

    const pool = await getPool();

    // 逐条插入
    let insertedCount = 0;
    for (const t of transfers) {
      const sizeCols = SIZE_COLS.map(s => `[${s}]`).join(',');
      const sizeVals = SIZE_COLS.map(s => {
        const val = t.尺码 && t.尺码[s] !== undefined ? parseInt(t.尺码[s]) : 0;
        return val;
      });
      const sizePlaceholders = SIZE_COLS.map((s, i) => `@size${s}`);

      await pool.request()
        .input('商品代码颜色名称', sql.NVarChar(200), t.商品代码颜色名称 || '')
        .input('商品代码', sql.NVarChar(50), t.商品代码 || '')
        .input('颜色名称', sql.NVarChar(50), t.颜色名称 || '')
        .input('调出店铺', sql.NVarChar(100), t.调出店铺 || '')
        .input('调入店铺', sql.NVarChar(100), t.调入店铺 || '')
        .input('操作人', sql.NVarChar(50), t.操作人 || '')
        .input('备注', sql.NVarChar(500), t.备注 || '')
        .query(`
          INSERT INTO [dbo].[线上调拨记录]
            ([商品代码颜色名称],[商品代码],[颜色名称],[调出店铺],[调入店铺],
             [31],[32],[33],[34],[35],[36],[37],[38],[39],[40],[41],[42],[43],[44],[45],[46],
             [操作人],[备注])
          VALUES
            (@商品代码颜色名称,@商品代码,@颜色名称,@调出店铺,@调入店铺,
             ${SIZE_COLS.map(s => `@size${s}`).join(',')},
             @操作人,@备注)
        `);

      // 单独设置尺码参数（因为 mssql 的 input 不支持动态列名）
      for (let i = 0; i < SIZE_COLS.length; i++) {
        const s = SIZE_COLS[i];
        const val = t.尺码 && t.尺码[s] !== undefined ? parseInt(t.尺码[s]) : 0;
        (pool.request() as any).input(`size${s}`, sql.Int, val);
      }

      insertedCount++;
    }

    res.json({ success: true, message: `成功创建 ${insertedCount} 条调拨记录`, count: insertedCount });
  } catch (error: any) {
    console.error('创建调拨记录失败:', error);
    res.status(500).json({ success: false, message: error.message || '创建失败' });
  }
});

/**
 * POST /api/online-merge/transfer-single
 * 单条创建调拨记录（简化版，直接传所有参数）
 */
router.post('/transfer-single', async (req, res) => {
  try {
    const pool = await getPool();
    const body = req.body;

    // 构建尺码参数
    const sizeParts = SIZE_COLS.map(s => {
      const val = body[s] !== undefined ? parseInt(body[s]) : (body.尺码 && body.尺码[s] ? parseInt(body.尺码[s]) : 0);
      return val || 0;
    });

    const result = await pool.request()
      .input('商品代码颜色名称', sql.NVarChar(200), body.商品代码颜色名称 || '')
      .input('商品代码', sql.NVarChar(50), body.商品代码 || '')
      .input('颜色名称', sql.NVarChar(50), body.颜色名称 || '')
      .input('调出店铺', sql.NVarChar(100), body.调出店铺 || '')
      .input('调入店铺', sql.NVarChar(100), body.调入店铺 || '')
      .input('操作人', sql.NVarChar(50), body.操作人 || '')
      .input('备注', sql.NVarChar(500), body.备注 || '')
      .query(`
        INSERT INTO [dbo].[线上调拨记录]
          ([商品代码颜色名称],[商品代码],[颜色名称],[调出店铺],[调入店铺],
           [31],[32],[33],[34],[35],[36],[37],[38],[39],[40],[41],[42],[43],[44],[45],[46],
           [操作人],[备注])
        VALUES
          (@商品代码颜色名称,@商品代码,@颜色名称,@调出店铺,@调入店铺,
           ${sizeParts.join(',')},
           @操作人,@备注);
        SELECT SCOPE_IDENTITY() AS id;
      `);

    const newId = result.recordset?.[0]?.id;
    res.json({ success: true, data: { id: newId }, message: '调拨记录创建成功' });
  } catch (error: any) {
    console.error('创建调拨记录失败:', error);
    res.status(500).json({ success: false, message: error.message || '创建失败' });
  }
});

/**
 * GET /api/online-merge/transfers
 * 查询所有调拨记录
 */
router.get('/transfers', async (req, res) => {
  try {
    const pool = await getPool();
    const { search, page, pageSize } = req.query;

    let whereClause = '';
    if (search) {
      whereClause = `WHERE [商品代码颜色名称] LIKE '%${String(search).replace(/'/g, "''")}%' OR [调出店铺] LIKE '%${String(search).replace(/'/g, "''")}%' OR [调入店铺] LIKE '%${String(search).replace(/'/g, "''")}%'`;
    }

    // 查总数
    const countResult = await pool.request().query(
      `SELECT COUNT(*) AS total FROM [dbo].[线上调拨记录] ${whereClause}`
    );
    const total = countResult.recordset[0].total;

    // 查分页数据
    const p = parseInt(String(page)) || 1;
    const ps = parseInt(String(pageSize)) || 100;
    const offset = (p - 1) * ps;

    const result = await pool.request().query(`
      SELECT *,
        ([31]+[32]+[33]+[34]+[35]+[36]+[37]+[38]+[39]+[40]+[41]+[42]+[43]+[44]+[45]+[46]) AS 合计
      FROM [dbo].[线上调拨记录] ${whereClause}
      ORDER BY [创建时间] DESC
      OFFSET ${offset} ROWS FETCH NEXT ${ps} ROWS ONLY
    `);

    res.json({
      success: true,
      data: result.recordset || [],
      total,
      page: p,
      pageSize: ps,
    });
  } catch (error: any) {
    console.error('查询调拨记录失败:', error);
    res.status(500).json({ success: false, message: error.message || '查询失败' });
  }
});

/**
 * PUT /api/online-merge/transfer/:id
 * 修改调拨记录
 */
router.put('/transfer/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const { id } = req.params;
    const body = req.body;

    const setClauses: string[] = [];
    const fields = ['商品代码颜色名称','商品代码','颜色名称','调出店铺','调入店铺','操作人','备注',
      ...SIZE_COLS];
    for (const f of fields) {
      if (body[f] !== undefined) {
        setClauses.push(`[${f}]='${String(body[f]).replace(/'/g, "''")}'`);
      }
    }
    if (setClauses.length === 0) {
      return res.status(400).json({ success: false, message: '没有要更新的字段' });
    }

    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query(`UPDATE [dbo].[线上调拨记录] SET ${setClauses.join(',')} WHERE id=@id`);

    res.json({ success: true, message: '更新成功' });
  } catch (error: any) {
    console.error('更新调拨记录失败:', error);
    res.status(500).json({ success: false, message: error.message || '更新失败' });
  }
});

/**
 * DELETE /api/online-merge/transfer/:id
 * 删除调拨记录
 */
router.delete('/transfer/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const { id } = req.params;
    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('DELETE FROM [dbo].[线上调拨记录] WHERE id=@id');
    res.json({ success: true, message: '删除成功' });
  } catch (error: any) {
    console.error('删除调拨记录失败:', error);
    res.status(500).json({ success: false, message: error.message || '删除失败' });
  }
});

export default router;
