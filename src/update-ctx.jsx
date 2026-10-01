/* v1.7.1 应用内更新 · 状态编排与可视化安装组件（安卓模式）
 * - UpdateProvider：启动 2.5s 后自动检查（当天一次）
 *   · 默认发现新版先弹 UpdatePrompt 询问，由用户选择是否更新
 *   · 开启「自动后台下载」后才静默下载；静默的边界只到下载 APK，绝不自动安装
 * - UpdatePrompt：居中可视化组件（更新日志 → 选择更新 → 下载进度 → 校验 → 点击安装）
 * - UpdateFloat：tabbar 上方轻提示（静默下载进度/就绪安装/失败重试）
 * 安装是安卓平台硬约束：系统安装器必须用户点确认，任何应用都无法真正静默安装。
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useStore } from './store.jsx'
import { Switch } from './ui.jsx'
import {
  APP_VERSION, checkForUpdate, downloadApk, cancelApkDownload, installerInfo,
  openInstallPermission, launchInstaller, openReleasePage, getUpdateBridge,
  fetchSha256, markDismissed, dismissedTag,
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
  const infoRef = useRef(null)
  const pathRef = useRef('')
  const progressRef = useRef(0)
  const autoDlRef = useRef(false)
  // v1.7.1：默认询问后再下载（用户自行选择是否更新）；用户显式开启后才静默预下载
  autoDlRef.current = state.settings.updateAutoDl === true

  useEffect(() => { getUpdateBridge().then((b) => setNative(!!b)) }, [])

  // 下载 + SHA-256 校验 + 落 ready；取消静默回 available，其余进 error
  const runDownload = useCallback(async (data) => {
    setStatus('downloading'); setErrorMsg(''); setProgress(0); progressRef.current = 0
    try {
      const res = await downloadApk(data, (pct) => {
        if (pct > progressRef.current) { progressRef.current = pct; setProgress(pct) }
      })
      setProgress(100)
      if (data.sha256Url) {
        setStatus('verifying')
        const expectSha = await fetchSha256(data.sha256Url)
        // 取不到校验文本时降级（老 release/网络问题）：字节数校验已在原生侧完成
        if (expectSha && expectSha !== res.sha256) {
          await cancelApkDownload() // 删除被篡改/不完整文件
          setStatus('error')
          setErrorMsg('安装包完整性校验失败（SHA-256 不一致），文件已删除，请重试')
          return
        }
      }
      pathRef.current = res.path
      setStatus('ready')
    } catch (e) {
      if (e?.message === 'CANCELLED') { setStatus('available'); return }
      setStatus('error')
      setErrorMsg(e?.message === 'BUSY' ? '已有下载任务进行中' : '下载失败，请检查网络后重试')
    }
  }, [])

  // 检查更新。manual=true 来自「关于」页：跳过缓存、打开可视化组件、无新版也给反馈
  const check = useCallback(async ({ manual = false } = {}) => {
    if (manual) { setPromptOpen(true); setStatus('checking'); setErrorMsg('') }
    let data = null
    try {
      data = await checkForUpdate(APP_VERSION, { force: manual })
    } catch { /* checkForUpdate 内部已回落缓存 */ }
    if (!data) {
      if (manual) setStatus('idle')
      return
    }
    setInfo(data); infoRef.current = data
    const bridge = await getUpdateBridge()
    setNative(!!bridge) // 实时刷新平台能力（mount 探测后测试钩子/桥延迟就绪也能纠正）
    // 自动检查命中用户已点「以后再说」的同一版本 → 本次完全静默
    if (!manual && dismissedTag() === data.tag) return
    setStatus('available')
    if (manual) { setPromptOpen(true); return } // 手动检查：可视化呈现，等用户选择
    // 自动检查：仅当用户预先开启「自动后台下载」才静默下载（只下载，不安装）；
    // 否则弹出可视化组件由用户自行选择是否更新
    if (bridge && autoDlRef.current) {
      runDownload(data)
    } else {
      setPromptOpen(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runDownload])

  // 启动后自动检查一次（与公告 2s 错开，避免启动并发请求；无定时器/轮询）
  useEffect(() => {
    const t = setTimeout(() => { check({ manual: false }).catch(() => {}) }, 2500)
    return () => clearTimeout(t)
  }, [check])

  const cancelDownloading = useCallback(async (silent = false) => {
    await cancelApkDownload()
    setStatus('available')
    setProgress(0); progressRef.current = 0
    if (!silent) toast('已取消下载')
  }, [toast])

  // 自动后台下载开关：关闭瞬间若正在下载，立即取消并删文件
  const setAutoDownload = useCallback(async (on) => {
    set((d) => { d.settings.updateAutoDl = on })
    if (!on && status === 'downloading') {
      await cancelApkDownload()
      setStatus('available'); setProgress(0); progressRef.current = 0
      toast('已关闭自动下载，当前任务已取消')
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
    // launched：系统安装器接管，无需 App 内操作
  }, [toast])

  // 「以后再说」：同版本不再自动询问（手动检查仍可看到）；回到 idle，浮卡同步消失
  const dismiss = useCallback(() => {
    if (infoRef.current) markDismissed(infoRef.current.tag)
    setPromptOpen(false)
    setStatus('idle')
  }, [])

  // 仅收起可视化组件：已在下载/就绪时保留任务与浮卡，不写入 dismissed
  const closePrompt = useCallback(() => setPromptOpen(false), [])

  const value = {
    status, info, progress, errorMsg, promptOpen, native,
    openPrompt: () => setPromptOpen(true),
    closePrompt,
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

// ---------- 更新日志极简格式化：去 markdown 标题/粗体符号，按行展示 ----------
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

// ---------- 底部浮卡（仅根级页挂载，子页面不显示）：轻提示，点击进入可视化组件 ----------
export function UpdateFloat() {
  const u = useUpdate()
  if (!u || u.promptOpen) return null
  const { status, info, progress, errorMsg, openPrompt } = u
  if (status === 'idle' || status === 'checking') return null

  let body
  if (status === 'available') {
    body = (
      <>
        <span className="uf-ico">🎉</span>
        <span className="uf-txt"><b>发现新版本 {info.tag}</b><i>点击查看更新内容并选择是否更新</i></span>
        <span className="uf-go">查看</span>
      </>
    )
  } else if (status === 'downloading') {
    body = (
      <>
        <span className="uf-ico">⬇️</span>
        <span className="uf-txt uf-progress">
          <b>后台下载 {info.tag} · {progress}%</b>
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
        <span className="uf-txt"><b>{info.tag} 安装包已就绪</b><i>点击查看并确认安装，数据不会丢失</i></span>
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

  const onClick = () => {
    // 所有状态都进入可视化组件；安装动作只在组件内由用户明确点击触发
    openPrompt()
  }
  return (
    <button className="upd-float" onClick={onClick} type="button">
      {body}
    </button>
  )
}

// ---------- 可视化安装组件（居中卡片）：选择 → 静默下载（仅 APK）→ 用户点击安装 ----------
export function UpdatePrompt() {
  const u = useUpdate()
  if (!u || !u.promptOpen) return null
  const { status, info, progress, errorMsg, closePrompt } = u

  // 下载/校验/就绪阶段允许遮罩收起（浮卡仍在），其余阶段点遮罩同样收起
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

        {info && status !== 'checking' && status !== 'idle' && (
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
                {u.native ? (
                  <button className="btn upd-main upd-main-grad" onClick={u.startDownload}>
                    ⬇️ 立即更新
                  </button>
                ) : (
                  <button className="btn upd-main upd-main-grad" onClick={u.goDownloadPage}>
                    🌐 前往下载页
                  </button>
                )}
                <button className="upd-later" onClick={u.dismiss}>以后再说</button>
                {u.native && (
                  <div className="upd-autodl" onClick={() => u.setAutoDownload(!u.autoDl)}>
                    <Switch on={u.autoDl} onChange={() => u.setAutoDownload(!u.autoDl)} />
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
                  {status === 'verifying' ? '正在校验安装包完整性（SHA-256）…' : '正在静默下载安装包…'}
                </div>
                <div className="muted upd-dlsub">
                  {status === 'verifying' ? '校验通过后才会出现安装按钮' : '只下载安装包，不会自动安装；可最小化到浮卡后台等待'}
                </div>
                <div className="uf-bar uf-bar-lg"><i style={{ width: `${status === 'verifying' ? 100 : progress}%` }} /></div>
                {status === 'downloading' && (
                  <button className="btn ghost" onClick={() => u.cancelDownloading(true)}>取消下载</button>
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

            {status === 'error' && (
              <>
                <div className="sandbox-fail">{errorMsg}</div>
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
