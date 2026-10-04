import { Icon } from "../ui/icons.jsx"
import React, { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { TopBar, Seg, Sheet, Empty, Confirm } from '../ui.jsx'
import { fmt, catInfo, accountName, periodOf } from '../utils.js'

// v1.2 报销管理：垫付标记 → 待报销 → 已核销
export default function Reimburse({ nav }) {
  const { state, set, toast } = useStore()
  const [tab, setTab] = useState('pending') // pending | done | all
  const [doneTx, setDoneTx] = useState(null)   // 待核销的行
  const [genIncome, setGenIncome] = useState(true)
  const [toAccountId, setToAccountId] = useState(state.accounts[0]?.id || null)
  const [cancelTx, setCancelTx] = useState(null)

  const reimTxs = useMemo(
    () => state.transactions.filter((t) => t.type === 'expense' && !t.deletedAt && (t.reimburse === 'pending' || t.reimburse === 'done')),
    [state.transactions],
  )
  const list = useMemo(() => {
    const l = tab === 'all' ? reimTxs : reimTxs.filter((t) => t.reimburse === tab)
    return [...l].sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')))
  }, [reimTxs, tab])

  const sd = state.settings.monthStartDay || 1
  const curPeriod = periodOf(new Date().toISOString().slice(0, 10), sd)
  const pendingSum = reimTxs.filter((t) => t.reimburse === 'pending').reduce((s, t) => s + Number(t.amount), 0)
  const doneThisMonth = reimTxs
    .filter((t) => t.reimburse === 'done' && periodOf(t.date, sd) === curPeriod)
    .reduce((s, t) => s + Number(t.amount), 0)

  // 核销：改状态 + 可选生成一笔报销到账收入
  const doDone = () => {
    const tx = doneTx
    if (!tx) return
    set((d) => {
      const t = d.transactions.find((x) => x.id === tx.id)
      if (t) t.reimburse = 'done'
      if (genIncome && toAccountId) {
        const incCats = d.categories.income
        const other = incCats.find((c) => c.name === '其他收入') || incCats[incCats.length - 1]
        d.transactions.push({
          id: `rb_${tx.id}`, ledgerId: d.currentLedgerId, type: 'income',
          amount: tx.amount, categoryId: other?.id || null, accountId: toAccountId,
          toAccountId: null, date: new Date().toISOString().slice(0, 10),
          time: new Date().toTimeString().slice(0, 5),
          note: `报销到账 · ${tx.note || catInfo(state, tx).name}`,
          createdAt: new Date().toISOString(), tags: [], reimburse: 'none', attachAt: null,
        })
      }
    })
    setDoneTx(null)
    toast(genIncome ? `已核销并记入到账 ¥${fmt(tx.amount)}` : '已标记为已报销')
  }

  const doCancel = () => {
    set((d) => {
      const t = d.transactions.find((x) => x.id === cancelTx.id)
      if (t) t.reimburse = 'none'
      // 若当年核销时生成了收入，一并删除
      d.transactions = d.transactions.filter((x) => x.id !== `rb_${cancelTx.id}`)
    })
    setCancelTx(null)
    toast('已取消报销标记')
  }

  return (
    <>
      <TopBar title={<><Icon name="briefcase" size="1em" className="qy-inline-icon" /> 报销管理</>} onBack={() => nav.pop()} />
      <div className="page-body">
        {/* 合计卡 */}
        <div className="card" style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div className="cdesc">待报销</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--expense)' }}>¥{fmt(pendingSum)}</div>
          </div>
          <div style={{ width: 1, background: 'var(--line)' }} />
          <div style={{ flex: 1 }}>
            <div className="cdesc">本期已报销</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--income)' }}>¥{fmt(doneThisMonth)}</div>
          </div>
        </div>

        <Seg
          style={{ margin: '12px 0' }}
          options={[{ value: 'pending', label: '待报销' }, { value: 'done', label: '已报销' }, { value: 'all', label: '全部' }]}
          value={tab} onChange={setTab}
        />

        {list.length === 0 ? (
          <div className="card">
            <Empty
              icon="svg:reimburse"
              text={tab === 'pending' ? '没有待报销的账单\n记一笔时点「报销」选待报销' : '这里还空空的'}
            />
          </div>
        ) : (
          <div className="txlist">
            {list.map((t) => {
              const info = catInfo(state, t)
              return (
                <div key={t.id} className="txitem" onClick={() => (t.reimburse === 'pending' ? setDoneTx(t) : nav.openAdd(t))}>
                  <div className="txicon" style={{ background: info.color + '1c' }}>{info.icon}</div>
                  <div className="txmain">
                    <div className="txname">{info.name}</div>
                    <div className="txnote">{[t.date, t.note, accountName(state, t.accountId)].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="txamt out">-{fmt(t.amount)}</div>
                    <span className={`chip ${t.reimburse === 'pending' ? 'warn' : ''}`} style={{ padding: '1px 8px', fontSize: 11 }}>
                      {t.reimburse === 'pending' ? '待报销' : '已报销'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 核销弹层 */}
      <Sheet open={!!doneTx} onClose={() => setDoneTx(null)} title="标记为已报销" center>
        {doneTx && (
          <>
            <div style={{ textAlign: 'center', margin: '6px 0 14px' }}>
              <div className="cdesc">{doneTx.note || catInfo(state, doneTx).name}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--expense)' }}>¥{fmt(doneTx.amount)}</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13.5 }}>
              <input type="checkbox" checked={genIncome} onChange={(e) => setGenIncome(e.target.checked)} />
              同时生成一笔「报销到账」收入
            </label>
            {genIncome && (
              <div className="selectline" onClick={() => {}}>
                <span>到账账户</span>
                <select
                  className="input" style={{ width: 'auto', padding: '6px 10px' }}
                  value={toAccountId || ''} onChange={(e) => setToAccountId(e.target.value)}
                >
                  {state.accounts.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                </select>
              </div>
            )}
            <button className="btn" style={{ marginTop: 14 }} onClick={doDone}>确认核销</button>
          </>
        )}
      </Sheet>

      <Confirm
        open={!!cancelTx} title="取消报销标记？"
        text={cancelTx?.reimburse === 'done' ? '若当时生成了「报销到账」收入，会一并删除' : '该账单将回到普通支出'}
        okText="取消标记" danger onOk={doCancel} onCancel={() => setCancelTx(null)}
      />
    </>
  )
}
