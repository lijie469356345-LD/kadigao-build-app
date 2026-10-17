// ============================================================
// 权限管理导出服务（角色与菜单授权 / 用户角色分配）
// 与 orgImportExport.ts 同风格：mssql 查询 → XLSX buffer → 路由以附件流返回
// 数据口径与 /api/admin-perm 下对应列表接口保持一致
// ============================================================
import sql from 'mssql';
import * as XLSX from 'xlsx';
import { PORTAL_MENU_ENTRIES } from './portalRegistry';

const DATA_SCOPE_LABELS: Record<number, string> = {
  1: '本人数据',
  2: '本组织',
  3: '本组织及下级',
  4: '指定组织',
  5: '全局数据',
};

const now = (): string => new Date().toISOString().slice(0, 10);

/** 门户/菜单中文名映射（与权限管理菜单目录一致的单一数据源） */
const MENU_CN_MAP = new Map<string, { masterPortalCn: string; portalCn: string; menuCn: string }>();
for (const e of PORTAL_MENU_ENTRIES) {
  MENU_CN_MAP.set(`${e.portalEn}::${e.menuEn}`, { masterPortalCn: e.masterPortalCn || '', portalCn: e.portalCn, menuCn: e.menuCn });
}

// ---------------- 角色与菜单授权 ----------------
export async function exportPermRolesToXlsx(pool: sql.ConnectionPool): Promise<{ filename: string; buffer: Buffer; rowCount: number }> {
  const rolesR = await pool.request().query(`
    SELECT role_id, role_name, role_code, default_data_scope, status,
           (SELECT COUNT(*) FROM sys_user_role ur WHERE ur.role_id = r.role_id) AS userCount,
           (SELECT COUNT(*) FROM sys_role_menu rm WHERE rm.role_id = r.role_id) AS menuCount
    FROM sys_role r WHERE del_flag = 0 ORDER BY role_id
  `);
  const roles = rolesR.recordset;

  const grantsR = await pool.request().query(`
    SELECT rm.role_id, r.role_name, rm.portal_en, rm.menu_en
    FROM sys_role_menu rm
    LEFT JOIN sys_role r ON rm.role_id = r.role_id AND r.del_flag = 0
    ORDER BY r.role_id, rm.portal_en, rm.menu_en
  `);
  const grants = grantsR.recordset;

  const roleSheet = [
    ['角色ID', '角色名称', '角色编码', '默认数据范围', '状态', '用户数', '菜单数'],
    ...roles.map(x => [
      x.role_id, x.role_name ?? '', x.role_code ?? '',
      DATA_SCOPE_LABELS[x.default_data_scope] ?? String(x.default_data_scope ?? ''),
      x.status === 0 ? '停用' : '启用', x.userCount, x.menuCount,
    ]),
  ];
  const grantSheet = [
    ['角色ID', '角色名称', '主门户', '门户(EN)', '门户名称', '菜单(EN)', '菜单名称'],
    ...grants.map(g => {
      const meta = MENU_CN_MAP.get(`${g.portal_en}::${g.menu_en}`);
      return [
        g.role_id, g.role_name ?? '', meta?.masterPortalCn ?? '', g.portal_en ?? '', meta?.portalCn ?? '',
        g.menu_en ?? '', meta?.menuCn ?? '',
      ];
    }),
  ];

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet(roleSheet);
  ws1['!cols'] = [{ wch: 8 }, { wch: 24 }, { wch: 18 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws1, '角色列表');
  const ws2 = XLSX.utils.aoa_to_sheet(grantSheet);
  ws2['!cols'] = [{ wch: 8 }, { wch: 24 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 22 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, ws2, '角色菜单授权');

  return {
    filename: `权限管理-角色与菜单授权_${now()}.xlsx`,
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    rowCount: roles.length,
  };
}

// ---------------- 用户角色分配（与 GET /admin-perm/users 同口径，支持 kw 过滤） ----------------
export async function exportPermUsersToXlsx(pool: sql.ConnectionPool, kw: string): Promise<{ filename: string; buffer: Buffer; rowCount: number }> {
  const k = String(kw || '').trim();
  const r = await pool.request().input('kw', sql.NVarChar, `%${k}%`)
    .query(`
      SELECT 用户代码, 用户名称, 手机号, 仓库类别, 管理员
      FROM 用户全
      WHERE (@kw = '%%' OR 用户代码 LIKE @kw OR 用户名称 LIKE @kw OR 手机号 LIKE @kw
             OR EXISTS (
               SELECT 1
               FROM sys_user_role ur2
               LEFT JOIN sys_role r2 ON ur2.role_id = r2.role_id AND r2.del_flag = 0
               LEFT JOIN sys_org o2 ON ur2.org_id = o2.org_id AND o2.del_flag = 0
               WHERE ur2.user_code = 用户全.用户代码
                 AND (r2.role_name LIKE @kw OR r2.role_code LIKE @kw OR o2.org_name LIKE @kw
                      OR CAST(COALESCE(ur2.data_scope, r2.default_data_scope) AS NVARCHAR(10)) LIKE @kw
                      OR CASE COALESCE(ur2.data_scope, r2.default_data_scope)
                           WHEN 1 THEN '本人数据' WHEN 2 THEN '本组织' WHEN 3 THEN '本组织及下级'
                           WHEN 4 THEN '指定组织' WHEN 5 THEN '全局数据' ELSE '' END LIKE @kw)
             ))
        AND 用户代码 IS NOT NULL AND 用户代码 <> ''
      ORDER BY 用户名称
    `);
  const codes = r.recordset.map((row: any) => String(row['用户代码']).trim()).filter(Boolean);

  const roleMap: Record<string, any[]> = {};
  if (codes.length > 0) {
    for (let i = 0; i < codes.length; i += 200) {
      const chunk = codes.slice(i, i + 200);
      const placeholders = chunk.map((_, j) => `@c${j}`).join(', ');
      const req2 = pool.request();
      chunk.forEach((c, j) => req2.input(`c${j}`, sql.NVarChar, c));
      const ur = await req2.query(`
        SELECT ur.user_code, ur.role_id, ur.org_id, ur.data_scope, ur.data_scope_org_ids,
               r.role_name, r.role_code, r.default_data_scope, o.org_name AS org_name
        FROM sys_user_role ur
        LEFT JOIN sys_role r ON ur.role_id = r.role_id AND r.del_flag = 0
        LEFT JOIN sys_org o ON ur.org_id = o.org_id AND o.del_flag = 0
        WHERE ur.user_code IN (${placeholders})
        ORDER BY ur.user_code, ur.id
      `);
      for (const row of ur.recordset) {
        const uc = String(row.user_code).trim();
        if (!roleMap[uc]) roleMap[uc] = [];
        roleMap[uc].push({
          roleId: row.role_id, roleName: row.role_name || '', roleCode: row.role_code || '',
          orgId: row.org_id, orgName: row.org_name || '',
          dataScope: row.data_scope ?? row.default_data_scope,
          dataScopeOrgIds: row.data_scope_org_ids,
        });
      }
    }
  }

  const rows: any[][] = [];
  for (const row of r.recordset) {
    const code = String(row['用户代码']).trim();
    const base = {
      userCode: code,
      userName: row['用户名称'] || '',
      phone: row['手机号'] || '',
      warehouseType: row['仓库类别'] || '',
      isAdmin: row['管理员'] === '是' || row['管理员'] === 1 || row['管理员'] === true,
    };
    const roles = roleMap[code] || [];
    if (roles.length === 0) {
      rows.push([
        base.userCode, base.userName, base.phone, base.warehouseType,
        base.isAdmin ? '是' : '否', '', '', '', '', '',
      ]);
    } else {
      for (const rol of roles) {
        rows.push([
          base.userCode, base.userName, base.phone, base.warehouseType,
          base.isAdmin ? '是' : '否', rol.roleName, rol.roleCode, rol.orgName,
          DATA_SCOPE_LABELS[rol.dataScope] ?? (rol.dataScope != null ? String(rol.dataScope) : ''), 
          rol.dataScopeOrgIds ?? '',
        ]);
      }
    }
  }

  const sheet = [
    ['工号', '姓名', '手机号', '仓库类别', '管理员', '角色名称', '角色编码', '归属组织', '数据范围', '数据范围组织ID'],
    ...rows,
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sheet);
  ws['!cols'] = [
    { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 8 },
    { wch: 20 }, { wch: 18 }, { wch: 24 }, { wch: 14 }, { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, '用户角色分配');

  return {
    filename: `权限管理-用户角色分配_${now()}.xlsx`,
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    rowCount: r.recordset.length,
  };
}