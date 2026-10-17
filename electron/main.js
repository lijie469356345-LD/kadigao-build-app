/**
 * 卡迪高巡店系统 - Electron 桌面端主进程
 *
 * 职责：
 *  1. 内嵌启动 Express 后端（dist/server/server.js），以 CARDIGAO_BASE_DIR
 *     指向应用资源目录，保证配置/静态资源/证书路径在打包后仍正确。
 *  2. 加载前端页面（生产：http://127.0.0.1:PORT；开发：vite dev server）。
 *  3. 集成 electron-updater 自动更新：启动后自动检查更新，下载完成后
 *     提示用户重启安装，实现"发布新版本无需用户手动装包"。
 */
const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const http = require('http');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;
// 打包后：config.json 经 extraResources 作为模板随包分发（resources/config.json），
// 首次启动复制到用户数据目录；uploads/shipin/certs/updates 运行时在用户数据目录
// 动态创建，避免安装目录（如 Program Files）只读导致上传/写入失败。
// dist/server 与后端生产依赖在 app.asar 虚拟包中，由 ELECTRON_RUN_AS_NODE 子进程
// 直接加载（Electron 自带 asar 寻址）。
const BASE_DIR = isDev ? process.cwd() : app.getPath('userData');
const SERVER_PORT = 31688;

/** 打包后首次启动：准备运行时数据目录并复制 config.json 模板 */
function ensureRuntimeDirs() {
  if (isDev) return;
  const fs = require('fs');
  for (const dir of ['uploads', 'shipin', 'certs', 'updates']) {
    fs.mkdirSync(path.join(BASE_DIR, dir), { recursive: true });
  }
  const dest = path.join(BASE_DIR, 'config.json');
  if (!fs.existsSync(dest)) {
    const src = path.join(process.resourcesPath, 'config.json');
    if (fs.existsSync(src)) fs.copyFileSync(src, dest);
  }
}

// ---------------------------------------------------------------------------
// 自动更新
// ---------------------------------------------------------------------------
/**
 * 更新源地址。生产环境从环境变量 APP_UPDATE_URL 读取；未配置时使用默认地址。
 * electron-builder 构建时通过 publish.generic.url 注入默认值，可被环境变量覆盖。
 * 例：APP_UPDATE_URL=https://your-server.com/updates
 */
function getUpdateUrl() {
  if (process.env.APP_UPDATE_URL) return process.env.APP_UPDATE_URL;
  // electron-builder 会把 publish url 写入 app-update.yml（打包后自动生成并在 resources 中），
  // electron-updater 优先读取该文件；此处仅作显式兜底。
  return 'https://xdxt.henankadigao.cn/updates/win';
}

function setupAutoUpdater(win) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // 显式设置更新源：环境变量 APP_UPDATE_URL 优先，否则回退到
  // electron-builder 注入的 publish 地址（app-update.yml）。
  const updaterFeed = getUpdateUrl();
  if (updaterFeed) {
    try {
      autoUpdater.setFeedURL({ provider: 'generic', url: updaterFeed });
    } catch (e) {
      console.error('[updater] setFeedURL failed:', e && e.message);
    }
  }

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] checking for update...');
  });
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info.version);
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-status', {
        status: 'available',
        version: info.version,
      });
    }
  });
  autoUpdater.on('update-not-available', (info) => {
    console.log('[updater] update not available');
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-status', { status: 'not-available' });
    }
  });
  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err && err.message ? err.message : err);
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-status', {
        status: 'error',
        message: String((err && err.message) || err),
      });
    }
  });
  autoUpdater.on('download-progress', (progressObj) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-status', {
        status: 'downloading',
        percent: Math.round(progressObj.percent || 0),
      });
    }
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] update downloaded:', info.version);
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-status', {
        status: 'downloaded',
        version: info.version,
      });
    }
    dialog
      .showMessageBox(win, {
        type: 'info',
        title: '发现新版本',
        message: `新版本 ${info.version} 已下载完成`,
        detail: '重启应用即可完成更新，是否立即重启？',
        buttons: ['立即重启', '稍后'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall(false, true);
        }
      })
      .catch(() => {});
  });

  // 仅生产环境（打包后）启用自动更新
  if (!isDev) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('[updater] check failed:', err && err.message ? err.message : err);
      });
    }, 3000);
  }
}

// ---------------------------------------------------------------------------
// 内嵌后端启动
// ---------------------------------------------------------------------------
/**
 * 以子进程方式启动 Express 后端，避免把整个服务端耦合进主进程生命周期。
 * 使用 CARDIGAO_BASE_DIR 指向 app.asar 解包后的资源目录。
 */
function startBackend() {
  // 打包后 serverEntry 位于 app.asar 内（files: dist/**/* 已打入）。
  // 子进程以 ELECTRON_RUN_AS_NODE 模式复用 electron 二进制运行，
  // 保留 asar 寻址能力，无需解包。
  const serverEntry = isDev
    ? path.join(BASE_DIR, 'dist', 'server', 'server.js')
    : path.join(process.resourcesPath, 'app.asar', 'dist', 'server', 'server.js');
  const child = spawn(process.execPath, [serverEntry], {
    cwd: BASE_DIR,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      CARDIGAO_BASE_DIR: BASE_DIR,
      PORT: String(SERVER_PORT),
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[server:err] ${d}`));
  child.on('exit', (code, signal) => {
    console.log(`[server] backend exited code=${code} signal=${signal}`);
  });
  return child;
}

/** 轮询等待后端就绪 */
function waitForBackend(url, timeoutMs, cb) {
  const start = Date.now();
  const tryOnce = () => {
    const req = http.get(url, (res) => {
      res.resume();
      cb(true);
    });
    req.on('error', () => {
      if (Date.now() - start > timeoutMs) return cb(false);
      setTimeout(tryOnce, 500);
    });
    req.setTimeout(2000, () => req.destroy());
  };
  tryOnce();
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: '卡迪高巡店系统',
    icon: path.join(__dirname, '../build/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.VITE_DEV_URL || 'http://localhost:5173';
  const prodUrl = `http://127.0.0.1:${SERVER_PORT}`;

  if (isDev) {
    win.loadURL(devUrl);
  } else {
    win.loadURL(prodUrl);
  }
  return win;
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------
let backend = null;
app.whenReady().then(() => {
  ensureRuntimeDirs();
  if (!isDev) {
    backend = startBackend();
    waitForBackend(`http://127.0.0.1:${SERVER_PORT}`, 30000, (ok) => {
      const win = createWindow();
      if (ok) {
        setupAutoUpdater(win);
      } else {
        dialog.showErrorBox(
          '服务启动失败',
          `后端服务在 ${SERVER_PORT} 端口未能启动，请检查安装目录完整性后重试。`
        );
        app.quit();
      }
    });
  } else {
    const win = createWindow();
    setupAutoUpdater(win);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (backend) {
    backend.kill();
    backend = null;
  }
});