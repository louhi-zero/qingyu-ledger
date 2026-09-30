import React, { useEffect } from 'react'
import { useStore } from './store.jsx'
import { fmt } from './utils.js'

// 顶部导航
export function TopBar({ title, right, onBack, sub }) {
  return (
    <div className="topbar">
      <div className="side">
        {onBack && <button className="back" onClick={onBack} aria-label="返回">‹</button>}
      </div>
      <div className="title">
        {title}
        {sub && <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink3)' }}>{sub}</div>}
      </div>
      <div className="side r">{right}</div>
    </div>
  )
}

// 底部弹层
export function Sheet({ open, onClose, title, children, center }) {
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className={`mask ${center ? 'center' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className={`sheet ${center ? 'center' : ''}`}>
        <div className="sheet-head">
          <button className="sx" onClick={onClose} aria-label="关闭">✕</button>
          <div className="st">{title}</div>
          <div style={{ width: 30 }} />
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

// 分段控件
export function Seg({ options, value, onChange, style }) {
  return (
    <div className="seg" style={style}>
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// 进度条
export function Bar({ value, max, danger, warn, height = 10 }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className={`bar ${danger ? 'danger' : warn ? 'warn' : ''}`} style={{ height }}>
      <i style={{ width: `${pct}%` }} />
    </div>
  )
}

// 金额（支持隐藏）
export function Amount({ value, sign, className = '', digits = 2, prefix = '¥' }) {
  const { state } = useStore()
  if (state.settings.hideAmount) return <span className={`blur ${className}`}>{prefix}88.88</span>
  const s = sign ? (value > 0 ? '+' : value < 0 ? '-' : '') : ''
  return <span className={className}>{s}{prefix}{fmt(Math.abs(value), digits)}</span>
}

// 设置行
export function Cell({ icon, title, desc, right, onClick, children }) {
  return (
    <div className="cell" onClick={onClick} style={onClick ? { cursor: 'pointer' } : {}}>
      <div className="cico">{icon}</div>
      <div className="cmain">
        <div className="ctitle">{title}</div>
        {desc && <div className="cdesc">{desc}</div>}
      </div>
      <div className="cright">{right}{onClick && !right && <span className="arrow">›</span>}</div>
      {children}
    </div>
  )
}

// 空状态
export function Empty({ icon = '🍃', text, children }) {
  return (
    <div className="empty">
      <div className="eico">{icon}</div>
      <div className="etxt">{text}</div>
      {children}
    </div>
  )
}

// 开关
export function Switch({ on, onChange }) {
  // 阻止冒泡：开关常嵌在带 onClick 的 .cell 内，
  // 不拦截会冒泡触发外层切换，造成「点一次=切两次=无反应」
  return (
    <button
      type="button"
      className={`switch ${on ? 'on' : ''}`}
      onClick={(e) => { e.stopPropagation(); onChange(!on) }}
      aria-pressed={on}
      aria-label="开关"
    />
  )
}

// 数量统计小组件
export function StatRow({ items }) {
  return (
    <div className="stat3">
      {items.map((it) => (
        <div className="s3" key={it.k}>
          <div className="k">{it.k}</div>
          <div className="v" style={{ color: it.color || 'var(--ink)' }}>{it.v}</div>
        </div>
      ))}
    </div>
  )
}

// 确认对话框
export function Confirm({ open, title, text, onOk, onCancel, okText = '确定', danger }) {
  return (
    <Sheet open={open} onClose={onCancel} center>
      <div style={{ padding: '8px 6px 4px', textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{title}</div>
        <div className="muted" style={{ lineHeight: 1.7, marginBottom: 16 }}>{text}</div>
        <div className="btnrow">
          <button className="btn ghost" onClick={onCancel}>取消</button>
          <button className={`btn ${danger ? 'danger' : ''}`} onClick={onOk}>{okText}</button>
        </div>
      </div>
    </Sheet>
  )
}

// 日期选择（原生增强）
export function DatePicker({ value, onChange, label = '选择日期' }) {
  return (
    <input
      type="date" className="input" value={value} label={label}
      onChange={(e) => e.target.value && onChange(e.target.value)}
    />
  )
}

// Emoji 选择器
export const EMOJIS = ['🐣','😀','😎','🦊','🐼','🐱','🐶','🐰','🦁','🐯','🐨','🦄','🌙','⭐','🌸','🍀','💎','🚀','🎵','📖','🍜','🧋','💰','🏠','⚡','🔥','🧧','🎁','🪙','🌈']
export function EmojiPicker({ value, onChange }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
      {EMOJIS.map((e) => (
        <button key={e} onClick={() => onChange(e)}
          style={{
            fontSize: 22, padding: '8px 0', borderRadius: 12, cursor: 'pointer',
            border: 'none', background: value === e ? 'var(--brand-weak)' : 'var(--card)',
            boxShadow: value === e ? 'inset 0 0 0 2px var(--brand)' : 'var(--shadow-sm)',
          }}>{e}</button>
      ))}
    </div>
  )
}
