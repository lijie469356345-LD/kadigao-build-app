import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { getStandardShopFilter } from '../services/permissionService';
import { loadShopArchiveBaseSQL } from '../services/shopArchiveSource';

const router = Router();

router.get('/archive', async (req, res) => {
  const groupName = typeof req.query.groupName === 'string' ? req.query.groupName : undefined;

  console.log('=== 店铺档案API被调用 ===');
  console.log('groupName:', groupName);

  try {
    const pool = await getPool();

    // 基础 SQL：DataExtraction 配置（已补全必选列 + 注入仓库类别过滤），缺失时使用内置 SQL
    const baseSQL = await loadShopArchiveBaseSQL(pool);

    // 权限过滤：
    //  - 已登录（req.user 存在，前端统一携带 JWT）：一律按当前用户标准权限模型过滤，
    //    可见店铺 = 所属组织及下级组织下挂载的店铺（dataScope=3）、或仅本组织（dataScope=2）、超管=全部（dataScope=5）
    //    —— 巡店日志「目的地」等店铺下拉即以此为准，用户只能选择管辖范围内的店铺
    //  - 未登录：兼容旧调用，仅当显式传入 groupName 时按旧组名逻辑过滤，否则返回全部
    let query = baseSQL;
    const request = pool.request();
    const permissionResult = req.user
      ? await getStandardShopFilter(undefined, req.user)
      : groupName
        ? await getStandardShopFilter(groupName, null)
        : null;
    if (permissionResult && permissionResult.filter) {
      const orderIdx = query.toUpperCase().lastIndexOf('ORDER BY');
      if (orderIdx > 0) {
        query = query.substring(0, orderIdx) + ' AND ' + permissionResult.filter + ' ' + query.substring(orderIdx);
      } else {
        query += ' AND ' + permissionResult.filter;
      }
      permissionResult.params.forEach(p => request.input(p.name, p.type, p.value));
    }

    console.log('最终查询:', query);
    const result = await request.query(query);

    res.json(result.recordset.map((row: any, index: number) => ({
      id: index + 1,
      shopName: row.shopName || '',
      warehouseType: row.warehouseType || '',
      area: row.area || '',
      districtManager: row.districtManager || '',
      supervisor: row.supervisor || '',
      product: row.product || '',
      productLeader: row.productLeader || '',
      contactPerson: row.contactPerson || '',
      phone: row.phone || '',
      dealer: row.dealer || '',
      openDate: row.openDate ? new Date(row.openDate).toLocaleDateString() : '',
      monthComparable: row.monthComparable ?? '',
      yearComparable: row.yearComparable ?? '',
    })));
  } catch (error: any) {
    console.error('获取店铺档案失败:', error);
    res.status(500).json({ error: error.message });
  }
});
export default router;
