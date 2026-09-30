import React, { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { TopBar, Sheet, Confirm, Empty } from '../ui.jsx'
import { ACCOUNT_TYPES } from '../seed.js'
import { accountBalance, netWorth, fmt, uid, round2 } from '../utils.js'

const PALETTE = ['#ff8a65', '#42a5f5', '#66bb6a', '#ab47bc', '#ffa726', '#26c6da', '#ec407a', '#7e57c2']

function blankAcc() {
  return { id: uid(), name: '', type: 'cash', icon: '💵', initial: 0, color: PALETTE[0] }
}

export default function Assets({ nav }) {
  const { state, set, toast } = useStore()
  const [edit, setEdit] = useState(null) // 编辑中的账户草稿
  const [delId, setDelId] = useState(null)

  const nw = useMemo(() => netWorth(state), [state])

  // 分组：资产账户 / 负债账户
  const groups = useMemo(() => {
    const asset = [], debt = []
    for (const a of state.accounts) {
      const bal = accountBalance(state, a.id)
      const t = ACCOUNT_TYPES.find((x) => x.type === a.type)
      const item = { ...a, balance: bal, typeName: t?.name || '自定义' }
      if (t?.liability) debt.push(item)
      else asset.push(item)
    }
    return { asset, debt }
  }, [state])

  const save = () => {
    if (!edit.name.trim()) { toast('请填写账户名称', 'err'); return }
    set((d) => {
      const idx = d.accounts.findIndex((a) => a.id === edit.id)
      const t = ACCOUNT_TYPES.find((x) => x.type === edit.type)
      const data = { ...edit, name: edit.name.trim(), initial: round2(Number(edit.initial) || 0), icon: edit.icon || t?.icon || '⭐' }
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

        {state.accounts.length === 0 && (
          <div className="card">
            <Empty icon="💳" text="还没有账户，添加现金、银行卡或支付宝等账户，就能自动统计净资产">
              <button className="btn" onClick={() => setEdit(blankAcc())}>＋ 添加账户</button>
            </Empty>
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
                  <div className="cdesc">{a.typeName}{Number(a.initial) ? ` · 期初 ¥${fmt(a.initial)}` : ''}</div>
                </div>
                <div className="cright">
                  <b style={{ color: a.balance < 0 ? 'var(--expense)' : 'var(--ink)', fontSize: 15 }}>
                    {a.balance < 0 ? '-' : ''}¥{fmt(Math.abs(a.balance))}
                  </b>
                </div>
              </div>
            ))}
          </div>
        )}

        {groups.debt.length > 0 && (
          <div className="group">
            <div className="gtitle">负债账户 · {groups.debt.length}</div>
            {groups.debt.map((a) => (
              <div key={a.id} className="cell" onClick={() => setEdit({ ...a, initial: String(a.initial) })}>
                <div className="cico" style={{ background: a.color + '22' }}>{a.icon}</div>
                <div className="cmain">
                  <div className="ctitle">{a.name}</div>
                  <div className="cdesc">{a.typeName}{Number(a.initial) ? ` · 期初 ¥${fmt(a.initial)}` : ''}</div>
                </div>
                <div className="cright">
                  <b style={{ color: a.balance > 0 ? 'var(--expense)' : 'var(--ink)', fontSize: 15 }}>
                    {a.balance > 0 ? '-' : ''}¥{fmt(Math.abs(a.balance))}
                  </b>
                </div>
              </div>
            ))}
          </div>
        )}

        {state.accounts.length > 0 && (
          <div className="card" style={{ background: 'var(--grad-soft)' }}>
            <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.8 }}>
              💡 余额 = 期初金额 + 收入 − 支出（含转账）。<br />
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
              <label>期初余额（元，可填 0）</label>
              <input className="input" type="number" inputMode="decimal" value={edit.initial}
                onChange={(e) => setEdit({ ...edit, initial: e.target.value })} />
            </div>
            <div className="field">
              <label>图标颜色</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {PALETTE.map((c) => (
                  <button key={c} onClick={() => setEdit({ ...edit, color: c })}
                    style={{
                      width: 30, height: 30, borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: c, boxShadow: edit.color === c ? `inset 0 0 0 3px var(--card), 0 0 0 2px ${c}` : 'none',
                    }}>{edit.color === c ? '✓' : ''}</button>
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
