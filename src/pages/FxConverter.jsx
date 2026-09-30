import React, { useMemo, useState } from 'react'
import { TopBar } from '../ui.jsx'
import { FX_RATES, fxConvert, fmt } from '../utils.js'

const KEYS = Object.keys(FX_RATES)

export default function FxConverter({ nav }) {
  const [amount, setAmount] = useState('100')
  const [from, setFrom] = useState('CNY')
  const [to, setTo] = useState('USD')

  const v = Number(amount) || 0
  const result = useMemo(() => (v ? fxConvert(v, from, to) : 0), [v, from, to])
  const unitRate = fxConvert(1, from, to)

  const swap = () => { const t = from; setFrom(to); setTo(t) }

  return (
    <>
      <TopBar title="汇率换算" onBack={nav.pop} />
      <div className="page-body no-tab">
        <div className="card center-box" style={{ background: 'var(--grad)', color: '#fff' }}>
          <div style={{ fontSize: 13, opacity: .9 }}>
            {FX_RATES[from].sym} 1 {from} = {FX_RATES[to].sym} {fmt(unitRate, 4)} {to}
          </div>
          <div style={{ fontSize: 34, fontWeight: 800, margin: '10px 0 0', fontVariantNumeric: 'tabular-nums' }}>
            {FX_RATES[to].sym} {fmt(result)}
          </div>
          <div style={{ fontSize: 12.5, opacity: .85, marginTop: 4 }}>
            {FX_RATES[from].name} → {FX_RATES[to].name}
          </div>
        </div>

        <div className="card">
          <div className="field">
            <label>金额</label>
            <input className="input" type="number" inputMode="decimal" value={amount}
              onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="field" style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label>从</label>
              <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
                {KEYS.map((k) => <option key={k} value={k}>{FX_RATES[k].sym} {k} · {FX_RATES[k].name}</option>)}
              </select>
            </div>
            <button className="iconbtn" style={{ marginBottom: 2 }} onClick={swap} aria-label="交换">⇄</button>
            <div style={{ flex: 1 }}>
              <label>换成</label>
              <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
                {KEYS.map((k) => <option key={k} value={k}>{FX_RATES[k].sym} {k} · {FX_RATES[k].name}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div className="gtitle" style={{ padding: '14px 14px 8px' }}>常用汇率（1 外币 ≈ 人民币）</div>
          {KEYS.filter((k) => k !== 'CNY').map((k) => (
            <div key={k} className="cell" onClick={() => { setFrom(k); setTo('CNY') }}>
              <div className="cico">{FX_RATES[k].sym}</div>
              <div className="cmain">
                <div className="ctitle">{FX_RATES[k].name}</div>
                <div className="cdesc">{k}</div>
              </div>
              <div className="cright">
                <b style={{ color: 'var(--ink)' }}>¥{fmt(FX_RATES[k].rate, 4)}</b>
              </div>
            </div>
          ))}
        </div>

        <div className="muted center-box" style={{ lineHeight: 1.8 }}>
          离线参考汇率，数据不随市场实时更新，<br />交易请以银行当日牌价为准。
        </div>
      </div>
    </>
  )
}
