import { Icon } from "../ui/icons.jsx"
import React, { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { ValueIcon } from '../ui/icons.jsx'
import { TopBar, Sheet, Empty } from '../ui.jsx'
import { accountBalance, creditDue, creditCycleStart, daysToDue, fmt, uid, todayStr, nowTime, round2 } from '../utils.js'

export default function CreditCards({ nav }) {
  const { state, set, toast } = useStore()
  const today = todayStr()
  const [settingCard, setSettingCard] = useState(null) // 卡设置草稿
  const [repayCard, setRepayCard] = useState(null) // 还款中的卡
  const [repayAmt, setRepayAmt] = useState('')
  const [repayFrom, setRepayFrom] = useState('')

  const cards = useMemo(() => state.accounts.filter((a) => a.type === 'credit').map((a) => {
    const bal = accountBalance(state, a.id)
    const used = Math.max(0, -bal)
    const limit = Number(a.creditLimit) || 0
    const due = creditDue(state, a, today)
    const left = daysToDue(a, today)
    return {
      ...a, balance: bal, used,
      available: limit > 0 ? round2(limit - used) : null,
      due, cycleStart: creditCycleStart(a, today), left,
    }
  }), [state, today])

  const payAccounts = state.accounts.filter((a) => a.type !== 'credit')

  const openRepay = (c) => {
    setRepayCard(c)
    setRepayAmt(c.due != null && c.due > 0 ? String(c.due) : '')
    setRepayFrom(payAccounts[0]?.id || '')
  }

  const doRepay = () => {
    const amt = round2(Number(repayAmt))
    if (!(amt > 0)) { toast('请输入还款金额', 'err'); return }
    if (!repayFrom) { toast('请选择付款账户', 'err'); return }
    set((d) => {
      d.transactions.push({
        id: uid(), ledgerId: d.currentLedgerId, date: todayStr(), time: nowTime(),
        type: 'transfer', amount: amt, categoryId: null,
        accountId: repayFrom, toAccountId: repayCard.id,
        note: `信用卡还款·${repayCard.name}`, tags: [], reimburse: 'none', attachAt: null,
        createdAt: new Date().toISOString(),
      })
    })
    toast(`已还款 ${fmt(amt)} 元`)
    setRepayCard(null)
  }

  const saveSetting = () => {
    set((d) => {
      const a = d.accounts.find((x) => x.id === settingCard.id)
      if (!a) return
      a.billingDay = settingCard.billingDay || null
      a.dueDay = settingCard.dueDay || null
      a.creditLimit = round2(Number(settingCard.creditLimit) || 0)
    })
    toast('卡片信息已保存')
    setSettingCard(null)
  }

  return (
    <>
      <TopBar
        title="信用卡"
        onBack={nav.pop}
        right={<button className="iconbtn" onClick={() => nav.push({ page: 'assets' })}>＋</button>}
      />
      <div className="page-body no-tab">
        {cards.length === 0 && (
          <div className="card">
            <Empty icon="svg:id" text="还没有信用卡账户\n去资产管家添加一张信用卡，就能管理账单日与应还款">
              <button className="btn" onClick={() => nav.push({ page: 'assets' })}>＋ 去添加信用卡</button>
            </Empty>
          </div>
        )}

        {cards.map((c) => {
          const urgent = c.left != null && c.left <= 3 && c.due != null && c.due > 0
          return (
            <div className="card" key={c.id}>
              <div className="card-title">
                <span style={{ marginRight: 6, display: "inline-flex", verticalAlign: "-0.15em" }}><ValueIcon value={c.icon} fallback="tag" size={16} /></span>{c.name}
                <button className="chip" style={{ marginLeft: 'auto' }} onClick={() => setSettingCard({ ...c })}><Icon name="settings" size="1em" className="qy-inline-icon" /> 设置</button>
              </div>

              <div className="stat3" style={{ marginTop: 10 }}>
                <div className="s3">
                  <div className="k">信用额度</div>
                  <div className="v">{c.creditLimit > 0 ? `¥${fmt(c.creditLimit)}` : '未设置'}</div>
                </div>
                <div className="s3">
                  <div className="k">已用额度</div>
                  <div className="v" style={{ color: 'var(--expense)' }}>¥{fmt(c.used)}</div>
                </div>
                <div className="s3">
                  <div className="k">可用额度</div>
                  <div className="v" style={{ color: 'var(--green)' }}>{c.available != null ? `¥${fmt(c.available)}` : '—'}</div>
                </div>
              </div>

              <div style={{
                marginTop: 12, padding: '12px 14px', borderRadius: 14,
                background: 'color-mix(in srgb, var(--brand) 8%, var(--card2))',
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline' }}>
                  <div style={{ flex: 1 }}>
                    <div className="muted" style={{ fontSize: 12 }}>本期应还{c.cycleStart ? `（${c.cycleStart.slice(5).replace('-', '/')} 起）` : ''}</div>
                    <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginTop: 2, color: c.due == null ? 'var(--ink3)' : c.due > 0 ? 'var(--expense)' : 'var(--green)' }}>
                      {c.due == null ? '未设账单日' : `¥${fmt(c.due)}`}
                    </div>
                    {c.due != null && c.due <= 0 && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>本期账单已结清{c.due < 0 ? `（溢缴款 ¥${fmt(-c.due)}）` : ''}</div>}
                  </div>
                  <button className="btn" disabled={c.due == null} onClick={() => openRepay(c)}>还款</button>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {c.billingDay ? <span className="chip">账单日 {c.billingDay} 日</span> : <span className="chip">未设账单日</span>}
                  {c.dueDay ? (
                    <span className={`chip ${urgent ? 'on warn' : ''}`}>
                      {c.left === 0 ? '今天还款日' : `${c.left} 天后还款`}
                    </span>
                  ) : <span className="chip">未设还款日</span>}
                </div>
                {urgent && <div style={{ color: 'var(--warn)', fontSize: 12, marginTop: 8 }}><Icon name="warning" size="1em" className="qy-inline-icon" /> 还款日将近，记得按时还款，避免影响信用</div>}
              </div>
            </div>
          )
        })}

        {cards.length > 0 && (
          <div className="card" style={{ background: 'var(--grad-soft)' }}>
            <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.8 }}>
              <Icon name="tag" size="1em" className="qy-inline-icon" /> 本期应还 = 上个账单日至今的刷卡支出 − 退款/转入。还款会生成一笔转入卡的转账账单，可在明细中查看。
            </div>
          </div>
        )}
      </div>

      {/* 卡设置 */}
      <Sheet open={!!settingCard} onClose={() => setSettingCard(null)} title="卡片信息">
        {settingCard && (
          <>
            <div className="field">
              <label>信用额度（元）</label>
              <input className="input" type="number" inputMode="decimal" value={settingCard.creditLimit || ''}
                placeholder="例如 30000"
                onChange={(e) => setSettingCard({ ...settingCard, creditLimit: Number(e.target.value) || 0 })} />
            </div>
            <div className="field">
              <label>账单日（每月几日出账）</label>
              <select className="input" value={settingCard.billingDay || ''}
                onChange={(e) => setSettingCard({ ...settingCard, billingDay: Number(e.target.value) || null })}>
                <option value="">未设置</option>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d} 日</option>)}
              </select>
            </div>
            <div className="field">
              <label>还款日（每月几日到期）</label>
              <select className="input" value={settingCard.dueDay || ''}
                onChange={(e) => setSettingCard({ ...settingCard, dueDay: Number(e.target.value) || null })}>
                <option value="">未设置</option>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d} 日</option>)}
              </select>
            </div>
            <div className="btnrow">
              <button className="btn ghost" onClick={() => setSettingCard(null)}>取消</button>
              <button className="btn" onClick={saveSetting}>保存</button>
            </div>
          </>
        )}
      </Sheet>

      {/* 还款 */}
      <Sheet open={!!repayCard} onClose={() => setRepayCard(null)} title={`还款 · ${repayCard?.name || ''}`}>
        {repayCard && (
          <>
            <div className="field">
              <label>还款金额（元）</label>
              <input className="input" type="number" inputMode="decimal" value={repayAmt}
                placeholder={repayCard.due > 0 ? `本期应还 ${fmt(repayCard.due)}` : '输入金额'}
                onChange={(e) => setRepayAmt(e.target.value)} />
              {repayCard.due > 0 && (
                <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setRepayAmt(String(repayCard.due))}>全额还清本期账单</button>
              )}
            </div>
            <div className="field">
              <label>付款账户</label>
              <select className="input" value={repayFrom} onChange={(e) => setRepayFrom(e.target.value)}>
                {payAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="btnrow">
              <button className="btn ghost" onClick={() => setRepayCard(null)}>取消</button>
              <button className="btn" onClick={doRepay}>确认还款</button>
            </div>
          </>
        )}
      </Sheet>
    </>
  )
}
