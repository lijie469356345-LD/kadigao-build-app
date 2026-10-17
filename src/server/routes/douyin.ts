import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { JwtUserPayload } from '../services/jwt';
import { getStandardShopFilter } from '../services/permissionService';

const router = Router();

// 按用户组应用数据级权限过滤：管理员不过滤，其他用户仅能查看其拥有权限的店铺（标准 v3 组织隔离）
async function applyPermissionFilter(request: sql.Request, pool: sql.ConnectionPool, baseQuery: string, groupName?: string, user?: JwtUserPayload | null) {
  const permission = await getStandardShopFilter(groupName, user);
  if (!permission.filter) {
    return baseQuery;
  }
  permission.params.forEach(p => { request.input(p.name, p.type, p.value); });
  return `SELECT * FROM (\n${baseQuery}\n) AS perm\nWHERE ${permission.filter}\nORDER BY perm.区经, perm.督导, perm.店铺名称`;
}

// GET /api/douyin/fudai?startDate=2026-8-10&endDate=2026-8-15 - 福袋转化报表
router.get('/fudai', async (req, res) => {
  try {
    const startDate = typeof req.query.startDate === 'string' && req.query.startDate.trim()
      ? req.query.startDate.trim()
      : '2026-8-10';
    const endDate = typeof req.query.endDate === 'string' && req.query.endDate.trim()
      ? req.query.endDate.trim()
      : new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const pool = await getPool();
    const request = pool.request();
    request.input('startDate', sql.NVarChar, startDate);
    request.input('endDate', sql.NVarChar, endDate);

    const baseQuery = `
      SELECT 区经, 仓库类别, 区域, 督导, 店铺名称,
        SUM(转化人数) as 转化人数,
        SUM(总人数) as 总人数,
        CASE WHEN SUM(总人数) > 0 THEN CAST(SUM(转化人数)*100.0/SUM(总人数) AS DECIMAL(18,2)) ELSE 0 END as 转化率,
        SUM(鞋包数量) as 鞋包数量,
        SUM(鞋包金额) as 鞋包业绩
      FROM (
        select a.*, b.鞋包数量, b.鞋包金额, b.转化人数 from (
          select 日期,督导,店铺名称,会员代码,性别,区经,仓库类别,区域, 1 总人数 from 有效业绩全
          where 会员手机 in (select 会员手机 from 用券全
            where 日期>=@startDate and 仓库类别='直营' and 券名称 like '%福袋%'
            group by 会员手机)
          and 日期>=@startDate and 日期<=@endDate and 仓库类别='直营' and 性别 in ('配饰')
          group by 日期,督导,店铺名称,会员代码,性别,区经,仓库类别,区域
          having sum(数量)>0
        ) a left join (
          select 日期,督导,店铺名称,会员代码, sum(数量) 鞋包数量, sum(业绩金额) 鞋包金额, 1 转化人数 from 有效业绩全
          where 会员手机 in (select 会员手机 from 用券全
            where 日期>=@startDate and 仓库类别='直营' and 券名称 like '%福袋%'
            group by 会员手机)
          and 日期>=@startDate and 日期<=@endDate and 仓库类别='直营' and 性别 in ('男鞋','女鞋','童鞋','包')
          group by 日期,督导,店铺名称,会员代码
          having sum(业绩金额)>0
        ) b on a.日期=b.日期 and a.店铺名称=b.店铺名称 and a.会员代码=b.会员代码
      ) t
      GROUP BY 区经, 仓库类别, 区域, 督导, 店铺名称
    `;

    const query = await applyPermissionFilter(request, pool, baseQuery, req.query.groupName as string | undefined, req.user || null);
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (e: any) {
    console.error('福袋报表查询失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/douyin/haoping?startDate=2026-8-1&endDate=2026-8-15 - 好评会员报表
router.get('/haoping', async (req, res) => {
  try {
    const startDate = typeof req.query.startDate === 'string' && req.query.startDate.trim()
      ? req.query.startDate.trim()
      : '2026-8-1';
    const endDate = typeof req.query.endDate === 'string' && req.query.endDate.trim()
      ? req.query.endDate.trim()
      : new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const pool = await getPool();
    const request = pool.request();
    request.input('startDate', sql.NVarChar, startDate);
    request.input('endDate', sql.NVarChar, endDate);

    const baseQuery = `
      SELECT CONVERT(varchar(10), 日期, 120) AS 日期, 区经, 仓库类别, 区域, 督导, 店铺名称, 会员代码, 会员手机, 1 AS 好评人数
      FROM 促销全
      WHERE 日期 >= @startDate AND 日期 <= @endDate AND 促销名称 LIKE '%好评%' AND 仓库类别 = '直营'
      GROUP BY 日期, 区经, 仓库类别, 区域, 督导, 店铺名称, 会员代码, 会员手机
    `;

    const groupName = typeof req.query.groupName === 'string' ? req.query.groupName : undefined;
    const query = await applyPermissionFilter(request, pool, baseQuery, groupName, req.user || null);
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (e: any) {
    console.error('好评会员报表查询失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET / api/douyin/wazi?startDate=2026-7-4&endDate=2026-8-15 - 袜子转化报表
router.get('/wazi', async (req, res) => {
  try {
    const startDate = typeof req.query.startDate === 'string' && req.query.startDate.trim()
      ? req.query.startDate.trim()
      : '2026-7-4';
    const endDate = typeof req.query.endDate === 'string' && req.query.endDate.trim()
      ? req.query.endDate.trim()
      : new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const pool = await getPool();
    const request = pool.request();
    request.input('startDate', sql.NVarChar, startDate);
    request.input('endDate', sql.NVarChar, endDate);

    const baseQuery = `
      SELECT 区经, 仓库类别, 区域, 督导, 店铺名称,
        SUM(转化人数) as 转化人数,
        SUM(总人数) as 总人数,
        CASE WHEN SUM(总人数) > 0 THEN CAST(SUM(转化人数)*100.0/SUM(总人数) AS DECIMAL(18,2)) ELSE 0 END as 转化率,
        SUM(鞋包数量) as 鞋包数量,
        SUM(鞋包金额) as 鞋包业绩
      FROM (
        select a.*, b.鞋包数量, b.鞋包金额, b.转化人数 from (
          select 日期,督导,店铺名称,会员代码,性别,区经,仓库类别,区域, 1 总人数 from 有效业绩全
          where 会员代码 in (select 会员代码 from 用券全
            where 日期>=@startDate and 仓库类别='直营' and 券名称='8月会员礼品券'
            group by 会员代码)
          and 日期>=@startDate and 日期<=@endDate and 仓库类别='直营' and 性别 in ('配饰')
          group by 日期,督导,店铺名称,会员代码,性别,区经,仓库类别,区域
          having sum(数量)>0
        ) a left join (
          select 日期,督导,店铺名称,会员代码, sum(数量) 鞋包数量, sum(业绩金额) 鞋包金额, 1 转化人数 from 有效业绩全
          where 会员代码 in (select 会员代码 from 用券全
            where 日期>=@startDate and 仓库类别='直营' and 券名称='8月会员礼品券'
            group by 会员代码)
          and 日期>=@startDate and 日期<=@endDate and 仓库类别='直营' and 性别 in ('男鞋','女鞋','童鞋','包')
          group by 日期,督导,店铺名称,会员代码
          having sum(业绩金额)>0
        ) b on a.日期=b.日期 and a.店铺名称=b.店铺名称 and a.会员代码=b.会员代码
      ) t
      GROUP BY 区经, 仓库类别, 区域, 督导, 店铺名称
    `;

    const groupName = typeof req.query.groupName === 'string' ? req.query.groupName : undefined;
    const query = await applyPermissionFilter(request, pool, baseQuery, groupName, req.user || null);
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (e: any) {
    console.error('袜子转化报表查询失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;