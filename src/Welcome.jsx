/* v2.3 启动流程重构：Splash 启动页 + Intro 功能介绍页（对标主流 App onboarding）
 *
 * Splash 启动页：每次启动都展示（SPLASH_MS 2200ms，可点击跳过）
 * - 真实应用图标（public/icon-512.png，白底圆角 + 投影 + 入场/悬浮动画）
 * - 品牌名 + 标语 + 底部进度条（CSS 动画与 SPLASH_MS 同步）+ 版本号
 * - 支持自定义「启动页背景」（设置-外观，useWelcomeBg），自动加深色蒙版保证可读性
 *
 * Intro 功能介绍页：仅首次启动（welcomed=false）展示，滑动/按钮翻页
 * - 五页核心价值：三秒记一笔 / 看清每一分钱 / AI 智能分析（API 接入）/ 高度自定义 / 数据安全省心
 * - 圆点指示器 + 右上角「跳过」+ 底部「下一步 → 开始使用」+ 保留「先随便看看」演示入口
 *
 * 测试钩子：localStorage 'qingyu_splash_off' === '1' 时跳过整个启动流程（直入主界面），
 * 冒烟/截图脚本使用，真实用户不受影响。
 */
import React, { useEffect, useRef, useState } from 'react'
import { APP_VERSION } from './update.js'
import { useWelcomeBg } from './theme.jsx'

export const SPLASH_MS = 2200

// 启动页：图标 + 品牌动画，SPLASH_MS 后自动进入下一阶段（点击任意处可提前跳过）
export function Splash({ onDone }) {
  const bg = useWelcomeBg()
  // 用 ref 固定回调：父组件重渲染不重置定时器（保证 2.2s 计时稳定）
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  useEffect(() => {
    const t = setTimeout(() => doneRef.current(), SPLASH_MS)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="splash" onClick={onDone} role="button" aria-label="轻语记账启动页，点击进入">
      {bg && <img className="splash-bg" src={bg} alt="" decoding="async" draggable={false} />}
      {bg && <div className="splash-veil" />}
      <div className="splash-core">
        <img className="splash-icon" src="./icon-512.png" alt="轻语记账" decoding="async" draggable={false} />
        <h1>轻语记账</h1>
        <p>花一分钟，记下今天的收支</p>
      </div>
      <div className="splash-foot">
        <div className="splash-bar"><i /></div>
        <span className="splash-ver">v{APP_VERSION}</span>
      </div>
    </div>
  )
}

// 功能介绍页：五页轮播（触屏滑动 + 圆点 + 按钮），结束进入主界面
const SLIDES = [
  {
    emoji: '⚡', deco: ['💸', '🏷️'],
    title: '三秒记一笔',
    desc: '极简表单 + 智能分类，随手记下每笔收支；账本、账户自动对齐，还能扫码识别票据',
  },
  {
    emoji: '📊', deco: ['🎯', '🔁'],
    title: '看清每一分钱',
    desc: '图表趋势、预算预警、周期记账、资产负债，钱花在哪一目了然',
  },
  {
    emoji: '🤖', deco: ['🧠', '✨'],
    title: 'AI 智能分析',
    desc: '自己的 API Key 接入智谱大模型：账单一键点评、月度总结自动生成，回复风格与角色扮演随心定制',
  },
  {
    emoji: '🎨', deco: ['🖼️', '🌈'],
    title: '高度自定义',
    desc: '壁纸、启动页、底部图标、账本封面随意换；液态玻璃浓度、震动反馈档位，都由你说了算',
  },
  {
    emoji: '🛡️', deco: ['☁️', '🤳'],
    title: '数据安全省心',
    desc: '数据默认仅存本机，可自选同步坚果云；AI 智能解析，收支自动弹窗记账',
  },
]

export function Intro({ onStart }) {
  const [idx, setIdx] = useState(0)
  const touchX = useRef(null)
  const last = SLIDES.length - 1
  const next = () => { idx >= last ? onStart() : setIdx(idx + 1) }
  const prev = () => { if (idx > 0) setIdx(idx - 1) }
  const onTouchStart = (e) => { touchX.current = e.touches?.[0]?.clientX ?? null }
  const onTouchEnd = (e) => {
    if (touchX.current == null) return
    const dx = (e.changedTouches?.[0]?.clientX ?? touchX.current) - touchX.current
    touchX.current = null
    if (dx < -40) next()
    else if (dx > 40) prev()
  }
  return (
    <div className="intro" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <button className="intro-skip" onClick={onStart} type="button">跳过</button>
      <div className="intro-track" style={{ transform: `translateX(-${idx * 100}%)` }}>
        {SLIDES.map((s, i) => (
          <div className={'intro-slide' + (i === idx ? ' on' : '')} key={i} aria-hidden={i !== idx}>
            <div className="intro-art">
              <span className="intro-blob">{s.emoji}</span>
              <span className="intro-chip c1" aria-hidden="true">{s.deco[0]}</span>
              <span className="intro-chip c2" aria-hidden="true">{s.deco[1]}</span>
            </div>
            <h2>{s.title}</h2>
            <p>{s.desc}</p>
          </div>
        ))}
      </div>
      <div className="intro-foot">
        <div className="intro-dots">
          {SLIDES.map((_, i) => (
            <button key={i} type="button" className={i === idx ? 'on' : ''} onClick={() => setIdx(i)} aria-label={`第 ${i + 1} 页`} />
          ))}
        </div>
        <button className="btn intro-next" onClick={next} type="button">
          {idx === last ? '🚀 开始使用' : '下一步'}
        </button>
        <button className="intro-demo" onClick={onStart} type="button">先随便看看（稍后可在设置加载示例数据）</button>
      </div>
    </div>
  )
}
