﻿﻿﻿﻿﻿/* v1.5 设置主页：只留分组入口，点进二级子页（SettingsSections）后再做具体修改。
 * 各分组：个人资料 / 外观与个性化 / AI 助手 / 记账偏好 / 提醒与收支监控 / 数据与安全
 */
import React from 'react'
import { useStore } from '../store.jsx'
import { useNav } from '../App.jsx'
import { TopBar } from '../ui.jsx'
import { AvatarFace } from '../theme.jsx'

const APP_VERSION = '1.6.5'

export default function Settings({ nav }) {
  const { state } = useStore()
  const s = state.settings
  const go = (section, title) => nav.push({ page: 'settingsSection', title, params: { section } })

  return (
    <>
      <TopBar title="设置" onBack={nav.pop} />
      <div className="page-body no-tab">
        <div className="group">
          <div className="gtitle">个人</div>
          <div className="cell" onClick={() => go('profile', '个人资料')}>
            <div className="cico"><AvatarFace /></div>
            <div className="cmain">
              <div className="ctitle">个人资料</div>
              <div className="cdesc">昵称 · 头像 · 账本入口</div>
            </div>
            <div className="cright">{s.nickname}<span className="arrow">›</span></div>
          </div>
        </div>

        <div className="group">
          <div className="gtitle">外观</div>
          <div className="cell" onClick={() => go('appearance', '外观与个性化')}>
            <div className="cico">🎨</div>
            <div className="cmain">
              <div className="ctitle">外观与个性化</div>
              <div className="cdesc">液态玻璃 · 壁纸 · 启动页背景</div>
            </div>
            <div className="cright">
              {s.wallpaperAt && <span className="tico-preview">已设壁纸</span>}
              <span className="arrow">›</span>
            </div>
          </div>
        </div>

        <div className="group">
          <div className="gtitle">智能</div>
          <div className="cell" onClick={() => go('ai', 'AI 助手')}>
            <div className="cico">🤖</div>
            <div className="cmain">
              <div className="ctitle">AI 助手</div>
              <div className="cdesc">助手形象 · 智谱账单分析 · 偏好</div>
            </div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
        </div>

        <div className="group">
          <div className="gtitle">记账</div>
          <div className="cell" onClick={() => go('prefs', '记账偏好')}>
            <div className="cico">🧾</div>
            <div className="cmain">
              <div className="ctitle">记账偏好</div>
              <div className="cdesc">账期起始日 · 汇率 · 深色 · 金额模糊</div>
            </div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
        </div>

        <div className="group">
          <div className="gtitle">通知</div>
          <div className="cell" onClick={() => go('notify', '提醒与收支监控')}>
            <div className="cico">🔔</div>
            <div className="cmain">
              <div className="ctitle">提醒与收支监控</div>
              <div className="cdesc">每日提醒 · 微信/支付宝收支弹窗记账</div>
            </div>
            <div className="cright">
              {s.notifyCatch && <span className="tico-preview">监控中</span>}
              <span className="arrow">›</span>
            </div>
          </div>
        </div>

        <div className="group">
          <div className="gtitle">数据</div>
          <div className="cell" onClick={() => go('data', '数据与安全')}>
            <div className="cico">💾</div>
            <div className="cmain">
              <div className="ctitle">数据与安全</div>
              <div className="cdesc">备份恢复 · 云同步 · 回收站 · 分类管理</div>
            </div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
        </div>

        <div className="center-box muted" style={{ lineHeight: 1.8, padding: '6px 0 20px' }}>
          轻语记账 v{APP_VERSION}<br />所有功能免费 · 数据仅保存在本设备
        </div>
      </div>
    </>
  )
}
