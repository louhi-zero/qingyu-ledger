/* 轻语记账 v1.6.5 公告系统
 * 机制移植自 NexBox「仓库即 CMS」：没有后台服务器，仓库根目录 notice.json 就是唯一数据源，
 * 开发者发布公告 = 改 notice.json → git push，push 完即上线。
 *
 * Android/Capacitor 适配（对比 Tauri 原版）：
 * - 无 Rust 层，JS 直连 fetch（HTTPS only），AbortController 5 秒超时
 * - 三级缓存：内存(30s) → localStorage(磁盘) → 网络；网络失败回落缓存，再失败返回空列表
 * - 修复原版缺陷①：重要公告强弹窗同样受「接收公告」开关控制（App.jsx 侧判定）
 * - 修复原版缺陷②：启用 version 字段——随缓存落盘，供 UI 判断「公告有更新」
 * - 缓存目录不一致问题不存在（原版缺陷③）：统一走 localStorage 单 key
 */

// 公告源：仓库公开后生效（私有仓库 raw 会 404，客户端静默降级为缓存/空列表，不影响使用）
export const NOTICE_URL = 'https://raw.githubusercontent.com/louhi-zero/qingyu-ledger/master/notice.json'
// 可选镜像源（如 Gitee raw），留空则不启用；主源失败时依次尝试
export const NOTICE_MIRROR_URL = ''

const LS_CACHE = 'qingyu_notice_cache_v1'
const LS_READ = 'qingyu_notice_read_v1' // 最近一次查看公告的日期 YYYY-MM-DD
const LS_CONFIRMED = 'qingyu_notice_confirmed_v1' // 已确认的重要公告 key 列表

const MEM_TTL = 30_000 // 进程内缓存 30 秒（对齐原版 MEMORY_CACHE_TTL_SECS=30）
const DISK_TTL = 600_000 // 磁盘缓存 10 分钟内视为新鲜，过期后先尝试网络
const MAX_LIST = 20
const MAX_TITLE = 60
const MAX_CONTENT = 600
const MAX_CONFIRMED = 50

// ---------- 纯函数（单元测试覆盖） ----------

// 解析 notice.json 原文 → { version, list }；非法返回 null。
// 字段白名单 + 长度截断，脏数据不会进入 UI。
export function parseNotice(text) {
  let d
  try { d = JSON.parse(text) } catch { return null }
  if (!d || !Array.isArray(d.list)) return null
  const list = []
  for (const a of d.list.slice(0, MAX_LIST)) {
    if (!a || typeof a.title !== 'string' || !a.title.trim()) continue
    if (typeof a.content !== 'string') continue
    list.push({
      title: a.title.trim().slice(0, MAX_TITLE),
      content: a.content.slice(0, MAX_CONTENT),
      important: a.important === true,
      date: /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') ? a.date : '',
    })
  }
  return { version: Number(d.version) || 0, list }
}

// 去重 key（对齐原版 title + create_time 组合）
export function noticeKey(a) {
  return `${a.title}_${a.date}`
}

// 未读判定：晚于 lastRead（YYYY-MM-DD）即未读；从未读过则全部未读
export function unreadNotice(list, lastRead) {
  if (!lastRead) return list
  return list.filter((a) => a.date > lastRead)
}

// 待强弹的重要公告（保持传入顺序），排除已确认
export function importantPending(list, confirmedKeys) {
  const set = new Set(confirmedKeys || [])
  return list.filter((a) => a.important && !set.has(noticeKey(a)))
}

// ---------- 缓存（浏览器 localStorage） ----------

export function loadCache() {
  try {
    const d = JSON.parse(localStorage.getItem(LS_CACHE))
    if (!d || !Array.isArray(d.list)) return null
    return { version: Number(d.version) || 0, list: d.list, at: Number(d.at) || 0 }
  } catch { return null }
}

function saveCache(data) {
  try {
    localStorage.setItem(LS_CACHE, JSON.stringify({ version: data.version, list: data.list, at: Date.now() }))
  } catch { /* 存储满等异常静默 */ }
}

export function loadRead() {
  return localStorage.getItem(LS_READ) || ''
}

export function saveRead(date) {
  try {
    const cur = localStorage.getItem(LS_READ) || ''
    if (date > cur) localStorage.setItem(LS_READ, date)
  } catch { /* ignore */ }
}

export function loadConfirmed() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_CONFIRMED))
    return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : []
  } catch { return [] }
}

export function addConfirmed(key) {
  try {
    const arr = loadConfirmed()
    if (!arr.includes(key)) {
      arr.push(key)
      // 上限裁剪：保留最近确认的
      localStorage.setItem(LS_CONFIRMED, JSON.stringify(arr.slice(-MAX_CONFIRMED)))
    }
  } catch { /* ignore */ }
}

// ---------- 拉取 ----------

// 带超时的 GET（对齐原版请求 5s 超时；Android WebView 下 fetch 无连接超时分离概念）
export async function fetchNoticeText(url, timeoutMs = 5000) {
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

let mem = null
let memAt = 0

// 三级缓存拉取：内存(30s) → 磁盘(新鲜即用) → 网络（失败回落旧缓存 → 空列表）
export async function getNotice() {
  const now = Date.now()
  if (mem && now - memAt < MEM_TTL) return mem

  const cached = loadCache()
  if (cached && now - cached.at < DISK_TTL) {
    mem = cached
    memAt = now
    return mem
  }

  // 过期/无缓存：主源 → 镜像 依次尝试
  const urls = [NOTICE_URL, NOTICE_MIRROR_URL].filter(Boolean)
  for (const url of urls) {
    try {
      const data = parseNotice(await fetchNoticeText(url))
      if (data) {
        saveCache(data)
        mem = { ...data, at: now }
        memAt = now
        return mem
      }
    } catch { /* 下一个源 */ }
  }

  // 网络失败：有旧缓存用旧缓存（任意龄），否则空列表
  if (cached) {
    mem = cached
    memAt = now
    return mem
  }
  return { version: 0, list: [] }
}
