import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';

const router = Router();

// 自动建表
export async function ensureTable() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DataExtraction' AND xtype='U')
    CREATE TABLE DataExtraction (
      id INT IDENTITY(1,1) PRIMARY KEY,
      fieldName NVARCHAR(200) UNIQUE NOT NULL,
      sqlQuery NVARCHAR(MAX) NOT NULL,
      params NVARCHAR(500),
      description NVARCHAR(500),
      category NVARCHAR(100),
      createdBy NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE(),
      updatedBy NVARCHAR(100),
      updatedAt DATETIME DEFAULT GETDATE()
    )
  `);
  console.log('DataExtraction table ready');

  // 注册商品组长季节销量SQL模板
  const seasonalSQL = `SELECT 仓库类别, 性别, 店铺名称, 季节 原季节, 年份, SUM(数量) 数量,
    CASE WHEN 季节='秋冬' THEN '新冬'
         WHEN 季节='冬' THEN '新冬'
         WHEN 季节='秋' THEN '新秋'
         WHEN 季节='春' THEN '新春'
         WHEN 季节='夏' THEN '新夏'
    END 季节,
    CASE WHEN 年份 >= YEAR(GETDATE()) - 1 THEN '新品' ELSE '老品' END 新老
    FROM 有效业绩全
    WHERE 日期>=@startDate AND 日期<=@endDate AND 性别 IN ('男鞋','女鞋','童鞋','包') AND 仓库类别 IN ('直营','山东直营','加盟')
    GROUP BY 仓库类别, 性别, 店铺名称, 季节, 年份`;
  await pool.request()
    .input('name', sql.NVarChar, 'productSeasonalSales')
    .input('q', sql.NVarChar, seasonalSQL)
    .input('p', sql.NVarChar, 'startDate,endDate')
    .input('d', sql.NVarChar, '商品组长季节/性别/新老销量')
    .input('c', sql.NVarChar, '运营工作汇报')
    .query(`IF NOT EXISTS (SELECT 1 FROM DataExtraction WHERE fieldName = @name)
      INSERT INTO DataExtraction (fieldName, sqlQuery, params, description, category)
      VALUES (@name, @q, @p, @d, @c)`);

  // 注册无成本价商品SQL模板（财务年度评估）
  const noCostPriceSQL = `SELECT 商品代码, 品名, 预估成本, 年份, 季节, 性别, 风格, 款式, 大类
    FROM 价格刘全
    WHERE (预估成本=0 OR 预估成本 IS NULL) AND 年份>=YEAR(GETDATE()-1)-1`;
  await pool.request()
    .input('name', sql.NVarChar, 'noCostPriceProduct')
    .input('q', sql.NVarChar, noCostPriceSQL)
    .input('p', sql.NVarChar, '')
    .input('d', sql.NVarChar, '无成本价商品（预估成本为0或空，年份>=前年）')
    .input('c', sql.NVarChar, '财务年度评估')
    .query(`IF NOT EXISTS (SELECT 1 FROM DataExtraction WHERE fieldName = @name)
      INSERT INTO DataExtraction (fieldName, sqlQuery, params, description, category)
      VALUES (@name, @q, @p, @d, @c)`);

  // 注册加盟专用：PK日跟进 按店铺汇总SQL模板（2026-09-19 用户提供，原样入库；日期按需自行修改）
  const franchisePKDailySQL = `SELECT 店铺名称, SUM(业绩金额) as 鞋金额, SUM(数量) as 鞋数量,
  SUM(开单数) as 开单数,
  CASE WHEN SUM(数量) <> 0 THEN SUM(业绩金额)/SUM(数量) ELSE 0 END as unitPrice,
  CASE WHEN SUM(开单数) <> 0 THEN SUM(业绩金额)/SUM(开单数) ELSE 0 END as avgOrderValue,
  CASE WHEN SUM(开单数) <> 0 THEN SUM(数量)/SUM(开单数) ELSE 0 END as attachmentRate
FROM (
  SELECT 店铺名称, SUM(业绩金额) as 业绩金额, SUM(数量) as 数量,
         CASE WHEN SUM(数量)>0 THEN 1 WHEN SUM(数量)<0 THEN -1 ELSE 0 END as 开单数
  FROM 有效业绩全
  WHERE 日期='2026-9-18' AND 仓库类别 IN ('加盟')
     AND 性别 IN ('男鞋','女鞋','童鞋','包') AND 款式 <> '洞洞鞋'
  GROUP BY 店铺名称, 单据编号 HAVING SUM(数量) <> 0 
) as a
GROUP BY 店铺名称`;
  await pool.request()
    .input('name', sql.NVarChar, 'franchisePKDailySummary')
    .input('q', sql.NVarChar, franchisePKDailySQL)
    .input('p', sql.NVarChar, '')
    .input('d', sql.NVarChar, '加盟专用：PK日跟进 按店铺汇总（鞋金额/鞋数量/开单数/件单价/客单价/连带率），日期按需修改')
    .input('c', sql.NVarChar, '加盟专用')
    .query(`IF NOT EXISTS (SELECT 1 FROM DataExtraction WHERE fieldName = @name)
      INSERT INTO DataExtraction (fieldName, sqlQuery, params, description, category)
      VALUES (@name, @q, @p, @d, @c)`);
}

// GET /api/data-extraction — 列表查询（支持搜索）
router.get('/', async (req, res) => {
  const { keyword, category } = req.query;
  try {
    await ensureTable();
    const pool = await getPool();
    let query = 'SELECT * FROM DataExtraction WHERE 1=1';
    const request = pool.request();

    if (keyword && typeof keyword === 'string') {
      query += ' AND (fieldName LIKE @kw OR description LIKE @kw OR sqlQuery LIKE @kw)';
      request.input('kw', sql.NVarChar, `%${keyword}%`);
    }
    if (category && typeof category === 'string') {
      query += ' AND category = @cat';
      request.input('cat', sql.NVarChar, category);
    }
    query += ' ORDER BY category, fieldName';
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/data-extraction/categories — 获取所有分类
router.get('/categories', async (_req, res) => {
  try {
    await ensureTable();
    const pool = await getPool();
    const result = await pool.request().query(
      'SELECT DISTINCT category FROM DataExtraction WHERE category IS NOT NULL AND category <> \'\' ORDER BY category'
    );
    res.json(result.recordset.map((r: any) => r.category));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/data-extraction — 新增
router.post('/', async (req, res) => {
  const { fieldName, sqlQuery, params, description, category } = req.body;
  if (!fieldName || !sqlQuery) {
    return res.status(400).json({ error: 'fieldName 和 sqlQuery 为必填' });
  }
  try {
    await ensureTable();
    const pool = await getPool();
    // 唯一性检查
    const exist = await pool.request()
      .input('name', sql.NVarChar, fieldName)
      .query('SELECT id FROM DataExtraction WHERE fieldName = @name');
    if (exist.recordset.length > 0) {
      return res.status(409).json({ error: `字段名称 "${fieldName}" 已存在` });
    }
    const result = await pool.request()
      .input('fieldName', sql.NVarChar, fieldName)
      .input('sqlQuery', sql.NVarChar, sqlQuery)
      .input('params', sql.NVarChar, params || '')
      .input('description', sql.NVarChar, description || '')
      .input('category', sql.NVarChar, category || '')
      .input('createdBy', sql.NVarChar, req.body.createdBy || '')
      .query(`INSERT INTO DataExtraction (fieldName, sqlQuery, params, description, category, createdBy)
              OUTPUT INSERTED.* VALUES (@fieldName, @sqlQuery, @params, @description, @category, @createdBy)`);
    res.json(result.recordset[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/data-extraction/:id — 修改
router.put('/:id', async (req, res) => {
  const { fieldName, sqlQuery, params, description, category } = req.body;
  try {
    await ensureTable();
    const pool = await getPool();
    // 唯一性检查（排除自己）
    const exist = await pool.request()
      .input('name', sql.NVarChar, fieldName)
      .input('id', sql.Int, Number(req.params.id))
      .query('SELECT id FROM DataExtraction WHERE fieldName = @name AND id <> @id');
    if (exist.recordset.length > 0) {
      return res.status(409).json({ error: `字段名称 "${fieldName}" 已存在` });
    }
    const result = await pool.request()
      .input('id', sql.Int, Number(req.params.id))
      .input('fieldName', sql.NVarChar, fieldName)
      .input('sqlQuery', sql.NVarChar, sqlQuery)
      .input('params', sql.NVarChar, params || '')
      .input('description', sql.NVarChar, description || '')
      .input('category', sql.NVarChar, category || '')
      .input('updatedBy', sql.NVarChar, req.body.updatedBy || '')
      .query(`UPDATE DataExtraction SET fieldName=@fieldName, sqlQuery=@sqlQuery, params=@params,
                description=@description, category=@category, updatedBy=@updatedBy, updatedAt=GETDATE()
              OUTPUT INSERTED.* WHERE id=@id`);
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: '记录不存在' });
    }
    res.json(result.recordset[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/data-extraction/:id — 删除
router.delete('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, Number(req.params.id))
      .query('DELETE FROM DataExtraction WHERE id=@id');
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/data-extraction/by-name/:fieldName — 按字段名取 SQL（供报表调用）
router.get('/by-name/:fieldName', async (req, res) => {
  try {
    await ensureTable();
    const pool = await getPool();
    const result = await pool.request()
      .input('name', sql.NVarChar, req.params.fieldName)
      .query('SELECT * FROM DataExtraction WHERE fieldName = @name');
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: '未找到该字段' });
    }
    res.json(result.recordset[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/data-extraction/execute/:fieldName — 执行指定字段的SQL并返回结果
router.get('/execute/:fieldName', async (req, res) => {
  try {
    await ensureTable();
    const pool = await getPool();
    const result = await pool.request()
      .input('name', sql.NVarChar, req.params.fieldName)
      .query('SELECT sqlQuery FROM DataExtraction WHERE fieldName = @name');
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: '未找到该字段' });
    }
    let query = result.recordset[0].sqlQuery as string;
    const params = req.query as Record<string, string>;
    for (const [key, value] of Object.entries(params)) {
      query = query.replace(new RegExp('@' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-zA-Z0-9_])', 'g'), value);
    }
    const execResult = await pool.request().query(query);
    res.json(execResult.recordset);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
