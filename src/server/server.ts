import express, { Request, Response } from 'express';
import path from 'path';
import cors from 'cors';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { connectDB, getPool } from '../config/db';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import permissionRoutes from './routes/permissions';
import reportRoutes from './routes/reports';
import logRoutes from './routes/logs';
import databaseConfigRoutes from './routes/databaseConfig';
import shopArchiveRoutes from './routes/shopArchive';
import maintenanceRoutes from './routes/maintenance';
import taskRoutes from './routes/tasks';
import scoreRoutes from './routes/scores';
import wechatPushRoutes from './routes/wechatPush';
import wechatPushV2Routes from './routes/wechatPushV2';
import feedbackRoutes from './routes/feedback';
import mergeRoutes from './routes/merge';
import onlineMergeRoutes from './routes/onlineMerge';
import monthlyTargetRoutes from './routes/monthlyTarget';
import dataExtractionRoutes from './routes/dataExtraction';
import productImageRoutes from './routes/productImage';
import directSalesSummaryRoutes from './routes/directSalesSummary';
import financeFieldRoutes from './routes/financeField';
import annualOperationDashboardRoutes from './routes/annualOperationDashboard';
import financialRevenueProfitRoutes from './routes/financialRevenueProfit';
import financialNoCostPriceRoutes from './routes/financialNoCostPrice';
import { startPollingService } from './services/wechatPushPoller';
import { startQueueService } from './services/push/PushQueueService';
import { startTriggerScheduler } from './services/push/TriggerScheduler';
import { registerAllPortalEntries } from './services/portalRegistry';
import { runAllMigrations } from './services/tableMigration';
import { ensureStandardPermissionTables } from './services/permissionSchema';
import { ensureOnboardingTables } from './services/onboardingSchema';
import { calculateDailyScores } from './routes/scores';
import dailyShopTargetsRoutes from './routes/dailyShopTargets';
import dailyProductTargetsRoutes from './routes/dailyProductTargets';
import staffMonthlyTargetRoutes from './routes/staffMonthlyTarget';
import coachingStoresRoutes from './routes/coachingStores';
import tableManagerRoutes from './routes/tableManager';
import douyinRoutes from './routes/douyin';
import xixieRoutes from './routes/xixie';
import warehouseRoutes from './routes/warehouse';
import replenishRoutes from './routes/replenish';
import storeScoreRecordsRoutes from './routes/storeScoreRecords';
import storeRectificationsRoutes from './routes/storeRectifications';
import storeCheckRoutes from './routes/storeCheck';
import suggestionsRoutes from './routes/suggestions';
import reimbursementRoutes from './routes/reimbursement';
import adminPermRoutes from './routes/adminPerm';
import pkRoutes from './routes/pk';
import registerRoutes from './routes/register';
import positionsRoutes from './routes/positions';
import assetManagementRoutes from './routes/assetManagement';
import growthClassroomRoutes from './routes/growthClassroom';
import shoeFeedbackRoutes, { startVoidScheduler } from './routes/shoeFeedback';
import hourlyPerformanceRoutes, { startHourlyPerformanceScheduler } from './routes/hourlyPerformance';
import onboardingRoutes, { startOnboardingScheduler } from './routes/onboarding';

// ============================================================
// 进程级错误保护：任何未捕获的异常都不会导致服务器崩溃
// ============================================================
process.on('uncaughtException', (err) => {
  console.error('🚨 未捕获的异常:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason: any) => {
  console.error('🚨 未处理的 Promise 拒绝:', reason?.message || reason);
});

// 统一配置加载：优先 CARDIGAO_BASE_DIR → cwd → __dirname 回退
function resolveConfigPath(): string {
  const cands: string[] = [];
  if (process.env.CARDIGAO_BASE_DIR) cands.push(path.join(process.env.CARDIGAO_BASE_DIR, 'config.json'));
  cands.push(
    path.join(process.cwd(), 'config.json'),
    path.join(__dirname, '../../config.json'),
  );
  for (const c of cands) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return cands[cands.length - 1];
}
const configPath = resolveConfigPath();
let config: any = {};
try {
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, ''));
    console.log('[Server] 配置来源:', configPath);
  }
} catch (e: any) { console.log('[Server] 使用默认配置'); }

const app = express();
const HOST = process.env.HOST || config.server.host || '0.0.0.0';
const PORT = parseInt(process.env.PORT || config.server.port || '3000');
const CLIENT_URL = config.client?.apiBaseUrl || config.client?.apiBase || 'http://localhost:3000';

app.use(cors({
  origin: [
    'http://localhost:5173', 
    'http://localhost:5174', 
    'http://localhost:3000',
    CLIENT_URL.replace(':3000', ':5173'),
    CLIENT_URL,
    'http://xdxt.henankadigao.cn',
    'https://xdxt.henankadigao.cn'
  ],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.text({ type: 'text/xml' }));
app.use(express.text({ type: 'application/xml' }));

// ============================================================
// API 鉴权网关（JWT 全局鉴权中间件）
//  - 解析 Authorization: Bearer {token}，将身份写入 req.user
//  - 强制覆盖 query/body 中的 groupName/isAdmin（防前端改参数越权）
//  - 白名单：登录、企微回调验签/接收
//  - config.json auth.enforce=true 时未登录访问非白名单接口一律 401（默认 false 平滑过渡）
// ============================================================
import { authMiddleware, optionalAuthMiddleware } from './middlewares/authMiddleware';
import { readAuthConfig } from './services/appConfig';

const PUBLIC_API_PREFIXES = [
  '/auth/login',            // 登录
  '/wechat-push/callback',  // 企微回调（GET 验签 + POST 接收）
  '/wechat-push/public-ip', // 公网 IP 探测（配置页联调）
  '/wechat-push-v2/public-ip',
  '/register/options',      // 注册页下拉数据源（未登录可访问）
  '/register/apply',        // 注册申请提交（未登录可访问）
  '/register/check-phone',  // 手机号注册状态检查（未登录可访问）
  '/onboarding/options',    // 入职录入页下拉数据（未登录可访问）
  '/onboarding/apply',      // 入职申请提交（未登录可访问）
];

function isPublicApiPath(p: string): boolean {
  return PUBLIC_API_PREFIXES.some(prefix => p.startsWith(prefix));
}

app.use('/api', (req, res, next) => {
  const enforce = readAuthConfig().enforce === true;
  if (enforce && !isPublicApiPath(req.path)) {
    return authMiddleware(req, res, next);
  }
  return optionalAuthMiddleware(req, res, next);
});
app.use(express.static(path.join(__dirname, '../client'), {
  setHeaders: (res, filePath) => {
    // index.html 不缓存：确保每次加载到最新 JS 资源，避免旧版页面/旧数据残留
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
      // 带内容哈希的静态资源可长期缓存
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

// ============================================================
// 视频/大文件下载服务：/shipin 文件夹对外提供 HTTP 访问
// 用户把视频放入 G:\AIgongzuobao\卡迪高巡店系统\shipin 后，
// 即可通过 https://xdxt.henankadigao.cn/shipin/文件名 访问
// ============================================================
const videBase = process.env.CARDIGAO_BASE_DIR
  ? path.join(process.env.CARDIGAO_BASE_DIR, 'shipin')
  : path.join(process.cwd(), 'shipin');

// 视频列表 API：按文件名自然顺序返回（保证播放顺序）
app.get('/api/shipin/list', (_req, res) => {
  try {
    if (!fs.existsSync(videBase)) { res.json({ ok: true, files: [] }); return; }
    const files = fs.readdirSync(videBase)
      .filter(f => /\.(mp4|mov|avi|mkv|webm|m4v)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })) // 数字序，保证分段不乱
      .map((f, i) => ({
        index: i + 1,
        name: f,
        sizeMB: (fs.statSync(path.join(videBase, f)).size / 1024 / 1024).toFixed(1),
        url: `/shipin/${encodeURIComponent(f)}`,
      }));
    res.json({ ok: true, total: files.length, files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/shipin', express.static(videBase, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.mp4')) res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');
  },
  maxAge: '1d',
}));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/config', databaseConfigRoutes);
app.use('/api/shops', shopArchiveRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/scores', scoreRoutes);
app.use('/api/wechat-push', wechatPushRoutes);
app.use('/api/wechat-push-v2', wechatPushV2Routes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/merge', mergeRoutes);
app.use('/api/online-merge', onlineMergeRoutes);
app.use('/api/monthly-target', monthlyTargetRoutes);
app.use('/api/staff-monthly-target', staffMonthlyTargetRoutes);
app.use('/api/coaching-stores', coachingStoresRoutes);
app.use('/api/data-extraction', dataExtractionRoutes);
app.use('/api/daily-shop-targets', dailyShopTargetsRoutes);
app.use('/api/daily-product-targets', dailyProductTargetsRoutes);
app.use('/api/direct-sales-summary', directSalesSummaryRoutes);
app.use('/api/finance-field', financeFieldRoutes);
app.use('/api/annual-operation-dashboard', annualOperationDashboardRoutes);
app.use('/api/financial-revenue-profit', financialRevenueProfitRoutes);
app.use('/api/financial-no-cost-price-product', financialNoCostPriceRoutes);
app.use('/api/product-image', productImageRoutes);
app.use('/api/table-manager', tableManagerRoutes);
app.use('/api/douyin', douyinRoutes);
app.use('/api/xixie', xixieRoutes);
app.use('/api/warehouse', warehouseRoutes);
app.use('/api/replenish', replenishRoutes);
app.use('/api/store-score-records', storeScoreRecordsRoutes);
app.use('/api/store-rectifications', storeRectificationsRoutes);
app.use('/api/store-check', storeCheckRoutes);
app.use('/api/suggestions', suggestionsRoutes);
app.use('/api/reimbursement', reimbursementRoutes);
app.use('/api/admin-perm', adminPermRoutes);
app.use('/api/pk', pkRoutes);
app.use('/api/register', registerRoutes);
app.use('/api/positions', positionsRoutes);
app.use('/api/asset-management', assetManagementRoutes);
app.use('/api/growth-classroom', growthClassroomRoutes);
app.use('/api/shoe-feedback', shoeFeedbackRoutes);
app.use('/api/hourly-performance', hourlyPerformanceRoutes);
app.use('/api/onboarding', onboardingRoutes);

// ============================================================
// 企业微信可信域名验证：响应 /WW_verify_xxxx.txt
// 企业微信验证时直接 GET 该路径（默认走 80 端口），文件内容即校验码本身。
// 优先读取 exe 同级 public/ 下的文件（用户可覆盖），其次读取打包内置的 public/，
// 都没有时回退为直接返回校验码（企业微信标准格式）。
// ============================================================
const staticBaseDir = process.env.CARDIGAO_BASE_DIR || path.dirname(process.execPath);
const verifyCandidateDirs = [
  path.join(staticBaseDir, 'public'),
  path.join(process.cwd(), 'public'),
];
app.get('/WW_verify_:code.txt', (req, res) => {
  const code = req.params.code;
  for (const d of verifyCandidateDirs) {
    const f = path.join(d, `WW_verify_${code}.txt`);
    if (fs.existsSync(f)) {
      return res.type('text/plain; charset=utf-8').send(fs.readFileSync(f, 'utf-8'));
    }
  }
  // 企业微信验证文件标准内容即校验码本身
  return res.type('text/plain; charset=utf-8').send(code);
});

// ============================================================
// 成长课堂受保护文档防绕过守卫：
//   文档/PPT/PDF/Excel 四类已启用"下载水印 + 下载留痕"，必须经
//   /api/growth-classroom/materials/:id/{download,file} 访问；对
//   /uploads 下的静态直出一律 403，避免绕过留痕与水印。
//   视频/图片/TXT 等其它类型保持静态直出（在线观看/预览不受影响）。
// ============================================================
const PROTECTED_UPLOAD_EXTS = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'];
app.use('/uploads', (req, res, next) => {
  try {
    const p = decodeURIComponent(req.path || '');
    if (p.startsWith('/growth-classroom/')) {
      const ext = path.extname(p).toLowerCase();
      if (PROTECTED_UPLOAD_EXTS.includes(ext)) {
        return res.status(403).json({ ok: false, error: '该文件已启用下载水印与留痕保护，请通过系统「下载 / 在线预览」访问' });
      }
    }
  } catch { /* 解码失败按普通静态处理 */ }
  next();
}, express.static(path.join(process.cwd(), 'uploads')));

// ============================================================
// App 自动更新发布源：/updates 目录（默认 CARDIGAO_BASE_DIR/updates，
// 回退 cwd/updates）承载 electron-builder 产出的 latest.yml 与安装包。
// 桌面客户端 electron-updater 通过 HTTP 拉取该目录做版本检查与增量下载。
// 发布流程：构建产物（latest.yml + *.exe/*.dmg + *.blockmap 等）复制到
// 更新服务器 updates/ 目录，或本服务所在服务器 updates/ 目录即可。
// ============================================================
const updatesBaseDir = path.join(process.env.CARDIGAO_BASE_DIR || process.cwd(), 'updates');
app.use('/updates', express.static(updatesBaseDir, {
  setHeaders: (res, filePath) => {
    // 元数据与签名文件不强缓存，保证版本检查即时生效
    if (/\.(yml|yaml|json|blockmap)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client', 'index.html'));
});
app.use((err: any, _req: Request, res: Response, next: any) => {
  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: '上传图片/文件不能超过 150KB，请压缩后重试' });
    }
    return res.status(400).json({ message: '文件上传失败: ' + (err.message || '') });
  }
  console.error('[Server] 未处理异常:', err?.stack || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ message: '服务器内部错误，请稍后重试' });
});

const startServer = async () => {
  try {
    await connectDB();
    console.log('数据库连接成功');
    // 表迁移 + 自动建表 + 门户注册
    await runAllMigrations();
    await registerAllPortalEntries();
    // 标准权限表（sys_org/sys_role/sys_role_menu/sys_user_role）幂等建表+种子
    await ensureStandardPermissionTables();
    // 入职管理数据表（onboarding_record 等 6 张）
    await ensureOnboardingTables();
  } catch (error) {
    console.error('数据库连接失败:', error);
    console.log('服务器将使用Mock数据运行');
  }
  
  // 启动企微推送轮询兜底服务
  try {
    await startPollingService();
  } catch (err) {
    console.error('启动企微推送轮询服务失败:', err);
  }

  // 启动推送队列消费服务
  try {
    startQueueService();
  } catch (err) {
    console.error('启动推送队列服务失败:', err);
  }

  // 启动触发器调度服务（含时段业绩播报定时推送）
  try {
    startTriggerScheduler();
  } catch (err) {
    console.error('启动触发器调度服务失败:', err);
  }

  // 启动洗鞋反馈自动作废调度
  try {
    startVoidScheduler();
  } catch (err) {
    console.error('启动洗鞋反馈作废调度失败:', err);
  }

  // 时段业绩定时推送已迁移至 TriggerScheduler 统一调度（由 WechatPushTemplateV2 模板驱动）
  // startHourlyPerformanceScheduler();

  // 入职管理时效管控（第3天预警 / 第7天超时台账 / 15天考核到期提醒）
  try {
    startOnboardingScheduler();
  } catch (err) {
    console.error('启动入职时效管控调度失败:', err);
  }

  app.listen(PORT, HOST, () => {
    console.log(`HTTP Server running on http://${HOST}:${PORT}`);
  });

  // HTTPS 服务：用于企业微信回调（需要 SSL 证书）
  const sslDir = path.join(process.env.CARDIGAO_BASE_DIR || process.cwd(), 'certs');
  const sslCertPath = process.env.SSL_CERT_PATH || path.join(sslDir, 'xdxt.henankadigao.cn-chain.pem');
  const sslKeyPath = process.env.SSL_KEY_PATH || path.join(sslDir, 'xdxt.henankadigao.cn-key.pem');

  if (fs.existsSync(sslCertPath) && fs.existsSync(sslKeyPath)) {
    try {
      const httpsServer = https.createServer(
        {
          cert: fs.readFileSync(sslCertPath),
          key: fs.readFileSync(sslKeyPath),
        },
        app
      );
      const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || '443');
      httpsServer.listen(HTTPS_PORT, HOST, () => {
        console.log(`HTTPS Server running on https://${HOST}:${HTTPS_PORT}`);
      });
      httpsServer.on('error', (e: any) => {
        console.log(`⚠️ HTTPS ${HTTPS_PORT} 监听失败: ${e.message}`);
      });
    } catch (e: any) {
      console.log(`⚠️ HTTPS 启动失败: ${e?.message}`);
    }
  } else {
    console.log(`⚠️ SSL 证书未找到 (${sslCertPath})，HTTPS 未启动`);
  }

  // 企业微信可信域名验证需通过 80 端口访问（http://域名/WW_verify_xxx.txt），
  // 这里额外监听 80 端口复用同一套路由。若 80 被占用或无权限（未以管理员运行），
  // 则静默跳过——此时可用反向代理把 80 转发到 ${PORT}，或右键 exe 选择"以管理员身份运行"。
  try {
    const verifyServer = app.listen(80, '0.0.0.0', () => {
      console.log('企业微信验证服务已启动: http://0.0.0.0:80');
    });
    verifyServer.on('error', (e: any) => {
      console.log(`⚠️ 80 端口监听失败（可用反向代理 80→${PORT}，或右键 exe 以管理员身份运行）: ${e.message}`);
    });
  } catch (e: any) {
    console.log(`⚠️ 80 端口监听跳过: ${e?.message}`);
  }

  // 数据库心跳保活，每 4 分钟 ping 一次，防止连接池 5 分钟闲置超时
  setInterval(async () => {
    try {
      const p = await getPool();
      await p.request().query('SELECT 1');
    } catch {
      // 心跳失败静默忽略，下次请求会自动重连
    }
  }, 4 * 60 * 1000);
};

startServer();
