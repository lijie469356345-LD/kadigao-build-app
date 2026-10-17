import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { ensureTable } from './dataExtraction';
import { guardLogin } from '../middlewares/authMiddleware';

const router = Router();

// GET /api/financial-no-cost-price-product — 无成本价商品清单
// SQL 从数据提取台账（DataExtraction.noCostPriceProduct）读取，改动台账后即时生效
router.get('/', guardLogin, async (_req, res) => {
  try {
    await ensureTable();
    const pool = await getPool();
    const tpl = await pool.request()
      .input('name', sql.NVarChar, 'noCostPriceProduct')
      .query('SELECT sqlQuery FROM DataExtraction WHERE fieldName = @name');
    if (tpl.recordset.length === 0) {
      return res.status(404).json({ error: '数据提取台账中未找到 noCostPriceProduct 记录' });
    }
    const query = tpl.recordset[0].sqlQuery as string;
    const result = await pool.request().query(query);
    res.json({ data: result.recordset });
  } catch (err: any) {
    console.error('[financialNoCostPrice] 查询失败:', err.message);
    res.status(500).json({ error: '查询无成本价商品数据失败', detail: err.message });
  }
});

export default router;