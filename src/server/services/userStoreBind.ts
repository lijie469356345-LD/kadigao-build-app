import sql from 'mssql';
import { getPool } from '../../config/db';

// ============================================================
// 用户全「组织」列 ↔ 角色组织绑定 同步服务
//
// 【2026-09 重构】「店铺」列已物理删除，本服务由「店铺→组织绑定」改版为：
//   - fillOrgFromRoleBindings —— 按 sys_user_role 主行绑定（user_code + MIN(id) 且 org_id 非空）
//     回填 用户全.组织 = sys_org.org_name，保证「用户全」与「用户管理」展示的组织完全一致。
//     幂等可反复执行；dryRun 预览。
//   - resolveOrgName —— 组织名/ID 归一化解析（名称含去 _ZY/_JM 后缀、去空格、店铺名/代码变体），
//     供新增/编辑/批量导入把「组织」列写入前规范为权威 org_name。
//
// 安全：只动 用户全.组织 列；不动 sys_user_role 与组织树。
// ============================================================

export interface BindStoreResult {
  ok: boolean;
  dryRun: boolean;
  /** 组织绑定与当前列值不一致、计划回填的人数 */
  bound: number;
  /** 组织列与主角色绑定一致无需改动 */
  already: number;
  /** 主角色绑定组织节点缺失/已停用（无法取得 org_name） */
  unmatched: number;
  /** 兼容字段：无新增语义，置 0 */
  inserted: number;
  details: { code: string; name: string; orgVal: string; orgId: number | null; orgName: string; action: 'update' | 'skip' }[];
  warnings: { level: 'warn' | 'info'; text: string }[];
}

/** 按 sys_user_role 主行绑定回填 用户全.组织 列（dryRun=true 只预览） */
export async function fillOrgFromRoleBindings(pool: sql.ConnectionPool, opts: { dryRun?: boolean } = {}): Promise<BindStoreResult> {
  const dryRun = opts.dryRun !== false;
  const result: BindStoreResult = { ok: true, dryRun, bound: 0, already: 0, unmatched: 0, inserted: 0, details: [], warnings: [] };

  // 1) 用户主角色绑定快照（user_code + MIN(id)，org_id 非空）+ 组织名
  const rows = await pool.request().query(`
    SELECT u.用户代码 AS code, u.用户名称 AS name, ISNULL(u.组织, '') AS org_col,
           ur.org_id, o.org_name
    FROM 用户全 u
    JOIN (
      SELECT user_code, MIN(id) AS mid
      FROM sys_user_role
      WHERE org_id IS NOT NULL
      GROUP BY user_code
    ) t ON t.user_code = u.用户代码
    JOIN sys_user_role ur ON ur.id = t.mid
    LEFT JOIN sys_org o ON o.org_id = ur.org_id AND o.del_flag = 0
    WHERE u.用户代码 IS NOT NULL AND u.用户代码 <> ''
  `);
  const updates: { code: string; orgName: string }[] = [];
  for (const r of rows.recordset) {
    const code = String(r.code).trim();
    const name = String(r.name || '').trim();
    const orgName = r.org_name ? String(r.org_name).trim() : '';
    const orgCol = String(r.org_col || '').trim();
    if (!orgName) {
      result.unmatched++;
      result.details.push({ code, name, orgVal: orgCol, orgId: r.org_id, orgName: '', action: 'skip' });
      continue;
    }
    if (orgCol === orgName) {
      result.already++;
      result.details.push({ code, name, orgVal: orgCol, orgId: r.org_id, orgName, action: 'skip' });
      continue;
    }
    updates.push({ code, orgName });
    result.bound++;
    result.details.push({ code, name, orgVal: orgCol, orgId: r.org_id, orgName, action: 'update' });
  }

  if (dryRun) {
    result.warnings.unshift({ level: 'info', text: `预览：将按角色绑定回填 ${result.bound} 人组织列，已一致跳过 ${result.already} 人，绑定组织缺失 ${result.unmatched} 人` });
    return result;
  }

  // 2) 事务回填
  if (updates.length > 0) {
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      for (const p of updates) {
        await tx.request()
          .input('code', sql.NVarChar, p.code)
          .input('org', sql.NVarChar, p.orgName)
          .query(`UPDATE 用户全 SET 组织 = @org WHERE 用户代码 = @code`);
      }
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch { /* ignore */ }
      result.ok = false;
      result.warnings.push({ level: 'warn', text: '回填失败，已回滚：' + String(e) });
      return result;
    }
  }
  result.warnings.unshift({ level: 'info', text: `执行完成：回填 ${result.bound} 人，跳过 ${result.already} 人，绑定组织缺失 ${result.unmatched} 人` });
  return result;
}

// ============================================================
// 组织名/ID 解析（supports ID, 权威名, 去 _ZY/_JM 后缀名, 去空格名, 店铺名/店铺代码）
// ============================================================

/** 把「组织」列值（组织ID 或 组织名变体）解析为权威 org_id + org_name；解析失败返回 null */
export async function resolveOrgName(pool: sql.ConnectionPool, orgVal: string): Promise<{ orgId: number; orgName: string } | null> {
  const val = String(orgVal || '').trim();
  if (!val) return null;

  const orgs = await pool.request().query(`SELECT org_id, org_name, shop_code, shop_name FROM sys_org WHERE del_flag = 0`);
  const byName = new Map<string, any>();
  for (const o of orgs.recordset) {
    const raw = String(o.org_name || '').trim();
    const stripped = raw.replace(/_(ZY|JM)$/i, '').trim();
    const variants = [raw, stripped, stripped.replace(/\s+/g, ''), String(o.shop_name || '').trim(), String(o.shop_code || '').trim()];
    for (const v of variants) if (v && !byName.has(v)) byName.set(v, o);
  }

  let hit: any = /^\d+$/.test(val) ? orgs.recordset.find((o: any) => o.org_id === Number(val)) : undefined;
  if (!hit) hit = byName.get(val) || byName.get(val.replace(/\s+/g, ''));
  if (!hit) return null;
  return { orgId: hit.org_id, orgName: String(hit.org_name || '').trim() };
}