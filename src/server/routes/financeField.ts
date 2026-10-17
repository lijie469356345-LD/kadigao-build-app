import { Router } from 'express';
import { getPool } from '../../config/db';
import { guardLogin } from '../middlewares/authMiddleware';

const router = Router();

// 财务字段维护为财务域操作：enforce=true 时必须登录
router.get('/', guardLogin, async (_req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT 商品代码, 品名, 年份, 季节, 性别, 财务性别
      FROM 商品全
      WHERE 财务性别 IS NULL
      GROUP BY 商品代码, 品名, 年份, 季节, 性别, 财务性别
    `);
    res.json({ data: result.recordset });
  } catch (err: any) {
    console.error('[financeField] 查询失败:', err.message);
    res.status(500).json({ error: '查询财务字段数据失败', detail: err.message });
  }
});

export default router;
