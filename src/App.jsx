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
import { startNotifyCatch, stopNotifyCatch } from './notifyCatch.js'
import { parseMoneyNotify } from './utils.js'
import CategoryManage from './pages/CategoryManage.jsx'
import CloudBackup from './pages/CloudBackup.jsx'
import AddTx from './pages/AddTx.jsx'
import AiInsight from './pages/AiInsight.jsx'
import AiSettings from './pages/AiSettings.jsx'
import Reimburse from './pages/Reimburse.jsx'
import Templates from './pages/Templates.jsx'
import CreditCards from './pages/CreditCards.jsx'
import Debts from './pages/Debts.jsx'
import Goals from './pages/Goals.jsx'
import ScanReceipt from './pages/ScanReceipt.jsx'
import Trash from './pages/Trash.jsx'
import { ThemeProvider, Backdrop, useWelcomeBg } from './theme.jsx'

const NavCtx = createContext(null)
export const useNav = () => useContext(NavCtx)

const TAB_PAGES = {
  home: { title: '明细', comp: Home },
  charts: { title: '图表', comp: ChartsPage },
  add: { title: '记账', comp: null },
  discover: { title: '发现', comp: Discover },
  profile: { title: '我的', comp: Profile },
}

// 底部菜单默认图标（设置-外观-底部菜单图标 可自定义）
export const DEFAULT_TAB_ICONS = { home: '📒', charts: '📊', discover: '🧭', profile: '👤' }

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

// 欢迎页（启动页）：可自定义背景图（设置-外观-启动页背景）
function WelcomePage({ onStart }) {
  const bg = useWelcomeBg()
  return (
    <div className="phone">
      <div className="welcome">
        {bg && <img className="welcome-bg" src={bg} alt="" decoding="async" draggable={false} />}
        {bg && <div className="welcome-veil" />}
        <div className="wlogo">📖</div>
        <h1>轻语记账</h1>
        <p>花一分钟，记下今天的收支</p>
        <button className="btn" onClick={onStart}>从零开始记</button>
        <div style={{ height: 10 }} />
        <button className="btn ghost" onClick={onStart}>先随便看看（稍后可在设置加载示例数据）</button>
      </div>
    </div>
  )
}

// 底部导航：仅根级页面渲染；memo 化避免 Shell 其它状态变化引起重绘（v1.4.1 起图标固定默认，不再自定义）
const TabBar = memo(function TabBar({ tab, setTab, openAdd }) {
  const icons = DEFAULT_TAB_ICONS
  return (
    <nav className="tabbar">
      {Object.entries(TAB_PAGES).map(([key, cfg]) =>
        key === 'add' ? (
          <button key={key} className="tab-add" onClick={() => openAdd(null)} aria-label="记一笔">
            <div className="plus">+</div>
          </button>
        ) : (
          <button key={key} className={`tab ${tab === key ? 'on' : ''}`} onClick={() => setTab(key)}>
            <span className="tico">{icons[key]}</span>
            <span>{cfg.title}</span>
          </button>
        ),
      )}
    </nav>
  )
})

function Shell() {
  const { state, set, toast } = useStore()
  const [tab, setTab] = useState('home')
  const [stack, setStack] = useState([])
  const [addOpen, setAddOpen] = useState(false)
  const [editTx, setEditTx] = useState(null)

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

  const openAdd = useCallback((tx = null) => { setEditTx(tx); setAddOpen(true) }, [])
  const closeAdd = () => { setAddOpen(false); setEditTx(null) }

  const nav = { push, pop, openAdd, tab, setTab }

  // v1.5 收支监控：Android 原生通知监听 → 解析 → 弹确认窗（Web/桌面静默禁用）
  const [caught, setCaught] = useState(null)
  const seenRef = useRef(new Map())
  useEffect(() => {
    if (!state.settings.notifyCatch) return undefined
    let alive = true
    startNotifyCatch((n) => {
      if (!alive || !n) return
      // 同签名通知 15 秒内去重（系统会重复 post 分组通知）
      const sig = `${n.title || ''}|${n.text || ''}`
      const last = seenRef.current.get(sig) || 0
      const now = Date.now()
      if (now - last < 15000) return
      seenRef.current.set(sig, now)
      if (seenRef.current.size > 50) seenRef.current.clear()
      const p = parseMoneyNotify(n.title, n.text, n.pkg)
      if (p) setCaught(p)
    }).catch(() => {})
    return () => {
      alive = false
      stopNotifyCatch()
      setCaught(null)
    }
  }, [state.settings.notifyCatch])

  // Android 物理返回键：仅 Capacitor 原生壳注册，浏览器/桌面端动态加载失败即静默
  const navRef = useRef(null)
  navRef.current = { addOpen, stackLen: stack.length, tab, pop, setTab, closeAdd, toast }
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
          const n = navRef.current
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

  // 欢迎页
  if (!state.settings.welcomed) {
    return <WelcomePage onStart={() => set((d) => { d.settings.welcomed = true })} />
  }

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
    <NavCtx.Provider value={nav}>
      <div className="phone">
        <Backdrop />
        <div className="app">
          <Page nav={nav} params={top?.params || {}} />
        </div>

        {/* 底部导航：仅在根级页面显示 */}
        {!stack.length && <TabBar tab={tab} setTab={setTab} openAdd={openAdd} />}

        {/* 记一笔 / 编辑账单 */}
        <AddTx
          key={editTx ? editTx.id : 'new'}
          open={addOpen}
          editTx={editTx}
          onClose={() => { setAddOpen(false); setEditTx(null) }}
        />

        {/* v1.5 收支监控确认弹窗：仅 Android 原生且开启监控时才会触发 */}
        <NotifyCatchSheet caught={caught} onClose={() => setCaught(null)} />
      </div>
    </NavCtx.Provider>
  )
}

export default function App() {
  return (
    <AppProvider>
      <ThemeProvider>
        <Shell />
      </ThemeProvider>
    </AppProvider>
  )
}
