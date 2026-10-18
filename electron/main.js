/**
 * 卡迪高运营管理系统 - Electron 桌面端主进程（纯壳版）
 *
 * 职责：
 *  1. 纯壳模式：不再内嵌 Express 后端与本地静态资源，
 *     窗口直接加载公网页面 https://xdxt.henankadigao.cn/（与安卓 WebView 一致）。
 *     前端每轮修改只需构建并发布到公网，已安装客户端下次打开即加载新版页面。
 *  2. 集成 electron-updater 自动更新：启动后自动检查更新，下载完成后
 *     提示用户重启安装，实现"发布新版本无需用户手动装包"。
 *  3. 通过 preload 暴露桌面端标识与版本信息，供登录前强制版本检查
 *     与"退出后永远回登录页"策略使用。
 */
const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const https = require('https');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;
/** 生产环境公网入口（纯壳模式统一指向公网，与安卓 WebView 一致） */
const PROD_URL = 'https://xdxt.henankadigao.cn/';

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

/** 语义化版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0 */
function compareVersions(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * 快速拉取公网 latest.yml 中的 version 字段（仅几 KB，秒级返回）。
 * 用于「预检查」：不等 electron-updater 完整检查（含差分计算，可能要十几秒），
 * 先让用户第一时间看到"发现新版本"弹窗，后台再走正式下载。
 */
function fetchLatestYamlVersion(feedUrl) {
  return new Promise((resolve) => {
    let req;
    const request = (url) => {
      req = https.get(url, {
        headers: { 'User-Agent': 'cardigao-updater', Accept: '*/*' },
        timeout: 8000,
      }, (res) => {
        // 跟随重定向（最多 3 跳）
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(fetchLatestYamlVersion(res.headers.location));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 65536) req.destroy();
        });
        res.on('end', () => {
          const m = body.match(/^version:\s*([^\s]+)/m);
          resolve(m ? m[1].trim() : null);
        });
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => resolve(null));
    };
    request(feedUrl);
  });
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

  // 周期轮询状态：启动即刻首查（预检查），此后每 30 分钟复查一次，
  // 保证客户端长期运行（用户一直不重启/不登录）也能及时发现新版本。
  const CHECK_INTERVAL_MS = 30 * 60 * 1000;
  let checkTimer = null;
  let checking = false;             // 防重入：同一时刻只发起一次检查
  let lastNotifiedVersion = null;   // 弹窗节流：同一版本只弹一次"发现新版本"
  let downloadedVersion = null;     // 新版本已下载完成：停止轮询，等用户重启安装

  const scheduleNextCheck = () => {
    if (checkTimer) clearTimeout(checkTimer);
    if (downloadedVersion) return; // 已下载待重启，不再轮询
    checkTimer = setTimeout(() => {
      doCheckForUpdates();
    }, CHECK_INTERVAL_MS);
  };

  const doCheckForUpdates = () => {
    if (checking) return;
    checking = true;
    autoUpdater
      .checkForUpdates()
      .catch((err) => {
        console.error('[updater] check failed:', err && err.message ? err.message : err);
        // 检查失败（网络抖动等）也继续轮询，避免一次失败后永久失去检查能力
        scheduleNextCheck();
      })
      .finally(() => {
        checking = false;
      });
  };

  /** 弹一次"发现新版本"（IPC 浮层 + 原生弹窗），同一版本只弹一次 */
  const notifyUpdateAvailable = (version) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-status', { status: 'available', version });
    }
    dialog
      .showMessageBox(win, {
        type: 'info',
        title: '发现新版本',
        message: `发现新版本 ${version}`,
        detail: '更新包正在后台自动下载，下载完成后会提示您重启安装。' +
          (compareVersions(app.getVersion(), version) < 0
            ? '\n\n提示：发布新版本后，旧版本客户端将不能登录，请及时完成更新。'
            : ''),
        buttons: ['知道了'],
        defaultId: 0,
        noLink: true,
      })
      .catch(() => {});
  };

  /**
   * 预检查：启动后立即用 HTTPS 直接拉 latest.yml（几 KB），
   * 有新版本就立刻弹窗通知（通常 1~3 秒内），随后再让
   * electron-updater 走正式检查与后台下载（差分/全量）。
   */
  const preCheckAndNotify = async () => {
    if (isDev || !updaterFeed) return;
    try {
      const remote = await fetchLatestYamlVersion(updaterFeed + '/latest.yml');
      if (!remote) {
        scheduleNextCheck();
        return;
      }
      const current = app.getVersion();
      if (compareVersions(remote, current) > 0) {
        if (lastNotifiedVersion !== remote) {
          lastNotifiedVersion = remote;
          console.log('[updater] pre-check found new version:', remote, 'current:', current);
          notifyUpdateAvailable(remote);
        }
        // 触发正式检查：update-available 因 lastNotifiedVersion 节流不会重复弹窗，
        // 但 autoDownload 会继续在后台下载新版本。
        doCheckForUpdates();
      } else {
        scheduleNextCheck();
      }
    } catch (e) {
      console.error('[updater] pre-check failed:', e && e.message ? e.message : e);
      scheduleNextCheck();
    }
  };

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] checking for update...');
  });
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info.version);
    // 兜底：预检查未命中（latest.yml 拉取失败）时仍由 electron-updater 弹窗
    if (lastNotifiedVersion !== info.version) {
      lastNotifiedVersion = info.version;
      notifyUpdateAvailable(info.version);
    }
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[updater] update not available');
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-status', { status: 'not-available' });
    }
    // 本轮无更新，30 分钟后再复查（长驻客户端也能发现后续发布的新版本）
    scheduleNextCheck();
  });
  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err && err.message ? err.message : err);
    try { if (win && !win.isDestroyed()) win.setProgressBar(-1); } catch (e) {}
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-status', {
        status: 'error',
        message: String((err && err.message) || err),
      });
    }
  });
  autoUpdater.on('download-progress', (progressObj) => {
    const pct = Math.round(progressObj.percent || 0);
    if (win && !win.isDestroyed()) {
      // Windows 任务栏图标实时显示下载进度
      try { win.setProgressBar(pct / 100); } catch (e) { /* 非 Windows 或 unsupported 忽略 */ }
      win.webContents.send('update-status', {
        status: 'downloading',
        percent: pct,
      });
    }
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] update downloaded:', info.version);
    downloadedVersion = info.version;
    if (checkTimer) clearTimeout(checkTimer);
    try { if (win && !win.isDestroyed()) win.setProgressBar(-1); } catch (e) {}
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

  // 仅生产环境（打包后）立即执行预检查——启动即查
  if (!isDev) {
    preCheckAndNotify();
  }
}

// 渲染进程读取桌面端版本信息（登录前强制版本检查用）
ipcMain.handle('get-app-info', () => ({ version: app.getVersion() }));

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: '卡迪高运营管理系统',
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

  const url = isDev
    ? process.env.VITE_DEV_URL || 'http://localhost:5173'
    : PROD_URL;
  win.loadURL(url);
  return win;
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  const win = createWindow();
  setupAutoUpdater(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createWindow();
      setupAutoUpdater(w);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});