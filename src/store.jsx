import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { emptyState, demoState } from './seed.js'
import { uid, todayStr, nowTime, nextRunDates, periodOf, netWorth, normalizeTabIconAt, normalizeDiscIconAt } from './utils.js'
import { blobDel } from './blobdb.js'
import { syncDailyReminder } from './notify.js'
import { stableJson } from './sync.js'
import { collectProfile, syncProfileArchive } from './userarchive.js'
import { runAutoSync } from './autosync.js'

const KEY = 'qingyu_state_v3'
const StoreCtx = createContext(null)

// 旧版本 state 向前迁移：只补缺，不覆盖用户已有值
export function migrateState(s) {
  if (!s || typeof s !== 'object') return s
  const d = emptyState()
  // settings 逐键补齐
  if (!s.settings || typeof s.settings !== 'object') s.settings = {}
  for (const k of Object.keys(d.settings)) {
    if (!(k in s.settings)) s.settings[k] = d.settings[k]
  }
  // v1.1 顶层新字段
  if (!s.aiReports || typeof s.aiReports !== 'object' || Array.isArray(s.aiReports)) s.aiReports = {}
  if (!s.assetsMeta || typeof s.assetsMeta !== 'object') s.assetsMeta = {}
  for (const k of ['avatar', 'wallpaper', 'welcomebg', 'aiface']) {
    const m = s.assetsMeta[k]
    if (!m || typeof m !== 'object') s.assetsMeta[k] = { at: null, hash: null }
    else {
      if (!('at' in m)) m.at = null
      if (!('hash' in m)) m.hash = null
    }
  }
  // v1.3 底部图标映射表需是普通对象
  if (!s.settings.tabIcons || typeof s.settings.tabIcons !== 'object' || Array.isArray(s.settings.tabIcons)) s.settings.tabIcons = {}
  // v1.6 底部菜单图标自定义恢复：图片时间戳表归一（本体在 IndexedDB 'tabicon_<page>'）
  s.settings.tabIconAt = normalizeTabIconAt(s.settings.tabIconAt)
  // v1.6.8 发现页功能图标时间戳表归一（本体在 IndexedDB 'discicon_<key>'）
  s.settings.discIconAt = normalizeDiscIconAt(s.settings.discIconAt)
  // v1.6.9 账本图标时间戳表归一（本体在 IndexedDB 'bookicon_<ledgerId>'，key 为账本 id，无固定键名）
  if (!s.settings.bookIconAt || typeof s.settings.bookIconAt !== 'object' || Array.isArray(s.settings.bookIconAt)) s.settings.bookIconAt = {}
  // v1.7.1 应用内更新：自动下载开关缺省关闭——发现新版先可视化询问，静默仅限下载不安装
  if (typeof s.settings.updateAutoDl !== 'boolean') s.settings.updateAutoDl = false
  // v1.11.0 坚果云同步开关：默认开启（已配置就同步），用户可手动关闭后昵称恢复正常显示
  if (typeof s.settings.cloudSyncOff !== 'boolean') s.settings.cloudSyncOff = false
  // v1.8.0 AI 风格：自定义参数表与角色名归一（角色卡本体只存本机 localStorage）
  if (!s.settings.aiStyleAttrs || typeof s.settings.aiStyleAttrs !== 'object' || Array.isArray(s.settings.aiStyleAttrs)) {
    s.settings.aiStyleAttrs = { tone: 'gentle', formality: 'balanced', length: 'std', structure: 'para' }
  }
  if (typeof s.settings.aiCharName !== 'string') s.settings.aiCharName = ''
  // v1.6.8 点击反馈拆分迁移：老版本只有 tapFeedback（缩放+震动合一开关）
  if (!('tapScale' in s.settings)) s.settings.tapScale = s.settings.tapFeedback !== false
  if (!('vibrateLevel' in s.settings)) {
    s.settings.vibrateLevel = s.settings.tapFeedback === false ? 0 : 2
  } else if (![0, 1, 2, 3].includes(Number(s.settings.vibrateLevel))) {
    s.settings.vibrateLevel = 2
  }
  // v1.2 记账模板 + 交易行级新字段（可选字段，逐行补默认即可）
  if (!Array.isArray(s.templates)) s.templates = []
  if (Array.isArray(s.transactions)) {
    for (const t of s.transactions) {
      if (!t || typeof t !== 'object') continue
      if (!Array.isArray(t.tags)) t.tags = []
      if (t.reimburse !== 'pending' && t.reimburse !== 'done') t.reimburse = 'none'
      if (!('attachAt' in t)) t.attachAt = null
      if (!('deletedAt' in t)) t.deletedAt = null // v1.4 回收站软删
    }
  }
  // v1.4 净值日快照
  if (!s.netWorthSnapshots || typeof s.netWorthSnapshots !== 'object' || Array.isArray(s.netWorthSnapshots)) {
    s.netWorthSnapshots = {}
  }
  // v1.3 资金管理：储蓄目标、汇率表、账户新字段（币种/信用卡/债务）
  if (!Array.isArray(s.goals)) s.goals = []
  if (!s.fxRates || typeof s.fxRates !== 'object' || Array.isArray(s.fxRates)) {
    s.fxRates = { USD: 7.12, EUR: 7.75, JPY: 0.0479, GBP: 9.05, HKD: 0.91, AUD: 4.72, CAD: 5.21, SGD: 5.35, KRW: 0.0052 }
  }
  if (Array.isArray(s.accounts)) {
    for (const a of s.accounts) {
      if (!a || typeof a !== 'object') continue
      if (!a.currency) a.currency = 'CNY'
      if (a.type === 'credit') {
        if (!(a.billingDay >= 1 && a.billingDay <= 28)) a.billingDay = null
        if (!(a.dueDay >= 1 && a.dueDay <= 28)) a.dueDay = null
        if (!Number.isFinite(a.creditLimit)) a.creditLimit = 0
      } else {
        delete a.billingDay; delete a.dueDay; delete a.creditLimit
      }
      if (a.type === 'debt' || a.type === 'claim') {
        if (!Number.isFinite(a.rate)) a.rate = 0
        if (!a.dueDate) a.dueDate = null
      } else {
        delete a.rate; delete a.dueDate
      }
    }
  }
  return s
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (!s || !s.version) return null
    return migrateState(s)
  } catch {
    return null
  }
}

export function AppProvider({ children }) {
  const [state, setState] = useState(() => load() || emptyState())
  const [toasts, setToasts] = useState([])
  const timers = useRef({})

  // 持久化
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* 忽略配额 */ }
  }, [state])

  // 深色模式
  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.dark ? 'dark' : 'light'
  }, [state.settings.dark])

  const set = useCallback((fn) => {
    setState((prev) => {
      const draft = structuredClone(prev)
      fn(draft)
      return draft
    })
  }, [])

  const toast = useCallback((msg, type = 'ok') => {
    const id = uid()
    setToasts((ts) => [...ts, { id, msg, type }])
    timers.current[id] = setTimeout(() => {
      setToasts((ts) => ts.filter((t) => t.id !== id))
    }, 2200)
  }, [])

  // 周期记账自动入账（冷启动补跑）
  useEffect(() => {
    let posted = 0
    setState((prev) => {
      if (!prev.recurring?.length) return prev
      const draft = structuredClone(prev)
      const today = todayStr()
      let changed = false
      for (const rec of draft.recurring) {
        if (!rec.enabled) continue
        const from = rec.lastRun ? rec.lastRun : null
        // 首次：从 startDate 当天开始（若 startDate 已过则从当天开始，避免历史洪灌）
        let startFrom = from
        if (!startFrom) {
          startFrom = rec.startDate > today ? null : rec.startDate
          // 防止 startDate 太久远，限制只补最近 35 天
          const limit = new Date(); limit.setDate(limit.getDate() - 35)
          const limitStr = limit.toISOString().slice(0, 10)
          if (startFrom && startFrom < limitStr) {
            const d = new Date(); d.setDate(d.getDate() - 35)
            startFrom = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          }
        }
        if (!startFrom || startFrom > today) continue
        const dates = nextRunDates(rec, startFrom, today)
        if (!dates.length) { rec.lastRun = startFrom; continue }
        for (const ds of dates) {
          draft.transactions.push({
            id: uid(), ledgerId: draft.currentLedgerId, date: ds, time: '08:00',
            type: rec.type, amount: rec.amount, categoryId: rec.categoryId,
            accountId: rec.accountId, note: (rec.note || '周期记账') + '·自动', createdAt: new Date().toISOString(),
          })
          posted++
        }
        rec.lastRun = today
        changed = true
      }
      return changed ? draft : prev
    })
    if (posted > 0) setTimeout(() => toast(`已自动记入 ${posted} 笔周期账单`, 'ok'), 600)
  }, [])

  // v1.4 启动时：写当日净值快照 + 清理回收站超 30 天的账单
  useEffect(() => {
    setState((prev) => {
      if (!prev.settings?.welcomed) return prev
      const draft = structuredClone(prev)
      let changed = false
      // 当日净值快照（覆盖式：以当天最后一次打开为准）
      const nw = netWorth(draft)
      const today = todayStr()
      const cur = draft.netWorthSnapshots?.[today]
      if (!cur || cur.net !== nw.net || cur.asset !== nw.asset || cur.debt !== nw.debt) {
        if (!draft.netWorthSnapshots || typeof draft.netWorthSnapshots !== 'object') draft.netWorthSnapshots = {}
        draft.netWorthSnapshots[today] = { asset: nw.asset, debt: nw.debt, net: nw.net, at: new Date().toISOString() }
        changed = true
      }
      // 回收站：软删超 30 天物理清除
      const limit = Date.now() - 30 * 86400000
      const purged = []
      const keep = []
      for (const t of draft.transactions) {
        if (t.deletedAt && new Date(t.deletedAt).getTime() < limit) purged.push(t.id)
        else keep.push(t)
      }
      if (purged.length) {
        draft.transactions = keep
        changed = true
        // 附件本体一并清理（异步，失败忽略）
        for (const id of purged) blobDel(`att_${id}`).catch(() => {})
      }
      return changed ? draft : prev
    })
  }, [])

  // 每日记账提醒（Notification API）
  useEffect(() => {
    if (!state.settings.remindEnabled) return
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'default') Notification.requestPermission().catch(() => {})
    if (Notification.permission !== 'granted') return
    const timer = setInterval(() => {
      const now = new Date()
      const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      const key = 'qingyu_remind_' + todayStr()
      if (hm >= state.settings.remindTime && !localStorage.getItem(key)) {
        localStorage.setItem(key, '1')
        try {
          new Notification('轻语记账 · 该记一笔啦', { body: '花一分钟记下今天的收支吧' })
        } catch { /* ignore */ }
      }
    }, 30000)
    return () => clearInterval(timer)
  }, [state.settings.remindEnabled, state.settings.remindTime])

  // v1.4 Android 原生定时提醒：开关/时间变化与冷启动时重排（Web 端内部静默降级）
  useEffect(() => {
    syncDailyReminder(state.settings.remindEnabled, state.settings.remindTime)
  }, [state.settings.remindEnabled, state.settings.remindTime])

  // v1.9.0 用户资料云存档：昵称/头像等资料变化（含冷启动自愈/首次建档）→ 防抖打包上传。
  // 签名不变不触发；未配置 WebDAV 时内部静默跳过。失败策略：资料变化触发弹 err，冷启动自愈静默记档。
  const profileSig = stableJson(collectProfile(state.settings))
  const firstProfileRun = useRef(true)
  useEffect(() => {
    const isFirst = firstProfileRun.current
    firstProfileRun.current = false
    const t = setTimeout(() => {
      syncProfileArchive(state, { toast, silent: isFirst })
    }, isFirst ? 6000 : 2500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileSig])

  const actions = {
    set,
    toast,
    loadDemo() {
      setState(demoState())
      toast('已加载示例数据')
    },
    clearAll() {
      const s = emptyState()
      s.settings.welcomed = true
      setState(s)
      toast('已清空全部数据')
    },
    // 从 JSON 全量备份恢复；校验通过才覆盖，返回是否成功
    restoreState(s) {
      const ok = s && typeof s === 'object' && s.version
        && s.settings && typeof s.settings === 'object'
        && s.categories && Array.isArray(s.ledgers) && s.ledgers.length > 0
        && Array.isArray(s.transactions)
      if (!ok) return false
      setState(migrateState(structuredClone(s)))
      return true
    },
  }

  // v1.10.0 账单自动同步：冷启动自动导入 + 数据变化防抖双向同步（未配置 WebDAV 时内部静默跳过）。
  // 签名用 useMemo 包裹，避免 toast 等无关渲染重复序列化全量 state；
  // restoreState 写回内容一致则签名不变，订阅不会空转（防循环收敛）。
  const dataSig = useMemo(() => stableJson(state), [state])
  const firstDataRun = useRef(true)
  const autoBusy = useRef(false)
  const autoRedo = useRef(false)
  const runAuto = useCallback(async (silent) => {
    // 防重入：同步期间又有新变化只记补跑标志，当前轮结束后稍后补跑一轮保证最终一致
    if (autoBusy.current) { autoRedo.current = true; return }
    autoBusy.current = true
    try {
      await runAutoSync({ state, restoreState: actions.restoreState, toast, silent })
    } finally {
      autoBusy.current = false
    }
    if (autoRedo.current) {
      autoRedo.current = false
      setTimeout(() => { runAuto(true) }, 1500)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, toast])

  useEffect(() => {
    const isFirst = firstDataRun.current
    firstDataRun.current = false
    const t = setTimeout(() => runAuto(isFirst), isFirst ? 8000 : 3000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSig])

  return (
    <StoreCtx.Provider value={{ state, ...actions, toasts }}>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>
        ))}
      </div>
      {children}
    </StoreCtx.Provider>
  )
}

export const useStore = () => useContext(StoreCtx)
