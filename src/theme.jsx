/* 轻语记账 v1.1 主题层
 * - html[data-glass=on|off]：玻璃材质总开关（关闭时像素级保持旧外观）
 * - --glass-blur：模糊半径（用户可调）
 * - Backdrop：壁纸 + 明暗遮罩 + 主色晕光（仅玻璃开启时可见）
 * - 头像照片独立 hook（Blob 在 IndexedDB，settings.avatarPhotoAt 驱动刷新）
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useStore } from './store.jsx'
import { getObjectUrl, replaceBlob, fileToJpeg, hashBlob } from './blobdb.js'

const ThemeCtx = createContext({ wallUrl: null, palette: [] })
export const useTheme = () => useContext(ThemeCtx)

// ---------- 壁纸主色提取（40×40 降采样 + 32 级量化分桶） ----------
async function extractPalette(url) {
  const img = new Image()
  img.src = url
  await img.decode()
  const W = 40
  const H = 40
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, W, H)
  const data = ctx.getImageData(0, 0, W, H).data
  const buckets = new Map()
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    if (data[i + 3] < 128) continue
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max < 45 || min > 232) continue // 过暗/过亮不入桶
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`
    const cur = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0, sat: 0 }
    cur.n++
    cur.r += r
    cur.g += g
    cur.b += b
    cur.sat += max - min
    buckets.set(key, cur)
  }
  const colors = [...buckets.values()]
    .filter((x) => x.sat / x.n > 22)
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .map((x) => `rgb(${Math.round(x.r / x.n)},${Math.round(x.g / x.n)},${Math.round(x.b / x.n)})`)
  return colors
}

const FALLBACK_GLOWS = ['#13b5a1', '#42a5f5']

export function ThemeProvider({ children }) {
  const { state } = useStore()
  const s = state.settings
  const [wallUrl, setWallUrl] = useState(null)
  const [palette, setPalette] = useState([])

  // 玻璃开关与模糊度 + 点击反馈开关
  useEffect(() => {
    const el = document.documentElement
    el.dataset.glass = s.glassOn ? 'on' : 'off'
    el.style.setProperty('--glass-blur', `${s.glassBlur ?? 16}px`)
    el.dataset.tap = s.tapFeedback === false ? 'off' : 'on'
  }, [s.glassOn, s.glassBlur, s.tapFeedback])

  // 壁纸：avatarPhotoAt 同理，wallpaperAt 变化时重新取 objectURL
  useEffect(() => {
    let alive = true
    if (!s.wallpaperAt) {
      setWallUrl(null)
      setPalette([])
      return
    }
    getObjectUrl('wallpaper')
      .then(async (u) => {
        if (!alive) return
        setWallUrl(u)
        if (!u) return
        try {
          const p = await extractPalette(u)
          if (alive) setPalette(p)
        } catch { /* 主色提取失败不影响功能 */ }
      })
      .catch(() => {})
    return () => { alive = false }
  }, [s.wallpaperAt])

  return (
    <ThemeCtx.Provider value={{ wallUrl, palette }}>
      {children}
    </ThemeCtx.Provider>
  )
}

// ---------- 背景层（挂在 .phone 内） ----------
export function Backdrop() {
  const { wallUrl, palette } = useTheme()
  const glows = palette.length ? palette : FALLBACK_GLOWS
  return (
    <div className="backdrop" aria-hidden="true">
      {wallUrl && <img className="bd-img" src={wallUrl} alt="" decoding="async" draggable={false} />}
      <div className="bd-veil" />
      <div className="bd-glows">
        {glows.map((c, i) => (
          <i key={i} className={`bd-glow g${i % 4}`} style={{ background: c }} />
        ))}
      </div>
    </div>
  )
}

// ---------- 图片资产通用 hook（at 变化 → 取 objectURL） ----------
export function useAssetUrl(at, key) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let alive = true
    if (!at) { setUrl(null); return }
    getObjectUrl(key)
      .then((u) => { if (alive) setUrl(u) })
      .catch(() => {})
    return () => { alive = false }
  }, [at, key])
  return url
}

// ---------- 头像照片 ----------
export function useAvatarPhoto() {
  const { state } = useStore()
  return useAssetUrl(state.settings.avatarPhotoAt, 'avatar')
}

// 启动页背景（IndexedDB 'welcomebg'）
export function useWelcomeBg() {
  const { state } = useStore()
  return useAssetUrl(state.settings.welcomeBgAt, 'welcomebg')
}

// AI 助手形象内容：照片优先，否则 emoji
export function useAiFacePhoto() {
  const { state } = useStore()
  return useAssetUrl(state.settings.aiFaceAt, 'aiface')
}

// v1.6 底部菜单图标图片（IndexedDB 'tabicon_<page>'，settings.tabIconAt 驱动刷新）
export function useTabIconImgs() {
  const { state } = useStore()
  const at = state.settings.tabIconAt || {}
  const home = useAssetUrl(at.home, 'tabicon_home')
  const charts = useAssetUrl(at.charts, 'tabicon_charts')
  const discover = useAssetUrl(at.discover, 'tabicon_discover')
  const profile = useAssetUrl(at.profile, 'tabicon_profile')
  return { home, charts, discover, profile }
}
export function AiFace({ className = '', style }) {
  const { state } = useStore()
  const url = useAiFacePhoto()
  if (url) return <img className={`ai-face-img ${className}`} src={url} alt="AI 助手" style={style} draggable={false} />
  return <span className={className} style={style}>{state.settings.aiFace || '🤖'}</span>
}

// 头像内容：照片优先，否则 emoji
export function AvatarFace() {
  const { state } = useStore()
  const url = useAvatarPhoto()
  if (url) return <img className="avatar-img" src={url} alt="头像" draggable={false} />
  return <>{state.settings.avatar}</>
}

// ---------- 头像/壁纸写入动作（压缩 → IDB → state 元数据） ----------
export function useMediaActions() {
  const { set } = useStore()
  return useMemo(
    () => ({
      async saveAvatarPhoto(file) {
        // v1.6 头像支持任意背景颜色图片（自动居中裁切为 256×256 方形）
        const blob = await fileToJpeg(file, { maxSize: 256, quality: 0.85, cover: true })
        const hash = await hashBlob(blob)
        const at = new Date().toISOString()
        await replaceBlob('avatar', blob)
        set((d) => {
          d.settings.avatarPhotoAt = at
          d.assetsMeta.avatar = { at, hash }
        })
      },
      async clearAvatarPhoto() {
        await replaceBlob('avatar', null)
        set((d) => {
          d.settings.avatarPhotoAt = null
          d.assetsMeta.avatar = { at: null, hash: null }
        })
      },
      async saveWallpaper(file) {
        const blob = await fileToJpeg(file, { maxSize: 1440, quality: 0.82, cover: false })
        const hash = await hashBlob(blob)
        const at = new Date().toISOString()
        await replaceBlob('wallpaper', blob)
        set((d) => {
          d.settings.wallpaperAt = at
          d.assetsMeta.wallpaper = { at, hash }
        })
      },
      async clearWallpaper() {
        await replaceBlob('wallpaper', null)
        set((d) => {
          d.settings.wallpaperAt = null
          d.assetsMeta.wallpaper = { at: null, hash: null }
        })
      },
      async saveWelcomeBg(file) {
        const blob = await fileToJpeg(file, { maxSize: 1080, quality: 0.8, cover: false })
        const hash = await hashBlob(blob)
        const at = new Date().toISOString()
        await replaceBlob('welcomebg', blob)
        set((d) => {
          d.settings.welcomeBgAt = at
          d.assetsMeta.welcomebg = { at, hash }
        })
      },
      async clearWelcomeBg() {
        await replaceBlob('welcomebg', null)
        set((d) => {
          d.settings.welcomeBgAt = null
          d.assetsMeta.welcomebg = { at: null, hash: null }
        })
      },
      async saveAiFace(file) {
        const blob = await fileToJpeg(file, { maxSize: 256, quality: 0.85, cover: true })
        const hash = await hashBlob(blob)
        const at = new Date().toISOString()
        await replaceBlob('aiface', blob)
        set((d) => {
          d.settings.aiFaceAt = at
          d.assetsMeta.aiface = { at, hash }
        })
      },
      async clearAiFace() {
        await replaceBlob('aiface', null)
        set((d) => {
          d.settings.aiFaceAt = null
          d.assetsMeta.aiface = { at: null, hash: null }
        })
      },
      // v1.6 底部菜单图标图片：严格白底校验（四角非近白直接抛错），96×96 居中裁切
      async saveTabIcon(page, file) {
        const blob = await fileToJpeg(file, { maxSize: 96, quality: 0.9, cover: true, whiteBg: true })
        const at = new Date().toISOString()
        await replaceBlob(`tabicon_${page}`, blob)
        set((d) => {
          if (!d.settings.tabIconAt || typeof d.settings.tabIconAt !== 'object') d.settings.tabIconAt = {}
          d.settings.tabIconAt[page] = at
        })
      },
      async clearTabIcon(page) {
        await replaceBlob(`tabicon_${page}`, null)
        set((d) => {
          if (d.settings.tabIconAt?.[page]) d.settings.tabIconAt[page] = null
        })
      },
    }),
    [set],
  )
}
