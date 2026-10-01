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

  // 玻璃总开关：启动/开启时分两级上屏——先铺 tint（首帧极轻、可立刻交互），
  // 两帧后再挂 backdrop-filter（错开大面积模糊光栅化的启动峰值，期间背景仍在 .2s 淡入）。
  // setTimeout 是隐藏窗口等 rAF 不推进环境下的兜底。
  useEffect(() => {
    const el = document.documentElement
    el.dataset.glass = s.glassOn ? 'on' : 'off'
    if (!s.glassOn) {
      delete el.dataset.gboot
      return undefined
    }
    el.dataset.gboot = '1'
    let raf2 = 0
    const done = () => { delete el.dataset.gboot }
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(done) })
    const timer = setTimeout(done, 150)
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); clearTimeout(timer) }
  }, [s.glassOn])

  // 模糊度变量（拖动时只改 CSS 变量，成本极低）
  // --glass-blur 带 px 供模糊半径用；--glass-blur-n 无单位供 veil 浓度做数字运算
  useEffect(() => {
    const el = document.documentElement
    const n = Number(s.glassBlur ?? 16)
    el.style.setProperty('--glass-blur', `${n}px`)
    el.style.setProperty('--glass-blur-n', String(n))
  }, [s.glassBlur])

  // 按压缩放开关（震动强度由 App.jsx 按 vibrateLevel 处理）
  useEffect(() => {
    const el = document.documentElement
    el.dataset.tap = s.tapScale === false ? 'off' : 'on'
  }, [s.tapScale])

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
          <i key={i} className={`bd-glow g${i % 4}`} style={{ '--glow': c }} />
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
// v1.6.8 发现页功能图标图片（IndexedDB 'discicon_<key>'，settings.discIconAt 驱动刷新）
export function useDiscIconImgs(keys) {
  const { state } = useStore()
  const at = state.settings.discIconAt || {}
  const urls = {}
  for (const k of keys) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    urls[k] = useAssetUrl(at[k], `discicon_${k}`)
  }
  return urls
}

// v1.6.9 账本图标：单账本 hook（不可对账本数组循环调用——hooks 数量须恒定）
export function useBookIconUrl(ledgerId) {
  const { state } = useStore()
  return useAssetUrl((state.settings.bookIconAt || {})[ledgerId], `bookicon_${ledgerId}`)
}

// 账本图标展示组件：自定义图片优先，回落 emoji（图片/emoji 同尺寸类）
export function BookIconImg({ ledgerId, icon, className = '' }) {
  const url = useBookIconUrl(ledgerId)
  if (url) return <img className={className} src={url} alt="" decoding="async" draggable={false} />
  return <span className={className}>{icon || '📒'}</span>
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
      // v1.6.8 发现页功能图标：接受任意背景图片（不做白底拦截），144×144 居中裁切
      async saveDiscIcon(key, file) {
        const blob = await fileToJpeg(file, { maxSize: 144, quality: 0.88, cover: true })
        const at = new Date().toISOString()
        await replaceBlob(`discicon_${key}`, blob)
        set((d) => {
          if (!d.settings.discIconAt || typeof d.settings.discIconAt !== 'object') d.settings.discIconAt = {}
          d.settings.discIconAt[key] = at
        })
      },
      async clearDiscIcon(key) {
        await replaceBlob(`discicon_${key}`, null)
        set((d) => {
          if (d.settings.discIconAt?.[key]) d.settings.discIconAt[key] = null
        })
      },
      // v1.6.9 账本图标：接受任意背景图片，128×128 居中裁切（每个账本独立）
      async saveBookIcon(id, file) {
        const blob = await fileToJpeg(file, { maxSize: 128, quality: 0.88, cover: true })
        const at = new Date().toISOString()
        await replaceBlob(`bookicon_${id}`, blob)
        set((d) => {
          if (!d.settings.bookIconAt || typeof d.settings.bookIconAt !== 'object') d.settings.bookIconAt = {}
          d.settings.bookIconAt[id] = at
        })
      },
      async clearBookIcon(id) {
        await replaceBlob(`bookicon_${id}`, null)
        set((d) => {
          if (d.settings.bookIconAt?.[id]) d.settings.bookIconAt[id] = null
        })
      },
    }),
    [set],
  )
}
