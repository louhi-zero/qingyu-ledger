/* v2.1 无障碍交易捕获（AccessibilityService 替代截图记录方式）：
 * - 原生 QyA11yService 只监听微信/支付宝（config XML packageNames 锁定），
 *   支付页出现时采集文本节点 → 预过滤（金额+收支关键词双命中）→ 持久化入队 + 实时 emit
 * - pageToNotifyEntry：页面文本 → 交易要素提取（纯函数，可单测）
 *     金额（¥/￥/两位小数+元，精确到分）、方向（页面标签判定，收款方不误判为收入）、
 *     交易对象（收款方/付款方/对方/商户行）、交易时间（页面内时间行，精确到秒）
 * - 提取结果合成为通知条目复用 makeNotifyHandler 管线（去重/本地规则/AI 兜底/弹窗队列）
 * - 页面签名 24h 去重（同内容页面只弹一次）+ 离线队列补弹（App 被杀不漏单）
 * - 权限：isA11yEnabled 精确检测本服务是否开启；openA11ySettings 供分步引导跳转
 */
import { makeNotifyHandler } from './notifyCatch.js'

let proxyPromise = null

// 【严重修复】同 notifyCatch.getNotifyCatch：代理是 thenable，绝不能作为 Promise 结算值
// （async return / .then 回调返回都会扁平化挂死），包非 thenable 门面规避。
export function getA11yCatch() {
  if (!proxyPromise) {
    proxyPromise = (async () => {
      try {
        const { registerPlugin, Capacitor } = await import('@capacitor/core')
        if (Capacitor.getPlatform() !== 'android') return null
        const proxy = registerPlugin('A11yCatch')
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

// 无障碍服务状态：{ enabled: 系统设置里已开启, connected: 服务已连接 }
export async function getA11yStatus() {
  const P = await getA11yCatch()
  if (!P) return { enabled: false, connected: false }
  try {
    const r = await P.isA11yEnabled()
    return { enabled: !!r?.value, connected: !!r?.connected }
  } catch {
    return { enabled: false, connected: false }
  }
}

// 跳转系统「无障碍」设置页
export async function openA11ySettings() {
  const P = await getA11yCatch()
  if (!P) return false
  try {
    await P.openA11ySettings()
    return true
  } catch {
    return false
  }
}

let pageHandleRef = null
let connHandleRef = null

// 启动实时页面监听（重复调用先移除旧监听）
export async function startA11yCatch(onPage, onConnected) {
  const P = await getA11yCatch()
  if (!P) return false
  try {
    stopA11yCatch()
    pageHandleRef = await P.addListener('page', (n) => {
      try { onPage(n || {}) } catch { /* 回调异常不影响监听 */ }
    })
    if (onConnected) {
      connHandleRef = await P.addListener('a11yConnected', (e) => {
        try { onConnected(!!e?.value) } catch { /* ignore */ }
      })
    }
    return true
  } catch {
    pageHandleRef = null
    connHandleRef = null
    return false
  }
}

export function stopA11yCatch() {
  try { pageHandleRef?.remove?.() } catch { /* ignore */ }
  try { connHandleRef?.remove?.() } catch { /* ignore */ }
  pageHandleRef = null
  connHandleRef = null
}

// ---------------- 离线暂存队列 ----------------

export async function fetchPendingPages() {
  const P = await getA11yCatch()
  if (!P) return []
  try {
    const r = await P.pendingList()
    return Array.isArray(r?.items) ? r.items : []
  } catch {
    return []
  }
}

export async function removePendingPages(keys) {
  const P = await getA11yCatch()
  if (!P || !keys?.length) return false
  try {
    await P.pendingRemove({ keys })
    return true
  } catch {
    return false
  }
}

// 离线补弹测试：样例支付页入队
export async function enqueuePendingSample(sample) {
  const P = await getA11yCatch()
  if (!P) return false
  try {
    await P.pendingEnqueueSample(sample || {})
    return true
  } catch {
    return false
  }
}

// 端到端测试：注入模拟支付页文本（走与真实捕获完全相同的链路）
export async function testA11yEmit(sample) {
  const P = await getA11yCatch()
  if (!P) return false
  try {
    await P.testA11yEmit(sample || {})
    return true
  } catch {
    return false
  }
}

// ---------------- 页面签名去重（24h，同内容页面只弹一次） ----------------

const LS_A11Y_SEEN = 'qingyu_a11y_seen_v1' // { sig: ts }
const A11Y_SEEN_TTL = 24 * 3600 * 1000
const A11Y_SEEN_MAX = 100

function a11ySeenLoad() {
  try { return JSON.parse(localStorage.getItem(LS_A11Y_SEEN) || '{}') || {} } catch { return {} }
}
function a11ySeenHas(sig) {
  if (!sig) return false
  const t = a11ySeenLoad()[sig]
  return !!t && Date.now() - t < A11Y_SEEN_TTL
}
function a11ySeenMark(sig, at = Date.now()) {
  if (!sig) return
  try {
    const m = a11ySeenLoad()
    m[sig] = at
    const entries = Object.entries(m).filter(([, t]) => at - t < A11Y_SEEN_TTL)
    const pruned = entries.length > A11Y_SEEN_MAX ? entries.slice(-A11Y_SEEN_MAX) : entries
    localStorage.setItem(LS_A11Y_SEEN, JSON.stringify(Object.fromEntries(pruned)))
  } catch { /* ignore */ }
}

// ---------------- 提取算法：页面文本 → 交易要素（纯函数，可单测） ----------------

const A11Y_INCOME_LABEL = /收款成功|到账|入账|收钱码|收到转账|转账已收取|领取红包|红包已存入|已收钱|收钱成功|退款成功|退回|返现|收益发放/
const A11Y_EXPENSE_LABEL = /支付成功|付款成功|支付完成|付款完成|扣款成功|已支付|支付金额|付款金额|转账给|向.*转账|消费成功|充值成功|代扣成功/
const A11Y_AMOUNT = /[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)|([0-9]+(?:\.[0-9]{1,2})?)\s*元/
// 标签后必须跟冒号/空白（否则「付款方式 余额」会被「付款方」前缀误匹配）
const A11Y_COUNTERPARTY = /^(?:收款方|付款方|对方|商户|商家|收款人|付款人)(?:[:：]|\s)\s*(.+)$/
const A11Y_TRANSFER_TO = /^(?:转账给|转入)\s*[:：]?\s*(\S{1,20})$/
const A11Y_TIME = /(\d{4}-\d{1,2}-\d{1,2})[ T](\d{1,2}:\d{2}(?::\d{2})?)/
const A11Y_NOISE = /广告|推荐|领福利|查账单|群公告|多清晰|扫一扫|收付款|我的|首页/

/** 数字金额归一：精确到分（两位小数，round2 语义） */
function toFen(n) {
  return Math.round(n * 100) / 100
}

/**
 * 页面文本 → 合成通知条目（交给 makeNotifyHandler 管线）。
 * texts: 字符串数组（无障碍采集的页面文本节点，顺序为页面从上到下）；
 * 返回 { title, text, txDate?, txTime?, counterparty? }；非支付页返回 null。
 * 合成文本刻意构造为 parseMoneyNotify 可确定性解析的形态：
 *   支出 → 「微信支付-25.00 收款方名」（带负号锁定支出方向）
 *   收入 → 「微信支付收款25.00元 收款人名」
 */
export function pageToNotifyEntry(texts, pkg = '') {
  const list = (Array.isArray(texts) ? texts : [])
    .map((t) => String(t || '').trim())
    // 千分位归一（支付页大金额「¥1,068.00」→ 1068.00，循环处理百万位）
    .map((t) => { while (/(\d),(\d{3})(?!\d)/.test(t)) t = t.replace(/(\d),(\d{3})(?!\d)/g, '$1$2'); return t })
    .filter((t) => t && !A11Y_NOISE.test(t))
  if (!list.length) return null
  const joined = list.join(' ')

  // 1) 金额：取第一个命中（支付结果页主金额居首；「支付金额 ¥25.00」标签行+数值行结构天然兼容）
  const m = joined.match(A11Y_AMOUNT)
  if (!m) return null
  const amount = toFen(Number(m[1] || m[2]))
  if (!(amount > 0) || amount > 1e7) return null
  const amountStr = amount.toFixed(2)

  // 2) 方向：页面标签判定（先看收入标签；「收款方」是支出页的对方字段，不在收入标签里）
  const isIncome = A11Y_INCOME_LABEL.test(joined)
  const isExpense = A11Y_EXPENSE_LABEL.test(joined)
  if (!isIncome && !isExpense) return null
  // 同时命中（如「转账给张三」+「退款退回」同页）→ 以金额行附近更近的标签为准，取保守支出
  const kind = isIncome && !isExpense ? 'income' : 'expense'

  // 3) 交易对象：标签行提取（收款方：星巴克 / 商户 便利蜂 / 转账给 王五）
  let counterparty = ''
  for (const line of list) {
    const cm = line.match(A11Y_COUNTERPARTY) || line.match(A11Y_TRANSFER_TO)
    if (cm) { counterparty = cm[1].trim().slice(0, 20); break }
  }
  // 收入转账无标签行时：找金额行附近的名字样文本（2-20 字、无金额符号、非功能词/标签词）
  if (!counterparty && kind === 'income') {
    const amountIdx = list.findIndex((l) => A11Y_AMOUNT.test(l))
    for (let d = 1; d <= 2 && amountIdx >= 0; d++) {
      for (const i of [amountIdx - d, amountIdx + d]) {
        const l = list[i]
        if (l && /^[^¥￥元0-9]{2,20}$/.test(l) && !A11Y_INCOME_LABEL.test(l) && !A11Y_EXPENSE_LABEL.test(l)
          && !/^(微信支付|支付宝|零钱|余额|余额宝|银行卡)$/.test(l)) {
          counterparty = l.slice(0, 20)
          break
        }
      }
      if (counterparty) break
    }
  }

  // 4) 交易时间（页面内的交易时间行，精确到秒；没有则由弹窗默认当前时间）
  let txDate = null
  let txTime = null
  const tm = joined.match(A11Y_TIME)
  if (tm) {
    const [, d, t] = tm
    const [y, mo, dd] = d.split('-')
    txDate = `${y}-${mo.padStart(2, '0')}-${dd.padStart(2, '0')}`
    const [hh, mm] = t.split(':')
    txTime = `${hh.padStart(2, '0')}:${mm}`
  }

  // 5) 来源与合成文本（parseMoneyNotify 可确定性解析）
  const isWechat = pkg === 'com.tencent.mm' || /微信/.test(joined)
  const source = isWechat ? 'wechat' : pkg === 'com.eg.android.AlipayGphone' || /支付宝/.test(joined) ? 'alipay' : 'wechat'
  const app = isWechat ? '微信支付' : '支付宝'
  const who = counterparty ? ` ${counterparty}` : ''
  const title = app
  const text = kind === 'expense'
    ? `${app}-${amountStr}${who}`
    : `${app}收款${amountStr}元${who}`

  return { title, text, amount, kind, source, counterparty: counterparty || null, txDate, txTime }
}

// ---------------- A11y 统一处理器：页面签名去重 → 提取 → 复用通知管线 ----------------

export function makeA11yHandler(onCatch, opts = {}) {
  // notifyHandler 可注入共享实例（App 层把通知流与无障碍流合流到同一管线，
  // 跨通道金额去重依赖同一份 amtSeen：同一笔支付的通知+支付页只弹一次）
  const notifyHandler = opts.notifyHandler || makeNotifyHandler(onCatch, opts)
  return async (page) => {
    try {
      if (!page || !page.sig) return
      const cleanup = () => { if (page.key) removePendingPages([page.key]) }
      // 同内容页面 24h 只处理一次（同页面停留反复触发/重复打开账单页）
      if (a11ySeenHas(page.sig)) { cleanup(); return }
      a11ySeenMark(page.sig, page.ts || Date.now())
      const entry = pageToNotifyEntry(page.texts, page.pkg)
      if (!entry) { cleanup(); return }
      // 合成通知条目进入既有管线（去重/本地规则/AI 兜底/弹窗队列），透传交易要素与 test 标记
      await notifyHandler({
        key: page.key || '',
        pkg: page.pkg || '',
        ts: page.ts || Date.now(),
        title: entry.title,
        text: entry.text,
        entry,
        test: !!page.test,
      })
    } catch { /* 单页异常不影响服务 */ }
  }
}
