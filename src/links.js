/* v2.5 社交与社区链接（作者渠道）+ 统一外链打开
 *
 * 打开策略（openExternal）：
 * - 原生：优先 scheme 直拉对应 App（B站 bilibili://space/...，WebView 停留原地）；
 *   1.2s 内页面仍可见（未装 App，scheme 静默失败）→ fallback 用 https 链接
 *   导航（依赖 capacitor.config.json allowNavigation 白名单域），
 *   网页版会再引导进入 App；未匹配白名单的外域由 Capacitor 转交系统浏览器
 * - 浏览器 / Electron：新标签打开
 */
import { Capacitor } from '@capacitor/core'

export const LINKS = {
  bilibili: {
    name: 'B站',
    url: 'https://space.bilibili.com/3546602511797107?spm_id_from=333.1007.0.0',
    scheme: 'bilibili://space/3546602511797107',
  },
  xiaoheihe: {
    name: '小黑盒',
    url: 'https://www.xiaoheihe.cn/app/user/profile/104962942',
  },
  douyin: {
    name: '抖音',
    url: 'https://www.douyin.com/user/self',
  },
  qqGroup: {
    name: '次元茶馆',
    url: 'https://qm.qq.com/q/ekDzByBiso',
  },
}

let schemePending = false

export function openExternal(url, scheme) {
  try {
    if (Capacitor.isNativePlatform()) {
      if (scheme && !schemePending) {
        schemePending = true
        window.location.href = scheme
        // 拉起 App 后页面 hidden；1.2s 后仍可见说明本机没有对应应用 → https 兜底
        setTimeout(() => {
          schemePending = false
          if (document.visibilityState === 'visible') window.location.href = url
        }, 1200)
        return true
      }
      window.location.href = url
      return true
    }
    window.open(url, '_blank')
    return true
  } catch {
    return false
  }
}
