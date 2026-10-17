import { Router, Request, Response } from 'express';
import sql from 'mssql';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getPool } from '../../config/db';
import { GC_CLASS_MENUS, expandLegacyMenuKeys } from '../services/portalRegistry';
import {
  applyWatermark,
  isProtectedDocExt,
  makeWatermarkText,
  PROTECTED_DOC_EXTS,
} from '../services/growthClassroomWatermark';

const router = Router();
let ensured = false;

// ============================================================
// 成长课堂 - 磁盘上传配置（视频可能较大，限额 1GB）
// ============================================================
const gcUpload = multer({
  storage: multer.diskStorage({
    destination(_req: any, _file: any, cb: any) {
      const dir = path.resolve(process.cwd(), 'uploads', 'growth-classroom');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req: any, file: any, cb: any) {
      const ext = path.extname(file.originalname) || '';
      cb(null, 'gc_' + Date.now() + '_' + Math.round(Math.random() * 1e6) + ext);
    },
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB
});

// 允许的文件扩展名白名单
const ALLOWED_EXTS = [
  '.mp4', '.webm', '.mov', '.mkv', '.avi', '.flv', '.wmv',
  '.ppt', '.pptx', '.doc', '.docx', '.xls', '.xlsx',
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.txt',
];

function detectFileType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (['.mp4', '.webm', '.mov', '.mkv', '.avi', '.flv', '.wmv'].includes(ext)) return 'video';
  if (['.ppt', '.pptx'].includes(ext)) return 'ppt';
  if (['.doc', '.docx'].includes(ext)) return 'word';
  if (['.xls', '.xlsx'].includes(ext)) return 'excel';
  if (ext === '.pdf') return 'pdf';
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) return 'image';
  return 'other';
}

// multer/busboy 默认按 latin1 解码 multipart 文本字段与文件名，
// 浏览器以 UTF-8 字节发送中文时会被误读成乱码（mojibake），此处修复回 UTF-8
function fixMultipartEncoding(v: string): string {
  if (!v) return v;
  if (!/[\u0080-\u00ff]/.test(v)) return v; // 纯 ASCII 无需处理
  try {
    const fixed = Buffer.from(v, 'latin1').toString('utf8');
    if (!fixed.includes('\uFFFD')) return fixed; // 修复成功且无替换符
  } catch { /* 保留原值 */ }
  return v;
}

// 将资料标题清洗为可安全用于磁盘文件名的片段：
// 剔除 Windows 非法字符、控制字符与首尾点号（防路径穿越），并限制长度
function safeFilePart(s: string): string {
  const cleaned = (s || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\x00-\x1f]/g, '')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim()
    .slice(0, 60);
  return cleaned || 'untitled';
}

// ============================================================
// 建表逻辑（幂等 + 7 个部门分类种子）
// ============================================================
export const GC_CATEGORIES = [
  { code: 'product', name: '品研中心（商品）' },
  { code: 'hr', name: '人才发展（人事）' },
  { code: 'ops', name: '运营智库（运营）' },
  { code: 'finance', name: '财务规范（财务）' },
  { code: 'admin', name: '行政指南（行政）' },
  { code: 'sysops', name: '系统实操（实操）' },
  { code: 'member', name: '会员研习（会员）' },
];

// ============================================================
// 成长课堂分类菜单授权（与 portalRegistry.GC_CLASS_MENUS 对齐）
//   - 已登录用户（JWT 带 roleIds）：按授权的 gc* 菜单过滤可见分类/上传动作；旧版整体授权键自动展开
//   - 匿名或 JWT 无角色（enforce=false 过渡期）：维持现状放行
// ============================================================
function catCodeToMenuEn(catCode: string): string {
  const hit = GC_CLASS_MENUS.find(m => m.catCode === catCode);
  return hit ? hit.menuEn : '';
}

/** 已登录用户授权到的成长课堂菜单集合（portalEn=growthClassroom 的 menuEn；旧整体键已展开） */
async function getGrantedGCMenuEns(user: any): Promise<Set<string> | null> {
  if (!user || !Array.isArray(user.roleIds) || user.roleIds.length === 0) return null;
  const roleIds: number[] = user.roleIds.filter((id: any) => typeof id === 'number');
  if (roleIds.length === 0) return null;
  const pool = await getPool();
  const placeholders = roleIds.map((_, i) => `@r${i}`).join(',');
  const q = pool.request();
  roleIds.forEach((rid, i) => q.input(`r${i}`, sql.Int, rid));
  const result = await q.query(`
    SELECT DISTINCT portal_en, menu_en FROM sys_role_menu WHERE role_id IN (${placeholders})
  `);
  const ens = new Set<string>();
  for (const g of expandLegacyMenuKeys(result.recordset.map((r: any) => ({ portalEn: r.portal_en, menuEn: r.menu_en })))) {
    if (g.portalEn === 'growthClassroom') ens.add(g.menuEn);
  }
  return ens;
}

/** 已登录用户可见的资料分类 code 集合（未登录返回 null） */
async function getVisibleCatCodes(user: any): Promise<Set<string> | null> {
  const ens = await getGrantedGCMenuEns(user);
  if (!ens) return null;
  const codes = new Set<string>();
  for (const m of GC_CLASS_MENUS) {
    if (m.catCode && ens.has(m.menuEn)) codes.add(m.catCode);
  }
  return codes;
}

async function ensureTables(): Promise<void> {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GC_Category')
    CREATE TABLE GC_Category (
      id INT IDENTITY(1,1) PRIMARY KEY,
      catCode NVARCHAR(50) NOT NULL UNIQUE,
      catName NVARCHAR(100) NOT NULL,
      sortNo INT NOT NULL DEFAULT 0
    )
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GC_Material')
    CREATE TABLE GC_Material (
      id INT IDENTITY(1,1) PRIMARY KEY,
      categoryCode NVARCHAR(50) NOT NULL,
      title NVARCHAR(200) NOT NULL UNIQUE,
      summary NVARCHAR(MAX) NOT NULL,
      fileName NVARCHAR(255) NOT NULL,
      filePath NVARCHAR(500) NOT NULL,
      fileSize BIGINT NOT NULL DEFAULT 0,
      fileType NVARCHAR(20) NOT NULL DEFAULT 'other',
      uploaderCode NVARCHAR(50) NOT NULL DEFAULT '',
      uploaderName NVARCHAR(100) NOT NULL DEFAULT '',
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);
  // 子类（子区）表：分类下用户自定义子区，上传时输入新值自动建档
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GC_SubCategory')
    CREATE TABLE GC_SubCategory (
      id INT IDENTITY(1,1) PRIMARY KEY,
      categoryCode NVARCHAR(50) NOT NULL,
      subName NVARCHAR(100) NOT NULL,
      createdAt DATETIME DEFAULT GETDATE(),
      CONSTRAINT UQ_GC_SubCategory UNIQUE (categoryCode, subName)
    )
  `);
  // GC_Material 增加子类字段（幂等补列，已有库无需重建表）
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('GC_Material') AND name = 'subCategory')
    ALTER TABLE GC_Material ADD subCategory NVARCHAR(100) NOT NULL CONSTRAINT DF_GC_Material_subCategory DEFAULT ''
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GC_WatchLog')
    CREATE TABLE GC_WatchLog (
      id INT IDENTITY(1,1) PRIMARY KEY,
      materialId INT NOT NULL,
      userCode NVARCHAR(50) NOT NULL DEFAULT '',
      userName NVARCHAR(100) NOT NULL DEFAULT '',
      watchSeconds INT NOT NULL DEFAULT 0,
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GC_DownloadLog')
    CREATE TABLE GC_DownloadLog (
      id INT IDENTITY(1,1) PRIMARY KEY,
      materialId INT NOT NULL,
      userCode NVARCHAR(50) NOT NULL DEFAULT '',
      userName NVARCHAR(100) NOT NULL DEFAULT '',
      createdAt DATETIME DEFAULT GETDATE()
    )
  `);
  // 分类种子：幂等插入 7 个部门分类
  const cnt = await pool.request().query(`SELECT COUNT(*) AS n FROM GC_Category`);
  if (cnt.recordset[0].n === 0) {
    for (let i = 0; i < GC_CATEGORIES.length; i++) {
      const c = GC_CATEGORIES[i];
      await pool.request()
        .input('code', sql.NVarChar, c.code)
        .input('name', sql.NVarChar, c.name)
        .input('sort', sql.Int, i + 1)
        .query(`INSERT INTO GC_Category (catCode, catName, sortNo) VALUES (@code, @name, @sort)`);
    }
  }
}

// ============================================================
// 分类列表
// ============================================================
router.get('/categories', async (_req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT c.catCode, c.catName,
        (SELECT COUNT(*) FROM GC_Material m WHERE m.categoryCode = c.catCode) AS materialCount
      FROM GC_Category c ORDER BY c.sortNo
    `);
    res.json({ ok: true, data: result.recordset });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// 子类（子区）列表：供上传弹窗选择；上传时输入新值自动建档
// ============================================================
router.get('/subcategories', async (_req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT s.id, s.categoryCode, s.subName FROM GC_SubCategory s ORDER BY s.categoryCode, s.id
    `);
    res.json({ ok: true, data: result.recordset });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// 子类（子区）管理：新增 / 改名 / 删除（与上传/删除共用「上传资料」管理权限）
// 改名时会级联同步该分类下资料的 subCategory 引用；删除时其下资料移入未分区，子区档案独立删除
// ============================================================
router.post('/subcategories', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const user = (req as any).user;
    const grantedEns = await getGrantedGCMenuEns(user);
    if (grantedEns && !grantedEns.has('gcUpload')) {
      return res.status(403).json({ ok: false, error: '您未被授予「上传资料」管理权限' });
    }
    const categoryCode = ((req.body?.categoryCode || '') as string).trim();
    const subName = ((req.body?.subName || '') as string).trim();
    if (!categoryCode) return res.status(400).json({ ok: false, error: '请选择所属分类' });
    if (!subName) return res.status(400).json({ ok: false, error: '子区名称不能为空' });
    if (subName.length > 100) return res.status(400).json({ ok: false, error: '子区名称最多 100 个字符' });

    const pool = await getPool();
    const catCheck = await pool.request().input('cat', sql.NVarChar, categoryCode)
      .query(`SELECT TOP 1 catCode FROM GC_Category WHERE catCode=@cat`);
    if (!catCheck.recordset.length) {
      return res.status(400).json({ ok: false, error: '所选分类不存在' });
    }
    const dup = await pool.request().input('cat', sql.NVarChar, categoryCode)
      .input('sub', sql.NVarChar, subName)
      .query(`SELECT TOP 1 id FROM GC_SubCategory WHERE categoryCode=@cat AND subName=@sub`);
    if (dup.recordset.length) {
      return res.status(409).json({ ok: false, error: '该分类下已存在同名子区' });
    }
    await pool.request().input('cat', sql.NVarChar, categoryCode)
      .input('sub', sql.NVarChar, subName)
      .query(`INSERT INTO GC_SubCategory (categoryCode, subName) VALUES (@cat, @sub)`);
    res.json({ ok: true, message: '新增成功' });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.patch('/subcategories/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const user = (req as any).user;
    const grantedEns = await getGrantedGCMenuEns(user);
    if (grantedEns && !grantedEns.has('gcUpload')) {
      return res.status(403).json({ ok: false, error: '您未被授予「上传资料」管理权限' });
    }
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: '参数不正确' });
    const newName = ((req.body?.subName || '') as string).trim();
    if (!newName) return res.status(400).json({ ok: false, error: '子区名称不能为空' });
    if (newName.length > 100) return res.status(400).json({ ok: false, error: '子区名称最多 100 个字符' });

    const pool = await getPool();
    const found = await pool.request().input('sid', sql.Int, id)
      .query(`SELECT TOP 1 id, categoryCode, subName FROM GC_SubCategory WHERE id=@sid`);
    if (!found.recordset.length) {
      return res.status(404).json({ ok: false, error: '子区不存在或已被删除' });
    }
    const cat: string = found.recordset[0].categoryCode;
    const oldName: string = found.recordset[0].subName;
    if (newName === oldName) return res.json({ ok: true, message: '名称未变化' });

    // 改名（事务）：级联同步该分类下资料引用 + 更新子区档案命名
    const tx = pool.transaction();
    try {
      await tx.begin();
      const dup = await tx.request().input('cat', sql.NVarChar, cat)
        .input('sub', sql.NVarChar, newName)
        .input('sid', sql.Int, id)
        .query(`SELECT TOP 1 id FROM GC_SubCategory WHERE categoryCode=@cat AND subName=@sub AND id<>@sid`);
      if (dup.recordset.length) {
        await tx.rollback().catch(() => {});
        return res.status(409).json({ ok: false, error: '该分类下已存在同名子区' });
      }
      await tx.request().input('cat', sql.NVarChar, cat)
        .input('old', sql.NVarChar, oldName)
        .input('new', sql.NVarChar, newName)
        .query(`UPDATE GC_Material SET subCategory=@new WHERE categoryCode=@cat AND subCategory=@old`);
      await tx.request().input('sid', sql.Int, id)
        .input('sub', sql.NVarChar, newName)
        .query(`UPDATE GC_SubCategory SET subName=@sub WHERE id=@sid`);
      await tx.commit();
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    }
    res.json({ ok: true, message: '改名成功' });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.delete('/subcategories/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const user = (req as any).user;
    const grantedEns = await getGrantedGCMenuEns(user);
    if (grantedEns && !grantedEns.has('gcUpload')) {
      return res.status(403).json({ ok: false, error: '您未被授予「上传资料」管理权限' });
    }
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: '参数不正确' });
    const pool = await getPool();
    const found = await pool.request().input('sid', sql.Int, id)
      .query(`SELECT TOP 1 id, categoryCode, subName FROM GC_SubCategory WHERE id=@sid`);
    if (!found.recordset.length) {
      return res.status(404).json({ ok: false, error: '子区不存在或已被删除' });
    }
    const cat: string = found.recordset[0].categoryCode;
    const subName: string = found.recordset[0].subName;

    // 删除（事务）：该子区下资料移入未分区（不删除资料）+ 删除子区档案
    const tx = pool.transaction();
    try {
      await tx.begin();
      await tx.request().input('cat', sql.NVarChar, cat)
        .input('sub', sql.NVarChar, subName)
        .query(`UPDATE GC_Material SET subCategory='' WHERE categoryCode=@cat AND subCategory=@sub`);
      await tx.request().input('sid', sql.Int, id)
        .query(`DELETE FROM GC_SubCategory WHERE id=@sid`);
      await tx.commit();
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    }
    res.json({ ok: true, message: '删除成功，该子区下资料已移入未分区' });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// 资料列表（可按分类筛选 + 关键字搜索），带观看/下载统计
// ============================================================
router.get('/materials', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const user = (req as any).user;
    const category = (req.query.category || '') as string;
    const keyword = ((req.query.keyword || '') as string).trim();
    let where = 'WHERE 1=1';
    let catFilter: string[] | null = null; // 已登录用户可见分类 code 列表（null=不限）

    // 已登录用户：按分类授权过滤（旧整体授权展开）；指定分类时先校验该分类授权
    const visibleCats = await getVisibleCatCodes(user);
    if (visibleCats) {
      if (category) {
        const menuEn = catCodeToMenuEn(category);
        if (menuEn && !(await getGrantedGCMenuEns(user))!.has(menuEn)) {
          return res.status(403).json({ ok: false, error: '您未被授权查看该分类的资料' });
        }
      } else if (visibleCats.size === 0) {
        // 未授权任何资料分类：直接返回空列表
        return res.json({ ok: true, data: [] });
      } else {
        catFilter = Array.from(visibleCats);
      }
    }

    if (category) {
      const r = pool.request().input('cat', sql.NVarChar, category);
      const result = await r.query(`SELECT TOP 1 catCode FROM GC_Category WHERE catCode=@cat`);
      if (!result.recordset.length) {
        return res.json({ ok: true, data: [] });
      }
      where += ' AND m.categoryCode=@cat';
    }
    if (catFilter) {
      const catPh = catFilter.map((_, i) => `@catF${i}`).join(',');
      where += ` AND m.categoryCode IN (${catPh})`;
    }
    if (keyword) {
      where += ' AND (m.title LIKE @kw OR m.summary LIKE @kw)';
    }
    const q = pool.request();
    if (category) q.input('cat', sql.NVarChar, category);
    if (catFilter) catFilter.forEach((c, i) => q.input(`catF${i}`, sql.NVarChar, c));
    if (keyword) q.input('kw', sql.NVarChar, `%${keyword}%`);
    const result = await q.query(`
      SELECT m.id, m.categoryCode, m.subCategory, c.catName, m.title, m.summary, m.fileName, m.filePath,
        m.fileSize, m.fileType, m.uploaderCode, m.uploaderName, m.createdAt,
        (SELECT COUNT(DISTINCT w.userCode) FROM GC_WatchLog w WHERE w.materialId=m.id) AS viewUsers,
        (SELECT ISNULL(SUM(w.watchSeconds), 0) FROM GC_WatchLog w WHERE w.materialId=m.id) AS viewSeconds,
        (SELECT COUNT(DISTINCT d.userCode) FROM GC_DownloadLog d WHERE d.materialId=m.id) AS downloadUsers,
        (SELECT COUNT(*) FROM GC_DownloadLog d WHERE d.materialId=m.id) AS downloadCount
      FROM GC_Material m
      LEFT JOIN GC_Category c ON c.catCode = m.categoryCode
      ${where}
      ORDER BY m.createdAt DESC
    `);
    res.json({ ok: true, data: result.recordset });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// 上传资料（标题唯一 + 内容概述必填 + 分类必选）
// ============================================================
router.post('/materials', gcUpload.single('file'), async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const user = (req as any).user;
    // 已登录用户：未授予「上传资料」菜单权限时禁止上传（文件已落盘需清理）
    const grantedEns = await getGrantedGCMenuEns(user);
    if (grantedEns && !grantedEns.has('gcUpload')) {
      try { if (req.file) fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return res.status(403).json({ ok: false, error: '您未被授予「上传资料」权限' });
    }
    const title = fixMultipartEncoding(((req.body.title || '') as string).trim());
    const categoryCode = fixMultipartEncoding(((req.body.category || '') as string).trim());
    const summary = fixMultipartEncoding(((req.body.summary || '') as string).trim());
    const subCategory = fixMultipartEncoding(((req.body.subCategory || '') as string).trim());
    const originalName = fixMultipartEncoding(req.file ? req.file.originalname : '');
    if (!title) return res.status(400).json({ ok: false, error: '标题不能为空' });
    if (!summary) return res.status(400).json({ ok: false, error: '内容概述为必填项' });
    if (!categoryCode) return res.status(400).json({ ok: false, error: '请选择所属分类' });
    if (!req.file) return res.status(400).json({ ok: false, error: '请选择要上传的文件' });

    const ext = path.extname(originalName).toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) {
      // 删除已落盘的非法文件
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return res.status(400).json({ ok: false, error: `不支持的文件类型：${ext || '未知'}` });
    }

    const pool = await getPool();
    // 分类存在性
    const catCheck = await pool.request().input('cat', sql.NVarChar, categoryCode)
      .query(`SELECT TOP 1 catCode FROM GC_Category WHERE catCode=@cat`);
    if (!catCheck.recordset.length) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return res.status(400).json({ ok: false, error: '所选分类不存在' });
    }
    // 标题唯一（DB 有 UNIQUE 约束，这里先查后插给出友好提示，仍加 try/catch 兜底约束冲突）
    const dup = await pool.request().input('t', sql.NVarChar, title)
      .query(`SELECT TOP 1 id FROM GC_Material WHERE title=@t`);
    if (dup.recordset.length) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return res.status(409).json({ ok: false, error: '标题已存在，不能重复上传' });
    }
    if (subCategory.length > 100) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return res.status(400).json({ ok: false, error: '子类名称最多 100 个字符' });
    }

    // 子类（可选）：该分类下不存在时自动建档为子区（幂等；建档失败不阻断上传）
    if (subCategory) {
      try {
        const subExists = await pool.request()
          .input('cat', sql.NVarChar, categoryCode)
          .input('sub', sql.NVarChar, subCategory)
          .query('SELECT TOP 1 id FROM GC_SubCategory WHERE categoryCode=@cat AND subName=@sub');
        if (!subExists.recordset.length) {
          await pool.request()
            .input('cat', sql.NVarChar, categoryCode)
            .input('sub', sql.NVarChar, subCategory)
            .query('INSERT INTO GC_SubCategory (categoryCode, subName) VALUES (@cat, @sub)');
        }
      } catch (e: any) {
        console.error('[growth-classroom] 子类建档失败（不影响上传）:', e.message);
      }
    }

    const fileType = detectFileType(originalName);
    // 磁盘命名规则：gc_时间戳_随机数_标题.扩展名（标题清洗后拼入，失败时沿用临时名）
    const storedExt = path.extname(req.file.path) || ext;
    const storedBase = path.basename(req.file.path, storedExt); // gc_时间戳_随机数
    const finalName = `${storedBase}_${safeFilePart(title)}${storedExt}`;
    const finalPath = path.join(path.dirname(req.file.path), finalName);
    try {
      fs.renameSync(req.file.path, finalPath);
      req.file.path = finalPath; // 保持后续清理/路径一致
    } catch { /* 重命名失败（罕见）则沿用临时文件名 */ }
    const filePath = '/uploads/growth-classroom/' + path.basename(req.file.path);
    const uploaderCode = user?.userCode || user?.userId || '';
    const uploaderName = user?.userName || '';

    await pool.request()
      .input('cat', sql.NVarChar, categoryCode)
      .input('subc', sql.NVarChar, subCategory || '')
      .input('t', sql.NVarChar, title)
      .input('sum', sql.NVarChar, summary)
      .input('fn', sql.NVarChar, originalName)
      .input('fp', sql.NVarChar, filePath)
      .input('fs', sql.BigInt, req.file.size)
      .input('ft', sql.NVarChar, fileType)
      .input('uc', sql.NVarChar, uploaderCode)
      .input('un', sql.NVarChar, uploaderName)
      .query(`
        INSERT INTO GC_Material (categoryCode, subCategory, title, summary, fileName, filePath, fileSize, fileType, uploaderCode, uploaderName)
        VALUES (@cat, @subc, @t, @sum, @fn, @fp, @fs, @ft, @uc, @un)
      `);
    res.json({ ok: true, message: '上传成功' });
  } catch (e: any) {
    // 标题唯一约束冲突兜底
    if (String(e.message || '').includes('UNIQUE') || String(e.message || '').includes('duplicate')) {
      try { if (req.file) fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return res.status(409).json({ ok: false, error: '标题已存在，不能重复上传' });
    }
    try { if (req.file) fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// 记录观看日志（前端按播放进度增量上报，单位：秒）
// ============================================================
router.post('/materials/:id/watch', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const user = (req as any).user;
    const materialId = parseInt(req.params.id);
    const seconds = Math.max(0, Math.min(86400, Math.floor(Number(req.body.seconds) || 0)));
    if (!materialId || seconds <= 0) {
      return res.status(400).json({ ok: false, error: '参数不正确' });
    }
    const pool = await getPool();
    const userCode = user?.userCode || user?.userId || '';
    const userName = user?.userName || '';
    // 观看日志只记录已登录用户，匿名（未登录）忽略
    if (!userCode) {
      return res.json({ ok: true, ignored: true });
    }
    await pool.request()
      .input('mid', sql.Int, materialId)
      .input('uc', sql.NVarChar, userCode)
      .input('un', sql.NVarChar, userName)
      .input('sec', sql.Int, seconds)
      .query(`INSERT INTO GC_WatchLog (materialId, userCode, userName, watchSeconds) VALUES (@mid, @uc, @un, @sec)`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// 记录下载日志（旧版前端直下时调用；下载留痕已并入 GET /materials/:id/download）
// ============================================================
router.post('/materials/:id/download', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const user = (req as any).user;
    const materialId = parseInt(req.params.id);
    if (!materialId) return res.status(400).json({ ok: false, error: '参数不正确' });
    const pool = await getPool();
    const userCode = user?.userCode || user?.userId || '';
    if (!userCode) {
      return res.json({ ok: true, ignored: true });
    }
    await pool.request()
      .input('mid', sql.Int, materialId)
      .input('uc', sql.NVarChar, userCode)
      .input('un', sql.NVarChar, user?.userName || '')
      .query(`INSERT INTO GC_DownloadLog (materialId, userCode, userName) VALUES (@mid, @uc, @un)`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// 受保护文档的 Content-Type / 下载文件名映射
// ============================================================
function gcContentType(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.pdf': return 'application/pdf';
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.doc': return 'application/msword';
    case '.pptx': return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case '.ppt': return 'application/vnd.ms-powerpoint';
    case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xls': return 'application/vnd.ms-excel';
    default: return 'application/octet-stream';
  }
}

/** 下载响应头：ASCII 兜底 + RFC5987 中文文件名（防乱码、防响应头注入） */
function gcAttachmentDisposition(fileName: string, inline: boolean): string {
  const ascii = String(fileName || 'download').replace(/[^\x20-\x7e]/g, '_').replace(/["\\\r\n]/g, '_');
  const mode = inline ? 'inline' : 'attachment';
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName || 'download')}`;
}

/** 磁盘文件绝对路径（仅允许 storeDir 内，防路径穿越） */
function gcStoreFile(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  const storeDir = path.resolve(process.cwd(), 'uploads', 'growth-classroom');
  const abs = path.resolve(storeDir, path.basename(filePath));
  if (!abs.startsWith(storeDir + path.sep)) return null;
  return fs.existsSync(abs) ? abs : null;
}

// ============================================================
// 在线预览取文件（文档类预览统一走此接口：鉴权 + 绕过静态直出）
// ============================================================
router.get('/materials/:id/file', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const user = (req as any).user;
    if (!user?.userCode) {
      return res.status(401).json({ ok: false, error: '请先登录后再预览' });
    }
    const materialId = parseInt(req.params.id);
    if (!materialId) return res.status(400).json({ ok: false, error: '参数不正确' });
    const pool = await getPool();
    const found = await pool.request().input('mid', sql.Int, materialId)
      .query(`SELECT TOP 1 id, fileName, filePath FROM GC_Material WHERE id=@mid`);
    if (!found.recordset.length) {
      return res.status(404).json({ ok: false, error: '资料不存在或已被删除' });
    }
    const m = found.recordset[0];
    const abs = gcStoreFile(m.filePath);
    if (!abs) {
      return res.status(404).json({ ok: false, error: '文件不存在或已被删除' });
    }
    const ext = path.extname(m.fileName || '') || path.extname(m.filePath || '') || '';
    res.setHeader('Content-Type', gcContentType(ext));
    res.setHeader('Content-Disposition', gcAttachmentDisposition(m.fileName || 'file', true));
    res.sendFile(abs);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// 下载（四类文档叠加下载人水印 + 统一记录下载留痕）
//   - 登录后下载；匿名返回 403（需留痕与水印，无法匿名提供服务）
//   - video/image/txt 等其它类型仍可走本接口下载（不加水印，但同样留痕）
// ============================================================
router.get('/materials/:id/download', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const user = (req as any).user;
    const materialId = parseInt(req.params.id);
    if (!materialId) return res.status(400).json({ ok: false, error: '参数不正确' });
    if (!user?.userCode) {
      return res.status(403).json({ ok: false, error: '请先登录后再下载（下载将记录留痕并叠加水印）' });
    }
    const pool = await getPool();
    const found = await pool.request().input('mid', sql.Int, materialId)
      .query(`SELECT TOP 1 id, title, fileName, filePath, fileType, fileSize FROM GC_Material WHERE id=@mid`);
    if (!found.recordset.length) {
      return res.status(404).json({ ok: false, error: '资料不存在或已被删除' });
    }
    const m = found.recordset[0];
    const abs = gcStoreFile(m.filePath);
    if (!abs) {
      return res.status(404).json({ ok: false, error: '文件不存在或已被删除' });
    }

    // 读取原文件并按类型叠加水印（PDF/DOCX/PPTX/XLSX；旧 doc/ppt/xls 与其它类型不叠加）
    const raw = await fs.promises.readFile(abs);
    const ext = path.extname(m.fileName || '').toLowerCase() || path.extname(m.filePath || '').toLowerCase();
    const wmText = makeWatermarkText(user);
    let outBuf: Buffer<ArrayBufferLike> = raw;
    if (isProtectedDocExt(ext)) {
      const r = await applyWatermark(ext, raw, wmText);
      outBuf = r.data;
    }

    // 下载留痕（写入失败不阻断下载）
    try {
      await pool.request()
        .input('mid', sql.Int, materialId)
        .input('uc', sql.NVarChar, user.userCode || '')
        .input('un', sql.NVarChar, user.userName || '')
        .query(`INSERT INTO GC_DownloadLog (materialId, userCode, userName) VALUES (@mid, @uc, @un)`);
    } catch (e: any) {
      console.error('[growth-classroom] 下载留痕写入失败:', e.message);
    }

    res.setHeader('Content-Type', gcContentType(ext));
    res.setHeader('Content-Disposition', gcAttachmentDisposition(m.fileName || 'file', false));
    res.setHeader('Content-Length', outBuf.length);
    res.send(outBuf);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// 日志明细（观看 + 下载，含按用户聚合与逐条记录）
// ============================================================
router.get('/materials/:id/logs', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const materialId = parseInt(req.params.id);
    if (!materialId) return res.status(400).json({ ok: false, error: '参数不正确' });

    const watchAgg = await pool.request().input('mid', sql.Int, materialId).query(`
      SELECT userCode, userName, COUNT(*) AS watchTimes, SUM(watchSeconds) AS totalSeconds,
        MIN(createdAt) AS firstTime, MAX(createdAt) AS lastTime
      FROM GC_WatchLog WHERE materialId=@mid
      GROUP BY userCode, userName ORDER BY totalSeconds DESC
    `);
    const watchDetails = await pool.request().input('mid', sql.Int, materialId).query(`
      SELECT TOP 200 userCode, userName, watchSeconds, createdAt
      FROM GC_WatchLog WHERE materialId=@mid ORDER BY createdAt DESC
    `);
    const downloadAgg = await pool.request().input('mid', sql.Int, materialId).query(`
      SELECT userCode, userName, COUNT(*) AS downloadTimes, MIN(createdAt) AS firstTime, MAX(createdAt) AS lastTime
      FROM GC_DownloadLog WHERE materialId=@mid
      GROUP BY userCode, userName ORDER BY downloadTimes DESC
    `);
    const downloadDetails = await pool.request().input('mid', sql.Int, materialId).query(`
      SELECT TOP 200 userCode, userName, createdAt
      FROM GC_DownloadLog WHERE materialId=@mid ORDER BY createdAt DESC
    `);
    res.json({
      ok: true,
      data: {
        watchSummary: { users: watchAgg.recordset.length, totalSeconds: watchAgg.recordset.reduce((s, r) => s + (r.totalSeconds || 0), 0) },
        watchAgg: watchAgg.recordset,
        watchDetails: watchDetails.recordset,
        downloadSummary: { users: downloadAgg.recordset.length, totalCount: downloadAgg.recordset.reduce((s, r) => s + (r.downloadTimes || 0), 0) },
        downloadAgg: downloadAgg.recordset,
        downloadDetails: downloadDetails.recordset,
      },
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// 移动资料到指定子区（目标子区从已建档 GC_SubCategory 中选择；传空字符串表示移入未分区）
//   body.subCategory: 目标子区名称（空=未分区）
//   body.categoryCode: 目标子区所属大区（可选；缺省或为空时保持资料当前大区；跨大区时同时更新资料所属大区）
// ============================================================
router.post('/materials/:id/move-subcategory', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const user = (req as any).user;
    // 与上传/删除同一管理入口：未授予「上传资料」菜单权限时禁止移动
    const grantedEns = await getGrantedGCMenuEns(user);
    if (grantedEns && !grantedEns.has('gcUpload')) {
      return res.status(403).json({ ok: false, error: '您未被授予「上传资料」管理权限' });
    }
    const materialId = parseInt(req.params.id);
    if (!materialId) return res.status(400).json({ ok: false, error: '参数不正确' });
    const subCategory = ((req.body?.subCategory || '') as string).trim();
    const targetCat = ((req.body?.categoryCode || '') as string).trim();
    if (subCategory.length > 100) return res.status(400).json({ ok: false, error: '子类名称最多 100 个字符' });

    const pool = await getPool();
    const found = await pool.request().input('mid', sql.Int, materialId)
      .query(`SELECT TOP 1 id, categoryCode FROM GC_Material WHERE id=@mid`);
    if (!found.recordset.length) {
      return res.status(404).json({ ok: false, error: '资料不存在或已被删除' });
    }
    const srcCategoryCode: string = found.recordset[0].categoryCode || '';
    // 目标大区：未指定（移入未分区/不跨大区）时沿用资料当前大区
    const destCat = targetCat || srcCategoryCode;

    // 跨大区移动时校验目标大区存在
    if (targetCat && targetCat !== srcCategoryCode) {
      const catCheck = await pool.request().input('cat', sql.NVarChar, targetCat)
        .query(`SELECT TOP 1 catCode FROM GC_Category WHERE catCode=@cat`);
      if (!catCheck.recordset.length) {
        return res.status(400).json({ ok: false, error: '所选目标大区不存在' });
      }
    }

    // 目标子区未建档时自动建档（幂等；建档失败不阻断移动）
    if (subCategory) {
      try {
        const subExists = await pool.request()
          .input('cat', sql.NVarChar, destCat)
          .input('sub', sql.NVarChar, subCategory)
          .query('SELECT TOP 1 id FROM GC_SubCategory WHERE categoryCode=@cat AND subName=@sub');
        if (!subExists.recordset.length) {
          await pool.request()
            .input('cat', sql.NVarChar, destCat)
            .input('sub', sql.NVarChar, subCategory)
            .query('INSERT INTO GC_SubCategory (categoryCode, subName) VALUES (@cat, @sub)');
        }
      } catch (e: any) {
        console.error('[growth-classroom] 移动目标子区建档失败（不影响移动）:', e.message);
      }
    }

    await pool.request()
      .input('mid', sql.Int, materialId)
      .input('catc', sql.NVarChar, destCat)
      .input('subc', sql.NVarChar, subCategory || '')
      .query('UPDATE GC_Material SET categoryCode=@catc, subCategory=@subc WHERE id=@mid');

    res.json({ ok: true, message: '移动成功' });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// 删除资料（仅「上传资料」菜单入口触发）
//  1) 删除 GC_Material 记录与其关联的观看/下载日志
//  2) 删除 uploads/growth-classroom 下对应磁盘文件（文件已被手动删除时忽略）
//  删除后所有分类分区因共用同一数据源而同步消失（联动删除）
// ============================================================
router.delete('/materials/:id', async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const user = (req as any).user;
    // 已登录用户：未授予「上传资料」菜单权限时禁止删除（上传/删除为同一管理入口）
    const grantedEns = await getGrantedGCMenuEns(user);
    if (grantedEns && !grantedEns.has('gcUpload')) {
      return res.status(403).json({ ok: false, error: '您未被授予「上传资料」管理权限' });
    }
    const materialId = parseInt(req.params.id);
    if (!materialId) return res.status(400).json({ ok: false, error: '参数不正确' });
    const pool = await getPool();
    const found = await pool.request().input('mid', sql.Int, materialId)
      .query(`SELECT TOP 1 id, filePath FROM GC_Material WHERE id=@mid`);
    if (!found.recordset.length) {
      return res.status(404).json({ ok: false, error: '资料不存在或已被删除' });
    }
    const filePath: string = found.recordset[0].filePath || '';

    // 删除数据库记录 + 关联日志（同事务）
    const tx = pool.transaction();
    try {
      await tx.begin();
      await tx.request().input('mid', sql.Int, materialId)
        .query('DELETE FROM GC_WatchLog WHERE materialId=@mid');
      await tx.request().input('mid', sql.Int, materialId)
        .query('DELETE FROM GC_DownloadLog WHERE materialId=@mid');
      await tx.request().input('mid', sql.Int, materialId)
        .query('DELETE FROM GC_Material WHERE id=@mid');
      await tx.commit();
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    }

    // 删除磁盘文件：只允许删除 uploads/growth-classroom 目录内的文件（防路径穿越）
    if (filePath) {
      try {
        const fileName = path.basename(filePath);
        const storeDir = path.resolve(process.cwd(), 'uploads', 'growth-classroom');
        const absFile = path.resolve(storeDir, fileName);
        if (absFile.startsWith(storeDir + path.sep) && fs.existsSync(absFile)) {
          fs.unlinkSync(absFile);
        }
      } catch { /* 文件不存在或删除失败不阻塞（数据库已删除） */ }
    }

    res.json({ ok: true, message: '删除成功' });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;