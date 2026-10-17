import { Router } from 'express';
import sql from 'mssql';
import { LogItem, LogContent, LogModule, LogSubItem } from '../../types';
import { getPool } from '../../config/db';
import { getStandardLogFilter, getStandardShopFilter } from '../services/permissionService';
import { pushInspectionLog } from '../services/wechatPushService';

const router = Router();

const moduleKeys: (keyof LogContent)[] = [
  'coreItems',
  'shopIssues',
  'competitorInfo',
  'marketChanges',
  'marketResearch',
  'staffCollection',
  'teachingTraining'
];

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

function generatePhotoName(date: string, supervisor: string, destination: string, index: number): string {
  const dateStr = date.replace(/-/g, '');
  const cleanSupervisor = supervisor.replace(/[/\\:*?"<>|]/g, '_');
  const cleanDestination = destination.replace(/[/\\:*?"<>|]/g, '_');
  return `${dateStr}_${cleanSupervisor}_${cleanDestination}_${String(index).padStart(3, '0')}.jpg`;
}

router.get('/', async (req, res) => {
  const { userCode, isAdmin, groupName, startDate, endDate, showShared, page, pageSize } = req.query;
  const isAdminBool = isAdmin === 'true' || isAdmin === '是';
  const showSharedBool = showShared === 'true';
  const p = Math.max(1, parseInt(page as string) || 1);
  const ps = parseInt(pageSize as string) || 50;
  const usePagination = ps > 0;

  console.log('=== 获取巡店日志列表 ===');
  console.log('page:', p, 'pageSize:', ps, 'showShared:', showShared);

  try {
    const pool = await getPool();

    let baseQuery = 'FROM StoreInspectionLogs';
    const params: { name: string; type: any; value: any }[] = [];
    const whereClauses: string[] = [];

    if (showSharedBool) {
      whereClauses.push('shareToAll = 1');
      whereClauses.push("status = 'submitted'");
    } else {
      const permissionFilter = await getStandardLogFilter(
        typeof userCode === 'string' ? userCode : '',
        typeof groupName === 'string' ? groupName : undefined,
        isAdminBool,
        req.user || null
      );

      if (permissionFilter.filter) {
        whereClauses.push(permissionFilter.filter);
      }
      params.push(...permissionFilter.params);
    }

    if (startDate && typeof startDate === 'string' && !showSharedBool) {
      whereClauses.push('date >= @startDate');
      params.push({ name: 'startDate', type: sql.Date, value: new Date(startDate) });
    }
    if (endDate && typeof endDate === 'string' && !showSharedBool) {
      whereClauses.push('date <= @endDate');
      params.push({ name: 'endDate', type: sql.Date, value: new Date(endDate) });
    }

    const whereClause = whereClauses.length > 0 ? ' WHERE ' + whereClauses.join(' AND ') : '';

    // 分页查询（列表不返回照片Base64数据，避免传输海量数据导致查询极慢）
    const selectCols = `id, supervisor, date, departure, destination,
      arrivalTime, departureTime, remarks, signature,
      userId, userName, status, createdAt,
      COALESCE(shareToAll, 0) as shareToAll`;

    const orderClause = ' ORDER BY createdAt DESC';
    const pagingClause = usePagination ? ` OFFSET ${(p - 1) * ps} ROWS FETCH NEXT ${ps} ROWS ONLY` : '';

    // 数据查询 + 总数查询（并行）
    const dataQuery = `SELECT ${selectCols} ${baseQuery}${whereClause}${orderClause}${pagingClause}`;
    const countQuery = `SELECT COUNT(*) as total ${baseQuery}${whereClause}`;

    const dataRequest = pool.request();
    const countRequest = pool.request();
    params.forEach(pr => {
      dataRequest.input(pr.name, pr.type, pr.value);
      countRequest.input(pr.name, pr.type, pr.value);
    });

    const [dataResult, countResult] = await Promise.all([
      dataRequest.query(dataQuery),
      countRequest.query(countQuery),
    ]);

    const logs = dataResult.recordset.map((row: any) => ({
      ...row,
      date: row.date instanceof Date ? `${row.date.getFullYear()}-${String(row.date.getMonth()+1).padStart(2,'0')}-${String(row.date.getDate()).padStart(2,'0')}` : String(row.date || ''),
      createdAt: row.createdAt instanceof Date ? `${row.createdAt.getFullYear()}-${String(row.createdAt.getMonth()+1).padStart(2,'0')}-${String(row.createdAt.getDate()).padStart(2,'0')} ${String(row.createdAt.getHours()).padStart(2,'0')}:${String(row.createdAt.getMinutes()).padStart(2,'0')}:${String(row.createdAt.getSeconds()).padStart(2,'0')}` : (row.createdAt || ''),
      shareToAll: row.shareToAll === 1 || row.shareToAll === true
    })) as Omit<LogItem, 'content'>[];

    const total = countResult.recordset[0].total;

    res.json({ data: logs, total, page: p, pageSize: ps });
  } catch (error) {
    console.error('获取巡店日志列表失败:', error);
    res.status(500).json({ message: '获取巡店日志列表失败', error: (error as Error).message });
  }
});

// ---------- 每日日志填报统计 ----------
// 获取每日统计列表（最近N天，默认30天）
router.get('/daily-stats', async (req, res) => {
  const { startDate: qStart, endDate: qEnd, groupName } = req.query;
  try {
    const pool = await getPool();

    // 1. 获取当前用户的仓库类别（用户组列已删：按 JWT 用户代码查本人仓库类别）
    let userWarehouse = '';
    const gn = typeof groupName === 'string' ? groupName : '';
    if (req.user?.userCode || req.user?.userName) {
      const uc = req.user.userCode || req.user.userName || '';
      const whResult = await pool.request()
        .input('uc', sql.NVarChar, uc)
        .query('SELECT TOP 1 仓库类别 FROM 用户全 WHERE 用户代码 = @uc OR 用户名称 = @uc');
      const whs = whResult.recordset.map((r: any) => r.仓库类别).filter(Boolean);
      userWarehouse = whs.join(',');
    }

    // 2. 获取需要填报的人员清单（督导/经理/区经 按标准角色筛选；用户组列已删）
    let requiredSQL = `
      SELECT u.用户名称 as userName, '' as groupName, ISNULL(u.仓库类别,'') as warehouseType
      FROM 用户全 u
      WHERE EXISTS (
        SELECT 1 FROM sys_user_role ur
        JOIN sys_role r ON ur.role_id = r.role_id AND r.del_flag = 0
        WHERE ur.user_code = u.用户代码 AND r.role_code IN ('supervisor','area_manager','ops_director')
      )
        AND u.用户代码 IS NOT NULL AND u.用户代码 <> ''
        AND u.用户名称 IS NOT NULL AND u.用户名称 <> ''
    `;
    if (userWarehouse) {
      const whList = userWarehouse.split(',').map(w => `'${w.trim()}'`).join(',');
      requiredSQL += ` AND ISNULL(仓库类别,'') IN (${whList})`;
    }
    const requiredResult = await pool.request().query(requiredSQL);
    const allRequired = requiredResult.recordset.map((r: any) => ({
      userName: r.userName?.trim(),
      groupName: r.groupName?.trim(),
      warehouseType: r.warehouseType?.trim() || '',
    })).filter((r: any) => r.userName);

    // 按用户权限过滤应填报人员（每日统计列表）
    let requiredList = allRequired;
    const permFilter = await getStandardShopFilter(gn, req.user || null);
    if (permFilter.filter === '1=0') {
      requiredList = [];
    } else if (permFilter.filter) {
      try {
        const svReq = pool.request();
        permFilter.params.forEach((p: any) => svReq.input(p.name, p.type, p.value));
        const allowedSvResult = await svReq.query(`SELECT DISTINCT 督导 as sv FROM 店仓全 WHERE ${permFilter.filter}`);
        const allowedSvs = new Set(allowedSvResult.recordset.map((r: any) => r.sv?.trim()).filter(Boolean));
        if (allowedSvs.size > 0) {
          requiredList = allRequired.filter(r => allowedSvs.has(r.userName));
        }
      } catch { /* 过滤失败则使用全部 */ }
    }
    const totalRequired = requiredList.length;

    // 2. 获取日期范围
    let endDate: Date;
    let startDate: Date;
    if (qEnd && typeof qEnd === 'string') {
      endDate = new Date(qEnd);
    } else {
      endDate = new Date();
    }
    if (qStart && typeof qStart === 'string') {
      startDate = new Date(qStart);
    } else {
      startDate = new Date(endDate.getTime() - 29 * 24 * 60 * 60 * 1000);
    }

    // 3. 一条 SQL 统计每日完成人数（替代之前 O(D*N) 的 JS 嵌套循环）
    const statsResult = await pool.request()
      .input('startDate', sql.Date, startDate)
      .input('endDate', sql.Date, endDate)
      .query(`
        SELECT
          CAST(l.date AS DATE) as logDate,
          COUNT(DISTINCT l.supervisor) as completed
        FROM StoreInspectionLogs l
        WHERE l.status = 'submitted'
          AND l.date >= @startDate
          AND l.date <= @endDate
          AND l.supervisor IS NOT NULL
        GROUP BY CAST(l.date AS DATE)
      `);

    const completedByDate = new Map<string, number>();
    for (const row of statsResult.recordset) {
      const d = row.logDate instanceof Date
        ? row.logDate.toISOString().split('T')[0]
        : String(row.logDate);
      completedByDate.set(d, row.completed);
    }

    // 4. 生成日期列表（SQL 已在服务端聚合，JS 只做轻量遍历）
    const result: Array<{
      date: string;
      totalRequired: number;
      completed: number;
      incomplete: number;
    }> = [];
    const cursor = new Date(startDate);
    const endCursor = new Date(endDate);
    while (cursor <= endCursor) {
      const dateStr = cursor.toISOString().split('T')[0];
      const completed = completedByDate.get(dateStr) || 0;
      result.push({
        date: dateStr,
        totalRequired,
        completed,
        incomplete: totalRequired - completed,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    result.sort((a, b) => b.date.localeCompare(a.date));

    res.json({ totalRequired, dailyStats: result });
  } catch (error) {
    console.error('获取每日日志统计失败:', error);
    res.status(500).json({ message: '获取每日日志统计失败', error: (error as Error).message });
  }
});

// 获取某日详细统计（含每人填报明细 + 累计未提交天数）
router.get('/daily-stats/:date', async (req, res) => {
  const { date: dateStr } = req.params;
  const endDateStr = req.query.endDate as string | undefined;
  const groupName = req.query.groupName as string | undefined;
  try {
    const pool = await getPool();

    // 1. 获取当前用户的仓库类别过滤（用户组列已删：按 JWT 用户代码查本人仓库类别）
    let userWarehouse = '';
    const gn = typeof groupName === 'string' ? groupName : '';
    if (req.user?.userCode || req.user?.userName) {
      const uc = req.user.userCode || req.user.userName || '';
      const whResult = await pool.request()
        .input('uc', sql.NVarChar, uc)
        .query('SELECT TOP 1 仓库类别 FROM 用户全 WHERE 用户代码 = @uc OR 用户名称 = @uc');
      const whs = whResult.recordset.map((r: any) => r.仓库类别).filter(Boolean);
      userWarehouse = whs.join(',');
    }

    // 2. 获取需要填报的人员清单（按标准角色筛选；用户组列已删）
    let requiredSQL = `
      SELECT u.用户名称 as userName, '' as groupName, ISNULL(u.仓库类别,'') as warehouseType
      FROM 用户全 u
      WHERE EXISTS (
        SELECT 1 FROM sys_user_role ur
        JOIN sys_role r ON ur.role_id = r.role_id AND r.del_flag = 0
        WHERE ur.user_code = u.用户代码 AND r.role_code IN ('supervisor','area_manager','ops_director')
      )
        AND u.用户代码 IS NOT NULL AND u.用户代码 <> ''
        AND u.用户名称 IS NOT NULL AND u.用户名称 <> ''
    `;
    if (userWarehouse) {
      const whList = userWarehouse.split(',').map(w => `'${w.trim()}'`).join(',');
      requiredSQL += ` AND ISNULL(仓库类别,'') IN (${whList})`;
    }
    const requiredResult = await pool.request().query(requiredSQL);
    const allRequired2 = requiredResult.recordset.map((r: any) => ({
      userName: r.userName?.trim(),
      groupName: r.groupName?.trim(),
      warehouseType: r.warehouseType?.trim() || '',
    })).filter((r: any) => r.userName);

    // 按用户权限过滤应填报人员（每日统计明细）
    let requiredList = allRequired2;
    const permFilter2 = await getStandardShopFilter(gn, req.user || null);
    if (permFilter2.filter === '1=0') {
      requiredList = [];
    } else if (permFilter2.filter) {
      try {
        const allowedSvResult = await pool.request()
          .query(`SELECT DISTINCT 督导 as sv FROM 店仓全 WHERE ${permFilter2.filter}`);
        const allowedSvs = new Set(allowedSvResult.recordset.map((r: any) => r.sv?.trim()).filter(Boolean));
        if (allowedSvs.size > 0) {
          requiredList = allRequired2.filter(r => allowedSvs.has(r.userName));
        }
      } catch { /* 过滤失败则使用全部 */ }
    }

    // 2. 确定日期范围（用 T00:00:00 强制本地时间，避免 toISOString 时区偏移）
    const startDateObj = new Date(dateStr + 'T00:00:00');
    const endDateObj = endDateStr ? new Date(endDateStr + 'T00:00:00') : new Date(dateStr + 'T00:00:00');

    // 3. 查询日期范围内所有已提交日志（一次性查询，避免 N+1）
    //    注意：传字符串而非 Date 对象，避免 sql.Date 做 toISOString() 时区偏移
    const logsResult = await pool.request()
      .input('startDate', sql.NVarChar, dateStr)
      .input('endDate', sql.NVarChar, endDateStr || dateStr)
      .query(`
        SELECT id, supervisor, date, destination, createdAt
        FROM StoreInspectionLogs
        WHERE status = 'submitted'
          AND CAST(date AS DATE) BETWEEN @startDate AND @endDate
        ORDER BY date DESC, createdAt DESC
      `);

    // 构建 map: dateStr -> Set(supervisorName), dateStr -> Map(supervisorName -> logInfo)
    // 用本地日期格式化，避免 toISOString 时区偏移
    const fmtDate = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const dateSubmittedSet = new Map<string, Set<string>>();
    const dateLogMap = new Map<string, Map<string, any>>();
    for (const row of logsResult.recordset) {
      const dt = row.date instanceof Date ? row.date : new Date(row.date);
      const rowDateStr = fmtDate(dt);
      if (!dateSubmittedSet.has(rowDateStr)) {
        dateSubmittedSet.set(rowDateStr, new Set());
        dateLogMap.set(rowDateStr, new Map());
      }
      const supName = row.supervisor?.trim();
      if (supName) {
        dateSubmittedSet.get(rowDateStr)!.add(supName);
        if (!dateLogMap.get(rowDateStr)!.has(supName)) {
          dateLogMap.get(rowDateStr)!.set(supName, row);
        }
      }
    }

    // 4. 生成日期列表（用本地日期格式化）
    const dateList: string[] = [];
    const tempDate = new Date(startDateObj);
    const endTemp = new Date(endDateObj);
    while (tempDate <= endTemp) {
      dateList.push(fmtDate(tempDate));
      tempDate.setDate(tempDate.getDate() + 1);
    }

    // 5. 计算累计未提交天数（从系统最早日志日期到今天）
    const earliestResult = await pool.request().query(`
      SELECT MIN(CAST(date AS DATE)) as earliestDate
      FROM StoreInspectionLogs
      WHERE status = 'submitted'
    `);
    const earliestDate = earliestResult.recordset[0]?.earliestDate;

    if (!earliestDate) {
      const details: any[] = [];
      for (const dateKey of dateList) {
        for (const p of requiredList) {
          details.push({
            date: dateKey,
            userName: p.userName,
            groupName: p.groupName,
            warehouseType: p.warehouseType || '',
            submitted: false,
            logId: null,
            destination: null,
            submittedAt: null,
            cumulativeMissed: 0,
          });
        }
      }
      res.json({
        date: dateStr,
        startDate: dateList[0] || dateStr,
        endDate: dateList[dateList.length - 1] || dateStr,
        totalRequired: details.length,
        completed: 0,
        incomplete: details.length,
        earliestDate: null,
        totalDays: 0,
        details,
      });
      return;
    }

    const earliestDateObj = earliestDate instanceof Date ? earliestDate : new Date(earliestDate);
    const todayObj = new Date();
    todayObj.setHours(0, 0, 0, 0);
    const totalDays = Math.floor((todayObj.getTime() - earliestDateObj.getTime()) / (24 * 60 * 60 * 1000)) + 1;

    // 获取每个人累计提交天数
    const allSubmittedResult = await pool.request().query(`
      SELECT supervisor, COUNT(DISTINCT CAST(date AS DATE)) as submittedDays
      FROM StoreInspectionLogs
      WHERE status = 'submitted'
      GROUP BY supervisor
    `);
    const submittedDaysMap = new Map<string, number>();
    for (const row of allSubmittedResult.recordset) {
      const name = row.supervisor?.trim();
      if (name) {
        submittedDaysMap.set(name, row.submittedDays);
      }
    }

    // 6. 构建详细列表 —— 每天每人一行
    const details: any[] = [];
    // 日期倒序排列（最近的在前）
    for (let i = dateList.length - 1; i >= 0; i--) {
      const dateKey = dateList[i];
      const daySubmittedSet = dateSubmittedSet.get(dateKey) || new Set<string>();
      const dayLogMap = dateLogMap.get(dateKey) || new Map<string, any>();

      for (const p of requiredList) {
        const submitted = daySubmittedSet.has(p.userName);
        const logInfo = dayLogMap.get(p.userName);
        const submittedDays = submittedDaysMap.get(p.userName) || 0;
        const cumulativeMissed = Math.max(0, totalDays - submittedDays);
        details.push({
          date: dateKey,
          userName: p.userName,
          groupName: p.groupName,
          warehouseType: p.warehouseType || '',
          submitted,
          logId: logInfo?.id || null,
          destination: logInfo?.destination || null,
          submittedAt: logInfo?.createdAt
            ? (() => { const d = new Date(logInfo.createdAt); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`; })()
            : null,
          cumulativeMissed,
        });
      }
    }

    const completed = details.filter(d => d.submitted).length;
    res.json({
      date: dateStr,
      startDate: dateList[0] || dateStr,
      endDate: dateList[dateList.length - 1] || dateStr,
      totalRequired: details.length,
      completed,
      incomplete: details.length - completed,
      earliestDate: earliestDateObj instanceof Date
        ? fmtDate(earliestDateObj)
        : String(earliestDateObj),
      totalDays,
      details,
    });
  } catch (error) {
    console.error('获取日志详细统计失败:', error);
    res.status(500).json({ message: '获取日志详细统计失败', error: (error as Error).message });
  }
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const pool = await getPool();
    
    const logResult = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query(`
        SELECT
          id, supervisor, date, departure, destination,
          arrivalTime, departureTime, remarks, signature,
          userId, userName, status, createdAt,
          checkInPhoto, checkOutPhoto
        FROM StoreInspectionLogs
        WHERE id = @id
      `);
    
    if (logResult.recordset.length === 0) {
      res.status(404).json({ message: '巡店日志不存在' });
      return;
    }
    
    const log = logResult.recordset[0];
    
    const itemsResult = await pool.request()
      .input('logId', sql.Int, log.id)
      .query(`
        SELECT logId, moduleType, itemIndex, itemContent, itemResult, photoPath, photoName
        FROM StoreInspectionLogItems
        WHERE logId = @logId
        ORDER BY moduleType, itemIndex
      `);
    
    const content: LogContent = {
      coreItems: [],
      shopIssues: [],
      competitorInfo: [],
      marketChanges: [],
      marketResearch: [],
      staffCollection: [],
      teachingTraining: [],
    };
    
    const itemsMap = new Map<string, LogSubItem[]>();
    
    itemsResult.recordset.forEach((item: any) => {
      const key = `${item.moduleType}_${item.itemIndex}`;
      if (!itemsMap.has(key)) {
        itemsMap.set(key, []);
      }
      itemsMap.get(key)!.push({
        item: item.itemContent,
        result: item.itemResult,
        photo: item.photoPath || null,
        photoName: item.photoName || null,
      });
    });
    
    itemsMap.forEach((items, key) => {
      const [moduleType, index] = key.split('_');
      if (moduleKeys.includes(moduleType as keyof LogContent)) {
        (content[moduleType as keyof LogContent] as LogModule[]) = [{ items }];
      }
    });
    
    res.json({
      ...log,
      date: log.date instanceof Date ? `${log.date.getFullYear()}-${String(log.date.getMonth()+1).padStart(2,'0')}-${String(log.date.getDate()).padStart(2,'0')}` : String(log.date || ''),
      content
    });
  } catch (error) {
    console.error('获取巡店日志详情失败:', error);
    res.status(500).json({ message: '获取巡店日志详情失败', error: (error as Error).message });
  }
});

router.post('/', async (req, res) => {
  const { supervisor, date, departure, destination, arrivalTime, departureTime, remarks, content, signature, userId, userName, status, isNoInspection, checkInPhoto, checkOutPhoto } = req.body;
  const timestamp = new Date().toISOString();
  
  console.log(`=== 创建巡店日志 [${timestamp}] ===`);
  console.log('请求来源:', req.ip);
  console.log('请求时间:', timestamp);
  console.log('supervisor:', supervisor);
  console.log('destination:', destination);
  console.log('departure:', departure);
  console.log('date:', date);
  console.log('content类型:', typeof content);
  console.log('content:', JSON.stringify(content, null, 2));
  console.log('isNoInspection:', isNoInspection);
  
  try {
    const pool = await getPool();
    
    // 提交时必须有签名（未巡店说明跳过验证）
    if ((status || 'draft') === 'submitted' && !signature?.trim() && !isNoInspection) {
      res.status(400).json({ message: '提交日志必须填写签名' });
      return;
    }
    
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    console.log('事务已开始');
    
    try {
      const logResult = await transaction.request()
        .input('supervisor', sql.NVarChar, supervisor)
        .input('date', sql.Date, new Date(date))
        .input('departure', sql.NVarChar, departure)
        .input('destination', sql.NVarChar, destination)
        .input('arrivalTime', sql.NVarChar, arrivalTime || '')
        .input('departureTime', sql.NVarChar, departureTime || '')
        .input('remarks', sql.NVarChar, remarks || '')
        .input('signature', sql.NVarChar, signature || '')
        .input('userId', sql.Int, userId || 1)
        .input('userName', sql.NVarChar, userName || supervisor)
        .input('status', sql.NVarChar, status || 'draft')
        .input('checkInPhoto', sql.NVarChar, checkInPhoto || null)
        .input('checkOutPhoto', sql.NVarChar, checkOutPhoto || null)
        .query(`
          INSERT INTO StoreInspectionLogs
          (supervisor, date, departure, destination, arrivalTime, departureTime, remarks, signature, userId, userName, status, createdAt, checkInPhoto, checkOutPhoto)
          OUTPUT INSERTED.*
          VALUES (@supervisor, @date, @departure, @destination, @arrivalTime, @departureTime, @remarks, @signature, @userId, @userName, @status, GETDATE(), @checkInPhoto, @checkOutPhoto)
        `);
      
      const newLog = logResult.recordset[0];
      const logId = newLog.id;
      console.log('日志主表插入成功，logId:', logId);
      
      if (content) {
        for (const moduleType of moduleKeys) {
          const modules = content[moduleType] || [];
          console.log(`处理模块 ${moduleType}，数量: ${modules.length}`);
          
          for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex++) {
            const module = modules[moduleIndex];
            const items = module.items || [];
            console.log(`处理模块索引 ${moduleIndex}，项目数量: ${items.length}`);
            
            for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
              const item = items[itemIndex];
              console.log(`处理项目索引 ${itemIndex}:`, item);
              
              await transaction.request()
                .input('logId', sql.Int, logId)
                .input('moduleType', sql.NVarChar, moduleType)
                .input('moduleTypeName', sql.NVarChar, getModuleTypeName(moduleType))
                .input('itemIndex', sql.Int, moduleIndex)
                .input('itemContent', sql.NVarChar, item.item || '')
                .input('itemResult', sql.NVarChar, item.result || '')
                .input('photoPath', sql.NVarChar, item.photo || '')
                .input('photoName', sql.NVarChar, item.photoName || '')
                .query(`
                  INSERT INTO StoreInspectionLogItems 
                  (logId, moduleType, moduleTypeName, itemIndex, itemContent, itemResult, photoPath, photoName)
                  VALUES (@logId, @moduleType, @moduleTypeName, @itemIndex, @itemContent, @itemResult, @photoPath, @photoName)
                `);
            }
          }
        }
      } else {
        console.log('content为空，跳过子表插入');
      }
      
      // 新建日志直接提交时，检查关联任务是否完成
      if ((status || 'draft') === 'submitted') {
        console.log('新建日志已提交，检查关联任务是否完成...');
        
        const taskResult = await transaction.request()
          .input('supervisor', sql.NVarChar, supervisor)
          .query(`
            SELECT id, shopNames, status 
            FROM InspectionTasks 
            WHERE assignedToName = @supervisor AND status = 'in_progress'
            ORDER BY createdAt DESC
          `);
        
        for (const task of taskResult.recordset) {
          const shopNames = task.shopNames ? JSON.parse(task.shopNames) : [];
          console.log('任务关联店铺:', shopNames);
          
          if (shopNames.length > 0) {
            const pendingLogRequest = transaction.request();
            pendingLogRequest.input('supervisor', sql.NVarChar, supervisor);
            
            const placeholders = shopNames.map((_shop: string, i: number) => {
              pendingLogRequest.input(`shop${i}`, sql.NVarChar, shopNames[i]);
              return `@shop${i}`;
            }).join(', ');
            
            const pendingLogQuery = `
              SELECT COUNT(*) as count 
              FROM StoreInspectionLogs 
              WHERE supervisor = @supervisor AND status = 'draft'
                AND destination IN (${placeholders})
            `;
            
            const pendingLogResult = await pendingLogRequest.query(pendingLogQuery);
            const pendingCount = pendingLogResult.recordset[0].count;
            
            console.log('待提交日志数量:', pendingCount);
            
            if (pendingCount === 0) {
              console.log('所有日志已提交，更新任务状态为 completed...');
              await transaction.request()
                .input('taskId', sql.Int, task.id)
                .query(`UPDATE InspectionTasks SET status = 'completed' WHERE id = @taskId`);
              console.log('任务状态已更新为 completed');
            }
          }
        }
      }
      
      await transaction.commit();
      console.log('事务已提交');
      
      // 新建日志直接提交时，延迟触发企业微信推送
      if ((status || 'draft') === 'submitted') {
        const theLogId = newLog.id;
        setTimeout(async () => {
          try {
            console.log(`[WechatPush] 新建日志 ${theLogId} 提交后触发自动推送`);
            const r = await pushInspectionLog(theLogId, 'auto');
            console.log(`[WechatPush] 推送结果：${r.summary}`);
          } catch (err) {
            console.error(`[WechatPush] 推送 logId=${theLogId} 异常:`, err);
          }
        }, 10 * 1000);
      }
      
      res.status(201).json({
        id: newLog.id,
        supervisor: newLog.supervisor,
        date: newLog.date instanceof Date ? newLog.date.toISOString().split('T')[0] : String(newLog.date || ''),
        departure: newLog.departure,
        destination: newLog.destination,
        status: newLog.status,
        createdAt: newLog.createdAt ? (() => { const d = new Date(newLog.createdAt); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`; })() : ''
      });
    } catch (error) {
      await transaction.rollback();
      console.error('事务回滚:', error);
      throw error;
    }
  } catch (error) {
    console.error('创建巡店日志失败:', error);
    res.status(500).json({ message: '创建巡店日志失败', error: (error as Error).message });
  }
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { supervisor, date, departure, destination, arrivalTime, departureTime, remarks, signature, content, status, shareToAll, checkInPhoto, checkOutPhoto } = req.body;
  
  try {
    const pool = await getPool();
    
    // 提交时必须有签名
    if (status === 'submitted') {
      // 如果请求体里有 signature 字段，检查非空
      if (signature !== undefined && !signature.trim()) {
        res.status(400).json({ message: '提交日志必须填写签名' });
        return;
      }
      // 如果请求体没有 signature 字段，查库确认已有签名
      if (signature === undefined) {
        const checkResult = await pool.request()
          .input('id', sql.Int, parseInt(id))
          .query('SELECT signature FROM StoreInspectionLogs WHERE id = @id');
        if (checkResult.recordset.length === 0 || !checkResult.recordset[0].signature?.trim()) {
          res.status(400).json({ message: '提交日志必须填写签名' });
          return;
        }
      }
    }
    
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    
    try {
      const updateFields: string[] = [];
      const updateParams: { name: string; type: any; value: any }[] = [];
      
      if (supervisor !== undefined) {
        updateFields.push('supervisor = @supervisor');
        updateParams.push({ name: 'supervisor', type: sql.NVarChar, value: supervisor });
      }
      if (date !== undefined) {
        updateFields.push('date = @date');
        updateParams.push({ name: 'date', type: sql.Date, value: new Date(date) });
      }
      if (departure !== undefined) {
        updateFields.push('departure = @departure');
        updateParams.push({ name: 'departure', type: sql.NVarChar, value: departure });
      }
      if (destination !== undefined) {
        updateFields.push('destination = @destination');
        updateParams.push({ name: 'destination', type: sql.NVarChar, value: destination });
      }
      if (arrivalTime !== undefined) {
        updateFields.push('arrivalTime = @arrivalTime');
        updateParams.push({ name: 'arrivalTime', type: sql.NVarChar, value: arrivalTime });
      }
      if (departureTime !== undefined) {
        updateFields.push('departureTime = @departureTime');
        updateParams.push({ name: 'departureTime', type: sql.NVarChar, value: departureTime });
      }
      if (remarks !== undefined) {
        updateFields.push('remarks = @remarks');
        updateParams.push({ name: 'remarks', type: sql.NVarChar, value: remarks });
      }
      if (signature !== undefined) {
        updateFields.push('signature = @signature');
        updateParams.push({ name: 'signature', type: sql.NVarChar, value: signature });
      }
      if (status !== undefined) {
        updateFields.push('status = @status');
        updateParams.push({ name: 'status', type: sql.NVarChar, value: status });
      }
      if (shareToAll !== undefined) {
        updateFields.push('shareToAll = @shareToAll');
        updateParams.push({ name: 'shareToAll', type: sql.Bit, value: shareToAll });
      }
      if (checkInPhoto !== undefined) {
        updateFields.push('checkInPhoto = @checkInPhoto');
        updateParams.push({ name: 'checkInPhoto', type: sql.NVarChar, value: checkInPhoto });
      }
      if (checkOutPhoto !== undefined) {
        updateFields.push('checkOutPhoto = @checkOutPhoto');
        updateParams.push({ name: 'checkOutPhoto', type: sql.NVarChar, value: checkOutPhoto });
      }
      
      if (updateFields.length === 0) {
        await transaction.rollback();
        res.status(400).json({ message: '没有需要更新的字段' });
        return;
      }
      
      const updateQuery = `UPDATE StoreInspectionLogs SET ${updateFields.join(', ')} WHERE id = @id`;
      updateParams.push({ name: 'id', type: sql.Int, value: parseInt(id) });
      
      const updateRequest = transaction.request();
      updateParams.forEach(p => updateRequest.input(p.name, p.type, p.value));
      await updateRequest.query(updateQuery);
      
      if (content) {
        await transaction.request()
          .input('logId', sql.Int, parseInt(id))
          .query('DELETE FROM StoreInspectionLogItems WHERE logId = @logId');
        
        for (const moduleType of moduleKeys) {
          const modules = content[moduleType] || [];
          
          for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex++) {
            const module = modules[moduleIndex];
            const items = module.items || [];
            
            for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
              const item = items[itemIndex];
              
              await transaction.request()
                .input('logId', sql.Int, parseInt(id))
                .input('moduleType', sql.NVarChar, moduleType)
                .input('moduleTypeName', sql.NVarChar, getModuleTypeName(moduleType))
                .input('itemIndex', sql.Int, moduleIndex)
                .input('itemContent', sql.NVarChar, item.item || '')
                .input('itemResult', sql.NVarChar, item.result || '')
                .input('photoPath', sql.NVarChar, item.photo || '')
                .input('photoName', sql.NVarChar, item.photoName || '')
                .query(`
                  INSERT INTO StoreInspectionLogItems 
                  (logId, moduleType, moduleTypeName, itemIndex, itemContent, itemResult, photoPath, photoName)
                  VALUES (@logId, @moduleType, @moduleTypeName, @itemIndex, @itemContent, @itemResult, @photoPath, @photoName)
                `);
            }
          }
        }
      }
      
      if (status === 'submitted') {
        console.log('日志已提交，检查关联任务是否完成...');
        
        const logResult = await transaction.request()
          .input('logId', sql.Int, parseInt(id))
          .query(`SELECT supervisor, destination FROM StoreInspectionLogs WHERE id = @logId`);
        
        if (logResult.recordset.length > 0) {
          const log = logResult.recordset[0];
          console.log('日志督导:', log.supervisor);
          console.log('日志店铺:', log.destination);
          
          const taskResult = await transaction.request()
            .input('supervisor', sql.NVarChar, log.supervisor)
            .query(`
              SELECT id, shopNames, status 
              FROM InspectionTasks 
              WHERE assignedToName = @supervisor AND status = 'in_progress'
              ORDER BY createdAt DESC
            `);
          
          for (const task of taskResult.recordset) {
            const shopNames = task.shopNames ? JSON.parse(task.shopNames) : [];
            console.log('任务关联店铺:', shopNames);
            
            if (shopNames.length > 0) {
              const pendingLogRequest = transaction.request();
              pendingLogRequest.input('supervisor', sql.NVarChar, log.supervisor);
              
              const placeholders = shopNames.map((_shop: string, i: number) => {
                pendingLogRequest.input(`shop${i}`, sql.NVarChar, shopNames[i]);
                return `@shop${i}`;
              }).join(', ');
              
              const pendingLogQuery = `
                SELECT COUNT(*) as count 
                FROM StoreInspectionLogs 
                WHERE supervisor = @supervisor AND status = 'draft'
                  AND destination IN (${placeholders})
              `;
              
              const pendingLogResult = await pendingLogRequest.query(pendingLogQuery);
              const pendingCount = pendingLogResult.recordset[0].count;
              
              console.log('待提交日志数量:', pendingCount);
              
              if (pendingCount === 0) {
                console.log('所有日志已提交，更新任务状态为 completed...');
                await transaction.request()
                  .input('taskId', sql.Int, task.id)
                  .query(`UPDATE InspectionTasks SET status = 'completed' WHERE id = @taskId`);
                console.log('任务状态已更新为 completed');
              }
            }
          }
        }

        // ---------- 自动触发企业微信推送 ----------
        // 数据入库后，延迟 10 秒再读取、推送，规避事务未提交导致字段读取为空
        const theLogId = parseInt(id);
        setTimeout(async () => {
          try {
            console.log(`[WechatPush] 日志 ${theLogId} 提交后触发自动推送`);
            const r = await pushInspectionLog(theLogId, 'auto');
            console.log(`[WechatPush] 推送结果：${r.summary}`);
          } catch (err) {
            console.error(`[WechatPush] 推送 logId=${theLogId} 异常:`, err);
          }
        }, 10 * 1000);
      }
      
      await transaction.commit();
      
      res.json({ message: '巡店日志更新成功' });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('更新巡店日志失败:', error);
    res.status(500).json({ message: '更新巡店日志失败', error: (error as Error).message });
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const pool = await getPool();
    
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    
    try {
      await transaction.request()
        .input('logId', sql.Int, parseInt(id))
        .query('DELETE FROM StoreInspectionLogItems WHERE logId = @logId');
      
      await transaction.request()
        .input('id', sql.Int, parseInt(id))
        .query('DELETE FROM StoreInspectionLogs WHERE id = @id');
      
      await transaction.commit();
      
      res.json({ message: '巡店日志删除成功' });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('删除巡店日志失败:', error);
    res.status(500).json({ message: '删除巡店日志失败', error: (error as Error).message });
  }
});

router.put('/:id/share', async (req, res) => {
  const { id } = req.params;
  
  try {
    const pool = await getPool();
    
    const result = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query(`
        UPDATE StoreInspectionLogs 
        SET shareToAll = 1 
        WHERE id = @id AND status = 'submitted'
        OUTPUT INSERTED.*
      `);
    
    if (result.recordset.length === 0) {
      res.status(400).json({ message: '只能分享已提交的日志' });
      return;
    }
    
    res.json({ message: '日志已共享给全员', shareToAll: true });
  } catch (error) {
    console.error('共享日志失败:', error);
    res.status(500).json({ message: '共享日志失败', error: (error as Error).message });
  }
});

export default router;
