/* v2.5 意见反馈：腾讯文档收集表打开逻辑（平台分流）
 *
 * - Android 原生：经 capacitor.config.json 的 server.allowNavigation(["docs.qq.com"])，
 *   主 WebView 直接导航到表单页——渲染与外部浏览器完全一致（iframe 嵌入被腾讯文档
 *   检测嵌套环境拒绝渲染，实测标题下内容空白，故弃用），用户填写提交后按系统返回键
 *   即回到应用（WebView 历史回退 localhost）
 * - 浏览器 / Electron：新标签 / 新窗口打开，不劫持本应用页面
 */
import { Capacitor } from '@capacitor/core'

export const FEEDBACK_URL = 'https://docs.qq.com/form/page/DWXJvZ0pZV3BoREdu'

export function openFeedback() {
  try {
    if (Capacitor.isNativePlatform()) {
      window.location.href = FEEDBACK_URL
      return true
    }
    window.open(FEEDBACK_URL, '_blank')
    return true
  } catch {
    return false
  }
}
