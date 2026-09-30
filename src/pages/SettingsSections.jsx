/* v1.5 设置二级菜单：设置主页只留分组入口，具体修改进各二级子页。
 * 通过 App.jsx SUB_PAGES 注册为 settingsSection，按 params.section 切换：
 *   profile 个人资料 / appearance 外观与个性化 / ai AI 助手
 *   prefs 记账偏好 / notify 提醒与监控 / data 数据与安全
 */
import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { useNav } from '../App.jsx'
import { TopBar, Sheet, Switch, Confirm, Seg, EmojiPicker } from '../ui.jsx'
import { AvatarFace, AiFace, useWelcomeBg, useMediaActions, useTabIconImgs } from '../theme.jsx'
import { DEFAULT_TAB_ICONS } from '../App.jsx'
import { getNotifyCatch, isNotifyListening, openNotifySettings } from '../notifyCatch.js'
import { txsOfLedger, txsToCSV, downloadFile, todayStr, FX_RATES } from '../utils.js'

const FX_CODES = Object.keys(FX_RATES).filter((c) => c !== 'CNY')

const TITLES = {
  profile: '个人资料',
  appearance: '外观与个性化',
  ai: 'AI 助手',
  prefs: '记账偏好',
  notify: '提醒与收支监控',
  data: '数据与安全',
}

export default function SettingsSections({ nav, params = {} }) {
  const section = params.section || 'profile'
  const Ctx = useSettingsCtx()
  return (
    <>
      <TopBar title={TITLES[section] || '设置'} onBack={nav.pop} />
      <div className="page-body no-tab">
        {section === 'profile' && <ProfileSection ctx={Ctx} nav={nav} />}
        {section === 'appearance' && <AppearanceSection ctx={Ctx} />}
        {section === 'ai' && <AiSection ctx={Ctx} nav={nav} />}
        {section === 'prefs' && <PrefsSection ctx={Ctx} />}
        {section === 'notify' && <NotifySection ctx={Ctx} />}
        {section === 'data' && <DataSection ctx={Ctx} nav={nav} />}
      </div>
      <SectionSheets ctx={Ctx} section={section} />
    </>
  )
}

/* ---------- 共享上下文：所有二级页共用一份 state 与本地弹窗开关 ---------- */
function useSettingsCtx() {
  const { state, set, toast, loadDemo, clearAll, restoreState } = useStore()
  const media = useMediaActions()
  const welcomeBg = useWelcomeBg()
  const [nameOpen, setNameOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  const [aiFaceOpen, setAiFaceOpen] = useState(false)
  const [aiFaceTab, setAiFaceTab] = useState('emoji')
  const [fxOpen, setFxOpen] = useState(false)
  const [name, setName] = useState('')
  const [busyImg, setBusyImg] = useState(false)
  // v1.6 底部菜单图标自定义（v1.6.1 移除表情方式，仅保留白底图片上传）
  const [tabIconOpen, setTabIconOpen] = useState(false)
  const [tabIconPage, setTabIconPage] = useState('home')
  const tabIconFileRef = useRef(null)
  const [pending, setPending] = useState(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const restoreRef = useRef(null)
  const avatarFileRef = useRef(null)
  const wallpaperRef = useRef(null)
  const welcomeFileRef = useRef(null)
  const aiFaceFileRef = useRef(null)

  const openName = () => { setName(state.settings.nickname); setNameOpen(true) }

  const pickImage = async (kind, file) => {
    if (!file) return
    setBusyImg(true)
    try {
      if (kind === 'avatar') {
        await media.saveAvatarPhoto(file)
        toast('头像已更新')
        setAvatarOpen(false)
      } else if (kind === 'wallpaper') {
        await media.saveWallpaper(file)
        set((d) => { d.settings.glassOn = true })
        toast('壁纸已更换，液态玻璃已开启')
      } else if (kind === 'welcome') {
        await media.saveWelcomeBg(file)
        toast('启动页背景已更新')
        setWelcomeOpen(false)
      } else if (kind === 'aiface') {
        await media.saveAiFace(file)
        toast('AI 形象已更新')
        setAiFaceOpen(false)
      }
    } catch (e) {
      toast(String(e?.message || '').includes('白底') ? '仅支持白底图片，请换一张白底照片' : '图片读取失败，请换一张试试', 'err')
    } finally {
      setBusyImg(false)
    }
  }

  const readRestore = (file) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ''))
        const data = parsed && parsed.kind === 'full-backup' ? parsed.data : parsed
        const valid = data && data.version && data.settings && data.categories
          && Array.isArray(data.ledgers) && data.ledgers.length > 0
          && Array.isArray(data.transactions)
        if (!valid) { toast('备份文件无法识别或已损坏', 'err'); return }
        setPending(data)
      } catch {
        toast('文件解析失败，请选择本 App 导出的 JSON 备份', 'err')
      }
    }
    reader.readAsText(file, 'utf-8')
  }

  return {
    state, set, toast, loadDemo, clearAll, restoreState, media,
    welcomeBg,
    nameOpen, setNameOpen, avatarOpen, setAvatarOpen,
    welcomeOpen, setWelcomeOpen, aiFaceOpen, setAiFaceOpen, aiFaceTab, setAiFaceTab,
    fxOpen, setFxOpen, name, setName, busyImg, pending, setPending,
    confirmClear, setConfirmClear, restoreRef, avatarFileRef,
    wallpaperRef, welcomeFileRef, aiFaceFileRef, openName, pickImage, readRestore,
    tabIconOpen, setTabIconOpen, tabIconPage, setTabIconPage, tabIconFileRef,
  }
}

/* ---------- 个人资料 ---------- */
function ProfileSection({ ctx, nav }) {
  const { state } = ctx
  const s = state.settings
  return (
    <>
      <div className="group">
        <div className="gtitle">个人</div>
        <div className="cell" onClick={ctx.openName}>
          <div className="cico">✏️</div>
          <div className="cmain"><div className="ctitle">昵称</div></div>
          <div className="cright">{s.nickname}<span className="arrow">›</span></div>
        </div>
        <div className="cell" onClick={() => ctx.setAvatarOpen(true)}>
          <div className="cico"><AvatarFace /></div>
          <div className="cmain"><div className="ctitle">头像</div><div className="cdesc">上传白底照片（如证件照），随云同步</div></div>
          <div className="cright"><span className="arrow">›</span></div>
        </div>
        <div className="cell" onClick={() => nav.push({ page: 'ledgers', title: '我的账本' })}>
          <div className="cico">📒</div>
          <div className="cmain"><div className="ctitle">我的账本</div><div className="cdesc">{state.ledgers.length} 个账本</div></div>
          <div className="cright"><span className="arrow">›</span></div>
        </div>
      </div>
      <input
        ref={ctx.avatarFileRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) ctx.pickImage('avatar', f); e.target.value = '' }}
      />
    </>
  )
}

/* ---------- 外观与个性化 ---------- */
function AppearanceSection({ ctx }) {
  const { state, set, toast, media } = ctx
  const s = state.settings
  return (
    <>
      <div className="group">
        <div className="gtitle">液态玻璃</div>
        <div className="cell" onClick={() => set((d) => { d.settings.glassOn = !d.settings.glassOn })}>
          <div className="cico">🧊</div>
          <div className="cmain">
            <div className="ctitle">液态玻璃效果</div>
            <div className="cdesc">半透明磨砂材质与主色晕光，低端机可关闭省电</div>
          </div>
          <div className="cright"><Switch on={s.glassOn} onChange={() => set((d) => { d.settings.glassOn = !d.settings.glassOn })} /></div>
        </div>
        {s.glassOn && (
          <div className="cell">
            <div className="cico">🌫️</div>
            <div className="cmain">
              <div className="ctitle">模糊强度</div>
              <div className="cdesc">数值越大磨砂感越强</div>
            </div>
            <div className="cright" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range" min={8} max={28} step={2} value={s.glassBlur}
                onChange={(e) => set((d) => { d.settings.glassBlur = Number(e.target.value) })}
                style={{ width: 110 }}
              />
              <span className="muted" style={{ width: 34, textAlign: 'right' }}>{s.glassBlur}</span>
            </div>
          </div>
        )}
      </div>
      <div className="group">
        <div className="gtitle">背景与形象</div>
        <div className="cell" onClick={() => ctx.wallpaperRef.current?.click()}>
          <div className="cico">🖼️</div>
          <div className="cmain">
            <div className="ctitle">自定义壁纸</div>
            <div className="cdesc">{s.wallpaperAt ? '已设置壁纸，点击重新选择' : '上传喜欢的图片，玻璃与我的页头部将随其晕光'}</div>
          </div>
          <div className="cright"><span className="arrow">›</span></div>
        </div>
        {s.wallpaperAt && (
          <div className="cell" onClick={async () => {
            await media.clearWallpaper()
            toast('已恢复默认背景')
          }}>
            <div className="cico">↩️</div>
            <div className="cmain"><div className="ctitle">恢复默认背景</div></div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
        )}
        <div className="cell" onClick={() => ctx.setWelcomeOpen(true)}>
          <div className="cico">🌅</div>
          <div className="cmain">
            <div className="ctitle">启动页背景</div>
            <div className="cdesc">{s.welcomeBgAt ? '已设置，点击重新选择' : '上传一张图，首次打开更有专属感'}</div>
          </div>
          <div className="cright"><span className="arrow">›</span></div>
        </div>
        <div className="cell" onClick={() => ctx.setTabIconOpen(true)}>
          <div className="cico">🧩</div>
          <div className="cmain">
            <div className="ctitle">底部菜单图标</div>
            <div className="cdesc">上传白底图片自定义四个页签图标，自动居中裁切</div>
          </div>
          <div className="cright"><span className="arrow">›</span></div>
        </div>
      </div>
      <div className="group">
        <div className="gtitle">点击反馈</div>
        <div className="cell" onClick={() => set((d) => { d.settings.tapFeedback = d.settings.tapFeedback === false })}>
          <div className="cico">📳</div>
          <div className="cmain">
            <div className="ctitle">按压缩放与轻震动</div>
            <div className="cdesc">点按时的缩放反馈与 8ms 触觉震动（设备支持时）</div>
          </div>
          <div className="cright"><Switch on={s.tapFeedback !== false} onChange={() => set((d) => { d.settings.tapFeedback = d.settings.tapFeedback === false })} /></div>
        </div>
      </div>
      <input
        ref={ctx.wallpaperRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) ctx.pickImage('wallpaper', f); e.target.value = '' }}
      />
    </>
  )
}

/* ---------- AI 助手 ---------- */
function AiSection({ ctx, nav }) {
  const { state, set } = ctx
  const s = state.settings
  return (
    <>
      <div className="group">
        <div className="gtitle">AI 智能分析</div>
        <div className="cell" onClick={() => { ctx.setAiFaceTab(s.aiFaceAt ? 'photo' : 'emoji'); ctx.setAiFaceOpen(true) }}>
          <div className="cico"><AiFace style={{ fontSize: 22, lineHeight: 1 }} /></div>
          <div className="cmain">
            <div className="ctitle">AI 助手形象</div>
            <div className="cdesc">出现在账单分析、消费点评入口处</div>
          </div>
          <div className="cright"><span className="arrow">›</span></div>
        </div>
        <div className="cell" onClick={() => nav.push({ page: 'aiSettings', title: 'AI 分析设置' })}>
          <div className="cico">🤖</div>
          <div className="cmain">
            <div className="ctitle">AI 账单分析</div>
            <div className="cdesc">智谱大模型月度/年度账单解读，需配置 API Key</div>
          </div>
          <div className="cright"><span className="arrow">›</span></div>
        </div>
      </div>
      <input
        ref={ctx.aiFaceFileRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) ctx.pickImage('aiface', f); e.target.value = '' }}
      />
      <div className="group">
        <div className="gtitle">分析偏好</div>
        <div className="cell" onClick={() => set((d) => { d.settings.aiIncludeNotes = !d.settings.aiIncludeNotes })}>
          <div className="cico">📝</div>
          <div className="cmain">
            <div className="ctitle">附带账单备注原文</div>
            <div className="cdesc">分析时把备注一起交给 AI，解读更精准</div>
          </div>
          <div className="cright"><Switch on={s.aiIncludeNotes} onChange={() => set((d) => { d.settings.aiIncludeNotes = !d.settings.aiIncludeNotes })} /></div>
        </div>
      </div>
    </>
  )
}

/* ---------- 记账偏好 ---------- */
function PrefsSection({ ctx }) {
  const { state, set, toast } = ctx
  const s = state.settings
  return (
    <>
      <div className="group">
        <div className="gtitle">账期与账本</div>
        <div className="cell">
          <div className="cico">📅</div>
          <div className="cmain">
            <div className="ctitle">每月起始日</div>
            <div className="cdesc">影响账单周期与预算统计</div>
          </div>
          <div className="cright">
            <select className="input" style={{ width: 86, padding: '8px 10px' }}
              value={s.monthStartDay}
              onChange={(e) => { set((d) => { d.settings.monthStartDay = Number(e.target.value) }); toast('账期起始日已更新') }}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}日</option>)}
            </select>
          </div>
        </div>
        <div className="cell" onClick={() => ctx.setFxOpen(true)}>
          <div className="cico">💱</div>
          <div className="cmain">
            <div className="ctitle">本位币与汇率</div>
            <div className="cdesc">人民币 CNY · 1 美元 ≈ {(state.fxRates?.USD ?? FX_RATES.USD.rate).toFixed(2)}</div>
          </div>
          <div className="cright"><span className="arrow">›</span></div>
        </div>
      </div>
      <div className="group">
        <div className="gtitle">显示与习惯</div>
        <div className="cell" onClick={() => set((d) => { d.settings.hideAmount = !d.settings.hideAmount })}>
          <div className="cico">🔒</div>
          <div className="cmain">
            <div className="ctitle">金额模糊</div>
            <div className="cdesc">公共场合隐藏具体金额</div>
          </div>
          <div className="cright"><Switch on={s.hideAmount} onChange={() => set((d) => { d.settings.hideAmount = !d.settings.hideAmount })} /></div>
        </div>
        <div className="cell" onClick={() => set((d) => { d.settings.dark = !d.settings.dark })}>
          <div className="cico">🌙</div>
          <div className="cmain">
            <div className="ctitle">深色模式</div>
            <div className="cdesc">夜间记账更护眼</div>
          </div>
          <div className="cright"><Switch on={s.dark} onChange={() => set((d) => { d.settings.dark = !d.settings.dark })} /></div>
        </div>
        <div className="cell" onClick={() => set((d) => { d.settings.nightAcross = !d.settings.nightAcross })}>
          <div className="cico">🦉</div>
          <div className="cmain">
            <div className="ctitle">熬夜归属前一天</div>
            <div className="cdesc">凌晨 0-5 点记账默认算昨天（记「昨晚」更顺手）</div>
          </div>
          <div className="cright"><Switch on={s.nightAcross} onChange={() => set((d) => { d.settings.nightAcross = !d.settings.nightAcross })} /></div>
        </div>
      </div>
    </>
  )
}

/* ---------- 提醒与收支监控 ---------- */
function NotifySection({ ctx }) {
  const { state, set, toast } = ctx
  const s = state.settings
  const [nativeOk, setNativeOk] = useState(false)
  const [listening, setListening] = useState(false)

  // 检测原生插件与通知使用权连接状态
  useEffect(() => {
    let alive = true
    getNotifyCatch().then((p) => {
      if (!alive) return
      setNativeOk(!!p)
      if (p) isNotifyListening().then((v) => { if (alive) setListening(v) }).catch(() => {})
    }).catch(() => {})
    return () => { alive = false }
  }, [s.notifyCatch])

  return (
    <>
      <div className="group">
        <div className="gtitle">记账提醒</div>
        <div className="cell" onClick={() => {
          const next = !s.remindEnabled
          set((d) => { d.settings.remindEnabled = next })
          if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
            Notification.requestPermission().catch(() => {})
          }
          toast(next ? '已开启每日提醒' : '已关闭提醒')
        }}>
          <div className="cico">⏰</div>
          <div className="cmain">
            <div className="ctitle">每日记账提醒</div>
            <div className="cdesc">App 内走系统定时通知，浏览器/桌面版为页面通知</div>
          </div>
          <div className="cright"><Switch on={s.remindEnabled} onChange={() => {
            const next = !s.remindEnabled
            set((d) => { d.settings.remindEnabled = next })
          }} /></div>
        </div>
        {s.remindEnabled && (
          <div className="cell">
            <div className="cico">🕐</div>
            <div className="cmain"><div className="ctitle">提醒时间</div></div>
            <div className="cright">
              <input type="time" className="input" style={{ width: 110, padding: '8px 10px' }}
                value={s.remindTime}
                onChange={(e) => set((d) => { d.settings.remindTime = e.target.value })} />
            </div>
          </div>
        )}
      </div>

      <div className="group">
        <div className="gtitle">收支监控</div>
        <div className="cell" onClick={() => set((d) => { d.settings.notifyCatch = !d.settings.notifyCatch })}>
          <div className="cico">👁️</div>
          <div className="cmain">
            <div className="ctitle">微信 / 支付宝收支监控</div>
            <div className="cdesc">检测到收支通知自动弹窗，确认后入账；不静默记账</div>
          </div>
          <div className="cright"><Switch on={s.notifyCatch} onChange={() => set((d) => { d.settings.notifyCatch = !d.settings.notifyCatch })} /></div>
        </div>
        {s.notifyCatch && nativeOk && (
          <div className="cell" onClick={async () => {
            const ok = await openNotifySettings()
            if (ok) toast('请在系统设置中允许轻语记账使用通知使用权')
          }}>
            <div className="cico">🔐</div>
            <div className="cmain">
              <div className="ctitle">通知使用权</div>
              <div className="cdesc">{listening ? '已授权，正在监听通知' : '未授权，点击去系统设置开启'}</div>
            </div>
            <div className="cright">
              <span className="tag" style={{ color: listening ? 'var(--income)' : 'var(--expense)' }}>
                {listening ? '已连接' : '待授权'}
              </span>
              <span className="arrow">›</span>
            </div>
          </div>
        )}
        <div className="cell">
          <div className="cico">ℹ️</div>
          <div className="cmain">
            <div className="ctitle">工作方式与隐私</div>
            <div className="cdesc" style={{ lineHeight: 1.7 }}>
              使用 Android 通知使用权读取微信/支付宝通知原文，在本机解析金额与收支方向后弹窗确认，任何内容不上传。识别不出的通知直接忽略。{!nativeOk && '当前为浏览器/桌面环境，此功能不可用。'}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/* ---------- 数据与安全 ---------- */
function DataSection({ ctx, nav }) {
  const { state, set, toast, loadDemo, clearAll } = ctx
  const s = state.settings

  const exportAll = () => {
    const txs = txsOfLedger(state)
    if (!txs.length) { toast('还没有账单可导出', 'err'); return }
    downloadFile(`轻语账本_${state.ledgers.find((l) => l.id === state.currentLedgerId)?.name || ''}_${todayStr()}.csv`,
      txsToCSV(state, txs), 'text/csv')
    toast('已导出当前账本 CSV')
  }

  const backupAll = () => {
    const envelope = {
      app: 'qingyu', kind: 'full-backup', appVersion: '1.5.0',
      at: new Date().toISOString(), data: state,
    }
    downloadFile(`轻语记账_全量备份_${todayStr()}.json`,
      JSON.stringify(envelope, null, 2), 'application/json')
    toast('已导出全量备份文件')
  }

  return (
    <>
      <div className="group">
        <div className="gtitle">备份与恢复</div>
        <div className="cell" onClick={exportAll}>
          <div className="cico">📤</div>
          <div className="cmain"><div className="ctitle">导出当前账本</div><div className="cdesc">CSV 格式，可用 Excel 打开</div></div>
          <div className="cright"><span className="arrow">›</span></div>
        </div>
        <div className="cell" onClick={backupAll}>
          <div className="cico">💾</div>
          <div className="cmain"><div className="ctitle">全量备份</div><div className="cdesc">导出全部账本/账户/分类/预算/设置为 JSON</div></div>
          <div className="cright"><span className="arrow">›</span></div>
        </div>
        <div className="cell" onClick={() => ctx.restoreRef.current?.click()}>
          <div className="cico">📂</div>
          <div className="cmain"><div className="ctitle">从备份恢复</div><div className="cdesc">选择 JSON 备份，将覆盖当前全部数据</div></div>
          <div className="cright"><span className="arrow">›</span></div>
        </div>
        <div className="cell" onClick={() => nav.push({ page: 'cloud', title: '云备份' })}>
          <div className="cico">☁️</div>
          <div className="cmain"><div className="ctitle">云备份</div><div className="cdesc">WebDAV 网盘：双设备自动合并、换机恢复</div></div>
          <div className="cright"><span className="arrow">›</span></div>
        </div>
        <input ref={ctx.restoreRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) ctx.readRestore(f); e.target.value = '' }} />
      </div>

      <div className="group">
        <div className="gtitle">维护</div>
        <div className="cell" onClick={() => nav.push({ page: 'category', title: '分类管理' })}>
          <div className="cico">🏷️</div>
          <div className="cmain"><div className="ctitle">分类管理</div><div className="cdesc">自定义收支分类</div></div>
          <div className="cright"><span className="arrow">›</span></div>
        </div>
        <div className="cell" onClick={() => nav.push({ page: 'trash', title: '回收站' })}>
          <div className="cico">♻️</div>
          <div className="cmain">
            <div className="ctitle">回收站</div>
            <div className="cdesc">删除的账单保留 30 天，可恢复</div>
          </div>
          <div className="cright">
            {state.transactions.some((t) => t.deletedAt) && (
              <span className="tico-preview">{state.transactions.filter((t) => t.deletedAt).length} 件</span>
            )}
            <span className="arrow">›</span>
          </div>
        </div>
        <div className="cell" onClick={() => { loadDemo(); toast('已载入示例数据，可随意体验') }}>
          <div className="cico">🎁</div>
          <div className="cmain"><div className="ctitle">载入示例数据</div><div className="cdesc">覆盖当前数据，用于体验全部功能</div></div>
          <div className="cright"><span className="arrow">›</span></div>
        </div>
        <div className="cell" onClick={() => ctx.setConfirmClear(true)}>
          <div className="cico">🗑️</div>
          <div className="cmain"><div className="ctitle" style={{ color: 'var(--expense)' }}>清空全部数据</div></div>
          <div className="cright"><span className="arrow">›</span></div>
        </div>
      </div>

      <Confirm
        open={ctx.confirmClear}
        title="清空全部数据？"
        text="所有账单、账户、预算与设置都会被删除并恢复初始状态，且无法恢复。建议先导出备份。"
        okText="全部清空"
        danger
        onOk={() => { ctx.setConfirmClear(false); clearAll() }}
        onCancel={() => ctx.setConfirmClear(false)}
      />
      <Confirm
        open={!!ctx.pending}
        title="确定从备份恢复？"
        text={ctx.pending
          ? `备份包含 ${ctx.pending.ledgers?.length || 0} 个账本、${ctx.pending.transactions?.length || 0} 笔账单、${ctx.pending.accounts?.length || 0} 个账户。恢复将覆盖当前全部数据，建议恢复前先做一次全量备份。`
          : ''}
        okText="覆盖并恢复"
        danger
        onOk={() => {
          const ok = ctx.restoreState(ctx.pending)
          if (ok) toast('已从备份恢复')
          else toast('备份文件无法识别或已损坏', 'err')
          ctx.setPending(null)
        }}
        onCancel={() => ctx.setPending(null)}
      />
    </>
  )
}

/* ---------- 各二级页共用弹层 ---------- */
const TAB_ICON_PAGES = [['home', '明细'], ['charts', '图表'], ['discover', '发现'], ['profile', '我的']]

function SectionSheets({ ctx, section }) {
  const { state, set, toast, media } = ctx
  const s = state.settings
  const tabImgs = useTabIconImgs()
  const [busyTab, setBusyTab] = useState(false)

  // v1.6 底部图标上传：严格白底校验（非白底在压缩时抛错）
  const upTabIcon = async (file) => {
    if (!file) return
    setBusyTab(true)
    try {
      await media.saveTabIcon(ctx.tabIconPage, file)
      toast('底部图标已更新')
    } catch (e) {
      toast(String(e?.message || '').includes('白底') ? '仅支持白底图片，请换一张白底图片' : '图片读取失败，请换一张试试', 'err')
    } finally {
      setBusyTab(false)
    }
  }
  return (
    <>
      {/* 改名 */}
      <Sheet open={ctx.nameOpen} onClose={() => ctx.setNameOpen(false)} title="修改昵称">
        <div className="field">
          <input className="input" maxLength={12} value={ctx.name} autoFocus
            onChange={(e) => ctx.setName(e.target.value)} />
        </div>
        <div className="btnrow">
          <button className="btn ghost" onClick={() => ctx.setNameOpen(false)}>取消</button>
          <button className="btn" onClick={() => {
            const v = ctx.name.trim() || '轻语用户'
            set((d) => { d.settings.nickname = v })
            ctx.setNameOpen(false)
            toast('昵称已更新')
          }}>保存</button>
        </div>
      </Sheet>

      {/* 头像（v1.6 支持任意背景颜色图片） */}
      <Sheet open={ctx.avatarOpen} onClose={() => ctx.setAvatarOpen(false)} title="选择头像">
        <div className="center-box" style={{ padding: '6px 0 12px' }}>
          <div className="avatar" style={{ width: 72, height: 72, fontSize: 34 }}>
            <AvatarFace />
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            支持任意背景颜色的图片，自动居中裁切为 256×256 方形，随云同步
          </div>
        </div>
        <button className="btn" disabled={ctx.busyImg} onClick={() => ctx.avatarFileRef.current?.click()}>
          {ctx.busyImg ? '处理中…' : '📷 选择图片'}
        </button>
        {s.avatarPhotoAt && (
          <button className="btn ghost" style={{ marginTop: 10 }} disabled={ctx.busyImg} onClick={async () => {
            await media.clearAvatarPhoto()
            toast('已移除头像照片')
          }}>移除照片，恢复默认</button>
        )}
      </Sheet>

      {/* 启动页背景 */}
      <Sheet open={ctx.welcomeOpen} onClose={() => ctx.setWelcomeOpen(false)} title="启动页背景">
        <div className="center-box" style={{ padding: '6px 0 12px' }}>
          <div className={`welcome-preview${ctx.welcomeBg ? ' has-img' : ''}`}>
            {ctx.welcomeBg && <img src={ctx.welcomeBg} alt="" decoding="async" draggable={false} />}
            {!ctx.welcomeBg && <span style={{ fontSize: 30 }}>🌅</span>}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {ctx.welcomeBg ? '已设置背景，下次首次打开生效' : '当前为默认渐变背景'}
          </div>
        </div>
        <button className="btn" disabled={ctx.busyImg} onClick={() => ctx.welcomeFileRef.current?.click()}>
          {ctx.busyImg ? '处理中…' : '📷 选择背景图片'}
        </button>
        {s.welcomeBgAt && (
          <button className="btn ghost" style={{ marginTop: 10 }} disabled={ctx.busyImg} onClick={async () => {
            await media.clearWelcomeBg()
            toast('已恢复默认背景')
          }}>恢复默认渐变背景</button>
        )}
        <input
          ref={ctx.welcomeFileRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) ctx.pickImage('welcome', f); e.target.value = '' }}
        />
      </Sheet>

      {/* AI 助手形象 */}
      <Sheet open={ctx.aiFaceOpen} onClose={() => ctx.setAiFaceOpen(false)} title="AI 助手形象">
        <Seg
          options={[{ label: '😀 表情', value: 'emoji' }, { label: '🖼️ 相册图片', value: 'photo' }]}
          value={ctx.aiFaceTab}
          onChange={ctx.setAiFaceTab}
        />
        <div style={{ height: 12 }} />
        {ctx.aiFaceTab === 'emoji' ? (
          <div>
            <div className="center-box" style={{ padding: '6px 0 12px' }}>
              <div className="aiface-preview"><AiFace /></div>
            </div>
            <EmojiPicker value={s.aiFace} onChange={(e) => {
              set((d) => { d.settings.aiFace = e; d.settings.aiFaceAt = null })
              media.clearAiFace().catch(() => {})
              toast('AI 形象已更新')
            }} />
          </div>
        ) : (
          <div>
            <div className="center-box" style={{ padding: '6px 0 12px' }}>
              <div className="aiface-preview"><AiFace /></div>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>方形图片会自动居中裁切</div>
            </div>
            <button className="btn" disabled={ctx.busyImg} onClick={() => ctx.aiFaceFileRef.current?.click()}>
              {ctx.busyImg ? '处理中…' : '📷 从相册选择图片'}
            </button>
            {s.aiFaceAt && (
              <button className="btn ghost" style={{ marginTop: 10 }} disabled={ctx.busyImg} onClick={async () => {
                await media.clearAiFace()
                ctx.setAiFaceTab('emoji')
                toast('已移除照片，用回表情')
              }}>移除照片，用回表情</button>
            )}
          </div>
        )}
      </Sheet>

      {/* 本位币与汇率 */}
      <Sheet open={ctx.fxOpen} onClose={() => ctx.setFxOpen(false)} title="本位币与汇率">
        <div className="field">
          <label>本位币（统计折算目标）</label>
          <select className="input" value="CNY" disabled><option value="CNY">人民币 CNY</option></select>
          <div className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.7 }}>
            外币账户按下方汇率折算为人民币，参与净资产与资产合计；交易与图表仍按账户币种记录。汇率为离线手动值，可按银行牌价自行修改。
          </div>
        </div>
        <div className="field">
          <label>汇率（1 单位外币 ≈ 人民币）</label>
          {FX_CODES.map((c) => (
            <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <div style={{ width: 92, flexShrink: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{c}</div>
                <div className="muted" style={{ fontSize: 11 }}>{FX_RATES[c].name} {FX_RATES[c].sym}</div>
              </div>
              <input className="input" type="number" inputMode="decimal" step="0.0001"
                value={state.fxRates?.[c] ?? FX_RATES[c].rate}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  set((d) => { d.fxRates[c] = Number.isFinite(v) && v > 0 ? v : 1 })
                }} />
            </div>
          ))}
        </div>
        <button className="btn ghost" onClick={() => {
          set((d) => {
            for (const c of FX_CODES) d.fxRates[c] = FX_RATES[c].rate
          })
          toast('已恢复默认参考汇率')
        }}>恢复默认参考汇率</button>
      </Sheet>

      {/* v1.6 底部菜单图标：白底图片上传（v1.6.1 移除表情自定义，仅保留图片） */}
      <Sheet open={ctx.tabIconOpen} onClose={() => ctx.setTabIconOpen(false)} title="底部菜单图标">
        <div className="tabicon-grid">
          {TAB_ICON_PAGES.map(([key, label]) => (
            <button
              key={key}
              className={`tabicon-item ${ctx.tabIconPage === key ? 'on' : ''}`}
              onClick={() => ctx.setTabIconPage(key)}
              type="button"
            >
              <span className="tico-cell" style={{ width: 42, height: 42, fontSize: 20 }}>
                {tabImgs[key]
                  ? <img className="tabicon-img" src={tabImgs[key]} alt="" decoding="async" draggable={false} />
                  : DEFAULT_TAB_ICONS[key]}
              </span>
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div style={{ height: 14 }} />
        <div className="center-box" style={{ padding: '0 0 12px' }}>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
            先点选上方页签，再上传白色背景图片：自动居中裁切为 96×96 并实时应用到菜单栏。<br />
            仅支持白底图片，非白底会被拦截；点击页签可随时重新上传或恢复默认
          </div>
        </div>
        <button className="btn" disabled={busyTab} onClick={() => ctx.tabIconFileRef.current?.click()}>
          {busyTab ? '处理中…' : `📷 为「${(TAB_ICON_PAGES.find(([k]) => k === ctx.tabIconPage) || [])[1] || ''}」上传白底图片`}
        </button>
        {s.tabIconAt?.[ctx.tabIconPage] && (
          <button className="btn ghost" style={{ marginTop: 10 }} disabled={busyTab} onClick={async () => {
            await media.clearTabIcon(ctx.tabIconPage)
            toast('已恢复该页签默认图标')
          }}>恢复默认图标</button>
        )}
        <input
          ref={ctx.tabIconFileRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upTabIcon(f); e.target.value = '' }}
        />
      </Sheet>
    </>
  )
}
