import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { Seg, Confirm, Empty } from '../ui.jsx'
import { fmt, uid, todayStr, nowTime, addDays, accountName } from '../utils.js'

// 记一笔 / 编辑账单（全屏弹层）
export default function AddTx({ open, editTx, onClose }) {
  const { state, set, toast } = useStore()
  const defType = state.settings.defaultType || 'expense'
  const [type, setType] = useState(editTx ? editTx.type : defType === 'income' ? 'income' : 'expense')
  const [amount, setAmount] = useState(editTx ? String(editTx.amount) : '')
  const [categoryId, setCategoryId] = useState(editTx?.categoryId || null)
  const [subId, setSubId] = useState(null)
  const [accountId, setAccountId] = useState(editTx?.accountId || state.accounts[0]?.id || null)
  const [toAccountId, setToAccountId] = useState(editTx?.toAccountId || state.accounts[1]?.id || state.accounts[0]?.id || null)
  const [date, setDate] = useState(editTx?.date || todayStr())
  const [time, setTime] = useState(editTx?.time || nowTime())
  const [note, setNote] = useState(editTx?.note || '')
  const [showKp, setShowKp] = useState(true)
  const [delConfirm, setDelConfirm] = useState(false)
  const [noteEditOpen, setNoteEditOpen] = useState(false)
  const [timeOpen, setTimeOpen] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [accOpen, setAccOpen] = useState(false)
  const [accSetter, setAccSetter] = useState(null)

  const cats = type === 'income' ? state.categories.income : state.categories.expense
  const mainCat = useMemo(() => cats.find((c) => c.id === categoryId) || cats[0], [cats, categoryId])

  // 切换类型时重置分类
  useEffect(() => { setCategoryId(null); setSubId(null) }, [type])

  if (!open) return null

  const amt = Number(amount) || 0
  const canSave = amt > 0 && (type === 'transfer' ? accountId && toAccountId && accountId !== toAccountId : categoryId || mainCat)

  const pressKey = (k) => {
    if (k === '⌫') { setAmount((a) => a.slice(0, -1)); return }
    if (k === '.') { if (!amount.includes('.')) setAmount((a) => (a || '0') + '.'); return }
    setAmount((a) => {
      let next = a + k
      // 限制两位小数
      const [i, d] = next.split('.')
      if (d && d.length > 2) next = `${i}.${d.slice(0, 2)}`
      if (i.length > 8) return a
      if (Number(next) > 1e9) return a
      return next
    })
  }

  const save = (again = false) => {
    if (!canSave) { toast(type === 'transfer' && accountId === toAccountId ? '转入账户不能与转出账户相同' : '请输入金额', 'err'); return }
    const cat = categoryId || mainCat?.id
    const payload = {
      type, amount: Math.round(amt * 100) / 100,
      categoryId: type === 'transfer' ? null : cat,
      accountId, toAccountId: type === 'transfer' ? toAccountId : null,
      date, time, note: note.trim(),
    }
    set((d) => {
      if (editTx) {
        const t = d.transactions.find((x) => x.id === editTx.id)
        Object.assign(t, payload)
      } else {
        d.transactions.push({ id: uid(), ledgerId: d.currentLedgerId, createdAt: new Date().toISOString(), ...payload })
      }
    })
    toast(editTx ? '已保存修改' : `已记一笔 ${type === 'income' ? '收入' : type === 'expense' ? '支出' : '转账'} ¥${fmt(amt)}`)
    if (again) {
      setAmount(''); setNote(''); setShowKp(true)
    } else {
      onClose()
    }
  }

  const del = () => {
    set((d) => { d.transactions = d.transactions.filter((t) => t.id !== editTx.id) })
    setDelConfirm(false)
    toast('已删除该账单')
    onClose()
  }

  const selCat = (c, isSub) => {
    if (isSub) { setSubId(c.id); setCategoryId(mainCat.id) }
    else { setCategoryId(c.id); setSubId(null) }
    setShowKp(true)
  }

  return (
    <div className="mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet addsheet">
        <div className="sheet-head">
          <button className="sx" onClick={onClose}>✕</button>
          <div className="st">{editTx ? '编辑账单' : '记一笔'}</div>
          <div style={{ width: 30 }} />
        </div>
        <div className="sheet-body">
          {/* 类型切换 */}
          <Seg
            options={[{ value: 'expense', label: '支出' }, { value: 'income', label: '收入' }, { value: 'transfer', label: '转账' }]}
            value={type} onChange={setType}
          />

          {/* 金额 */}
          <div className="add-amount" onClick={() => setShowKp(true)}>
            <span className="sym">¥</span>
            <div className={`num ${amount ? '' : 'ph'}`}>{amount || '0.00'}</div>
          </div>

          {/* 分类选择 */}
          {type !== 'transfer' ? (
            <>
              <div className="catbar">
                {cats.map((c) => (
                  <button key={c.id} className={`chip ${mainCat?.id === c.id ? 'on' : ''}`} onClick={() => selCat(c, false)}>{c.icon} {c.name}</button>
                ))}
              </div>
              <div className="grid4" style={{ marginBottom: 6 }}>
                {(mainCat?.children || []).map((s) => (
                  <button key={s.id} className={`gitem ${subId === s.id ? 'on' : ''}`} onClick={() => selCat(s, true)}>
                    <div className="gi">{s.icon}</div><span>{s.name}</span>
                  </button>
                ))}
                {!mainCat?.children?.length && (
                  <div className="muted" style={{ gridColumn: '1/-1', textAlign: 'center', padding: '10px 0' }}>全部记在「{mainCat?.name}」一级分类</div>
                )}
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 6 }}>
              <div className="selectline" onClick={() => pickAccount(setAccountId)}>
                <span>转出账户</span><b>{accountName(state, accountId)} ›</b>
              </div>
              <div className="selectline" onClick={() => pickAccount(setToAccountId)}>
                <span>转入账户</span><b>{accountName(state, toAccountId)} ›</b>
              </div>
              {accountId === toAccountId && <div className="muted" style={{ color: 'var(--expense)' }}>转入账户不能与转出账户相同</div>}
            </div>
          )}

          {/* 元信息 */}
          <div className="meta-row">
            <button className="meta-pill" onClick={() => setNoteEditOpen(true)}>📝 {note ? <b>{note.slice(0, 8)}</b> : '备注'}</button>
            <button className="meta-pill" onClick={() => pickAccount(setAccountId)}>💳 <b>{type === 'transfer' ? accountName(state, accountId) : accountName(state, accountId)}</b></button>
            <button className="meta-pill" onClick={() => setShowDatePicker((v) => !v)}>📅 <b>{date === todayStr() ? '今天' : date.slice(5)}</b></button>
            <button className="meta-pill" onClick={() => setTimeOpen((v) => !v)}>⏰ <b>{time}</b></button>
          </div>

          {showDatePicker && (
            <div className="card" style={{ padding: 12 }}>
              <div className="chips" style={{ paddingBottom: 8 }}>
                {[['今天', todayStr()], ['昨天', addDays(todayStr(), -1)], ['前天', addDays(todayStr(), -2)]].map(([l, d]) => (
                  <button key={l} className={`chip ${date === d ? 'on' : ''}`} onClick={() => { setDate(d); setShowDatePicker(false) }}>{l}</button>
                ))}
              </div>
              <input type="date" className="input" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </div>
          )}

          {/* 键盘 */}
          {showKp ? (
            <div className="kp">
              {['1', '2', '3', '⌫', '4', '5', '6', '+', '7', '8', '9', '-', '·', '0', '00', '✓'].map((k) => {
                if (k === '·') return <button key={k} className="fn" onClick={() => pressKey('.')}>·</button>
                if (k === '✓') return <button key={k} className="ok" onClick={() => save(false)}>完成</button>
                if (k === '⌫') return <button key={k} className="fn" onClick={() => pressKey('⌫')}>⌫</button>
                if (k === '+' || k === '-') return <button key={k} className="fn" disabled style={{ opacity: .3 }}>{k}</button>
                return <button key={k} onClick={() => pressKey(k)}>{k}</button>
              })}
            </div>
          ) : (
            <button className="btn" onClick={() => save(false)} style={{ marginTop: 6 }}>完成</button>
          )}

          <div className="btnrow" style={{ marginTop: 10 }}>
            <button className="btn ghost" onClick={() => save(true)}>再记一笔</button>
            {editTx && <button className="btn danger" onClick={() => setDelConfirm(true)}>删除</button>}
          </div>
        </div>

        {/* 备注/账户/时间 编辑弹层 */}
        <NoteEditor open={noteEditOpen} onClose={() => setNoteEditOpen(false)} note={note} setNote={setNote} />
        <TimeSheet open={timeOpen} onClose={() => setTimeOpen(false)} time={time} setTime={setTime} />
        <AccountSheet state={state} open={accOpen} onClose={() => setAccOpen(false)} onPick={(id) => { accSetter?.(id); setAccOpen(false) }} />
      </div>

      <Confirm open={delConfirm} title="删除这条账单？" text="删除后不可恢复" okText="删除" danger onOk={del} onCancel={() => setDelConfirm(false)} />
    </div>
  )

  // 内部小弹层（声明在此以访问 state）
  function pickAccount(fn) { setAccSetter(() => fn); setAccOpen(true) }
}

// 备注编辑
function NoteEditor({ open, onClose, note, setNote }) {
  const [v, setV] = useState(note)
  useEffect(() => setV(note), [note, open])
  if (!open) return null
  return (
    <div className="mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet center" style={{ background: 'var(--card)', padding: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>备注</div>
        <textarea className="input" autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="这笔钱花在哪了？"
          onKeyDown={(e) => { if (e.key === 'Enter') { setNote(v); onClose() } }} />
        <button className="btn" style={{ marginTop: 12 }} onClick={() => { setNote(v.trim()); onClose() }}>保存</button>
      </div>
    </div>
  )
}

// 时间选择
function TimeSheet({ open, onClose, time, setTime }) {
  if (!open) return null
  return (
    <div className="mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet center" style={{ background: 'var(--card)', padding: 20, minWidth: 240 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>交易时间</div>
        <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value || time)} />
        <button className="btn" style={{ marginTop: 12 }} onClick={onClose}>确定</button>
      </div>
    </div>
  )
}

// 账户选择
function AccountSheet({ state, open, onClose, onPick }) {
  if (!open) return null
  return (
    <div className="mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet">
        <div className="sheet-head">
          <button className="sx" onClick={onClose}>✕</button>
          <div className="st">选择账户</div><div style={{ width: 30 }} />
        </div>
        <div className="sheet-body">
          {state.accounts.length ? state.accounts.map((a) => (
            <div className="selectline" key={a.id} style={{ marginBottom: 8 }} onClick={() => onPick(a.id)}>
              <span>{a.icon} {a.name}</span><span className="arrow">›</span>
            </div>
          )) : <Empty icon="💳" text="还没有账户，去「资产」添加一个" />}
        </div>
      </div>
    </div>
  )
}
