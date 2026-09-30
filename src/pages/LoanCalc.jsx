import React, { useMemo, useState } from 'react'
import { TopBar, Seg } from '../ui.jsx'
import { loanCalc, fmt } from '../utils.js'

export default function LoanCalc({ nav }) {
  const [mode, setMode] = useState('commercial') // commercial / fund / combo
  const [method, setMethod] = useState('bx') // bx 等额本息 / bj 等额本金
  const [amount, setAmount] = useState('100') // 商贷（万）
  const [fund, setFund] = useState('60') // 公积金（万）
  const [years, setYears] = useState('30')
  const [rateC, setRateC] = useState('3.6')
  const [rateF, setRateF] = useState('2.85')
  const [showAll, setShowAll] = useState(false)

  const r = useMemo(() => loanCalc({
    mode,
    amount: (Number(amount) || 0) * 10000,
    fund: (Number(fund) || 0) * 10000,
    years: Number(years) || 30,
    rateC: Number(rateC) || 0,
    rateF: Number(rateF) || 0,
    method,
  }), [mode, amount, fund, years, rateC, rateF, method])

  const field = (label, value, onChange, suffix, opts = {}) => (
    <div className="field">
      <label>{label}</label>
      <div style={{ position: 'relative' }}>
        <input className="input" type="number" inputMode="decimal" value={value}
          onChange={(e) => onChange(e.target.value)} style={{ paddingRight: 44 }} />
        <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 12.5, color: 'var(--ink3)' }}>{suffix}</span>
      </div>
      {opts.hint && <div className="muted" style={{ marginTop: 5 }}>{opts.hint}</div>}
    </div>
  )

  return (
    <>
      <TopBar title="房贷计算器" onBack={nav.pop} />
      <div className="page-body no-tab">
        <div className="card">
          <div className="field" style={{ marginBottom: 14 }}>
            <label>贷款类型</label>
            <Seg options={[
              { value: 'commercial', label: '商业贷款' },
              { value: 'fund', label: '公积金' },
              { value: 'combo', label: '组合贷' },
            ]} value={mode} onChange={setMode} />
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>还款方式</label>
            <Seg options={[
              { value: 'bx', label: '等额本息' },
              { value: 'bj', label: '等额本金' },
            ]} value={method} onChange={setMethod} />
          </div>
          {mode !== 'fund' && field('商业贷款金额', amount, setAmount, '万元')}
          {mode === 'combo' && field('公积金贷款金额', fund, setFund, '万元')}
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>{field('贷款年限', years, setYears, '年')}</div>
            <div style={{ flex: 1 }}>{field('商贷年利率', rateC, setRateC, '%')}</div>
          </div>
          {mode !== 'commercial' && field('公积金年利率', rateF, setRateF, '%')}
        </div>

        {/* 结果 */}
        <div className="card" style={{ background: 'var(--grad)', color: '#fff' }}>
          <div style={{ fontSize: 12, opacity: .85 }}>{method === 'bx' ? '每月还款（等额本息）' : '首月还款（逐月递减）'}</div>
          <div style={{ fontSize: 34, fontWeight: 800, margin: '4px 0 2px', fontVariantNumeric: 'tabular-nums' }}>
            ¥{fmt(method === 'bx' ? r.monthly : r.firstMonth)}
          </div>
          {method === 'bj' && (
            <div style={{ fontSize: 12, opacity: .85 }}>末月 ¥{fmt(r.lastMonth)}，每月递减</div>
          )}
          <div style={{ display: 'flex', marginTop: 14, background: 'rgba(255,255,255,.15)', borderRadius: 14, padding: '10px 0' }}>
            <div style={{ flex: 1, borderRight: '1px solid rgba(255,255,255,.2)' }}>
              <div style={{ fontSize: 11, opacity: .85 }}>贷款总额</div>
              <div style={{ fontWeight: 800, marginTop: 2 }}>¥{fmt(r.principal)}</div>
            </div>
            <div style={{ flex: 1, borderRight: '1px solid rgba(255,255,255,.2)' }}>
              <div style={{ fontSize: 11, opacity: .85 }}>支付利息</div>
              <div style={{ fontWeight: 800, marginTop: 2 }}>¥{fmt(r.totalInterest)}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, opacity: .85 }}>还款总额</div>
              <div style={{ fontWeight: 800, marginTop: 2 }}>¥{fmt(r.totalPayment)}</div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '14px 14px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="card-title">📅 还款计划</div>
            <button className="chip" onClick={() => setShowAll((v) => !v)}>{showAll ? '收起' : '展开全部'}</button>
          </div>
          <table className="plain" style={{ margin: '4px 0' }}>
            <thead>
              <tr><th>期数</th><th>月供</th><th>本金</th><th>利息</th><th>剩余</th></tr>
            </thead>
            <tbody>
              {(showAll ? r.months : r.months.slice(0, 12)).map((m) => (
                <tr key={m.idx}>
                  <td>{m.idx}</td>
                  <td>{fmt(m.payment)}</td>
                  <td>{fmt(m.principal)}</td>
                  <td>{fmt(m.interest)}</td>
                  <td>{fmt(m.remain)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!showAll && r.count > 12 && (
            <div className="muted center-box" style={{ padding: '8px 0 12px' }}>共 {r.count} 期，点击右上角展开</div>
          )}
        </div>

        <div className="muted center-box" style={{ padding: '0 8px', lineHeight: 1.8 }}>
          利率为参考值，实际以银行审批为准。计算结果仅供参考。
        </div>
      </div>
    </>
  )
}
