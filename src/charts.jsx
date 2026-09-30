import React from 'react'
import { fmt, fmt0 } from './utils.js'

// 环形图（分类占比）
export function Donut({ data, size = 168, thickness = 26, centerLabel, centerValue }) {
  const total = data.reduce((a, d) => a + d.value, 0)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let offset = 0
  if (!total) {
    return (
      <div className="chart-wrap" style={{ display: 'flex', justifyContent: 'center' }}>
        <svg width={size} height={size}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--card2)" strokeWidth={thickness} />
        </svg>
      </div>
    )
  }
  return (
    <div className="chart-wrap" style={{ display: 'flex', justifyContent: 'center' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {data.map((d, i) => {
          const frac = d.value / total
          const dash = frac * c
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={d.color} strokeWidth={thickness}
              strokeDasharray={`${Math.max(dash - 2, 1)} ${c}`} strokeDashoffset={-offset}
              strokeLinecap="round" />
          )
          offset += dash
          return el
        })}
      </svg>
      <div className="donut-center">
        <div className="l1">{centerLabel}</div>
        <div className="l2">{centerValue}</div>
      </div>
    </div>
  )
}

// 柱状图
export function Bars({ data, height = 150, color = 'var(--brand)', fmtVal = fmt0, highlightIndex = -1 }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height, padding: '0 2px' }}>
        {data.map((d, i) => {
          const h = Math.max((d.value / max) * (height - 34), d.value > 0 ? 4 : 2)
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }} title={`${d.label}: ${fmt(d.value)}`}>
              {d.value > 0 && (
                <div style={{ fontSize: 9, color: 'var(--ink3)', marginBottom: 3, whiteSpace: 'nowrap' }}>{fmtVal(d.value)}</div>
              )}
              <div style={{
                width: '72%', maxWidth: 30, height: h, borderRadius: 6,
                background: i === highlightIndex ? color : `color-mix(in srgb, ${color} 55%, var(--card))`,
                transition: 'height .3s',
              }} />
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '6px 2px 0' }}>
        {data.map((d, i) => (
          <div key={i} style={{
            flex: 1, textAlign: 'center', fontSize: 10, color: i === highlightIndex ? 'var(--ink)' : 'var(--ink3)',
            fontWeight: i === highlightIndex ? 700 : 400, whiteSpace: 'nowrap', overflow: 'hidden',
          }}>{d.label}</div>
        ))}
      </div>
    </div>
  )
}

// 预算环形进度
export function Ring({ pct, size = 96, thickness = 10, color = 'var(--brand)', track = 'var(--card2)' }) {
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const p = Math.min(pct, 100)
  return (
    <div className="chart-wrap" style={{ width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={thickness} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={thickness}
          strokeDasharray={`${(p / 100) * c} ${c}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray .4s' }} />
      </svg>
      <div className="donut-center">
        <div className="l2" style={{ fontSize: 17 }}>{Math.round(pct)}%</div>
        <div className="l1">已使用</div>
      </div>
    </div>
  )
}

// 迷你折线（趋势用）
export function Spark({ values, width = 100, height = 30, color = 'var(--brand)' }) {
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const pts = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * width
    const y = height - ((v - min) / Math.max(max - min, 1)) * height
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={width} height={height}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
