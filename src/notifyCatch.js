/* v1.5 收支监控：Android 通知监听桥（原生 NotifyCatch 插件 + NotificationListenerService）
 *
 * - 仅 Android 原生环境可用；Web/Electron 一律返回 null/false 静默降级
 * - 原生只转发微信(com.tencent.mm)/支付宝(com.eg.android.AlipayGphone)的通知原文，
 *   解析统一走 utils.js 的 parseMoneyNotify 纯函数（可在 Node 侧单测）
 * - 动态 import + registerPlugin：包缺失/非原生一律静默，不影响 Web 构建
 * v1.6.8：testEmit 端到端测试通道 + listening 连接状态事件 + 回前台自动刷新
 * v2.0.2：离线暂存队列消费（fetchPendingNotifies/removePendingNotifies）+
 *   makeNotifyHandler 统一处理器（精确签名去重 + 本地规则 + AI 兜底解析）
 */
import { parseMoneyNotify } from './utils.js'

let proxyPromise = null

// 拿到原生插件代理；非 Android 或导入失败返回 null。
// 【严重修复】Capacitor 插件代理是 thenable（访问 .then 属性会按插件方法解析并抛
// "NotifyCatch.then() is not implemented"）。它绝不能成为任何 Promise 的结算值——
// async return / .then 回调返回 / await 都会触发 thenable 扁平化：promise 永久挂起 +
// Uncaught rejection。v1.5-v2.4 的 getNotifyCatch 正是 async return 了代理，
// 导致真机上监测功能整体失效（nativeOk 永远 false、实时监听挂不上、离线队列不消费）。
// 修复：包一层「非 thenable 门面」——屏蔽 then/catch/finally，其余属性转发原代理，
// 调用方零改动。
export function getNotifyCatch() {
  if (!proxyPromise) {
    proxyPromise = (async () => {
      try {
        const { registerPlugin, Capacitor } = await import('@capacitor/core')
        if (Capacitor.getPlatform() !== 'android') return null
        const proxy = registerPlugin('NotifyCatch')
        return new Proxy({}, {
          get(_t, prop, recv) {
            if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
            return Reflect.get(proxy, prop, proxy)
          },
        })
      } catch {
        return null
      }
    })()
  }
  return proxyPromise
}

let handleRef = null
let listeningHandleRef = null

// 启动监听（重复调用会先移除旧监听）。返回是否成功挂上事件。
export async function startNotifyCatch(onCaught, onListening) {
  const P = await getNotifyCatch()
  if (!P) return false
  try {
    stopNotifyCatch()
    handleRef = await P.addListener('caught', (n) => {
      try { onCaught(n || {}) } catch { /* 回调异常不影响监听 */ }
    })
    if (onListening) {
      listeningHandleRef = await P.addListener('listening', (e) => {
        try { onListening(!!e?.value) } catch { /* ignore */ }
      })
    }
    return true
  } catch {
    handleRef = null
    listeningHandleRef = null
    return false
  }
}

export function stopNotifyCatch() {
  try { handleRef?.remove?.() } catch { /* ignore */ }
  try { listeningHandleRef?.remove?.() } catch { /* ignore */ }
  handleRef = null
  listeningHandleRef = null
}

// 通知使用权是否已连接（系统已绑定 NotificationListenerService）
export async function isNotifyListening() {
  const P = await getNotifyCatch()
  if (!P) return false
  try {
    const r = await P.isListening()
    return !!r?.value
  } catch {
    return false
  }
}

// 跳转系统「通知使用权」设置页
export async function openNotifySettings() {
  const P = await getNotifyCatch()
  if (!P) return false
  try {
    await P.openSettings()
    return true
  } catch {
    return false
  }
}

// 注入一条模拟支付通知，走与真实通知完全相同的「插件→监听→解析→确认弹窗」链路
export async function testNotifyEmit(sample) {
  const P = await getNotifyCatch()
  if (!P) return false
  try {
    await P.testEmit(sample || {})
    return true
  } catch {
    return false
  }
}

// ---------------- v2.0.2 离线暂存队列（漏单修复核心） ----------------
// App 进程死亡时 WebView/插件随之销毁，实时 emit 全部蒸发（旧版监控"不起作用"的根因）。
// 原生侧 Service 收到通知先持久化入队（无论 App 死活），这里在启动/回前台消费补弹。

// 拉取离线暂存队列（新→旧），条目：{ key, title, text, pkg, ts }
export async function fetchPendingNotifies() {
  const P = await getNotifyCatch()
  if (!P) return []
  try {
    const r = await P.pendingList()
    return Array.isArray(r?.items) ? r.items : []
  } catch {
    return []
  }
}

// 按 key 删除已处理条目（弹窗确认/忽略后必须调用，否则下次启动重复弹）
export async function removePendingNotifies(keys) {
  const P = await getNotifyCatch()
  if (!P || !keys?.length) return false
  try {
    await P.pendingRemove({ keys })
    return true
  } catch {
    return false
  }
}

// 离线补弹测试：把样例写入持久化队列（模拟 App 死亡期间收到的通知）
export async function enqueuePendingSample(sample) {
  const P = await getNotifyCatch()
  if (!P) return false
  try {
    await P.pendingEnqueueSample(sample || {})
    return true
  } catch {
    return false
  }
}

// ---------------- 已处理签名持久化（跨启动去重） ----------------
// 场景：App 活着实时弹过 + 队列里同一条副本 → 下次启动不能重复弹。
// 签名含原生 postTime（同一条通知实例唯一），同文本不同时间的两笔支付不会被误杀。
const LS_SEEN = 'qingyu_notify_seen_v1' // { sig: handledAt(ms) }
const SEEN_TTL = 7 * 24 * 3600 * 1000
const SEEN_MAX = 300

function seenLoad() {
  try { return JSON.parse(localStorage.getItem(LS_SEEN) || '{}') || {} } catch { return {} }
}
export function seenHas(sig) {
  if (!sig) return false
  const t = seenLoad()[sig]
  return !!t && Date.now() - t < SEEN_TTL
}
export function seenMark(sig, at = Date.now()) {
  if (!sig) return
  try {
    const m = seenLoad()
    m[sig] = at
    const entries = Object.entries(m).filter(([, t]) => at - t < SEEN_TTL)
    const pruned = entries.length > SEEN_MAX ? entries.slice(-SEEN_MAX) : entries
    localStorage.setItem(LS_SEEN, JSON.stringify(Object.fromEntries(pruned)))
  } catch { /* ignore */ }
}

// ---------------- 统一通知处理器：去重 → 本地规则 → AI 兜底 ----------------
// 实时 emit 与离线队列共用：同一条通知（同 sig）只弹一次；
// 本地 parseMoneyNotify 认不出时，若配置了 AI key 且文本疑似支付语境，交给模型兜底。
// AI 门控：普通聊天/系统通知不带支付词直接跳过，不浪费 API 调用。
const QY_NOTIFY_AI_GATE = /支付|付款|收款|到账|转账|红包|退款|余额|金额|元|¥|￥|收钱|入账|扣|消费|零钱|已存|收益/
// 命中即跳过 AI（本地规则已按噪声处理）：提现是资金搬家，问模型只会浪费调用
const QY_NOTIFY_AI_SKIP = /提现/

export function makeNotifyHandler(onCatch, { aiFallback = true, loadCfg, onCleanup } = {}) {
  const memSeen = new Set() // 精确签名（含 ts），会话内防重
  const softSeen = new Map() // 软签名（不含 ts）15s 窗口，吸收系统对同通知的内容演进式重发
  const amtSeen = new Map() // v2.1 跨通道金额去重（pkg|amount|kind → {at, ch}）：
  // 同一笔支付常同时产生系统通知+支付页（无障碍），30s 内【跨通道】同金额同方向只弹一次；
  // 同通道重复（真两笔同金额支付）不再吞第二笔——v2.4 深测修复：旧版 30s 全局去重会静默丢弃真第二笔
  // 处理完成后清理离线副本：默认仅清通知队列；App 层注入 onCleanup 同时清支付页队列（双通道合流）
  const dropKey = (n) => {
    if (!n?.key) return
    try { if (onCleanup) onCleanup(n.key); else removePendingNotifies([n.key]) } catch { /* ignore */ }
  }
  return async (n) => {
    try {
      if (!n) return
      const isTest = !!n.test // 原生测试注入（testEmit/补弹测试）：跳过时间窗抑制，连点每次都弹
      const sig = `${n.pkg || ''}|${n.title || ''}|${n.text || ''}|${n.ts || ''}`
      const soft = `${n.pkg || ''}|${n.title || ''}|${n.text || ''}`
      // 已处理过（会话内 / 跨启动持久化）→ 静默清理离线副本
      if (memSeen.has(sig) || seenHas(sig)) { dropKey(n); return }
      // 软签名 15s 窗口：吸收系统对同通知的内容演进式重发（首条必放行）
      const last = softSeen.get(soft)
      if (!isTest && last !== undefined && n.ts && n.ts - last < 15000) { dropKey(n); return }
      memSeen.add(sig)
      if (memSeen.size > 200) memSeen.delete(memSeen.values().next().value)
      if (n.ts || !last) softSeen.set(soft, n.ts || Date.now())
      if (softSeen.size > 200) softSeen.delete(softSeen.keys().next().value)
      seenMark(sig)

      // 1) 本地规则（快、免费、覆盖标准支付通知）
      const p = parseMoneyNotify(n.title, n.text, n.pkg)
      if (p) {
        // 跨通道金额去重：同笔支付（通知+支付页）30s 内跨通道只弹一次；同通道真第二笔放行
        const amtKey = `${n.pkg || ''}|${p.amount}|${p.kind}`
        const ch = n.entry ? 'a11y' : 'notify'
        const lastAmt = amtSeen.get(amtKey)
        const nowMs = Date.now()
        if (!isTest && lastAmt && nowMs - lastAmt.at < 30000 && lastAmt.ch !== ch) { dropKey(n); return }
        if (!isTest) amtSeen.set(amtKey, { at: nowMs, ch })
        if (amtSeen.size > 100) amtSeen.delete(amtSeen.keys().next().value)
        // v2.1 无障碍捕获透传交易要素扩展（txDate/txTime/counterparty，通知流无此字段）
        const extra = n.entry ? { txDate: n.entry.txDate || null, txTime: n.entry.txTime || null, counterparty: n.entry.counterparty || null } : {}
        onCatch({ ...p, key: n.key || '', ...extra })
        return
      }
      // 2) AI 兜底：非支付语境直接跳过；无 AI key 静默
      if (!aiFallback) return
      const gate = `${n.title || ''} ${n.text || ''}`
      if (!QY_NOTIFY_AI_GATE.test(gate) || QY_NOTIFY_AI_SKIP.test(gate)) return
      try {
        const { loadAiCfg, aiParseNotify } = await import('./ai.js')
        const cfg = loadCfg ? loadCfg() : loadAiCfg()
        if (!cfg?.key) return
        const r = await aiParseNotify(cfg, n.title, n.text)
        if (!r) return
        if (r.amount != null) {
          const amtKey = `${n.pkg || ''}|${r.amount}|${r.kind}`
          const ch = n.entry ? 'a11y' : 'notify'
          const lastAmt = amtSeen.get(amtKey)
          if (!isTest && lastAmt && Date.now() - lastAmt.at < 30000 && lastAmt.ch !== ch) { dropKey(n); return }
          if (!isTest) amtSeen.set(amtKey, { at: Date.now(), ch })
        }
        onCatch({ ...r, title: String(n.title || '').slice(0, 40), text: String(n.text || '').slice(0, 120), key: n.key || '' })
      } catch { /* AI 失败静默，不影响主流程 */ }
    } catch { /* 单条处理异常不影响监听 */ }
  }
}
