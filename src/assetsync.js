/* 轻语记账 v1.1 图片资产 WebDAV 同步
 *
 * 与 backup.json 同目录三个固定文件：
 *   qingyu-avatar.jpg / qingyu-wallpaper.jpg / qingyu-assets.json
 * 规则：
 * - 元数据 {avatar:{at,hash},wallpaper:{at,hash}}，at 为 ISO 时间戳
 * - 二进制按 at 做 LWW（同戳本机优先，保证确定性）；hash 相同只补元数据、不传图
 * - 先完成 blob 推拉，最后再 PUT 元数据：对端拿到 meta 时图片必已就绪
 * - 任何失败向上抛出，由调用方决定是否阻断账单主流程（账单同步不阻断，仅提示）
 */
import { blobGet, replaceBlob } from './blobdb.js'

export const ASSET_DEFS = {
  avatar: { file: 'qingyu-avatar.jpg', mime: 'image/jpeg' },
  wallpaper: { file: 'qingyu-wallpaper.jpg', mime: 'image/jpeg' },
}
export const ASSET_META_FILE = 'qingyu-assets.json'
const KEYS = Object.keys(ASSET_DEFS)

// 只接受形状合法的条目，其余一律视为“无”
function entry(meta, key) {
  const e = meta?.[key]
  return e && typeof e.at === 'string' && e.at && typeof e.hash === 'string' && e.hash
    ? { at: e.at, hash: e.hash }
    : null
}

// 时间戳 LWW；相等时本机优先
function lww(local, remote) {
  if (!local) return remote
  if (!remote) return local
  return local.at >= remote.at ? local : remote
}

// 拉取云端元数据；404 与损坏 JSON 都视为空
async function loadRemoteMeta(transport) {
  const raw = await transport.getFile(ASSET_META_FILE, false)
  if (!raw) return { meta: null, exists: false }
  try {
    const parsed = JSON.parse(raw)
    return { meta: parsed && typeof parsed === 'object' ? parsed : null, exists: true }
  } catch {
    return { meta: null, exists: false }
  }
}

/**
 * 资产双向同步
 * @param {WebDavTransport} transport 已配置好（URL 指向 backup.json）
 * @param {object|null} localMeta 本机 state.assetsMeta
 * @returns {Promise<{meta:object, pulled:string[], pushed:string[]}>}
 */
export async function syncAssets(transport, localMeta) {
  const { meta: remoteMeta, exists: metaExists } = await loadRemoteMeta(transport)

  const pulled = []
  const pushed = []
  const merged = {}

  for (const key of KEYS) {
    const def = ASSET_DEFS[key]
    const lo = entry(localMeta, key)
    const re = entry(remoteMeta, key)
    const win = lww(lo, re)
    merged[key] = win || { at: null, hash: null }
    if (!win) continue

    if (lo && (!re || lo.at >= re.at) && lo.hash !== re?.hash) {
      // 本机较新（或云端缺图）：上传本机 blob
      const blob = await blobGet(key)
      if (blob) {
        await transport.putFile(def.file, blob, def.mime)
        pushed.push(key)
      }
    } else if (re && (!lo || re.at > lo.at) && re.hash !== lo?.hash) {
      // 云端较新：下载并替换本机 blob（replaceBlob 会回收旧 objectURL）
      const buf = await transport.getFile(def.file, true)
      if (buf && buf.byteLength) {
        await replaceBlob(key, new Blob([buf], { type: def.mime }))
        pulled.push(key)
      }
    }
  }

  // 有推送、或云端还没有元数据文件时才写，减少无谓请求
  if (pushed.length || !metaExists) {
    await transport.putFile(ASSET_META_FILE, JSON.stringify(merged), 'application/json;charset=utf-8')
  }

  return { meta: merged, pulled, pushed }
}
