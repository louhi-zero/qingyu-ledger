/* v1.5 收支监控确认弹窗：捕获到微信/支付宝收支通知后弹出，
 * 金额/方向/分类/账户可改，确认后才入账（不静默自动记账）。
 * 仅 Android 原生端会触发（见 notifyCatch.js），桌面/浏览器不会渲染。
 */
import React, { useEffect, useState } from 'react'
import { useStore } from './store.jsx'
import { Sheet, Seg } from './ui.jsx'
import { uid, todayStr, nowTime, round2 } from './utils.js'

const SRC_META = {
  wechat: { name: '微信', icon: '💬' },
  alipay: { name: '支付宝', icon: '🅰️' },
}

export default function NotifyCatchSheet({ caught, onClose }) {
  const { state, set, toast } = useStore()
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState('expense')
  const [catId, setCatId] = useState('')
  const [accId, setAccId] = useState('')
  const [note, setNote] = useState('')

  const catsOf = (k) => state.categories[k === 'income' ? 'income' : 'expense'] || []

  // 捕获到新通知 → 初始化表单
  useEffect(() => {
    if (!caught) return
    setAmount(caught.amount.toFixed(2))
    setKind(caught.kind)
    setNote([caught.title, caught.text].filter(Boolean).join(' · ').slice(0, 60))
    // 默认账户：按来源匹配虚拟账户（微信钱包/支付宝），否则第一个账户
    const kw = caught.source === 'wechat' ? '微信' : '支付宝'
    const acc = state.accounts.find((a) => (a.name || '').includes(kw)) || state.accounts[0]
    setAccId(acc?.id || '')
    // 默认分类：收入且提到红包 → 红包分类；其余取该收支方向的第一项
    const cats = catsOf(caught.kind)
    const text = `${caught.title || ''}${caught.text || ''}`
    const guessed = caught.kind === 'income' && /红包/.test(text)
      ? cats.find((c) => /红包/.test(c.name))
      : null
    setCatId(guessed?.id || cats[0]?.id || '')
  }, [caught])

  if (!caught) return null
  const meta = SRC_META[caught.source] || { name: '通知', icon: '📩' }

  const save = () => {
    const amt = round2(Number(amount))
    if (!(amt > 0)) { toast('请输入正确的金额', 'err'); return }
    set((d) => {
      d.transactions.push({
        id: uid(), ledgerId: d.currentLedgerId,
        date: todayStr(), time: nowTime(),
        type: kind, amount: amt,
        categoryId: catId || null, accountId: accId || d.accounts[0]?.id || null, toAccountId: null,
        note: note.trim(), tags: [], reimburse: 'none', attachAt: null, deletedAt: null,
        createdAt: new Date().toISOString(), viaNotify: caught.source,
      })
    })
    toast(`已记入${kind === 'income' ? '收入' : '支出'} ¥${amt.toFixed(2)}`)
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title="监控到收支，记一笔？">
      <div className="center-box" style={{ padding: '2px 0 10px' }}>
        <span className="tag">{meta.icon} {meta.name}通知</span>
        <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
          {[caught.title, caught.text].filter(Boolean).join('：') || '未读到通知内容'}
        </div>
      </div>
      <Seg
        options={[{ label: '💸 支出', value: 'expense' }, { label: '💰 收入', value: 'income' }]}
        value={kind}
        onChange={(v) => { setKind(v); setCatId(catsOf(v)[0]?.id || '') }}
      />
      <div style={{ height: 10 }} />
      <div className="field">
        <label>金额（元）</label>
        <input className="input" inputMode="decimal" value={amount} autoFocus
          onChange={(e) => {
            const [i, f] = e.target.value.split('.')
            setAmount(f && f.length > 2 ? `${i}.${f.slice(0, 2)}` : e.target.value)
          }} />
      </div>
      <div className="field">
        <label>分类</label>
        <select className="input" value={catId} onChange={(e) => setCatId(e.target.value)}>
          {catsOf(kind).map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label>账户</label>
        <select className="input" value={accId} onChange={(e) => setAccId(e.target.value)}>
          {state.accounts.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label>备注</label>
        <input className="input" maxLength={40} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="btnrow">
        <button className="btn ghost" onClick={onClose}>忽略</button>
        <button className="btn" onClick={save}>记入账单</button>
      </div>
    </Sheet>
  )
}
