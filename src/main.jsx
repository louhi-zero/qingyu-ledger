import React from 'react'
import ReactDOM from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import App from './App.jsx'
import './styles.css'

// v3.3 启动兜底：bundle 执行期同步报错时，把原因交给 index.html 的失败页显示，
// 避免「JS 报错 → 启动页无人接管 → 永久卡在启动页」。
try {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
} catch (e) {
  if (typeof window !== 'undefined' && window.__qyBootFail) {
    window.__qyBootFail('应用初始化失败：' + (e && e.message ? e.message : e))
  }
  throw e
}

// 生产环境注册 Service Worker，支持离线打开。
//
// v3.3 关键修复：原生端（Capacitor）不再注册 SW。
// 原因：APK 的页面本就来自包内本地资源，离线能力由包体自身保证，SW 在此纯属多余；
// 而 https://localhost 上的 SW 会跨 APK 版本存活、缓存入口页 index.html，
// 一旦导航回落到「引用旧 assets hash 的旧入口页」就会 404 → React 永不挂载 → 打开 App 卡启动页。
// 另外 file:// 桌面端同样不注册。
const canUseSW = import.meta.env.PROD
  && !Capacitor.isNativePlatform()
  && location.protocol.startsWith('http')
  && 'serviceWorker' in navigator
if (canUseSW) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
