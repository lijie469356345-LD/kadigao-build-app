import sql from 'mssql';

// ============================================================
// 管理员 → 总公司组织 联动服务（adminOrgSync）
// 职责：用户全.管理员='是' 的账号必须同时持有 super_admin 角色
//       在总公司组织（sys_org.org_id=1，卡迪高总公司）的 sys_user_role
//       绑定，使店铺过滤（org_shop_bind 组织树子树聚合）获得全量视角。
//  - 仅在「设置为管理员」时自动补绑定（正向联动）；
//  - 取消管理员不回删绑定：避免误删手工配置的 super_admin 角色，
//    如需移除请在权限管理页面手动调整。
// 幂等：唯一约束 (user_code, role_id, org_id) 防重。
// ============================================================

export type QueryRunner = sql.ConnectionPool | sql.Transaction;

/** 查 super_admin 角色 id（不存在返回 null） */
export async function resolveSuperAdminRoleId(runner: QueryRunner): Promise<number | null> {
  const r = await runner.request().query(
    `SELECT TOP 1 role_id FROM sys_role WHERE role_code = 'super_admin' AND del_flag = 0`
  );
  return r.recordset.length > 0 ? Number(r.recordset[0].role_id) : null;
}

/**
 * 确保用户拥有 super_admin + 总公司(org_id=1) 绑定。
 * 返回 'inserted' | 'exists'；角色/总公司缺失时静默跳过（不阻塞保存流程）。
 */
export async function ensureAdminOrgBinding(runner: QueryRunner, userCode: string): Promise<'inserted' | 'exists'> {
  const roleId = await resolveSuperAdminRoleId(runner);
  if (roleId === null) return 'exists';

  const org = await runner.request().query(`SELECT TOP 1 org_id FROM sys_org WHERE org_id = 1 AND del_flag = 0`);
  if (org.recordset.length === 0) return 'exists';

  const dup = await runner.request()
    .input('uc', sql.NVarChar, userCode)
    .input('rid', sql.Int, roleId)
    .query(`SELECT TOP 1 id FROM sys_user_role WHERE user_code = @uc AND role_id = @rid AND org_id = 1`);
  if (dup.recordset.length > 0) return 'exists';

  try {
    await runner.request()
      .input('uc', sql.NVarChar, userCode)
      .input('rid', sql.Int, roleId)
      .query(`INSERT INTO sys_user_role (user_code, role_id, org_id, create_time, update_time)
              VALUES (@uc, @rid, 1, GETDATE(), GETDATE())`);
    return 'inserted';
  } catch (e: any) {
    // 唯一约束并发冲突（2627/2601）→ 视为已存在
    const num = String(e?.number || '');
    if (num === '2627' || num === '2601') return 'exists';
    throw e;
  }
}

/**
 * 启动补偿：扫描 用户全.管理员='是' 且缺 super_admin+org1 绑定的用户，补齐绑定。
 * 返回本次新增条数（幂等，可重复调用）。
 */
export async function backfillAdminOrgBindings(pool: sql.ConnectionPool): Promise<number> {
  const admins = await pool.request().query(`SELECT 用户代码 FROM 用户全 WHERE 管理员 = '是'`);
  let inserted = 0;
  for (const row of admins.recordset) {
    const uc = String(row['用户代码'] || '').trim();
    if (!uc) continue;
    try {
      const r = await ensureAdminOrgBinding(pool, uc);
      if (r === 'inserted') inserted++;
    } catch (e: any) {
      console.error(`[AdminOrgSync] 管理员 ${uc} 总公司绑定补偿失败:`, e.message);
    }
  }
  if (inserted > 0) console.log(`[AdminOrgSync] 管理员总公司绑定补齐 ${inserted} 人`);
  return inserted;
}