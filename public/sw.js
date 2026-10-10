/* 轻语记账 Service Worker：离线可用
   策略：导航请求 network-first（回退缓存的 index.html）；
        静态资源 stale-while-revalidate。

   v3.3 修复：VERSION 不再硬编码。构建时由 vite.config.js 的 swVersion 插件把
   __QY_SW_VERSION__ 替换为本次构建的标识（时间戳 + 产物哈希），
   保证「每次发版必换缓存桶」——旧版本缓存会在 activate 时被清掉，
   不会出现「升级后仍命中旧入口页 → 引用已不存在的旧 assets → 卡启动页」。
   注意：原生端（Capacitor）已不再注册本 SW（见 src/main.jsx），此处只服务纯 Web 部署。 */
const VERSION = 'qingyu-__QY_SW_VERSION__'
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // 页面导航：网络优先，失败时用缓存的入口页
  if (req.mode === 'navigate') {
    const isHtml = (res) => !!res && res.ok
      && (res.headers.get('content-type') || '').includes('text/html')
    event.respondWith(
      fetch(req)
        .then((res) => {
          // 只缓存 HTML 入口，避免直接打开 JSON 等非页面资源时污染离线回退
          if (isHtml(res)) {
            const copy = res.clone()
            caches.open(VERSION).then((c) => c.put('/index.html', copy))
          }
          return res
        })
        .catch(() => caches.match('/index.html')
          .then((r) => (isHtml(r) ? r : caches.match('/')))
          .then((r) => r || caches.match('/')))
    )
    return
  }

  // 静态资源：stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone()
            caches.open(VERSION).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => cached)
      return cached || network
    })
  )
})
