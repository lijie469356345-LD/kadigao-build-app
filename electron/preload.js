/**
 * 卡迪高运营管理系统 - Electron preload
 * 在 contextIsolation 下安全地暴露少量能力给渲染进程：
 *  - 监听主进程推送的自动更新状态（appUpdater）
 *  - 暴露桌面端标识与版本信息（appInfo），供登录前强制版本检查
 *    与"退出后永远回登录页"策略识别桌面环境使用
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appUpdater', {
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
});

contextBridge.exposeInMainWorld('appInfo', {
  // 桌面客户端标识：网页版（浏览器直接访问）无此对象
  isDesktop: true,
  // 当前客户端版本（异步从主进程读取 app.getVersion()）
  getVersion: () => ipcRenderer.invoke('get-app-info').then((r) => (r && r.version) || ''),
});