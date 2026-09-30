/* 轻语记账 Electron 主进程
 * - 生产：加载 dist/index.html（file://，hash 导航 + 相对路径）
 * - 开发：由 scripts/electron-dev.cjs 注入 VITE_DEV_SERVER_URL
 * - 渲染进程的 WebDAV 请求经 qy-webdav IPC 在此发出，绕过浏览器 CORS 限制
 */
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 880,
    minWidth: 380,
    minHeight: 600,
    title: '轻语记账',
    backgroundColor: '#f4f6fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

// 渲染进程 WebDAV 桥：返回与 fetch Response 对齐的精简结果
ipcMain.handle('qy-webdav', async (_event, payload = {}) => {
  const { method = 'GET', url, headers = {}, body = null, binary = false } = payload
  if (!/^https?:\/\//.test(url || '')) {
    throw new Error('仅允许 http/https WebDAV 地址')
  }
  const res = await fetch(url, { method, headers, body: body || undefined })
  if (method === 'HEAD') {
    return { status: res.status, ok: res.ok, etag: res.headers.get('etag'), contentType: res.headers.get('content-type'), text: '', data: null }
  }
  if (binary) {
    // ArrayBuffer 经 IPC 结构化克隆直传，供头像/壁纸等资产使用
    const data = await res.arrayBuffer()
    return {
      status: res.status, ok: res.ok,
      etag: res.headers.get('etag'),
      contentType: res.headers.get('content-type'),
      text: '', data,
    }
  }
  const text = await res.text()
  return {
    status: res.status,
    ok: res.ok,
    etag: res.headers.get('etag'),
    contentType: res.headers.get('content-type'),
    text,
    data: null,
  }
})

// 渲染进程通用 HTTPS 桥：供智谱 AI 等第三方 API 使用（仅放行 https，绕过 CORS）
// 流式响应：fetch 拿到 reader 后，经 qy-http-chunk 事件按 SSE 文本块推给渲染进程
ipcMain.handle('qy-http-stream', async (event, payload = {}) => {
  const { rid, url, method = 'POST', headers = {}, body = null } = payload
  if (!/^https:\/\//.test(url || '')) {
    throw new Error('qy-http 仅允许 https 地址')
  }
  const send = (obj) => {
    if (!event.sender.isDestroyed()) event.sender.send('qy-http-chunk', { rid, ...obj })
  }

  let res
  try {
    res = await fetch(url, { method, headers, body: body || undefined })
  } catch (e) {
    send({ error: String(e && e.message || e), done: true })
    return { rid, status: 0, ok: false }
  }
  send({ status: res.status })
  // 错误响应：把正文一次性推回去，供渲染进程做错误汉化
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    if (text) send({ chunk: text })
    send({ done: true })
    return { rid, status: res.status, ok: res.ok }
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  // 后台泵取；handle 先返回，数据随事件到达
  ;(async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) { send({ done: true }); break }
        send({ chunk: decoder.decode(value, { stream: true }) })
      }
    } catch (e) {
      send({ error: String(e && e.message || e), done: true })
    }
  })()
  return { rid, status: res.status, ok: res.ok }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
