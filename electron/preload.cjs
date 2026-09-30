/* 预加载：仅暴露两个受限网络桥，不开放任意 Node 能力
 * - qyWebdav：WebDAV（http/https 白名单）
 * - qyHttp：第三方 API（仅 https），requestStream 支持 SSE 分块回调
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('qyWebdav', {
  request: (payload) => ipcRenderer.invoke('qy-webdav', payload),
})

contextBridge.exposeInMainWorld('qyHttp', {
  // payload: { url, method, headers, body }；onChunk(text) 多次回调
  // resolve: { status, ok }
  requestStream: (payload, onChunk) => new Promise((resolve, reject) => {
    const rid = 'qy' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    let status = 0
    let settled = false
    const cleanup = () => ipcRenderer.removeListener('qy-http-chunk', handler)
    const handler = (_event, msg) => {
      if (!msg || msg.rid !== rid) return
      if (typeof msg.status === 'number') status = msg.status
      if (msg.error) {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error(msg.error))
        return
      }
      if (msg.chunk) {
        try { onChunk(msg.chunk) } catch { /* 渲染进程回调异常不影响泵取 */ }
      }
      if (msg.done) {
        if (settled) return
        settled = true
        cleanup()
        resolve({ status, ok: status >= 200 && status < 300 })
      }
    }
    ipcRenderer.on('qy-http-chunk', handler)
    ipcRenderer.invoke('qy-http-stream', { ...payload, rid }).then(
      (r) => {
        if (r && r.status === 0) {
          if (!settled) { settled = true; cleanup(); reject(new Error('网络请求失败')) }
        }
      },
      (e) => {
        if (!settled) { settled = true; cleanup(); reject(e) }
      },
    )
  }),
})
