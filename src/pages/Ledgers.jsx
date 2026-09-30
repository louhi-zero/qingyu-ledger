import React, { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { TopBar, Sheet, Confirm } from '../ui.jsx'
import { LEDGER_TEMPLATES } from '../seed.js'
import { txsOfLedger, uid, fmt } from '../utils.js'

function blankLedger() {
  return { id: uid(), name: '', icon: '📒', template: '标准账本' }
}

export default function Ledgers({ nav }) {
  const { state, set, toast } = useStore()
  const [edit, setEdit] = useState(null)
  const [delId, setDelId] = useState(null)

  const counts = useMemo(() => {
    const m = {}
    for (const l of state.ledgers) m[l.id] = txsOfLedger(state, l.id).length
    return m
  }, [state])

  const save = () => {
    if (!edit.name.trim()) { toast('请填写账本名称', 'err'); return }
    set((d) => {
      const idx = d.ledgers.findIndex((l) => l.id === edit.id)
      const data = { ...edit, name: edit.name.trim() }
      if (idx >= 0) d.ledgers[idx] = data
      else d.ledgers.push(data)
    })
    toast('账本已保存')
    setEdit(null)
  }

  const doDelete = () => {
    set((d) => {
      d.ledgers = d.ledgers.filter((l) => l.id !== delId)
      d.transactions = d.transactions.filter((t) => t.ledgerId !== delId)
      if (d.currentLedgerId === delId) d.currentLedgerId = d.ledgers[0]?.id || null
    })
    toast('账本及其账单已删除')
    setDelId(null)
  }

  return (
    <>
      <TopBar
        title="我的账本"
        onBack={nav.pop}
        right={<button className="iconbtn" onClick={() => setEdit(blankLedger())}>＋</button>}
      />
      <div className="page-body no-tab">
        <div className="card" style={{ background: 'var(--grad-soft)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.7 }}>
            📚 不同用途分开记：日常、旅行、装修、报销互不干扰。<br />
            点击账本即可切换，底部明细与图表随之更新。
          </div>
        </div>

        <div className="grid3">
          {state.ledgers.map((l) => (
            <button key={l.id} className="gitem" style={{ background: 'var(--card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', padding: '12px 4px' }}
              onClick={() => setEdit({ ...l })}>
              <div className="gi" style={state.currentLedgerId === l.id ? { background: 'var(--brand-weak)', boxShadow: 'inset 0 0 0 2px var(--brand)' } : {}}>
                {l.icon}
              </div>
              <span style={{ color: 'var(--ink)', fontWeight: 700, maxWidth: 100, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {l.name}
              </span>
              <span className="muted">{counts[l.id] || 0} 笔{state.currentLedgerId === l.id ? ' · 使用中' : ''}</span>
            </button>
          ))}
        </div>

        {/* 当前账本快捷切换 */}
        <div className="group" style={{ marginTop: 12 }}>
          <div className="gtitle">切换当前账本</div>
          {state.ledgers.map((l) => (
            <div key={l.id} className="cell" onClick={() => {
              set((d) => { d.currentLedgerId = l.id })
              toast(`已切换到「${l.name}」`)
            }}>
              <div className="cico">{l.icon}</div>
              <div className="cmain">
                <div className="ctitle">{l.name}</div>
                <div className="cdesc">{l.template} · {counts[l.id] || 0} 笔账单</div>
              </div>
              <div className="cright">
                {state.currentLedgerId === l.id && <span style={{ color: 'var(--brand)', fontWeight: 700 }}>使用中</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 编辑账本 */}
      <Sheet open={!!edit} onClose={() => setEdit(null)}
        title={edit && state.ledgers.some((l) => l.id === edit.id) ? '编辑账本' : '新建账本'}>
        {edit && (
          <>
            <div className="field">
              <label>选择模板</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                {LEDGER_TEMPLATES.map((t) => (
                  <button key={t.name} className={`gitem ${edit.template === t.name ? 'on' : ''}`}
                    onClick={() => setEdit({ ...edit, template: t.name, icon: t.icon })}>
                    <div className="gi">{t.icon}</div>
                    <span>{t.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>账本名称</label>
              <input className="input" value={edit.name} maxLength={10}
                placeholder="例如：日本蜜月行"
                onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
            <div className="btnrow">
              {state.ledgers.some((l) => l.id === edit.id) && state.ledgers.length > 1 && (
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
        title="删除账本？"
        text="该账本下的全部账单将一并删除，且无法恢复。"
        okText="删除"
        danger
        onOk={doDelete}
        onCancel={() => setDelId(null)}
      />
    </>
  )
}
