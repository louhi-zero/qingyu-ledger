import { Icon } from "../ui/icons.jsx"
import React, { useState } from 'react'
import { useStore } from '../store.jsx'
import { ValueIcon } from '../ui/icons.jsx'
import { TopBar, Sheet, Seg, Empty, EmojiPicker, Switch } from '../ui.jsx'
import { Ring } from '../charts.jsx'
import { fmt, parseD, uid, todayStr, nowTime, round2, addDays } from '../utils.js'

function blankGoal() {
  return { id: null, name: '', icon: "svg:budget", target: '', deadline: '', note: '' }
}

// 距截止日剩余整月数（至少 1）
function monthsLeft(deadline, today) {
  if (!deadline) return null
  const diff = Math.round((parseD(deadline) - parseD(today)) / 86400000 / 30.44)
  return Math.max(1, diff)
}

export default function Goals({ nav }) {
  const { state, set, toast } = useStore()
  const today = todayStr()
  const goals = state.goals || []
  const [edit, setEdit] = useState(null) // 新建/编辑草稿
  const [move, setMove] = useState(null) // { goal, mode: 'in'|'out' }
  const [moveAmt, setMoveAmt] = useState('')
  const [moveNote, setMoveNote] = useState('')
  const [moveBook, setMoveBook] = useState(false)
  const [moveAcc, setMoveAcc] = useState('')

  const myAccounts = state.accounts.filter((a) => a.type !== 'debt' && a.type !== 'claim')

  const saveGoal = () => {
    const target = round2(Number(edit.target))
    if (!edit.name.trim()) { toast('给目标起个名字吧', 'err'); return }
    if (!(target > 0)) { toast('请填写目标金额', 'err'); return }
    set((d) => {
      if (edit.id) {
        const g = d.goals.find((x) => x.id === edit.id)
        Object.assign(g, { name: edit.name.trim(), icon: edit.icon || "svg:budget", target, deadline: edit.deadline || null, note: edit.note || '', at: new Date().toISOString() })
      } else {
        d.goals.push({ id: uid(), name: edit.name.trim(), icon: edit.icon || "svg:budget", target, saved: 0, deadline: edit.deadline || null, note: edit.note || '', at: new Date().toISOString() })
      }
    })
    toast(edit.id ? '目标已更新' : '目标已创建，开始攒钱吧！')
    setEdit(null)
  }

  const deleteGoal = () => {
    set((d) => { d.goals = d.goals.filter((x) => x.id !== edit.id) })
    toast('目标已删除')
    setEdit(null)
  }

  const openMove = (g, mode) => {
    setMove({ goal: g, mode })
    setMoveAmt('')
    setMoveNote('')
    setMoveBook(mode === 'in')
    setMoveAcc(myAccounts[0]?.id || '')
  }

  // 存入/取出：更新 saved；可选同时记一笔账（存入=支出，取出=收入）
  const doMove = () => {
    const amt = round2(Number(moveAmt))
    if (!(amt > 0)) { toast('请输入金额', 'err'); return }
    if (moveBook && !moveAcc) { toast('请选择账户', 'err'); return }
    const { goal, mode } = move
    set((d) => {
      const g = d.goals.find((x) => x.id === goal.id)
      if (!g) return
      g.saved = round2(Number(g.saved || 0) + (mode === 'in' ? amt : -amt))
      g.at = new Date().toISOString()
      if (moveBook) {
        // 分类自动选「其他支出/其他收入」，避免明细出现未分类
        const cats = mode === 'in' ? d.categories.expense : d.categories.income
        const fallback = mode === 'in' ? '其他支出' : '其他收入'
        const cat = cats.find((c) => c.name === fallback) || cats[0]
        d.transactions.push({
          id: uid(), ledgerId: d.currentLedgerId, date: todayStr(), time: nowTime(),
          type: mode === 'in' ? 'expense' : 'income', amount: amt,
          categoryId: cat?.id || null, accountId: moveAcc, toAccountId: null,
          note: `${mode === 'in' ? '存入' : '取出'}·${g.name}`, tags: [], reimburse: 'none', attachAt: null,
          createdAt: new Date().toISOString(),
        })
      }
    })
    toast(mode === 'in' ? `已存入 ${fmt(amt)} 元，加油！` : `已取出 ${fmt(amt)} 元`)
    setMove(null)
  }

  return (
    <>
      <TopBar
        title="储蓄目标"
        onBack={nav.pop}
        right={<button className="iconbtn" onClick={() => setEdit(blankGoal())}>＋</button>}
      />
      <div className="page-body no-tab">
        {goals.length === 0 && (
          <div className="card">
            <Empty icon="svg:budget" text="还没有储蓄目标\n旅行、新手机、应急备用金…攒钱更有动力">
              <button className="btn" onClick={() => setEdit(blankGoal())}>＋ 新建目标</button>
            </Empty>
          </div>
        )}

        {goals.map((g) => {
          const target = Number(g.target) || 0
          const saved = Number(g.saved) || 0
          const pct = target > 0 ? (saved / target) * 100 : 0
          const done = saved >= target && target > 0
          const ml = monthsLeft(g.deadline, today)
          const remain = round2(Math.max(0, target - saved))
          const perPeriod = ml && remain > 0 ? round2(remain / ml) : null
          return (
            <div className="card" key={g.id}>
              <div className="card-title">
                <span style={{ marginRight: 6, display: "inline-flex", verticalAlign: "-0.15em" }}><ValueIcon value={g.icon} fallback="budget" size={16} /></span>{g.name}
                {done
                  ? <span className="chip on" style={{ background: 'var(--green)', color: '#fff' }}><Icon name="party" size="1em" className="qy-inline-icon" /> 已达成</span>
                  : <button className="chip" style={{ marginLeft: 'auto' }} onClick={() => setEdit({ ...g, target: String(g.target), deadline: g.deadline || '' })}>编辑</button>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12 }}>
                <Ring pct={pct} size={84} thickness={9} color={done ? 'var(--green)' : 'var(--brand)'} label="已存" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span className="muted">已存</span>
                    <b style={{ color: done ? 'var(--green)' : 'var(--brand)' }}>¥{fmt(saved)}</b>
                  </div>
                  <div className="muted" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span>目标</span><span>¥{fmt(target)}</span>
                  </div>
                  {g.deadline && (
                    <div className="muted" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span>截止</span>
                      <span style={{ color: g.deadline < today && !done ? 'var(--expense)' : 'var(--ink)' }}>{g.deadline.slice(5).replace('-', '/')}（还 {ml} 个月）</span>
                    </div>
                  )}
                  {perPeriod != null && !done && (
                    <div className="muted" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>每期应存</span><b style={{ color: 'var(--warn)' }}>¥{fmt(perPeriod)}/月</b>
                    </div>
                  )}
                  {!done && perPeriod == null && (
                    <div className="muted" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>还差</span><span>¥{fmt(remain)}</span>
                    </div>
                  )}
                </div>
              </div>
              {g.note && <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}><Icon name="bill" size="1em" className="qy-inline-icon" /> {g.note}</div>}
              <div className="btnrow" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => openMove(g, 'in')}>存一笔</button>
                <button className="btn ghost" onClick={() => openMove(g, 'out')}>取出</button>
              </div>
            </div>
          )
        })}

        {goals.length > 0 && (
          <div className="card" style={{ background: 'var(--grad-soft)' }}>
            <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.8 }}>
              <Icon name="tag" size="1em" className="qy-inline-icon" /> 存一笔时勾选「同时记一笔账」，会生成对应支出/收入账单并计入账户余额；不勾选则只更新目标进度。
            </div>
          </div>
        )}
      </div>

      {/* 新建/编辑目标 */}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? '编辑目标' : '新建储蓄目标'}>
        {edit && (
          <>
            <div className="field">
              <label>目标图标</label>
              <EmojiPicker value={edit.icon} onChange={(e) => setEdit({ ...edit, icon: e })} />
            </div>
            <div className="field">
              <label>目标名称</label>
              <input className="input" value={edit.name} maxLength={12} placeholder="例如：云南旅行基金"
                onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
            <div className="field">
              <label>目标金额（元）</label>
              <input className="input" type="number" inputMode="decimal" value={edit.target} placeholder="例如 20000"
                onChange={(e) => setEdit({ ...edit, target: e.target.value })} />
            </div>
            <div className="field">
              <label>截止日期（可留空）</label>
              <input className="input" type="date" value={edit.deadline}
                onChange={(e) => setEdit({ ...edit, deadline: e.target.value })} />
            </div>
            <div className="field">
              <label>备注（可留空）</label>
              <input className="input" value={edit.note} maxLength={30}
                onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
            </div>
            <div className="btnrow">
              {edit.id && <button className="btn danger" onClick={deleteGoal}>删除</button>}
              <button className="btn ghost" onClick={() => setEdit(null)}>取消</button>
              <button className="btn" onClick={saveGoal}>保存</button>
            </div>
          </>
        )}
      </Sheet>

      {/* 存一笔 / 取出 */}
      <Sheet
        open={!!move}
        onClose={() => setMove(null)}
        title={move?.mode === 'in' ? `存一笔 · ${move?.goal.name}` : `取出 · ${move?.goal.name}`}
      >
        {move && (
          <>
            <div className="field">
              <label>金额（元）</label>
              <input className="input" type="number" inputMode="decimal" value={moveAmt} placeholder="输入金额"
                onChange={(e) => setMoveAmt(e.target.value)} />
            </div>
            <div className="field" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div className="ctitle">同时记一笔账</div>
                <div className="cdesc">{move.mode === 'in' ? '生成一笔支出，计入账户余额' : '生成一笔收入，计入账户余额'}</div>
              </div>
              <Switch on={moveBook} onChange={setMoveBook} />
            </div>
            {moveBook && (
              <div className="field">
                <label>{move.mode === 'in' ? '从哪个账户存出' : '钱进哪个账户'}</label>
                <select className="input" value={moveAcc} onChange={(e) => setMoveAcc(e.target.value)}>
                  {myAccounts.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                </select>
              </div>
            )}
            <div className="btnrow">
              <button className="btn ghost" onClick={() => setMove(null)}>取消</button>
              <button className="btn" onClick={doMove}>{move.mode === 'in' ? '确认存入' : '确认取出'}</button>
            </div>
          </>
        )}
      </Sheet>
    </>
  )
}
