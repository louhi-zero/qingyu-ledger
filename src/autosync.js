/* v1.10.0 账单自动同步：登录（配置 WebDAV）后自动导入 + 数据变化自动双向上传
 *
 * 与手动「立即同步」共用同一套三向合并（sync.js syncOnce），差异只在触发方式与反馈：
 *   - 冷启动 8s：已配置则静默跑一次（换机场景：本机空库 + 云端有数据 → restore 模式直接导入）
 *   - 数据变化后 3s 防抖：账单/账户/设置等变化自动双向同步（store.jsx 订阅式触发，签名不变不触发）
 *   - 测试连接成功：视为「登录」，立即自动导入/上传一次（用户可见 toast）
 *
 * 防循环：restoreState 写回内容若与本机一致，签名不变 → 订阅不再触发；
 *   远端有新数据时最多「回声」一轮（合并结果再 PUT 一次）后两端一致收敛。
 * 防重入：busy 期间的新触发只记补跑标志，当前轮结束后 1.5s 补跑一次（调用方 store.jsx 负责）。
 */
import { WebDavTransport } from './webdav.js'
import { syncOnce, deepClone } from './sync.js'
import { syncAssets } from './assetsync.js'
import { getWebdavCfg, getDeviceId, syncProfileArchive } from './userarchive.js'
import { APP_VERSION } from './update.js'

export const LS_BASE = 'qingyu_sync_base_v1'
export const LS_LAST = 'qingyu_sync_last_v1'

export function readLS(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback } catch { return fallback }
}
export function writeLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 配额 */ }
}

// 最近一次自动/手动同步记录：{ at, mode, conflicts, detail, error: {at,message}|null }
export function readSyncLast() {
  return readLS(LS_LAST, null)
}

// 头像/壁纸资产推拉；结果归并进 data（assetsMeta + settings.*At），
// 失败不阻断账单同步，仅把提示语带回。调用方需在归并后再 restoreState/writeLS。
export async function pullPushAssets(transport, data) {
  try {
    const r = await syncAssets(transport, data.assetsMeta)
    data.assetsMeta = r.meta
    if (r.pulled.includes('avatar')) data.settings.avatarPhotoAt = r.meta.avatar.at
    if (r.pulled.includes('wallpaper')) data.settings.wallpaperAt = r.meta.wallpaper.at
    const names = { avatar: '头像', wallpaper: '壁纸' }
    const parts = []
    if (r.pulled.length) parts.push(`已更新${r.pulled.map((k) => names[k]).join('、')}`)
    if (r.pushed.length) parts.push(`已上传${r.pushed.map((k) => names[k]).join('、')}`)
    return parts.length ? `（图片资产：${parts.join('，')}）` : ''
  } catch (e) {
    return `（图片资产同步失败：${e.message}，不影响账单数据）`
  }
}

/**
 * 自动同步一次：未配置跳过；否则 get → 三向合并 → 推拉资产 → 写回本机 → 记录 base/last
 * → 顺带对齐用户资料档案（未变化时 0 请求）。
 * toast 策略：silent=true（冷启动/订阅触发）成功静默、失败只记档；
 *   silent=false（测试连接成功/手动）按同步模式给出可读 toast。
 * 返回 { status: 'skipped'|'ok'|'error', mode?, conflicts?, assetNote?, message? }
 */
export async function runAutoSync({ state, restoreState, toast, silent = true, transport }) {
  const cfg = getWebdavCfg()
  if (!cfg) return { status: 'skipped', reason: 'not-configured' }
  // v1.11.0 用户手动关闭云同步 → 跳过（保留配置但不自动跑，昵称恢复正常显示）
  if (state?.settings?.cloudSyncOff === true) return { status: 'skipped', reason: 'user-disabled' }
  try {
    const t = transport || new WebDavTransport(cfg)
    const remote = await t.get()
    const result = await syncOnce({
      local: deepClone(state),
      base: readLS(LS_BASE, null),
      remoteText: remote ? remote.env : null,
      remoteEtag: remote ? remote.etag : null,
      localDevice: getDeviceId(),
      appVersion: APP_VERSION,
      transport: t,
    })
    // 账单合并完成后再推拉头像/壁纸（失败不阻断），归并进同一份数据后统一落库
    const assetNote = await pullPushAssets(t, result.data)
    if (!restoreState(result.data)) throw new Error('合并后的数据校验失败，已放弃写入')
    writeLS(LS_BASE, result.data)
    writeLS(LS_LAST, {
      at: new Date().toISOString(), mode: result.mode,
      conflicts: result.conflicts.length, detail: result.conflicts, error: null,
    })
    // 资料档案顺带对齐：未变化 0 请求；失败不影响账单同步结果
    try { await syncProfileArchive(result.data, { toast, silent: true }) } catch { /* 忽略 */ }
    if (!silent && toast) {
      const head = result.mode === 'first-upload'
        ? '已连接，本机数据已上传云端'
        : result.mode === 'restore'
          ? '已登录，云端数据已导入本机'
          : result.conflicts.length
            ? `同步完成，发现 ${result.conflicts.length} 处冲突，已保留副本`
            : '同步完成，两端数据一致'
      toast(head + assetNote)
    }
    return { status: 'ok', mode: result.mode, conflicts: result.conflicts.length, assetNote }
  } catch (e) {
    const message = String(e?.message || e)
    writeLS(LS_LAST, { ...readSyncLast(), error: { at: new Date().toISOString(), message } })
    if (!silent && toast) toast('同步失败：' + message, 'err')
    return { status: 'error', message }
  }
}
