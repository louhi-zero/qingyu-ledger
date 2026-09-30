/* v1.0 云备份传输层：WebDAV（GET/PUT/HEAD + ETag 乐观锁）
 *
 * - 浏览器内走 fetch：要求 WebDAV 服务允许 CORS（坚果云等部分服务不允许时会明确报错）
 * - Electron 桌面端走主进程桥（window.qyWebdav），无 CORS 限制
 */

function basicAuth(cfg) {
  const token = btoa(`${cfg.username || ''}:${cfg.password || ''}`)
  return { Authorization: `Basic ${token}` }
}

// 优先使用桌面端桥，绕过浏览器 CORS
function getBridge() {
  try {
    if (typeof window !== 'undefined' && window.qyWebdav && typeof window.qyWebdav.request === 'function') {
      return window.qyWebdav
    }
  } catch { /* ignore */ }
  return null
}

async function rawRequest(method, url, cfg, { body, ifMatch, contentType, binary } = {}) {
  const headers = {}
  if (cfg.username || cfg.password) Object.assign(headers, basicAuth(cfg))
  if (method !== 'GET' && method !== 'HEAD') headers['Content-Type'] = contentType || 'application/json;charset=utf-8'
  if (ifMatch) headers['If-Match'] = ifMatch

  const bridge = getBridge()
  let res
  if (bridge) {
    // 主进程无 CORS 限制；Blob 转 ArrayBuffer 以经 IPC 结构化克隆传输
    let sendBody = body
    if (body instanceof Blob) sendBody = await body.arrayBuffer()
    res = await bridge.request({ method, url, headers, body: sendBody || null, binary: !!binary })
  } else {
    let r
    try {
      r = await fetch(url, { method, headers, body: body || undefined })
    } catch (e) {
      throw new Error(`无法连接 WebDAV（可能是网络不通或服务未允许浏览器跨域 CORS，桌面版无此限制）：${e.message}`)
    }
    if (binary) {
      res = {
        status: r.status,
        ok: r.ok,
        etag: r.headers.get('etag'),
        text: '',
        data: method === 'HEAD' ? null : await r.arrayBuffer(),
      }
    } else {
      res = {
        status: r.status,
        ok: r.ok,
        etag: r.headers.get('etag'),
        text: method === 'HEAD' ? '' : await r.text(),
        data: null,
      }
    }
  }
  return res
}

export function parentDirOf(fileUrl) {
  try {
    const u = new URL(fileUrl)
    const parts = u.pathname.split('/')
    parts.pop()
    u.pathname = parts.join('/') + '/'
    u.search = ''
    u.hash = ''
    return u.href
  } catch {
    return null
  }
}

// 尝试创建父目录（best effort）
async function mkcolOnce(cfg) {
  const dirUrl = parentDirOf(cfg.url)
  if (!dirUrl) return
  try {
    const headers = {}
    if (cfg.username || cfg.password) Object.assign(headers, basicAuth(cfg))
    const bridge = getBridge()
    if (bridge) {
      await bridge.request({ method: 'MKCOL', url: dirUrl, headers, body: null })
    } else {
      await fetch(dirUrl, { method: 'MKCOL', headers })
    }
  } catch { /* ignore */ }
}

export class WebDavTransport {
  constructor(cfg) {
    this.cfg = cfg
  }

  // 下载快照；404 返回 null（云端还没有文件）
  async get() {
    const res = await rawRequest('GET', this.cfg.url, this.cfg)
    if (res.status === 404) return null
    if (res.status === 401 || res.status === 403) {
      throw new Error(`WebDAV 账号或密码错误（${res.status}），请检查账号与应用专用密码`)
    }
    if (!res.ok) throw new Error(`读取云端文件失败：HTTP ${res.status}`)
    return { env: res.text || '', etag: res.etag || null }
  }

  // 覆盖上传；ifMatch 命中才写，否则 412 表示云端已被别的设备更新
  async put(text, etag) {
    const doPut = async (matcher) => {
      const res = await rawRequest('PUT', this.cfg.url, this.cfg, { body: text, ifMatch: matcher })
      if (res.status === 409) {
        await mkcolOnce(this.cfg)
        const retry = await rawRequest('PUT', this.cfg.url, this.cfg, { body: text, ifMatch: matcher })
        if (!retry.ok && retry.status !== 201 && retry.status !== 204) {
          const err = new Error(`上传失败：HTTP ${retry.status}`)
          err.status = retry.status
          throw err
        }
        return retry
      }
      if (res.status === 412) {
        const err = new Error('云端快照已被其他设备更新')
        err.status = 412
        throw err
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error(`WebDAV 账号或密码错误（${res.status}）`)
      }
      if (!res.ok && res.status !== 201 && res.status !== 204) {
        throw new Error(`上传失败：HTTP ${res.status}`)
      }
      return res
    }
    return doPut(etag)
  }

  // 测试连接：HEAD 文件本身，200/404 都代表连通且鉴权通过
  async test() {
    const res = await rawRequest('HEAD', this.cfg.url, this.cfg)
    if (res.status === 401 || res.status === 403) {
      throw new Error(`鉴权失败（${res.status}）：账号或应用专用密码不正确`)
    }
    if (res.status === 405 || res.status === 501) {
      // 部分服务器不支持 HEAD，用 GET 兜底
      const g = await this.get()
      return g ? '文件已存在' : '目录可访问（文件尚未创建）'
    }
    if (!res.ok && res.status !== 404) throw new Error(`连接失败：HTTP ${res.status}`)
    return res.status === 404 ? '连接正常，云端文件尚未创建' : '连接正常，云端文件已存在'
  }

  // ── 与备份快照同目录的附属文件（头像/壁纸/资产元数据） ──

  // 拼出同目录下指定文件的完整 URL（文件名均为受控 ASCII，无需编码）
  fileUrl(name) {
    const dir = parentDirOf(this.cfg.url)
    if (!dir) throw new Error('备份文件地址无法解析')
    return `${dir}${name}`
  }

  // 读取附属文件；404 → null；binary=true 返回 ArrayBuffer，否则文本
  async getFile(name, binary = false) {
    const u = this.fileUrl(name)
    const res = await rawRequest('GET', u, this.cfg, binary ? { binary: true } : {})
    if (res.status === 404) return null
    if (res.status === 401 || res.status === 403) {
      throw new Error(`WebDAV 账号或密码错误（${res.status}）`)
    }
    if (!res.ok) throw new Error(`读取云端文件 ${name} 失败：HTTP ${res.status}`)
    return binary ? res.data : res.text
  }

  // 覆盖上传附属文件（不带 ETag：资产按元数据时间戳做 LWW）；409 时尝试建目录后重试
  async putFile(name, body, contentType) {
    const u = this.fileUrl(name)
    const once = async () => rawRequest('PUT', u, this.cfg, { body, contentType })
    let res = await once()
    if (res.status === 409) {
      await mkcolOnce(this.cfg)
      res = await once()
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`WebDAV 账号或密码错误（${res.status}）`)
    }
    if (!res.ok && res.status !== 201 && res.status !== 204) {
      throw new Error(`上传 ${name} 失败：HTTP ${res.status}`)
    }
  }
}
