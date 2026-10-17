import { Router, Request, Response } from 'express';
import sql from 'mssql';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { getPool } from '../../config/db';
import { sendTextToUser } from './wechatPush';

const router = Router();
let ensured = false;

// 文件上传配置（磁盘存储，与 reimbursement 模块一致）
const vehicleUpload = multer({
  storage: multer.diskStorage({
    destination(_req: any, _file: any, cb: any) {
      const dir = path.resolve(process.cwd(), 'uploads', 'vehicle');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req: any, file: any, cb: any) {
      const ext = path.extname(file.originalname) || '.png';
      cb(null, 'vehicle_' + Date.now() + '_' + Math.round(Math.random() * 1e6) + ext);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// 资产图片上传配置
const assetUpload = multer({
  storage: multer.diskStorage({
    destination(_req: any, _file: any, cb: any) {
      const dir = path.resolve(process.cwd(), 'uploads', 'asset');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req: any, file: any, cb: any) {
      const ext = path.extname(file.originalname) || '.png';
      cb(null, 'asset_' + Date.now() + '_' + Math.round(Math.random() * 1e6) + ext);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// ============================================================
// 建表逻辑（幂等）
// ============================================================
async function ensureTables(): Promise<void> {
  if (ensured) return;
  const pool = await getPool();

  // 1. 固定资产档案表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'FA_Assets')
    CREATE TABLE FA_Assets (
      id INT IDENTITY(1,1) PRIMARY KEY,
      assetNo NVARCHAR(50) NOT NULL,
      assetName NVARCHAR(200) NOT NULL,
      category NVARCHAR(100),
      assetOwnership NVARCHAR(50),
      specModel NVARCHAR(200),
      purchaseDate DATE,
      purchasePrice DECIMAL(18,2) DEFAULT 0,
      supplier NVARCHAR(200),
      invoiceNo NVARCHAR(100),
      status NVARCHAR(30) DEFAULT 'inuse',
      depreciationMethod NVARCHAR(50),
      originalValue DECIMAL(18,2) DEFAULT 0,
      accumulatedDepreciation DECIMAL(18,2) DEFAULT 0,
      netValue DECIMAL(18,2) DEFAULT 0,
      remark NVARCHAR(MAX),
      createdBy NVARCHAR(100),
      createdByName NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE()
    )
  `);

  // 1b. FA_Assets 字段升级：新增折旧方案关联 schemeId、供应商联系电话 supplierPhone、总数量 totalQuantity
  await pool.request().query(`
    IF COL_LENGTH('FA_Assets','schemeId') IS NULL
    ALTER TABLE FA_Assets ADD schemeId INT
  `);
  await pool.request().query(`
    IF COL_LENGTH('FA_Assets','supplierPhone') IS NULL
    ALTER TABLE FA_Assets ADD supplierPhone NVARCHAR(50)
  `);
  await pool.request().query(`
    IF COL_LENGTH('FA_Assets','totalQuantity') IS NULL
    ALTER TABLE FA_Assets ADD totalQuantity INT DEFAULT 1
  `);

  // 1c. FA_Assets 新增 assetOwnership 字段
  await pool.request().query(`
    IF COL_LENGTH('FA_Assets','assetOwnership') IS NULL
    ALTER TABLE FA_Assets ADD assetOwnership NVARCHAR(50)
  `);

  // 1e. FA_Assets 新增条码字段 barcode
  await pool.request().query(`
    IF COL_LENGTH('FA_Assets','barcode') IS NULL
    ALTER TABLE FA_Assets ADD barcode NVARCHAR(200)
  `);

  // 1f. FA_Assets 新增图片字段 imagePath
  await pool.request().query(`
    IF COL_LENGTH('FA_Assets','imagePath') IS NULL
    ALTER TABLE FA_Assets ADD imagePath NVARCHAR(500)
  `);

  // 1d. FA_Assets 清理废弃字段：location/department/userId/userName 已迁移到 FA_AssetDistribution 表
  await pool.request().query(`
    IF COL_LENGTH('FA_Assets','location') IS NOT NULL ALTER TABLE FA_Assets DROP COLUMN location;
    IF COL_LENGTH('FA_Assets','department') IS NOT NULL ALTER TABLE FA_Assets DROP COLUMN department;
    IF COL_LENGTH('FA_Assets','userId') IS NOT NULL ALTER TABLE FA_Assets DROP COLUMN userId;
    IF COL_LENGTH('FA_Assets','userName') IS NOT NULL ALTER TABLE FA_Assets DROP COLUMN userName;
  `);

  // 2. 资产变动记录表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'FA_TransferLog')
    CREATE TABLE FA_TransferLog (
      id INT IDENTITY(1,1) PRIMARY KEY,
      assetId INT NOT NULL,
      transferType NVARCHAR(50) NOT NULL,
      fromDept NVARCHAR(200),
      toDept NVARCHAR(200),
      fromUser NVARCHAR(100),
      toUser NVARCHAR(100),
      fromLocation NVARCHAR(200),
      toLocation NVARCHAR(200),
      reason NVARCHAR(500),
      status NVARCHAR(30) DEFAULT 'pending',
      approverId NVARCHAR(100),
      approverName NVARCHAR(100),
      approvalDate DATETIME,
      approvalRemark NVARCHAR(500),
      operateDate DATE,
      createdBy NVARCHAR(100),
      createdByName NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);

  // 3. 盘点任务表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'FA_Inventory')
    CREATE TABLE FA_Inventory (
      id INT IDENTITY(1,1) PRIMARY KEY,
      taskName NVARCHAR(200) NOT NULL,
      taskScope NVARCHAR(500),
      status NVARCHAR(30) DEFAULT 'inprogress',
      startDate DATE,
      endDate DATE,
      createdBy NVARCHAR(100),
      createdByName NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);

  // 4. 盘点明细表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'FA_InventoryDetail')
    CREATE TABLE FA_InventoryDetail (
      id INT IDENTITY(1,1) PRIMARY KEY,
      inventoryId INT NOT NULL,
      assetId INT,
      assetNo NVARCHAR(50),
      assetName NVARCHAR(200),
      bookLocation NVARCHAR(200),
      actualLocation NVARCHAR(200),
      bookUser NVARCHAR(100),
      actualUser NVARCHAR(100),
      result NVARCHAR(30) DEFAULT 'normal',
      remark NVARCHAR(500),
      checkedBy NVARCHAR(100),
      checkedByName NVARCHAR(100),
      checkedAt DATETIME DEFAULT GETDATE()
    )
  `);

  // 5. 报废处置表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'FA_Disposal')
    CREATE TABLE FA_Disposal (
      id INT IDENTITY(1,1) PRIMARY KEY,
      assetId INT NOT NULL,
      disposalReason NVARCHAR(500),
      disposalDate DATE,
      residualValue DECIMAL(18,2) DEFAULT 0,
      disposalMethod NVARCHAR(100),
      status NVARCHAR(30) DEFAULT 'pending',
      approverId NVARCHAR(100),
      approverName NVARCHAR(100),
      approvalDate DATETIME,
      approvalRemark NVARCHAR(500),
      createdBy NVARCHAR(100),
      createdByName NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);

  // 6. 车辆档案表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'VM_Vehicles')
    CREATE TABLE VM_Vehicles (
      id INT IDENTITY(1,1) PRIMARY KEY,
      plateNo NVARCHAR(50) NOT NULL,
      vehicleType NVARCHAR(100),
      frameNo NVARCHAR(100),
      purchaseDate DATE,
      purchaseAmount DECIMAL(18,2) DEFAULT 0,
      status NVARCHAR(30) DEFAULT 'inuse',
      department NVARCHAR(200),
      driver NVARCHAR(100),
      driverId NVARCHAR(100),
      insuranceExpiryDate DATE,
      inspectionExpiryDate DATE,
      maintenanceExpiryDate DATE,
      remark NVARCHAR(MAX),
      createdBy NVARCHAR(100),
      createdByName NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE()
    )
  `);

  // 6b. VM_Vehicles 字段升级：新增行驶证号 licenseNo、归属组织 orgId
  await pool.request().query(`
    IF COL_LENGTH('VM_Vehicles','licenseNo') IS NULL
    ALTER TABLE VM_Vehicles ADD licenseNo NVARCHAR(100)
  `);
  await pool.request().query(`
    IF COL_LENGTH('VM_Vehicles','orgId') IS NULL
    ALTER TABLE VM_Vehicles ADD orgId INT
  `);
  // 6c. 总行驶公里数（期初里程 + 归还联动更新）
  await pool.request().query(`
    IF COL_LENGTH('VM_Vehicles','totalMileage') IS NULL
    ALTER TABLE VM_Vehicles ADD totalMileage DECIMAL(12,1) DEFAULT 0
  `);
  // 6d. 车架号 VIN（必填，建档时录入）
  await pool.request().query(`
    IF COL_LENGTH('VM_Vehicles','vin') IS NULL
    ALTER TABLE VM_Vehicles ADD vin NVARCHAR(50)
  `);
  // 6e. 年检照片路径
  await pool.request().query(`
    IF COL_LENGTH('VM_Vehicles','inspectionPhotoPath') IS NULL
    ALTER TABLE VM_Vehicles ADD inspectionPhotoPath NVARCHAR(MAX)
  `);
  // 6f. 保险资料文件路径（PDF/照片）
  await pool.request().query(`
    IF COL_LENGTH('VM_Vehicles','insuranceFilePath') IS NULL
    ALTER TABLE VM_Vehicles ADD insuranceFilePath NVARCHAR(MAX)
  `);
  // 6g. 百公里油耗（L/100km），派车时用于计算续航
  await pool.request().query(`
    IF COL_LENGTH('VM_Vehicles','fuelConsumption') IS NULL
    ALTER TABLE VM_Vehicles ADD fuelConsumption DECIMAL(8,2) DEFAULT 8
  `);
  // 6h. 车辆能源类型：fuel 油车 / electric 电车
  await pool.request().query(`
    IF COL_LENGTH('VM_Vehicles','energyType') IS NULL
    ALTER TABLE VM_Vehicles ADD energyType NVARCHAR(20) DEFAULT 'fuel'
  `);

  // 7. 车辆维保记录表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'VM_Maintenance')
    CREATE TABLE VM_Maintenance (
      id INT IDENTITY(1,1) PRIMARY KEY,
      vehicleId INT NOT NULL,
      maintenanceType NVARCHAR(50) NOT NULL,
      maintenanceDate DATE NOT NULL,
      amount DECIMAL(18,2) DEFAULT 0,
      fuelLiters DECIMAL(10,2) DEFAULT 0,
      mileage DECIMAL(10,1) DEFAULT 0,
      supplier NVARCHAR(200),
      remark NVARCHAR(500),
      voucherPath NVARCHAR(MAX),
      createdBy NVARCHAR(100),
      createdByName NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);

  // 8. 违章事故表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'VM_Violation')
    CREATE TABLE VM_Violation (
      id INT IDENTITY(1,1) PRIMARY KEY,
      vehicleId INT NOT NULL,
      violationType NVARCHAR(50) NOT NULL,
      violationDate DATE NOT NULL,
      location NVARCHAR(200),
      description NVARCHAR(MAX),
      penaltyAmount DECIMAL(18,2) DEFAULT 0,
      demeritPoints INT DEFAULT 0,
      responsibleParty NVARCHAR(200),
      handlingResult NVARCHAR(500),
      status NVARCHAR(30) DEFAULT 'unprocessed',
      createdBy NVARCHAR(100),
      createdByName NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);

  // 9. 用车申请表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'VA_Application')
    CREATE TABLE VA_Application (
      id INT IDENTITY(1,1) PRIMARY KEY,
      applicationNo NVARCHAR(50) NOT NULL,
      applicantId NVARCHAR(100) NOT NULL,
      applicantName NVARCHAR(100) NOT NULL,
      department NVARCHAR(200),
      usageDate DATE NOT NULL,
      returnDate DATE,
      destination NVARCHAR(500) NOT NULL,
      purpose NVARCHAR(500) NOT NULL,
      passengers NVARCHAR(500),
      estimatedMileage DECIMAL(10,1) DEFAULT 0,
      status NVARCHAR(30) DEFAULT 'pending',
      deptApproverId NVARCHAR(100),
      deptApproverName NVARCHAR(100),
      deptApprovalDate DATETIME,
      deptApprovalRemark NVARCHAR(500),
      adminDispatcherId NVARCHAR(100),
      adminDispatcherName NVARCHAR(100),
      dispatchDate DATETIME,
      assignedVehicleId INT,
      assignedVehiclePlate NVARCHAR(50),
      assignedDriver NVARCHAR(100),
      dispatchRemark NVARCHAR(500),
      createdBy NVARCHAR(100),
      createdByName NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE()
    )
  `);

  // 幂等添加 VA_Application.waitRemark 列（存储"请等待"提示信息，供申请人查看）
  await pool.request().query(`
    IF COL_LENGTH('VA_Application','waitRemark') IS NULL
    ALTER TABLE VA_Application ADD waitRemark NVARCHAR(MAX)
  `);
  // 9c. VA_Application 字段升级：新增驾驶员 driver（申请时选择）、剩余油数 remainingFuel
  await pool.request().query(`
    IF COL_LENGTH('VA_Application','driver') IS NULL
    ALTER TABLE VA_Application ADD driver NVARCHAR(100)
  `);
  await pool.request().query(`
    IF COL_LENGTH('VA_Application','remainingFuel') IS NULL
    ALTER TABLE VA_Application ADD remainingFuel DECIMAL(10,1) DEFAULT 0
  `);

  // 10. 出车归还记录表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'VA_DepartureReturn')
    CREATE TABLE VA_DepartureReturn (
      id INT IDENTITY(1,1) PRIMARY KEY,
      applicationId INT NOT NULL,
      vehicleId INT,
      departureMileage DECIMAL(10,1) DEFAULT 0,
      returnMileage DECIMAL(10,1) DEFAULT 0,
      actualMileage DECIMAL(10,1) DEFAULT 0,
      departureTime DATETIME,
      returnTime DATETIME,
      remark NVARCHAR(500),
      recordedBy NVARCHAR(100),
      recordedByName NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);

  // 10b. VA_DepartureReturn 字段升级：新增出发油量 departureFuelLevel、归还油量 returnFuelLevel
  await pool.request().query(`
    IF COL_LENGTH('VA_DepartureReturn','departureFuelLevel') IS NULL
    ALTER TABLE VA_DepartureReturn ADD departureFuelLevel NVARCHAR(50)
  `);
  await pool.request().query(`
    IF COL_LENGTH('VA_DepartureReturn','returnFuelLevel') IS NULL
    ALTER TABLE VA_DepartureReturn ADD returnFuelLevel NVARCHAR(50)
  `);
  // 10c. VA_DepartureReturn 字段升级：归还照片（行驶里程照片、油箱照片）
  await pool.request().query(`
    IF COL_LENGTH('VA_DepartureReturn','returnMileagePhoto') IS NULL
    ALTER TABLE VA_DepartureReturn ADD returnMileagePhoto NVARCHAR(MAX)
  `);
  await pool.request().query(`
    IF COL_LENGTH('VA_DepartureReturn','returnFuelPhoto') IS NULL
    ALTER TABLE VA_DepartureReturn ADD returnFuelPhoto NVARCHAR(MAX)
  `);
  // 10d. VA_DepartureReturn 字段升级：车辆四维图（前/后/左/右）
  await pool.request().query(`
    IF COL_LENGTH('VA_DepartureReturn','vehiclePhotoFront') IS NULL
    ALTER TABLE VA_DepartureReturn ADD vehiclePhotoFront NVARCHAR(MAX)
  `);
  // 10e. VA_DepartureReturn 字段升级：电车出发电量、归还电量（百分比，如 70）
  await pool.request().query(`
    IF COL_LENGTH('VA_DepartureReturn','departureBatteryLevel') IS NULL
    ALTER TABLE VA_DepartureReturn ADD departureBatteryLevel DECIMAL(5,1) DEFAULT 0
  `);
  await pool.request().query(`
    IF COL_LENGTH('VA_DepartureReturn','returnBatteryLevel') IS NULL
    ALTER TABLE VA_DepartureReturn ADD returnBatteryLevel DECIMAL(5,1) DEFAULT 0
  `);
  await pool.request().query(`
    IF COL_LENGTH('VA_DepartureReturn','vehiclePhotoBack') IS NULL
    ALTER TABLE VA_DepartureReturn ADD vehiclePhotoBack NVARCHAR(MAX)
  `);
  await pool.request().query(`
    IF COL_LENGTH('VA_DepartureReturn','vehiclePhotoLeft') IS NULL
    ALTER TABLE VA_DepartureReturn ADD vehiclePhotoLeft NVARCHAR(MAX)
  `);
  await pool.request().query(`
    IF COL_LENGTH('VA_DepartureReturn','vehiclePhotoRight') IS NULL
    ALTER TABLE VA_DepartureReturn ADD vehiclePhotoRight NVARCHAR(MAX)
  `);

  // 11. 资产分布表（同一资产分放在不同地点）
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'FA_AssetDistribution')
    CREATE TABLE FA_AssetDistribution (
      id INT IDENTITY(1,1) PRIMARY KEY,
      assetId INT NOT NULL,
      location NVARCHAR(200) NOT NULL,
      storageAddress NVARCHAR(500),
      quantity INT DEFAULT 1,
      remark NVARCHAR(500),
      createdBy NVARCHAR(100),
      createdByName NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);

  // 11b. FA_AssetDistribution 新增 storageAddress 字段
  await pool.request().query(`
    IF COL_LENGTH('FA_AssetDistribution','storageAddress') IS NULL
    ALTER TABLE FA_AssetDistribution ADD storageAddress NVARCHAR(500)
  `);

  // 12. 折旧方案表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'FA_DepreciationScheme')
    CREATE TABLE FA_DepreciationScheme (
      id INT IDENTITY(1,1) PRIMARY KEY,
      schemeName NVARCHAR(100) NOT NULL,
      method NVARCHAR(50) NOT NULL,
      usefulLifeYears DECIMAL(5,1) NOT NULL,
      residualValueRate DECIMAL(5,4) DEFAULT 0.05,
      description NVARCHAR(500),
      isDefault INT DEFAULT 0,
      createdBy NVARCHAR(100),
      createdByName NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);

  // 折旧方案默认种子数据（仅在表为空时插入）
  const schemeCount = await pool.request().query('SELECT COUNT(*) AS n FROM FA_DepreciationScheme');
  if (schemeCount.recordset[0].n === 0) {
    await pool.request().query(`
      INSERT INTO FA_DepreciationScheme (schemeName, method, usefulLifeYears, residualValueRate, description, isDefault) VALUES
      (N'直线法-5年', 'straight_line', 5, 0.05, N'年折旧额=(原值-残值)/5年，每月均等', 1),
      (N'直线法-3年', 'straight_line', 3, 0.05, N'年折旧额=(原值-残值)/3年，每月均等', 0),
      (N'直线法-10年', 'straight_line', 10, 0.05, N'年折旧额=(原值-残值)/10年，每月均等', 0),
      (N'双倍余额递减法-5年', 'double_declining', 5, 0.05, N'年折旧率=2/5，逐年递减', 0),
      (N'年数总和法-5年', 'sum_of_years', 5, 0.05, N'年折旧率=尚可使用年数/使用年数总和', 0)
    `);
  }

  // FA_Disposal 幂等加列：scrapQuantity, distLocation
  await pool.request().query(`
    IF COL_LENGTH('FA_Disposal','scrapQuantity') IS NULL ALTER TABLE FA_Disposal ADD scrapQuantity INT DEFAULT 1;
    IF COL_LENGTH('FA_Disposal','distLocation') IS NULL ALTER TABLE FA_Disposal ADD distLocation NVARCHAR(200);
  `);

  ensured = true;
}

function getCurrentUser(req: Request): { userId: string; userName: string; isAdmin: boolean; roleCodes: string[] } {
  const u = req.user as any;
  const userId = u?.userId || u?.userCode || 'system';
  const userName = u?.userName || u?.displayName || (u?.userCode && u.userCode !== 'system' ? u.userCode : 'system');
  return {
    userId,
    userName,
    isAdmin: u?.isAdmin === '是',
    roleCodes: u?.roleCodes || (u?.roleCode ? [u.roleCode] : []),
  };
}

/**
 * 派车成功/审批派车通过后，向申请人推送企业微信"行车安全通知"。
 * 根据申请人用户代码查询其企业微信账号（用户全.企微账号），推送不阻塞主流程。
 */
async function pushDrivingSafetyNotice(pool: any, applicantId: string, info: {
  plateNo: string;
  departureTime: Date;
  departureMileage: number;
  energyType: string;
  fuelLevel?: string | number | null;
  batteryLevel?: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!applicantId || applicantId === 'system') return { ok: false, error: '无申请人' };
    const r = await pool.request().input('uid', sql.NVarChar, applicantId)
      .query(`SELECT TOP 1 企微账号, 用户名称 FROM 用户全 WHERE 用户代码 = @uid`);
    const wechatAccount = r.recordset[0]?.['企微账号'];
    if (!wechatAccount) return { ok: false, error: '申请人未配置企业微信账号' };
    const applicantName = String(r.recordset[0]?.['用户名称'] || applicantId);

    const energyDesc = info.energyType === 'electric'
      ? (info.batteryLevel != null ? `${Number(info.batteryLevel)}%` : '无记录')
      : (info.fuelLevel != null && info.fuelLevel !== '' ? `${info.fuelLevel} L` : '无记录');

    const content = [
      `🚗 出车任务提醒：`,
      `请确认您的行程信息`,
      ``,
      `尊敬的 ${applicantName}，您好！`,
      `您有一项新的出车任务`,
      `详细信息如下，请查收并核对：`,
      `指派车辆：${info.plateNo || '-'}`,
      `出车里程：${info.departureMileage ?? 0} km`,
      `剩余油量/电量：${energyDesc} (基于上次提报数据)`,
      ``,
      `⚠ 行车安全温馨提示`,
      `为了您和他人的安全，请务必遵守以下规定：`,
      `1、严禁酒驾、醉驾：喝酒不开车，开车不喝酒。`,
      `2、拒绝疲劳驾驶：保证充足休息，连续驾驶不超过3小时，停车休息不少于20分钟。`,
      `3、遵守交通规则：不超速、不超载、不闯红灯，系好安全带。`,
      `4、保持专注：行车途中请勿使用手机或做其他分心的事情。`,
      `祝您一路平安！如有任何问题，请及时联系人事行政管理员`,
    ].join('\n');

    return await sendTextToUser(String(wechatAccount), content);
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** 检查当前用户是否有权派车（管理员或行政人事岗位） */
function canDispatchVehicle(u: ReturnType<typeof getCurrentUser>): boolean {
  if (u.isAdmin) return true;
  const allowed = ['super_admin', 'data_admin', 'it', 'boss', 'hr', 'hr_staff', 'admin_staff'];
  return u.roleCodes.some(r => allowed.includes(r));
}

function genAssetNo(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const rnd = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `FA${y}${m}${dd}${rnd}`;
}

function genApplicationNo(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const rnd = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `VA${y}${m}${dd}${rnd}`;
}

// ============================================================
// 固定资产管理 API
// ============================================================

// 资产列表（支持筛选）
router.get('/fixed-assets', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { status, category, keyword } = req.query;
    let q = 'SELECT * FROM FA_Assets WHERE 1=1';
    const req2 = pool.request();
    if (status) { q += ' AND status = @status'; req2.input('status', sql.NVarChar, status); }
    if (category) { q += ' AND category = @category'; req2.input('category', sql.NVarChar, category); }
    if (keyword) { q += ' AND (assetNo LIKE @kw OR assetName LIKE @kw OR specModel LIKE @kw)'; req2.input('kw', sql.NVarChar, `%${keyword}%`); }
    q += ' ORDER BY createdAt DESC';
    const r = await req2.query(q);

    // 查询各资产的已分布数量
    const distR = await pool.request().query('SELECT assetId, SUM(quantity) AS distributedQty FROM FA_AssetDistribution GROUP BY assetId');
    const distMap: Record<number, number> = {};
    for (const row of distR.recordset) {
      distMap[row.assetId] = Number(row.distributedQty) || 0;
    }

    const data = r.recordset.map((a: any) => ({
      ...a,
      totalQuantity: a.totalQuantity != null ? Number(a.totalQuantity) : 1,
      distributedQuantity: distMap[a.id] || 0,
      undistributedQuantity: (a.totalQuantity != null ? Number(a.totalQuantity) : 1) - (distMap[a.id] || 0),
    }));

    res.json({ ok: true, data });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 获取资产类别列表（去重，供筛选项下拉）
router.get('/fixed-assets/categories', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const r = await pool.request().query(
      `SELECT DISTINCT category FROM FA_Assets WHERE category IS NOT NULL AND category <> '' ORDER BY category`
    );
    const categories = r.recordset.map((row: any) => row.category);
    res.json({ ok: true, data: categories });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 获取车辆最后一次归还状态（剩余公里数 + 油箱 + 电量 + 百公里油耗 + 能源类型）
router.get('/vehicles/:id/last-status', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const vehicleId = parseInt(req.params.id);
    // 车辆档案（含百公里油耗、能源类型；无归还记录时油耗仍可用）
    const v = await pool.request().input('vid', sql.Int, vehicleId)
      .query(`SELECT fuelConsumption, energyType FROM VM_Vehicles WHERE id=@vid`);
    const fuelConsumption = v.recordset[0]?.fuelConsumption != null ? Number(v.recordset[0].fuelConsumption) : 8;
    const energyType = v.recordset[0]?.energyType || 'fuel';
    const r = await pool.request().input('vid2', sql.Int, vehicleId)
      .query(`
        SELECT TOP 1 returnMileage, returnFuelLevel, returnBatteryLevel, returnTime, actualMileage
        FROM VA_DepartureReturn
        WHERE vehicleId=@vid2 AND returnTime IS NOT NULL
        ORDER BY returnTime DESC
      `);
    const last = r.recordset[0] || null;
    const defaultData = { returnMileage: null, returnFuelLevel: null, returnBatteryLevel: null, returnTime: null, actualMileage: null, fuelConsumption, energyType };
    res.json({ ok: true, data: last ? { ...last, fuelConsumption, energyType } : defaultData });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 获取组织列表（第一层 + 第二层）供车辆归属组织下拉选择
router.get('/org/levels', async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT org_id, parent_org_id, org_name, org_level, org_type
      FROM sys_org
      WHERE del_flag = 0 AND org_level IN (1, 2)
      ORDER BY org_level, org_id
    `);
    const nodes = r.recordset.map((row: any) => ({
      id: row.org_id,
      parentId: row.parent_org_id,
      name: row.org_name,
      level: row.org_level,
      type: row.org_type,
    }));
    res.json({ ok: true, data: nodes });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 获取可用车辆列表（排除已出车 dispatched 状态的车辆）
router.get('/vehicles/available/list', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT id, plateNo, vehicleType, energyType, frameNo, licenseNo, purchaseDate, status,
        orgId, insuranceExpiryDate, inspectionExpiryDate, maintenanceExpiryDate
      FROM VM_Vehicles
      WHERE status IN ('inuse', 'idle')
      ORDER BY plateNo
    `);
    res.json({ ok: true, data: r.recordset });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// ============================================================
// 车辆管理 API
// ============================================================

// 车辆列表
router.get('/vehicles', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { status, keyword } = req.query;
    let q = 'SELECT * FROM VM_Vehicles WHERE 1=1';
    const req2 = pool.request();
    if (status) { q += ' AND status = @status'; req2.input('status', sql.NVarChar, status); }
    if (keyword) { q += ' AND (plateNo LIKE @kw OR vehicleType LIKE @kw OR licenseNo LIKE @kw)'; req2.input('kw', sql.NVarChar, `%${keyword}%`); }
    q += ' ORDER BY createdAt DESC';
    const r = await req2.query(q);
    res.json({ ok: true, data: r.recordset });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 新增车辆
router.post('/vehicles', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    const b = req.body;
    // 必填校验：车架号 + 行驶证号
    if (!b.vin || !String(b.vin).trim()) {
      return res.status(400).json({ ok: false, error: '车架号为必填项' });
    }
    if (!b.licenseNo || !String(b.licenseNo).trim()) {
      return res.status(400).json({ ok: false, error: '行驶证号为必填项' });
    }
const r = await pool.request()
      .input('plateNo', sql.NVarChar, b.plateNo)
      .input('vehicleType', sql.NVarChar, b.vehicleType || '')
      .input('energyType', sql.NVarChar, b.energyType ?? 'fuel')
      .input('frameNo', sql.NVarChar, b.frameNo || '')
      .input('vin', sql.NVarChar, b.vin || '')
      .input('licenseNo', sql.NVarChar, b.licenseNo || '')
      .input('totalMileage', sql.Decimal(12,1), b.totalMileage ?? null)
      .input('fuelConsumption', sql.Decimal(8,2), b.fuelConsumption ?? 8)
      .input('inspectionPhotoPath', sql.NVarChar, b.inspectionPhotoPath ?? null)
      .input('insuranceFilePath', sql.NVarChar, b.insuranceFilePath ?? null)
      .input('purchaseDate', sql.Date, b.purchaseDate || null)
      .input('status', sql.NVarChar, b.status || 'inuse')
      .input('orgId', sql.Int, b.orgId || null)
      .input('insuranceExpiryDate', sql.Date, b.insuranceExpiryDate || null)
      .input('inspectionExpiryDate', sql.Date, b.inspectionExpiryDate || null)
      .input('maintenanceExpiryDate', sql.Date, b.maintenanceExpiryDate || null)
      .input('remark', sql.NVarChar, b.remark || '')
      .query(`
        UPDATE VM_Vehicles SET plateNo=@plateNo, vehicleType=@vehicleType, energyType=@energyType, frameNo=@frameNo,
          vin=@vin, licenseNo=@licenseNo,
          ${b.totalMileage !== undefined ? 'totalMileage=@totalMileage,' : ''}
          ${b.fuelConsumption !== undefined ? 'fuelConsumption=@fuelConsumption,' : ''}
          ${b.inspectionPhotoPath !== undefined ? 'inspectionPhotoPath=@inspectionPhotoPath,' : ''}
          ${b.insuranceFilePath !== undefined ? 'insuranceFilePath=@insuranceFilePath,' : ''}
          purchaseDate=@purchaseDate, status=@status,
          orgId=@orgId,
          insuranceExpiryDate=@insuranceExpiryDate, inspectionExpiryDate=@inspectionExpiryDate,
          maintenanceExpiryDate=@maintenanceExpiryDate, remark=@remark, updatedAt=GETDATE()
        WHERE id=@id
      `);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 删除车辆
router.delete('/vehicles/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    await pool.request().input('id', sql.Int, parseInt(req.params.id))
      .query('DELETE FROM VM_Vehicles WHERE id=@id');
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 车辆文件上传（年检照片 / 保险PDF，字段名 file）
router.post('/vehicles/:id/upload', vehicleUpload.single('file'), async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ ok: false, error: '未收到文件' });
    const fileUrl = '/uploads/vehicle/' + file.filename;
    const fileType = (req.body.type || '').toLowerCase(); // inspection | insurance
    const pool = await getPool();
    const id = parseInt(req.params.id);
    if (fileType === 'inspection') {
      await pool.request().input('id', sql.Int, id).input('p', sql.NVarChar, fileUrl)
        .query('UPDATE VM_Vehicles SET inspectionPhotoPath=@p, updatedAt=GETDATE() WHERE id=@id');
    } else if (fileType === 'insurance') {
      await pool.request().input('id', sql.Int, id).input('p', sql.NVarChar, fileUrl)
        .query('UPDATE VM_Vehicles SET insuranceFilePath=@p, updatedAt=GETDATE() WHERE id=@id');
    }
    res.json({ ok: true, url: fileUrl, name: file.originalname });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 维保记录
router.get('/vehicles/:id/maintenance', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const r = await pool.request().input('vehicleId', sql.Int, parseInt(req.params.id))
      .query('SELECT * FROM VM_Maintenance WHERE vehicleId=@vehicleId ORDER BY maintenanceDate DESC');
    res.json({ ok: true, data: r.recordset });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 新增维保记录
router.post('/vehicles/:id/maintenance', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    const b = req.body;
    const r = await pool.request()
      .input('vehicleId', sql.Int, parseInt(req.params.id))
      .input('maintenanceType', sql.NVarChar, b.maintenanceType)
      .input('maintenanceDate', sql.Date, b.maintenanceDate)
      .input('amount', sql.Decimal(18,2), b.amount || 0)
      .input('fuelLiters', sql.Decimal(10,2), b.fuelLiters || 0)
      .input('mileage', sql.Decimal(10,1), b.mileage || 0)
      .input('supplier', sql.NVarChar, b.supplier || '')
      .input('remark', sql.NVarChar, b.remark || '')
      .input('voucherPath', sql.NVarChar, b.voucherPath || '')
      .input('createdBy', sql.NVarChar, u.userId)
      .input('createdByName', sql.NVarChar, u.userName)
      .query(`
        INSERT INTO VM_Maintenance (vehicleId, maintenanceType, maintenanceDate, amount, fuelLiters,
          mileage, supplier, remark, voucherPath, createdBy, createdByName)
        OUTPUT INSERTED.*
        VALUES (@vehicleId, @maintenanceType, @maintenanceDate, @amount, @fuelLiters,
          @mileage, @supplier, @remark, @voucherPath, @createdBy, @createdByName)
      `);
    // 维修/年检时更新车辆状态
    if (b.maintenanceType === 'repair') {
      await pool.request().input('id', sql.Int, parseInt(req.params.id))
        .query('UPDATE VM_Vehicles SET status=\'repairing\', updatedAt=GETDATE() WHERE id=@id');
    } else if (b.maintenanceType === 'inspection') {
      await pool.request().input('id', sql.Int, parseInt(req.params.id))
        .input('date', sql.Date, b.maintenanceDate)
        .query('UPDATE VM_Vehicles SET inspectionExpiryDate=DATEADD(year,1,@date), updatedAt=GETDATE() WHERE id=@id');
    } else if (b.maintenanceType === 'insurance') {
      await pool.request().input('id', sql.Int, parseInt(req.params.id))
        .input('date', sql.Date, b.maintenanceDate)
        .query('UPDATE VM_Vehicles SET insuranceExpiryDate=DATEADD(year,1,@date), updatedAt=GETDATE() WHERE id=@id');
    } else if (b.maintenanceType === 'maintenance') {
      await pool.request().input('id', sql.Int, parseInt(req.params.id))
        .input('date', sql.Date, b.maintenanceDate)
        .query('UPDATE VM_Vehicles SET maintenanceExpiryDate=DATEADD(month,6,@date), updatedAt=GETDATE() WHERE id=@id');
    }
    res.json({ ok: true, data: r.recordset[0] });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 违章事故
router.get('/vehicles/:id/violations', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const r = await pool.request().input('vehicleId', sql.Int, parseInt(req.params.id))
      .query('SELECT * FROM VM_Violation WHERE vehicleId=@vehicleId ORDER BY violationDate DESC');
    res.json({ ok: true, data: r.recordset });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 新增违章/事故
router.post('/vehicles/:id/violations', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    const b = req.body;
    const r = await pool.request()
      .input('vehicleId', sql.Int, parseInt(req.params.id))
      .input('violationType', sql.NVarChar, b.violationType)
      .input('violationDate', sql.Date, b.violationDate)
      .input('location', sql.NVarChar, b.location || '')
      .input('description', sql.NVarChar, b.description || '')
      .input('penaltyAmount', sql.Decimal(18,2), b.penaltyAmount || 0)
      .input('demeritPoints', sql.Int, b.demeritPoints || 0)
      .input('responsibleParty', sql.NVarChar, b.responsibleParty || '')
      .input('handlingResult', sql.NVarChar, b.handlingResult || '')
      .input('status', sql.NVarChar, b.status || 'unprocessed')
      .input('createdBy', sql.NVarChar, u.userId)
      .input('createdByName', sql.NVarChar, u.userName)
      .query(`
        INSERT INTO VM_Violation (vehicleId, violationType, violationDate, location, description,
          penaltyAmount, demeritPoints, responsibleParty, handlingResult, status, createdBy, createdByName)
        OUTPUT INSERTED.*
        VALUES (@vehicleId, @violationType, @violationDate, @location, @description,
          @penaltyAmount, @demeritPoints, @responsibleParty, @handlingResult, @status, @createdBy, @createdByName)
      `);
    res.json({ ok: true, data: r.recordset[0] });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 更新违章处理状态
router.put('/violations/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const b = req.body;
    await pool.request()
      .input('id', sql.Int, parseInt(req.params.id))
      .input('handlingResult', sql.NVarChar, b.handlingResult || '')
      .input('status', sql.NVarChar, b.status || 'unprocessed')
      .query('UPDATE VM_Violation SET handlingResult=@handlingResult, status=@status WHERE id=@id');
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 到期提醒
router.get('/vehicles/expiry-reminders', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const today = new Date();
    const in30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const todayStr = today.toISOString().slice(0, 10);
    const in30Str = in30.toISOString().slice(0, 10);
    const r = await pool.request()
      .input('today', sql.Date, todayStr)
      .input('in30', sql.Date, in30Str)
      .query(`
        SELECT id, plateNo, vehicleType, driver, department,
          insuranceExpiryDate, inspectionExpiryDate, maintenanceExpiryDate,
          CASE WHEN insuranceExpiryDate IS NOT NULL AND insuranceExpiryDate <= @in30 THEN 1 ELSE 0 END AS insuranceWarning,
          CASE WHEN inspectionExpiryDate IS NOT NULL AND inspectionExpiryDate <= @in30 THEN 1 ELSE 0 END AS inspectionWarning,
          CASE WHEN maintenanceExpiryDate IS NOT NULL AND maintenanceExpiryDate <= @in30 THEN 1 ELSE 0 END AS maintenanceWarning
        FROM VM_Vehicles
        WHERE status = 'inuse'
          AND (
            (insuranceExpiryDate IS NOT NULL AND insuranceExpiryDate <= @in30)
            OR (inspectionExpiryDate IS NOT NULL AND inspectionExpiryDate <= @in30)
            OR (maintenanceExpiryDate IS NOT NULL AND maintenanceExpiryDate <= @in30)
          )
        ORDER BY plateNo
      `);
    res.json({ ok: true, data: r.recordset });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 车辆费用台账
router.get('/vehicles/:id/cost-ledger', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const r = await pool.request().input('vehicleId', sql.Int, parseInt(req.params.id))
      .query(`
        SELECT m.*, v.plateNo, v.vehicleType
        FROM VM_Maintenance m
        LEFT JOIN VM_Vehicles v ON m.vehicleId = v.id
        WHERE m.vehicleId = @vehicleId
        ORDER BY m.maintenanceDate DESC
      `);
    res.json({ ok: true, data: r.recordset });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// ============================================================
// 申请用车 API
// ============================================================

// 用车申请列表
router.get('/vehicle-applications', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { status, applicantId } = req.query;
    let q = `
      SELECT a.*, v.plateNo, v.vehicleType, v.energyType AS vehicleEnergyType,
        dr.departureTime, dr.departureMileage, dr.departureFuelLevel, dr.departureBatteryLevel,
        dr.returnTime, dr.returnMileage, dr.actualMileage, dr.returnFuelLevel, dr.returnBatteryLevel,
        dr.returnMileagePhoto, dr.returnFuelPhoto,
        dr.vehiclePhotoFront, dr.vehiclePhotoBack, dr.vehiclePhotoLeft, dr.vehiclePhotoRight,
        dr.remark AS departureReturnRemark
      FROM VA_Application a
      LEFT JOIN VM_Vehicles v ON a.assignedVehicleId = v.id
      LEFT JOIN VA_DepartureReturn dr ON dr.id = (
        SELECT MAX(dr2.id) FROM VA_DepartureReturn dr2 WHERE dr2.applicationId = a.id
      )
      WHERE 1=1
    `;
    const req2 = pool.request();
    if (status) { q += ' AND a.status = @status'; req2.input('status', sql.NVarChar, status); }
    if (applicantId) { q += ' AND a.applicantId = @applicantId'; req2.input('applicantId', sql.NVarChar, applicantId); }
    q += ' ORDER BY a.createdAt DESC';
    const r = await req2.query(q);
    res.json({ ok: true, data: r.recordset });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 归还/出车现场图片上传（归还里程照片、油箱照片、车辆四维图 front/back/left/right）
const returnPhotoUpload = multer({
  storage: multer.diskStorage({
    destination(_req: any, _file: any, cb: any) {
      const dir = path.resolve(process.cwd(), 'uploads', 'vehicle-return');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req: any, file: any, cb: any) {
      const ext = path.extname(file.originalname) || '.png';
      cb(null, 'return_' + Date.now() + '_' + Math.round(Math.random() * 1e6) + ext);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});
router.post('/vehicle-return-photo-upload', returnPhotoUpload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ ok: false, error: '未收到文件' });
    const fileUrl = '/uploads/vehicle-return/' + file.filename;
    res.json({ ok: true, url: fileUrl, name: file.originalname });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 新增用车申请默认信息：申请人真实姓名 + 所在组织 + 最近一次归还登记的剩余油数
// 打开新增弹窗时调用，用于自动带出"剩余油数"及"部门"
router.get('/vehicle-applications/my-apply-defaults', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);

    // 真实姓名 + 所在组织（用户全表）
    let realName = u.userName || '';
    let orgName = '';
    try {
      const nameR = await pool.request().input('uc', sql.NVarChar, u.userId)
        .query(`SELECT TOP 1 用户名称, 组织 FROM 用户全 WHERE 用户代码 = @uc`);
      const row = nameR.recordset[0];
      if (row) {
        if (row['用户名称']) realName = String(row['用户名称']);
        if (row['组织']) orgName = String(row['组织']);
      }
    } catch { /* 用户全表不可用时维持兜底 */ }
    if (!realName || realName === 'system') realName = u.userId;

    // 申请人最近一次归还登记的剩余油数（按归还时间倒序取最新）
    let lastReturnFuel: number | null = null;
    try {
      const fuelR = await pool.request().input('uid', sql.NVarChar, u.userId)
        .query(`
          SELECT TOP 1 dr.returnFuelLevel
          FROM VA_DepartureReturn dr
          INNER JOIN VA_Application a ON dr.applicationId = a.id
          WHERE a.applicantId = @uid AND dr.returnTime IS NOT NULL
            AND dr.returnFuelLevel IS NOT NULL AND LTRIM(RTRIM(CAST(dr.returnFuelLevel AS NVARCHAR(50)))) <> ''
          ORDER BY dr.returnTime DESC
        `);
      const fuelVal = fuelR.recordset[0]?.returnFuelLevel;
      const num = Number(fuelVal);
      if (!isNaN(num) && num >= 0) lastReturnFuel = num;
    } catch { /* 查询失败时保持 null */ }

    res.json({ ok: true, data: { realName, orgName, lastReturnFuel } });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 新增用车申请
router.post('/vehicle-applications', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    const b = req.body;
    const applicationNo = genApplicationNo();

    if (!b.usageDate) {
      return res.status(400).json({ ok: false, error: '请选择用车日期' });
    }
    // 用车日期后端校验兜底：必须 >= 数据库当前日期（今天及以后可提交，拒绝今天之前）
    const dateCheck = await pool.request()
      .input('usageDate', sql.Date, b.usageDate)
      .query(`SELECT CASE WHEN @usageDate >= CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END AS ok`);
    if (!dateCheck.recordset[0] || dateCheck.recordset[0].ok !== 1) {
      return res.status(400).json({ ok: false, error: '用车日期必须选择今天及以后的日期' });
    }
    // 归还日期校验兜底：不能早于用车日期
    if (b.returnDate && b.usageDate && String(b.returnDate) < String(b.usageDate)) {
      return res.status(400).json({ ok: false, error: '归还日期不能早于用车日期' });
    }

    // 申请人兜底：若 token 中无用户名称（曾出现 system），按用户代码从用户全表补齐真实姓名
    let applicantName = u.userName;
    if (!applicantName || applicantName === 'system') {
      try {
        const nameR = await pool.request().input('uc', sql.NVarChar, u.userId)
          .query(`SELECT TOP 1 用户名称 FROM 用户全 WHERE 用户代码 = @uc`);
        if (nameR.recordset[0] && nameR.recordset[0]['用户名称']) {
          applicantName = String(nameR.recordset[0]['用户名称']);
        }
      } catch { /* 用户全表不可用时维持兜底 */ }
    }
    if (!applicantName || applicantName === 'system') applicantName = u.userId;

    // 部门兜底：前端未传或为空时，按用户代码从用户全表取所在组织
    let department = String(b.department || '').trim();
    if (!department) {
      try {
        const orgR = await pool.request().input('uc2', sql.NVarChar, u.userId)
          .query('SELECT TOP 1 组织 FROM 用户全 WHERE 用户代码 = @uc2');
        department = orgR.recordset[0]?.['组织'] || '';
      } catch { /* 用户全表不可用时维持空 */ }
    }

    // 剩余油数（申请时填写，自动带出申请人上次归还时的剩余油数，可修改）
    const remainingFuel = Number(b.remainingFuel) || 0;

    const r = await pool.request()
      .input('applicationNo', sql.NVarChar, applicationNo)
      .input('applicantId', sql.NVarChar, u.userId)
      .input('applicantName', sql.NVarChar, applicantName)
      .input('department', sql.NVarChar, department)
      .input('usageDate', sql.Date, b.usageDate)
      .input('returnDate', sql.Date, b.returnDate || null)
      .input('destination', sql.NVarChar, b.destination)
      .input('purpose', sql.NVarChar, b.purpose)
      .input('passengers', sql.NVarChar, b.passengers || '')
      .input('driver', sql.NVarChar, b.driver || '')
      .input('remainingFuel', sql.Decimal(10,1), remainingFuel)
      .input('status', sql.NVarChar, 'pending')
      .input('createdBy', sql.NVarChar, u.userId)
      .input('createdByName', sql.NVarChar, applicantName)
      .query(`
        INSERT INTO VA_Application (applicationNo, applicantId, applicantName, department,
          usageDate, returnDate, destination, purpose, passengers, driver, remainingFuel, status, createdBy, createdByName, createdAt)
        OUTPUT INSERTED.*
        VALUES (@applicationNo, @applicantId, @applicantName, @department,
          @usageDate, @returnDate, @destination, @purpose, @passengers, @driver, @remainingFuel, @status, @createdBy, @createdByName, GETDATE())
      `);
    res.json({ ok: true, data: r.recordset[0] });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 部门审批
router.post('/vehicle-applications/:id/dept-approve', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    const b = req.body;
    const status = b.approved ? 'dept_approved' : 'rejected';
    await pool.request()
      .input('id', sql.Int, parseInt(req.params.id))
      .input('status', sql.NVarChar, status)
      .input('approverId', sql.NVarChar, u.userId)
      .input('approverName', sql.NVarChar, u.userName)
      .input('remark', sql.NVarChar, b.remark || '')
      .query(`
        UPDATE VA_Application SET status=@status,
          deptApproverId=@approverId, deptApproverName=@approverName,
          deptApprovalDate=GETDATE(), deptApprovalRemark=@remark, updatedAt=GETDATE()
        WHERE id=@id
      `);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 审批派车合并接口：审批通过同时自动派车，只有有车且派车成功才能审批通过
router.post('/vehicle-applications/:id/approve-dispatch', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    // 权限校验：只有管理员和行政人事岗位才能审批派车
    if (!canDispatchVehicle(u)) {
      return res.status(403).json({ ok: false, error: '无审批派车权限，仅管理员和行政人事岗位可操作' });
    }
    const b = req.body;
    const appId = parseInt(req.params.id);

    // 驳回：直接走原审批拒绝逻辑
    if (b.approved === false) {
      await pool.request()
        .input('id', sql.Int, appId)
        .input('approverId', sql.NVarChar, u.userId)
        .input('approverName', sql.NVarChar, u.userName)
        .input('remark', sql.NVarChar, b.remark || '')
        .query(`
          UPDATE VA_Application SET status='rejected',
            deptApproverId=@approverId, deptApproverName=@approverName,
            deptApprovalDate=GETDATE(), deptApprovalRemark=@remark, updatedAt=GETDATE()
          WHERE id=@id
        `);
      return res.json({ ok: true });
    }

    // 审批通过+派车：必须有 vehicleId
    if (!b.vehicleId) {
      return res.status(400).json({ ok: false, error: '审批通过必须选择车辆' });
    }

    // 车辆状态校验
    const vehicleRow = await pool.request().input('vid', sql.Int, b.vehicleId)
      .query('SELECT plateNo, status, fuelConsumption, energyType FROM VM_Vehicles WHERE id=@vid');
    if (!vehicleRow.recordset[0]) {
      return res.status(400).json({ ok: false, error: '车辆不存在' });
    }
    const vehicleStatus = vehicleRow.recordset[0].status;
    if (vehicleStatus === 'dispatched') {
      return res.status(400).json({ ok: false, error: '该车辆已出车，不可重复派车' });
    }
    if (vehicleStatus === 'repairing' || vehicleStatus === 'stopped') {
      return res.status(400).json({ ok: false, error: `车辆当前状态为「${vehicleStatus}」，不可派车` });
    }
    const plateNo = vehicleRow.recordset[0].plateNo || '';
    const energyType = vehicleRow.recordset[0].energyType || 'fuel';
    const fuelConsumption = vehicleRow.recordset[0].fuelConsumption != null ? Number(vehicleRow.recordset[0].fuelConsumption) : 8;

    // 获取该车辆最后一次归还记录（作为出发前状态）
    const lastReturn = await pool.request().input('vid', sql.Int, b.vehicleId)
      .query(`SELECT TOP 1 returnMileage, returnFuelLevel, returnBatteryLevel FROM VA_DepartureReturn
              WHERE vehicleId=@vid AND returnTime IS NOT NULL
              ORDER BY returnTime DESC`);
    const lastMileage = lastReturn.recordset[0]?.returnMileage || 0;
    const lastFuel = lastReturn.recordset[0]?.returnFuelLevel || '';
    const lastBattery = lastReturn.recordset[0]?.returnBatteryLevel;

    // 电车电量阈值校验：低于 30% 不出车
    const MIN_DISPATCH_BATTERY = 30; // %
    const departureBattery = b.departureBattery != null ? Number(b.departureBattery) : (lastBattery != null ? Number(lastBattery) : NaN);
    if (energyType === 'electric') {
      if (isNaN(departureBattery) || departureBattery < MIN_DISPATCH_BATTERY) {
        return res.status(400).json({
          ok: false,
          error: `电车电量不足不可派车：当前电量 ${isNaN(departureBattery) ? '无记录' : departureBattery + '%'}（低于 ${MIN_DISPATCH_BATTERY}%不出车），请先充电后再派车`,
        });
      }
    }

    // 油车续航校验：按车辆当前剩余油量估算续航，低于 80km 禁止派车（预估里程已取消）
    const MIN_DISPATCH_RANGE = 80; // km
    if (energyType === 'fuel') {
      let lastFuelNum = Number(lastFuel);
      if (!isNaN(lastFuelNum) && lastFuelNum >= 0) {
        const rangeKm = Math.round((lastFuelNum / fuelConsumption) * 100);
        if (rangeKm < MIN_DISPATCH_RANGE) {
          return res.status(400).json({
            ok: false,
            error: `续航不足不可派车：当前剩余油量 ${lastFuel} L，估算续航仅约 ${rangeKm} km（低于 ${MIN_DISPATCH_RANGE} km），请先加油后再派车`,
          });
        }
      }
    }

    // 一步完成：审批通过 + 派车 + 自动出车
    await pool.request()
      .input('id', sql.Int, appId)
      .input('approverId', sql.NVarChar, u.userId)
      .input('approverName', sql.NVarChar, u.userName)
      .input('dispatcherId', sql.NVarChar, u.userId)
      .input('dispatcherName', sql.NVarChar, u.userName)
      .input('vehicleId', sql.Int, b.vehicleId)
      .input('vehiclePlate', sql.NVarChar, plateNo)
      .input('remark', sql.NVarChar, b.remark || '')
      .query(`
        UPDATE VA_Application SET status='departed',
          deptApproverId=@approverId, deptApproverName=@approverName,
          deptApprovalDate=GETDATE(), deptApprovalRemark=@remark,
          adminDispatcherId=@dispatcherId, adminDispatcherName=@dispatcherName,
          dispatchDate=GETDATE(), assignedVehicleId=@vehicleId, assignedVehiclePlate=@vehiclePlate,
          dispatchRemark=@remark, waitRemark=NULL, updatedAt=GETDATE()
        WHERE id=@id
      `);

    // 自动创建出车记录（派车即出车）
    await pool.request()
      .input('applicationId', sql.Int, appId)
      .input('vehicleId', sql.Int, b.vehicleId)
      .input('departureMileage', sql.Decimal(10,1), lastMileage)
      .input('departureTime', sql.DateTime, new Date())
      .input('departureFuelLevel', sql.NVarChar, lastFuel)
      .input('departureBatteryLevel', sql.Decimal(5,1), energyType === 'electric' && !isNaN(departureBattery) ? departureBattery : 0)
      .input('remark', sql.NVarChar, b.remark || '')
      .input('recordedBy', sql.NVarChar, u.userId)
      .input('recordedByName', sql.NVarChar, u.userName)
      .query(`
        INSERT INTO VA_DepartureReturn (applicationId, vehicleId, departureMileage, departureTime, departureFuelLevel, departureBatteryLevel, remark, recordedBy, recordedByName)
        OUTPUT INSERTED.*
        VALUES (@applicationId, @vehicleId, @departureMileage, @departureTime, @departureFuelLevel, @departureBatteryLevel, @remark, @recordedBy, @recordedByName)
      `);

    // 车辆状态改为 dispatched（出车中，不可再派）
    await pool.request().input('vid', sql.Int, b.vehicleId)
      .query(`UPDATE VM_Vehicles SET status='dispatched', updatedAt=GETDATE() WHERE id=@vid`);

    // 派车通过后向申请人推送企业微信行车安全通知（不阻塞主流程）
    (async () => {
      try {
        const applicant = await pool.request().input('aid2', sql.Int, appId)
          .query('SELECT applicantId FROM VA_Application WHERE id=@aid2');
        const applicantId = applicant.recordset[0]?.applicantId;
        await pushDrivingSafetyNotice(pool, applicantId, {
          plateNo,
          departureTime: new Date(),
          departureMileage: Number(lastMileage) || 0,
          energyType,
          fuelLevel: energyType === 'fuel' ? lastFuel : null,
          batteryLevel: energyType === 'electric' && !isNaN(departureBattery) ? departureBattery : null,
        });
      } catch (err) {
        console.warn('[用车] 审批派车后推送行车安全通知失败:', (err as Error).message);
      }
    })();

    res.json({ ok: true, lastMileage, lastFuel, energyType, departureBattery: isNaN(departureBattery) ? null : departureBattery });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 查询可用车辆 + 最近两辆已出车车辆（供审批派车时判断有无车辆）
router.get('/vehicle-applications/:id/check-vehicles', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    // 可用车辆
    const availReq = await pool.request()
      .query(`SELECT id, plateNo, vehicleType, energyType, licenseNo FROM VM_Vehicles WHERE status IN ('inuse','idle') ORDER BY plateNo`);
    const availableVehicles = availReq.recordset || [];
    // 最近两辆已出车车辆（status=departed 的申请，关联车辆）
    const dispReq = await pool.request()
      .query(`
        SELECT TOP 2 a.id, a.applicationNo, a.applicantName, a.destination,
          a.returnDate, a.assignedVehiclePlate, v.plateNo, v.vehicleType, v.licenseNo,
          dr.departureTime, dr.departureMileage, dr.departureFuelLevel
        FROM VA_Application a
        LEFT JOIN VM_Vehicles v ON a.assignedVehicleId = v.id
        LEFT JOIN VA_DepartureReturn dr ON dr.applicationId = a.id AND dr.returnTime IS NULL
        WHERE a.status = 'departed'
        ORDER BY a.dispatchDate DESC
      `);
    const dispatchedVehicles = dispReq.recordset || [];
    res.json({ ok: true, data: { hasAvailable: availableVehicles.length > 0, availableVehicles, dispatchedVehicles } });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 设置"请等待"提示信息（无车时审批人填写，申请人可见）
router.post('/vehicle-applications/:id/set-wait', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    if (!canDispatchVehicle(u)) {
      return res.status(403).json({ ok: false, error: '无操作权限' });
    }
    const waitRemark = (req.body.waitRemark || '').trim();
    if (!waitRemark) {
      return res.status(400).json({ ok: false, error: '请等待提示内容不能为空' });
    }
    await pool.request()
      .input('id', sql.Int, parseInt(req.params.id))
      .input('waitRemark', sql.NVarChar, waitRemark)
      .input('approverId', sql.NVarChar, u.userId)
      .input('approverName', sql.NVarChar, u.userName)
      .query(`
        UPDATE VA_Application SET status='waiting', waitRemark=@waitRemark,
          deptApproverId=@approverId, deptApproverName=@approverName,
          deptApprovalDate=GETDATE(), updatedAt=GETDATE()
        WHERE id=@id
      `);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 行政派车（仅管理员/行政人事可操作，派车后自动出车，跳过出车登记）
router.post('/vehicle-applications/:id/dispatch', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    // 权限校验：只有管理员和行政人事岗位才能派车
    if (!canDispatchVehicle(u)) {
      return res.status(403).json({ ok: false, error: '无派车权限，仅管理员和行政人事岗位可操作' });
    }
    const b = req.body;
    // 车辆状态校验：已出车（dispatched）的车辆不可再派
    const vehicleRow = await pool.request().input('vid', sql.Int, b.vehicleId)
      .query('SELECT plateNo, status, fuelConsumption, energyType FROM VM_Vehicles WHERE id=@vid');
    if (!vehicleRow.recordset[0]) {
      return res.status(400).json({ ok: false, error: '车辆不存在' });
    }
    const vehicleStatus = vehicleRow.recordset[0].status;
    if (vehicleStatus === 'dispatched') {
      return res.status(400).json({ ok: false, error: '该车辆已出车，不可重复派车' });
    }
    if (vehicleStatus === 'repairing' || vehicleStatus === 'stopped') {
      return res.status(400).json({ ok: false, error: `车辆当前状态为「${vehicleStatus}」，不可派车` });
    }
    const plateNo = vehicleRow.recordset[0].plateNo || '';
    const energyType = vehicleRow.recordset[0].energyType || 'fuel';
    const fuelConsumption = vehicleRow.recordset[0].fuelConsumption != null ? Number(vehicleRow.recordset[0].fuelConsumption) : 8;
    // 获取该车辆最后一次归还记录（作为出发前状态）
    const lastReturn = await pool.request().input('vid', sql.Int, b.vehicleId)
      .query(`SELECT TOP 1 returnMileage, returnFuelLevel, returnBatteryLevel FROM VA_DepartureReturn
              WHERE vehicleId=@vid AND returnTime IS NOT NULL
              ORDER BY returnTime DESC`);
    const lastMileage = lastReturn.recordset[0]?.returnMileage || 0;
    const lastFuel = lastReturn.recordset[0]?.returnFuelLevel || '';
    const lastBattery = lastReturn.recordset[0]?.returnBatteryLevel;

    // 电车电量阈值校验：低于 30% 不出车
    const MIN_DISPATCH_BATTERY = 30; // %
    const departureBattery = b.departureBattery != null ? Number(b.departureBattery) : (lastBattery != null ? Number(lastBattery) : NaN);
    if (energyType === 'electric') {
      if (isNaN(departureBattery) || departureBattery < MIN_DISPATCH_BATTERY) {
        return res.status(400).json({
          ok: false,
          error: `电车电量不足不可派车：当前电量 ${isNaN(departureBattery) ? '无记录' : departureBattery + '%'}（低于 ${MIN_DISPATCH_BATTERY}%不出车），请先充电后再派车`,
        });
      }
    }

    // 油车续航校验：按车辆当前剩余油量估算续航，低于 80km 禁止派车（预估里程已取消）
    const MIN_DISPATCH_RANGE = 80; // km
    if (energyType === 'fuel') {
      let lastFuelNum = Number(lastFuel);
      if (!isNaN(lastFuelNum) && lastFuelNum >= 0) {
        const rangeKm = Math.round((lastFuelNum / fuelConsumption) * 100);
        if (rangeKm < MIN_DISPATCH_RANGE) {
          return res.status(400).json({
            ok: false,
            error: `续航不足不可派车：当前剩余油量 ${lastFuel} L，估算续航仅约 ${rangeKm} km（低于 ${MIN_DISPATCH_RANGE} km），请先加油后再派车`,
          });
        }
      }
    }

    // 更新申请单状态为 dispatched
    await pool.request()
      .input('id', sql.Int, parseInt(req.params.id))
      .input('dispatcherId', sql.NVarChar, u.userId)
      .input('dispatcherName', sql.NVarChar, u.userName)
      .input('vehicleId', sql.Int, b.vehicleId)
      .input('vehiclePlate', sql.NVarChar, plateNo)
      .input('remark', sql.NVarChar, b.remark || '')
      .query(`
        UPDATE VA_Application SET status='dispatched',
          adminDispatcherId=@dispatcherId, adminDispatcherName=@dispatcherName,
          dispatchDate=GETDATE(), assignedVehicleId=@vehicleId, assignedVehiclePlate=@vehiclePlate,
          dispatchRemark=@remark, updatedAt=GETDATE()
        WHERE id=@id
      `);
    // 派车即出车：自动创建出车归还记录（出发），状态直接进入 departed
    await pool.request()
      .input('applicationId', sql.Int, parseInt(req.params.id))
      .input('vehicleId', sql.Int, b.vehicleId)
      .input('departureMileage', sql.Decimal(10,1), lastMileage)
      .input('departureTime', sql.DateTime, new Date())
      .input('departureFuelLevel', sql.NVarChar, lastFuel)
      .input('departureBatteryLevel', sql.Decimal(5,1), energyType === 'electric' && !isNaN(departureBattery) ? departureBattery : 0)
      .input('remark', sql.NVarChar, b.remark || '')
      .input('recordedBy', sql.NVarChar, u.userId)
      .input('recordedByName', sql.NVarChar, u.userName)
      .query(`
        INSERT INTO VA_DepartureReturn (applicationId, vehicleId, departureMileage, departureTime, departureFuelLevel, departureBatteryLevel, remark, recordedBy, recordedByName)
        OUTPUT INSERTED.*
        VALUES (@applicationId, @vehicleId, @departureMileage, @departureTime, @departureFuelLevel, @departureBatteryLevel, @remark, @recordedBy, @recordedByName)
      `);
    // 申请单状态进入已出车
    await pool.request().input('id', sql.Int, parseInt(req.params.id))
      .query(`UPDATE VA_Application SET status='departed', updatedAt=GETDATE() WHERE id=@id`);
    // 车辆状态改为 dispatched（出车中，不可再派）
    await pool.request().input('vid', sql.Int, b.vehicleId)
      .query(`UPDATE VM_Vehicles SET status='dispatched', updatedAt=GETDATE() WHERE id=@vid`);
    // 派车后向申请人推送企业微信行车安全通知（不阻塞主流程）
    (async () => {
      try {
        const applicant = await pool.request().input('aid2', sql.Int, parseInt(req.params.id))
          .query('SELECT applicantId FROM VA_Application WHERE id=@aid2');
        const applicantId = applicant.recordset[0]?.applicantId;
        await pushDrivingSafetyNotice(pool, applicantId, {
          plateNo,
          departureTime: new Date(),
          departureMileage: Number(lastMileage) || 0,
          energyType,
          fuelLevel: energyType === 'fuel' ? lastFuel : null,
          batteryLevel: energyType === 'electric' && !isNaN(departureBattery) ? departureBattery : null,
        });
      } catch (err) {
        console.warn('[用车] 派车后推送行车安全通知失败:', (err as Error).message);
      }
    })();
    res.json({ ok: true, lastMileage, lastFuel, energyType, departureBattery: isNaN(departureBattery) ? null : departureBattery });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 出车登记
router.post('/vehicle-applications/:id/departure', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    const b = req.body;
    // 获取申请单的车辆ID
    const app = await pool.request().input('id', sql.Int, parseInt(req.params.id))
      .query('SELECT assignedVehicleId FROM VA_Application WHERE id=@id');
    const vehicleId = app.recordset[0]?.assignedVehicleId;
    await pool.request()
      .input('applicationId', sql.Int, parseInt(req.params.id))
      .input('vehicleId', sql.Int, vehicleId)
      .input('departureMileage', sql.Decimal(10,1), b.departureMileage || 0)
      .input('departureTime', sql.DateTime, b.departureTime || new Date())
      .input('departureFuelLevel', sql.NVarChar, b.departureFuelLevel || '')
      .input('departureBatteryLevel', sql.Decimal(5,1), b.departureBattery != null ? Number(b.departureBattery) : 0)
      .input('remark', sql.NVarChar, b.remark || '')
      .input('recordedBy', sql.NVarChar, u.userId)
      .input('recordedByName', sql.NVarChar, u.userName)
      .query(`
        INSERT INTO VA_DepartureReturn (applicationId, vehicleId, departureMileage, departureTime, departureFuelLevel, departureBatteryLevel, remark, recordedBy, recordedByName)
        OUTPUT INSERTED.*
        VALUES (@applicationId, @vehicleId, @departureMileage, @departureTime, @departureFuelLevel, @departureBatteryLevel, @remark, @recordedBy, @recordedByName)
      `);
    await pool.request().input('id', sql.Int, parseInt(req.params.id))
      .query(`UPDATE VA_Application SET status='departed', updatedAt=GETDATE() WHERE id=@id`);
    // 更新车辆状态为在用（出车中）
    if (vehicleId) {
      await pool.request().input('vid', sql.Int, vehicleId)
        .query('UPDATE VM_Vehicles SET status=\'inuse\', updatedAt=GETDATE() WHERE id=@vid');
    }
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 归还登记（必须填写实际里程和油箱剩余数）
router.post('/vehicle-applications/:id/return', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    const b = req.body;
    // 校验必填：实际里程
    if (b.returnMileage === undefined || b.returnMileage === null || b.returnMileage === '') {
      return res.status(400).json({ ok: false, error: '归还登记必须填写实际里程数' });
    }
    // 更新出车归还记录（带出车辆能源类型，用于按序校验油量/电量）
    const dep = await pool.request().input('applicationId', sql.Int, parseInt(req.params.id))
      .query(`SELECT dr.id, dr.vehicleId, dr.departureMileage, ISNULL(v.energyType,'fuel') AS energyType
              FROM VA_DepartureReturn dr
              LEFT JOIN VM_Vehicles v ON dr.vehicleId = v.id
              WHERE dr.applicationId=@applicationId AND dr.returnTime IS NULL`);
    // 按能源类型校验：油车必填油箱剩余数，电车必填归还电量
    if (dep.recordset[0]?.energyType === 'electric') {
      if (b.returnBattery === undefined || b.returnBattery === null || b.returnBattery === '') {
        return res.status(400).json({ ok: false, error: '归还登记必须填写归还电量' });
      }
    } else if (!b.returnFuelLevel || String(b.returnFuelLevel).trim() === '') {
      return res.status(400).json({ ok: false, error: '归还登记必须填写油箱剩余数' });
    }
    // 校验必填图片：行驶里程照片、油箱照片、车辆四维图（前/后/左/右）
    const requiredPhotos: Record<string, string> = {
      returnMileagePhoto: '行驶里程照片',
      returnFuelPhoto: '油箱照片',
      vehiclePhotoFront: '车辆正面',
      vehiclePhotoBack: '车辆背面',
      vehiclePhotoLeft: '车辆左侧',
      vehiclePhotoRight: '车辆右侧',
    };
    const missingPhotos = Object.keys(requiredPhotos).filter((k) => !b[k] || !String(b[k]).trim());
    if (missingPhotos.length) {
      return res.status(400).json({ ok: false, error: `归还登记必须上传图片：${missingPhotos.map((k) => requiredPhotos[k]).join('、')}` });
    }
    if (dep.recordset[0]) {
      const dep0 = dep.recordset[0];
      const actualMileage = (b.returnMileage || 0) - (dep0.departureMileage || 0);
      await pool.request()
        .input('id', sql.Int, dep0.id)
        .input('returnMileage', sql.Decimal(10,1), b.returnMileage || 0)
        .input('actualMileage', sql.Decimal(10,1), actualMileage > 0 ? actualMileage : 0)
        .input('returnFuelLevel', sql.NVarChar, String(b.returnFuelLevel))
        .input('returnBatteryLevel', sql.Decimal(5,1), b.returnBattery != null ? Number(b.returnBattery) : 0)
        .input('returnTime', sql.DateTime, new Date())
        .input('remark', sql.NVarChar, b.remark || '')
        .input('returnMileagePhoto', sql.NVarChar, b.returnMileagePhoto || '')
        .input('returnFuelPhoto', sql.NVarChar, b.returnFuelPhoto || '')
        .input('vehiclePhotoFront', sql.NVarChar, b.vehiclePhotoFront || '')
        .input('vehiclePhotoBack', sql.NVarChar, b.vehiclePhotoBack || '')
        .input('vehiclePhotoLeft', sql.NVarChar, b.vehiclePhotoLeft || '')
        .input('vehiclePhotoRight', sql.NVarChar, b.vehiclePhotoRight || '')
        .query(`UPDATE VA_DepartureReturn SET returnMileage=@returnMileage, actualMileage=@actualMileage, returnFuelLevel=@returnFuelLevel, returnBatteryLevel=@returnBatteryLevel, returnTime=@returnTime, remark=@remark,
          returnMileagePhoto=@returnMileagePhoto, returnFuelPhoto=@returnFuelPhoto,
          vehiclePhotoFront=@vehiclePhotoFront, vehiclePhotoBack=@vehiclePhotoBack,
          vehiclePhotoLeft=@vehiclePhotoLeft, vehiclePhotoRight=@vehiclePhotoRight
          WHERE id=@id`);
      // 归还后车辆状态恢复为在用（空闲），同时更新总行驶公里数
      if (dep0.vehicleId) {
        await pool.request()
          .input('vid', sql.Int, dep0.vehicleId)
          .input('totalMileage', sql.Decimal(12,1), b.returnMileage || 0)
          .query('UPDATE VM_Vehicles SET status=\'inuse\', totalMileage=@totalMileage, updatedAt=GETDATE() WHERE id=@vid');
      }
    }
    await pool.request().input('id', sql.Int, parseInt(req.params.id))
      .query(`UPDATE VA_Application SET status='returned', updatedAt=GETDATE() WHERE id=@id`);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 取消申请（仅申请人本人可取消自己的申请）
router.post('/vehicle-applications/:id/cancel', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    const appId = parseInt(req.params.id);
    const appR = await pool.request().input('id', sql.Int, appId)
      .query('SELECT applicantId, status FROM VA_Application WHERE id=@id');
    const app = appR.recordset[0];
    if (!app) {
      return res.status(404).json({ ok: false, error: '申请不存在' });
    }
    // 权限校验：只有申请人本人可以取消自己的申请
    if (String(app.applicantId) !== String(u.userId)) {
      return res.status(403).json({ ok: false, error: '只能取消自己提交的用车申请' });
    }
    if (!['pending', 'waiting'].includes(app.status)) {
      return res.status(400).json({ ok: false, error: '当前状态不可取消' });
    }
    await pool.request().input('id', sql.Int, appId)
      .query(`UPDATE VA_Application SET status='cancelled', updatedAt=GETDATE() WHERE id=@id`);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 用车明细台账导出
router.get('/vehicle-applications/export', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT a.applicationNo, a.applicantName, a.department, a.usageDate, a.returnDate,
        a.destination, a.purpose, a.passengers, a.driver, a.remainingFuel, a.status,
        a.deptApproverName, a.deptApprovalDate, a.adminDispatcherName, a.dispatchDate,
        a.assignedVehiclePlate, a.assignedDriver
      FROM VA_Application a
      ORDER BY a.createdAt DESC
    `);
    res.json({ ok: true, data: r.recordset });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// ============================================================
// 资产统计概览 API
// ============================================================

// 按分类汇总总数量 + 按部门/用户筛选分配个数
router.get('/fixed-assets/statistics', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { department, userName } = req.query;

    // 1. 按分类汇总总数量
    const totalReq = pool.request();
    let totalQ = `SELECT ISNULL(category, N'未分类') AS category, COUNT(*) AS totalCount,
        SUM(originalValue) AS totalOriginalValue,
        SUM(accumulatedDepreciation) AS totalAccumulatedDep,
        SUM(netValue) AS totalNetValue
      FROM FA_Assets WHERE 1=1`;
    if (department) { totalQ += ' AND id IN (SELECT assetId FROM FA_AssetDistribution WHERE location=@department)'; totalReq.input('department', sql.NVarChar, department); }
    if (userName) { totalQ += ' AND id IN (SELECT assetId FROM FA_AssetDistribution WHERE createdByName=@userName)'; totalReq.input('userName', sql.NVarChar, userName); }
    totalQ += ' GROUP BY category ORDER BY category';
    const totalResult = await totalReq.query(totalQ);

    // 2. 按存放地点+资产名称+资产类别+资产所属 汇总明细
    const deptReq = pool.request();
    let deptQ = `SELECT ISNULL(d.location, N'未分配') AS department,
        ISNULL(a.assetName, N'') AS assetName,
        ISNULL(a.category, N'未分类') AS category,
        ISNULL(a.assetOwnership, N'') AS assetOwnership,
        SUM(d.quantity) AS count,
        SUM(a.originalValue * d.quantity / NULLIF(a.totalQuantity, 0)) AS totalValue
      FROM FA_AssetDistribution d
      INNER JOIN FA_Assets a ON d.assetId = a.id
      WHERE 1=1`;
    if (department) { deptQ += ' AND d.location = @department'; deptReq.input('department', sql.NVarChar, department); }
    if (userName) { deptQ += ' AND d.createdByName = @userName'; deptReq.input('userName', sql.NVarChar, userName); }
    deptQ += ' GROUP BY d.location, a.assetName, a.category, a.assetOwnership ORDER BY d.location, a.assetName';
    const deptResult = await deptReq.query(deptQ);
    const byDepartment = deptResult.recordset;

    // 3. 按操作人+资产名称+资产类别+资产所属 汇总明细
    const userReq = pool.request();
    let userQ = `SELECT ISNULL(d.createdByName, N'未分配') AS userName,
        ISNULL(a.assetName, N'') AS assetName,
        ISNULL(a.category, N'未分类') AS category,
        ISNULL(a.assetOwnership, N'') AS assetOwnership,
        SUM(d.quantity) AS count,
        SUM(a.originalValue * d.quantity / NULLIF(a.totalQuantity, 0)) AS totalValue
      FROM FA_AssetDistribution d
      INNER JOIN FA_Assets a ON d.assetId = a.id
      WHERE 1=1`;
    if (department) { userQ += ' AND d.location = @department'; userReq.input('department', sql.NVarChar, department); }
    if (userName) { userQ += ' AND d.createdByName = @userName'; userReq.input('userName', sql.NVarChar, userName); }
    userQ += ' GROUP BY d.createdByName, a.assetName, a.category, a.assetOwnership ORDER BY d.createdByName, a.assetName';
    const userResult = await userReq.query(userQ);
    const byUser = userResult.recordset;

    // 4. 总体汇总（部门数和使用人数从分布表统计）
    const summaryReq = pool.request();
    let summaryQ = `SELECT COUNT(*) AS totalAssets, SUM(originalValue) AS totalValue,
        SUM(accumulatedDepreciation) AS totalDep, SUM(netValue) AS totalNet,
        COUNT(DISTINCT category) AS categoryCount,
        (SELECT COUNT(DISTINCT location) FROM FA_AssetDistribution) AS deptCount,
        (SELECT COUNT(DISTINCT createdByName) FROM FA_AssetDistribution) AS userCount
      FROM FA_Assets WHERE 1=1`;
    if (department) { summaryQ += ' AND id IN (SELECT assetId FROM FA_AssetDistribution WHERE location=@department)'; summaryReq.input('department', sql.NVarChar, department); }
    if (userName) { summaryQ += ' AND id IN (SELECT assetId FROM FA_AssetDistribution WHERE createdByName=@userName)'; summaryReq.input('userName', sql.NVarChar, userName); }
    const summaryResult = await summaryReq.query(summaryQ);

    res.json({
      ok: true,
      data: {
        summary: summaryResult.recordset[0] || {},
        byCategory: totalResult.recordset,
        byDepartment,
        byUser,
      }
    });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// ============================================================
// 资产分布管理 API（同一资产多地点分布）
// ============================================================

// 获取所有资产分布列表（含资产信息，默认全量）
router.get('/fixed-assets/distributions/all', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { keyword, location, userName } = req.query;
    let q = `SELECT d.id, d.assetId, d.location, d.storageAddress, d.quantity, d.remark,
        d.createdBy, d.createdByName, d.createdAt,
        a.assetNo, a.assetName, a.category, a.specModel,
        a.totalQuantity, a.status, a.purchasePrice, a.originalValue
      FROM FA_AssetDistribution d
      INNER JOIN FA_Assets a ON d.assetId = a.id
      WHERE 1=1`;
    const r = pool.request();
    if (keyword) { q += ' AND (a.assetNo LIKE @kw OR a.assetName LIKE @kw OR a.specModel LIKE @kw)'; r.input('kw', sql.NVarChar, `%${keyword}%`); }
    if (location) { q += ' AND d.location LIKE @loc'; r.input('loc', sql.NVarChar, `%${location}%`); }
    if (userName) { q += ' AND d.createdByName LIKE @userName'; r.input('userName', sql.NVarChar, `%${userName}%`); }
    q += ' ORDER BY d.createdAt DESC';
    const result = await r.query(q);
    res.json({ ok: true, data: result.recordset });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 获取某资产的分布列表
router.get('/fixed-assets/:id/distributions', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const r = await pool.request().input('assetId', sql.Int, parseInt(req.params.id))
      .query('SELECT * FROM FA_AssetDistribution WHERE assetId=@assetId ORDER BY createdAt DESC');
    res.json({ ok: true, data: r.recordset });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 新增/更新资产分布（支持批量，校验分布总量不超过总数量）
router.post('/fixed-assets/:id/distributions', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    const assetId = parseInt(req.params.id);
    const items = req.body.items as any[];

    // 查询资产总数量
    const assetR = await pool.request().input('id', sql.Int, assetId)
      .query('SELECT totalQuantity FROM FA_Assets WHERE id=@id');
    const totalQty = assetR.recordset[0]?.totalQuantity != null ? Number(assetR.recordset[0].totalQuantity) : 1;

    // 计算分布总量
    const totalDistributed = items.reduce((sum: number, it: any) => sum + (Number(it.quantity) || 0), 0);
    if (totalDistributed > totalQty) {
      return res.status(400).json({ ok: false, error: `分布总量(${totalDistributed})超过资产总数量(${totalQty})` });
    }

    for (const it of items) {
      if (it.id) {
        // 更新
        await pool.request()
          .input('id', sql.Int, it.id)
          .input('location', sql.NVarChar, it.location)
          .input('storageAddress', sql.NVarChar, it.storageAddress || '')
          .input('quantity', sql.Int, it.quantity || 1)
          .input('remark', sql.NVarChar, it.remark || '')
          .input('createdByName', sql.NVarChar, it.createdByName || u.userName)
          .query('UPDATE FA_AssetDistribution SET location=@location, storageAddress=@storageAddress, quantity=@quantity, remark=@remark, createdByName=@createdByName WHERE id=@id');
      } else {
        // 新增
        await pool.request()
          .input('assetId', sql.Int, assetId)
          .input('location', sql.NVarChar, it.location)
          .input('storageAddress', sql.NVarChar, it.storageAddress || '')
          .input('quantity', sql.Int, it.quantity || 1)
          .input('remark', sql.NVarChar, it.remark || '')
          .input('createdBy', sql.NVarChar, u.userId)
          .input('createdByName', sql.NVarChar, it.createdByName || u.userName)
          .query(`INSERT INTO FA_AssetDistribution (assetId, location, storageAddress, quantity, remark, createdBy, createdByName)
            VALUES (@assetId, @location, @storageAddress, @quantity, @remark, @createdBy, @createdByName)`);
      }
    }
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 删除分布记录
router.delete('/fixed-assets/distributions/:distId', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    await pool.request().input('id', sql.Int, parseInt(req.params.distId))
      .query('DELETE FROM FA_AssetDistribution WHERE id=@id');
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 导出资产分布（Excel）
router.get('/fixed-assets/distributions/export', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT d.id, d.assetId, d.location, d.storageAddress, d.quantity, d.remark,
        d.createdBy, d.createdByName, d.createdAt,
        a.assetNo, a.assetName, a.category
      FROM FA_AssetDistribution d
      INNER JOIN FA_Assets a ON d.assetId = a.id
      ORDER BY d.createdAt DESC
    `);
    const rows = r.recordset.map((d: any, i: number) => ({
      '序号': i + 1,
      '资产编号': d.assetNo || '',
      '资产名称': d.assetName || '',
      '资产类别': d.category || '',
      '归属组织': d.location || '',
      '存放地址': d.storageAddress || '',
      '使用人': d.createdByName || '',
      '分布数量': Number(d.quantity || 0),
      '备注': d.remark || '',
      '操作人': d.createdByName || '',
      '创建时间': d.createdAt ? formatDateTime(d.createdAt) : '',
    }));
    const distHeaders = ['序号', '资产编号', '资产名称', '资产类别', '归属组织', '存放地址', '使用人', '分布数量', '备注', '操作人', '创建时间'];
    const ws = rows.length > 0
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([distHeaders]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '资产分布');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=distributions_export.xlsx');
    res.send(buf);
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 导入资产分布（Excel 批量上传）
const distImportUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.post('/fixed-assets/distributions/import', distImportUpload.single('file'), async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ ok: false, error: '未收到文件' });
    const wb = XLSX.read(file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(ws);

    let inserted = 0;
    let errors: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const assetNo = String(r['资产编号'] || '').trim();
      const location = String(r['归属组织'] || '').trim();
      const storageAddress = String(r['存放地址'] || '').trim();
      const quantity = Number(r['分布数量'] || 1);
      const userName = String(r['使用人'] || '').trim();

      if (!assetNo) { errors.push(`第${i + 2}行：资产编号为空，跳过`); continue; }
      if (!location) { errors.push(`第${i + 2}行：归属组织为空，跳过`); continue; }
      if (!quantity || quantity < 1) { errors.push(`第${i + 2}行：分布数量无效，跳过`); continue; }

      // 根据资产编号查找资产ID
      const ar = await pool.request().input('assetNo', sql.NVarChar, assetNo)
        .query('SELECT TOP 1 id, totalQuantity FROM FA_Assets WHERE assetNo=@assetNo');
      if (!ar.recordset[0]) { errors.push(`第${i + 2}行：资产编号「${assetNo}」不存在，跳过`); continue; }
      const assetId = ar.recordset[0].id;
      const totalQty = Number(ar.recordset[0].totalQuantity || 1);

      // 校验分布总量不超过总数量
      const distR = await pool.request().input('assetId', sql.Int, assetId)
        .query('SELECT SUM(quantity) AS distributedQty FROM FA_AssetDistribution WHERE assetId=@assetId');
      const existingQty = Number(distR.recordset[0]?.distributedQty || 0);
      if (existingQty + quantity > totalQty) {
        errors.push(`第${i + 2}行：资产「${assetNo}」分布总量(${existingQty + quantity})超过总数量(${totalQty})，跳过`);
        continue;
      }

      await pool.request()
        .input('assetId', sql.Int, assetId)
        .input('location', sql.NVarChar, location)
        .input('storageAddress', sql.NVarChar, storageAddress)
        .input('quantity', sql.Int, quantity)
        .input('remark', sql.NVarChar, String(r['备注'] || '').trim())
        .input('createdBy', sql.NVarChar, u.userId)
        .input('createdByName', sql.NVarChar, userName || u.userName)
        .query(`INSERT INTO FA_AssetDistribution (assetId, location, storageAddress, quantity, remark, createdBy, createdByName)
          VALUES (@assetId, @location, @storageAddress, @quantity, @remark, @createdBy, @createdByName)`);
      inserted++;
    }
    res.json({ ok: true, data: { inserted, errors } });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// ============================================================
// 折旧方案管理 API
// ============================================================

// 折旧方案列表
router.get('/depreciation-schemes', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const r = await pool.request().query('SELECT * FROM FA_DepreciationScheme ORDER BY isDefault DESC, schemeName');
    res.json({ ok: true, data: r.recordset });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 新增折旧方案
router.post('/depreciation-schemes', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    const b = req.body;
    const r = await pool.request()
      .input('schemeName', sql.NVarChar, b.schemeName)
      .input('method', sql.NVarChar, b.method)
      .input('usefulLifeYears', sql.Decimal(5,1), b.usefulLifeYears)
      .input('residualValueRate', sql.Decimal(5,4), b.residualValueRate ?? 0.05)
      .input('description', sql.NVarChar, b.description || '')
      .input('isDefault', sql.Int, b.isDefault ? 1 : 0)
      .input('createdBy', sql.NVarChar, u.userId)
      .input('createdByName', sql.NVarChar, u.userName)
      .query(`INSERT INTO FA_DepreciationScheme (schemeName, method, usefulLifeYears, residualValueRate, description, isDefault, createdBy, createdByName)
        OUTPUT INSERTED.*
        VALUES (@schemeName, @method, @usefulLifeYears, @residualValueRate, @description, @isDefault, @createdBy, @createdByName)`);
    res.json({ ok: true, data: r.recordset[0] });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 更新折旧方案
router.put('/depreciation-schemes/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const b = req.body;
    await pool.request()
      .input('id', sql.Int, parseInt(req.params.id))
      .input('schemeName', sql.NVarChar, b.schemeName)
      .input('method', sql.NVarChar, b.method)
      .input('usefulLifeYears', sql.Decimal(5,1), b.usefulLifeYears)
      .input('residualValueRate', sql.Decimal(5,4), b.residualValueRate ?? 0.05)
      .input('description', sql.NVarChar, b.description || '')
      .input('isDefault', sql.Int, b.isDefault ? 1 : 0)
      .query(`UPDATE FA_DepreciationScheme SET schemeName=@schemeName, method=@method,
        usefulLifeYears=@usefulLifeYears, residualValueRate=@residualValueRate,
        description=@description, isDefault=@isDefault WHERE id=@id`);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 删除折旧方案
router.delete('/depreciation-schemes/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    await pool.request().input('id', sql.Int, parseInt(req.params.id))
      .query('DELETE FROM FA_DepreciationScheme WHERE id=@id');
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// ============================================================
// 折旧计算 API（按方案+采购日期自动计算）
// ============================================================

// 计算单个资产的折旧（返回月折旧额、累计折旧、剩余价值）
// 根据方案ID和资产原值计算折旧（返回累计折旧、净值、月折旧额等）
async function calcDeprecByScheme(pool: sql.ConnectionPool, schemeId: number | undefined, originalValue: number, purchaseDate: Date) {
  let scheme: any = null;
  if (schemeId) {
    const sr = await pool.request().input('id', sql.Int, schemeId).query('SELECT * FROM FA_DepreciationScheme WHERE id=@id');
    scheme = sr.recordset[0];
  }
  if (!scheme) {
    const sr = await pool.request().query("SELECT TOP 1 * FROM FA_DepreciationScheme WHERE isDefault=1 ORDER BY id");
    scheme = sr.recordset[0];
  }
  if (!scheme) return { accumulatedDepreciation: 0, netValue: originalValue, monthlyDepreciation: 0, schemeName: '' };
  return {
    ...calculateDepreciation(originalValue, scheme.method, parseFloat(scheme.usefulLifeYears), parseFloat(scheme.residualValueRate), purchaseDate),
    schemeName: scheme.schemeName,
  };
}

function calculateDepreciation(originalValue: number, method: string, usefulLifeYears: number, residualValueRate: number, purchaseDate: Date, schemeId?: number) {
  const now = new Date();
  const totalMonths = Math.round(usefulLifeYears * 12);
  const residualValue = originalValue * residualValueRate;
  const depreciableBase = originalValue - residualValue;

  // 已使用月数
  let elapsedMonths = (now.getFullYear() - purchaseDate.getFullYear()) * 12 + (now.getMonth() - purchaseDate.getMonth());
  if (elapsedMonths < 0) elapsedMonths = 0;
  if (elapsedMonths > totalMonths) elapsedMonths = totalMonths;

  let monthlyDepreciation = 0;
  let accumulatedDepreciation = 0;

  if (method === 'straight_line') {
    // 直线法：月折旧额 = (原值 - 残值) / 总月数
    monthlyDepreciation = depreciableBase / totalMonths;
    accumulatedDepreciation = monthlyDepreciation * elapsedMonths;
  } else if (method === 'double_declining') {
    // 双倍余额递减法：年折旧率 = 2/年限，逐年递减
    const annualRate = 2 / usefulLifeYears;
    let bookValue = originalValue;
    const elapsedYears = Math.floor(elapsedMonths / 12);
    const remainingMonthsInYear = elapsedMonths % 12;
    for (let y = 0; y < elapsedYears; y++) {
      const yearDep = bookValue * annualRate;
      bookValue -= yearDep;
      accumulatedDepreciation += yearDep;
    }
    // 当年部分月份
    if (remainingMonthsInYear > 0 && elapsedYears < usefulLifeYears) {
      const monthlyRate = annualRate / 12;
      const partialDep = bookValue * monthlyRate * remainingMonthsInYear;
      accumulatedDepreciation += partialDep;
    }
    monthlyDepreciation = bookValue * annualRate / 12;
    // 最后两年切换为直线法
    if (elapsedYears >= usefulLifeYears - 2) {
      const remainingYears = usefulLifeYears - elapsedYears;
      monthlyDepreciation = (bookValue - residualValue) / (remainingYears * 12);
    }
  } else if (method === 'sum_of_years') {
    // 年数总和法：年折旧率 = 尚可使用年数 / 使用年数总和
    const sumOfYears = (usefulLifeYears * (usefulLifeYears + 1)) / 2;
    const elapsedYears = Math.floor(elapsedMonths / 12);
    const remainingMonthsInYear = elapsedMonths % 12;
    for (let y = 0; y < elapsedYears; y++) {
      const remainingLife = usefulLifeYears - y;
      const yearRate = remainingLife / sumOfYears;
      accumulatedDepreciation += depreciableBase * yearRate;
    }
    // 当年部分月份
    if (remainingMonthsInYear > 0) {
      const remainingLife = usefulLifeYears - elapsedYears;
      const yearRate = remainingLife / sumOfYears;
      accumulatedDepreciation += depreciableBase * yearRate * (remainingMonthsInYear / 12);
    }
    // 当前月折旧额
    const currentRemainingLife = usefulLifeYears - elapsedYears;
    const currentYearRate = currentRemainingLife / sumOfYears;
    monthlyDepreciation = depreciableBase * currentYearRate / 12;
  }

  // 防止超过可折旧基数
  if (accumulatedDepreciation > depreciableBase) accumulatedDepreciation = depreciableBase;
  if (accumulatedDepreciation < 0) accumulatedDepreciation = 0;

  const netValue = originalValue - accumulatedDepreciation;
  const isFullyDepreciated = elapsedMonths >= totalMonths;

  return {
    originalValue,
    residualValue: Math.round(residualValue * 100) / 100,
    depreciableBase: Math.round(depreciableBase * 100) / 100,
    elapsedMonths,
    totalMonths,
    monthlyDepreciation: Math.round(monthlyDepreciation * 100) / 100,
    accumulatedDepreciation: Math.round(accumulatedDepreciation * 100) / 100,
    netValue: Math.round(netValue * 100) / 100,
    isFullyDepreciated,
    method,
    usefulLifeYears,
    residualValueRate,
  };
}

// 批量计算资产折旧（支持按方案ID计算，或按资产自身已有的方案字段计算）
router.post('/fixed-assets/calculate-depreciation', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { assetIds, schemeId } = req.body;

    // 获取折旧方案
    let scheme: any = null;
    if (schemeId) {
      const sr = await pool.request().input('id', sql.Int, schemeId)
        .query('SELECT * FROM FA_DepreciationScheme WHERE id=@id');
      scheme = sr.recordset[0];
    }
    if (!scheme) {
      // 取默认方案
      const sr = await pool.request().query("SELECT TOP 1 * FROM FA_DepreciationScheme WHERE isDefault=1 ORDER BY id");
      scheme = sr.recordset[0];
    }

    let assets: any[] = [];
    if (assetIds && Array.isArray(assetIds) && assetIds.length > 0) {
      // 查询指定资产
      const idList = assetIds.join(',');
      const ar = await pool.request().query(`SELECT * FROM FA_Assets WHERE id IN (${idList}) ORDER BY createdAt DESC`);
      assets = ar.recordset;
    } else {
      // 查询全部在用/闲置资产
      const ar = await pool.request().query("SELECT * FROM FA_Assets WHERE status IN ('inuse','idle') ORDER BY createdAt DESC");
      assets = ar.recordset;
    }

    const results = assets.map((a: any) => {
      const pd = a.purchaseDate ? new Date(a.purchaseDate) : new Date();
      const method = scheme ? scheme.method : (a.depreciationMethod || 'straight_line');
      const lifeYears = scheme ? parseFloat(scheme.usefulLifeYears) : 5;
      const rvr = scheme ? parseFloat(scheme.residualValueRate) : 0.05;
      const calc = calculateDepreciation(
        parseFloat(a.originalValue) || 0,
        method,
        lifeYears,
        rvr,
        pd,
      );
      return { assetId: a.id, assetNo: a.assetNo, assetName: a.assetName, ...calc };
    });

    res.json({ ok: true, data: { scheme, results } });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 应用折旧计算到台账（批量更新 FA_Assets 表的累计折旧和净值）
router.post('/fixed-assets/apply-depreciation', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { schemeId } = req.body;

    // 获取折旧方案
    let scheme: any = null;
    if (schemeId) {
      const sr = await pool.request().input('id', sql.Int, schemeId)
        .query('SELECT * FROM FA_DepreciationScheme WHERE id=@id');
      scheme = sr.recordset[0];
    }
    if (!scheme) {
      const sr = await pool.request().query("SELECT TOP 1 * FROM FA_DepreciationScheme WHERE isDefault=1 ORDER BY id");
      scheme = sr.recordset[0];
    }

    const ar = await pool.request().query("SELECT * FROM FA_Assets WHERE status IN ('inuse','idle') ORDER BY createdAt DESC");

    let updated = 0;
    for (const a of ar.recordset) {
      const pd = a.purchaseDate ? new Date(a.purchaseDate) : new Date();
      const method = scheme ? scheme.method : (a.depreciationMethod || 'straight_line');
      const lifeYears = scheme ? parseFloat(scheme.usefulLifeYears) : 5;
      const rvr = scheme ? parseFloat(scheme.residualValueRate) : 0.05;
      const calc = calculateDepreciation(parseFloat(a.originalValue) || 0, method, lifeYears, rvr, pd);

      await pool.request()
        .input('id', sql.Int, a.id)
        .input('accumulatedDepreciation', sql.Decimal(18,2), calc.accumulatedDepreciation)
        .input('netValue', sql.Decimal(18,2), calc.netValue)
        .input('depreciationMethod', sql.NVarChar, `${scheme ? scheme.schemeName : method}`)
        .query('UPDATE FA_Assets SET accumulatedDepreciation=@accumulatedDepreciation, netValue=@netValue, depreciationMethod=@depreciationMethod, updatedAt=GETDATE() WHERE id=@id');
      updated++;
    }

    res.json({ ok: true, data: { updated, schemeName: scheme?.schemeName || 'default' } });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// ============================================================
// 资产档案 CRUD + 导出/导入
// ============================================================

// 资产图片上传
router.post('/fixed-assets/upload-image', assetUpload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ ok: false, error: '未收到文件' });
    const fileUrl = '/uploads/asset/' + file.filename;
    res.json({ ok: true, url: fileUrl, name: file.originalname });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 新增资产（schemeId 替代 depreciationMethod，自动计算累计折旧和净值）
router.post('/fixed-assets', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    const b = req.body;
    if (!b.assetName || !String(b.assetName).trim()) {
      return res.status(400).json({ ok: false, error: '资产名称为必填项' });
    }
    const originalValue = b.originalValue ? Number(b.originalValue) : (b.purchasePrice ? Number(b.purchasePrice) : 0);
    const purchaseDate = b.purchaseDate ? new Date(b.purchaseDate) : new Date();
    // 根据折旧方案自动计算
    const schemeId = b.schemeId ? Number(b.schemeId) : undefined;
    const calc = await calcDeprecByScheme(pool, schemeId, originalValue, purchaseDate);
    const totalQuantity = b.totalQuantity ? Number(b.totalQuantity) : 1;
    const r = await pool.request()
      .input('assetNo', sql.NVarChar, b.assetNo || genAssetNo())
      .input('assetName', sql.NVarChar, b.assetName)
      .input('category', sql.NVarChar, b.category || '')
      .input('assetOwnership', sql.NVarChar, b.assetOwnership || '')
      .input('specModel', sql.NVarChar, b.specModel || '')
      .input('purchaseDate', sql.Date, b.purchaseDate || null)
      .input('purchasePrice', sql.Decimal(18,2), b.purchasePrice || 0)
      .input('supplier', sql.NVarChar, b.supplier || '')
      .input('supplierPhone', sql.NVarChar, b.supplierPhone || '')
      .input('invoiceNo', sql.NVarChar, b.invoiceNo || '')
      .input('status', sql.NVarChar, b.status || 'inuse')
      .input('schemeId', sql.Int, schemeId || null)
      .input('totalQuantity', sql.Int, totalQuantity)
      .input('originalValue', sql.Decimal(18,2), originalValue)
      .input('accumulatedDepreciation', sql.Decimal(18,2), calc.accumulatedDepreciation)
      .input('netValue', sql.Decimal(18,2), calc.netValue)
      .input('depreciationMethod', sql.NVarChar, calc.schemeName || '')
      .input('remark', sql.NVarChar, b.remark || '')
      .input('barcode', sql.NVarChar, b.barcode || '')
      .input('imagePath', sql.NVarChar, b.imagePath || '')
      .input('createdBy', sql.NVarChar, u.userId)
      .input('createdByName', sql.NVarChar, u.userName)
      .query(`
        INSERT INTO FA_Assets (assetNo, assetName, category, assetOwnership, specModel, purchaseDate,
          purchasePrice, supplier, supplierPhone, invoiceNo, status,
          schemeId, totalQuantity, originalValue, accumulatedDepreciation, netValue,
          depreciationMethod, remark, barcode, imagePath, createdBy, createdByName)
        OUTPUT INSERTED.*
        VALUES (@assetNo, @assetName, @category, @assetOwnership, @specModel, @purchaseDate,
          @purchasePrice, @supplier, @supplierPhone, @invoiceNo, @status,
          @schemeId, @totalQuantity, @originalValue, @accumulatedDepreciation, @netValue,
          @depreciationMethod, @remark, @barcode, @imagePath, @createdBy, @createdByName)
      `);
    res.json({ ok: true, data: r.recordset[0] });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 更新资产
router.put('/fixed-assets/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const b = req.body;
    if (!b.assetName || !String(b.assetName).trim()) {
      return res.status(400).json({ ok: false, error: '资产名称为必填项' });
    }
    const originalValue = b.originalValue ? Number(b.originalValue) : (b.purchasePrice ? Number(b.purchasePrice) : 0);
    const purchaseDate = b.purchaseDate ? new Date(b.purchaseDate) : new Date();
    const schemeId = b.schemeId ? Number(b.schemeId) : undefined;
    const calc = await calcDeprecByScheme(pool, schemeId, originalValue, purchaseDate);
    const totalQuantity = b.totalQuantity ? Number(b.totalQuantity) : 1;
    // 如果修改了总数量，需校验不能小于已分布数量
    if (b.totalQuantity !== undefined) {
      const distR = await pool.request().input('aid', sql.Int, parseInt(req.params.id))
        .query('SELECT SUM(quantity) AS distributedQty FROM FA_AssetDistribution WHERE assetId=@aid');
      const distributedQty = Number(distR.recordset[0]?.distributedQty) || 0;
      if (totalQuantity < distributedQty) {
        return res.status(400).json({ ok: false, error: `总数量不能小于已分布数量（已分布 ${distributedQty} 个）` });
      }
    }
    await pool.request()
      .input('id', sql.Int, parseInt(req.params.id))
      .input('assetName', sql.NVarChar, b.assetName)
      .input('category', sql.NVarChar, b.category || '')
      .input('assetOwnership', sql.NVarChar, b.assetOwnership || '')
      .input('specModel', sql.NVarChar, b.specModel || '')
      .input('purchaseDate', sql.Date, b.purchaseDate || null)
      .input('purchasePrice', sql.Decimal(18,2), b.purchasePrice || 0)
      .input('supplier', sql.NVarChar, b.supplier || '')
      .input('supplierPhone', sql.NVarChar, b.supplierPhone || '')
      .input('invoiceNo', sql.NVarChar, b.invoiceNo || '')
      .input('status', sql.NVarChar, b.status || 'inuse')
      .input('schemeId', sql.Int, schemeId || null)
      .input('totalQuantity', sql.Int, totalQuantity)
      .input('originalValue', sql.Decimal(18,2), originalValue)
      .input('accumulatedDepreciation', sql.Decimal(18,2), calc.accumulatedDepreciation)
      .input('netValue', sql.Decimal(18,2), calc.netValue)
      .input('depreciationMethod', sql.NVarChar, calc.schemeName || '')
      .input('remark', sql.NVarChar, b.remark || '')
      .input('barcode', sql.NVarChar, b.barcode || '')
      .input('imagePath', sql.NVarChar, b.imagePath || '')
      .query(`
        UPDATE FA_Assets SET assetName=@assetName, category=@category, assetOwnership=@assetOwnership, specModel=@specModel,
          purchaseDate=@purchaseDate, purchasePrice=@purchasePrice,
          supplier=@supplier, supplierPhone=@supplierPhone, invoiceNo=@invoiceNo, status=@status,
          schemeId=@schemeId, totalQuantity=@totalQuantity, originalValue=@originalValue,
          accumulatedDepreciation=@accumulatedDepreciation, netValue=@netValue,
          depreciationMethod=@depreciationMethod, remark=@remark, barcode=@barcode, imagePath=@imagePath, updatedAt=GETDATE()
        WHERE id=@id
      `);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 删除资产
router.delete('/fixed-assets/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    await pool.request().input('id', sql.Int, parseInt(req.params.id))
      .query('DELETE FROM FA_Assets WHERE id=@id');
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 导出资产台账（Excel）
router.get('/fixed-assets/export', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const r = await pool.request().query('SELECT * FROM FA_Assets ORDER BY createdAt DESC');
    const rows = r.recordset.map((a: any, i: number) => ({
      '序号': i + 1,
      '资产编号': a.assetNo || '',
      '资产名称': a.assetName || '',
      '资产类别': a.category || '',
      '资产所属': a.assetOwnership || '',
      '规格型号': a.specModel || '',
      '采购日期': a.purchaseDate ? formatDate(a.purchaseDate) : '',
      '采购价格': Number(a.purchasePrice || 0),
      '供应商': a.supplier || '',
      '联系电话': a.supplierPhone || '',
      '发票号': a.invoiceNo || '',
      '状态': a.status || '',
      '折旧方案': a.depreciationMethod || '',
      '原值': Number(a.originalValue || 0),
      '累计折旧': Number(a.accumulatedDepreciation || 0),
      '净值': Number(a.netValue || 0),
      '总数量': Number(a.totalQuantity || 1),
      '备注': a.remark || '',
    }));
    const assetHeaders = ['序号', '资产编号', '资产名称', '资产类别', '资产所属', '规格型号', '采购日期', '采购价格', '供应商', '联系电话', '发票号', '状态', '折旧方案', '原值', '累计折旧', '净值', '总数量', '备注'];
    const ws = rows.length > 0
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([assetHeaders]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '固定资产台账');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=assets_export.xlsx');
    res.send(buf);
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 导入资产档案（Excel 批量上传）
const assetImportUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.post('/fixed-assets/import', assetImportUpload.single('file'), async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ ok: false, error: '未收到文件' });
    const wb = XLSX.read(file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(ws);

    let inserted = 0;
    let updated = 0;
    let errors: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const assetName = String(r['资产名称'] || r['assetName'] || '');
      if (!assetName) { errors.push(`第${i + 2}行：资产名称为空，跳过`); continue; }
      const category = String(r['资产类别'] || '');
      const assetOwnership = String(r['资产所属'] || '');
      const originalValue = Number(r['原值'] || r['采购价格'] || 0);
      const purchaseDate = r['采购日期'] ? new Date(r['采购日期']) : new Date();
      if (isNaN(purchaseDate.getTime())) { errors.push(`第${i + 2}行：采购日期格式错误，使用今天`); }
      const safeDate = isNaN(purchaseDate.getTime()) ? new Date() : purchaseDate;

      // 查找折旧方案
      const schemeName = r['折旧方案'] || '';
      let schemeId: number | undefined;
      if (schemeName) {
        const sr = await pool.request().input('name', sql.NVarChar, schemeName)
          .query('SELECT TOP 1 id FROM FA_DepreciationScheme WHERE schemeName=@name');
        if (sr.recordset[0]) schemeId = sr.recordset[0].id;
      }
      const calc = await calcDeprecByScheme(pool, schemeId, originalValue, safeDate);
      const totalQuantity = Number(r['总数量'] || 1);

      // 按资产名称+资产类别+资产所属三字段匹配：一致则替换，不一致则新增
      const existR = await pool.request()
        .input('assetName', sql.NVarChar, assetName)
        .input('category', sql.NVarChar, category)
        .input('assetOwnership', sql.NVarChar, assetOwnership)
        .query('SELECT TOP 1 id FROM FA_Assets WHERE assetName=@assetName AND category=@category AND assetOwnership=@assetOwnership ORDER BY id DESC');

      if (existR.recordset[0]) {
        // 三字段一致 → 替换之前记录
        const existId = existR.recordset[0].id;
        await pool.request()
          .input('id', sql.Int, existId)
          .input('assetNo', sql.NVarChar, r['资产编号'] || genAssetNo())
          .input('assetName', sql.NVarChar, assetName)
          .input('category', sql.NVarChar, category)
          .input('assetOwnership', sql.NVarChar, assetOwnership)
          .input('specModel', sql.NVarChar, r['规格型号'] || '')
          .input('purchaseDate', sql.Date, safeDate)
          .input('purchasePrice', sql.Decimal(18,2), Number(r['采购价格'] || originalValue))
          .input('supplier', sql.NVarChar, r['供应商'] || '')
          .input('supplierPhone', sql.NVarChar, r['联系电话'] || '')
          .input('invoiceNo', sql.NVarChar, r['发票号'] || '')
          .input('status', sql.NVarChar, r['状态'] || 'inuse')
          .input('schemeId', sql.Int, schemeId || null)
          .input('totalQuantity', sql.Int, totalQuantity)
          .input('originalValue', sql.Decimal(18,2), originalValue)
          .input('accumulatedDepreciation', sql.Decimal(18,2), calc.accumulatedDepreciation)
          .input('netValue', sql.Decimal(18,2), calc.netValue)
          .input('depreciationMethod', sql.NVarChar, calc.schemeName || schemeName || '')
          .input('remark', sql.NVarChar, r['备注'] || '')
          .input('updatedBy', sql.NVarChar, u.userId)
          .input('updatedByName', sql.NVarChar, u.userName)
          .query(`
            UPDATE FA_Assets SET
              assetNo=@assetNo, assetName=@assetName, category=@category, assetOwnership=@assetOwnership,
              specModel=@specModel, purchaseDate=@purchaseDate, purchasePrice=@purchasePrice,
              supplier=@supplier, supplierPhone=@supplierPhone, invoiceNo=@invoiceNo, status=@status,
              schemeId=@schemeId, totalQuantity=@totalQuantity, originalValue=@originalValue,
              accumulatedDepreciation=@accumulatedDepreciation, netValue=@netValue,
              depreciationMethod=@depreciationMethod, remark=@remark, updatedAt=GETDATE()
            WHERE id=@id
          `);
        updated++;
      } else {
        // 三字段有差异 → 新增
        await pool.request()
          .input('assetNo', sql.NVarChar, r['资产编号'] || genAssetNo())
          .input('assetName', sql.NVarChar, assetName)
          .input('category', sql.NVarChar, category)
          .input('assetOwnership', sql.NVarChar, assetOwnership)
          .input('specModel', sql.NVarChar, r['规格型号'] || '')
          .input('purchaseDate', sql.Date, safeDate)
          .input('purchasePrice', sql.Decimal(18,2), Number(r['采购价格'] || originalValue))
          .input('supplier', sql.NVarChar, r['供应商'] || '')
          .input('supplierPhone', sql.NVarChar, r['联系电话'] || '')
          .input('invoiceNo', sql.NVarChar, r['发票号'] || '')
          .input('status', sql.NVarChar, r['状态'] || 'inuse')
          .input('schemeId', sql.Int, schemeId || null)
          .input('totalQuantity', sql.Int, totalQuantity)
          .input('originalValue', sql.Decimal(18,2), originalValue)
          .input('accumulatedDepreciation', sql.Decimal(18,2), calc.accumulatedDepreciation)
          .input('netValue', sql.Decimal(18,2), calc.netValue)
          .input('depreciationMethod', sql.NVarChar, calc.schemeName || schemeName || '')
          .input('remark', sql.NVarChar, r['备注'] || '')
          .input('createdBy', sql.NVarChar, u.userId)
          .input('createdByName', sql.NVarChar, u.userName)
          .query(`
            INSERT INTO FA_Assets (assetNo, assetName, category, assetOwnership, specModel, purchaseDate,
              purchasePrice, supplier, supplierPhone, invoiceNo, status,
              schemeId, totalQuantity, originalValue, accumulatedDepreciation, netValue,
              depreciationMethod, remark, createdBy, createdByName)
            VALUES (@assetNo, @assetName, @category, @assetOwnership, @specModel, @purchaseDate,
              @purchasePrice, @supplier, @supplierPhone, @invoiceNo, @status,
              @schemeId, @totalQuantity, @originalValue, @accumulatedDepreciation, @netValue,
              @depreciationMethod, @remark, @createdBy, @createdByName)
          `);
        inserted++;
      }
    }
    res.json({ ok: true, data: { inserted, updated, errors } });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 清空全部固定资产档案（高危操作，仅超级管理员/数据管理员可操作）
router.post('/fixed-assets/clear-all', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    // 权限校验：仅超级管理员/数据管理员可清空
    const allowedRoles = ['super_admin', 'data_admin'];
    if (!u.isAdmin && !u.roleCodes.some((c: string) => allowedRoles.includes(c))) {
      return res.status(403).json({ ok: false, error: '无权限，仅超级管理员/数据管理员可清空资产档案' });
    }
    // 先删除关联的分布记录和变动记录
    await pool.request().query('DELETE FROM FA_AssetDistribution');
    await pool.request().query('DELETE FROM FA_TransferLog');
    await pool.request().query('DELETE FROM FA_Disposal');
    // 删除全部资产档案
    const r = await pool.request().query('DELETE FROM FA_Assets');
    res.json({ ok: true, data: { deleted: r.rowsAffected[0] || 0 } });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// ============================================================
// 报废处置 API
// ============================================================

// 获取报废列表
router.get('/disposals', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT d.*, a.assetNo, a.assetName, a.specModel, a.category,
             a.totalQuantity, a.purchasePrice, a.originalValue
      FROM FA_Disposal d
      LEFT JOIN FA_Assets a ON d.assetId = a.id
      ORDER BY d.createdAt DESC
    `);
    res.json({ ok: true, data: result.recordset });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 获取某资产的分布地点列表（供报废表单选择）
router.get('/disposals/asset-locations/:assetId', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const assetId = parseInt(req.params.assetId);
    const result = await pool.request()
      .input('assetId', sql.Int, assetId)
      .query('SELECT id, location, quantity, remark FROM FA_AssetDistribution WHERE assetId=@assetId ORDER BY createdAt DESC');
    // 同时返回资产总数量和已报废数量
    const assetR = await pool.request()
      .input('aid', sql.Int, assetId)
      .query('SELECT totalQuantity FROM FA_Assets WHERE id=@aid');
    const scrappedR = await pool.request()
      .input('aid', sql.Int, assetId)
      .query('SELECT ISNULL(SUM(scrapQuantity),0) AS scrappedQty FROM FA_Disposal WHERE assetId=@aid AND status IN (N\'pending\',N\'approved\')');
    const totalQty = assetR.recordset[0]?.totalQuantity ?? 1;
    const scrappedQty = scrappedR.recordset[0]?.scrappedQty ?? 0;
    res.json({ ok: true, data: { locations: result.recordset, totalQuantity: totalQty, scrappedQuantity: scrappedQty, remaining: Math.max(0, totalQty - scrappedQty) } });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 创建报废申请
router.post('/disposals', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    const b = req.body || {};
    if (!b.assetId) { res.status(400).json({ ok: false, error: '请选择资产' }); return; }
    const assetId = parseInt(b.assetId);
    const scrapQuantity = Math.max(1, parseInt(b.scrapQuantity) || 1);

    // 校验报废数量不超过剩余可报废数量
    const assetR = await pool.request()
      .input('aid', sql.Int, assetId)
      .query('SELECT totalQuantity, assetName, assetNo FROM FA_Assets WHERE id=@aid');
    if (assetR.recordset.length === 0) { res.status(400).json({ ok: false, error: '资产不存在' }); return; }
    const totalQty = assetR.recordset[0].totalQuantity ?? 1;
    const scrappedR = await pool.request()
      .input('aid', sql.Int, assetId)
      .query('SELECT ISNULL(SUM(scrapQuantity),0) AS scrappedQty FROM FA_Disposal WHERE assetId=@aid AND status IN (N\'pending\',N\'approved\')');
    const scrappedQty = scrappedR.recordset[0]?.scrappedQty ?? 0;
    const remaining = Math.max(0, totalQty - scrappedQty);
    if (scrapQuantity > remaining) {
      res.status(400).json({ ok: false, error: `报废数量(${scrapQuantity})超过可报废数量(剩余${remaining}个，总${totalQty}个，已申请报废${scrappedQty}个)` });
      return;
    }

    await pool.request()
      .input('assetId', sql.Int, assetId)
      .input('disposalReason', sql.NVarChar, b.disposalReason || '')
      .input('disposalDate', sql.Date, b.disposalDate || new Date().toISOString().slice(0, 10))
      .input('residualValue', sql.Decimal(18, 2), b.residualValue || 0)
      .input('disposalMethod', sql.NVarChar, b.disposalMethod || '报废')
      .input('scrapQuantity', sql.Int, scrapQuantity)
      .input('distLocation', sql.NVarChar, b.distLocation || '')
      .input('createdBy', sql.NVarChar, u.userId)
      .input('createdByName', sql.NVarChar, u.userName)
      .query(`
        INSERT INTO FA_Disposal (assetId, disposalReason, disposalDate, residualValue, disposalMethod,
          status, scrapQuantity, distLocation, createdBy, createdByName)
        VALUES (@assetId, @disposalReason, @disposalDate, @residualValue, @disposalMethod,
          'pending', @scrapQuantity, @distLocation, @createdBy, @createdByName)
      `);
    res.json({ ok: true, data: { message: '报废申请已创建' } });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 报废审批
router.post('/disposals/:id/approve', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    const id = parseInt(req.params.id);
    const { approved, remark } = req.body || {};
    const status = approved ? 'approved' : 'rejected';
    await pool.request()
      .input('id', sql.Int, id)
      .input('status', sql.NVarChar, status)
      .input('approverId', sql.NVarChar, u.userId)
      .input('approverName', sql.NVarChar, u.userName)
      .input('approvalRemark', sql.NVarChar, remark || '')
      .query(`
        UPDATE FA_Disposal SET status=@status, approverId=@approverId, approverName=@approverName,
          approvalRemark=@approvalRemark, approvalDate=GETDATE()
        WHERE id=@id
      `);
    // 如果审批通过，更新资产状态为报废（仅当资产剩余全部报废时）
    if (approved) {
      const dr = await pool.request().input('id', sql.Int, id).query('SELECT assetId, scrapQuantity FROM FA_Disposal WHERE id=@id');
      if (dr.recordset.length > 0) {
        const aid = dr.recordset[0].assetId;
        const sq = dr.recordset[0].scrapQuantity ?? 1;
        const ar = await pool.request().input('aid', sql.Int, aid).query('SELECT totalQuantity FROM FA_Assets WHERE id=@aid');
        const tq = ar.recordset[0]?.totalQuantity ?? 1;
        const sr = await pool.request().input('aid', sql.Int, aid).query('SELECT ISNULL(SUM(scrapQuantity),0) AS sq FROM FA_Disposal WHERE assetId=@aid AND status=N\'approved\'');
        const totalScrapped = sr.recordset[0]?.sq ?? 0;
        if (totalScrapped >= tq) {
          await pool.request().input('aid', sql.Int, aid).query('UPDATE FA_Assets SET status=N\'scrapped\' WHERE id=@aid');
        }
      }
    }
    res.json({ ok: true, data: { message: `已${approved ? '通过' : '驳回'}报废申请` } });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// ============================================================
// 资产变动 API（归属部门/使用人 从 FA_AssetDistribution 表取）
// ============================================================

// 获取资产的变动记录列表
router.get('/fixed-assets/:id/transfers', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const assetId = parseInt(req.params.id);
    const r = await pool.request().input('aid', sql.Int, assetId)
      .query('SELECT * FROM FA_TransferLog WHERE assetId=@aid ORDER BY createdAt DESC');
    // 从分布表获取当前归属部门(存放地点)、使用人和存放地址
    const distR = await pool.request().input('aid', sql.Int, assetId)
      .query('SELECT TOP 1 location, storageAddress, createdByName FROM FA_AssetDistribution WHERE assetId=@aid ORDER BY createdAt DESC');
    const currentLocation = distR.recordset[0]?.location || '';
    const currentUser = distR.recordset[0]?.createdByName || '';
    const currentStorageAddress = distR.recordset[0]?.storageAddress || '';
    res.json({ ok: true, data: r.recordset, currentLocation, currentUser, currentStorageAddress });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 创建资产变动记录
router.post('/fixed-assets/:id/transfers', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    const assetId = parseInt(req.params.id);
    const b = req.body;
    // 从分布表获取当前归属部门(存放地点)、使用人和存放地址作为 from 值
    const distR = await pool.request().input('aid', sql.Int, assetId)
      .query('SELECT TOP 1 location, storageAddress, createdByName FROM FA_AssetDistribution WHERE assetId=@aid ORDER BY createdAt DESC');
    const fromLocation = distR.recordset[0]?.location || '';
    const fromUser = distR.recordset[0]?.createdByName || '';
    const fromStorageAddress = distR.recordset[0]?.storageAddress || '';
    const r = await pool.request()
      .input('assetId', sql.Int, assetId)
      .input('transferType', sql.NVarChar, b.transferType || 'transfer')
      .input('fromDept', sql.NVarChar, fromLocation)
      .input('toDept', sql.NVarChar, b.toDept || '')
      .input('fromUser', sql.NVarChar, fromUser)
      .input('toUser', sql.NVarChar, b.toUser || '')
      .input('fromLocation', sql.NVarChar, fromStorageAddress)
      .input('toLocation', sql.NVarChar, b.toLocation || '')
      .input('reason', sql.NVarChar, b.reason || '')
      .input('status', sql.NVarChar, 'approved')
      .input('operateDate', sql.Date, b.operateDate || new Date().toISOString().slice(0, 10))
      .input('createdBy', sql.NVarChar, u.userId)
      .input('createdByName', sql.NVarChar, u.userName)
      .query(`
        INSERT INTO FA_TransferLog (assetId, transferType, fromDept, toDept, fromUser, toUser,
          fromLocation, toLocation, reason, status, operateDate, createdBy, createdByName)
        OUTPUT INSERTED.*
        VALUES (@assetId, @transferType, @fromDept, @toDept, @fromUser, @toUser,
          @fromLocation, @toLocation, @reason, @status, @operateDate, @createdBy, @createdByName)
      `);
    // 如果是调拨类操作且有新存放地，同步更新分布表中的地点
    const syncTypes = ['transfer', 'assign', 'companyToStore', 'storeToCompany'];
    if (syncTypes.includes(b.transferType) && b.toLocation && fromLocation) {
      await pool.request()
        .input('aid', sql.Int, assetId)
        .input('oldLoc', sql.NVarChar, fromLocation)
        .input('newLoc', sql.NVarChar, b.toLocation)
        .query('UPDATE FA_AssetDistribution SET location=@newLoc WHERE assetId=@aid AND location=@oldLoc');
    }
    res.json({ ok: true, data: r.recordset[0] });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '';
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const h = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${dd} ${h}:${mi}`;
}

// ============================================================
// 授权人管理 API（管理驾照、证件等授权类资质，含证件图片上传）
// ============================================================

// 证件上传配置
const certUpload = multer({
  storage: multer.diskStorage({
    destination(_req: any, _file: any, cb: any) {
      const dir = path.resolve(process.cwd(), 'uploads', 'certificate');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req: any, file: any, cb: any) {
      const ext = path.extname(file.originalname) || '.png';
      cb(null, 'cert_' + Date.now() + '_' + Math.round(Math.random() * 1e6) + ext);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// 建表（授权人 + 证件）
async function ensureAuthPersonTables(): Promise<void> {
  const pool = await getPool();
  // 授权人表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'FA_AuthorizedPersons')
    CREATE TABLE FA_AuthorizedPersons (
      id INT IDENTITY(1,1) PRIMARY KEY,
      personName NVARCHAR(100) NOT NULL,
      phone NVARCHAR(50),
      dept NVARCHAR(200),
      remark NVARCHAR(MAX),
      createdBy NVARCHAR(100),
      createdByName NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE()
    )
  `);
  // 证件表
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'FA_Certificates')
    CREATE TABLE FA_Certificates (
      id INT IDENTITY(1,1) PRIMARY KEY,
      personId INT NOT NULL,
      certType NVARCHAR(50) NOT NULL,
      certNo NVARCHAR(100),
      issueDate DATE,
      expiryDate DATE,
      filePath NVARCHAR(500),
      fileName NVARCHAR(200),
      remark NVARCHAR(MAX),
      createdBy NVARCHAR(100),
      createdByName NVARCHAR(100),
      createdAt DATETIME DEFAULT GETDATE(),
      updatedAt DATETIME DEFAULT GETDATE()
    )
  `);
}

// 获取授权人列表（含证件数量）
router.get('/authorized-persons', async (req: Request, res: Response) => {
  try {
    await ensureAuthPersonTables();
    const pool = await getPool();
    const { keyword } = req.query;
    let q = `SELECT p.*, (SELECT COUNT(*) FROM FA_Certificates c WHERE c.personId = p.id) AS certCount
      FROM FA_AuthorizedPersons p WHERE 1=1`;
    const r = pool.request();
    if (keyword) { q += ' AND (p.personName LIKE @kw OR p.phone LIKE @kw OR p.dept LIKE @kw)'; r.input('kw', sql.NVarChar, `%${keyword}%`); }
    q += ' ORDER BY p.createdAt DESC';
    const result = await r.query(q);
    res.json({ ok: true, data: result.recordset });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 新增授权人
router.post('/authorized-persons', async (req: Request, res: Response) => {
  try {
    await ensureAuthPersonTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    const b = req.body;
    if (!b.personName?.trim()) return res.status(400).json({ ok: false, error: '姓名为必填项' });
    const r = await pool.request()
      .input('personName', sql.NVarChar, b.personName)
      .input('phone', sql.NVarChar, b.phone || '')
      .input('dept', sql.NVarChar, b.dept || '')
      .input('remark', sql.NVarChar, b.remark || '')
      .input('createdBy', sql.NVarChar, u.userId)
      .input('createdByName', sql.NVarChar, u.userName)
      .query(`
        INSERT INTO FA_AuthorizedPersons (personName, phone, dept, remark, createdBy, createdByName)
        OUTPUT INSERTED.*
        VALUES (@personName, @phone, @dept, @remark, @createdBy, @createdByName)
      `);
    res.json({ ok: true, data: r.recordset[0] });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 更新授权人
router.put('/authorized-persons/:id', async (req: Request, res: Response) => {
  try {
    await ensureAuthPersonTables();
    const pool = await getPool();
    const b = req.body;
    await pool.request()
      .input('id', sql.Int, parseInt(req.params.id))
      .input('personName', sql.NVarChar, b.personName || '')
      .input('phone', sql.NVarChar, b.phone || '')
      .input('dept', sql.NVarChar, b.dept || '')
      .input('remark', sql.NVarChar, b.remark || '')
      .query(`
        UPDATE FA_AuthorizedPersons SET personName=@personName, phone=@phone, dept=@dept, remark=@remark, updatedAt=GETDATE()
        WHERE id=@id
      `);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 删除授权人（关联证件也删除）
router.delete('/authorized-persons/:id', async (req: Request, res: Response) => {
  try {
    await ensureAuthPersonTables();
    const pool = await getPool();
    const id = parseInt(req.params.id);
    await pool.request().input('pid', sql.Int, id).query('DELETE FROM FA_Certificates WHERE personId=@pid');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM FA_AuthorizedPersons WHERE id=@id');
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 获取某授权人的证件列表
router.get('/authorized-persons/:id/certificates', async (req: Request, res: Response) => {
  try {
    await ensureAuthPersonTables();
    const pool = await getPool();
    const r = await pool.request().input('pid', sql.Int, parseInt(req.params.id))
      .query('SELECT * FROM FA_Certificates WHERE personId=@pid ORDER BY createdAt DESC');
    res.json({ ok: true, data: r.recordset });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 上传证件图片
router.post('/authorized-persons/:id/certificates', certUpload.single('file'), async (req: Request, res: Response) => {
  try {
    await ensureAuthPersonTables();
    const pool = await getPool();
    const u = getCurrentUser(req);
    const personId = parseInt(req.params.id);
    const { certType, certNo, issueDate, expiryDate, remark } = req.body;
    if (!certType?.trim()) return res.status(400).json({ ok: false, error: '证件类型为必填项' });
    const filePath = req.file ? `/uploads/certificate/${req.file.filename}` : '';
    const fileName = req.file?.originalname || '';
    const r = await pool.request()
      .input('personId', sql.Int, personId)
      .input('certType', sql.NVarChar, certType)
      .input('certNo', sql.NVarChar, certNo || '')
      .input('issueDate', sql.Date, issueDate || null)
      .input('expiryDate', sql.Date, expiryDate || null)
      .input('filePath', sql.NVarChar, filePath)
      .input('fileName', sql.NVarChar, fileName)
      .input('remark', sql.NVarChar, remark || '')
      .input('createdBy', sql.NVarChar, u.userId)
      .input('createdByName', sql.NVarChar, u.userName)
      .query(`
        INSERT INTO FA_Certificates (personId, certType, certNo, issueDate, expiryDate, filePath, fileName, remark, createdBy, createdByName)
        OUTPUT INSERTED.*
        VALUES (@personId, @certType, @certNo, @issueDate, @expiryDate, @filePath, @fileName, @remark, @createdBy, @createdByName)
      `);
    res.json({ ok: true, data: r.recordset[0] });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 删除证件
router.delete('/certificates/:id', async (req: Request, res: Response) => {
  try {
    await ensureAuthPersonTables();
    const pool = await getPool();
    const id = parseInt(req.params.id);
    const r = await pool.request().input('id', sql.Int, id).query('SELECT filePath FROM FA_Certificates WHERE id=@id');
    const filePath = r.recordset[0]?.filePath;
    if (filePath) {
      const absPath = path.join(process.cwd(), filePath.replace(/^\//, ''));
      if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
    }
    await pool.request().input('id', sql.Int, id).query('DELETE FROM FA_Certificates WHERE id=@id');
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

export default router;
