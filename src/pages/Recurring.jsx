import { Icon } from "../ui/icons.jsx"
import React, { useState } from 'react'
import { useStore } from '../store.jsx'
import { TopBar, Sheet, Confirm, Switch, Empty, CatIcon } from '../ui.jsx'
import {
  uid, todayStr, findCat, catInfo, accountName, fmt, FREQ_CN,
} from '../utils.js'

function blankRec() {
  return {
    id: uid(), type: 'expense', amount: '', categoryId: null, accountId: null,
    freq: 'monthly', interval: 1, startDate: todayStr(), note: '', enabled: true,
  }
}

export default function Recurring({ nav }) {
  const { state, set, toast } = useStore()
  const [edit, setEdit] = useState(null)
  const [delId, setDelId] = useState(null)

  const cats = state.categories.expense
  const accounts = state.accounts

  const save = () => {
    const v = Number(edit.amount)
    if (!v || v <= 0) { toast('请填写金额', 'err'); return }
    if (!edit.categoryId) { toast('请选择分类', 'err'); return }
    set((d) => {
      const idx = d.recurring.findIndex((r) => r.id === edit.id)
      const data = { ...edit, amount: v, interval: Math.max(1, Number(edit.interval) || 1) }
      if (idx >= 0) d.recurring[idx] = data
      else d.recurring.push(data)
    })
    toast('周期账单已保存，到期将自动入账')
    setEdit(null)
  }

  const doDelete = () => {
    set((d) => { d.recurring = d.recurring.filter((r) => r.id !== delId) })
    toast('已删除')
    setDelId(null)
  }

  return (
    <>
      <TopBar
        title="周期记账"
        onBack={nav.pop}
        right={<button className="iconbtn" onClick={() => setEdit(blankRec())}>＋</button>}
      />
      <div className="page-body no-tab">
        <div className="card" style={{ background: 'var(--grad-soft)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.7 }}>
            <Icon name="repeat" size="1em" className="qy-inline-icon" /> 房租、会员、基金定投这类固定账单，<br />
            设置后每天打开 App 会自动补记，无需重复操作。
          </div>
        </div>

        {state.recurring.length === 0 ? (
          <div className="card">
            <Empty icon="svg:repeat" text="还没有周期账单，添加一个试试">
              <button className="btn" onClick={() => setEdit(blankRec())}>＋ 添加周期账单</button>
            </Empty>
          </div>
        ) : (
          <div className="group">
            {state.recurring.map((r) => {
              const info = catInfo(state, { type: r.type, categoryId: r.categoryId })
              return (
                <div key={r.id} className="cell" onClick={() => setEdit({ ...r, amount: String(r.amount) })}>
                  <div className="cico"><CatIcon icon={info.icon} size={20} /></div>
                  <div className="cmain">
                    <div className="ctitle">
                      ¥{fmt(r.amount)} · {FREQ_CN[r.freq]}{r.interval > 1 ? `(每${r.interval}${r.freq === 'daily' ? '天' : r.freq === 'weekly' ? '周' : r.freq === 'monthly' ? '月' : '年'})` : ''}
                    </div>
                    <div className="cdesc">
                      {info.name}{r.accountId ? ` · ${accountName(state, r.accountId)}` : ''}{r.note ? ` · ${r.note}` : ''} · 起 {r.startDate}
                    </div>
                  </div>
                  <div className="cright" onClick={(e) => e.stopPropagation()}>
                    <Switch on={r.enabled} onChange={(v) => {
                      set((d) => { const x = d.recurring.find((y) => y.id === r.id); x.enabled = v })
                      toast(v ? '已启用' : '已暂停')
                    }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 编辑周期账单 */}
      <Sheet open={!!edit} onClose={() => setEdit(null)}
        title={edit && state.recurring.some((r) => r.id === edit.id) ? '编辑周期账单' : '添加周期账单'}>
        {edit && (
          <>
            <div className="field">
              <label>金额（元）</label>
              <input className="input" type="number" inputMode="decimal" value={edit.amount}
                onChange={(e) => setEdit({ ...edit, amount: e.target.value })} />
            </div>
            <div className="field">
              <label>分类</label>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
                {cats.map((c) => (
                  <button key={c.id} className={`chip ${edit.categoryId === c.id ? 'on' : ''}`}
                    onClick={() => setEdit({ ...edit, categoryId: c.id })}>
                    <CatIcon icon={c.icon} size={14} /> {c.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>频率</label>
              <div className="seg">
                {Object.entries(FREQ_CN).map(([k, name]) => (
                  <button key={k} className={edit.freq === k ? 'on' : ''}
                    onClick={() => setEdit({ ...edit, freq: k })}>{name}</button>
                ))}
              </div>
            </div>
            <div className="field" style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label>间隔</label>
                <input className="input" type="number" min={1} value={edit.interval}
                  onChange={(e) => setEdit({ ...edit, interval: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label>开始日期</label>
                <input className="input" type="date" value={edit.startDate}
                  onChange={(e) => e.target.value && setEdit({ ...edit, startDate: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label>账户（可选）</label>
              <select className="input" value={edit.accountId || ''}
                onChange={(e) => setEdit({ ...edit, accountId: e.target.value || null })}>
                <option value="">不指定</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>备注（可选）</label>
              <input className="input" value={edit.note} maxLength={20}
                onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
            </div>
            <div className="btnrow">
              {state.recurring.some((r) => r.id === edit.id) && (
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
        title="删除周期账单？"
        text="删除后不再自动入账，已生成的历史账单不受影响。"
        okText="删除"
        danger
        onOk={doDelete}
        onCancel={() => setDelId(null)}
      />
    </>
  )
}
