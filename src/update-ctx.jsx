/* v1.11.0 应用内更新 · 完全重构
 * - UpdateProvider：启动 2.5s 自动检查一次 + 运行期每 30min 定期检查（网络节流 1h）+ 手动按需
 * - UpdateCard：设置页内常驻可视化卡片（不是弹窗式），任何状态都展示
 *   · 有新版 → 彩色渐变卡片 + 版本号 + 「立即更新」主按钮
 *   已是最新 → 简洁展示当前版本 + 检查时间 + 手动检查入口
 *   检查中 → 转圈 + 文案
 *   下载中 → 环形进度 + 百分比 + 已下载/总大小
 *   就绪 → 绿色「立即安装」
 *   错误 → 橙红提示（friendlyUpdateError 友好分类）+ 重试
 * - UpdateFloat：tabbar 上方浮卡（后台下载/就绪/失败轻提示）
 * - UpdatePrompt：居中详情弹窗（点击卡片后进入，查看更新日志 + 详细操作）
 *
 * v2.2 重构（断点续传 + 定期检查 + 友好错误）：
 * - 断点续传：进入「可更新」时查询半成品 partialInfo，预置进度并提示「继续下载」；
 *   下载进度由原生 received/total 驱动；换源首个事件直接采用（206 续传进度不回退）
 * - 校验失败真正删除损坏包（removeDownloadedFile，旧版 cancel 路径删不到）
 * - 手动检查失败显示友好错误（不再误报「已是最新版本」）；errorKind 区分检查失败/下载失败
 *
 * 安装是安卓平台硬约束：系统安装器必须用户点确认，任何应用都无法真正静默安装。
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useStore } from './store.jsx'
import { Switch } from './ui.jsx'
import {
  APP_VERSION, checkForUpdate, downloadWithFallback, cancelApkDownload, installerInfo,
  openInstallPermission, launchInstaller, openReleasePage, getUpdateBridge,
  fetchSha256WithFallback, markDismissed, dismissedTag,
  friendlyUpdateError, partialInfo, removeDownloadedFile, PERIODIC_CHECK_MS,
} from './update.js'

const UpdateCtx = createContext(null)
export function useUpdate() {
  return useContext(UpdateCtx)
}

// status: idle | checking | available | downloading | verifying | ready | error
export function UpdateProvider({ children }) {
  const { state, set, toast } = useStore()
  const [status, setStatus] = useState('idle')
  const [info, setInfo] = useState(null)
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [promptOpen, setPromptOpen] = useState(false)
  const [native, setNative] = useState(null)
  const [lastCheckAt, setLastCheckAt] = useState(0)
  const [sourceLabel, setSourceLabel] = useState('')
  // v2.2 断点续传/友好错误状态：errorKind 区分检查失败/下载失败；partial 半成品；received/total 驱动 MB 展示
  const [errorKind, setErrorKind] = useState('') // 'check' | 'download'
  const [partial, setPartial] = useState({ exists: false, bytes: 0 })
  const [receivedBytes, setReceivedBytes] = useState(0)
  const [totalBytes, setTotalBytes] = useState(0)
  const statusRef = useRef('idle')
  statusRef.current = status
  const infoRef = useRef(null)
  const pathRef = useRef('')
  const progressRef = useRef(0)
  const autoDlRef = useRef(false)
  const userCancelRef = useRef(false) // v2.0.2 用户取消出口（与看门狗换源的 CANCELLED 区分）
  const resetNextRef = useRef(false) // v2.2 换源后首个进度事件直接采用（续传进度继续，回落全量则回退）
  autoDlRef.current = state.settings.updateAutoDl === true

  useEffect(() => { getUpdateBridge().then((b) => setNative(!!b)) }, [])

  // v2.2 刷新半成品信息（断点续传提示用）
  const refreshPartial = useCallback(async (data) => {
    try {
      const p = data?.apkName ? await partialInfo(data.apkName) : { exists: false, bytes: 0 }
      setPartial(p)
      return p
    } catch { return { exists: false, bytes: 0 } }
  }, [])

  // v2.0.2 多源下载（加速镜像 → 官方直连，206 断点续传）+ SHA-256 校验 + 落 ready
  const runDownload = useCallback(async (data) => {
    setStatus('downloading'); setErrorMsg(''); setSourceLabel('')
    userCancelRef.current = false
    resetNextRef.current = true
    setReceivedBytes(0); setTotalBytes(0)
    // 断点续传：先把进度预置到已下载比例（原生 206 续传时从断点继续；不支持 Range 的源回落全量）
    const p = await refreshPartial(data)
    const basePct = p.exists && data.size > 0 ? Math.min(99, Math.round((p.bytes / data.size) * 100)) : 0
    progressRef.current = basePct
    setProgress(basePct)
    try {
      const res = await downloadWithFallback(data, (pct, ev) => {
        if (ev) {
          const rb = Number(ev.received) || 0
          const tb = Number(ev.total) || 0
          if (rb > 0) setReceivedBytes(rb)
          if (tb > 0) setTotalBytes(tb)
        }
        if (resetNextRef.current) {
          resetNextRef.current = false // 换源首个事件：直接采用（续传不回退，全量重下则回退到真实进度）
          progressRef.current = pct
          setProgress(pct)
          return
        }
        if (pct > progressRef.current) { progressRef.current = pct; setProgress(pct) }
      }, {
        shouldAbort: () => userCancelRef.current,
        onSource: (_url, viaMirror) => {
          resetNextRef.current = true // 首个进度事件直接采用
          setSourceLabel(viaMirror ? '加速通道' : '官方直连')
        },
      })
      setProgress(100)
      setReceivedBytes(res.bytes || 0)
      if (data.sha256Url) {
        setStatus('verifying')
        const expectSha = await fetchSha256WithFallback(data.sha256Url)
        if (expectSha && expectSha !== res.sha256) {
          // v2.2 损坏包真正删除（旧版 cancel 路径在 resolve 后删不到文件）
          await removeDownloadedFile(res.path)
          setStatus('error'); setErrorKind('download')
          setErrorMsg('安装包完整性校验失败（SHA-256 不一致），损坏文件已删除，请重试')
          return
        }
      }
      pathRef.current = res.path
      setPartial({ exists: false, bytes: 0 })
      setStatus('ready')
    } catch (e) {
      if (e?.message === 'CANCELLED') {
        setStatus('available')
        refreshPartial(infoRef.current)
        return
      }
      // 下载失败保留半成品（原生断点续传），重试自动续传
      setStatus('error'); setErrorKind('download')
      setErrorMsg(friendlyUpdateError(e))
      refreshPartial(infoRef.current)
    }
  }, [refreshPartial])

  // 检查更新。manual=true 来自「关于」页/卡片：跳过缓存并打开详情弹窗（无论有无新版都给可视化反馈）
  const check = useCallback(async ({ manual = false } = {}) => {
    if (statusRef.current === 'checking') return
    if (manual) setPromptOpen(true)
    setStatus('checking'); setErrorMsg(''); setErrorKind('')
    let data = null
    try {
      data = await checkForUpdate(APP_VERSION, { force: manual })
    } catch (e) {
      // v2.2 手动检查失败 → 友好错误提示（不再误报「已是最新版本」）；自动检查失败静默回落缓存
      if (manual) {
        setStatus('error'); setErrorKind('check')
        setErrorMsg(friendlyUpdateError(e))
        return
      }
      data = null
    }
    setLastCheckAt(Date.now())
    if (!data) {
      setStatus('idle')
      return
    }
    setInfo(data); infoRef.current = data
    const bridge = await getUpdateBridge()
    setNative(!!bridge)
    setStatus('available')
    refreshPartial(data) // v2.2 查询半成品：App 重启后已有断点 → 提示「继续下载」
    if (manual) return // 手动检查：弹窗已开着，等用户选择
    // 自动检查：不再自动弹窗（设置卡片即可视化入口）；用户已「以后再说」的版本不静默下载；
    // 仅开启自动下载时静默下载（只下载不安装）
    if (dismissedTag() === data.tag) return
    if (bridge && autoDlRef.current) {
      runDownload(data)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runDownload, refreshPartial])

  // 启动后自动检查一次（与公告 2s 错开）
  useEffect(() => {
    const t = setTimeout(() => { check({ manual: false }).catch(() => {}) }, 2500)
    return () => clearTimeout(t)
  }, [check])

  // v2.2 定期检查：运行期每 PERIODIC_CHECK_MS（30min）检查一次；网络节流仍为 1h（克制轮询）；
  // 下载/校验进行中不打扰
  useEffect(() => {
    const t = setInterval(() => {
      const st = statusRef.current
      if (st === 'downloading' || st === 'verifying' || st === 'checking') return
      check({ manual: false }).catch(() => {})
    }, PERIODIC_CHECK_MS)
    return () => clearInterval(t)
  }, [check])

  const cancelDownloading = useCallback(async (silent = false) => {
    userCancelRef.current = true // v2.0.2 标记用户取消：多源循环不再自动换源
    await cancelApkDownload()
    setStatus('available')
    setProgress(0); progressRef.current = 0
    setSourceLabel('')
    refreshPartial(infoRef.current) // v2.2 半成品保留 → 下次「继续下载」自动续传
    if (!silent) toast('已取消下载，进度已保留')
  }, [toast, refreshPartial])

  const setAutoDownload = useCallback(async (on) => {
    set((d) => { d.settings.updateAutoDl = on })
    if (!on && status === 'downloading') {
      userCancelRef.current = true
      await cancelApkDownload()
      setStatus('available'); setProgress(0); progressRef.current = 0
      setSourceLabel('')
      toast('已关闭自动下载，当前任务已取消（进度已保留）')
    }
  }, [set, status, toast])

  const install = useCallback(async () => {
    const info2 = await installerInfo()
    if (info2 && !info2.canInstall) {
      await openInstallPermission()
      toast('请先允许「安装未知应用」，返回后再点立即安装')
      return
    }
    const r = await launchInstaller(pathRef.current)
    if (r === 'needPermission') {
      await openInstallPermission()
      toast('请先允许「安装未知应用」，返回后再点立即安装')
    } else if (!r) {
      toast('无法启动系统安装器', 'err')
    }
  }, [toast])

  // 「以后再说」：同版本自动检查不再静默下载（卡片仍可见），关闭弹窗与浮卡
  const dismiss = useCallback(() => {
    if (infoRef.current) markDismissed(infoRef.current.tag)
    setPromptOpen(false)
    setStatus('idle')
  }, [])

  const value = {
    status, info, progress, errorMsg, promptOpen, native, lastCheckAt, sourceLabel,
    errorKind, partial, receivedBytes, totalBytes,
    openPrompt: () => setPromptOpen(true),
    closePrompt: () => setPromptOpen(false),
    checkManual: () => check({ manual: true }),
    startDownload: () => infoRef.current && runDownload(infoRef.current),
    cancelDownloading,
    setAutoDownload,
    install,
    dismiss,
    goDownloadPage: () => infoRef.current && openReleasePage(infoRef.current.tag),
    autoDl: state.settings.updateAutoDl === true,
  }
  return <UpdateCtx.Provider value={value}>{children}</UpdateCtx.Provider>
}

// ---------- 小工具 ----------
function tinyMd(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^#{1,6}\s*/, '').replace(/\*\*(.+?)\*\*/g, '$1').trimEnd())
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
}
function fmtSize(bytes) {
  const n = Number(bytes) || 0
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return ''
}
function fmtTime(ts) {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return '' }
}

// ============================================================================
// UpdateCard：设置页内常驻可视化更新卡片（非弹窗式，任何状态都展示）
// ============================================================================
export function UpdateCard({ onClick }) {
  const u = useUpdate()
  if (!u) return null
  const { status, info, progress, errorMsg, lastCheckAt, checkManual, native, errorKind, partial, receivedBytes, totalBytes } = u

  // 卡片主色渐变与图标
  const cardCls = {
    idle: 'upd-card-idle',
    checking: 'upd-card-check',
    available: 'upd-card-new',
    downloading: 'upd-card-dl',
    verifying: 'upd-card-check',
    ready: 'upd-card-ready',
    error: 'upd-card-err',
  }[status] || 'upd-card-idle'

  const icon = {
    idle: '✅',
    checking: '🔍',
    available: '🎉',
    downloading: '⬇️',
    verifying: '🔐',
    ready: '📲',
    error: '⚠️',
  }[status] || '✅'

  const title = {
    idle: '已是最新版本',
    checking: '正在检查更新…',
    available: '发现新版本',
    downloading: '正在下载更新…',
    verifying: '正在校验安装包…',
    ready: '安装包已就绪',
    error: '更新检查失败',
  }[status] || '已是最新版本'

  const sub = (() => {
    if (status === 'available' && info) {
      const resume = partial.exists && partial.bytes > 0 ? ` · 已下载 ${fmtSize(partial.bytes) || Math.round((partial.bytes / (info.size || 1)) * 100) || 0}% 可续传` : ''
      return `${info.tag} · ${fmtSize(info.size) || '点击查看'}${resume}`
    }
    if (status === 'downloading') {
      const got = fmtSize(receivedBytes)
      const all = totalBytes > 0 ? ` / ${fmtSize(totalBytes)}` : ''
      return `${Math.round(progress)}%${got ? ` · ${got}${all}` : ' · 下载中'}`
    }
    if (status === 'verifying') return 'SHA-256 完整性校验'
    if (status === 'ready') return '点击确认安装，数据不会丢失'
    if (status === 'error') return errorMsg || '点击重试'
    if (status === 'idle') {
      const t = fmtTime(lastCheckAt)
      return `v${APP_VERSION}${t ? ` · ${t} 已检查` : ' · 点击手动检查'}`
    }
    return `v${APP_VERSION}`
  })()

  const right = (() => {
    if (status === 'checking') return <div className="upd-card-spin" />
    if (status === 'downloading' || status === 'verifying') {
      const pct = status === 'verifying' ? 100 : progress
      return (
        <div className="upd-card-ring">
          <svg viewBox="0 0 44 44">
            <circle className="ucr-track" cx="22" cy="22" r="18" />
            <circle className="ucr-fill" cx="22" cy="22" r="18"
              strokeDasharray={`${pct * 1.131} 113.1`} />
          </svg>
          <span className="ucr-pct">{status === 'verifying' ? '🔐' : `${Math.round(pct)}%`}</span>
        </div>
      )
    }
    if (status === 'available') return <button className="upd-card-btn" type="button" onClick={(e) => { e.stopPropagation(); onClick && onClick() }}>更新</button>
    if (status === 'ready') return <button className="upd-card-btn upd-card-btn-ok" type="button" onClick={(e) => { e.stopPropagation(); onClick && onClick() }}>安装</button>
    if (status === 'idle') return <button className="upd-card-btn upd-card-btn-ghost" type="button" onClick={(e) => { e.stopPropagation(); checkManual() }}>检查</button>
    if (status === 'error') {
      // v2.2 重试路由：下载失败 → 重新下载（自动断点续传）；检查失败 → 重新检查
      const retry = errorKind === 'download' ? u.startDownload : checkManual
      return <button className="upd-card-btn upd-card-btn-ghost" type="button" onClick={(e) => { e.stopPropagation(); retry() }}>重试</button>
    }
    return <span className="arrow">›</span>
  })()

  return (
    <button
      type="button"
      className={`upd-card ${cardCls}`}
      onClick={() => onClick && onClick()}
      aria-label={`软件更新：${title}`}
    >
      <div className="upd-card-ico">{icon}</div>
      <div className="upd-card-body">
        <div className="upd-card-title">{title}</div>
        <div className="upd-card-sub">{sub}</div>
      </div>
      <div className="upd-card-right">{right}</div>
    </button>
  )
}

// ============================================================================
// UpdateFloat：tabbar 上方轻提示浮卡
// ============================================================================
export function UpdateFloat() {
  const u = useUpdate()
  if (!u || u.promptOpen) return null
  const { status, info, progress, errorMsg, openPrompt } = u
  if (status === 'idle' || status === 'checking' || status === 'available') return null
  // available 状态由卡片承载，浮卡只在下载/校验/就绪/错误时显示

  let body
  if (status === 'downloading') {
    body = (
      <>
        <span className="uf-ico">⬇️</span>
        <span className="uf-txt uf-progress">
          <b>后台下载 {info?.tag || ''} · {progress}%</b>
          <span className="uf-bar"><i style={{ width: `${progress}%` }} /></span>
        </span>
      </>
    )
  } else if (status === 'verifying') {
    body = (
      <>
        <span className="uf-ico">🔐</span>
        <span className="uf-txt"><b>正在校验安装包…</b><i>SHA-256 完整性校验</i></span>
      </>
    )
  } else if (status === 'ready') {
    body = (
      <>
        <span className="uf-ico">✅</span>
        <span className="uf-txt"><b>{info?.tag || ''} 安装包已就绪</b><i>点击查看并确认安装</i></span>
        <span className="uf-go uf-go-ok">去安装</span>
      </>
    )
  } else {
    body = (
      <>
        <span className="uf-ico">⚠️</span>
        <span className="uf-txt"><b>更新下载失败</b><i>{errorMsg || '点击重试'}</i></span>
        <span className="uf-go">重试</span>
      </>
    )
  }

  return (
    <button className="upd-float" onClick={openPrompt} type="button">
      {body}
    </button>
  )
}

// ============================================================================
// UpdatePrompt：居中详情弹窗（从卡片点进去看更新日志 + 详细操作）
// ============================================================================
export function UpdatePrompt() {
  const u = useUpdate()
  if (!u || !u.promptOpen) return null
  const { status, info, progress, errorMsg, closePrompt, native, autoDl, sourceLabel, errorKind, partial, receivedBytes, totalBytes } = u

  const hero = {
    checking: ['🔍', 'upd-hero-check'],
    available: ['🎉', 'upd-hero-new'],
    downloading: ['⬇️', 'upd-hero-dl'],
    verifying: ['🔐', 'upd-hero-check'],
    ready: ['✅', 'upd-hero-ready'],
    error: ['⚠️', 'upd-hero-err'],
    idle: ['✔️', 'upd-hero-ready'],
  }[status] || ['🎉', 'upd-hero-new']
  const [heroEmoji, heroCls] = hero
  const notes = info ? tinyMd(info.notes) : []
  const busy = status === 'downloading' || status === 'verifying'

  return (
    <div className="upd-mask" onClick={(e) => { if (e.target === e.currentTarget) closePrompt() }}>
      <div className="upd-modal" role="dialog" aria-label="软件更新">
        <button className="upd-x" onClick={closePrompt} aria-label="关闭">✕</button>

        <div className={`upd-hero ${heroCls}`}><span>{heroEmoji}</span></div>

        {status === 'checking' && (
          <div className="upd-modal-body upd-center">
            <div className="upd-spin" />
            <div className="muted" style={{ marginTop: 12 }}>正在检查更新…</div>
          </div>
        )}

        {status === 'idle' && (
          <div className="upd-modal-body upd-center">
            <div className="upd-title">已是最新版本</div>
            <div className="muted" style={{ marginTop: 4 }}>当前版本 v{APP_VERSION}</div>
            <button className="btn upd-main" onClick={closePrompt}>好的</button>
          </div>
        )}

        {/* v2.2 检查失败：友好错误 + 重试，不再误报「已是最新版本」；
            条件用 errorKind 而非 !info——上次检查留下的 info 会让弹窗出现空洞头部 */}
        {status === 'error' && errorKind === 'check' && (
          <div className="upd-modal-body upd-center">
            <div className="upd-title">检查更新失败</div>
            <div className="sandbox-fail" style={{ marginTop: 10 }}>{errorMsg}</div>
            <button className="btn upd-main" onClick={u.checkManual}>重试检查</button>
            <button className="upd-later" onClick={closePrompt}>关闭</button>
          </div>
        )}

        {info && status !== 'checking' && status !== 'idle' && errorKind !== 'check' && (
          <div className="upd-modal-body">
            <div className="upd-center" style={{ marginBottom: 12 }}>
              <div className="upd-badge">发现新版本</div>
              <div className="upd-ver">{info.tag}</div>
              <div className="muted upd-meta">
                当前 v{APP_VERSION}
                {info.publishedAt ? ` · ${info.publishedAt}` : ''}
                {fmtSize(info.size) ? ` · ${fmtSize(info.size)}` : ''}
              </div>
            </div>

            {status === 'available' && (
              <>
                <div className="upd-notes">
                  {notes.length ? notes.map((line, i) => (
                    <p key={i} className={/^[一二三四五六七八九十\d]+[.、]/.test(line) || /^【.+】/.test(line) ? 'upd-note-h' : ''}>{line || ' '}</p>
                  )) : <p className="muted">本次更新暂无详细说明。</p>}
                </div>
                {native ? (
                  <>
                    <button className="btn upd-main upd-main-grad" onClick={u.startDownload}>
                      {partial.exists && partial.bytes > 0 ? '⬇️ 继续下载（断点续传）' : '⬇️ 立即更新'}
                    </button>
                    {partial.exists && partial.bytes > 0 && (
                      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                        检测到未完成的下载（{fmtSize(partial.bytes)}），将从断点继续，无需重新下载
                      </div>
                    )}
                  </>
                ) : (
                  <button className="btn upd-main upd-main-grad" onClick={u.goDownloadPage}>
                    🌐 前往下载页
                  </button>
                )}
                <button className="upd-later" onClick={u.dismiss}>以后再说</button>
                {native && (
                  <div className="upd-autodl" onClick={() => u.setAutoDownload(!autoDl)}>
                    <Switch on={autoDl} onChange={() => u.setAutoDownload(!autoDl)} />
                    <span>
                      <b>有新版时自动后台下载</b>
                      <i>仅静默下载安装包，安装仍需你手动确认</i>
                    </span>
                  </div>
                )}
              </>
            )}

            {busy && (
              <div className="upd-dlbox">
                <div className="upd-ring" aria-hidden="true">
                  <svg viewBox="0 0 84 84">
                    <circle className="ur-track" cx="42" cy="42" r="36" />
                    <circle
                      className="ur-fill" cx="42" cy="42" r="36"
                      strokeDasharray={`${(status === 'verifying' ? 100 : progress) * 2.262} 226.2`}
                    />
                  </svg>
                  <span className="ur-pct">{status === 'verifying' ? '🔐' : `${progress}%`}</span>
                </div>
                <div className="upd-dltxt">
                  {status === 'verifying'
                    ? '正在校验安装包完整性（SHA-256）…'
                    : (sourceLabel === '加速通道' ? '正在经加速通道下载安装包…' : '正在下载安装包…')}
                </div>
                <div className="muted upd-dlsub">
                  {status === 'verifying'
                    ? '校验通过后才会出现安装按钮'
                    : `已下载 ${fmtSize(receivedBytes) || '0 KB'}${totalBytes > 0 ? ` / 共 ${fmtSize(totalBytes)}` : ''}；速度慢会自动切换加速通道；中断后重试自动断点续传；只下载不安装，可最小化到浮卡后台等待`}
                </div>
                <div className="uf-bar uf-bar-lg"><i style={{ width: `${status === 'verifying' ? 100 : progress}%` }} /></div>
                {status === 'downloading' && (
                  <button className="btn ghost" onClick={() => u.cancelDownloading(true)}>取消下载（保留进度）</button>
                )}
                {status === 'verifying' && (
                  <button className="upd-later" onClick={closePrompt}>最小化到浮卡</button>
                )}
              </div>
            )}

            {status === 'ready' && (
              <>
                <div className="upd-readyline">安装包已下载并通过完整性校验</div>
                <button className="btn upd-main upd-main-grad" onClick={u.install}>📲 立即安装</button>
                <div className="upd-tip">系统将弹出安装确认界面；签名一致可直接覆盖安装，账本与设置不会丢失。</div>
                <button className="upd-later" onClick={closePrompt}>稍后安装（浮卡保留入口）</button>
              </>
            )}

            {status === 'error' && errorKind === 'download' && (
              <>
                <div className="sandbox-fail">{errorMsg}</div>
                {partial.exists && partial.bytes > 0 && (
                  <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                    已下载 {fmtSize(partial.bytes)}，重新下载将自动断点续传
                  </div>
                )}
                <button className="btn upd-main upd-main-grad" onClick={u.startDownload}>重新下载</button>
                <button className="upd-later" onClick={u.dismiss}>以后再说</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
