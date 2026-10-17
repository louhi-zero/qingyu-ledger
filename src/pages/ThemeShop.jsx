/* v3.6.6 主题商城：仓库即 CMS 的主题目录（themes.json）+ 三渠道下载应用
 *
 * 主题包当前形态 = 一张壁纸图：
 * - 样例图用 <img> 直显（跨域不受 CORS 限制，三渠道全可用，onError 自动换源）
 * - 「应用」= fetch→blob（CORS 失败自动换下一渠道）→ 复用壁纸管线 saveWallpaper
 * - 渠道链：gitee 国内直连（CORS 拦截时自动跳过）→ jsDelivr CN CDN → GitHub 权威
 * 新增主题 = 仓库放图 + themes.json 加一条，push 即上架，无需发版。
 */
import React, { useEffect, useState } from 'react'
import { TopBar, Empty } from '../ui.jsx'
import { useStore } from '../store.jsx'
import { useNav } from '../App.jsx'
import { useMediaActions } from '../theme.jsx'
import { getCmsJson, parseThemes, themeFileUrls } from '../cms.js'

// 样例图：三源 onError 轮换（display 不受 CORS 限制，哪源连通用哪源）
function ThemePreview({ file }) {
  const urls = themeFileUrls(file)
  const [i, setI] = useState(0)
  if (i >= urls.length) return <div className="tprev tprev-fail">预览不可用</div>
  return <img className="tprev" src={urls[i]} alt="" loading="lazy" onError={() => setI(i + 1)} draggable={false} />
}

export default function ThemeShop() {
  const nav = useNav()
  const { toast } = useStore()
  const media = useMediaActions()
  const [themes, setThemes] = useState(null) // null=加载中，[]=空目录
  const [busyId, setBusyId] = useState('')

  useEffect(() => {
    let alive = true
    getCmsJson('themes.json', { cacheKey: 'qingyu_themes_cache_v1', parse: parseThemes }).then((d) => {
      if (alive) setThemes(d ? d.list : [])
    })
    return () => { alive = false }
  }, [])

  async function applyTheme(t) {
    if (busyId) return
    setBusyId(t.id)
    try {
      let blob = null
      for (const url of themeFileUrls(t.file)) {
        try {
          const ctl = new AbortController()
          const timer = setTimeout(() => ctl.abort(), 15000)
          const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' })
          clearTimeout(timer)
          if (!res.ok) continue
          blob = await res.blob()
          break
        } catch { /* CORS/网络失败 → 下一渠道 */ }
      }
      if (!blob) {
        toast('三个渠道都连不上，请检查网络后重试', 'err')
        return
      }
      const file = new File([blob], t.file.split('/').pop() || 'theme.jpg', { type: blob.type || 'image/jpeg' })
      await media.saveWallpaper(file)
      toast(`已应用「${t.name}」为壁纸`)
    } catch {
      toast('应用失败，请重试', 'err')
    } finally {
      setBusyId('')
    }
  }

  return (
    <>
      <TopBar title="主题商城" onBack={nav.pop} />
      <div className="page-body no-tab">
      {themes === null ? (
        <div className="muted" style={{ textAlign: 'center', padding: '48px 0', fontSize: 13 }}>主题目录加载中…</div>
      ) : themes.length === 0 ? (
        <Empty icon="palette" text="主题目录暂时空空如也，下拉重试">
          <button className="chip" onClick={() => { setThemes(null); getCmsJson('themes.json', { cacheKey: 'qingyu_themes_cache_v1', parse: parseThemes }).then((d) => setThemes(d ? d.list : [])) }}>重新加载</button>
        </Empty>
      ) : (
        <>
          <div className="gtitle" style={{ margin: '4px 16px 10px' }}>主题目录 · 共 {themes.length} 款</div>
          <div className="themeshop-grid" style={{ padding: '0 16px 24px' }}>
            {themes.map((t) => (
              <div className="tcard" key={t.id}>
                <ThemePreview file={t.file} />
                <div className="tbody">
                  <div className="tmeta">
                    <b className="tname">{t.name}</b>
                    <span className="tauthor">{t.author}</span>
                  </div>
                  {t.desc && <div className="tdesc">{t.desc}</div>}
                  <button className="tbtn" disabled={!!busyId} onClick={() => applyTheme(t)}>
                    {busyId === t.id ? '下载应用中…' : '应用为壁纸'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11.5, padding: '0 16px 24px', lineHeight: 1.6 }}>
            主题来自仓库目录（改文件 + push 即上架）。下载自动在 gitee / jsDelivr / GitHub 三渠道间回退；样例图仅作预览，应用后可在「外观与个性化」中随时换回。
          </div>
        </>
      )}
      </div>
    </>
  )
}
