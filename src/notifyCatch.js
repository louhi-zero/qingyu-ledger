/* v1.5 收支监控：Android 通知监听桥（原生 NotifyCatch 插件 + NotificationListenerService）
 *
 * - 仅 Android 原生环境可用；Web/Electron 一律返回 null/false 静默降级
 * - 原生只转发微信(com.tencent.mm)/支付宝(com.eg.android.AlipayGphone)的通知原文，
 *   解析统一走 utils.js 的 parseMoneyNotify 纯函数（可在 Node 侧单测）
 * - 动态 import + registerPlugin：包缺失/非原生一律静默，不影响 Web 构建
 * v1.6.8：testEmit 端到端测试通道 + listening 连接状态事件 + 回前台自动刷新
 */

let proxyPromise = null

// 拿到原生插件代理；非 Android 或导入失败返回 null
export function getNotifyCatch() {
  if (!proxyPromise) {
    proxyPromise = (async () => {
      try {
        const { registerPlugin, Capacitor } = await import('@capacitor/core')
        if (Capacitor.getPlatform() !== 'android') return null
        return registerPlugin('NotifyCatch')
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
