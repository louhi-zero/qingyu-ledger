/* v3.4 应用锁输入控件（解锁页与设置页共用，避免两处各写一套）
 *   PinPad      —— 3×4 数字键盘
 *   PatternPad  —— 3×3 九宫格手势（pointer 事件，触屏与鼠标通用）
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons.jsx'
import { normalizePattern, isValidPattern } from '../applock.js'

const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']

/** 数字键盘：受控组件，value 为已输入数字串 */
export function PinPad({ value = '', onChange, maxLen = 6, autoFocusKey = false }) {
  const onKey = useCallback((k) => {
    if (k === '⌫') { onChange(String(value).slice(0, -1)); return }
    if (!/^\d$/.test(k)) return
    if (String(value).length >= maxLen) return
    onChange(String(value) + k)
  }, [value, onChange, maxLen])

  useEffect(() => {
    if (!autoFocusKey) return undefined
    const h = (e) => {
      if (/^\d$/.test(e.key)) onKey(e.key)
      else if (e.key === 'Backspace') onKey('⌫')
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [autoFocusKey, onKey])

  return (
    <div className="lock-kp">
      {PIN_KEYS.map((k, idx) => (
        k === ''
          ? <span key={idx} className="lock-kp-blank" aria-hidden="true" />
          : (
            <button key={idx} type="button" className="lock-kp-btn" onClick={() => onKey(k)} aria-label={k === '⌫' ? '删除' : k}>
              {k === '⌫' ? <Icon name="close" size="1em" className="qy-inline-icon" /> : k}
            </button>
          )
      ))}
    </div>
  )
}

/** 密码指示点 */
export function PinDots({ length = 4, filled = 0 }) {
  return (
    <div className="lock-dots" aria-hidden="true">
      {Array.from({ length }, (_, i) => <span key={i} className={'lock-dotp' + (i < filled ? ' on' : '')} />)}
    </div>
  )
}

/* 九宫格点位（百分比，3×3 均匀分布） */
const PAT_DOTS = Array.from({ length: 9 }, (_, i) => ({
  i,
  x: 20 + (i % 3) * 30,
  y: 20 + Math.floor(i / 3) * 30,
}))

/** 手势九宫格：绘制完成（或过短被拒）时回调 normalizePattern 串 */
export function PatternPad({ onDone, disabled }) {
  const boxRef = useRef(null)
  const [seq, setSeq] = useState([])
  const [drawing, setDrawing] = useState(false)
  const [cursor, setCursor] = useState(null)
  const seqRef = useRef([])

  const hit = useCallback((clientX, clientY) => {
    const el = boxRef.current
    if (!el) return -1
    const r = el.getBoundingClientRect()
    const x = ((clientX - r.left) / r.width) * 100
    const y = ((clientY - r.top) / r.height) * 100
    let best = -1
    let bestD = 12
    for (const d of PAT_DOTS) {
      const dist = Math.hypot(d.x - x, d.y - y)
      if (dist < bestD) { bestD = dist; best = d.i }
    }
    return best
  }, [])

  const push = useCallback((i) => {
    if (i < 0 || disabled) return
    if (seqRef.current.includes(i)) return
    seqRef.current = [...seqRef.current, i]
    setSeq(seqRef.current)
  }, [disabled])

  const start = (e) => {
    if (disabled) return
    e.preventDefault()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    seqRef.current = []
    setSeq([])
    setDrawing(true)
    push(hit(e.clientX, e.clientY))
    setCursor({ x: e.clientX, y: e.clientY })
  }
  const move = (e) => {
    if (!drawing || disabled) return
    e.preventDefault()
    push(hit(e.clientX, e.clientY))
    setCursor({ x: e.clientX, y: e.clientY })
  }
  const end = () => {
    if (!drawing) return
    setDrawing(false)
    setCursor(null)
    const raw = seqRef.current
    const code = normalizePattern(raw)
    const ok = isValidPattern(raw)
    seqRef.current = []
    setSeq([])
    if (code) onDone(code, ok)
  }

  const segs = useMemo(() => {
    const el = boxRef.current
    if (!el || seq.length === 0) return []
    const r = el.getBoundingClientRect()
    const pts = seq.map((i) => PAT_DOTS[i])
    const list = []
    for (let k = 0; k < pts.length - 1; k++) list.push([pts[k], pts[k + 1]])
    if (drawing && cursor) {
      list.push([pts[pts.length - 1], {
        x: ((cursor.x - r.left) / r.width) * 100,
        y: ((cursor.y - r.top) / r.height) * 100,
      }])
    }
    return list
  }, [seq, drawing, cursor])

  return (
    <div
      className="lock-pad"
      ref={boxRef}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      role="application"
      aria-label="手势密码，至少连接 4 个点"
    >
      <svg className="lock-pad-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {segs.map(([a, b], i) => (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="lock-pad-line" />
        ))}
      </svg>
      {PAT_DOTS.map((d) => (
        <span
          key={d.i}
          className={'lock-dot' + (seq.includes(d.i) ? ' on' : '')}
          style={{ left: d.x + '%', top: d.y + '%' }}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}
