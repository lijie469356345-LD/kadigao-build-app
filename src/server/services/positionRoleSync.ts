import sql from 'mssql';

// ============================================================
// 职位 → 角色 联动服务（positionRoleSync）
// 职责：以 sys_position 为唯一映射源（position_name → role_id），
//       把「用户全.职位」的变更同步到 sys_user_role（权限绑定表），
//       使 职位表 / 用户全职位 / sys_user_role 绑定 / 权限管理角色人数 四处一致。
// 兼容 mssql 的 ConnectionPool 与 Transaction（事务内调用时传 tx）。
// ============================================================

export type QueryRunner = sql.ConnectionPool | sql.Transaction;

export interface SyncResult {
  positionName: string;
  roleId: number | null;
  orgId: number | null;
  action: 'no-position' | 'no-role' | 'exists' | 'inserted';
}

/** 按职位名查 sys_position 关联的角色 id；职位不存在或不关联角色返回 null */
export async function resolveRoleIdByPosition(runner: QueryRunner, positionName: string): Promise<number | null> {
  const name = String(positionName || '').trim();
  if (!name) return null;
  const r = await runner.request()
    .input('pn', sql.NVarChar, name)
    .query(`SELECT role_id FROM sys_position WHERE position_name = @pn AND status = 1`);
  if (r.recordset.length === 0) return null;
  const rid = r.recordset[0].role_id;
  return rid === null || rid === undefined ? null : Number(rid);
}

/** 解绑用户某角色（system_user_role 中该 user_code+role_id 的所有行） */
export async function removeRoleBinding(runner: QueryRunner, userCode: string, roleId: number): Promise<void> {
  await runner.request()
    .input('uc', sql.NVarChar, userCode)
    .input('rid', sql.Int, roleId)
    .query(`DELETE FROM sys_user_role WHERE user_code = @uc AND role_id = @rid`);
}

/** 解析用户组织（用户全.组织 → sys_org.org_id，按 org_name 精确/去空格后匹配；未匹配返回 null） */
export async function resolveOrgIdByUser(runner: QueryRunner, userCode: string): Promise<number | null> {
  const r = await runner.request()
    .input('uc', sql.NVarChar, userCode)
    .query(`
      SELECT TOP 1 o.org_id
      FROM 用户全 u
      LEFT JOIN sys_org o
        ON o.del_flag = 0
       AND (o.org_name = u.组织 OR o.org_name = REPLACE(u.组织, ' ', ''))
      WHERE u.用户代码 = @uc
      ORDER BY o.org_id
    `);
  return r.recordset.length > 0 && r.recordset[0].org_id !== null ? Number(r.recordset[0].org_id) : null;
}

/**
 * 按职位同步用户角色绑定（幂等）：
 *  - 职位不存在 / 未关联角色 → 不做任何写操作（不新增、不删除，避免误伤手工分配）
 *  - 职位关联角色 R：
 *      a) 用户已有 (user_code, role_id=R) 任意组织绑定 → 视为已生效，不重复写入
 *      b) 否则新增绑定 (user_code, role_id=R, org_id=用户组织)
 */
export async function syncUserRoleByPosition(runner: QueryRunner, userCode: string, positionName: string): Promise<SyncResult> {
  const name = String(positionName || '').trim();
  const base: SyncResult = { positionName: name, roleId: null, orgId: null, action: 'no-position' };
  if (!name) return base;

  const roleId = await resolveRoleIdByPosition(runner, name);
  if (roleId === null) return { ...base, action: 'no-role' };

  const orgId = await resolveOrgIdByUser(runner, userCode);
  base.roleId = roleId;
  base.orgId = orgId;

  const dup = await runner.request()
    .input('uc', sql.NVarChar, userCode)
    .input('rid', sql.Int, roleId)
    .query(`SELECT TOP 1 id FROM sys_user_role WHERE user_code = @uc AND role_id = @rid`);
  if (dup.recordset.length > 0) return { ...base, action: 'exists' };

  await runner.request()
    .input('uc', sql.NVarChar, userCode)
    .input('rid', sql.Int, roleId)
    .input('oid', sql.Int, orgId)
    .query(`INSERT INTO sys_user_role (user_code, role_id, org_id, create_time, update_time)
            VALUES (@uc, @rid, @oid, GETDATE(), GETDATE())`);
  return { ...base, action: 'inserted' };
}

/**
 * 职位变更联动（编辑场景）：
 *  - 新职位关联角色 R_new → 确保绑定存在（syncUserRoleByPosition）
 *  - 旧职位关联角色 R_old 且 R_old ≠ R_new → 移除该用户 R_old 绑定（角色随职位切换）
 * 返回统计信息供日志/提示。
 */
export async function applyPositionChange(runner: QueryRunner, userCode: string, oldPosition: string, newPosition: string): Promise<{ removedRoleId: number | null; sync: SyncResult }> {
  const oldRoleId = await resolveRoleIdByPosition(runner, oldPosition);
  const sync = await syncUserRoleByPosition(runner, userCode, newPosition);
  let removedRoleId: number | null = null;
  if (oldRoleId !== null && oldRoleId !== sync.roleId) {
    await removeRoleBinding(runner, userCode, oldRoleId);
    removedRoleId = oldRoleId;
  }
  return { removedRoleId, sync };
}

export interface MigrateResult {
  positionName: string;
  oldRoleId: number | null;
  newRoleId: number | null;
  usersScanned: number;
  bindingsUpdated: number;
  bindingsRemoved: number;
}

/**
 * 职位管理「关联角色」变更时的全量迁移：
 * 将该职位下所有用户（用户全.职位 = positionName）的旧角色绑定迁移为新角色绑定。
 *  - newRoleId 有值：迁移（用户有 old 绑定 → 换为 new；无 old 绑定但用户在该职位 → 补充 new 绑定）
 *  - newRoleId 为空（解除关联）：移除该职位下用户的旧角色绑定，不新增任何角色
 */
export async function migratePositionRole(runner: QueryRunner, positionName: string, oldRoleId: number | null, newRoleId: number | null): Promise<MigrateResult> {
  const name = String(positionName || '').trim();
  const base: MigrateResult = { positionName: name, oldRoleId, newRoleId, usersScanned: 0, bindingsUpdated: 0, bindingsRemoved: 0 };
  if (!name) return base;

  const users = await runner.request()
    .input('pn', sql.NVarChar, name)
    .query(`SELECT 用户代码 FROM 用户全 WHERE 职位 = @pn`);
  base.usersScanned = users.recordset.length;

  for (const row of users.recordset) {
    const userCode = String(row['用户代码'] || '').trim();
    if (!userCode) continue;
    const orgId = await resolveOrgIdByUser(runner, userCode);

    if (newRoleId !== null && newRoleId !== undefined) {
      // 迁移为 newRoleId：先解绑旧角色（若与 new 不同且用户已绑定 new 则直接删除旧行）
      const hasNew = await runner.request()
        .input('uc', sql.NVarChar, userCode)
        .input('rid', sql.Int, newRoleId)
        .query(`SELECT TOP 1 id FROM sys_user_role WHERE user_code = @uc AND role_id = @rid`);
      if (oldRoleId !== null && oldRoleId !== newRoleId) {
        await removeRoleBinding(runner, userCode, oldRoleId);
        base.bindingsRemoved++;
      }
      if (hasNew.recordset.length === 0) {
        await runner.request()
          .input('uc', sql.NVarChar, userCode)
          .input('rid', sql.Int, newRoleId)
          .input('oid', sql.Int, orgId)
          .query(`INSERT INTO sys_user_role (user_code, role_id, org_id, create_time, update_time)
                  VALUES (@uc, @rid, @oid, GETDATE(), GETDATE())`);
        base.bindingsUpdated++;
      }
    } else {
      // 解除关联：移除旧角色绑定（只删该职位映射的角色）
      if (oldRoleId !== null) {
        await removeRoleBinding(runner, userCode, oldRoleId);
        base.bindingsRemoved++;
      }
    }
  }
  return base;
}