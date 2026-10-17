/* 轻语记账 v3.6.6 仓库即 CMS 通用模块（公告系统同款思路的通用化）
 * 没有后端：仓库根目录的 JSON 文件就是唯一数据源，开发者改文件 → git push 即发布。
 * 供赞助名单（support.json）与主题商城目录（themes.json）共用；公告（notice.js）独立实现。
 *
 * 三级缓存对齐 notice.js：内存(30s) → localStorage(10 分钟) → 网络；
 * 网络失败回落旧缓存，再失败返回 null（UI 显示内置兜底数据，永不报错弹窗）。
 *
 * 渠道链（按国内可达性排序；fetch 受 CORS 约束，<img> 直显不受限）：
 * - gitee raw：国内直连最快，但无 CORS 头，webview fetch 会被拦——保留尝试（原生 HTTP 通道/政策变化时自动生效）
 * - cdn.jsdelivr.net：GitHub 的 CN CDN，ACAO=* ✓（@master 有约 12h 缓存）
 * - raw.githubusercontent.com：权威源，ACAO=* ✓，国内连通性差
 */

const GITEE_RAW = 'https://gitee.com/Roxie-zero/whisper-accounting/raw/master'
const JSDELIVR = 'https://cdn.jsdelivr.net/gh/louhi-zero/qingyu-ledger@master'
const GITHUB_RAW = 'https://raw.githubusercontent.com/louhi-zero/qingyu-ledger/master'

// 渠道链：国内直连 → CN 加速 CDN → 权威兜底；fetch 失败自动换下一个
export const CMS_BASES = [GITEE_RAW, JSDELIVR, GITHUB_RAW]

export function cmsFileUrls(relPath) {
  const p = String(relPath || '').replace(/^\/+/, '')
  return CMS_BASES.map((b) => `${b}/${p}`)
}

const MEM_TTL = 30_000
const DISK_TTL = 600_000

const memMap = new Map() // cacheKey -> { data, at }

export function loadJsonCache(key) {
  try {
    const d = JSON.parse(localStorage.getItem(key))
    return d && typeof d === 'object' && d.at ? d : null
  } catch { return null }
}

function saveJsonCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ...data, at: Date.now() })) } catch { /* 配额满静默 */ }
}

// 带超时的 GET（对齐 notice.js 请求 5s 超时）
export async function fetchText(url, timeoutMs = 5000) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

// 拉取并解析远端 JSON：新鲜缓存直接用；否则沿渠道链尝试；失败回落旧缓存 → null
// parse 为纯函数解析器（白名单 + 截断），返回 null 视为脏数据，继续换下一个渠道
export async function getCmsJson(relPath, { cacheKey, parse, ttlMs = DISK_TTL, timeoutMs = 5000 } = {}) {
  const now = Date.now()
  const mem = memMap.get(cacheKey)
  if (mem && now - mem.at < MEM_TTL) return mem
  const cached = loadJsonCache(cacheKey)
  if (cached && now - cached.at < ttlMs) {
    memMap.set(cacheKey, cached)
    return cached
  }
  for (const url of cmsFileUrls(relPath)) {
    try {
      const data = parse(await fetchText(url, timeoutMs))
      if (data) {
        saveJsonCache(cacheKey, data)
        memMap.set(cacheKey, data)
        return data
      }
    } catch { /* 下一个渠道 */ }
  }
  return cached || null
}

// ---------- 纯函数解析器（单元测试覆盖）：字段白名单 + 截断，脏数据不进 UI ----------

const MAX_NAME = 30
const MAX_LIST = 200

// support.json → { sponsors: [{id, amount}], testers: [id] }
export function parseSupport(text) {
  let d
  try { d = JSON.parse(text) } catch { return null }
  if (!d || (!Array.isArray(d.sponsors) && !Array.isArray(d.testers))) return null
  const sponsors = (Array.isArray(d.sponsors) ? d.sponsors : []).slice(0, MAX_LIST)
    .filter((s) => s && typeof s.id === 'string' && s.id.trim())
    .map((s) => ({ id: s.id.trim().slice(0, MAX_NAME), amount: Math.min(99999999, Math.max(0, Number(s.amount) || 0)) }))
  const testers = (Array.isArray(d.testers) ? d.testers : []).slice(0, MAX_LIST)
    .filter((t) => typeof t === 'string' && t.trim())
    .map((t) => t.trim().slice(0, MAX_NAME))
  return { sponsors, testers }
}

const MAX_THEMES = 50
const MAX_DESC = 80
const THEME_FILE_RE = /^[a-z0-9][a-z0-9/._-]*\.(jpg|jpeg|png)$/i

// themes.json → { version, list: [{id,name,author,desc,file,size}] }
// file 白名单校验（相对仓库根路径，仅图片后缀）防路径穿越；id 去重
export function parseThemes(text) {
  let d
  try { d = JSON.parse(text) } catch { return null }
  if (!d || !Array.isArray(d.list)) return null
  const list = []
  const seen = new Set()
  for (const t of d.list.slice(0, MAX_THEMES)) {
    if (!t || typeof t.file !== 'string' || !THEME_FILE_RE.test(t.file)) continue
    const id = typeof t.id === 'string' && t.id.trim() ? t.id.trim().slice(0, 40) : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    list.push({
      id,
      name: (typeof t.name === 'string' && t.name.trim() ? t.name.trim() : id).slice(0, MAX_NAME),
      author: (typeof t.author === 'string' && t.author.trim() ? t.author.trim() : '佚名').slice(0, MAX_NAME),
      desc: (typeof t.desc === 'string' ? t.desc : '').slice(0, MAX_DESC),
      file: t.file,
      size: Math.max(0, Number(t.size) || 0),
    })
  }
  return { version: Number(d.version) || 0, list }
}

// 主题文件三渠道直链（<img> 预览三源全可用；fetch 下载时 CORS 失败自动换下一渠道）
export function themeFileUrls(file) {
  return cmsFileUrls(file)
}
