/* v1.5 设置二级菜单：设置主页只留分组入口，具体修改进各二级子页。
 * 通过 App.jsx SUB_PAGES 注册为 settingsSection，按 params.section 切换：
 *   profile 个人资料 / appearance 外观与个性化 / ai AI 助手
 *   prefs 记账偏好 / notify 提醒与监控 / data 数据与安全
 */
import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { useNav } from '../App.jsx'
import { TopBar, Sheet, Switch, Confirm, Seg, EmojiPicker } from '../ui.jsx'
import { AvatarFace, AiFace, useWelcomeBg, useMediaActions, useTabIconImgs, useDiscIconImgs, useTheme } from '../theme.jsx'
import { DEFAULT_TAB_ICONS } from '../App.jsx'
import { DISCOVER_TOOLS } from './Discover.jsx'
import { Icon, SEMANTIC, SEMANTIC_COLOR } from '../ui/icons.jsx'
import { getNotifyCatch, isNotifyListening, openNotifySettings } from '../notifyCatch.js'
import { getA11yStatus, openA11ySettings } from '../a11ycatch.js'
import { txsOfLedger, txsToCSV, downloadFile, todayStr, FX_RATES, parseMoneyNotify } from '../utils.js'

const FX_CODES = Object.keys(FX_RATES).filter((c) => c !== 'CNY')

/* v1.7.1 震动反馈四档（时长与 App.jsx 全局监听保持一致：0/6/10/20ms） */
const VIB_MS = [0, 6, 10, 20]
const VIBRATE_LEVELS = [
  { v: 0, label: '关闭', desc: '不产生任何震动', bars: 0 },
  { v: 1, label: '轻柔', desc: '笔尖轻点，安静低调', bars: 1 },
  { v: 2, label: '标准', desc: '清晰不突兀，推荐', bars: 3 },
  { v: 3, label: '明快', desc: '短促有力，反馈明确', bars: 4 },
]
function playVibrate(level) {
  if (level > 0 && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(VIB_MS[level]) } catch { /* 桌面/部分浏览器不支持，静默 */ }
  }
}
/* 震动反馈强度卡片：波形柱可视化 + 档位说明，点按即预览，另有手动试震按钮 */
function VibrateCard({ level, onChange }) {
  return (
    <div className="vib-card">
      <div className="vib-head">
        <span className="vib-ico">📳</span>
        <span className="vib-headtxt">
          <b>震动反馈强度</b>
          <i>手指落下即震；滑动滚动时自动撤震，不会烦人</i>
        </span>
      </div>
      <div className="vib-opts">
        {VIBRATE_LEVELS.map((lv) => (
          <button
            key={lv.v} type="button"
            className={'vib-opt' + (level === lv.v ? ' on' : '')}
            aria-pressed={level === lv.v}
            onClick={() => { onChange(lv.v); playVibrate(lv.v) }}
          >
            <span className="vib-bars" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => <i key={i} className={i < lv.bars ? 'lit' : ''} />)}
            </span>
            <span className="vib-meta">
              <b>{lv.label}{lv.v > 0 && <em>{VIB_MS[lv.v]}ms</em>}</b>
              <i>{lv.desc}</i>
            </span>
            <span className="vib-check" aria-hidden="true">{level === lv.v ? '✓' : ''}</span>
          </button>
        ))}
      </div>
      <button
        type="button" className="vib-test" disabled={level === 0}
        onClick={() => playVibrate(level)}
      >{level === 0 ? '当前为关闭状态' : '▶ 感受一下这个档位'}</button>
    </div>
  )
}

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
  // v1.6.8 发现页功能图标自定义（任意背景图片均可）
  const [discIconOpen, setDiscIconOpen] = useState(false)
  const [discIconKey, setDiscIconKey] = useState('scan')
  const discIconFileRef = useRef(null)
  const [pending, setPending] = useState(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const restoreRef = useRef(null)
  const avatarFileRef = useRef(null)
  const wallpaperRef = useRef(null)
  const welcomeFileRef = useRef(null)
  const aiFaceFileRef = useRef(null)
  const bgVideoRef = useRef(null)

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
      toast(kind === 'bgvideo' ? String(e?.message || '视频读取失败') : (String(e?.message || '').includes('白底') ? '仅支持白底图片，请换一张白底照片' : '图片读取失败，请换一张试试'), 'err')
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
    wallpaperRef, welcomeFileRef, aiFaceFileRef, bgVideoRef, openName, pickImage, readRestore,
    tabIconOpen, setTabIconOpen, tabIconPage, setTabIconPage, tabIconFileRef,
    discIconOpen, setDiscIconOpen, discIconKey, setDiscIconKey, discIconFileRef,
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
  const { wallUrl } = useTheme()
  const tabImgs = useTabIconImgs()
  const discImgsCtx = useDiscIconImgs(DISCOVER_TOOLS.map((t) => t.key))
  // v1.6.9 个性化预览卡：真实缩略图 + 自定义计数，所见即所得
  const TAB_KEYS = ['home', 'charts', 'discover', 'profile']
  const tabCount = TAB_KEYS.filter((k) => s.tabIconAt?.[k]).length
  const discCount = DISCOVER_TOOLS.filter((t) => s.discIconAt?.[t.key]).length
  return (
    <>
      <div className="group">
        <div className="gtitle">液态玻璃</div>
        <div className="cell" onClick={() => set((d) => { d.settings.glassOn = !d.settings.glassOn })}>
          <div className="cico"><Icon name="droplet" size={20} color="var(--brand)" /></div>
          <div className="cmain">
            <div className="ctitle">液态玻璃效果</div>
            <div className="cdesc">半透明磨砂材质与主色晕光，低端机可关闭省电</div>
          </div>
          <div className="cright"><Switch on={s.glassOn} onChange={() => set((d) => { d.settings.glassOn = !d.settings.glassOn })} /></div>
        </div>
        {/* v2.5 字体跟随系统 */}
        <div className="cell" onClick={() => set((d) => { d.settings.sysFont = d.settings.sysFont === false ? true : false })}>
          <div className="cico"><Icon name="typography" size={20} color="var(--brand)" /></div>
          <div className="cmain">
            <div className="ctitle">字体跟随系统</div>
            <div className="cdesc">使用系统当前字体渲染（关=通用无衬线栈）</div>
          </div>
          <div className="cright"><Switch on={s.sysFont !== false} onChange={() => set((d) => { d.settings.sysFont = d.settings.sysFont === false ? true : false })} /></div>
        </div>
        {s.glassOn && (
          <div className="cell range-cell">
            <div className="cico">🌫️</div>
            <div className="cmain">
              <div className="ctitle">模糊强度</div>
              <div className="cdesc">数值越大，背景越清晰、磨砂层越透</div>
            </div>
            <div className="cright" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="range" min={8} max={28} step={2} value={s.glassBlur}
                aria-label="模糊强度"
                onChange={(e) => {
                  const v = Number(e.target.value)
                  // 先直接写 CSS 变量：拖动时雾度零延迟变化，不等待 React 重渲染
                  const root = document.documentElement
                  root.style.setProperty('--glass-blur', `${v}px`)
                  root.style.setProperty('--glass-blur-n', String(v))
                  set((d) => { d.settings.glassBlur = v })
                }}
              />
              <span className="muted" style={{ width: 30, textAlign: 'right' }}>{s.glassBlur}</span>
            </div>
          </div>
        )}
      </div>
      <div className="group">
        <div className="gtitle">背景与形象</div>
        {/* v1.6.9 个性化视觉预览卡网格：缩略图所见即所得，替代纯文字列表 */}
        <div className="skin-grid">
          <button className="skin-card" onClick={() => ctx.wallpaperRef.current?.click()}>
            <span className="skin-thumb">
              {wallUrl
                ? <img src={wallUrl} alt="" decoding="async" draggable={false} />
                : <span className="skin-ph">🖼️</span>}
            </span>
            <b>自定义壁纸</b>
            <span className="skin-st">{s.wallpaperAt ? '已设置 · 点击更换' : '未设置'}</span>
          </button>
          <button className="skin-card" onClick={() => ctx.setWelcomeOpen(true)}>
            <span className="skin-thumb">
              {ctx.welcomeBg
                ? <img src={ctx.welcomeBg} alt="" decoding="async" draggable={false} />
                : <span className="skin-ph">🌅</span>}
            </span>
            <b>启动页背景</b>
            <span className="skin-st">{s.welcomeBgAt ? '已设置 · 点击更换' : '未设置'}</span>
          </button>
          <button className="skin-card" onClick={() => ctx.setTabIconOpen(true)}>
            <span className="skin-thumb skin-thumb-tabs">
              {TAB_KEYS.map((k) => (
                tabImgs[k]
                  ? <img key={k} src={tabImgs[k]} alt="" decoding="async" draggable={false} />
                  : <i key={k}><Icon name={DEFAULT_TAB_ICONS[k]} size={16} color="var(--ink3)" /></i>
              ))}
            </span>
            <b>底部菜单图标</b>
            <span className="skin-st">{tabCount ? `已自定义 ${tabCount}/4` : '未自定义'}</span>
          </button>
          <button className="skin-card" onClick={() => { ctx.setDiscIconKey('scan'); ctx.setDiscIconOpen(true) }}>
            <span className="skin-thumb skin-thumb-tabs">
              {DISCOVER_TOOLS.slice(0, 4).map((t) => (
                s.discIconAt?.[t.key] && discImgsCtx[t.key]
                  ? <img key={t.key} src={discImgsCtx[t.key]} alt="" decoding="async" draggable={false} />
                  : <i key={t.key}><Icon name={t.icon} size={16} color={SEMANTIC_COLOR(t.key)} /></i>
              ))}
            </span>
            <b>发现页功能图标</b>
            <span className="skin-st">{discCount ? `已自定义 ${discCount}/14` : '未自定义'}</span>
          </button>
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
        {/* v2.6 内置背景循环播放 */}
        <div className="cell" onClick={() => set((d) => { d.settings.bgRotate = d.settings.bgRotate === false ? true : false })}>
          <div className="cico"><Icon name="repeat" size={20} color={SEMANTIC.func} /></div>
          <div className="cmain">
            <div className="ctitle">背景循环播放</div>
            <div className="cdesc">内置四张插画与自定义壁纸定时轮换，淡入淡出</div>
          </div>
          <div className="cright"><Switch on={s.bgRotate !== false} onChange={() => set((d) => { d.settings.bgRotate = d.settings.bgRotate === false ? true : false })} /></div>
        </div>
        {s.bgRotate !== false && (
          <div className="cell range-cell">
            <div className="cico"><Icon name="clock" size={20} color={SEMANTIC.func} /></div>
            <div className="cmain">
              <div className="ctitle">轮换间隔</div>
              <div className="cdesc">每 {s.bgRotateSec || 60} 秒切换一张背景</div>
            </div>
            <div className="cright" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="range" min={30} max={300} step={30} value={s.bgRotateSec || 60}
                aria-label="轮换间隔"
                onChange={(e) => set((d) => { d.settings.bgRotateSec = Number(e.target.value) })}
              />
            </div>
          </div>
        )}
        {/* v2.6 视频动态背景 */}
        <div className="cell" onClick={() => ctx.bgVideoRef.current?.click()}>
          <div className="cico"><Icon name="video" size={20} color={SEMANTIC.func} /></div>
          <div className="cmain">
            <div className="ctitle">视频动态背景</div>
            <div className="cdesc">{s.bgVideoAt ? '已设置 · 点击更换（静音循环播放）' : '上传本地视频作为动态背景（≤80MB）'}</div>
          </div>
          <div className="cright"><span className="arrow">›</span></div>
        </div>
        {s.bgVideoAt && (
          <div className="cell" onClick={async () => { await media.clearBgVideo(); toast('已移除视频背景') }}>
            <div className="cico"><Icon name="trash" size={20} color="var(--ink2)" /></div>
            <div className="cmain"><div className="ctitle">移除视频背景</div><div className="cdesc">移除后回到图片背景 / 轮播</div></div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
        )}
      </div>
      <div className="group">
        <div className="gtitle">点击反馈</div>
        <div className="cell" onClick={() => set((d) => { d.settings.tapScale = d.settings.tapScale === false })}>
          <div className="cico">👆</div>
          <div className="cmain">
            <div className="ctitle">按压缩放动画</div>
            <div className="cdesc">点按按钮与列表项时的轻微缩放反馈</div>
          </div>
          <div className="cright"><Switch on={s.tapScale !== false} onChange={() => set((d) => { d.settings.tapScale = d.settings.tapScale === false })} /></div>
        </div>
        <VibrateCard
          level={s.vibrateLevel ?? 2}
          onChange={(v) => set((d) => { d.settings.vibrateLevel = v })}
        />
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
        <div className="cell" onClick={() => set((d) => { d.settings.aiMask = d.settings.aiMask === false ? true : false })}>
          <div className="cico">🛡️</div>
          <div className="cmain">
            <div className="ctitle">上传前脱敏</div>
            <div className="cdesc">手机号/身份证/银行卡号自动打码后再发给 AI（金额不受影响）</div>
          </div>
          <div className="cright"><Switch on={s.aiMask !== false} onChange={() => set((d) => { d.settings.aiMask = d.settings.aiMask === false ? true : false })} /></div>
        </div>
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
  const [sandbox, setSandbox] = useState('微信支付收款0.01元')
  const [sandboxState, setSandboxState] = useState({ status: 'none' })
  // v2.1 无障碍交易捕获：权限状态 + 分步引导（deniedRef 供回前台闭包判定，state 仅渲染）
  const [a11y, setA11y] = useState({ enabled: false, connected: false })
  const [a11yGuide, setA11yGuide] = useState(false)
  const [a11yDenied, setA11yDenied] = useState(false)
  const a11yDeniedRef = useRef(false)

  const refreshListening = () => {
    isNotifyListening().then(setListening).catch(() => {})
  }
  const refreshA11y = () => {
    getA11yStatus().then(setA11y).catch(() => {})
  }

  // 检测原生插件与通知使用权连接状态；回前台/从系统设置返回时自动刷新
  useEffect(() => {
    let alive = true
    getNotifyCatch().then((p) => {
      if (!alive) return
      setNativeOk(!!p)
      if (p) {
        isNotifyListening().then((v) => { if (alive) setListening(v) }).catch(() => {})
        getA11yStatus().then((st) => { if (alive) setA11y(st) }).catch(() => {})
      }
    }).catch(() => {})
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        refreshListening()
        // v2.1 无障碍状态回前台刷新；用户去过系统设置但没开 → 标记被拒，状态行标红 + toast 重引导
        getA11yStatus().then((st) => {
          setA11y(st)
          if (s.accessibilityCatch && !st.enabled) {
            a11yDeniedRef.current = true
            setA11yDenied(true)
          } else if (st.enabled && a11yDeniedRef.current) {
            a11yDeniedRef.current = false
            setA11yDenied(false)
            toast('无障碍权限已开启，收支捕获生效', 'ok')
          }
        }).catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVis)
    let resumeHandle = null
    let cancelled = false
    ;(async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor.isNativePlatform()) return
        const { App } = await import('@capacitor/app')
        if (cancelled) return
        resumeHandle = await App.addListener('resume', refreshListening)
      } catch { /* 非原生环境静默 */ }
    })()
    return () => {
      alive = false
      cancelled = true
      document.removeEventListener('visibilitychange', onVis)
      resumeHandle?.remove?.().catch(() => {})
    }
  }, [s.notifyCatch])

  // 每日提醒：开关与行内点击共用，行为保持一致（含权限申请与提示）
  const toggleRemind = () => {
    const next = !s.remindEnabled
    set((d) => { d.settings.remindEnabled = next })
    if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
    toast(next ? '已开启每日提醒' : '已关闭提醒')
  }

  // 打开系统通知使用权页；开启监控时自动引导
  const openAuth = async () => {
    const ok = await openNotifySettings()
    if (ok) toast('请在系统设置中允许轻语记账使用通知使用权')
    else toast('无法打开系统设置页', 'err')
  }

  // 解析沙盒：任意环境可用，验证文案识别规则
  const runSandbox = () => {
    const p = parseMoneyNotify('通知测试', sandbox, '')
    setSandboxState(p ? { status: 'ok', p } : { status: 'fail' })
  }

  // v2.1 支付页捕获开关：开启且尚未授权时，自动弹出分步引导 Sheet
  const toggleA11y = () => {
    const next = !s.accessibilityCatch
    set((d) => { d.settings.accessibilityCatch = next })
    if (next) {
      toast('已开启支付页捕获')
      getA11yStatus().then((st) => {
        setA11y(st)
        if (!st.enabled) setTimeout(() => setA11yGuide(true), 300)
      }).catch(() => {})
    } else {
      a11yDeniedRef.current = false
      setA11yDenied(false)
      toast('已关闭支付页捕获')
    }
  }

  // v2.1 端到端测试：原生注入一次模拟支付页事件 → a11y 事件通道 → 解析 → 确认弹窗
  return (
    <>
      <div className="group">
        <div className="gtitle">记账提醒</div>
        <div className="cell" onClick={() => toggleRemind()}>
          <div className="cico">⏰</div>
          <div className="cmain">
            <div className="ctitle">每日记账提醒</div>
            <div className="cdesc">App 内走系统定时通知，浏览器/桌面版为页面通知</div>
          </div>
          <div className="cright"><Switch on={s.remindEnabled} onChange={() => toggleRemind()} /></div>
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
        <div className="cell" onClick={() => set((d) => {
          const next = !d.settings.notifyCatch
          d.settings.notifyCatch = next
          if (next && nativeOk) setTimeout(openAuth, 300)
        })}>
          <div className="cico">👁️</div>
          <div className="cmain">
            <div className="ctitle">微信 / 支付宝收支监控</div>
            <div className="cdesc">实时弹窗确认入账；App 被杀不漏单（下次启动补弹）；配置 AI 后自动智能解析</div>
          </div>
          <div className="cright"><Switch on={s.notifyCatch} onChange={() => set((d) => { d.settings.notifyCatch = !d.settings.notifyCatch })} /></div>
        </div>
        {s.notifyCatch && nativeOk && (
          <div className="cell" onClick={openAuth}>
            <div className="cico">🔐</div>
            <div className="cmain">
              <div className="ctitle">通知使用权</div>
              <div className="cdesc">{listening ? '已授权，正在监听微信/支付宝通知' : '未授权或被系统回收，点击去开启'}</div>
            </div>
            <div className="cright">
              <span className="tag" style={{ color: listening ? 'var(--income)' : 'var(--expense)' }}>
                {listening ? '● 已连接' : '待授权'}
              </span>
              <span className="arrow">›</span>
            </div>
          </div>
        )}
        {/* v2.1 无障碍支付页捕获：替代截图方式，直接读取支付结果页文字 */}
        <div className="cell" onClick={() => toggleA11y()}>
          <div className="cico">🤖</div>
          <div className="cmain">
            <div className="ctitle">微信 / 支付宝支付页捕获</div>
            <div className="cdesc">读取支付结果页文字，金额/收款方自动填好，无需截图</div>
          </div>
          <div className="cright"><Switch on={s.accessibilityCatch} onChange={() => toggleA11y()} /></div>
        </div>
        {s.accessibilityCatch && nativeOk && (
          <div className="cell" onClick={() => setA11yGuide(true)}>
            <div className="cico">♿</div>
            <div className="cmain">
              <div className="ctitle">无障碍权限</div>
              <div className="cdesc">
                {a11y.enabled
                  ? (a11y.connected ? '已开启，正在捕获微信/支付宝支付页' : '已开启，等待系统连接服务')
                  : '未开启，点击查看开启指引'}
              </div>
            </div>
            <div className="cright">
              <span className="tag" style={{ color: a11y.enabled && a11y.connected && !a11yDenied ? 'var(--income)' : 'var(--expense)' }}>
                {a11y.enabled ? (a11y.connected ? '● 已连接' : '○ 连接中') : '待授权'}
              </span>
              <span className="arrow">›</span>
            </div>
          </div>
        )}
        {/* 识别规则沙盒：浏览器/桌面也能验证文案解析，无需真付款 */}
        <div className="notify-sandbox">
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>🔎 文案识别测试（粘贴通知内容，验证能否识别金额与收支方向）</div>
          <textarea
            className="input" rows={2} value={sandbox}
            placeholder="例如：微信支付-9.90 / 支付宝到账100.00元"
            onChange={(e) => { setSandbox(e.target.value); setSandboxState({ status: 'none' }) }}
          />
          <button className="btn ghost" style={{ marginTop: 8, padding: '8px 14px' }} onClick={runSandbox}>测试识别</button>
          {sandboxState.status === 'ok' && (
            <div className="sandbox-ok">
              ✓ 识别成功：{sandboxState.p.source === 'wechat' ? '微信' : '支付宝'} ·
              {sandboxState.p.kind === 'income' ? '收入' : '支出'} · ¥{sandboxState.p.amount}
            </div>
          )}
          {sandboxState.status === 'fail' && (
            <div className="sandbox-fail">未识别为收支通知（缺来源/金额/方向关键词，或属于验证码等噪声），不会弹窗</div>
          )}
        </div>
        <div className="cell">
          <div className="cico">ℹ️</div>
          <div className="cmain">
            <div className="ctitle">工作方式与隐私</div>
            <div className="cdesc" style={{ lineHeight: 1.7 }}>
              使用 Android 通知使用权读取微信/支付宝通知原文（含展开文本与会话消息），在本机解析金额与方向后弹窗确认，任何内容不上传；配置 AI 兜底解析时，发送给大模型的通知文本会先自动脱敏（手机号/身份证/银行卡号打码）；识别不出直接忽略，15 秒内重复通知自动去重。{!nativeOk && '当前为浏览器/桌面环境，监听功能不可用，仅可做文案测试。'}
            </div>
          </div>
        </div>
      </div>

      <div className="group">
        <div className="gtitle">公告</div>
        <div className="cell" onClick={() => set((d) => { d.settings.noticeEnabled = d.settings.noticeEnabled === false })}>
          <div className="cico">📢</div>
          <div className="cmain">
            <div className="ctitle">接收应用公告</div>
            <div className="cdesc">发现页展示公告卡；重要公告启动时弹窗提醒。关闭后两者都不再出现</div>
          </div>
          <div className="cright"><Switch on={s.noticeEnabled !== false} onChange={() => set((d) => { d.settings.noticeEnabled = d.settings.noticeEnabled === false })} /></div>
        </div>
        <div className="cell">
          <div className="cico">ℹ️</div>
          <div className="cmain">
            <div className="cdesc" style={{ lineHeight: 1.7 }}>
              公告来自开发者发布在代码仓库中的 notice.json，App 启动时在线检查（失败时使用本地缓存，离线不影响任何功能）。
            </div>
          </div>
        </div>
      </div>

      {/* v2.1 无障碍权限分步引导：价值展示 → 通俗解释 → 四步指引 → 隐私承诺 */}
      <Sheet open={a11yGuide} onClose={() => setA11yGuide(false)} title="开启收支自动捕获">
        <div className="center-box" style={{ padding: '6px 0 10px' }}>
          <div style={{ fontSize: 40, lineHeight: 1 }}>⚡</div>
          <div style={{ fontWeight: 700, marginTop: 8 }}>付完钱，自动弹窗帮你记账</div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.7 }}>
            微信/支付宝支付成功后，轻语记账自动读取结果页文字，
            金额、收款方、收支方向都已填好，点一下确认即可入账 —— 不用截图、不用手填。
          </div>
        </div>
        <div className="field">
          <label>为什么需要你亲自授权？</label>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
            安卓系统规定：读取其他应用界面文字的能力（无障碍），必须由你在系统设置里亲自打开，
            任何 App 都不能替你点 —— 这正是系统在保护你的隐私。
          </div>
        </div>
        <div className="field">
          <label>四步开启（约 20 秒）</label>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 2 }}>
            ① 点下方「去开启」，进入系统无障碍设置<br />
            ② 在列表中找到「轻语记账 · 收支自动捕获」<br />
            ③ 打开它的开关（部分手机在：设置 → 无障碍 → 已下载的应用）<br />
            ④ 返回轻语记账，看到「● 已连接」即生效
          </div>
        </div>
        <div className="field">
          <label>隐私承诺</label>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
            只读支付结果页的文字（金额、收款方、交易类型），不读聊天内容、不采集密码，
            所有数据仅保存在本机，不会上传。
          </div>
        </div>
        <div className="btnrow">
          <button className="btn ghost" onClick={() => setA11yGuide(false)}>暂不开通</button>
          <button className="btn" onClick={async () => {
            setA11yGuide(false)
            const ok = await openA11ySettings()
            toast(ok ? '请找到「轻语记账 · 收支自动捕获」并打开开关' : '无法打开系统设置页', ok ? 'ok' : 'err')
          }}>去开启</button>
        </div>
      </Sheet>
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
          <div className="cico"><Icon name="trash" size={20} color="var(--ink2)" /></div>
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
  const discImgs = useDiscIconImgs(DISCOVER_TOOLS.map((t) => t.key))
  const [busyTab, setBusyTab] = useState(false)
  const [busyDisc, setBusyDisc] = useState(false)

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

  // v1.6.8 发现页图标上传：任意背景图片均可，144×144 居中裁切
  const upDiscIcon = async (file) => {
    if (!file) return
    setBusyDisc(true)
    try {
      await media.saveDiscIcon(ctx.discIconKey, file)
      toast('功能图标已更新')
    } catch {
      toast('图片读取失败，请换一张试试', 'err')
    } finally {
      setBusyDisc(false)
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

      {/* v1.6.8 发现页功能图标：任意背景图片上传，玻璃材质自动适配 */}
      <Sheet open={ctx.discIconOpen} onClose={() => ctx.setDiscIconOpen(false)} title="发现页功能图标">
        <div className="tabicon-grid discicon-grid">
          {DISCOVER_TOOLS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`tabicon-item ${ctx.discIconKey === t.key ? 'on' : ''}`}
              onClick={() => ctx.setDiscIconKey(t.key)}
            >
              <span className={`tico-cell gi-cell${discImgs[t.key] ? ' has-img' : ''}`}>
                {discImgs[t.key]
                  ? <img className="tabicon-img discicon-img" src={discImgs[t.key]} alt="" decoding="async" draggable="false" />
                  : t.icon}
              </span>
              <span>{t.name}</span>
            </button>
          ))}
        </div>
        <div style={{ height: 14 }} />
        <div className="center-box" style={{ padding: '0 0 12px' }}>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
            先点选功能入口，再上传图片：自动居中裁切为 144×144 并实时应用到发现页。<br />
            任意背景图片均可（不限制白底），玻璃开启时自动套用磨砂描边与高光
          </div>
        </div>
        <button className="btn" disabled={busyDisc} onClick={() => ctx.discIconFileRef.current?.click()}>
          {busyDisc ? '处理中…' : `📷 为「${(DISCOVER_TOOLS.find((t) => t.key === ctx.discIconKey) || {}).name || ''}」上传图片`}
        </button>
        {s.discIconAt?.[ctx.discIconKey] && (
          <button className="btn ghost" style={{ marginTop: 10 }} disabled={busyDisc} onClick={async () => {
            await media.clearDiscIcon(ctx.discIconKey)
            toast('已恢复该功能默认图标')
          }}>恢复默认图标</button>
        )}
        <input
          ref={ctx.discIconFileRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upDiscIcon(f); e.target.value = '' }}
        />
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
