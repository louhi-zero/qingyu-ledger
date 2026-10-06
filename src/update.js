/* v1.7.0 应用内更新（安卓模式，机制对标 NexBox 桌面端但按 Android 重写）
 *
 * 对标 NexBox（Tauri/Rust + GitCode）后的适配差异：
 * - 更新源：GitHub Releases 公开 API（匿名可用，无需硬编码令牌，规避 NexBox P1 令牌泄漏）
 * - 下载：不在 JS 拉 Blob（WebView 大文件会 OOM），交原生 UpdatePlugin 流式写 app-specific 目录
 * - 安装：安卓不允许静默安装——下载可静默，安装必须 FileProvider 拉起系统安装器由用户确认
 * - 完整性：NexBox 只有 Content-Length 防截断；本模块在其之上加 SHA-256 校验（CI 随包上传 .sha256）
 * - Web/Electron：无原生桥，一律降级为「打开 Release 下载页」外链
 *
 * 触发时机：启动后自动检查一次 + 运行期每 PERIODIC_CHECK_MS 定期检查（网络节流仍为 1h）+ 手动按需。
 *
 * v2.2 重构（可扩展性 + 断点续传 + 友好错误）：
 * - 版本检测策略注册表 registerCheckStrategy/setActiveCheckStrategy（默认 github-release，可扩展自建服务器等）
 * - 断点续传：原生 Range 请求 + 206 续传（跨镜像源共享半成品）；取消/失败保留半成品，重试自动续传
 * - friendlyUpdateError：网络异常/服务器不可用/校验失败等错误统一映射为友好中文提示
 * - 下载协议可注入：downloadWithFallback opts.transport（默认原生流式下载，未来可加分片协议等）
 */

// 版本单一数据源：所有 UI 展示与版本比较都从这里取（避免 NexBox 风险#3 多处硬编码）
export const APP_VERSION = '3.2'

const REPO = 'louhi-zero/qingyu-ledger'
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASE_PAGE = (tag) => `https://github.com/${REPO}/releases/tag/${tag}`
const REPO_DOWNLOAD_HOST = 'github.com' // 版本 API/校验文本仅信任官方域；APK 下载走多源加速（OWN_RELEASE_HOSTS + MIRROR_PREFIXES）

const LS_CHECK_CACHE = 'qingyu_update_check_v1' // { at, info }
const LS_DISMISSED = 'qingyu_update_dismissed_v1' // 用户点「稍后」的 tag
const CHECK_TTL = 60 * 60 * 1000 // 检查结果内存/磁盘缓存 1 小时
const FETCH_TIMEOUT = 10_000
// 定期检查间隔（运行期定时器；真正打网络仍受 CHECK_TTL 1h 节流——克制轮询，不骚扰服务器）
export const PERIODIC_CHECK_MS = 30 * 60 * 1000

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

// ---------- v2.4 更新日志（内存 ring + localStorage 持久化，排障可导出） ----------
const LS_UPDATE_LOG = 'qingyu_update_log_v1'
const LOG_MAX = 120
const logBuf = []

function logLoad() {
  if (logBuf.length) return
  try {
    const arr = JSON.parse(localStorage.getItem(LS_UPDATE_LOG) || '[]')
    if (Array.isArray(arr)) logBuf.push(...arr.slice(-LOG_MAX))
  } catch { /* ignore */ }
}
function logFlush() {
  try { localStorage.setItem(LS_UPDATE_LOG, JSON.stringify(logBuf.slice(-LOG_MAX))) } catch { /* ignore */ }
}
/** 记录更新模块日志：level: debug|info|warn|error；extra 尽量小（会被 JSON 序列化） */
export function updLog(level, event, extra = null) {
  try {
    logBuf.push({ t: Date.now(), level: String(level), event: String(event), extra: extra == null ? '' : extra })
    if (logBuf.length > LOG_MAX) logBuf.splice(0, logBuf.length - LOG_MAX)
    logFlush()
  } catch { /* 日志永不影响主流程 */ }
}
/** 读取最近 n 条日志（新→旧），排障展示用 */
export function getUpdateLogs(n = 8) {
  logLoad()
  return logBuf.slice(-n).reverse()
}
export function clearUpdateLogs() {
  logBuf.length = 0
  try { localStorage.removeItem(LS_UPDATE_LOG) } catch { /* ignore */ }
}

// ---------- v2.4 硬超时双保险 ----------
// 实测教训：部分 WebView（如雷电模拟器）fetch 在连接挂起阶段不响应 AbortController.abort()，
// await 永不返回 → 状态机卡死在「检查中…」。Promise.race 与 abort 并存：
// abort 生效则走 abort 错误；不生效也必然在 ms 后 reject TIMEOUT —— 永不挂死。
export function raceTimeout(promise, ms, code = 'CHECK_TIMEOUT') {
  let timer = null
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(code)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
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
  const t0 = Date.now()
  updLog('info', 'fetch:start', { url: API_LATEST.slice(0, 80) })
  try {
    const res = await fetch(API_LATEST, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: ctrl.signal,
    })
    if (!res.ok) {
      updLog('warn', 'fetch:http', { status: res.status, ms: Date.now() - t0 })
      throw new Error(`HTTP_${res.status}`)
    }
    const json = await res.json()
    updLog('info', 'fetch:ok', { ms: Date.now() - t0 })
    return json
  } catch (e) {
    updLog('warn', 'fetch:fail', { error: String(e && e.message).slice(0, 60), ms: Date.now() - t0 })
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// ---------- 版本检测策略注册表（可扩展：未来可加自建服务器/应用市场等策略） ----------
// 策略即一个 async () => release原始JSON 的函数；checkForUpdate 只负责缓存与解析，不关心来源。
const checkStrategies = new Map()
let activeStrategy = 'github-release'

export function registerCheckStrategy(id, fetchFn) {
  if (typeof fetchFn === 'function') checkStrategies.set(String(id), fetchFn)
}
export function setActiveCheckStrategy(id) {
  if (checkStrategies.has(String(id))) activeStrategy = String(id)
}
registerCheckStrategy('github-release', fetchLatest) // 默认策略：GitHub Releases 公开 API

// 检查更新。force=true 跳过缓存（手动检查，失败抛错给 UI 友好提示）；自动检查失败回落缓存返回 null。
// v2.4：raceTimeout 硬超时（fetch 挂起且 abort 失效时也必然在 timeoutMs 内返回，绝不挂死）；
// timeoutMs 可注入（测试用），默认 FETCH_TIMEOUT + 2s 冗余。
export async function checkForUpdate(currentVersion = APP_VERSION, { force = false, timeoutMs = FETCH_TIMEOUT + 2000 } = {}) {
  updLog('info', 'check:start', { force, strategy: activeStrategy, cur: currentVersion })
  if (!force && memCache && Date.now() - memCache.at < CHECK_TTL) {
    updLog('debug', 'check:cache-hit', { where: 'mem', found: !!memCache.info })
    return memCache.info
  }
  if (!force) {
    const disk = readDiskCache()
    if (disk && Date.now() - disk.at < CHECK_TTL) {
      memCache = disk
      updLog('debug', 'check:cache-hit', { where: 'disk', found: !!disk.info })
      return disk.info
    }
  }
  const fetchFn = checkStrategies.get(activeStrategy) || checkStrategies.get('github-release')
  let info = null
  try {
    const raw = await raceTimeout(fetchFn(), timeoutMs, 'CHECK_TIMEOUT')
    info = parseRelease(raw, currentVersion)
    updLog('info', 'check:done', { found: !!info, tag: info?.tag || '', version: info?.version || '' })
  } catch (e) {
    updLog('error', 'check:fail', { code: String(e && e.message).slice(0, 60), force })
    // 自动检查：网络失败回落最近缓存（可能为 null），绝不阻断主流程；
    // 手动检查：抛给调用方显示友好错误（「已是最新」不能掩盖网络故障）
    if (force) throw e
    const fallback = memCache?.info ?? readDiskCache()?.info ?? null
    updLog('info', 'check:fallback-cache', { found: !!fallback })
    return fallback
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

// ---------- v2.0.2 下载加速：镜像候选 + 停滞看门狗（参考 NexBox 多源/探测思路） ----------
// GitHub release 直链在国内下载极慢；加速镜像为前缀代理（原样回源 + 国内 CDN）。
// 安全性：镜像内容不可控，但 APK 必须通过 SHA-256 校验（CI 随包发布 .sha256），
// 校验失败自动删文件并换下一个候选（最终回落官方直连），速度与安全兼得。
export const MIRROR_PREFIXES = ['https://gh-proxy.com/', 'https://ghfast.top/']

// v3.2.1 自有平台直连渠道：release 资产发布到各平台镜像仓库后自动生效。
// repo 为各平台实际仓库路径（命名空间/仓库名可与 GitHub 不同：gitee 实测为 Roxie-zero/whisper-accounting）；
// repo 为空 = 渠道未就绪，生成候选时自动跳过（不留死候选）。
// URL 模式依据：gitee 官方文档模式；gitcode 资产域经 API 实测为 raw.gitcode.com（附件路径
// GitHub 风格，待发布后实测）；atomgit 为 GitLab 风格（其 API 匿名需 private-token，
// 无法核验，待发布后实测）。模式如有出入只需改本表。
export const OWN_RELEASE_HOSTS = [
  { id: 'gitee', repo: 'Roxie-zero/whisper-accounting', build: (repo, tag, f) => `https://gitee.com/${repo}/releases/download/${tag}/${f}` },
  { id: 'gitcode', repo: '', build: (repo, tag, f) => `https://raw.gitcode.com/${repo}/releases/download/${tag}/${f}` },
  { id: 'atomgit', repo: '', build: (repo, tag, f) => `https://atomgit.com/${repo}/-/releases/${tag}/downloads/${f}` },
]

// GitHub release 资产直链 → [就绪的自有平台 → 前缀代理×2 → 官方直连兜底]；其余 URL 原样单候选。
// tag/file 保留原串（含转义段）；自有平台用各自配置的 repo 路径，owner/repo 仅作 URL 形状校验
const GITHUB_ASSET_RE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/releases\/download\/([^/\s]+)\/([^\s?#]+)/

export function buildDownloadCandidates(url) {
  const u = String(url || '')
  const m = GITHUB_ASSET_RE.exec(u)
  if (!m) return [u]
  const [, , , tag, file] = m
  return [
    ...OWN_RELEASE_HOSTS.filter((h) => h.repo).map((h) => h.build(h.repo, tag, file)),
    ...MIRROR_PREFIXES.map((p) => p + u),
    u,
  ]
}

// 多源顺序下载：单源停滞 stallMs 无任何进度 → 自动取消并换下一源；
// shouldAbort() 为调用方（用户取消）出口，置位后抛 CANCELLED 不再换源。
// onSource(url, viaMirror) 供 UI 展示当前通道。
// 断点续传：半成品文件跨候选源共享（同一 APK 内容），原生 206 续传；服务器不支持 Range 自动回落全量。
// 可扩展：opts.transport 可注入自定义下载协议实现（默认原生流式下载）。
export async function downloadWithFallback(info, onProgress, opts = {}) {
  const { stallMs = 15_000, shouldAbort = () => false, onSource, transport, resume = true } = opts
  const doDownload = transport || downloadApk
  const official = String(info.apkUrl || '')
  const candidates = buildDownloadCandidates(official)
  let lastErr = null
  for (let i = 0; i < candidates.length; i++) {
    if (shouldAbort()) throw new Error('CANCELLED')
    const url = candidates[i]
    const viaMirror = url !== official // 自有平台直连与前缀代理都算加速通道，仅官方原链不算
    try { onSource?.(url, viaMirror) } catch { /* ignore */ }
    let lastTick = Date.now()
    const wrapped = (pct, ev) => { lastTick = Date.now(); onProgress?.(pct, ev) }
    // 看门狗：每 2s 检查进度时间戳，停滞即取消当前源（原生 reject CANCELLED，非用户取消 → 换源）
    const watchdog = setInterval(() => {
      if (Date.now() - lastTick > stallMs) cancelApkDownload()
    }, 2000)
    try {
      return await doDownload({ ...info, apkUrl: url }, wrapped, { resume })
    } catch (e) {
      lastErr = e
      if (shouldAbort()) throw new Error('CANCELLED')
      // 半成品保留（断点续传）；稍候片刻让被取消的下载线程退出（原生代数令牌兜底防并发写）
      await new Promise((r) => setTimeout(r, 80))
      continue // 看门狗切换或该源下载失败 → 下一个候选
    } finally {
      clearInterval(watchdog)
    }
  }
  throw lastErr || new Error('ALL_SOURCES_FAILED')
}

// ---------- v2.2 友好错误提示：把底层错误码/网络异常映射为用户能懂的中文 ----------
export function friendlyUpdateError(e) {
  const msg = String((e && e.message) || e || '')
  if (msg === 'CHECK_TIMEOUT') return '检查更新超时（网络不通或被拦截），请稍后重试'
  if (msg === 'CANCELLED') return '下载已取消'
  if (msg === 'BUSY') return '已有下载任务进行中，请稍后再试'
  if (msg === 'NO_NATIVE_BRIDGE') return '当前环境不支持应用内下载，请前往下载页手动下载'
  if (msg === 'BAD_URL' || msg === 'BAD_FILE_NAME') return '更新包地址无效，请稍后重试'
  if (/^HTTP_4\d\d/.test(msg)) return `下载被服务器拒绝（${msg.slice(5)}），请稍后重试`
  if (/^HTTP_5\d\d/.test(msg)) return '版本服务器暂时不可用，请稍后重试'
  if (/timeout|timed?\s?out|abort/i.test(msg)) return '网络超时，请检查网络后重试'
  if (/ECONN|ENET|INTERNET|UnknownHost|Unable\s+to\s+resolve|Network/i.test(msg)) return '网络不可用，请检查网络连接后重试'
  if (/SIZE_MISMATCH/.test(msg)) return '下载不完整，已保留进度，重试将自动断点续传'
  if (msg === 'ALL_SOURCES_FAILED') return '所有下载通道均失败，请检查网络后重试'
  return '操作失败，请检查网络后重试'
}

// .sha256 校验文本同样走多源（镜像可能无 CORS 头 → fetch 失败自动换下一个，最大努力）
export async function fetchSha256WithFallback(url) {
  for (const u of buildDownloadCandidates(url)) {
    const v = await fetchSha256(u)
    if (v) return v
  }
  return ''
}

// ---------- 原生桥（AppUpdate Capacitor 插件，动态注册；非 Android 静默降级） ----------

let bridgePromise = null

// 测试钩子：window.__qyUpdateBridge 显式定义时（null=强制 web 外链，对象=mock 原生）直接采用
export async function getUpdateBridge() {
  if (typeof window !== 'undefined' && Object.prototype.hasOwnProperty.call(window, '__qyUpdateBridge')) {
    return window.__qyUpdateBridge
  }
  if (!bridgePromise) {
    // 【严重修复】同 notifyCatch.getNotifyCatch：插件代理是 thenable，绝不能作为 Promise
    // 结算值（async return / .then 回调返回都会扁平化挂死，真机上原生下载/安装桥失效），
    // 包非 thenable 门面规避。
    bridgePromise = (async () => {
      try {
        const { registerPlugin, Capacitor } = await import('@capacitor/core')
        if (Capacitor.getPlatform() !== 'android') return null
        const proxy = registerPlugin('AppUpdate')
        return new Proxy({}, {
          get(_t, prop, recv) {
            if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
            return Reflect.get(proxy, prop, proxy)
          },
        })
      } catch {
        return null
      }
    })()
  }
  return bridgePromise
}

// 下载 APK 到 app-specific 下载目录；onProgress(pct 0-100, ev) 回调；返回 { path, sha256, bytes, resumed }
// resume=true（默认）：存在同名半成品时向服务器发 Range 请求断点续传（206），不支持 Range 的源自动回落全量
export async function downloadApk(info, onProgress, { resume = true } = {}) {
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
    const r = await P.download({ url: info.apkUrl, fileName: info.apkName, resume })
    return {
      path: r?.path || '',
      sha256: String(r?.sha256 || '').toLowerCase(),
      bytes: Number(r?.bytes) || 0,
      resumed: !!r?.resumed,
    }
  } finally {
    try { handle?.remove?.() } catch { /* ignore */ }
  }
}

// 查询半成品（断点续传）：{ exists, bytes }；非原生/无桥返回不存在
export async function partialInfo(fileName) {
  const P = await getUpdateBridge()
  if (!P) return { exists: false, bytes: 0 }
  try {
    const r = await P.partialInfo({ fileName })
    return { exists: !!r?.exists, bytes: Number(r?.bytes) || 0 }
  } catch {
    return { exists: false, bytes: 0 }
  }
}

// 删除已下载文件（SHA-256 校验失败后清理损坏包；native 侧带路径穿越防护）
export async function removeDownloadedFile(path) {
  const P = await getUpdateBridge()
  if (!P || !path) return false
  try {
    const r = await P.removeFile({ path })
    return r?.deleted !== false
  } catch {
    return false
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
