/**
 * 卡迪高巡店系统 - Electron preload
 * 在 contextIsolation 下安全地暴露少量能力给渲染进程：
 *  - 监听主进程推送的自动更新状态
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appUpdater', {
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
});