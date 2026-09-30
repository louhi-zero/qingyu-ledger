import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react'
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
import CategoryManage from './pages/CategoryManage.jsx'
import CloudBackup from './pages/CloudBackup.jsx'
import AddTx from './pages/AddTx.jsx'
import AiInsight from './pages/AiInsight.jsx'
import AiSettings from './pages/AiSettings.jsx'
import { ThemeProvider, Backdrop } from './theme.jsx'

const NavCtx = createContext(null)
export const useNav = () => useContext(NavCtx)

const TAB_PAGES = {
  home: { title: '明细', comp: Home },
  charts: { title: '图表', comp: ChartsPage },
  add: { title: '记账', comp: null },
  discover: { title: '发现', comp: Discover },
  profile: { title: '我的', comp: Profile },
}

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
  category: CategoryManage,
  cloud: CloudBackup,
  ai: AiInsight,
  aiSettings: AiSettings,
}

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

  const openAdd = (tx = null) => { setEditTx(tx); setAddOpen(true) }
  const closeAdd = () => { setAddOpen(false); setEditTx(null) }

  const nav = { push, pop, openAdd, tab, setTab }

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
    return (
      <div className="phone">
        <div className="welcome">
          <div className="wlogo">📖</div>
          <h1>轻语记账</h1>
          <p>花一分钟，记下今天的收支</p>
          <button className="btn" onClick={() => { set((d) => { d.settings.welcomed = true }) }}>从零开始记</button>
          <div style={{ height: 10 }} />
          <button className="btn ghost" onClick={() => { set((d) => { d.settings.welcomed = true }) }}>先随便看看（稍后可在设置加载示例数据）</button>
        </div>
      </div>
    )
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
        {!stack.length && (
          <nav className="tabbar">
            {Object.entries(TAB_PAGES).map(([key, cfg]) =>
              key === 'add' ? (
                <button key={key} className="tab-add" onClick={() => openAdd(null)} aria-label="记一笔">
                  <div className="plus">+</div>
                </button>
              ) : (
                <button key={key} className={`tab ${tab === key ? 'on' : ''}`} onClick={() => setTab(key)}>
                  <span className="tico">{key === 'home' ? '📒' : key === 'charts' ? '📊' : key === 'discover' ? '🧭' : '👤'}</span>
                  <span>{cfg.title}</span>
                </button>
              ),
            )}
          </nav>
        )}

        {/* 记一笔 / 编辑账单 */}
        <AddTx
          key={editTx ? editTx.id : 'new'}
          open={addOpen}
          editTx={editTx}
          onClose={() => { setAddOpen(false); setEditTx(null) }}
        />
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
