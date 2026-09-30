import React, { useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { useNav } from '../App.jsx'
import { Sheet, Confirm } from '../ui.jsx'
import { AvatarFace, useMediaActions, useTheme } from '../theme.jsx'
import { bookkeepingDays, streakOf, txsOfLedger } from '../utils.js'

export default function Profile() {
  const { state, set, toast } = useStore()
  const nav = useNav()
  const media = useMediaActions()
  const avatarFileRef = useRef(null)
  const [nameOpen, setNameOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
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
      <div className="page-body" style={{ paddingTop: 0 }}>
        <div className="me-head">
          <div className="mh-glows" aria-hidden="true">
            {headGlows.slice(0, 3).map((c, i) => (
              <i key={i} className={`mh-glow mh${i}`} style={{ background: c }} />
            ))}
          </div>
          <div className="me-row">
            <div className="avatar" onClick={() => setAvatarOpen(true)}><AvatarFace /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="me-name" onClick={() => { setName(state.settings.nickname); setNameOpen(true) }}>
                <span className="me-name-txt">{state.settings.nickname}</span>
                <span className="me-edit">✏️</span>
              </div>
              <div className="me-sub">点头像换形象 · 点昵称改名</div>
            </div>
            <button className={`punch ${checkedToday ? 'done' : ''}`} onClick={punch} disabled={checkedToday}>
              {checkedToday ? `🔥 连击 ${streak} 天` : '📋 打卡'}
            </button>
          </div>
          <div className="me-stats">
            <div className="ms"><div className="k">记账天数</div><div className="v">{days}<i>天</i></div></div>
            <div className="ms"><div className="k">记账笔数</div><div className="v">{totalTx}<i>笔</i></div></div>
            <div className="ms"><div className="k">连续打卡</div><div className="v">{streak}<i>天</i></div></div>
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
            <div className="cmain"><div className="ctitle">设置</div></div>
            <div className="cright arrow">›</div>
          </div>
          <div className="cell" onClick={() => setFbOpen(true)}>
            <div className="cico c-green">💬</div>
            <div className="cmain"><div className="ctitle">意见反馈</div></div>
            <div className="cright arrow">›</div>
          </div>
          <div className="cell" onClick={() => setAboutOpen(true)}>
            <div className="cico c-rose">ℹ️</div>
            <div className="cmain"><div className="ctitle">关于轻语记账</div></div>
            <div className="cright arrow">›</div>
          </div>
        </div>
      </div>

      {/* 改名 */}
      <Sheet open={nameOpen} onClose={() => setNameOpen(false)} title="修改昵称">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={12} placeholder="想被怎么称呼？" />
        <button className="btn" style={{ marginTop: 12 }} onClick={saveName}>保存修改</button>
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
          <div className="muted">v1.6.0 · 全功能免费</div>
        </div>
        <div className="card" style={{ background: 'var(--card2)', boxShadow: 'none' }}>
          <div style={{ fontSize: 13, lineHeight: 2 }}>
            🌿 极简流程，三秒记完一笔账<br />
            🔒 所有数据仅存本机，不上传任何服务器<br />
            📊 清晰图表，快速看清钱花在哪<br />
            🎯 预算预警，帮你管住手<br />
            🔁 周期记账 · 账单导入 · 消费点评<br />
            💡 记账虽不能直接实现财务自由，但坚持记、不断改善，一定可以。
          </div>
        </div>
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
