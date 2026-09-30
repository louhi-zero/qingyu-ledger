import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { emptyState, demoState } from './seed.js'
import { uid, todayStr, nowTime, nextRunDates, periodOf } from './utils.js'

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
  for (const k of ['avatar', 'wallpaper']) {
    const m = s.assetsMeta[k]
    if (!m || typeof m !== 'object') s.assetsMeta[k] = { at: null, hash: null }
    else {
      if (!('at' in m)) m.at = null
      if (!('hash' in m)) m.hash = null
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
