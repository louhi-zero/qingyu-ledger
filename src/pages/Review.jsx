import React, { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { TopBar } from '../ui.jsx'
import {
  genReview, currentPeriod, periodAdd, periodLabel, fmt,
} from '../utils.js'

const LEVEL_STYLE = {
  理性型: { color: '#22b573', bg: 'rgba(34,181,115,.12)', icon: '🏆' },
  均衡型: { color: '#2fa886', bg: 'rgba(59,201,140,.12)', icon: '👍' },
  随性型: { color: '#ff9f2e', bg: 'rgba(255,159,46,.14)', icon: '🌤️' },
  豪爽型: { color: '#ff6b5e', bg: 'rgba(255,107,94,.12)', icon: '🔥' },
}

export default function Review({ nav }) {
  const { state, set, toast } = useStore()
  const [period, setPeriod] = useState(currentPeriod(state.settings.monthStartDay))

  const r = useMemo(() => genReview(state, period), [state, period])
  const ls = LEVEL_STYLE[r.level]
  const isCur = period === currentPeriod(state.settings.monthStartDay)

  // 环形评分
  const size = 150, thick = 12
  const circ = 2 * Math.PI * ((size - thick) / 2)

  return (
    <>
      <TopBar
        title="消费点评"
        onBack={nav.pop}
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="iconbtn" onClick={() => setPeriod(periodAdd(period, -1, state.settings.monthStartDay))}>‹</button>
            <button className="iconbtn" onClick={() => setPeriod(periodAdd(period, 1, state.settings.monthStartDay))}>›</button>
          </div>
        }
      />
      <div className="page-body no-tab">
        <div className="ymnav"><span className="ym">{periodLabel(period)}{isCur ? ' · 本期' : ''}</span></div>

        {/* 评分卡 */}
        <div className="card center-box">
          <div style={{ position: 'relative', width: size, height: size, margin: '4px auto' }}>
            <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
              <circle cx={size / 2} cy={size / 2} r={(size - thick) / 2} fill="none" stroke="var(--card2)" strokeWidth={thick} />
              <circle cx={size / 2} cy={size / 2} r={(size - thick) / 2} fill="none"
                stroke={ls.color} strokeWidth={thick} strokeLinecap="round"
                strokeDasharray={`${(r.score / 100) * circ} ${circ}`} />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 40 }}>{ls.icon}</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: ls.color, fontVariantNumeric: 'tabular-nums' }}>{r.score}</div>
              <span style={{ fontSize: 12, color: 'var(--ink3)', marginTop: -2 }}>消费健康分</span>
            </div>
          </div>
          <div style={{ margin: '10px 0 4px' }}>
            <span style={{ background: ls.bg, color: ls.color, fontWeight: 800, fontSize: 14, padding: '5px 16px', borderRadius: 20 }}>
              {r.level}消费者
            </span>
          </div>
        </div>

        {/* 三宫格 */}
        <div className="card" style={{ padding: 12 }}>
          <div className="stat3">
            <div className="s3"><div className="k">支出</div><div className="v" style={{ color: 'var(--expense)' }}>¥{fmt(r.exp)}</div></div>
            <div className="s3"><div className="k">收入</div><div className="v" style={{ color: 'var(--income)' }}>¥{fmt(r.inc)}</div></div>
            <div className="s3"><div className="k">{r.bal < 0 ? '超支' : '结余'}</div><div className="v" style={{ color: r.bal >= 0 ? 'var(--green)' : 'var(--expense)' }}>¥{fmt(Math.abs(r.bal))}</div></div>
          </div>
        </div>

        {/* 点评正文 */}
        <div className="card">
          <div className="card-title" style={{ marginBottom: 10 }}>📝 轻语点评</div>
          {r.lines.map((line, i) => (
            <div key={i} style={{
              display: 'flex', gap: 10, padding: '10px 12px', marginBottom: 8,
              background: 'var(--card2)', borderRadius: 13, fontSize: 13.5, lineHeight: 1.7,
            }}>
              <span style={{ flexShrink: 0 }}>{i === 0 ? '📊' : i < 3 ? '🔍' : '💡'}</span>
              <span>{line}</span>
            </div>
          ))}
        </div>

        {/* 支出 Top5 */}
        {r.top.length > 0 && (
          <div className="card">
            <div className="card-title" style={{ marginBottom: 8 }}>🏅 支出榜 Top {r.top.length}</div>
            {r.top.map((c, i) => (
              <div key={c.id} className="rankrow">
                <div className="rk">{i + 1}</div>
                <div className="rmain">
                  <div className="rname">
                    <span>{c.icon} {c.name}</span>
                    <span className="rv">¥{fmt(c.value)} · {Math.round((c.value / r.exp) * 100)}%</span>
                  </div>
                  <div className="rbar"><i style={{ width: `${Math.round((c.value / r.top[0].value) * 100)}%`, background: c.color }} /></div>
                </div>
              </div>
            ))}
          </div>
        )}

        {isCur && (
          <button className="btn ghost" onClick={() => {
            set((d) => { d.review = { period, score: r.score, level: r.level, at: new Date().toISOString() } })
            toast('本期点评已存档')
          }}>存档本期点评</button>
        )}
      </div>
    </>
  )
}
