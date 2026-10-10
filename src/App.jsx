import React, { createContext, memo, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AppProvider, useStore } from './store.jsx'
import Home from './pages/Home.jsx'
import ChartsPage from './pages/ChartsPage.jsx'
import Discover from './pages/Discover.jsx'
import Profile from './pages/Profile.jsx'
import Budget from './pages/Budget.jsx'
import Assets from './pages/Assets.jsx'
import Ledgers from './pages/Ledgers.jsx'
import Recurring from './pages/Recurring.jsx'
import ImportPage from './pages/ImportPage.jsx'
import Review from './pages/Review.jsx'
import LoanCalc from './pages/LoanCalc.jsx'
import FxConverter from './pages/FxConverter.jsx'
import Invoices from './pages/Invoices.jsx'
import Settings from './pages/Settings.jsx'
import SettingsSections from './pages/SettingsSections.jsx'
import NotifyCatchSheet from './NotifyCatchSheet.jsx'
import NoticeModal from './NoticeModal.jsx'
import { UpdateProvider, UpdateFloat, UpdatePrompt } from './update-ctx.jsx'
import { Icon } from './ui/icons.jsx'
import { getNotice, importantPending, loadConfirmed, noticeKey, addConfirmed } from './notice.js'
import { loadAiCfg } from './ai.js'
import { startNotifyCatch, stopNotifyCatch, makeNotifyHandler, fetchPendingNotifies, removePendingNotifies } from './notifyCatch.js'
import { startA11yCatch, stopA11yCatch, makeA11yHandler, fetchPendingPages, removePendingPages } from './a11ycatch.js'
import CategoryManage from './pages/CategoryManage.jsx'
import CloudBackup from './pages/CloudBackup.jsx'
import AddTx from './pages/AddTx.jsx'
import AiInsight from './pages/AiInsight.jsx'
import AiSettings from './pages/AiSettings.jsx'
import Support from './pages/Support.jsx'
import Reimburse from './pages/Reimburse.jsx'
import Templates from './pages/Templates.jsx'
import CreditCards from './pages/CreditCards.jsx'
import Debts from './pages/Debts.jsx'
import Goals from './pages/Goals.jsx'
import ScanReceipt from './pages/ScanReceipt.jsx'
import Trash from './pages/Trash.jsx'
import { ThemeProvider, Backdrop, useTabIconImgs } from './theme.jsx'
import { Splash, Intro } from './Welcome.jsx'
import LockScreen from './LockScreen.jsx'
import { useAppLock } from './applock.js'
import { initSecureStore } from './securestore.js'
import { parseAppUrl } from './deeplink.js'

// v3.1 敏感配置（AI API Key）启动即 hydrate：AndroidKeyStore → 内存缓存，
// 早于页面渲染与离线通知重放，loadAiCfg 的同步读才有 Keystore 数据；
// Web/桌面/Node 无原生插件为 no-op（回落 localStorage 原行为），单测安全
initSecureStore()

const NavCtx = createContext(null)
export const useNav = () => useContext(NavCtx)

// v3.4 应用锁：由 App 顶层持有（唯一的 cfg/locked 状态源），
// Shell 负责门禁渲染，设置页负责开关与改密——两处共享同一实例，避免状态分叉。
const LockCtx = createContext(null)
export const useLock = () => useContext(LockCtx)

const TAB_PAGES = {
  home: { title: '明细', comp: Home },
  charts: { title: '图表', comp: ChartsPage },
  add: { title: '记账', comp: null },
  discover: { title: '发现', comp: Discover },
  profile: { title: '我的', comp: Profile },
}

// 底部菜单默认图标（设置-外观-底部菜单图标 可自定义）
export const DEFAULT_TAB_ICONS = { home: 'wallet', charts: 'chartBar', discover: 'compass', profile: 'user' }

const SUB_PAGES = {
  budget: Budget,
  assets: Assets,
  ledgers: Ledgers,
  recurring: Recurring,
  import: ImportPage,
  review: Review,
  loan: LoanCalc,
  fx: FxConverter,
  invoice: Invoices,
  settings: Settings,
  support: Support,
  settingsSection: SettingsSections,
  category: CategoryManage,
  cloud: CloudBackup,
  ai: AiInsight,
  aiSettings: AiSettings,
  reimburse: Reimburse,
  templates: Templates,
  creditCards: CreditCards,
  debts: Debts,
  goals: Goals,
  scan: ScanReceipt,
  trash: Trash,
}

// 底部导航：仅根级页面渲染；memo 化避免 Shell 其它状态变化引起重绘
// v1.6.1 图标回落：自定义白底图片 > 默认图标（emoji 自定义入口已移除，历史 tabIcons 数据仅保留兼容）
const TabBar = memo(function TabBar({ tab, setTab, openAdd, tabImgs = {} }) {
  return (
    <nav className="tabbar">
      {Object.entries(TAB_PAGES).map(([key, cfg]) =>
        key === 'add' ? (
          <button key={key} className="tab-add" onClick={() => openAdd(null)} aria-label="记一笔">
            <div className="plus">+</div>
          </button>
        ) : (
          <button key={key} className={`tab ${tab === key ? 'on' : ''}`} onClick={() => setTab(key)}>
            <span className="tico">
              {tabImgs[key]
                ? <img src={tabImgs[key]} alt="" decoding="async" draggable={false} />
                : <Icon name={DEFAULT_TAB_ICONS[key]} size={22} color={tab === key ? 'var(--brand)' : 'var(--ink2)'} />}
            </span>
            <span>{cfg.title}</span>
          </button>
        ),
      )}
    </nav>
  )
})

function Shell() {
  const { state, set, toast } = useStore()
  const lock = useLock() // v3.4 应用锁门禁状态（App 顶层提供）
  const [tab, setTab] = useState('home')
  const [stack, setStack] = useState([])
  const [addOpen, setAddOpen] = useState(false)
  const [editTx, setEditTx] = useState(null)

  // v3.3 启动兜底：主界面组件首次挂载即解除 index.html 的超时看门狗，
  // 此后不再显示「启动没有完成」失败页（启动页本体已被 createRoot 清空）。
  useEffect(() => {
    if (typeof window !== 'undefined' && window.__qyBootOk) window.__qyBootOk()
  }, [])

  const push = useCallback((route) => {
    setStack((s) => [...s, route])
    try { history.pushState({ qy: true }, '') } catch { /* ignore */ }
  }, [])
  const pop = useCallback(() => {
    setStack((s) => s.slice(0, -1))
  }, [])

  useEffect(() => {
    const h = () => setStack((s) => (s.length ? s.slice(0, -1) : s))
    window.addEventListener('popstate', h)
    return () => window.removeEventListener('popstate', h)
  }, [])

  // v3.1 外链 scheme 直达：qingyu://open?page=<key>（冷启动 getLaunchUrl + 热启动 appUrlOpen；
  // deeplink.js 白名单解析，tab 页清栈切换、二级页 push 入栈；非法/未登记键一律忽略）
  useEffect(() => {
    let cancelled = false
    let listenerPromise = null
    const go = (url) => {
      const r = parseAppUrl(url)
      if (!r) return
      if (r.tab) { setStack([]); setTab(r.tab) }
      else push({ page: r.page, title: r.title })
    }
    ;(async () => {
      try {
        const { App } = await import('@capacitor/app')
        if (cancelled) return
        const launch = await App.getLaunchUrl()
        if (!cancelled && launch?.url) go(launch.url)
        listenerPromise = App.addListener('appUrlOpen', (d) => go(d?.url))
      } catch { /* 浏览器/桌面静默 */ }
    })()
    return () => {
      cancelled = true
      listenerPromise?.then((h) => h.remove?.()).catch(() => {})
    }
  }, [])

  const openAdd = useCallback((tx = null) => { setEditTx(tx); setAddOpen(true) }, [])
  const closeAdd = () => { setAddOpen(false); setEditTx(null) }

  const nav = { push, pop, openAdd, tab, setTab }

  // v1.6.8 震动反馈：pointerdown 即时触发，强度四档可调（0 关 / 6 / 10 / 20ms）。
  // 防烦人：手指落下先轻震，若判定为滑动（移动 >14px 或 pointercancel）立即 vibrate(0) 撤震，
  // 这样滚动列表不会一路嗡嗡响；多指与禁用按钮不震。
  const vibrateLevel = [0, 1, 2, 3].includes(Number(state.settings.vibrateLevel))
    ? Number(state.settings.vibrateLevel) : 2
  useEffect(() => {
    if (vibrateLevel === 0 || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
      return undefined
    }
    const ms = [0, 6, 10, 20][vibrateLevel]
    const MOVE_LIMIT = 196 // 14px²
    const down = (e) => {
      if (e.isPrimary === false) return
      const el = e.target?.closest?.('button, .cell, .txitem, .chip')
      if (!el) return
      const b = el.closest?.('button')
      if (b && (b.disabled || b.getAttribute('aria-disabled') === 'true')) return
      const sx = e.clientX
      const sy = e.clientY
      const cancel = (ev) => {
        const dx = ev.clientX - sx
        const dy = ev.clientY - sy
        if (ev.type === 'pointercancel' || dx * dx + dy * dy > MOVE_LIMIT) {
          try { navigator.vibrate(0) } catch { /* ignore */ }
          cleanup()
        }
      }
      const cleanup = () => {
        window.removeEventListener('pointermove', cancel)
        window.removeEventListener('pointercancel', cancel)
        window.removeEventListener('pointerup', cleanup)
      }
      window.addEventListener('pointermove', cancel, { passive: true })
      window.addEventListener('pointercancel', cancel, { passive: true })
      window.addEventListener('pointerup', cleanup, { passive: true })
      try { navigator.vibrate(ms) } catch { /* ignore */ }
    }
    document.addEventListener('pointerdown', down, { passive: true, capture: true })
    return () => document.removeEventListener('pointerdown', down, { capture: true })
  }, [vibrateLevel])

  // v1.6 底部菜单自定义图片图标（IndexedDB 'tabicon_<page>'）
  const tabImgs = useTabIconImgs()

  // v1.5 收支监控：Android 原生通知监听 → 解析 → 弹确认窗（Web/桌面静默禁用）
  // v2.0.2 重构：弹窗队列化（多条通知排队处理）+ 启动/回前台消费离线暂存队列
  //   （App 被杀期间收到的支付通知不再蒸发，下次打开自动补弹）
  const [caughtQueue, setCaughtQueue] = useState([])
  const pushCaught = useCallback((item) => {
    if (item) setCaughtQueue((q) => [...q, item])
  }, [])
  // 离线副本清理：弹窗确认/忽略或去重命中后，同时清通知队列与支付页队列（双通道合流同一弹窗）
  const removeCaughtKey = useCallback((key) => {
    if (!key) return
    removePendingNotifies([key])
    removePendingPages([key])
  }, [])
  // v2.5 AI 兜底上传脱敏跟随主设置（ref 桥接最新值，规避 handler 创建时的 state 快照陷阱）
  const aiMaskRef = useRef(true)
  aiMaskRef.current = state.settings.aiMask !== false
  const notifyHandlerRef = useRef(null)
  if (!notifyHandlerRef.current) {
    notifyHandlerRef.current = makeNotifyHandler(pushCaught, {
      onCleanup: removeCaughtKey,
      loadCfg: () => ({ ...loadAiCfg(), mask: aiMaskRef.current }),
    })
  }
  // v2.1 无障碍通道复用同一管线（跨通道金额去重依赖同一实例）
  const a11yHandlerRef = useRef(null)
  if (!a11yHandlerRef.current) a11yHandlerRef.current = makeA11yHandler(pushCaught, { notifyHandler: notifyHandlerRef.current })
  // 处理完弹窗（确认/忽略）→ 移除离线副本，防止下次启动重复弹
  const caughtQueueRef = useRef([])
  caughtQueueRef.current = caughtQueue
  const closeCaught = useCallback(() => {
    const head = caughtQueueRef.current[0]
    if (head?.key) removeCaughtKey(head.key)
    setCaughtQueue((q) => q.slice(1))
  }, [removeCaughtKey])
  useEffect(() => {
    if (!state.settings.notifyCatch) return undefined
    let alive = true
    startNotifyCatch((n) => {
      if (!alive || !n) return
      notifyHandlerRef.current(n)
    }).catch(() => {})
    return () => {
      alive = false
      stopNotifyCatch()
    }
  }, [state.settings.notifyCatch])
  // 离线补弹：启动 + 每次 App 回前台（resume）+ 设置页触发（自定义事件）
  // v2.1 同时消费通知队列与无障碍页面队列
  useEffect(() => {
    const catchOn = state.settings.notifyCatch || state.settings.accessibilityCatch
    if (!catchOn) return undefined
    let alive = true
    const consume = async () => {
      try {
        if (state.settings.notifyCatch) {
          const items = await fetchPendingNotifies()
          if (!alive) return
          for (const it of items) {
            await notifyHandlerRef.current({ key: it.key, title: it.title, text: it.text, pkg: it.pkg, ts: it.ts, test: !!it.test })
          }
        }
        if (state.settings.accessibilityCatch) {
          const pages = await fetchPendingPages()
          if (!alive) return
          for (const it of pages) {
            await a11yHandlerRef.current({ key: it.key, sig: it.sig, pkg: it.pkg, ts: it.ts, texts: it.texts, test: !!it.test })
          }
        }
      } catch { /* 消费失败不影响实时链路 */ }
    }
    consume()
    let resumeHandle = null
    let cancelled = false
    ;(async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor.isNativePlatform()) return
        const { App } = await import('@capacitor/app')
        if (cancelled) return
        resumeHandle = await App.addListener('resume', consume)
      } catch { /* 非原生环境静默 */ }
    })()
    window.addEventListener('qy-consume-pending', consume)
    return () => {
      alive = false
      cancelled = true
      resumeHandle?.remove?.().catch(() => {})
      window.removeEventListener('qy-consume-pending', consume)
    }
  }, [state.settings.notifyCatch, state.settings.accessibilityCatch])

  // v2.1 无障碍交易捕获：实时监听微信/支付宝支付页（服务由系统「无障碍」开关控制，
  // 此处只负责 WebView 侧事件接线；App 被杀时原生侧持久化入队，回来由上面的消费 effect 补弹）
  useEffect(() => {
    if (!state.settings.accessibilityCatch) return undefined
    let alive = true
    startA11yCatch((page) => {
      if (!alive || !page) return
      a11yHandlerRef.current(page)
    }).catch(() => {})
    return () => {
      alive = false
      stopA11yCatch()
    }
  }, [state.settings.accessibilityCatch])

  // v1.6.5 公告：启动 2 秒后拉取 notice.json（仓库即 CMS，无后台服务器）。
  // 重要且未确认的公告 → 强弹窗队列。受「接收公告」开关控制——
  // 修复 NexBox 同类机制缺陷①（原版弹窗绕过开关，关了公告照样被拦门）
  const [noticeQueue, setNoticeQueue] = useState([])
  useEffect(() => {
    if (state.settings.noticeEnabled === false) return undefined
    let alive = true
    const t = setTimeout(async () => {
      try {
        const n = await getNotice()
        if (alive && n) setNoticeQueue(importantPending(n.list, loadConfirmed()))
      } catch { /* 网络异常静默：公告属增值信息，失败不影响主流程 */ }
    }, 2000)
    return () => { alive = false; clearTimeout(t) }
  }, [])
  // 确认当前重要公告 → 写入已确认列表 → 队列弹出下一条（若有）
  const confirmNotice = () => setNoticeQueue((q) => {
    if (q[0]) addConfirmed(noticeKey(q[0]))
    return q.slice(1)
  })

  // Android 物理返回键：仅 Capacitor 原生壳注册，浏览器/桌面端动态加载失败即静默
  const navRef = useRef(null)
  navRef.current = { addOpen, stackLen: stack.length, tab, pop, setTab, closeAdd, toast, noticeLen: noticeQueue.length }
  useEffect(() => {
    let cancelled = false
    let listenerPromise = null
    let lastBack = 0
    ;(async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor.isNativePlatform()) return
        const { App } = await import('@capacitor/app')
        if (cancelled) return
        listenerPromise = App.addListener('backButton', () => {
          // v2.6 外链返回修复：主 WebView 已导航到第三方页面（反馈表单/B站/QQ群等）时，
          // 返回键只做历史回退回到应用——旧逻辑此时 nav 栈为空会直接走「双击退出」，
          // 用户被踢出应用导致「退出要重进」
          if (!/^(localhost|127\.0\.0\.1|appassets)$/.test(window.location.hostname)) {
            if (window.history.length > 1) { window.history.back(); return }
            window.location.href = '/'
            return
          }
          const n = navRef.current
          if (n.noticeLen > 0) return // 重要公告弹窗打开时吞掉返回键，必须点「知道了」
          if (n.addOpen) n.closeAdd()
          else if (n.stackLen > 0) n.pop()
          else if (n.tab !== 'home') n.setTab('home')
          else {
            const now = Date.now()
            if (now - lastBack < 2000) App.exitApp()
            else { lastBack = now; n.toast('再按一次返回键退出轻语记账') }
          }
        })
      } catch { /* 非 Capacitor 环境 */ }
    })()
    return () => {
      cancelled = true
      listenerPromise?.then((h) => h.remove()).catch(() => {})
    }
  }, [])

  // v2.3 启动流程：每次启动先展示启动页（真实图标 + 品牌动画 2.2s，可点击跳过）；
  // 首次安装（welcomed=false）接着进功能介绍页，老用户直入主界面。
  // 测试钩子：localStorage 'qingyu_splash_off'==='1' 跳过整个启动流程（冒烟/截图脚本用）
  const [phase, setPhase] = useState(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        if (localStorage.getItem('qingyu_splash_off') === '1') return 'app'
        // v3.1 反馈返回免重启：主 WebView 从腾讯文档表单回退 localhost 会整页重载，
        // 10 分钟内外链标记直接跳过启动页/引导（状态本就持久化在 localStorage，观感即秒回）
        const extTs = Number(localStorage.getItem('qingyu_ext_nav_v1') || 0)
        if (extTs && Date.now() - extTs < 10 * 60 * 1000) {
          localStorage.removeItem('qingyu_ext_nav_v1')
          return 'app'
        }
      }
    } catch { /* ignore */ }
    return 'splash'
  })
  const welcomed = state.settings.welcomed
  const splashDone = useCallback(() => {
    setPhase(welcomed ? 'app' : 'intro')
  }, [welcomed])
  // v2.8 引导页登录选择：mode='local' 直入主界面；mode='login' 打开云备份页引导登录坚果云
  // （云备份页配置/测试连接成功即登录，随后自动同步导入用户数据与账单）
  const startApp = useCallback((mode = 'local') => {
    set((d) => { d.settings.welcomed = true })
    if (mode === 'login') {
      setStack((s) => (s.length ? s : [...s, { page: 'cloud', title: '云备份' }]))
      try { history.pushState({ qy: true }, '') } catch { /* ignore */ }
    }
    setPhase('app')
  }, [set])

  if (phase === 'splash') return <Splash onDone={splashDone} />
  if (phase === 'intro') return <Intro onStart={startApp} />

  // v3.4 应用锁门禁：解锁前不渲染任何业务界面（含 tabbar / 弹层），
  // 但 Shell 的副作用（通知监听、自动同步、公告）照常运行。
  if (lock && lock.locked) return <LockScreen lock={lock} />

  const top = stack[stack.length - 1]
  let Page = null
  let pageTitle = ''
  if (top) {
    Page = SUB_PAGES[top.page]
    pageTitle = top.title || ''
  } else {
    Page = TAB_PAGES[tab].comp
  }

  return (
    <UpdateProvider>
      <NavCtx.Provider value={nav}>
        <div className="phone">
          <Backdrop />
          <div className="app">
            <Page nav={nav} params={top?.params || {}} />
          </div>

          {/* 底部导航：仅在根级页面显示 */}
          {!stack.length && <TabBar tab={tab} setTab={setTab} openAdd={openAdd} tabImgs={tabImgs} />}

          {/* v1.7.1 应用内更新：根级页显示轻提示浮卡，可视化安装组件全局可用 */}
          {!stack.length && <UpdateFloat />}
          <UpdatePrompt />

          {/* 记一笔 / 编辑账单 */}
          <AddTx
            key={editTx ? editTx.id : 'new'}
            open={addOpen}
            editTx={editTx}
            onClose={() => { setAddOpen(false); setEditTx(null) }}
          />

          {/* v1.5 收支监控确认弹窗：仅 Android 原生且开启监控时才会触发 */}
          <NotifyCatchSheet caught={caughtQueue[0] || null} queueLen={caughtQueue.length} onClose={closeCaught} />

          {/* v1.6.5 重要公告强弹窗：队列逐条展示，开关关闭或全部确认时不渲染 */}
          {noticeQueue.length > 0 && (
            <NoticeModal notice={noticeQueue[0]} remain={noticeQueue.length - 1} onConfirm={confirmNotice} />
          )}
        </div>
      </NavCtx.Provider>
    </UpdateProvider>
  )
}

export default function App() {
  // v3.4 应用锁：唯一状态源放在最外层，Shell 门禁与设置页共享同一实例
  const lock = useAppLock()
  return (
    <LockCtx.Provider value={lock}>
      <AppProvider>
        <ThemeProvider>
          <Shell />
        </ThemeProvider>
      </AppProvider>
    </LockCtx.Provider>
  )
}
