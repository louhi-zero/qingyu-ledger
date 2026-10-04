import { Icon } from "../ui/icons.jsx"
import React, { useState } from 'react'
import { useStore } from '../store.jsx'
import { TopBar, Seg, Sheet, Empty, Confirm, CatIcon } from '../ui.jsx'
import { fmt, uid, catInfo, accountName } from '../utils.js'

// v1.2 记账模板：常用账单一键套用
export default function Templates({ nav }) {
  const { state, set, toast } = useStore()
  const [editOpen, setEditOpen] = useState(null) // null | {id?...} 编辑/新建草稿
  const [delTx, setDelTx] = useState(null)

  const list = [...(state.templates || [])].sort((a, b) => (b.at || '').localeCompare(a.at || ''))

  const remove = () => {
    set((d) => { d.templates = d.templates.filter((t) => t.id !== delTx.id) })
    setDelTx(null)
    toast('已删除模板')
  }

  const saveTpl = (data) => {
    set((d) => {
      if (data.id) {
        const t = d.templates.find((x) => x.id === data.id)
        Object.assign(t, data, { at: new Date().toISOString() })
      } else {
        d.templates.unshift({ ...data, id: uid(), at: new Date().toISOString() })
      }
      if (d.templates.length > 30) d.templates.length = 30
    })
    setEditOpen(null)
    toast(data.id ? '模板已更新' : '模板已保存')
  }

  return (
    <>
      <TopBar
        title={<><Icon name="bolt" size="1em" className="qy-inline-icon" /> 记账模板</>}
        onBack={() => nav.pop()}
        right={<button className="iconbtn" onClick={() => setEditOpen({ type: 'expense' })} title="新建模板">＋</button>}
      />
      <div className="page-body">
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>常用账单一键记</div>
          <div className="cdesc">把常花的钱存成模板，记账时在顶部点一下就填好；也可以在编辑任意账单时点「存为模板」。</div>
        </div>

        {list.length === 0 ? (
          <div className="card">
            <Empty icon="svg:bolt" text={'还没有模板\n点右上角 ＋ 新建一个'} />
          </div>
        ) : (
          <div className="txlist">
            {list.map((t) => {
              const info = catInfo(state, { type: t.type, categoryId: t.categoryId })
              return (
                <div key={t.id} className="txitem" onClick={() => setEditOpen({ ...t })}>
                  <div className="txicon" style={{ background: info.color + '1c' }}><CatIcon icon={info.icon} size={18} /></div>
                  <div className="txmain">
                    <div className="txname">{t.name}</div>
                    <div className="txnote">{[info.name, accountName(state, t.accountId), t.note].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div className="txamt out">{t.type === 'income' ? '+' : '-'}{fmt(t.amount)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <TplEditor
        draft={editOpen} onClose={() => setEditOpen(null)} onSave={saveTpl}
        onDelete={(t) => { setEditOpen(null); setDelTx(t) }}
      />
      <Confirm open={!!delTx} title="删除这个模板？" text="不影响已记的账单" okText="删除" danger onOk={remove} onCancel={() => setDelTx(null)} />
    </>
  )
}

// 模板编辑弹层（复用轻量表单：金额输入 + 分类平铺 + 账户选择）
function TplEditor({ draft, onClose, onSave, onDelete }) {
  const { state } = useStore()
  const [type, setType] = useState(draft?.type || 'expense')
  const [amount, setAmount] = useState(draft ? String(draft.amount) : '')
  const [categoryId, setCategoryId] = useState(draft?.categoryId || null)
  const [accountId, setAccountId] = useState(draft?.accountId || state.accounts[0]?.id || null)
  const [note, setNote] = useState(draft?.note || '')
  const [name, setName] = useState(draft?.name || '')
  if (!draft) return null

  const cats = type === 'income' ? state.categories.income : state.categories.expense
  const mainCat = cats.find((c) => c.id === categoryId) || cats[0]
  const amt = Number(amount) || 0
  const ok = amt > 0 && name.trim()

  const save = () => {
    if (!ok) return
    onSave({
      ...(draft.id ? { id: draft.id } : {}),
      name: name.trim().slice(0, 16), type,
      amount: Math.round(amt * 100) / 100,
      categoryId: mainCat.id, accountId, note: note.trim(),
    })
  }

  return (
    <div className="mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet">
        <div className="sheet-head">
          <button className="sx" onClick={onClose}><Icon name="close" size="1em" className="qy-inline-icon" /></button>
          <div className="st">{draft.id ? '编辑模板' : '新建模板'}</div>
          <div style={{ width: 30 }} />
        </div>
        <div className="sheet-body">
          <Seg
            options={[{ value: 'expense', label: '支出' }, { value: 'income', label: '收入' }]}
            value={type}
            onChange={(v) => { setType(v); setCategoryId(null) }}
          />
          <input className="input" style={{ marginTop: 10 }} placeholder="模板名称（必填）" value={name} onChange={(e) => setName(e.target.value)} maxLength={16} />
          <input className="input" style={{ marginTop: 8 }} type="number" inputMode="decimal" placeholder="金额" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <div className="catbar" style={{ margin: '10px 0 4' }}>
            {cats.map((c) => (
              <button key={c.id} className={`chip ${mainCat?.id === c.id ? 'on' : ''}`} onClick={() => setCategoryId(c.id)}><CatIcon icon={c.icon} size={15} /> {c.name}</button>
            ))}
          </div>
          <select className="input" style={{ marginTop: 8 }} value={accountId || ''} onChange={(e) => setAccountId(e.target.value)}>
            {state.accounts.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
          </select>
          <input className="input" style={{ marginTop: 8 }} placeholder="备注（选填）" value={note} onChange={(e) => setNote(e.target.value)} maxLength={30} />
          <div className="btnrow" style={{ marginTop: 12 }}>
            {draft.id && <button className="btn danger" onClick={() => onDelete(draft)}>删除</button>}
            <button className="btn ghost" onClick={onClose}>取消</button>
            <button className="btn" disabled={!ok} style={{ opacity: ok ? 1 : .5 }} onClick={save}>保存</button>
          </div>
        </div>
      </div>
    </div>
  )
}
