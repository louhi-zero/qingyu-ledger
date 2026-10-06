import { Icon } from "../ui/icons.jsx"
import React, { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { ValueIcon } from '../ui/icons.jsx'
import { TopBar, Sheet, Seg, Empty } from '../ui.jsx'
import { ACCOUNT_TYPES } from '../seed.js'
import { accountBalance, fmt, fmtCur, toBase, annuityMonthly, parseD, uid, todayStr, nowTime, round2 } from '../utils.js'

// 债务/债权行展示数据
function rowOf(state, a, today) {
  const bal = accountBalance(state, a.id)
  const isDebt = a.type === 'debt'
  const outstanding = isDebt ? Math.max(0, -bal) : Math.max(0, bal)
  const settled = isDebt ? bal >= 0 : bal <= 0
  let overdueDays = null, dueInDays = null
  if (a.dueDate && !settled) {
    const diff = Math.round((parseD(today) - parseD(a.dueDate)) / 86400000)
    if (diff > 0) overdueDays = diff
    else dueInDays = -diff
  }
  // 等额本息月供参考：剩余本金按年利率、剩余期限估算
  let monthly = null
  if (!settled && Number(a.rate) > 0 && a.dueDate) {
    const months = Math.max(1, Math.round((parseD(a.dueDate) - parseD(today)) / 86400000 / 30.44))
    monthly = annuityMonthly(outstanding, a.rate, months)
  }
  return { ...a, balance: bal, isDebt, outstanding, settled, overdueDays, dueInDays, monthly }
}

export default function Debts({ nav }) {
  const { state, set, toast } = useStore()
  const today = todayStr()
  const [newOpen, setNewOpen] = useState(false)
  const [newKind, setNewKind] = useState('debt') // debt 借入 / claim 借出
  const [draft, setDraft] = useState(null)
  const [move, setMove] = useState(null) // { acc, kind: 'repay'|'collect' }
  const [moveAmt, setMoveAmt] = useState('')
  const [moveAcc, setMoveAcc] = useState('')

  const rows = useMemo(
    () => state.accounts.filter((a) => a.type === 'debt' || a.type === 'claim').map((a) => rowOf(state, a, today)),
    [state, today],
  )
  const debts = rows.filter((r) => r.isDebt)
  const claims = rows.filter((r) => !r.isDebt)
  const totalDebt = round2(debts.reduce((s, r) => s + toBase(state, r.outstanding, r.currency), 0))
  const totalClaim = round2(claims.reduce((s, r) => s + toBase(state, r.outstanding, r.currency), 0))
  const myAccounts = state.accounts.filter((a) => a.type !== 'debt' && a.type !== 'claim')

  // 快捷还款/收款：生成转账账单
  const openMove = (r) => {
    setMove({ acc: r, kind: r.isDebt ? 'repay' : 'collect' })
    setMoveAmt(String(r.outstanding || ''))
    setMoveAcc(myAccounts[0]?.id || '')
  }
  const doMove = () => {
    const amt = round2(Number(moveAmt))
    if (!(amt > 0)) { toast('请输入金额', 'err'); return }
    if (!moveAcc) { toast('请选择资金账户', 'err'); return }
    const { acc, kind } = move
    set((d) => {
      d.transactions.push({
        id: uid(), ledgerId: d.currentLedgerId, date: todayStr(), time: nowTime(),
        type: 'transfer', amount: amt, categoryId: null,
        // 还款：我的账户 → 债务账户；收款：债权账户 → 我的账户
        accountId: kind === 'repay' ? moveAcc : acc.id,
        toAccountId: kind === 'repay' ? acc.id : moveAcc,
        note: `${kind === 'repay' ? '还款' : '收款'}·${acc.name}`, tags: [], reimburse: 'none', attachAt: null,
        createdAt: new Date().toISOString(),
      })
    })
    toast(kind === 'repay' ? `已还款 ${fmt(amt)} 元` : `已收款 ${fmt(amt)} 元`)
    setMove(null)
  }

  // 记一笔借入/借出：新建账户 + 初始转账账单
  const openNew = (kind) => { setNewKind(kind); setDraft({ name: '', amount: '', rate: '', dueDate: '', accId: myAccounts[0]?.id || '' }); setNewOpen(true) }
  const doNew = () => {
    const amt = round2(Number(draft.amount))
    if (!draft.name.trim()) { toast('请填写对方名称', 'err'); return }
    if (!(amt > 0)) { toast('请输入金额', 'err'); return }
    if (!draft.accId) { toast('请选择资金账户', 'err'); return }
    const t = ACCOUNT_TYPES.find((x) => x.type === newKind)
    const accId = uid()
    set((d) => {
      d.accounts.push({
        id: accId, name: draft.name.trim(), type: newKind, icon: t?.icon || "svg:star", initial: 0,
        color: newKind === 'debt' ? '#ec407a' : '#26c6da', currency: 'CNY',
        rate: Number(draft.rate) || 0, dueDate: draft.dueDate || null,
      })
      d.transactions.push({
        id: uid(), ledgerId: d.currentLedgerId, date: todayStr(), time: nowTime(),
        type: 'transfer', amount: amt, categoryId: null,
        accountId: newKind === 'debt' ? accId : draft.accId,
        toAccountId: newKind === 'debt' ? draft.accId : accId,
        note: `${newKind === 'debt' ? '借入' : '借出'}·${draft.name.trim()}`, tags: [], reimburse: 'none', attachAt: null,
        createdAt: new Date().toISOString(),
      })
    })
    toast(`已记一笔${newKind === 'debt' ? '借入' : '借出'} ${fmt(amt)} 元`)
    setNewOpen(false)
  }

  const badge = (r) => {
    if (r.settled) return <span className="chip" style={{ color: 'var(--green)' }}><Icon name="check" size="1em" className="qy-inline-icon" /> {r.isDebt ? '已还清' : '已收回'}</span>
    if (r.overdueDays != null) return <span className="chip on" style={{ background: 'var(--expense)', color: '#fff' }}>已逾期 {r.overdueDays} 天</span>
    if (r.dueInDays != null && r.dueInDays <= 30) return <span className="chip on warn">{r.dueInDays} 天后到期</span>
    return null
  }

  return (
    <>
      <TopBar
        title="债务管理"
        onBack={nav.pop}
        right={<button className="iconbtn" onClick={() => openNew('debt')}>＋</button>}
      />
      <div className="page-body no-tab">
        <div className="card" style={{ background: 'var(--grad)', color: '#fff', textAlign: 'center' }}>
          <div style={{ fontSize: 12, opacity: .85 }}>净头寸（债权 − 负债）</div>
          <div style={{ fontSize: 34, fontWeight: 800, margin: '6px 0 14px', fontVariantNumeric: 'tabular-nums' }}>
            {totalClaim - totalDebt < 0 ? '-' : ''}¥{fmt(Math.abs(round2(totalClaim - totalDebt)))}
          </div>
          <div style={{ display: 'flex', background: 'rgba(255,255,255,.15)', borderRadius: 14, padding: '10px 0' }}>
            <div style={{ flex: 1, borderRight: '1px solid rgba(255,255,255,.2)' }}>
              <div style={{ fontSize: 11, opacity: .85 }}>待还负债</div>
              <div style={{ fontWeight: 800, fontSize: 17, marginTop: 3 }}>¥{fmt(totalDebt)}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, opacity: .85 }}>待收债权</div>
              <div style={{ fontWeight: 800, fontSize: 17, marginTop: 3 }}>¥{fmt(totalClaim)}</div>
            </div>
          </div>
        </div>

        {rows.length === 0 && (
          <div className="card">
            {/* v3.1 修复：JSX 属性字符串不处理 \n 转义（原样渲染「\n」字面量），改 JS 表达式传真实换行 */}
            <Empty icon="svg:trendDown" text={'还没有借入借出记录\n借朋友的钱、花呗分期、车贷房贷都能在这里管理'}>
              <div className="btnrow">
                <button className="btn" onClick={() => openNew('debt')}>＋ 记借入</button>
                <button className="btn ghost" onClick={() => openNew('claim')}>＋ 记借出</button>
              </div>
            </Empty>
          </div>
        )}

        {debts.length > 0 && (
          <div className="group">
            <div className="gtitle">待还负债 · {debts.length}</div>
            {debts.map((r) => (
              <div className="card" key={r.id}>
                <div className="card-title">
                  <span style={{ marginRight: 6, display: "inline-flex", verticalAlign: "-0.15em" }}><ValueIcon value={r.icon} fallback="tag" size={16} /></span>{r.name}
                  <span style={{ marginLeft: 'auto' }}>{badge(r)}</span>
                </div>
                <div className="stat3" style={{ marginTop: 8 }}>
                  <div className="s3">
                    <div className="k">未还本金</div>
                    <div className="v" style={{ color: r.settled ? 'var(--green)' : 'var(--expense)' }}>{fmtCur(r.outstanding, r.currency)}</div>
                  </div>
                  <div className="s3">
                    <div className="k">年利率</div>
                    <div className="v">{Number(r.rate) > 0 ? `${r.rate}%` : '—'}</div>
                  </div>
                  <div className="s3">
                    <div className="k">到期日</div>
                    <div className="v" style={{ fontSize: 13 }}>{r.dueDate ? r.dueDate.slice(5) : '—'}</div>
                  </div>
                </div>
                {r.monthly != null && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 8 }}><Icon name="salary" size="1em" className="qy-inline-icon" /> 等额本息月供参考：约 {fmt(r.monthly)} 元/月</div>
                )}
                {!r.settled && (
                  <div className="btnrow" style={{ marginTop: 12 }}>
                    <button className="btn" onClick={() => openMove(r)}>还款</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {claims.length > 0 && (
          <div className="group">
            <div className="gtitle">待收债权 · {claims.length}</div>
            {claims.map((r) => (
              <div className="card" key={r.id}>
                <div className="card-title">
                  <span style={{ marginRight: 6, display: "inline-flex", verticalAlign: "-0.15em" }}><ValueIcon value={r.icon} fallback="tag" size={16} /></span>{r.name}
                  <span style={{ marginLeft: 'auto' }}>{badge(r)}</span>
                </div>
                <div className="stat3" style={{ marginTop: 8 }}>
                  <div className="s3">
                    <div className="k">待收金额</div>
                    <div className="v" style={{ color: r.settled ? 'var(--green)' : 'var(--brand)' }}>{fmtCur(r.outstanding, r.currency)}</div>
                  </div>
                  <div className="s3">
                    <div className="k">年利率</div>
                    <div className="v">{Number(r.rate) > 0 ? `${r.rate}%` : '—'}</div>
                  </div>
                  <div className="s3">
                    <div className="k">到期日</div>
                    <div className="v" style={{ fontSize: 13 }}>{r.dueDate ? r.dueDate.slice(5) : '—'}</div>
                  </div>
                </div>
                {!r.settled && (
                  <div className="btnrow" style={{ marginTop: 12 }}>
                    <button className="btn" onClick={() => openMove(r)}>收款</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {rows.length > 0 && (
          <div className="btnrow">
            <button className="btn ghost" onClick={() => openNew('debt')}>＋ 记借入</button>
            <button className="btn ghost" onClick={() => openNew('claim')}>＋ 记借出</button>
          </div>
        )}

        <div className="card" style={{ background: 'var(--grad-soft)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.8 }}>
            <Icon name="tag" size="1em" className="qy-inline-icon" /> 借入/借出会自动创建对应账户并生成转账账单；还款、收款同样以转账记录，金额实时冲减本金。
          </div>
        </div>
      </div>

      {/* 记借入/借出 */}
      <Sheet open={newOpen} onClose={() => setNewOpen(false)} title="记一笔借入 / 借出">
        {draft && (
          <>
            <Seg
              options={[{ value: 'debt', label: <><Icon name="trendDown" size="1em" className="qy-inline-icon" /> 借入（我欠钱）</> }, { value: 'claim', label: <><Icon name="handshake" size="1em" className="qy-inline-icon" /> 借出（别人欠我）</> }]}
              value={newKind}
              onChange={(v) => setNewKind(v)}
            />
            <div style={{ height: 12 }} />
            <div className="field">
              <label>对方 / 名称</label>
              <input className="input" value={draft.name} maxLength={12} placeholder="例如：老王、银行车贷"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="field">
              <label>金额（元）</label>
              <input className="input" type="number" inputMode="decimal" value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
            </div>
            <div className="field">
              <label>年利率（%，可留空）</label>
              <input className="input" type="number" inputMode="decimal" value={draft.rate} placeholder="亲友借款可留空"
                onChange={(e) => setDraft({ ...draft, rate: e.target.value })} />
            </div>
            <div className="field">
              <label>到期日（可留空）</label>
              <input className="input" type="date" value={draft.dueDate}
                onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />
            </div>
            <div className="field">
              <label>{newKind === 'debt' ? '钱进哪个账户' : '从哪个账户借出'}</label>
              <select className="input" value={draft.accId} onChange={(e) => setDraft({ ...draft, accId: e.target.value })}>
                {myAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="btnrow">
              <button className="btn ghost" onClick={() => setNewOpen(false)}>取消</button>
              <button className="btn" onClick={doNew}>保存</button>
            </div>
          </>
        )}
      </Sheet>

      {/* 还款 / 收款 */}
      <Sheet
        open={!!move}
        onClose={() => setMove(null)}
        title={move?.kind === 'repay' ? `还款 · ${move?.acc.name}` : `收款 · ${move?.acc.name}`}
      >
        {move && (
          <>
            <div className="field">
              <label>{move.kind === 'repay' ? '还款金额（元）' : '收款金额（元）'}</label>
              <input className="input" type="number" inputMode="decimal" value={moveAmt}
                placeholder={`未还 ${fmt(move.acc.outstanding)}`}
                onChange={(e) => setMoveAmt(e.target.value)} />
              {move.acc.outstanding > 0 && (
                <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setMoveAmt(String(move.acc.outstanding))}>结清全部</button>
              )}
            </div>
            <div className="field">
              <label>{move.kind === 'repay' ? '付款账户' : '钱进哪个账户'}</label>
              <select className="input" value={moveAcc} onChange={(e) => setMoveAcc(e.target.value)}>
                {myAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="btnrow">
              <button className="btn ghost" onClick={() => setMove(null)}>取消</button>
              <button className="btn" onClick={doMove}>{move.kind === 'repay' ? '确认还款' : '确认收款'}</button>
            </div>
          </>
        )}
      </Sheet>
    </>
  )
}
