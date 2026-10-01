/* v1.7.0 应用内更新（安卓模式，机制对标 NexBox 桌面端但按 Android 重写）
 *
 * 对标 NexBox（Tauri/Rust + GitCode）后的适配差异：
 * - 更新源：GitHub Releases 公开 API（匿名可用，无需硬编码令牌，规避 NexBox P1 令牌泄漏）
 * - 下载：不在 JS 拉 Blob（WebView 大文件会 OOM），交原生 UpdatePlugin 流式写 app-specific 目录
 * - 安装：安卓不允许静默安装——下载可静默，安装必须 FileProvider 拉起系统安装器由用户确认
 * - 完整性：NexBox 只有 Content-Length 防截断；本模块在其之上加 SHA-256 校验（CI 随包上传 .sha256）
 * - Web/Electron：无原生桥，一律降级为「打开 Release 下载页」外链
 *
 * 触发时机（同 NexBox 克制策略）：仅启动后自动检查一次（当天不重复）+ 关于页手动，无轮询。
 */

// 版本单一数据源：所有 UI 展示与版本比较都从这里取（避免 NexBox 风险#3 多处硬编码）
export const APP_VERSION = '1.7.0'

const REPO = 'louhi-zero/qingyu-ledger'
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASE_PAGE = (tag) => `https://github.com/${REPO}/releases/tag/${tag}`
const REPO_DOWNLOAD_HOST = 'github.com' // 仅信任官方 release 链接，不跟随镜像

const LS_CHECK_CACHE = 'qingyu_update_check_v1' // { at, info }
const LS_DISMISSED = 'qingyu_update_dismissed_v1' // 用户点「稍后」的 tag
const CHECK_TTL = 60 * 60 * 1000 // 检查结果内存/磁盘缓存 1 小时
const FETCH_TIMEOUT = 10_000

// ---------- 纯函数（单元测试覆盖） ----------

// 去 v 前缀与空白；非法返回 ''
export function normalizeVersion(v) {
  return String(v == null ? '' : v).trim().replace(/^[vV]/, '')
}

// 逐位数字比较：a>b → 1，相等 → 0，a<b → -1。非法版本按 0 处理。
// 处理 1.10.0 > 1.9.0 这类位数陷阱；预发布后缀（-beta）忽略只按数字主干比。
export function compareVersions(a, b) {
  const pa = normalizeVersion(a).split(/[+-]/)[0].split('.').map((x) => Number.parseInt(x, 10) || 0)
  const pb = normalizeVersion(b).split(/[+-]/)[0].split('.').map((x) => Number.parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const da = pa[i] || 0
    const db = pb[i] || 0
    if (da > db) return 1
    if (da < db) return -1
  }
  return 0
}

// 从 release.assets 中挑 APK 与对应 .sha256 校验文件。
// 命名约定：qingyu-<tag>-android.apk + qingyu-<tag>-android.apk.sha256
export function pickUpdateAssets(assets) {
  const list = Array.isArray(assets) ? assets : []
  const apks = list.filter((a) => a && /-android\.apk$/i.test(a.name || ''))
  // 多个 APK 时取发布时间最新（理论上只有一个，防御脏数据）
  const apk = apks.sort((x, y) => String(y.created_at || '').localeCompare(String(x.created_at || '')))[0] || null
  if (!apk) return { apk: null, sha256: null }
  const sha = list.find((a) => (a.name || '').toLowerCase() === `${apk.name.toLowerCase()}.sha256`)
    || list.find((a) => /\.sha256$/i.test(a.name || '') && (a.name || '').includes(apk.name.replace(/\.apk$/i, '')))
    || null
  return { apk, sha256: sha }
}

// GitHub release JSON → 前端使用的更新信息；非法/草稿/预发布返回 null
export function parseRelease(json, currentVersion) {
  if (!json || typeof json !== 'object') return null
  if (json.draft === true || json.prerelease === true) return null
  const tag = String(json.tag_name || '').trim()
  if (!tag) return null
  const version = normalizeVersion(tag)
  if (!version || !/^\d+(\.\d+)*$/.test(version)) return null
  if (compareVersions(version, currentVersion) <= 0) return null
  const { apk, sha256 } = pickUpdateAssets(json.assets)
  if (!apk || !apk.browser_download_url) return null
  return {
    tag,
    version,
    name: String(json.name || tag),
    notes: String(json.body || '').slice(0, 4000),
    publishedAt: String(json.published_at || '').slice(0, 10),
    apkName: apk.name,
    apkUrl: apk.browser_download_url,
    size: Number(apk.size) || 0,
    sha256Url: sha256?.browser_download_url || '',
  }
}

// 自动检查当日是否还需要跑（lastAt 毫秒，now 注入便于测试）
export function shouldAutoCheck(lastAt, now = Date.now()) {
  return !lastAt || now - lastAt >= CHECK_TTL
}

export function dismissedTag() {
  try { return localStorage.getItem(LS_DISMISSED) || '' } catch { return '' }
}
export function markDismissed(tag) {
  try { localStorage.setItem(LS_DISMISSED, tag) } catch { /* ignore */ }
}

// ---------- 网络检查（缓存：内存 → localStorage → 网络） ----------

let memCache = null // { at, info }

function readDiskCache() {
  try {
    const d = JSON.parse(localStorage.getItem(LS_CHECK_CACHE) || 'null')
    if (d && typeof d === 'object' && d.at) return d
  } catch { /* ignore */ }
  return null
}
function writeCache(info) {
  const d = { at: Date.now(), info }
  memCache = d
  try { localStorage.setItem(LS_CHECK_CACHE, JSON.stringify(d)) } catch { /* ignore */ }
}

async function fetchLatest() {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT)
  try {
    const res = await fetch(API_LATEST, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`HTTP_${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// 检查更新。force=true 跳过缓存（手动检查）；无新版/失败返回 null。
export async function checkForUpdate(currentVersion = APP_VERSION, { force = false } = {}) {
  if (!force && memCache && Date.now() - memCache.at < CHECK_TTL) return memCache.info
  if (!force) {
    const disk = readDiskCache()
    if (disk && Date.now() - disk.at < CHECK_TTL) { memCache = disk; return disk.info }
  }
  let info = null
  try {
    info = parseRelease(await fetchLatest(), currentVersion)
  } catch {
    // 网络失败：手动场景也回落最近缓存（可能为 null），绝不阻断主流程
    if (!force) return memCache?.info ?? readDiskCache()?.info ?? null
    return memCache?.info ?? readDiskCache()?.info ?? null
  }
  writeCache(info)
  return info
}

// 读取 CI 随包发布的 .sha256 文本，提取首个 hex（sha256sum 格式：<hash>  <filename>）
export async function fetchSha256(url) {
  if (!url) return ''
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT)
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) return ''
    const text = await res.text()
    const m = text.toLowerCase().match(/[0-9a-f]{64}/)
    return m ? m[0] : ''
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

export function releasePageUrl(tag) {
  return RELEASE_PAGE(tag)
}

// ---------- 原生桥（AppUpdate Capacitor 插件，动态注册；非 Android 静默降级） ----------

let bridgePromise = null

// 测试钩子：window.__qyUpdateBridge 显式定义时（null=强制 web 外链，对象=mock 原生）直接采用
export async function getUpdateBridge() {
  if (typeof window !== 'undefined' && Object.prototype.hasOwnProperty.call(window, '__qyUpdateBridge')) {
    return window.__qyUpdateBridge
  }
  if (!bridgePromise) {
    bridgePromise = (async () => {
      try {
        const { registerPlugin, Capacitor } = await import('@capacitor/core')
        if (Capacitor.getPlatform() !== 'android') return null
        return registerPlugin('AppUpdate')
      } catch {
        return null
      }
    })()
  }
  return bridgePromise
}

// 下载 APK 到 app-specific 下载目录；onProgress(pct 0-100) 回调；返回 { path, sha256, bytes }
export async function downloadApk(info, onProgress) {
  const P = await getUpdateBridge()
  if (!P) throw new Error('NO_NATIVE_BRIDGE')
  let handle = null
  if (onProgress && P.addListener) {
    handle = await P.addListener('downloadProgress', (e) => {
      const pct = Math.max(0, Math.min(100, Number(e?.progress) || 0))
      onProgress(pct, e)
    })
  }
  try {
    const r = await P.download({ url: info.apkUrl, fileName: info.apkName })
    return { path: r?.path || '', sha256: String(r?.sha256 || '').toLowerCase(), bytes: Number(r?.bytes) || 0 }
  } finally {
    try { handle?.remove?.() } catch { /* ignore */ }
  }
}

export async function cancelApkDownload() {
  const P = await getUpdateBridge()
  if (!P) return
  try { await P.cancelDownload() } catch { /* ignore */ }
}

// { platform, sdkInt, canInstall }；非原生返回 null
export async function installerInfo() {
  const P = await getUpdateBridge()
  if (!P) return null
  try {
    const r = await P.installerInfo()
    return { platform: 'android', sdkInt: Number(r?.sdkInt) || 0, canInstall: r?.canInstall !== false }
  } catch {
    return null
  }
}

// 跳转系统「安装未知应用」授权页
export async function openInstallPermission() {
  const P = await getUpdateBridge()
  if (!P) return false
  try { await P.openInstallSettings(); return true } catch { return false }
}

// 拉起系统安装器。返回：
// 'launched' 已拉起安装器 | 'needPermission' 需先授权未知来源 | null 非原生/失败
export async function launchInstaller(path) {
  const P = await getUpdateBridge()
  if (!P) return null
  try {
    const r = await P.install({ path })
    if (r?.needPermission) return 'needPermission'
    return r?.launched ? 'launched' : null
  } catch {
    return null
  }
}

// Web/Electron 兜底：新窗口打开 Release 页（外链由浏览器/系统下载管理器接管）
export function openReleasePage(tag) {
  const url = RELEASE_PAGE(tag)
  try { window.open(url, '_blank', 'noopener') } catch { /* ignore */ }
  return url
}
