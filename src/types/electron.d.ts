/**
 * Electron preload 暴露到渲染进程的 appUpdater / appInfo API 类型声明。
 * 主进程（electron/main.js）通过 webContents.send('update-status', payload) 推送更新状态；
 * preload（electron/preload.js）以 window.appUpdater.onUpdateStatus(cb) 暴露订阅接口，
 * 以 window.appInfo 暴露桌面端标识与版本信息。
 */
interface UpdateStatusPayload {
  status: 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
}

interface AppInfo {
  /** 是否为桌面客户端（网页版浏览器访问时无此对象） */
  isDesktop: boolean
  /** 当前客户端版本（异步获取 app.getVersion()） */
  getVersion: () => Promise<string>
}

interface Window {
  appUpdater?: {
    onUpdateStatus: (callback: (payload: UpdateStatusPayload) => void) => () => void
  }
  appInfo?: AppInfo
}