import { useEffect, useState } from 'react'
import { Download, RefreshCw, X, AlertTriangle } from 'lucide-react'

/**
 * 自动更新状态浮层：监听主进程推送的 update-status IPC，
 * 展示"发现新版本 / 下载中 x% / 已完成重启 / 失败"轻量提示。
 * 挂在 App 顶层，登录页与所有业务页面均可见。
 */
export default function UpdateStatusBanner() {
  const [payload, setPayload] = useState<UpdateStatusPayload | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!window.appUpdater?.onUpdateStatus) return
    const off = window.appUpdater.onUpdateStatus((p) => {
      setPayload(p)
      setDismissed(false)
    })
    return off
  }, [])

  if (!payload || dismissed) return null

  const { status, version, percent, message } = payload

  // 无更新/未检查成功不展示
  if (status === 'not-available') return null

  const isDownloading = status === 'downloading'
  const isAvailable = status === 'available'
  const isDone = status === 'downloaded'
  const isError = status === 'error'

  const title = isDone
    ? `新版本 ${version || ''} 已下载完成`
    : isError
      ? '更新检查失败'
      : isAvailable
        ? `发现新版本 ${version || ''}`
        : `正在下载更新${version ? ' ' + version : ''}`
  const detail = isDone
    ? '请重启应用以完成更新。'
    : isError
      ? message || '网络不可用或更新源暂时无法访问，稍后将自动重试。'
      : isAvailable
        ? '更新包正在后台自动下载，不影响当前使用。'
        : '下载完成后将提示您重启应用。'

  const pct = Math.min(100, Math.max(0, Math.round(percent || 0)))

  return (
    <div className="fixed bottom-4 right-4 z-[9999] w-80 rounded-xl border border-gray-200 bg-white shadow-lg">
      <div className="flex items-start gap-3 p-4">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isError ? 'bg-red-50 text-red-500' : 'bg-primary/10 text-primary'}`}>
          {isError ? <AlertTriangle className="h-5 w-5" /> : isDone ? <RefreshCw className="h-5 w-5" /> : <Download className="h-5 w-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="mt-0.5 text-xs text-gray-500">{detail}</p>
          {isDownloading && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
          )}
          {isDownloading && <p className="mt-1 text-right text-xs font-medium text-primary">{pct}%</p>}
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}