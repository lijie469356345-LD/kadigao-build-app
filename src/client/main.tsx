import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App'
import { useAuthStore } from '../store/authStore'
import '../index.css'

// 桌面客户端"永远从登录页开始"策略：
// 关闭应用后，持久化的登录态（localStorage user/token）在下次启动时清空，
// 重新打开客户端必然回到登录页，不会因为上次登录过而直接进入门户页。
// 仅对 Electron 桌面端生效（window.appInfo 由 preload 注入）；网页版浏览器访问时
// 保持原有的记住登录行为，不受影响。
//
// 实现说明：用 sessionStorage 标记"本次应用会话"是否已执行过一次清理。
// sessionStorage 在同一标签页刷新时保留、关闭应用后清空，因此：
//   - 登录成功后 window.location.href='/' 整页刷新 → 标记仍在 → 不会二次清空登录态，
//     登录态得以保留并正常进入门户页（修复 1.1.4 登录成功又回弹登录页的 Bug）
//   - 关闭应用重新打开 → 新会话标记为空 → 执行一次清空，保证每次启动都在登录页
if ((window as any).appInfo?.isDesktop && !sessionStorage.getItem('__desktop_session_init__')) {
  sessionStorage.setItem('__desktop_session_init__', '1')
  useAuthStore.getState().logout()
}

// 安卓 WebView 壳"永远从登录页开始"策略：
// 访问页面的 UA 由壳注入 "CardigaoApp/x.y.z"（见 MainActivity）——
// 与桌面端同理：会话内刷新标记保留不清登录态；关闭 App 重新打开（冷启动，
// 壳已清空 WebStorage）标记为空 → 清一次登录态，保证每次打开都在登录页。
// 网页版浏览器 UA 无 CardigaoApp 标记，保持记住登录行为，不受影响。
const uaStr = navigator.userAgent || '';
if (uaStr.includes('CardigaoApp/') && !sessionStorage.getItem('__mobile_session_init__')) {
  sessionStorage.setItem('__mobile_session_init__', '1')
  useAuthStore.getState().logout()
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)