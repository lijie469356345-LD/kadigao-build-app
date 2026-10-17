import { Router } from 'express';
import sql from 'mssql';
import { getPool } from '../../config/db';
import { resolveOrgName } from '../services/userStoreBind';
import { syncUserRoleByPosition, applyPositionChange } from '../services/positionRoleSync';
import { ensureAdminOrgBinding } from '../services/adminOrgSync';
import { authMiddleware } from '../middlewares/authMiddleware';
import { readAuthConfig } from '../services/appConfig';

const router = Router();

// 批量导入结果提示拼装（用户全表写入 + 「组织」列归属处理 + 职位→角色 联动统计）
function buildBulkImportMessage(
  count: number,
  org: { orgBound: number; orgNoRole: number; orgUnmatched: number; orgUnmatchedCodes: string[]; orgNoRoleCodes: string[] },
  role: { roleBound: number; roleSkip: number },
): string {
  let msg = `成功导入 ${count} 个用户`;
  const parts: string[] = [];
  if (org.orgBound > 0) parts.push(`更新归属 ${org.orgBound} 人`);
  if (org.orgNoRole > 0) {
    const codes = org.orgNoRoleCodes.slice(0, 5).join('、') + (org.orgNoRoleCodes.length > 5 ? ' 等' : '');
    parts.push(`${org.orgNoRole} 人无角色未生效（${codes}）`);
  }
  if (org.orgUnmatched > 0) {
    const codes = org.orgUnmatchedCodes.slice(0, 5).join('、') + (org.orgUnmatchedCodes.length > 5 ? ' 等' : '');
    parts.push(`${org.orgUnmatched} 人组织未匹配（${codes}）`);
  }
  if (role.roleBound > 0) parts.push(`职位联动绑定角色 ${role.roleBound} 人`);
  if (role.roleSkip > 0) parts.push(`${role.roleSkip} 人角色已存在或职位未配置角色`);
  if (parts.length > 0) msg += `；组织归属：${parts.join('、')}`;
  return msg;
}

// 获取用户列表
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();

    // 从DataExtraction读取用户自定义SQL
    let query = '';
    try {
      const dxResult = await pool.request()
        .input('name', sql.NVarChar, '用户管理')
        .query(`SELECT sqlQuery FROM DataExtraction WHERE fieldName = @name`);
      if (dxResult.recordset.length > 0) {
        query = dxResult.recordset[0].sqlQuery;
        console.log('用户管理使用DataExtraction SQL');
      }
    } catch (e: any) {
      console.log('用户管理DataExtraction读取失败:', e.message);
    }
    if (!query) {
      query = `SELECT * FROM 用户全
        WHERE 用户代码 IS NOT NULL AND 用户代码 <> ''
        ORDER BY 用户名称`;
    }

    const result = await pool.request().query(query);
    
    if (result.recordset.length > 0) {
      const firstRow = result.recordset[0];
      console.log('用户全表字段:', Object.keys(firstRow));
      console.log('第一条数据:', JSON.stringify(firstRow));
      
      const users = result.recordset.map((row: any, index: number) => {
        const isAdminValue = row['管理员'];
        const isAdmin = isAdminValue === '是' || isAdminValue === 1 || isAdminValue === true;
        
        // 构建包含所有字段的用户对象
        const user: any = {
          id: index + 1,
          userCode: row['用户代码'],
          userName: row['用户名称'],
          phone: row['手机号'],
          password: row['密码'] || '8888',
          isAdmin,
          lastLogin: row['最后登录时间'] || null,
          createdAt: row['创建时间'] || null,
          updatedAt: row['更新时间'] || null,
        };
        
        // 添加所有其他字段
        Object.keys(row).forEach(key => {
          if (!['用户代码', '用户名称', '手机号', '密码', '管理员', '创建时间', '更新时间', '最后登录时间'].includes(key)) {
            user[key] = row[key];
          }
        });
        
        return user;
      });
      
      res.json(users);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('获取用户列表失败:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * 修改密码（本人）：登录态鉴权 → 校验旧密码 → 按 用户代码 更新密码。
 * 注意：用户全表无自增 id 列，按 用户代码（主键）定位；密码明文存储，校验规则与 auth.ts 登录一致。
 */
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const userCode = req.user?.userCode;
    const { oldPassword, newPassword } = req.body || {};
    if (!userCode) return res.status(401).json({ success: false, message: '未登录' });
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: '请填写旧密码和新密码' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ success: false, message: '新密码长度不能少于6位' });
    }

    const pool = await getPool();
    const r = await pool.request()
      .input('code', sql.NVarChar, userCode)
      .query('SELECT 密码 FROM 用户全 WHERE 用户代码 = @code');
    if (r.recordset.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    const dbPassword = r.recordset[0]['密码'] as string | null;
    const defaultPassword = readAuthConfig().defaultPassword || '8888';
    const isOldValid =
      dbPassword === oldPassword ||
      ((dbPassword === null || dbPassword === undefined || dbPassword === '') && oldPassword === defaultPassword);
    if (!isOldValid) {
      return res.status(400).json({ success: false, message: '旧密码不正确' });
    }

    await pool.request()
      .input('code', sql.NVarChar, userCode)
      .input('pwd', sql.NVarChar, String(newPassword))
      .query('UPDATE 用户全 SET 密码 = @pwd WHERE 用户代码 = @code');

    res.json({ success: true, message: '密码修改成功' });
  } catch (error: any) {
    console.error('修改密码失败:', error);
    res.status(500).json({ success: false, message: '修改密码失败：' + (error.message || '未知错误') });
  }
});

// 创建用户
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const userCode = String(body['用户代码'] || body['userCode'] || '').trim();
    if (!userCode) return res.status(400).json({ message: '工号不能为空' });

    const pool = await getPool();
    // 读取 用户全 表的实际列（排除主键"用户代码"）
    const colsResult = await pool.request().query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '用户全' ORDER BY ORDINAL_POSITION`);
    const dbColumns = colsResult.recordset.map((r: any) => r.COLUMN_NAME).filter((c: string) => c !== '用户代码' && !['创建时间', '更新时间', '最后登录时间'].includes(c));
    const defaults: Record<string, string> = {
      '用户名称': '', '手机号': '', '密码': '8888', '管理员': '否',
      '企微账号': '', '仓库类别': '', '组织': '', '职位': '',
    };

    const fields: Record<string, string> = {};
    dbColumns.forEach(col => {
      const val = body[col];
      fields[col] = val !== undefined && val !== null && val !== '' ? String(val) : (defaults[col] || '');
    });

    const request = pool.request();
    request.input('code', sql.NVarChar, userCode);
    dbColumns.forEach((col, i) => request.input('c' + i, sql.NVarChar, fields[col]));

    const cols = ['用户代码', ...dbColumns].map(c => `[${c}]`).join(', ');
    const params = ['@code', ...dbColumns.map((_, i) => '@c' + i)].join(', ');
    await request.query(`INSERT INTO 用户全 (${cols}, 创建时间, 更新时间) VALUES (${params}, GETDATE(), GETDATE())`);

    // 联动：组织列规范化（ID/名称变体 → 权威 org_name；失败不阻断保存）
    try {
      const orgVal = String(fields['组织'] || '').trim();
      const hit = orgVal ? await resolveOrgName(pool, orgVal) : null;
      if (hit && hit.orgName !== orgVal) {
        await pool.request()
          .input('code', sql.NVarChar, userCode)
          .input('org', sql.NVarChar, hit.orgName)
          .query(`UPDATE 用户全 SET 组织 = @org WHERE 用户代码 = @code`);
        console.log(`[OrgSync] 新增用户 ${userCode} 组织规范化「${orgVal}」→「${hit.orgName}」`);
      } else if (hit) {
        console.log(`[OrgSync] 新增用户 ${userCode} 组织「${hit.orgName}」`);
      } else if (orgVal) {
        console.log(`[OrgSync] 新增用户 ${userCode} 组织「${orgVal}」未匹配到组织树节点`);
      }
    } catch (e: any) {
      console.error(`[OrgSync] 新增用户组织规范化失败 ${userCode}:`, e.message);
    }

    // 联动：职位 → 角色 自动绑定（sys_position.role_id → sys_user_role；失败不阻断保存）
    try {
      const posVal = String(fields['职位'] || '').trim();
      if (posVal) {
        const rs = await syncUserRoleByPosition(pool, userCode, posVal);
        console.log(`[PositionSync] 新增用户 ${userCode} 职位「${posVal}」→ 角色 ${rs.roleId} (${rs.action})`);
      }
    } catch (e: any) {
      console.error(`[PositionSync] 新增用户 ${userCode} 职位联动失败:`, e.message);
    }

    // 联动：管理员='是' → 自动绑定 super_admin + 总公司（org 1），使店铺范围全量（失败不阻断保存）
    if (String(fields['管理员'] || '').trim() === '是') {
      try {
        const r = await ensureAdminOrgBinding(pool, userCode);
        console.log(`[AdminOrgSync] 新增用户 ${userCode} 管理员总公司绑定 (${r})`);
      } catch (e: any) {
        console.error(`[AdminOrgSync] 新增用户 ${userCode} 管理员绑定失败:`, e.message);
      }
    }

    res.json({ message: '创建成功', userCode });
  } catch (error: any) {
    console.error('创建用户失败:', error);
    res.status(500).json({ message: '创建失败: ' + (error.message || '') });
  }
});

router.put('/:code', async (req, res) => {
  try {
    const code = decodeURIComponent(req.params.code);
    const body = req.body || {};
    const pool = await getPool();

    // 动态读取用户全表列（排除主键"用户代码"和时间列）
    const colsResult = await pool.request().query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '用户全' ORDER BY ORDINAL_POSITION`);
    const dbColumns = colsResult.recordset.map((r: any) => r.COLUMN_NAME).filter((c: string) => c !== '用户代码' && !['创建时间', '更新时间', '最后登录时间'].includes(c));
    const defaults: Record<string, string> = {
      '用户名称': '', '手机号': '', '密码': '8888', '管理员': '否',
      '企微账号': '', '仓库类别': '', '组织': '', '职位': '',
    };

    const request = pool.request();
    request.input('code', sql.NVarChar, code);
    const sets = dbColumns.map((col, i) => {
      const v = body[col];
      const val = v !== undefined && v !== null && v !== '' ? String(v) : (defaults[col] || '');
      request.input('f' + i, sql.NVarChar, val);
      return `[${col}] = @f${i}`;
    }).join(', ');

    // 联动：职位 → 角色（编辑场景）——更新前记录旧职位，更新后按 sys_position.role_id 解绑旧角色、绑定新角色
    let oldPosition = '';
    if ('职位' in body) {
      const oldR = await pool.request().input('code', sql.NVarChar, code)
        .query(`SELECT 职位 FROM 用户全 WHERE 用户代码 = @code`);
      oldPosition = oldR.recordset.length > 0 ? String(oldR.recordset[0]['职位'] || '').trim() : '';
    }

    await request.query(`UPDATE 用户全 SET ${sets}, 更新时间 = GETDATE() WHERE 用户代码 = @code`);

    // 联动：组织变更后规范化组织列（ID/名称变体 → 权威 org_name；失败不阻断保存）
    // 仅当请求体显式包含「组织」字段时触发，避免其他字段更新误改写组织列
    try {
      if ('组织' in body) {
        const orgVal = String(body['组织'] || '').trim();
        const hit = orgVal ? await resolveOrgName(pool, orgVal) : null;
        if (hit && hit.orgName !== orgVal) {
          await pool.request()
            .input('code', sql.NVarChar, code)
            .input('org', sql.NVarChar, hit.orgName)
            .query(`UPDATE 用户全 SET 组织 = @org WHERE 用户代码 = @code`);
          console.log(`[OrgSync] 编辑用户 ${code} 组织规范化「${orgVal}」→「${hit.orgName}」`);
        } else if (hit) {
          console.log(`[OrgSync] 编辑用户 ${code} 组织「${hit.orgName}」`);
        } else if (orgVal) {
          console.log(`[OrgSync] 编辑用户 ${code} 组织「${orgVal}」未匹配到组织树节点`);
        }
      }
    } catch (e: any) {
      console.error(`[OrgSync] 编辑用户组织规范化失败 ${code}:`, e.message);
    }

    // 联动：职位变更 → 角色绑定同步（旧职位角色解绑 + 新职位角色绑定；失败不阻断保存）
    if ('职位' in body) {
      try {
        const newPosition = String(body['职位'] || '').trim();
        const rs = await applyPositionChange(pool, code, oldPosition, newPosition);
        const detail = rs.removedRoleId !== null ? `，解绑旧角色 ${rs.removedRoleId}` : '';
        console.log(`[PositionSync] 编辑用户 ${code} 职位「${oldPosition}」→「${newPosition}」角色 ${rs.sync.roleId} (${rs.sync.action})${detail}`);
      } catch (e: any) {
        console.error(`[PositionSync] 编辑用户 ${code} 职位联动失败:`, e.message);
      }
    }

    // 联动：管理员='是' → 自动绑定 super_admin + 总公司（org 1），使店铺范围全量（失败不阻断保存）
    if (String(body['管理员'] || '').trim() === '是') {
      try {
        const r = await ensureAdminOrgBinding(pool, code);
        console.log(`[AdminOrgSync] 编辑用户 ${code} 管理员总公司绑定 (${r})`);
      } catch (e: any) {
        console.error(`[AdminOrgSync] 编辑用户 ${code} 管理员绑定失败:`, e.message);
      }
    }

    res.json({ success: true, message: '更新成功', userCode: code });
  } catch (error: any) {
    console.error('更新用户失败:', error);
    res.status(500).json({ message: '更新失败: ' + (error.message || '') });
  }
});

// 删除用户（按用户代码；此路由为历史兼容保留，前端请使用 DELETE /code/:userCode）
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const decodedCode = decodeURIComponent(id);
    
    const pool = await getPool();
    
    const deleteResult = await pool.request()
      .input('userCode', sql.NVarChar, decodedCode)
      .query(`DELETE FROM 用户全 WHERE 用户代码 = @userCode`);
    
    if (deleteResult.rowsAffected[0] === 0) {
      return res.status(404).json({ message: '用户不存在' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('删除用户失败:', error);
    res.status(500).json({ message: '删除用户失败' });
  }
});

// 删除用户（按用户代码）
router.delete('/code/:userCode', async (req, res) => {
  try {
    console.log('=== 删除用户API被调用 ===');
    const { userCode } = req.params;
    const decodedCode = decodeURIComponent(userCode);
    console.log('用户代码:', decodedCode);
    
    const pool = await getPool();
    console.log('数据库连接成功');
    
    const result = await pool.request()
      .input('userCode', sql.NVarChar, decodedCode)
      .query(`DELETE FROM 用户全 WHERE 用户代码 = @userCode`);
    
    console.log('数据库删除结果:', result.rowsAffected);
    
    res.json({ success: true });
    console.log('删除用户成功');
  } catch (error) {
    console.error('删除用户失败:', error);
    res.status(500).json({ message: '删除用户失败' });
  }
});

// 清空所有用户
router.post('/clear', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().query('DELETE FROM 用户全');
    res.json({ success: true, message: '已清空所有用户' });
  } catch (error: any) {
    console.error('清空用户失败:', error);
    res.status(500).json({ message: '清空用户失败：' + (error.message || '未知错误') });
  }
});

// 批量导入用户（用户代码存在则更新，否则新增；动态处理所有字段）
router.post('/bulk', async (req, res) => {
  try {
    const { users } = req.body;
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ message: '没有导入数据' });
    }
    const pool = await getPool();
    // 读取 用户全 表的实际列（排除主键"用户代码"）
    const colsResult = await pool.request().query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '用户全' ORDER BY ORDINAL_POSITION`);
    const dbColumns = colsResult.recordset.map((r: any) => r.COLUMN_NAME).filter((c: string) => c !== '用户代码' && !['创建时间', '更新时间', '最后登录时间'].includes(c));
    const defaults: Record<string, string> = {
      '用户名称': '', '手机号': '', '密码': '8888', '管理员': '否',
      '企微账号': '', '仓库类别': '', '组织': '', '职位': '',
    };

    // 组织树索引（供「组织」列匹配：名称/ID 双查，名称含去 _ZY/_JM 后缀、去空格、店铺名/店铺代码变体）
    const orgIdx = await pool.request().query(`SELECT org_id, org_name, shop_code, shop_name FROM sys_org WHERE del_flag = 0`);
    const orgById = new Map<number, any>();
    const orgByName = new Map<string, any>();
    for (const o of orgIdx.recordset) {
      orgById.set(o.org_id, o);
      const raw = String(o.org_name || '').trim();
      const stripped = raw.replace(/_(ZY|JM)$/i, '').trim();
      const variants = [raw, stripped, stripped.replace(/\s+/g, ''), String(o.shop_name || '').trim(), String(o.shop_code || '').trim()];
      for (const v of variants) if (v && !orgByName.has(v)) orgByName.set(v, o);
    }

    const transaction = pool.transaction();
    await transaction.begin();
    try {
      let count = 0;
      let orgBound = 0, orgNoRole = 0, orgUnmatched = 0;
      let roleBound = 0, roleSkip = 0;
      const orgUnmatchedCodes: string[] = [];
      const orgNoRoleCodes: string[] = [];
      for (const u of users) {
        const userCode = String(u['用户代码'] || u['userCode'] || '').trim();
        if (!userCode) continue;

        // 动态构建字段值
        const fields: Record<string, string> = {};
        dbColumns.forEach(col => {
          const val = u[col];
          fields[col] = val !== undefined && val !== null ? String(val) : (defaults[col] || '');
        });

        const existing = await transaction.request()
          .input('code', sql.NVarChar, userCode)
          .query('SELECT 用户代码, 职位 FROM 用户全 WHERE 用户代码 = @code');

        const req = transaction.request();
        req.input('code', sql.NVarChar, userCode);
        dbColumns.forEach((col, i) => req.input('c' + i, sql.NVarChar, fields[col]));

        if (existing.recordset.length > 0) {
          const sets = dbColumns.map((col, i) => `[${col}] = @c${i}`).join(', ');
          await req.query(`UPDATE 用户全 SET ${sets}, 更新时间 = GETDATE() WHERE 用户代码 = @code`);
        } else {
          const cols = ['用户代码', ...dbColumns].map(c => `[${c}]`).join(', ');
          const params = ['@code', ...dbColumns.map((_, i) => '@c' + i)].join(', ');
          await req.query(`INSERT INTO 用户全 (${cols}, 创建时间, 更新时间) VALUES (${params}, GETDATE(), GETDATE())`);
        }

        // 联动：职位 → 角色 自动绑定（与用户管理新增/编辑一致；事务内执行）
        // 导入行优先用 u['职位']（可能为 null/空 → 仅解绑旧职位角色，不新增绑定）
        const posVal = u['职位'] !== undefined && u['职位'] !== null ? String(u['职位']).trim() : (fields['职位'] || '').trim();
        try {
          const oldPos = existing.recordset.length > 0 ? String(existing.recordset[0]['职位'] || '').trim() : '';
          const rs = await applyPositionChange(transaction, userCode, oldPos, posVal);
          if (rs.sync.action === 'inserted') roleBound++;
          else roleSkip++;
        } catch (e: any) {
          console.error(`[PositionSync] 批量导入 ${userCode} 职位联动失败:`, e.message);
        }

        // 联动：管理员='是' → 自动绑定 super_admin + 总公司（org 1），使店铺范围全量（事务内执行）
        if (String(fields['管理员'] || '').trim() === '是') {
          try {
            await ensureAdminOrgBinding(transaction, userCode);
          } catch (e: any) {
            console.error(`[AdminOrgSync] 批量导入 ${userCode} 管理员绑定失败:`, e.message);
          }
        }

        // 组织归属：行携带「组织」列（非空）→ 匹配 sys_org → 更新该用户主角色（id 最小行，同手动改组织 roles[0] 语义）org_id
        const orgVal = '组织' in u ? String(u['组织'] ?? '').trim() : '';
        if (orgVal) {
          let orgRow: any = /^\d+$/.test(orgVal) ? orgById.get(Number(orgVal)) : undefined;
          if (!orgRow) orgRow = orgByName.get(orgVal) || orgByName.get(orgVal.replace(/\s+/g, ''));
          if (!orgRow) {
            orgUnmatched++;
            orgUnmatchedCodes.push(userCode);
          } else {
            // 规范化「组织」列：权威 org_name 回写用户全（与用户管理展示一致），保证「用户全 ↔ 用户管理」同步
            if (fields['组织'] !== orgRow.org_name) {
              await transaction.request()
                .input('uc', sql.NVarChar, userCode)
                .input('orgN', sql.NVarChar, orgRow.org_name)
                .query(`UPDATE 用户全 SET 组织 = @orgN WHERE 用户代码 = @uc`);
            }
            const main = await transaction.request()
              .input('uc', sql.NVarChar, userCode)
              .query(`SELECT TOP 1 id FROM sys_user_role WHERE user_code = @uc ORDER BY id`);
            if (main.recordset.length > 0) {
              await transaction.request()
                .input('id', sql.Int, main.recordset[0].id)
                .input('o', sql.Int, orgRow.org_id)
                .query(`UPDATE sys_user_role SET org_id = @o, update_time = GETDATE() WHERE id = @id`);
              orgBound++;
            } else {
              orgNoRole++;
              orgNoRoleCodes.push(userCode);
            }
          }
        }
        count++;
      }
      await transaction.commit();

      res.json({ success: true, count, message: buildBulkImportMessage(count, { orgBound, orgNoRole, orgUnmatched, orgUnmatchedCodes, orgNoRoleCodes }, { roleBound, roleSkip }) });
    } catch (e: any) {
      await transaction.rollback();
      throw e;
    }
  } catch (error: any) {
    console.error('批量导入用户失败:', error);
    res.status(500).json({ message: '批量导入失败：' + (error.message || '未知错误') });
  }
});

// 同步用户（直接从用户全表获取数据）
router.post('/sync', async (req, res) => {
  try {
    const pool = await getPool();
    
    const dbUsersResult = await pool.request().query(`
      SELECT 用户代码, 用户名称, 手机号 FROM 用户全
    `);
    
    res.json({ 
      added: dbUsersResult.recordset.length, 
      updated: 0, 
      message: `同步完成：从用户全表获取 ${dbUsersResult.recordset.length} 个用户` 
    });
  } catch (error: any) {
    console.error('同步用户失败:', error);
    res.status(500).json({ message: '同步用户失败：' + (error.message || '未知错误') });
  }
});

export default router;
