import { Router } from 'express';
import sql from 'mssql';
import { InspectionTask } from '../../types';
import { getPool } from '../../config/db';
import { JwtUserPayload } from '../services/jwt';
import { extractManagerArea, extractSupervisorName, getStandardVisibleShopNames } from '../services/permissionService';

const router = Router();

const moduleTypeNameMap: Record<string, string> = {
  coreItems: '核心事项',
  shopIssues: '店铺问题',
  competitorInfo: '竞品信息',
  marketChanges: '市场变化',
  marketResearch: '市场调研',
  staffCollection: '人员收集',
  teachingTraining: '带教培训'
};

function getModuleTypeName(moduleType: string): string {
  return moduleTypeNameMap[moduleType] || moduleType;
}

// 【2026-09 下线】getGroupNameByUserName 已删除：用户组列物理删除，不再从数据库回查用户组；
// 角色判定一律基于 JWT 标准角色（req.user.roleCodes）。

async function getPermissionData(pool: sql.ConnectionPool, groupName: string, user?: JwtUserPayload | null): Promise<{ shops: string[], supervisors: string[] }> {
  const shops: string[] = [];
  const supervisors: string[] = [];
  const warehouseFilter = "(仓库类别 = '直营' OR 仓库类别 = '山东直营' OR 仓库类别 = '加盟')";

  // v3：标准组织隔离（sys_user_role → sys_org）——用户身份可解析时优先
  if (user) {
    const visible = await getStandardVisibleShopNames(pool, groupName, user);
    if (visible === null) {
      // 管理员/全局数据范围：全部店铺 + 全部督导
      const result = await pool.request()
        .query(`SELECT DISTINCT 店铺名称, 督导 FROM 店仓全 WHERE ${warehouseFilter}`);
      result.recordset.forEach((row: any) => {
        if (row.店铺名称) shops.push(row.店铺名称);
        if (row.督导 && !supervisors.includes(row.督导)) supervisors.push(row.督导);
      });
      return { shops, supervisors };
    }
    if (visible.length > 0) {
      shops.push(...visible);
      const shopConditions = visible.map((_, i) => `店铺名称 = @shop${i}`).join(' OR ');
      const supResult = await pool.request();
      visible.forEach((shop: string, i: number) => supResult.input(`shop${i}`, sql.NVarChar, shop));
      const supRecords = await supResult.query(`SELECT DISTINCT 督导 FROM 店仓全 WHERE (${shopConditions}) AND ${warehouseFilter}`);
      supRecords.recordset.forEach((row: any) => {
        if (row.督导 && !supervisors.includes(row.督导)) supervisors.push(row.督导);
      });
    }
    return { shops, supervisors };
  }

  // 兜底（无 JWT 身份场景，实际不会发生）：旧组名/GroupPermissions 逻辑
  try {
    const permResult = await pool.request()
      .input('groupName', sql.NVarChar, groupName)
      .query(`SELECT shopName FROM GroupPermissions WHERE groupName = @groupName`);

    const allowedShops = permResult.recordset.map((row: any) => row.shopName);
    if (allowedShops.length > 0) {
      shops.push(...allowedShops);

      const shopConditions = allowedShops.map((_, i) => `店铺名称 = @shop${i}`).join(' OR ');
      const supResult = await pool.request();
      allowedShops.forEach((shop: string, i: number) => supResult.input(`shop${i}`, sql.NVarChar, shop));
      const supRecords = await supResult.query(`SELECT DISTINCT 督导 FROM 店仓全 WHERE (${shopConditions})`);
      supRecords.recordset.forEach((row: any) => {
        if (row.督导 && !supervisors.includes(row.督导)) supervisors.push(row.督导);
      });
      return { shops, supervisors };
    }
  } catch (error) {
    console.log('GroupPermissions表不存在，使用旧的权限方式');
  }

  const managerArea = extractManagerArea(groupName);
  if (managerArea) {
    const result = await pool.request()
      .input('area', sql.NVarChar, managerArea)
      .query(`SELECT DISTINCT 店铺名称, 督导 FROM 店仓全 WHERE 区域 = @area AND ${warehouseFilter}`);

    result.recordset.forEach((row: any) => {
      if (row.店铺名称) shops.push(row.店铺名称);
      if (row.督导 && !supervisors.includes(row.督导)) supervisors.push(row.督导);
    });
    return { shops, supervisors };
  }

  const supervisorName = extractSupervisorName(groupName);
  if (supervisorName) {
    const cleanName = supervisorName.replace(/督导/g, '').trim();
    const result = await pool.request()
      .input('supervisor', sql.NVarChar, `%${cleanName}%`)
      .query(`SELECT DISTINCT 店铺名称, 督导 FROM 店仓全 WHERE 督导 LIKE @supervisor AND ${warehouseFilter}`);

    result.recordset.forEach((row: any) => {
      if (row.店铺名称) shops.push(row.店铺名称);
      if (row.督导 && !supervisors.includes(row.督导)) supervisors.push(row.督导);
    });
    return { shops, supervisors };
  }

  return { shops, supervisors };
}

// 基于 JWT 标准角色判定：督导 / 经理（用户组列已删除，旧组名判定废弃）
function getRoleFlags(user?: JwtUserPayload | null): { isSupervisor: boolean; isManager: boolean; supervisorName: string } {
  const codes = user?.roleCodes && user.roleCodes.length > 0 ? user.roleCodes : (user?.roleCode ? [user.roleCode] : []);
  const isSupervisor = codes.includes('supervisor');
  const isManager = codes.some(c => ['area_manager', 'ops_director', 'region_director', 'data_manager'].includes(c));
  return { isSupervisor, isManager, supervisorName: user?.userName || user?.userCode || '' };
}

router.get('/', async (req, res) => {
  const { userCode, userName, isAdmin, groupName, status } = req.query;
  const isAdminBool = isAdmin === 'true' || isAdmin === '是';
  const userIdParam = (userCode as string) || (userName as string);
  
  console.log('=== 巡店任务查询 ===');
  console.log('userCode:', userCode);
  console.log('userName:', userName);
  console.log('userIdParam:', userIdParam);
  console.log('isAdmin:', isAdmin, '->', isAdminBool);
  console.log('groupName (前端传递):', groupName);
  
  try {
    const pool = await getPool();
    
    let groupNameStr: string | null = Array.isArray(groupName) ? (groupName[0] as string) : ((groupName as string) || null);
    // 用户组列已删除：不再从数据库回查用户组，角色一律基于 JWT 标准角色
    
    let query = `
      SELECT 
        id, title, description, assignedTo, assignedToName, 
        shops, shopNames, deadline, status, createdAt, updatedAt
      FROM InspectionTasks
    `;
    
    let params: { name: string; type: any; value: any }[] = [];
    let whereClauses: string[] = [];
    
    const { isSupervisor, isManager, supervisorName } = getRoleFlags(req.user || null);
    
    if (isSupervisor && !isAdminBool) {
      if (supervisorName) {
        whereClauses.push('(assignedTo LIKE @supervisor OR assignedToName LIKE @supervisor)');
        params.push({ name: 'supervisor', type: sql.NVarChar, value: `%${supervisorName}%` });
        console.log('督导权限：显示分配给', supervisorName, '的所有任务');
      } else {
        whereClauses.push('(assignedTo LIKE @userId1 OR assignedToName LIKE @userId1)');
        params.push({ name: 'userId1', type: sql.NVarChar, value: `%${userIdParam}%` });
        console.log('督导权限：显示分配给自己的所有任务');
      }
    } else if (isManager && !isAdminBool) {
      const permissionData = await getPermissionData(pool, groupNameStr || '', req.user || null);
      console.log('经理权限 - 店铺:', permissionData.shops.length, '个');
      console.log('经理权限 - 督导:', permissionData.supervisors);
      
      const permissionClauses: string[] = [];
      
      permissionClauses.push('(assignedTo LIKE @userId1 OR assignedToName LIKE @userId1)');
      params.push({ name: 'userId1', type: sql.NVarChar, value: `%${userIdParam}%` });
      
      if (permissionData.shops.length > 0) {
        const shopConditions = permissionData.shops.map((shop, i) => {
          params.push({ name: `shop${i}`, type: sql.NVarChar, value: shop });
          return `shopNames LIKE @shop${i}`;
        });
        permissionClauses.push(`(${shopConditions.join(' OR ')})`);
      }
      
      if (permissionData.supervisors.length > 0) {
        const supConditions = permissionData.supervisors.map((sup, i) => {
          params.push({ name: `sup${i}`, type: sql.NVarChar, value: `%${sup}%` });
          return `(assignedTo LIKE @sup${i} OR assignedToName LIKE @sup${i})`;
        });
        permissionClauses.push(`(${supConditions.join(' OR ')})`);
      }
      
      if (permissionClauses.length > 0) {
        whereClauses.push(`(${permissionClauses.join(' OR ')})`);
      }
      console.log('经理权限：显示自己和管辖店铺/督导的所有任务');
    } else if (!isAdminBool && userIdParam) {
      whereClauses.push('(assignedTo LIKE @userId1 OR assignedToName LIKE @userId1)');
      params.push({ name: 'userId1', type: sql.NVarChar, value: `%${userIdParam}%` });
      console.log('普通用户权限：显示分配给自己的所有任务');
    }
    
    if (status && typeof status === 'string') {
      whereClauses.push('status = @status');
      params.push({ name: 'status', type: sql.NVarChar, value: status });
    }
    
    if (whereClauses.length > 0) {
      query += ' WHERE ' + whereClauses.join(' AND ');
    }
    
    query += ' ORDER BY createdAt DESC';
    
    console.log('查询语句:', query);
    
    const request = pool.request();
    params.forEach(p => request.input(p.name, p.type, p.value));
    
    const result = await request.query(query);
    console.log('查询结果:', result.recordset.length, '条');
    
    res.json(result.recordset.map((row: any) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      assignedTo: row.assignedTo,
      assignedToName: row.assignedToName,
      shops: row.shops ? JSON.parse(row.shops) : [],
      shopNames: row.shopNames ? JSON.parse(row.shopNames) : [],
      deadline: row.deadline ? new Date(row.deadline).toISOString().split('T')[0] : '',
      status: row.status,
      createdAt: row.createdAt ? new Date(row.createdAt).toLocaleString() : '',
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '',
    })));
  } catch (error) {
    console.error('获取巡店任务列表失败:', error);
    res.status(500).json({ message: '获取巡店任务列表失败', error: (error as Error).message });
  }
});

router.get('/count', async (req, res) => {
  const { userCode, userName, isAdmin, groupName, status } = req.query;
  const isAdminBool = isAdmin === 'true' || isAdmin === '是';
  const userIdParam = (userCode as string) || (userName as string);
  
  console.log('=== 巡店任务数量统计 ===');
  console.log('userCode:', userCode);
  console.log('status:', status);
  console.log('isAdmin:', isAdmin, '->', isAdminBool);
  
  try {
    const pool = await getPool();
    
    let groupNameStr: string | null = Array.isArray(groupName) ? (groupName[0] as string) : ((groupName as string) || null);
    // 用户组列已删除：不再从数据库回查用户组，角色一律基于 JWT 标准角色
    
    let query = 'SELECT COUNT(*) as count FROM InspectionTasks';
    
    let params: { name: string; type: any; value: any }[] = [];
    let whereClauses: string[] = [];
    
    if (status && typeof status === 'string') {
      whereClauses.push('status = @status');
      params.push({ name: 'status', type: sql.NVarChar, value: status });
      console.log('过滤状态:', status);
    }
    
    const { isSupervisor, isManager } = getRoleFlags(req.user || null);
    
    if (isSupervisor && !isAdminBool) {
      if (req.user?.userName) {
        whereClauses.push('(assignedTo LIKE @supervisor OR assignedToName LIKE @supervisor)');
        params.push({ name: 'supervisor', type: sql.NVarChar, value: `%${req.user.userName}%` });
        console.log('督导权限统计：显示分配给', req.user.userName, '的任务数量');
      } else {
        whereClauses.push('(assignedTo LIKE @userId1 OR assignedToName LIKE @userId1)');
        params.push({ name: 'userId1', type: sql.NVarChar, value: `%${userIdParam}%` });
      }
    } else if (!isAdminBool && (userIdParam || isManager)) {
      const permissionClauses: string[] = [];
      
      if (userIdParam) {
        permissionClauses.push('(assignedTo LIKE @userId1 OR assignedToName LIKE @userId1)');
        params.push({ name: 'userId1', type: sql.NVarChar, value: `%${userIdParam}%` });
      }
      
      // 经理/区经（或前端仍传了 groupName 的旧调用方）：取管辖店铺 + 督导
      if (isManager || groupNameStr) {
        const permissionData = await getPermissionData(pool, groupNameStr || '', req.user || null);
        
        if (permissionData.shops.length > 0) {
          const shopConditions = permissionData.shops.map((shop, i) => {
            params.push({ name: `shop${i}`, type: sql.NVarChar, value: shop });
            return `shopNames LIKE @shop${i}`;
          });
          permissionClauses.push(`(${shopConditions.join(' OR ')})`);
        }
        
        if (permissionData.supervisors.length > 0) {
          const supConditions = permissionData.supervisors.map((sup, i) => {
            params.push({ name: `sup${i}`, type: sql.NVarChar, value: `%${sup}%` });
            return `(assignedTo LIKE @sup${i} OR assignedToName LIKE @sup${i})`;
          });
          permissionClauses.push(`(${supConditions.join(' OR ')})`);
        }
      }
      
      if (permissionClauses.length > 0) {
        whereClauses.push(`(${permissionClauses.join(' OR ')})`);
      }
    }
    
    if (whereClauses.length > 0) {
      query += ' WHERE ' + whereClauses.join(' AND ');
    }
    
    console.log('count查询:', query);
    
    const request = pool.request();
    params.forEach(p => request.input(p.name, p.type, p.value));
    
    const result = await request.query(query);
    
    console.log('count结果:', result.recordset[0].count);
    
    res.json({ count: result.recordset[0].count });
  } catch (error) {
    console.error('获取任务数量失败:', error);
    res.status(500).json({ message: '获取任务数量失败', error: (error as Error).message });
  }
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const pool = await getPool();
    
    const result = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query(`
        SELECT 
          id, title, description, assignedTo, assignedToName, 
          shops, shopNames, deadline, status, createdAt, updatedAt
        FROM InspectionTasks
        WHERE id = @id
      `);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ message: '巡店任务不存在' });
    }
    
    const row = result.recordset[0];
    res.json({
      id: row.id,
      title: row.title,
      description: row.description,
      assignedTo: row.assignedTo,
      assignedToName: row.assignedToName,
      shops: row.shops ? JSON.parse(row.shops) : [],
      shopNames: row.shopNames ? JSON.parse(row.shopNames) : [],
      deadline: row.deadline ? new Date(row.deadline).toISOString().split('T')[0] : '',
      status: row.status,
      createdAt: row.createdAt ? new Date(row.createdAt).toLocaleString() : '',
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '',
      createdBy: '',
      createdByName: ''
    });
  } catch (error) {
    console.error('获取巡店任务详情失败:', error);
    res.status(500).json({ message: '获取巡店任务详情失败', error: (error as Error).message });
  }
});

router.post('/', async (req, res) => {
  const { title, description, assignedTo, assignedToName, shops, shopNames, deadline } = req.body;
  
  try {
    const pool = await getPool();
    
    const deadlineValue = deadline ? new Date(deadline) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    
    const result = await pool.request()
      .input('title', sql.NVarChar, title)
      .input('description', sql.NVarChar, description || '')
      .input('assignedTo', sql.NVarChar, assignedTo)
      .input('assignedToName', sql.NVarChar, assignedToName)
      .input('shops', sql.NVarChar, JSON.stringify(shops || []))
      .input('shopNames', sql.NVarChar, JSON.stringify(shopNames || []))
      .input('deadline', sql.Date, deadlineValue)
      .input('status', sql.NVarChar, 'pending')
      .query(`
        INSERT INTO InspectionTasks 
        (title, description, assignedTo, assignedToName, shops, shopNames, deadline, status, createdAt)
        OUTPUT INSERTED.*
        VALUES (@title, @description, @assignedTo, @assignedToName, @shops, @shopNames, @deadline, @status, GETDATE())
      `);
    
    const newTask = result.recordset[0];
    res.status(201).json({
      id: newTask.id,
      title: newTask.title,
      description: newTask.description,
      assignedTo: newTask.assignedTo,
      assignedToName: newTask.assignedToName,
      shops: newTask.shops ? JSON.parse(newTask.shops) : [],
      shopNames: newTask.shopNames ? JSON.parse(newTask.shopNames) : [],
      deadline: newTask.deadline ? new Date(newTask.deadline).toISOString().split('T')[0] : '',
      status: newTask.status,
      createdAt: newTask.createdAt ? new Date(newTask.createdAt).toLocaleString() : '',
    });
  } catch (error) {
    console.error('创建巡店任务失败:', error);
    res.status(500).json({ message: '创建巡店任务失败', error: (error as Error).message });
  }
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { title, description, assignedTo, assignedToName, shops, shopNames, deadline, status } = req.body;
  
  try {
    const pool = await getPool();
    
    const result = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .input('title', sql.NVarChar, title)
      .input('description', sql.NVarChar, description || '')
      .input('assignedTo', sql.NVarChar, assignedTo)
      .input('assignedToName', sql.NVarChar, assignedToName)
      .input('shops', sql.NVarChar, JSON.stringify(shops || []))
      .input('shopNames', sql.NVarChar, JSON.stringify(shopNames || []))
      .input('deadline', sql.Date, deadline ? new Date(deadline) : null)
      .input('status', sql.NVarChar, status)
      .input('updatedAt', sql.DateTime, new Date())
      .query(`
        UPDATE InspectionTasks 
        SET title = @title, description = @description, assignedTo = @assignedTo, 
            assignedToName = @assignedToName, shops = @shops, shopNames = @shopNames, 
            deadline = @deadline, status = @status, updatedAt = @updatedAt
        OUTPUT INSERTED.*
        WHERE id = @id
      `);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ message: '巡店任务不存在' });
    }
    
    const updatedTask = result.recordset[0];
    res.json({
      id: updatedTask.id,
      title: updatedTask.title,
      description: updatedTask.description,
      assignedTo: updatedTask.assignedTo,
      assignedToName: updatedTask.assignedToName,
      shops: updatedTask.shops ? JSON.parse(updatedTask.shops) : [],
      shopNames: updatedTask.shopNames ? JSON.parse(updatedTask.shopNames) : [],
      deadline: updatedTask.deadline ? new Date(updatedTask.deadline).toISOString().split('T')[0] : '',
      status: updatedTask.status,
      createdAt: updatedTask.createdAt ? new Date(updatedTask.createdAt).toLocaleString() : '',
      updatedAt: updatedTask.updatedAt ? new Date(updatedTask.updatedAt).toLocaleString() : '',
    });
  } catch (error) {
    console.error('更新巡店任务失败:', error);
    res.status(500).json({ message: '更新巡店任务失败', error: (error as Error).message });
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const pool = await getPool();
    
    const result = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('DELETE FROM InspectionTasks WHERE id = @id');
    
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: '巡店任务不存在' });
    }
    
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除巡店任务失败:', error);
    res.status(500).json({ message: '删除巡店任务失败', error: (error as Error).message });
  }
});

router.post('/:id/execute', async (req, res) => {
  const { id } = req.params;
  const timestamp = new Date().toISOString();
  
  console.log(`=== 执行任务请求 [${timestamp}] ===`);
  console.log('任务ID:', id);
  console.log('请求来源:', req.ip);
  console.log('请求时间:', timestamp);
  
  try {
    const pool = await getPool();
    
    const taskResult = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query(`SELECT * FROM InspectionTasks WHERE id = @id`);
    
    if (taskResult.recordset.length === 0) {
      console.log('任务不存在');
      return res.status(404).json({ message: '巡店任务不存在' });
    }
    
    const task = taskResult.recordset[0];
    
    if (task.status === 'in_progress') {
      console.log('任务已处于执行状态，跳过重复执行');
      return res.json({
        id: parseInt(id),
        status: 'in_progress',
        message: '任务已处于执行状态',
      });
    }
    
    const shops = task.shopNames ? JSON.parse(task.shopNames) : [];
    const supervisor = task.assignedToName || task.assignedTo || '未知督导';
    
    console.log('店铺列表:', shops);
    console.log('店铺数量:', shops.length);
    console.log('督导:', supervisor);
    
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    
    try {
      await transaction.request()
        .input('id', sql.Int, parseInt(id))
        .input('status', sql.NVarChar, 'in_progress')
        .input('updatedAt', sql.DateTime, new Date())
        .query(`
          UPDATE InspectionTasks 
          SET status = @status, updatedAt = @updatedAt
          WHERE id = @id
        `);
      
      let createdCount = 0;
      let skippedCount = 0;
      for (const shopName of shops) {
        try {
          console.log(`创建日志: ${supervisor} -> ${shopName}`);
          await transaction.request()
            .input('supervisor', sql.NVarChar, supervisor)
            .input('date', sql.Date, new Date())
            .input('departure', sql.NVarChar, '')
            .input('destination', sql.NVarChar, shopName)
            .input('userId', sql.Int, 1)
            .input('userName', sql.NVarChar, supervisor)
            .input('status', sql.NVarChar, 'draft')
            .query(`
              INSERT INTO StoreInspectionLogs 
              (supervisor, date, departure, destination, userId, userName, status, createdAt)
              VALUES (@supervisor, @date, @departure, @destination, @userId, @userName, @status, GETDATE())
            `);
          createdCount++;
        } catch (insertError: any) {
          if (insertError.number === 2601 || insertError.number === 2627) {
            console.log(`日志已存在（唯一约束），跳过: ${supervisor} -> ${shopName}`);
            skippedCount++;
          } else {
            throw insertError;
          }
        }
      }
      
      await transaction.commit();
      
      console.log(`成功创建 ${createdCount} 条巡店日志，跳过 ${skippedCount} 条重复记录`);
      
      res.json({
        id: parseInt(id),
        status: 'in_progress',
        updatedAt: new Date().toLocaleString(),
        message: `已成功执行任务，为 ${createdCount} 个店铺创建了巡店日志（${skippedCount} 条重复记录已跳过）`,
      });
    } catch (transError) {
      await transaction.rollback();
      throw transError;
    }
  } catch (error: any) {
    console.error('执行巡店任务失败:', error);
    if (error.number === 2601 || error.number === 2627) {
      res.status(409).json({ message: '已存在重复的巡店日志', error: (error as Error).message });
    } else {
      res.status(500).json({ message: '执行巡店任务失败', error: (error as Error).message });
    }
  }
});

export default router;