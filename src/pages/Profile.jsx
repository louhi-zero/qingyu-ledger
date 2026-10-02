import React, { useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { useNav } from '../App.jsx'
import { Sheet, Confirm, Switch } from '../ui.jsx'
import { AvatarFace, useMediaActions, useTheme } from '../theme.jsx'
import { useUpdate } from '../update-ctx.jsx'
import { APP_VERSION } from '../update.js'
import { getWebdavCfg } from '../userarchive.js'
import { bookkeepingDays, streakOf, txsOfLedger } from '../utils.js'

const JGY_LOGIN_URL = 'https://www.jianguoyun.com/d/login'

export default function Profile() {
  const { state, set, toast } = useStore()
  const nav = useNav()
  const upd = useUpdate()
  const media = useMediaActions()
  const avatarFileRef = useRef(null)
  const [nameOpen, setNameOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [fbOpen, setFbOpen] = useState(false)
  const [fbText, setFbText] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(state.settings.nickname)

  const pickAvatarPhoto = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      await media.saveAvatarPhoto(file)
      toast('头像照片已更新')
      setAvatarOpen(false)
    } catch {
      toast('图片读取失败，请换一张试试', 'err')
    } finally {
      setBusy(false)
    }
  }

  const totalTx = txsOfLedger(state).length
  const days = bookkeepingDays(state)
  const streak = streakOf(state.checkins || [])
  const checkedToday = (state.checkins || []).includes(new Date().toLocaleDateString('sv'))
  // v1.11.0 登录态判定：配置了坚果云（cloudReady）且用户没关同步 → 视为登录
  const cloudReady = !!getWebdavCfg()
  const syncOff = state.settings.cloudSyncOff === true
  const loggedIn = cloudReady && !syncOff
  const displayName = loggedIn ? state.settings.nickname : '未登录'
  const onAvatarClick = () => (loggedIn ? setAvatarOpen(true) : setLoginOpen(true))
  // v2.0.1 未登录点昵称 → 登录引导（不再直达改名）；改名保留在引导 Sheet 的次级入口
  const onNameClick = () => (loggedIn ? (setName(state.settings.nickname), setNameOpen(true)) : setLoginOpen(true))
  const openRename = () => {
    setLoginOpen(false)
    setName(state.settings.nickname)
    setNameOpen(true)
  }
  // v1.5 头部晕光：壁纸主色优先，无壁纸时退回品牌渐变色
  const { palette } = useTheme()
  const headGlows = palette.length ? palette : ['#5b8cff', '#7a6bff', '#42a5f5']

  const punch = () => {
    const today = new Date().toLocaleDateString('sv')
    set((d) => {
      if (d.checkins.includes(today)) return
      d.checkins.push(today)
    })
    toast('打卡成功，坚持就是胜利 ✊')
  }

  const saveName = () => {
    const n = name.trim()
    if (!n) { toast('昵称不能为空', 'err'); return }
    set((d) => { d.settings.nickname = n })
    setNameOpen(false)
    toast('昵称已保存')
  }

  return (
    <>
      <div className="page-body">
        <div className="me-head">
          <div className="mh-glows" aria-hidden="true">
            {headGlows.slice(0, 3).map((c, i) => (
              <i key={i} className={`mh-glow mh${i}`} style={{ background: c }} />
            ))}
          </div>
          <div className="me-row">
            <div className="avatar-wrap" onClick={onAvatarClick}>
              <div className="avatar"><AvatarFace /></div>
              <span className="cam" aria-hidden="true">📷</span>
            </div>
            <div className="me-id" style={{ flex: 1, minWidth: 0 }}>
              <div className="me-name" onClick={onNameClick}>
                <span className="me-name-txt">{displayName}</span>
                <span className="me-edit">✏️</span>
              </div>
              {/* v1.11.0 云状态徽标：未登录（未配置坚果云或手动关闭同步）时可见，点击直达登录引导 */}
              <div className="me-tags">
                <span className="me-badge">🔥 已坚持 {days} 天</span>
                {!loggedIn && (
                  <button type="button" className="me-cloud" aria-label="坚果云未登录，点击登录" onClick={() => setLoginOpen(true)}>
                    ☁️ 未登录
                  </button>
                )}
              </div>
            </div>
            <button className={`punch ${checkedToday ? 'done' : ''}`} onClick={punch} disabled={checkedToday}>
              {checkedToday ? `🔥 连击 ${streak} 天` : '📋 打卡'}
            </button>
          </div>
          <div className="me-stats">
            <div className="ms"><div className="v">{days}<i>天</i></div><div className="k">记账天数</div></div>
            <div className="ms"><div className="v">{totalTx}<i>笔</i></div><div className="k">记账笔数</div></div>
            <div className="ms"><div className="v">{streak}<i>天</i></div><div className="k">连续打卡</div></div>
          </div>
        </div>

        <div className="group">
          <div className="gtitle">记账</div>
          <div className="cell" onClick={() => nav.push({ page: 'ledgers' })}>
            <div className="cico c-amber">📒</div>
            <div className="cmain"><div className="ctitle">我的账本</div><div className="cdesc">{state.ledgers.length} 个账本</div></div>
            <div className="cright arrow">›</div>
          </div>
          <div className="cell" onClick={() => nav.push({ page: 'recurring' })}>
            <div className="cico c-teal">🔁</div>
            <div className="cmain"><div className="ctitle">周期记账</div><div className="cdesc">工资房租这类固定收支自动入账</div></div>
            <div className="cright arrow">›</div>
          </div>
          <div className="cell" onClick={() => nav.push({ page: 'import' })}>
            <div className="cico c-blue">📥</div>
            <div className="cmain"><div className="ctitle">账单导入</div><div className="cdesc">支付宝 / 微信账单，导入自动去重</div></div>
            <div className="cright arrow">›</div>
          </div>
        </div>

        <div className="group">
          <div className="gtitle">通用</div>
          <div className="cell" onClick={() => nav.push({ page: 'settings' })}>
            <div className="cico c-violet">⚙️</div>
            <div className="cmain"><div className="ctitle">设置</div><div className="cdesc">外观 · 记账偏好 · 数据与安全</div></div>
            <div className="cright arrow">›</div>
          </div>
          <div className="cell" onClick={() => setFbOpen(true)}>
            <div className="cico c-green">💬</div>
            <div className="cmain"><div className="ctitle">意见反馈</div><div className="cdesc">说说你的建议或遇到的问题</div></div>
            <div className="cright arrow">›</div>
          </div>
          <div className="cell" onClick={() => setAboutOpen(true)}>
            <div className="cico c-rose">ℹ️</div>
            <div className="cmain"><div className="ctitle">关于轻语记账</div><div className="cdesc">版本信息与产品理念</div></div>
            <div className="cright arrow">›</div>
          </div>
        </div>

        <div className="ver-foot">轻语记账 v{APP_VERSION} · GPL-3.0 · 全功能免费</div>
      </div>

      {/* 改名 */}
      <Sheet open={nameOpen} onClose={() => setNameOpen(false)} title="修改昵称">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={12} placeholder="想被怎么称呼？" />
        <button className="btn" style={{ marginTop: 12 }} onClick={saveName}>保存修改</button>
      </Sheet>

      {/* v1.10.0 未登录（未配置坚果云）点头像 → 登录引导：先去官网登录拿账号，再回应用内配置 */}
      <Sheet open={loginOpen} onClose={() => setLoginOpen(false)} title="登录坚果云">
        <div className="center-box" style={{ padding: '6px 0 12px' }}>
          <div style={{ fontSize: 52 }}>☁️</div>
          <div style={{ fontSize: 16, fontWeight: 800, marginTop: 8 }}>同步账单，换机不丢数据</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.8 }}>
            登录坚果云后，账单与个人资料自动双向同步<br />数据存你自己的网盘，隐私无忧
          </div>
        </div>
        <button className="btn" onClick={() => window.open(JGY_LOGIN_URL, '_blank')}>🌐 打开坚果云登录页</button>
        <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => { setLoginOpen(false); nav.push({ page: 'cloud' }) }}>
          已有账号？去应用内配置
        </button>
        {/* v2.0.1 未登录也想先起昵称：引导 Sheet 保留改名次级入口 */}
        <button className="upd-later" style={{ marginTop: 6 }} onClick={openRename}>暂不登录，先改个昵称</button>
      </Sheet>

      {/* 换头像（v1.6 支持任意背景颜色图片） */}
      <Sheet open={avatarOpen} onClose={() => setAvatarOpen(false)} title="换个形象">
        <div className="center-box" style={{ padding: '6px 0 12px' }}>
          <div className="avatar" style={{ width: 72, height: 72, fontSize: 34 }}>
            <AvatarFace />
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            支持任意背景颜色的图片，自动居中裁切为方形
          </div>
        </div>
        <button className="btn" disabled={busy} onClick={() => avatarFileRef.current?.click()}>
          {busy ? '处理中…' : '📷 选择图片'}
        </button>
        {state.settings.avatarPhotoAt && (
          <button className="btn ghost" style={{ marginTop: 10 }} disabled={busy} onClick={async () => {
            await media.clearAvatarPhoto()
            toast('已移除头像照片')
          }}>移除照片，恢复默认</button>
        )}
        <input
          ref={avatarFileRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) pickAvatarPhoto(f); e.target.value = '' }}
        />
      </Sheet>

      {/* 关于 */}
      <Sheet open={aboutOpen} onClose={() => setAboutOpen(false)} title="关于">
        <div className="center-box" style={{ padding: '10px 0' }}>
          <div style={{ fontSize: 52 }}>📖</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 8 }}>轻语记账</div>
          <div className="muted">v{APP_VERSION} · 全功能免费</div>
        </div>
        <div className="card" style={{ background: 'var(--card2)', boxShadow: 'none' }}>
          <div style={{ fontSize: 13, lineHeight: 2 }}>
            🌿 极简流程，三秒记完一笔账<br />
            🔒 数据默认仅存本机，可自选同步到你的坚果云<br />
            📊 清晰图表，快速看清钱花在哪<br />
            🎯 预算预警，帮你管住手<br />
            🔁 周期记账 · 账单导入 · 消费点评<br />
            💡 记账虽不能直接实现财务自由，但坚持记、不断改善，一定可以。
          </div>
        </div>

        {/* v1.7.1 应用内更新：手动检查 + 自动后台下载开关（静默仅限下载，安装必由用户确认） */}
        <button className="btn" style={{ marginTop: 4 }} onClick={upd?.checkManual}>
          {upd?.status === 'checking' ? '检查中…' : '检查更新'}
        </button>
        {upd?.native && (
          <div className="cell" style={{ marginTop: 10 }} onClick={() => upd.setAutoDownload(!upd.autoDl)}>
            <div className="cico">⚡</div>
            <div className="cmain">
              <div className="ctitle">发现新版自动后台下载</div>
              <div className="cdesc">仅静默下载安装包，是否安装仍由你决定</div>
            </div>
            <div className="cright">
              <Switch on={upd.autoDl} onChange={() => upd.setAutoDownload(!upd.autoDl)} />
            </div>
          </div>
        )}
      </Sheet>

      {/* 反馈 */}
      <Sheet open={fbOpen} onClose={() => setFbOpen(false)} title="意见反馈">
        <textarea className="input" value={fbText} onChange={(e) => setFbText(e.target.value)} placeholder="说说你的建议或遇到的问题（仅保存在本机）" />
        <button className="btn" style={{ marginTop: 12 }} onClick={() => {
          if (!fbText.trim()) { toast('写点什么再提交吧', 'err'); return }
          set((d) => { d.feedbacks.unshift({ text: fbText.trim(), at: new Date().toISOString() }) })
          setFbText('')
          setFbOpen(false)
          toast('已收到你的反馈，感谢支持！')
        }}>提交反馈</button>
        {state.feedbacks?.length > 0 && (
          <>
            <div className="hr" />
            <div className="muted" style={{ marginBottom: 6 }}>历史反馈（{state.feedbacks.length}）</div>
            {state.feedbacks.slice(0, 5).map((f, i) => (
              <div className="tagrow" key={i} style={{ marginBottom: 6 }}>
                <span className="tag">{f.text.slice(0, 20)} · {f.at.slice(0, 10)}</span>
              </div>
            ))}
          </>
        )}
      </Sheet>
    </>
  )
}
