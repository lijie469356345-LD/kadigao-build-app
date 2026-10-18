import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { JwtUserPayload, signToken } from '../services/jwt';
import { readAuthConfig } from '../services/appConfig';
import { isVersionAllowed } from '../services/versionPolicy';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

/**
 * 登录：校验 用户全（伯俊大表）→ 查询标准权限身份 sys_user_role/sys_role/sys_org → 签发 JWT
 * 兼容策略：
 *  - 密码：数据库密码明文比对；数据库密码为空时使用配置项 defaultPassword（原硬编码 8888，可配置）
 *  - 身份：优先 sys_user_role（组织/角色/数据范围）；「用户组」列已删除，groupName 恒为 ''，旧组名逻辑全部失效
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password, version } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: '用户名和密码不能为空' });
    }

    // 版本策略拦截：桌面客户端携带 version 字段；安卓 WebView 带 CardigaoApp/x.y.z
    // 的 UA（APP_HOST 内网页由 WebView 壳加载，UA 携带真实版本号）；纯浏览器网页版
    // 两者都不携带 → 放行。发布新版本后，低于公网策略 minVersion 的旧版本客户端
    // 直接拒绝登录，前端会引导前往下载中心升级。双保险：即便绕过前端 UI 直接调接口也会被拦。
    const ua = (req.headers['user-agent'] || '') as string;
    const uaMatch = ua.match(/CardigaoApp\/([\d.]+)/);
    const clientVersion = version || (uaMatch ? uaMatch[1] : undefined);
    if (!isVersionAllowed(clientVersion)) {
      console.log(`=== 版本过低，拒绝登录 === version=${clientVersion} (body=${version}, ua=${uaMatch ? uaMatch[1] : '-'})`);
      return res.status(403).json({
        code: 'VERSION_TOO_OLD',
        message: '当前版本过低，请升级客户端后再登录',
      });
    }

    console.log('=== 登录请求 ===');
    console.log('用户名:', username);

    let user: (JwtUserPayload & { lastLogin: Date; createdAt: Date; updatedAt: Date; id: number; groupId: number }) | null = null;

    try {
      const pool = await getPool();

      const result = await pool.request()
        .input('username', sql.NVarChar, username)
        .query(`
          SELECT * FROM 用户全 
          WHERE 用户代码 = @username OR 手机号 = @username
        `);

      console.log('查询结果数量:', result.recordset.length);

      if (result.recordset.length === 0) {
        console.log('用户不存在:', username);
        return res.status(403).json({ message: '您的手机号未注册，请在下方注册' });
      }

      if (result.recordset.length > 0) {
        const dbUser = result.recordset[0];
        const dbPassword = dbUser['密码'] as string | null;

        // 默认密码配置化（原硬编码 8888；仅对数据库密码为空的用户生效）
        const defaultPassword = readAuthConfig().defaultPassword || '8888';
        const isPasswordValid =
          dbPassword === password ||
          ((dbPassword === null || dbPassword === undefined || dbPassword === '') && password === defaultPassword);

        if (!isPasswordValid) {
          console.log('密码不匹配');
          return res.status(401).json({ message: '用户名或密码错误' });
        }

        if (dbPassword === null || dbPassword === undefined || dbPassword === '') {
          console.warn(`[Auth] 用户「${username}」使用默认密码登录，请尽快设置真实密码`);
        }

        // 离职拦截：已登记离职的账号一律禁止登录（登记即生效，无审批流程）
        try {
          const resigned = await pool.request()
            .input('uc', sql.NVarChar, dbUser['用户代码'])
            .query(`SELECT 1 AS c FROM resignation_record WHERE user_code = @uc`);
          if ((resigned.recordset?.length ?? 0) > 0) {
            console.log('=== 离职账号禁止登录 ===', dbUser['用户代码']);
            return res.status(403).json({ code: 'ACCOUNT_RESIGNED', message: '该账号已登记离职，禁止登录' });
          }
        } catch (resignedError: any) {
          // 离职表检查失败不阻断登录（保证系统可用性）
          console.log('[Auth] 离职状态检查失败（放行）:', resignedError?.message);
        }

        const isAdmin = dbUser['管理员'] === '是' || dbUser['管理员'] === 1 || dbUser['管理员'] === true;
        // 用户组列已物理删除：旧组名逻辑下线，groupName 恒为 ''（权限走 orgId/roleCodes 标准模型）
        const groupName = '';

        // 记录最后登录时间
        try {
          await pool.request()
            .input('uc', sql.NVarChar, dbUser['用户代码'])
            .query('UPDATE 用户全 SET 最后登录时间 = GETDATE() WHERE 用户代码 = @uc');
        } catch (e: any) {
          console.log('[Auth] 更新最后登录时间失败:', e?.message);
        }

        const createdAt = dbUser['创建时间'] || null;
        const updatedAt = dbUser['更新时间'] || null;
        const lastLogin = new Date(); // 本次登录时间

        // 标准权限身份：sys_user_role（个人级）→ sys_role（角色默认数据范围）→ sys_org（组织名）
        // v3：一人多角色取并集（roleCodes/roleIds 全量，主角色取权限最高者），dataScope 取最高
        let roleId: number | undefined;
        let roleCode: string | undefined;
        let roleName: string | undefined;
        let roleIds: number[] = [];
        let roleCodes: string[] = [];
        let roleNames: string[] = [];
        let orgId: number | undefined;
        let orgName: string | undefined;
        let orgIds: number[] = [];
        let dataScope: number | null = null;
        let dataScopeOrgIds: string | null = null;
        try {
          const ur = await pool.request()
            .input('uc', sql.NVarChar, dbUser['用户代码'])
            .query(`
              SELECT
                ur.role_id, ur.org_id, ur.data_scope, ur.data_scope_org_ids,
                r.role_code, r.role_name, r.default_data_scope,
                o.org_name
              FROM sys_user_role ur
              LEFT JOIN sys_role r ON ur.role_id = r.role_id
              LEFT JOIN sys_org o ON ur.org_id = o.org_id
              WHERE ur.user_code = @uc
            `);
          const rows = ur.recordset;
          if (rows.length > 0) {
            // 主角色：super_admin > data_admin > 其余（首个）；并集数组保留全部
            const pick = (codes: string[]) => {
              if (codes.includes('super_admin')) return 'super_admin';
              if (codes.includes('data_admin')) return 'data_admin';
              return codes[0];
            };
            const allCodes: string[] = [];
            for (const row of rows) {
              if (row.role_code && !allCodes.includes(row.role_code)) allCodes.push(row.role_code);
              if (row.role_id && !roleIds.includes(row.role_id)) roleIds.push(row.role_id);
              if (row.role_name && !roleNames.includes(row.role_name)) roleNames.push(row.role_name);
              // 组织：取首个非空（主身份）；orgIds 收集全部绑定组织（去重，防御空值）
              if (row.org_id !== null && row.org_id !== undefined) {
                if (orgId === undefined) {
                  orgId = row.org_id;
                  orgName = row.org_name || undefined;
                }
                if (!orgIds.includes(row.org_id)) orgIds.push(row.org_id);
              }
              if (dataScopeOrgIds === null && row.data_scope_org_ids) dataScopeOrgIds = row.data_scope_org_ids;
              // 数据范围：个人级覆盖 > 角色默认，多人多角色取最高
              const ds = row.data_scope ?? row.default_data_scope ?? null;
              if (typeof ds === 'number' && (dataScope === null || ds > dataScope)) dataScope = ds;
            }
            roleCodes = allCodes;
            const main = pick(allCodes);
            const mainRow = rows.find(r => r.role_code === main) || rows[0];
            roleId = mainRow.role_id;
            roleCode = main || undefined;
            roleName = mainRow.role_name || undefined;
          }
        } catch (urError: any) {
          // 标准权限表尚未建/未配置：此时用户无 orgId/roleCodes，权限按降级保守处理（groupName 恒 ''，旧组名逻辑已随列删除下线）
          console.log('[Auth] 标准权限身份读取失败，token 内不含组织/角色身份:', urError?.message);
        }

        const payload: JwtUserPayload = {
          userId: String(dbUser['用户代码'] ?? ''),
          userCode: dbUser['用户代码'] ?? '',
          userName: dbUser['用户名称'] ?? '',
          phone: dbUser['手机号'] ?? '',
          isAdmin: isAdmin ? '是' : '否',
          groupName,
          roleId,
          roleCode,
          roleName,
          roleIds: roleIds.length > 0 ? roleIds : undefined,
          roleCodes: roleCodes.length > 0 ? roleCodes : undefined,
          roleNames: roleNames.length > 0 ? roleNames : undefined,
          orgId,
          orgName,
          orgIds: orgIds.length > 0 ? orgIds : undefined,
          dataScope,
          dataScopeOrgIds,
          tokenType: 'access',
        };

        user = {
          ...payload,
          id: 1,
          groupId: 1,
          lastLogin,
          createdAt,
          updatedAt,
        };

        console.log('登录成功:', user.userName);
      } else {
        console.log('未找到用户');
      }
    } catch (dbError) {
      console.error('数据库登录验证失败:', dbError);
    }

    if (!user) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }

    const token = signToken({
      userId: user.userId,
      userCode: user.userCode,
      userName: user.userName,
      phone: user.phone,
      isAdmin: user.isAdmin,
      groupName: user.groupName,
      roleId: user.roleId,
      roleCode: user.roleCode,
      roleName: user.roleName,
      roleIds: user.roleIds,
      roleCodes: user.roleCodes,
      roleNames: user.roleNames,
      orgId: user.orgId,
      orgName: user.orgName,
      orgIds: user.orgIds,
      dataScope: user.dataScope,
      dataScopeOrgIds: user.dataScopeOrgIds,
      tokenType: 'access',
    });

    res.json({
      id: user.id,
      userCode: user.userCode,
      userName: user.userName,
      phone: user.phone,
      isAdmin: user.isAdmin,
      groupId: user.groupId,
      groupName: user.groupName,
      roleId: user.roleId,
      roleCode: user.roleCode,
      roleName: user.roleName,
      roleIds: user.roleIds ?? null,
      roleCodes: user.roleCodes ?? null,
      roleNames: user.roleNames ?? null,
      orgId: user.orgId,
      orgName: user.orgName,
      orgIds: user.orgIds ?? null,
      dataScope: user.dataScope,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      token,
    });
  } catch (error) {
    console.error('登录异常:', error);
    res.status(500).json({ message: '登录失败', error });
  }
});

// /me：从 JWT 解析身份返回（替代原写死 ADMIN），登录态以下发 token 为准
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const u = req.user!;
    // 查询用户全表获取真实时间
    let createdAt: Date | null = null;
    let updatedAt: Date | null = null;
    let lastLogin: Date | null = null;
    try {
      const pool = await getPool();
      const r = await pool.request()
        .input('uc', sql.NVarChar, u.userCode)
        .query('SELECT 创建时间, 更新时间, 最后登录时间 FROM 用户全 WHERE 用户代码 = @uc');
      if (r.recordset.length > 0) {
        createdAt = r.recordset[0]['创建时间'] || null;
        updatedAt = r.recordset[0]['更新时间'] || null;
        lastLogin = r.recordset[0]['最后登录时间'] || null;
      }
    } catch (e: any) {
      console.log('[Auth] /me 查询用户时间失败:', e?.message);
    }
    res.json({
      id: 1,
      userCode: u.userCode,
      userName: u.userName,
      phone: u.phone,
      isAdmin: u.isAdmin || '否',
      groupId: 1,
      groupName: u.groupName,
      roleId: u.roleId ?? null,
      roleCode: u.roleCode ?? null,
      roleName: u.roleName ?? null,
      roleIds: u.roleIds ?? null,
      roleCodes: u.roleCodes ?? null,
      roleNames: u.roleNames ?? null,
      orgId: u.orgId ?? null,
      orgName: u.orgName ?? null,
      orgIds: u.orgIds ?? null,
      dataScope: u.dataScope ?? null,
      lastLogin,
      createdAt,
      updatedAt,
    });
  } catch (error) {
    console.error('获取用户信息失败:', error);
    res.status(500).json({ message: '获取用户信息失败', error });
  }
});

export default router;