/* v1.7.0 应用内更新 · 状态编排与 UI（安卓模式）
 * - UpdateProvider：启动 2.5s 后自动检查（当天一次），发现新版按开关静默下载，就绪后提示安装
 * - UpdateFloat：tabbar 上方浮卡（发现新版/下载进度/就绪安装/失败重试）
 * - UpdateSheet：更新中心（更新日志、下载/校验/安装状态机、web 端外链兜底、自动下载开关）
 * 安装是安卓平台硬约束：系统安装器必须用户点确认，任何应用都无法真正静默安装。
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useStore } from './store.jsx'
import { Sheet, Switch } from './ui.jsx'
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
  const [sheetOpen, setSheetOpen] = useState(false)
  const [native, setNative] = useState(null)
  const infoRef = useRef(null)
  const pathRef = useRef('')
  const progressRef = useRef(0)
  const autoDlRef = useRef(true)
  autoDlRef.current = state.settings.updateAutoDl !== false

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

  // 检查更新。manual=true 来自「关于」页：跳过缓存、打开 Sheet、无新版 toast
  const check = useCallback(async ({ manual = false } = {}) => {
    if (manual) { setSheetOpen(true); setStatus('checking'); setErrorMsg('') }
    let data = null
    try {
      data = await checkForUpdate(APP_VERSION, { force: manual })
    } catch { /* checkForUpdate 内部已回落缓存 */ }
    if (!data) {
      if (manual) { setStatus('idle'); toast('已是最新版本') }
      return
    }
    setInfo(data); infoRef.current = data
    const bridge = await getUpdateBridge()
    setNative(!!bridge) // 实时刷新平台能力（mount 探测后测试钩子/桥延迟就绪也能纠正）
    // 自动检查命中用户已点「以后再说」的同一版本 → 本次静默，不弹浮卡、不自动下载
    if (!manual && dismissedTag() === data.tag) return
    setStatus('available')
    if (manual) return // 手动场景等用户点按钮
    if (bridge && autoDlRef.current) runDownload(data) // 静默下载；就绪后浮卡提示安装
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

  // 自动下载开关：关闭瞬间若正在下载，立即取消并删文件（对齐 NexBox 竞态处理）
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

  const dismiss = useCallback(() => {
    if (infoRef.current) markDismissed(infoRef.current.tag)
    setSheetOpen(false)
    setStatus('idle')
  }, [])

  const value = {
    status, info, progress, errorMsg, sheetOpen, native,
    openSheet: () => setSheetOpen(true),
    closeSheet: () => setSheetOpen(false),
    checkManual: () => check({ manual: true }),
    startDownload: () => infoRef.current && runDownload(infoRef.current),
    cancelDownloading,
    setAutoDownload,
    install,
    dismiss,
    goDownloadPage: () => infoRef.current && openReleasePage(infoRef.current.tag),
    autoDl: state.settings.updateAutoDl !== false,
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

// ---------- 底部浮卡（仅根级页挂载，子页面不显示） ----------
export function UpdateFloat() {
  const u = useUpdate()
  if (!u || u.sheetOpen) return null
  const { status, info, progress, errorMsg, openSheet } = u
  if (status === 'idle' || status === 'checking') return null

  let body
  if (status === 'available') {
    body = (
      <>
        <span className="uf-ico">🎉</span>
        <span className="uf-txt"><b>发现新版本 {info.tag}</b><i>点击查看更新内容</i></span>
        <span className="uf-go">查看</span>
      </>
    )
  } else if (status === 'downloading') {
    body = (
      <>
        <span className="uf-ico">⬇️</span>
        <span className="uf-txt uf-progress">
          <b>正在下载 {info.tag} · {progress}%</b>
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
        <span className="uf-txt"><b>{info.tag} 已就绪</b><i>点击立即安装，数据不会丢失</i></span>
        <span className="uf-go uf-go-ok">安装</span>
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
    if (status === 'ready') u.install()
    else openSheet() // available/downloading/error 都进 Sheet 看详情（错误重试也在里面）
  }
  return (
    <button className="upd-float" onClick={onClick} type="button">
      {body}
    </button>
  )
}

// ---------- 更新中心 Sheet ----------
export function UpdateSheetCenter() {
  const u = useUpdate()
  if (!u) return null
  const { status, info, progress, errorMsg, sheetOpen, closeSheet } = u

  const notes = info ? tinyMd(info.notes) : []

  return (
    <Sheet open={sheetOpen} onClose={closeSheet} title="软件更新">
      {status === 'checking' && (
        <div className="upd-center-box">
          <div className="upd-spin" />
          <div className="muted" style={{ marginTop: 10 }}>正在检查更新…</div>
        </div>
      )}

      {status !== 'checking' && !info && status === 'idle' && (
        <div className="upd-center-box">
          <div style={{ fontSize: 44 }}>✔️</div>
          <div style={{ fontWeight: 800, marginTop: 8 }}>已是最新版本</div>
          <div className="muted" style={{ marginTop: 4 }}>当前版本 v{APP_VERSION}</div>
          <button className="btn" style={{ marginTop: 16 }} onClick={u.checkManual}>重新检查</button>
        </div>
      )}

      {info && status !== 'checking' && (
        <>
          <div className="upd-head">
            <div className="upd-badge">🎉 新版本</div>
            <div className="upd-ver">{info.tag}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {info.publishedAt ? `${info.publishedAt} · ` : ''}{fmtSize(info.size) || '在线下载'}
            </div>
          </div>

          <div className="upd-notes">
            {notes.length ? notes.map((line, i) => (
              <p key={i} className={/^[一二三四五六七八九十\d]+[.、]/.test(line) || /^【.+】/.test(line) ? 'upd-note-h' : ''}>{line || ' '}</p>
            )) : <p className="muted">本次更新暂无详细说明。</p>}
          </div>

          {/* 状态区 */}
          {status === 'available' && (
            u.native ? (
              <button className="btn" onClick={u.startDownload}>
                ⬇️ 立即下载{!u.autoDl ? '' : '（后台静默进行）'}
              </button>
            ) : (
              <button className="btn" onClick={u.goDownloadPage}>🌐 前往下载页</button>
            )
          )}

          {(status === 'downloading' || status === 'verifying') && (
            <div className="upd-dl">
              <div className="uf-bar uf-bar-lg"><i style={{ width: `${status === 'verifying' ? 100 : progress}%` }} /></div>
              <div className="muted" style={{ textAlign: 'center', marginTop: 8, fontSize: 12.5 }}>
                {status === 'verifying' ? '🔐 正在校验安装包 SHA-256…' : `正在下载 · ${progress}%（只走网络，可后台等待）`}
              </div>
              {status === 'downloading' && (
                <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => u.cancelDownloading(false)}>取消下载</button>
              )}
            </div>
          )}

          {status === 'ready' && (
            <>
              <button className="btn" onClick={u.install}>📲 立即安装</button>
              <div className="muted upd-tip">系统将弹出安装确认界面；签名一致可直接覆盖安装，账本与设置不会丢失。</div>
              <button className="btn ghost" style={{ marginTop: 8 }} onClick={u.startDownload}>重新下载</button>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="sandbox-fail">{errorMsg}</div>
              <button className="btn" style={{ marginTop: 10 }} onClick={u.startDownload}>重试下载</button>
            </>
          )}

          {/* 自动下载开关（浏览器端原生下载不可用，开关无意义则隐藏） */}
          {u.native && (
            <div className="cell" style={{ marginTop: 10 }} onClick={() => u.setAutoDownload(!u.autoDl)}>
              <div className="cico">⚡</div>
              <div className="cmain">
                <div className="ctitle">发现新版自动下载</div>
                <div className="cdesc">仅后台下载不打扰；安装仍需你点确认</div>
              </div>
              <div className="cright">
                <Switch on={u.autoDl} onChange={() => u.setAutoDownload(!u.autoDl)} />
              </div>
            </div>
          )}

          <div className="upd-foot">
            <span>当前 v{APP_VERSION}</span>
            <button className="upd-later" onClick={u.dismiss}>以后再说</button>
          </div>
        </>
      )}
    </Sheet>
  )
}
