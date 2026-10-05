/* v3.1 外链 scheme 直达：qingyu://open?page=<key> 解析（纯函数，便于单测）
 *
 * 白名单制：仅放行下方登记的页键，未登记/非法输入一律返回 null（不导航）——
 * 外部链接不可控，杜绝任意字符串变成路由注入。
 * 两类目标：tab（底部主页面，清栈切 tab）与 page（二级页，push 入栈带标题）。
 * 用法（QQ 群公告/文档外链）：qingyu://open?page=support 直达帮助与反馈。
 */
export const DEEP_LINK_SCHEME = 'qingyu'
export const DEEP_LINK_TABS = { home: '明细', charts: '图表', discover: '发现', profile: '我的' }
export const DEEP_LINK_PAGES = {
  ai: 'AI 分析', aiSettings: 'AI 设置', cloud: '云备份', scan: '扫描记账', support: '帮助与反馈',
}

export function parseAppUrl(url) {
  try {
    if (typeof url !== 'string') return null
    const m = /^qingyu:\/\/open\?page=([A-Za-z0-9_-]+)$/i.exec(url.trim())
    const key = m && m[1] ? m[1] : null
    if (!key) return null
    if (key in DEEP_LINK_TABS) return { tab: key, title: DEEP_LINK_TABS[key] }
    if (key in DEEP_LINK_PAGES) return { page: key, title: DEEP_LINK_PAGES[key] }
    return null
  } catch {
    return null
  }
}
