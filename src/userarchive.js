/* v1.9.0 用户资料云存档：检测到昵称/头像等个人资料变化才打包上传
 *
 * 与 backup.json 同目录的独立轻量档案 qingyu-profile.json（不干扰全量快照的合并与 ETag 乐观锁）：
 *   { app:'qingyu', kind:'qingyu-user-archive-v1', appVersion, at, deviceId,
 *     data: { nickname, avatar, avatarPhotoAt } }   // 头像照片本体仍由 assetsync 走 qingyu-avatar.jpg
 *
 * 流程（runProfileSync 纯编排，配置/记录/传输均注入，node 可直测）：
 *   收集资料 → 打包 → 上传前校验（类型/昵称非空与长度/头像标记/体积上限）
 *   → 与上次成功上传记录 stableJson 比对 → 未变化 0 请求跳过 → PUT 覆盖 → 成功刷新本机记录
 *
 * 触发（store.jsx 订阅式，零 UI 埋点）：profile 三字段签名变化 → 防抖 2.5s 自动上传；
 *   冷启动 6s 自愈跑一次（补上次失败/漏传，首次为云端建档）。未配置 WebDAV 全程静默跳过。
 * 隐私：档案只含昵称与头像标记，不含任何账单数据；失败原因记录在本机 qingyu_profile_sync_v1。
 */
import { stableJson } from './sync.js'
import { WebDavTransport } from './webdav.js'
import { uid } from './utils.js'
import { APP_VERSION } from './update.js'

export const PROFILE_ARCHIVE_FILE = 'qingyu-profile.json'
export const PROFILE_ARCHIVE_KIND = 'qingyu-user-archive-v1'
export const LS_PROFILE_SYNC = 'qingyu_profile_sync_v1'
const LS_CFG = 'qingyu_sync_cfg_v1'
const LS_DEVICE = 'qingyu_sync_device_v1'
const MAX_ARCHIVE_CHARS = 64 * 1024 // 序列化后字符上限（档案只有三个小字段，超限即异常）

// ---------- 纯函数（node 可测） ----------

// 从 settings 严格挑出属于「用户资料」的字段：新增资料字段只改这里
export function collectProfile(settings) {
  const s = settings || {}
  return {
    nickname: typeof s.nickname === 'string' ? s.nickname : '',
    avatar: typeof s.avatar === 'string' ? s.avatar : '',
    avatarPhotoAt: typeof s.avatarPhotoAt === 'string' || s.avatarPhotoAt === null ? s.avatarPhotoAt : null,
  }
}

// 打包成档案信封
export function buildArchive(profile, deviceId, appVersion, at) {
  return {
    app: 'qingyu',
    kind: PROFILE_ARCHIVE_KIND,
    appVersion: appVersion || '1.0.0',
    at: at || new Date().toISOString(),
    deviceId: String(deviceId || 'unknown'),
    data: { ...collectProfile(profile) },
  }
}

// 上传前校验：通过返回 ''，不通过返回原因（拦截异常包，绝不把坏数据传上云）
export function validateArchive(env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return '档案包不是对象'
  if (env.kind !== PROFILE_ARCHIVE_KIND) return '档案包类型不符'
  if (!env.data || typeof env.data !== 'object' || Array.isArray(env.data)) return '档案缺少数据体'
  const d = env.data
  if (typeof d.nickname !== 'string' || !d.nickname.trim()) return '昵称为空'
  if (d.nickname.length > 32) return '昵称超长（>32 字）'
  if (typeof d.avatar !== 'string') return '头像标记非法'
  if (d.avatarPhotoAt !== null && typeof d.avatarPhotoAt !== 'string') return '头像时间戳非法'
  let chars = 0
  try { chars = JSON.stringify(env).length } catch { return '档案无法序列化' }
  if (chars > MAX_ARCHIVE_CHARS) return `档案超过 ${Math.round(MAX_ARCHIVE_CHARS / 1024)}KB 体积上限`
  return ''
}

// 变更检测：从未上传过 → 上传；与上次成功上传的 data 完全一致 → 跳过
export function shouldUpload(profile, lastRec) {
  if (!lastRec || typeof lastRec !== 'object' || !lastRec.data) return true
  return stableJson(collectProfile(profile)) !== stableJson(lastRec.data)
}

// 解析云端档案文本：合法档案返回 env，脏 JSON/类型不符/校验不过 → null
export function parseProfileArchive(text) {
  try {
    const env = JSON.parse(String(text || ''))
    if (env && env.kind === PROFILE_ARCHIVE_KIND && !validateArchive(env)) return env
    return null
  } catch { return null }
}

// 从合法档案提取可写回 settings 的补丁；非法档案返回 null
export function profilePatch(env) {
  if (!env || validateArchive(env)) return null
  return {
    nickname: env.data.nickname.trim(),
    avatar: env.data.avatar,
    avatarPhotoAt: env.data.avatarPhotoAt,
  }
}

// ---------- 纯编排（不碰 localStorage/DOM，node 可测） ----------
// cfg/lastRec/transport 注入；返回 { status, env?, at?, reason?, message? }
// status: skipped(未配置) | invalid(校验拦截) | unchanged(未变化) | uploaded | error
export async function runProfileSync({ settings, cfg, lastRec, deviceId, appVersion, transport }) {
  if (!cfg || typeof cfg.url !== 'string' || !cfg.url.trim()) {
    return { status: 'skipped', reason: 'not-configured' }
  }
  const profile = collectProfile(settings)
  const env = buildArchive(profile, deviceId, appVersion)
  const invalid = validateArchive(env)
  if (invalid) return { status: 'invalid', reason: invalid }
  if (!shouldUpload(profile, lastRec)) return { status: 'unchanged' }
  try {
    await transport.putFile(PROFILE_ARCHIVE_FILE, JSON.stringify(env), 'application/json;charset=utf-8')
  } catch (e) {
    return { status: 'error', message: String(e?.message || e) }
  }
  return { status: 'uploaded', env, at: env.at }
}

// ---------- 浏览器侧封装 ----------

function readLS(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback } catch { return fallback }
}
function writeLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 配额 */ }
}

// 本机档案记录：{ at, deviceId, data, error: {at,message}|null }
export function readLastProfileSync() {
  return readLS(LS_PROFILE_SYNC, null)
}

// 设备号与云备份共用一个（冲突副本命名、档案来源标注一致）；无则生成并落盘
export function getDeviceId() {
  let id = readLS(LS_DEVICE, null)
  if (!id || typeof id !== 'string' || id.startsWith('"')) { id = uid(); writeLS(LS_DEVICE, id) }
  return id
}

// 已配置 WebDAV（填了文件地址）才启用自动存档
export function getWebdavCfg() {
  const c = readLS(LS_CFG, null)
  return c && typeof c === 'object' && typeof c.url === 'string' && c.url.trim() ? c : null
}

/**
 * 浏览器编排：读配置与上次记录 → runProfileSync → 成功写记录/失败记错误。
 * toast 策略：silent=true（冷启动自愈）全静默；silent=false（资料变化/手动）仅失败弹 err。
 * 返回 runProfileSync 的结果（skipped 时也有值）。
 */
export async function syncProfileArchive(state, { toast, silent } = {}) {
  const cfg = getWebdavCfg()
  // v1.11.0 用户手动关闭云同步 → 跳过（资料也不同步）
  if (state?.settings?.cloudSyncOff === true) {
    return { status: 'skipped', reason: 'user-disabled' }
  }
  let r
  if (!cfg) {
    r = { status: 'skipped', reason: 'not-configured' }
  } else {
    r = await runProfileSync({
      settings: state?.settings,
      cfg,
      lastRec: readLastProfileSync(),
      deviceId: getDeviceId(),
      appVersion: APP_VERSION,
      transport: new WebDavTransport(cfg),
    })
  }
  if (r.status === 'uploaded' && r.env) {
    writeLS(LS_PROFILE_SYNC, { at: r.at, deviceId: r.env.deviceId, data: r.env.data, error: null })
  } else if (r.status === 'error') {
    writeLS(LS_PROFILE_SYNC, { ...readLastProfileSync(), error: { at: new Date().toISOString(), message: r.message } })
    if (!silent && toast) toast('资料云存档失败：' + r.message, 'err')
  } else if (r.status === 'invalid') {
    writeLS(LS_PROFILE_SYNC, { ...readLastProfileSync(), error: { at: new Date().toISOString(), message: r.reason } })
    if (!silent && toast) toast('资料云存档已拦截：' + r.reason, 'err')
  }
  return r
}
