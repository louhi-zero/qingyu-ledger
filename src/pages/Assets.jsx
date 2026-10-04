import { Icon } from "../ui/icons.jsx"
import React, { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { TopBar, Sheet, Confirm, Empty } from '../ui.jsx'
import { ACCOUNT_TYPES } from '../seed.js'
import { accountBalance, netWorth, fmt, fmtCur, toBase, uid, round2, netWorthSeries } from '../utils.js'

const PALETTE = ['#ff8a65', '#42a5f5', '#66bb6a', '#ab47bc', '#ffa726', '#26c6da', '#ec407a', '#7e57c2']
const CURRENCIES = ['CNY', 'USD', 'EUR', 'JPY', 'GBP', 'HKD', 'AUD', 'CAD', 'SGD', 'KRW']

function blankAcc() {
  return { id: uid(), name: '', type: 'cash', icon: "svg:cash", initial: 0, color: PALETTE[0], currency: 'CNY' }
}

export default function Assets({ nav }) {
  const { state, set, toast } = useStore()
  const [edit, setEdit] = useState(null) // 编辑中的账户草稿
  const [delId, setDelId] = useState(null)

  const nw = useMemo(() => netWorth(state), [state])

  // 分组：信用卡 / 其他负债 / 资产账户
  const groups = useMemo(() => {
    const asset = [], credit = [], debt = []
    for (const a of state.accounts) {
      const bal = accountBalance(state, a.id)
      const t = ACCOUNT_TYPES.find((x) => x.type === a.type)
      const item = { ...a, balance: bal, typeName: t?.name || '自定义' }
      if (a.type === 'credit') credit.push(item)
      else if (t?.liability) debt.push(item)
      else asset.push(item)
    }
    return { asset, credit, debt }
  }, [state])

  const save = () => {
    if (!edit.name.trim()) { toast('请填写账户名称', 'err'); return }
    set((d) => {
      const idx = d.accounts.findIndex((a) => a.id === edit.id)
      const t = ACCOUNT_TYPES.find((x) => x.type === edit.type)
      const data = { ...edit, name: edit.name.trim(), initial: round2(Number(edit.initial) || 0), icon: edit.icon || t?.icon || "svg:star", currency: edit.currency || 'CNY' }
      // 类型切换后清理不适用于该类型的字段
      if (data.type !== 'credit') { delete data.billingDay; delete data.dueDay; delete data.creditLimit }
      if (data.type !== 'debt' && data.type !== 'claim') { delete data.rate; delete data.dueDate }
      if (idx >= 0) d.accounts[idx] = data
      else d.accounts.push(data)
    })
    toast('账户已保存')
    setEdit(null)
  }

  const doDelete = () => {
    const used = state.transactions.some((t) => t.accountId === delId || t.toAccountId === delId)
    set((d) => {
      d.accounts = d.accounts.filter((a) => a.id !== delId)
      if (used) {
        // 保留账单，解除关联
        for (const t of d.transactions) {
          if (t.accountId === delId) t.accountId = null
          if (t.toAccountId === delId) t.toAccountId = null
        }
      }
    })
    toast(used ? '账户已删除，相关账单已保留' : '账户已删除')
    setDelId(null)
  }

  const accCount = state.transactions.filter((t) => t.accountId === delId).length

  return (
    <>
      <TopBar
        title="资产管家"
        onBack={nav.pop}
        right={<button className="iconbtn" onClick={() => setEdit(blankAcc())}>＋</button>}
      />
      <div className="page-body no-tab">
        {/* 净资产概览 */}
        <div className="card" style={{ background: 'var(--grad)', color: '#fff', textAlign: 'center' }}>
          <div style={{ fontSize: 12, opacity: .85 }}>净资产（元）</div>
          <div style={{ fontSize: 36, fontWeight: 800, margin: '6px 0 14px', fontVariantNumeric: 'tabular-nums' }}>
            {nw.net < 0 ? '-' : ''}¥{fmt(Math.abs(nw.net))}
          </div>
          <div style={{ display: 'flex', background: 'rgba(255,255,255,.15)', borderRadius: 14, padding: '10px 0' }}>
            <div style={{ flex: 1, borderRight: '1px solid rgba(255,255,255,.2)' }}>
              <div style={{ fontSize: 11, opacity: .85 }}>总资产</div>
              <div style={{ fontWeight: 800, fontSize: 17, marginTop: 3 }}>¥{fmt(nw.asset)}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, opacity: .85 }}>总负债</div>
              <div style={{ fontWeight: 800, fontSize: 17, marginTop: 3 }}>¥{fmt(nw.debt)}</div>
            </div>
          </div>
        </div>

        {/* v1.4 净值趋势（每日快照，手写 SVG） */}
        <NetWorthTrend state={state} />

        {state.accounts.length === 0 && (
          <div className="card">
            <Empty icon="svg:account" text="还没有账户，添加现金、银行卡或支付宝等账户，就能自动统计净资产">
              <button className="btn" onClick={() => setEdit(blankAcc())}>＋ 添加账户</button>
            </Empty>
          </div>
        )}

        {groups.credit.length > 0 && (
          <div className="group">
            <div className="gtitle">信用卡 · {groups.credit.length}
              <button className="chip on" style={{ marginLeft: 'auto' }} onClick={() => nav.push({ page: 'creditCards', title: '信用卡' })}>管理 ›</button>
            </div>
            {groups.credit.map((a) => (
              <div key={a.id} className="cell" onClick={() => setEdit({ ...a, initial: String(a.initial) })}>
                <div className="cico" style={{ background: a.color + '22' }}>{a.icon}</div>
                <div className="cmain">
                  <div className="ctitle">{a.name}</div>
                  <div className="cdesc">{a.typeName}{Number(a.initial) ? ` · 期初 ${fmtCur(a.initial, a.currency)}` : ''}</div>
                </div>
                <div className="cright">
                  <b style={{ color: a.balance > 0 ? 'var(--expense)' : 'var(--ink)', fontSize: 15 }}>
                    {a.balance > 0 ? '-' : ''}{fmtCur(Math.abs(a.balance), a.currency)}
                  </b>
                  {a.currency !== 'CNY' && <div className="cdesc">折合 ¥{fmt(toBase(state, a.balance, a.currency))}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {groups.asset.length > 0 && (
          <div className="group">
            <div className="gtitle">资产账户 · {groups.asset.length}</div>
            {groups.asset.map((a) => (
              <div key={a.id} className="cell" onClick={() => setEdit({ ...a, initial: String(a.initial) })}>
                <div className="cico" style={{ background: a.color + '22' }}>{a.icon}</div>
                <div className="cmain">
                  <div className="ctitle">{a.name}</div>
                  <div className="cdesc">{a.typeName}{Number(a.initial) ? ` · 期初 ${fmtCur(a.initial, a.currency)}` : ''}</div>
                </div>
                <div className="cright">
                  <b style={{ color: a.balance < 0 ? 'var(--expense)' : 'var(--ink)', fontSize: 15 }}>
                    {a.balance < 0 ? '-' : ''}{fmtCur(Math.abs(a.balance), a.currency)}
                  </b>
                  {a.currency !== 'CNY' && <div className="cdesc">折合 ¥{fmt(toBase(state, a.balance, a.currency))}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {groups.debt.length > 0 && (
          <div className="group">
            <div className="gtitle">负债账户 · {groups.debt.length}
              <button className="chip on" style={{ marginLeft: 'auto' }} onClick={() => nav.push({ page: 'debts', title: '债务管理' })}>管理 ›</button>
            </div>
            {groups.debt.map((a) => (
              <div key={a.id} className="cell" onClick={() => setEdit({ ...a, initial: String(a.initial) })}>
                <div className="cico" style={{ background: a.color + '22' }}>{a.icon}</div>
                <div className="cmain">
                  <div className="ctitle">{a.name}</div>
                  <div className="cdesc">{a.typeName}{Number(a.initial) ? ` · 期初 ${fmtCur(a.initial, a.currency)}` : ''}</div>
                </div>
                <div className="cright">
                  <b style={{ color: a.balance > 0 ? 'var(--expense)' : 'var(--ink)', fontSize: 15 }}>
                    {a.balance > 0 ? '-' : ''}{fmtCur(Math.abs(a.balance), a.currency)}
                  </b>
                  {a.currency !== 'CNY' && <div className="cdesc">折合 ¥{fmt(toBase(state, a.balance, a.currency))}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {state.accounts.length > 0 && (
          <div className="card" style={{ background: 'var(--grad-soft)' }}>
            <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.8 }}>
              <Icon name="tag" size="1em" className="qy-inline-icon" /> 余额 = 期初金额 + 收入 − 支出（含转账）。<br />
              信用卡/花呗等负债账户，欠款会显示为负净资产。
            </div>
          </div>
        )}
      </div>

      {/* 编辑账户 */}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit && state.accounts.some((a) => a.id === edit.id) ? '编辑账户' : '添加账户'}>
        {edit && (
          <>
            <div className="field">
              <label>账户类型</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                {ACCOUNT_TYPES.map((t) => (
                  <button key={t.type} className={`gitem ${edit.type === t.type ? 'on' : ''}`}
                    onClick={() => setEdit({ ...edit, type: t.type, icon: t.icon })}>
                    <div className="gi">{t.icon}</div>
                    <span>{t.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>名称</label>
              <input className="input" value={edit.name} maxLength={12}
                placeholder="例如：招商工资卡"
                onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
            <div className="field">
              <label>期初余额（可填 0）</label>
              <input className="input" type="number" inputMode="decimal" value={edit.initial}
                onChange={(e) => setEdit({ ...edit, initial: e.target.value })} />
            </div>
            <div className="field">
              <label>币种（外币按设置-汇率折算为人民币统计）</label>
              <select className="input" value={edit.currency || 'CNY'}
                onChange={(e) => setEdit({ ...edit, currency: e.target.value })}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {edit.type === 'credit' && (
              <>
                <div className="field">
                  <label>信用额度（元）</label>
                  <input className="input" type="number" inputMode="decimal" value={edit.creditLimit || ''}
                    placeholder="例如 30000"
                    onChange={(e) => setEdit({ ...edit, creditLimit: Number(e.target.value) || 0 })} />
                </div>
                <div className="field">
                  <label>账单日 / 还款日（1-28 日）</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select className="input" value={edit.billingDay || ''}
                      onChange={(e) => setEdit({ ...edit, billingDay: Number(e.target.value) || null })}>
                      <option value="">账单日</option>
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d} 日</option>)}
                    </select>
                    <select className="input" value={edit.dueDay || ''}
                      onChange={(e) => setEdit({ ...edit, dueDay: Number(e.target.value) || null })}>
                      <option value="">还款日</option>
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d} 日</option>)}
                    </select>
                  </div>
                </div>
              </>
            )}
            {(edit.type === 'debt' || edit.type === 'claim') && (
              <>
                <div className="field">
                  <label>年利率（%，可留空）</label>
                  <input className="input" type="number" inputMode="decimal" value={edit.rate || ''}
                    placeholder="例如 4.5"
                    onChange={(e) => setEdit({ ...edit, rate: Number(e.target.value) || 0 })} />
                </div>
                <div className="field">
                  <label>到期日（可留空）</label>
                  <input className="input" type="date" value={edit.dueDate || ''}
                    onChange={(e) => setEdit({ ...edit, dueDate: e.target.value || null })} />
                </div>
              </>
            )}
            <div className="field">
              <label>图标颜色</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {PALETTE.map((c) => (
                  <button key={c} onClick={() => setEdit({ ...edit, color: c })}
                    style={{
                      width: 30, height: 30, borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: c, boxShadow: edit.color === c ? `inset 0 0 0 3px var(--card), 0 0 0 2px ${c}` : 'none',
                    }}>{edit.color === c ? <><Icon name="check" size="1em" className="qy-inline-icon" /></> : ''}</button>
                ))}
              </div>
            </div>
            <div className="btnrow">
              {state.accounts.some((a) => a.id === edit.id) && (
                <button className="btn danger" onClick={() => { setDelId(edit.id); setEdit(null) }}>删除</button>
              )}
              <button className="btn ghost" onClick={() => setEdit(null)}>取消</button>
              <button className="btn" onClick={save}>保存</button>
            </div>
          </>
        )}
      </Sheet>

      <Confirm
        open={!!delId}
        title="删除账户？"
        text={`该账户下已有 ${accCount} 笔账单关联。删除后账单会保留，但账户信息将被移除。`}
        okText="删除"
        danger
        onOk={doDelete}
        onCancel={() => setDelId(null)}
      />
    </>
  )
}

// v1.4 净值趋势卡：取最近 30 天快照画面积折线
function NetWorthTrend({ state }) {
  const series = useMemo(() => netWorthSeries(state, 30), [state])
  if (series.length < 2) {
    return (
      <div className="card">
        <div className="card-title">净值趋势</div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.8, marginTop: 8 }}>
          每天打开轻语记账，都会自动记录当日净资产，攒够两天就能看到趋势曲线。
        </div>
      </div>
    )
  }
  const W = 320
  const H = 90
  const P = 6
  const vals = series.map((s) => s.net)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || 1
  const pts = series.map((s, i) => [
    P + (i / (series.length - 1)) * (W - P * 2),
    H - P - ((s.net - min) / span) * (H - P * 2),
  ])
  const line = pts.map((p) => p.map((n) => Math.round(n * 10) / 10).join(',')).join(' ')
  const area = `${P},${H - P} ${line} ${W - P},${H - P}`
  const delta = round2(vals[vals.length - 1] - vals[0])
  const up = delta >= 0
  return (
    <div className="card">
      <div className="card-title">
        净值趋势
        <span className="muted" style={{ fontWeight: 400, marginLeft: 'auto' }}>近 {series.length} 天</span>
      </div>
      <div style={{ fontSize: 13, marginTop: 8 }}>
        {series[0].date.slice(5)} 至 {series[series.length - 1].date.slice(5)} 净资产
        <b style={{ color: up ? 'var(--green)' : 'var(--expense)', marginLeft: 4 }}>
          {up ? '+' : '-'}¥{fmt(Math.abs(delta))}
        </b>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', marginTop: 6, display: 'block' }} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="nwgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#nwgrad)" />
        <polyline points={line} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}
