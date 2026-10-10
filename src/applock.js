/* v3.4 应用锁（本地隐私保护）
 *
 * 对标薄荷记账的「数字密码 / 手势密码」，补齐轻语记账缺失的隐私门禁。
 *
 * 存储策略：**全部状态只存本机 localStorage（qingyu_lock_v1），不入 state、不随 WebDAV 同步**。
 *   原因：密码哈希若随云同步到第二台设备，会出现「锁是开的、但这台设备没设过密码」
 *   → 直接把自己锁死。锁是「设备级」属性，不是「账号级」属性。
 *   这与项目里 AI API Key、风格卡本体的处理口径一致（见 ai.js / securestore.js）。
 *
 * 校验：SHA-256(salt + code)。优先用 crypto.subtle（Capacitor https://localhost 与
 *   Node 18+ 均可用）；file:// 桌面端无 subtle 时回落到 FNV-1a——本锁只挡「拿到手机的人」，
 *   不挡「能读 localStorage 的人」（那种情况任何前端锁都无解），故回落可接受。
 *
 * 自动锁定：autoMin 分钟无交互后回到前台重新上锁；0 = 每次切回前台都锁。
 */
import { useEffect, useRef, useState, useCallback } from 'react'

export const LOCK_KEY = 'qingyu_lock_v1'

export const LOCK_TYPES = [
  { v: 'pin', label: '数字密码', desc: '4~6 位数字，键盘输入' },
  { v: 'pattern', label: '手势密码', desc: '九宫格连线，至少 4 个点' },
]

export const LOCK_AUTO = [
  { v: 0, label: '立即' },
  { v: 1, label: '1 分钟' },
  { v: 5, label: '5 分钟' },
  { v: 30, label: '30 分钟' },
  { v: -1, label: '不自动锁定' },
]

/* ---------- 存储 ---------- */

export function readLockCfg() {
  try {
    const raw = localStorage.getItem(LOCK_KEY)
    if (!raw) return null
    const d = JSON.parse(raw)
    if (!d || typeof d !== 'object' || !d.on) return null
    if (d.type !== 'pin' && d.type !== 'pattern') return null
    if (typeof d.salt !== 'string' || typeof d.hash !== 'string') return null
    return {
      on: true,
      type: d.type,
      salt: d.salt,
      hash: d.hash,
      len: Number(d.len) || 0, // pin 位数（解锁页据此自动提交）
      autoMin: typeof d.autoMin === 'number' ? d.autoMin : 1,
      at: Number(d.at) || 0,
    }
  } catch { return null }
}

export function writeLockCfg(cfg) {
  try {
    if (!cfg || !cfg.on) localStorage.removeItem(LOCK_KEY)
    else localStorage.setItem(LOCK_KEY, JSON.stringify(cfg))
  } catch { /* 配额/隐私模式：静默，锁不可用但不影响主流程 */ }
}

export function clearLock() {
  try { localStorage.removeItem(LOCK_KEY) } catch { /* ignore */ }
}

/* ---------- 哈希 ---------- */

function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return ('00000000' + h.toString(16)).slice(-8)
}

export async function hashCode(salt, code) {
  const text = `${salt}::${code}`
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
    }
  } catch { /* 回落 */ }
  // 回落：多轮 FNV-1a，仅作本机门禁，不承担抗破解职责
  let h = fnv1a(text)
  for (let i = 0; i < 5000; i++) h = fnv1a(h + text)
  return h
}

function newSalt() {
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const a = new Uint8Array(16)
      crypto.getRandomValues(a)
      return Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join('')
    }
  } catch { /* ignore */ }
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/* ---------- 校验码格式（纯函数，单测覆盖） ---------- */

export function normalizePin(code) {
  return String(code || '').replace(/\D/g, '').slice(0, 6)
}
export function isValidPin(code) {
  const c = normalizePin(code)
  return c.length >= 4 && c.length <= 6
}
/** 手势：点索引数组 → 规范化串（如 '0-1-2-5'）；至少 4 点、不重复 */
export function normalizePattern(points) {
  const seen = []
  for (const p of points || []) {
    const n = Number(p)
    if (!Number.isInteger(n) || n < 0 || n > 8) continue
    if (seen.includes(n)) continue
    seen.push(n)
  }
  return seen.join('-')
}
export function isValidPattern(points) {
  const arr = String(normalizePattern(points)).split('-').filter((x) => x !== '')
  return arr.length >= 4
}

/* ---------- Hook ---------- */

/** 距上次离开前台多久算「需要重新上锁」；autoMin=-1 表示从不自动锁 */
export function shouldRelock(cfg, hiddenMs) {
  if (!cfg || !cfg.on) return false
  if (cfg.autoMin < 0) return false
  return hiddenMs >= cfg.autoMin * 60 * 1000
}

export function useAppLock() {
  const [cfg, setCfg] = useState(() => readLockCfg())
  const [locked, setLocked] = useState(() => !!readLockCfg())
  const [error, setError] = useState('')
  const hiddenAt = useRef(0)
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg

  const apply = useCallback((next) => {
    writeLockCfg(next)
    setCfg(next && next.on ? next : null)
  }, [])

  // 自动锁定：记录隐藏时刻，回到前台按 autoMin 判定
  useEffect(() => {
    const onHide = () => { hiddenAt.current = Date.now() }
    const onShow = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { onHide(); return }
      if (!hiddenAt.current) return
      const gap = Date.now() - hiddenAt.current
      hiddenAt.current = 0
      if (shouldRelock(cfgRef.current, gap)) setLocked(true)
    }
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('blur', onHide)
    window.addEventListener('focus', onShow)
    return () => {
      document.removeEventListener('visibilitychange', onShow)
      window.removeEventListener('blur', onHide)
      window.removeEventListener('focus', onShow)
    }
  }, [])

  const verify = useCallback(async (code) => {
    const cur = cfgRef.current
    if (!cur) return true
    const h = await hashCode(cur.salt, code)
    return h === cur.hash
  }, [])

  /** 校验并解锁；失败返回 false 并置错误文案 */
  const unlock = useCallback(async (code) => {
    const ok = await verify(code)
    if (ok) { setLocked(false); setError('') }
    else setError('密码不正确，再试一次')
    return ok
  }, [verify])

  /** 开启或修改：需提供旧密码（已开启时） */
  const setCode = useCallback(async (type, code, { oldCode = null, autoMin } = {}) => {
    const cur = cfgRef.current
    if (cur && cur.on) {
      const ok = await hashCode(cur.salt, oldCode || '')
      if (ok !== cur.hash) { setError('原密码不正确'); return false }
    }
    const salt = newSalt()
    const hash = await hashCode(salt, code)
    const next = {
      on: true,
      type,
      salt,
      hash,
      len: type === 'pin' ? normalizePin(code).length : 0,
      autoMin: typeof autoMin === 'number' ? autoMin : (cur?.autoMin ?? 1),
      at: Date.now(),
    }
    apply(next)
    setLocked(false)
    setError('')
    return true
  }, [apply])

  /** 关闭：需提供当前密码 */
  const disable = useCallback(async (code) => {
    const cur = cfgRef.current
    if (!cur) return true
    const ok = await hashCode(cur.salt, code || '')
    if (ok !== cur.hash) { setError('密码不正确'); return false }
    apply(null)
    setLocked(false)
    setError('')
    return true
  }, [apply])

  const setAutoMin = useCallback((min) => {
    const cur = cfgRef.current
    if (!cur) return
    apply({ ...cur, autoMin: Number(min) })
  }, [apply])

  const lockNow = useCallback(() => { if (cfgRef.current) setLocked(true) }, [])

  return {
    on: !!cfg,
    type: cfg?.type || 'pin',
    len: cfg?.len || 0,
    autoMin: cfg?.autoMin ?? 1,
    locked,
    error,
    setError,
    unlock,
    verify,
    setCode,
    disable,
    setAutoMin,
    lockNow,
  }
}
