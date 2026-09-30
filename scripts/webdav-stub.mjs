/* 本地最小 WebDAV 桩：支持 OPTIONS(CORS) / HEAD / GET / PUT(ETag+If-Match) / MKCOL
 * 用法：node scripts/webdav-stub.mjs [port]
 * 仅供 v1.0 云备份浏览器实测使用，不是产品代码。
 */
import http from 'node:http'

export function startServer(port = 0) {
  const files = new Map()
  let seq = 0
  const cors = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,HEAD,OPTIONS,MKCOL')
    res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,if-match')
    res.setHeader('Access-Control-Expose-Headers', 'etag,content-type')
  }
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      cors(res)
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
      if (req.method === 'MKCOL') { res.writeHead(201); res.end(); return }
      if (req.method === 'HEAD') {
        const f = files.get(path)
        if (!f) { res.writeHead(404); res.end(); return }
        res.setHeader('ETag', f.etag); res.writeHead(200); res.end(); return
      }
      if (req.method === 'GET') {
        const f = files.get(path)
        if (!f) { res.writeHead(404); res.end('not found'); return }
        res.setHeader('ETag', f.etag); res.setHeader('Content-Type', 'application/json')
        res.writeHead(200); res.end(f.text); return
      }
      if (req.method === 'PUT') {
        const im = req.headers['if-match']
        const cur = files.get(path)
        if (im && (!cur || cur.etag !== im)) { res.writeHead(412); res.end('precondition failed'); return }
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => {
          const etag = `W/"v${++seq}"`
          files.set(path, { text: body, etag })
          res.setHeader('ETag', etag)
          res.writeHead(cur ? 200 : 201); res.end()
        })
        return
      }
      res.writeHead(405); res.end()
    })
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port
      resolve({
        server,
        port: p,
        url: `http://127.0.0.1:${p}/dav/qingyu/backup.json`,
      })
    })
  })
}

// 直接运行：常驻服务
import { pathToFileURL } from 'node:url'
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2]) || 8799
  const s = await startServer(port)
  console.log(`WebDAV stub on http://127.0.0.1:${port}  file=${s.url}`)
}
