/* v1.4 记账提醒：Android 原生定时通知（@capacitor/local-notifications）
 *
 * - Capacitor 原生环境：requestPermissions + schedule 每日定时（id 固定 1001，
 *   先 cancel 再 schedule，改时间不留残留；系统闹钟在重启后由插件自动恢复）
 * - Web / Electron：返回 'web'，由 store.jsx 既有 Notification 轮询兜底
 * - 动态 import，包缺失/异常一律静默降级，不影响 Web 构建
 */
export const REMIND_ID = 1001

export async function isNativePlatform() {
  try {
    const { Capacitor } = await import('@capacitor/core')
    return !!Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

// 按 enabled/time 重排每日提醒；返回 'native'（已交给系统闹钟）| 'web'（走浏览器兜底）
export async function syncDailyReminder(enabled, time = '21:00') {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return 'web'
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: [{ id: REMIND_ID }] }).catch(() => {})
    if (!enabled) return 'native'
    const perm = await LocalNotifications.requestPermissions()
    if (perm && perm.display && perm.display !== 'granted') return 'native'
    const [h, m] = String(time || '21:00').split(':').map((x) => Number(x) || 0)
    await LocalNotifications.schedule({
      notifications: [{
        id: REMIND_ID,
        title: '轻语记账 · 该记一笔啦',
        body: '花一分钟记下今天的收支吧',
        schedule: { on: { hour: h, minute: m }, repeats: true, allowWhileIdle: true },
      }],
    })
    return 'native'
  } catch {
    return 'web'
  }
}
