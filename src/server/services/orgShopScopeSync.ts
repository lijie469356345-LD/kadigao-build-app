// ============================================================
// 店铺范围初始化/同步（org_shop_bind）
// 用途：组织框架（sys_org 树）只承载管理层级（管理/审批/任务下发）；
//       查看权限（销售/报表/日志等按店铺过滤页面）由「店铺范围」独立决定。
//       本服务把组织树当前的直属挂载店铺固化为店铺范围绑定，保证
//       切换后可见性与现状（scope=3 子树推导）等价，且后续可重复执行。
// 幂等：按 (org_id, shop_code) 主键判重，只增不改不删；组织架构新增店铺后
//       再次执行本服务即可补齐店铺范围，不会覆盖/删除人工调整的绑定。
// 模式：dryRun=true 只计算计划返回；dryRun=false 落库。
// ============================================================
import sql from 'mssql';

export interface ShopScopeSyncResult {
  ok: boolean;
  dryRun: boolean;
  directPlanned: number;   // 非 shop 组织直属 shop 子级（树挂载）计划绑定条数
  selfPlanned: number;     // shop 组织绑定自身 计划条数
  directInserted: number;  // 实际新增（直属挂载）
  selfInserted: number;    // 实际新增（shop 自身）
  skipped: number;         // 已存在跳过
  warnings: string[];
}

/** 将组织树直属挂载店铺固化/补齐为店铺范围绑定（幂等） */
export async function syncShopScopeFromTree(pool: sql.ConnectionPool, opts: {
  dryRun?: boolean;
} = {}): Promise<ShopScopeSyncResult> {
  const dryRun = !!opts.dryRun;
  const result: ShopScopeSyncResult = {
    ok: false, dryRun,
    directPlanned: 0, selfPlanned: 0,
    directInserted: 0, selfInserted: 0,
    skipped: 0, warnings: [],
  };

  try {
    // ---------- 1) 非 shop 组织 → 直属 shop 子级（树挂载店铺固化为店铺范围） ----------
    // 通过主键 (org_id, shop_code) 天然幂等
    const directSQL = `
      INSERT INTO org_shop_bind (org_id, shop_code, shop_name)
      SELECT p.org_id, s.shop_code, s.shop_name
      FROM sys_org p
      JOIN sys_org s ON s.parent_org_id = p.org_id
                    AND s.org_type = 'shop' AND s.shop_code IS NOT NULL
                    AND s.del_flag = 0
      WHERE p.del_flag = 0 AND p.org_type <> 'shop'
      `;

    if (dryRun) {
      const cnt = await pool.request().query(`
        SELECT COUNT(*) AS n
        FROM sys_org p
        JOIN sys_org s ON s.parent_org_id = p.org_id
                      AND s.org_type = 'shop' AND s.shop_code IS NOT NULL
                      AND s.del_flag = 0
        WHERE p.del_flag = 0 AND p.org_type <> 'shop'`);
      result.directPlanned = cnt.recordset[0]?.n || 0;
    } else {
      const r = await pool.request().query(directSQL);
      result.directInserted = r.rowsAffected[0] || 0;
    }

    // ---------- 2) shop 组织绑定自身（店长/店员所属组织，保证其自身店铺可见） ----------
    const selfSQL = `
      INSERT INTO org_shop_bind (org_id, shop_code, shop_name)
      SELECT org_id, shop_code, shop_name
      FROM sys_org
      WHERE org_type = 'shop' AND del_flag = 0
        AND shop_code IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM org_shop_bind b
          WHERE b.org_id = sys_org.org_id AND b.shop_code = sys_org.shop_code
        )
      `;

    if (dryRun) {
      const cnt = await pool.request().query(`
        SELECT COUNT(*) AS n FROM sys_org
        WHERE org_type = 'shop' AND del_flag = 0 AND shop_code IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM org_shop_bind b
            WHERE b.org_id = sys_org.org_id AND b.shop_code = sys_org.shop_code
          )`);
      result.selfPlanned = cnt.recordset[0]?.n || 0;
    } else {
      const r = await pool.request().query(selfSQL);
      result.selfInserted = r.rowsAffected[0] || 0;
    }

    // ---------- 3) 统计当前总绑定数（信息） ----------
    const total = await pool.request().query(`SELECT COUNT(*) AS n FROM org_shop_bind`);
    result.ok = true;
    result.warnings.unshift(
      dryRun
        ? `预览：将固化直属挂载店铺 ${result.directPlanned} 条、shop 自身 ${result.selfPlanned} 条；当前 org_shop_bind 共 ${total.recordset[0]?.n || 0} 条`
        : `执行完成：新增直属挂载店铺绑定 ${result.directInserted} 条、shop 自身绑定 ${result.selfInserted} 条；当前 org_shop_bind 共 ${total.recordset[0]?.n || 0} 条；仅新增不改不删，人工调整的绑定不受影响`
    );
    return result;
  } catch (err) {
    result.ok = false;
    result.warnings.push('店铺范围同步失败：' + String(err));
    return result;
  }
}