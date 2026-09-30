/* 轻语记账 v1.1 图片资产库
 * 头像/壁纸等二进制只存 IndexedDB，绝不进 localStorage/state，规避 5MB 配额。
 * - db: qingyu_blobs_v1 / store: kv （key: 'avatar' | 'wallpaper'）
 * - 内存 objectURL 缓存，随资产更新主动回收
 * - 图片经 canvas 压缩为 JPEG 后写入；SHA-256 作为同步比对 hash
 */

import { isWhiteBgPixels } from './utils.js'

const DB_NAME = 'qingyu_blobs_v1'
const STORE = 'kv'

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    let req
    try {
      req = indexedDB.open(DB_NAME, 1)
    } catch (e) { reject(e); return }
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx(mode, fn) {
  return openDB().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(STORE, mode)
        const r = fn(t.objectStore(STORE))
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      }),
  )
}

export const blobPut = (key, blob) => tx('readwrite', (s) => s.put(blob, key))
export const blobGet = (key) => tx('readonly', (s) => s.get(key))
export const blobDel = (key) => tx('readwrite', (s) => s.delete(key))

// ---------- objectURL 缓存 ----------
const urlCache = new Map()

export async function getObjectUrl(key) {
  if (urlCache.has(key)) return urlCache.get(key)
  const blob = await blobGet(key)
  if (!blob) return null
  const u = URL.createObjectURL(blob)
  urlCache.set(key, u)
  return u
}

export function revokeObjectUrl(key) {
  const u = urlCache.get(key)
  if (u) {
    URL.revokeObjectURL(u)
    urlCache.delete(key)
  }
}

// 资产被替换/删除时调用：清旧 URL，避免内存泄漏与画面残留
export async function replaceBlob(key, blob) {
  revokeObjectUrl(key)
  if (blob) await blobPut(key, blob)
  else await blobDel(key)
}

// v1.4 OCR：Blob → dataURL（GLM-4V image_url 入参）
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error('读取图片失败'))
    r.readAsDataURL(blob)
  })
}

// ---------- 哈希 ----------
export async function hashBlob(blob) {
  const buf = await blob.arrayBuffer()
  const out = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(out)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------- 图片压缩 ----------
// cover=true：居中裁切为 maxSize×maxSize 正方形（头像 256）
// cover=false：等比缩放到宽不超过 maxSize（壁纸 1440）
// whiteBg=true：头像白底强制校验，四角非近白色直接抛错
export async function fileToJpeg(file, { maxSize = 256, quality = 0.85, cover = false, whiteBg = false } = {}) {
  const bmp = await createImageBitmap(file)
  try {
    let sx = 0
    let sy = 0
    let sw = bmp.width
    let sh = bmp.height
    let cw
    let ch
    if (cover) {
      const side = Math.min(bmp.width, bmp.height)
      sw = sh = side
      sx = (bmp.width - side) / 2
      sy = (bmp.height - side) / 2
      cw = ch = maxSize
    } else {
      const scale = Math.min(1, maxSize / bmp.width)
      cw = Math.max(1, Math.round(bmp.width * scale))
      ch = Math.max(1, Math.round(bmp.height * scale))
    }
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d', { alpha: false })
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, cw, ch)
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, cw, ch)
    if (whiteBg) {
      const px = ctx.getImageData(0, 0, cw, ch)
      if (!isWhiteBgPixels(px.data, cw, ch)) throw new Error('非白底图片，仅支持白底照片')
    }
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('图片压缩失败'))),
        'image/jpeg',
        quality,
      )
    })
  } finally {
    bmp.close?.()
  }
}
