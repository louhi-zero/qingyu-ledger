import { Icon } from "../ui/icons.jsx"
import React, { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { TopBar, Sheet, Bar, Empty, CatIcon } from '../ui.jsx'
import { Ring } from '../charts.jsx'
import {
  currentPeriod, periodAdd, periodLabel, txsOfPeriod, sumBy,
  statByCategory, findCat, fmt, round2,
} from '../utils.js'

export default function Budget({ nav }) {
  const { state, set, toast } = useStore()
  const [period, setPeriod] = useState(currentPeriod(state.settings.monthStartDay))
  const [editTotal, setEditTotal] = useState(false)
  const [editCat, setEditCat] = useState(null) // {id,name,icon,color}
  const [totalInput, setTotalInput] = useState('')
  const [catInput, setCatInput] = useState('')

  const txs = useMemo(() => txsOfPeriod(state, period), [state, period])
  const exp = sumBy(txs, 'expense')
  const total = state.budgets?.total || 0
  const remain = round2(total - exp)
  const pct = total > 0 ? Math.round((exp / total) * 100) : 0
  const stats = useMemo(() => statByCategory(txs, 'expense', state), [txs, state])
  const isCur = period === currentPeriod(state.settings.monthStartDay)

  const saveTotal = () => {
    const v = Math.max(0, Number(totalInput) || 0)
    set((d) => { d.budgets.total = round2(v) })
    setEditTotal(false)
    toast(v > 0 ? '总预算已保存' : '已清除总预算')
  }
  const saveCat = () => {
    const v = Math.max(0, Number(catInput) || 0)
    set((d) => {
      if (v > 0) d.budgets.byCategory[editCat.id] = round2(v)
      else delete d.budgets.byCategory[editCat.id]
    })
    setEditCat(null)
    toast(v > 0 ? '分类预算已保存' : '已清除该分类预算')
  }

  // 有支出但未设预算的分类，提示补充
  const byCat = state.budgets?.byCategory || {}

  return (
    <>
      <TopBar
        title="预算"
        onBack={nav.pop}
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="iconbtn" onClick={() => setPeriod(periodAdd(period, -1, state.settings.monthStartDay))}>‹</button>
            <button className="iconbtn" onClick={() => setPeriod(periodAdd(period, 1, state.settings.monthStartDay))}>›</button>
          </div>
        }
      />
      <div className="page-body no-tab">
        <div className="ymnav">
          <span className="ym">{periodLabel(period)}{isCur ? ' · 本期' : ''}</span>
        </div>

        {/* 总预算环 */}
        <div className="card center-box">
          {total > 0 ? (
            <Ring pct={pct} size={168} thickness={13} color={pct > 100 ? 'var(--expense)' : pct > 80 ? 'var(--warn)' : 'var(--brand)'} />
          ) : (
            <div style={{ padding: '26px 0' }}>
              <div className="big-num" style={{ color: 'var(--ink)' }}>¥{fmt(exp)}</div>
              <div className="muted" style={{ marginTop: 4 }}>本期已支出 · 尚未设置预算</div>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 8 }}>
            <div>
              <div className="muted">预算总额</div>
              <div style={{ fontWeight: 800, fontSize: 16, marginTop: 2 }}>¥{fmt(total)}</div>
            </div>
            <div>
              <div className="muted">{remain >= 0 ? '剩余可用' : '已超支'}</div>
              <div style={{ fontWeight: 800, fontSize: 16, marginTop: 2, color: remain >= 0 ? 'var(--green)' : 'var(--expense)' }}>
                ¥{fmt(Math.abs(remain))}
              </div>
            </div>
          </div>
          <button className="btn ghost" style={{ marginTop: 14 }} onClick={() => { setTotalInput(total || ''); setEditTotal(true) }}>
            {total > 0 ? '修改总预算' : '设置月总预算'}
          </button>
          {total > 0 && (
            <div style={{ marginTop: 10 }}>
              <Bar value={exp} max={total} danger={pct > 100} warn={pct > 80} />
              <div className="muted" style={{ marginTop: 6 }}>
                {pct > 100 ? `已超支 ${pct - 100}%，管住手呀！` : pct > 80 ? `已使用 ${pct}%，接近上限` : `预算使用率 ${pct}%，节奏健康`}
              </div>
            </div>
          )}
        </div>

        {/* 分类预算 */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '14px 14px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="card-title"><Icon name="budget" size="1em" className="qy-inline-icon" /> 分类预算</div>
            <span className="muted">点击设置</span>
          </div>
          {stats.length === 0 && Object.keys(byCat).length === 0 ? (
            <Empty text="本期暂无支出，先设个分类预算吧" />
          ) : (
            <div>
              {/* 已设预算的分类 */}
              {state.categories.expense.map((c) => {
                const spent = stats.find((s) => s.id === c.id)?.value
                  || (c.children ? txs.filter((t) => {
                      const f = findCat(state.categories.expense, t.categoryId)
                      return f && f.cat.id === c.id
                    }).reduce((a, t) => a + Number(t.amount), 0) : 0)
                const bud = byCat[c.id]
                if (!bud) return null
                const p = Math.round((spent / bud) * 100)
                return (
                  <div key={c.id} className="cell" onClick={() => { setEditCat({ id: c.id, name: c.name, icon: c.icon, color: c.color }); setCatInput(bud) }}>
                    <div className="cico"><CatIcon icon={c.icon} size={20} /></div>
                    <div className="cmain">
                      <div className="ctitle">{c.name}</div>
                      <div style={{ marginTop: 5 }}><Bar value={spent} max={bud} danger={p > 100} warn={p > 80} height={7} /></div>
                    </div>
                    <div className="cright" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                      <b style={{ color: p > 100 ? 'var(--expense)' : 'var(--ink)', fontSize: 13.5 }}>¥{fmt(spent)}</b>
                      <span className="muted">/ ¥{fmt(bud)}</span>
                    </div>
                  </div>
                )
              })}
              {/* 未设预算但有支出 */}
              {stats.filter((s) => !byCat[s.id]).map((s) => (
                <div key={s.id} className="cell" onClick={() => { setEditCat({ id: s.id, name: s.name, icon: s.icon, color: s.color }); setCatInput('') }}>
                  <div className="cico"><CatIcon icon={s.icon} size={20} /></div>
                  <div className="cmain">
                    <div className="ctitle">{s.name}</div>
                    <div className="cdesc">已支出 ¥{fmt(s.value)} · 未设预算</div>
                  </div>
                  <div className="cright"><span className="tag" style={{ background: 'var(--brand-weak)', color: 'var(--brand)' }}>+ 预算</span></div>
                </div>
              ))}
            </div>
          )}
        </div>

        {total === 0 && (
          <div className="card" style={{ background: 'var(--grad-soft)', textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.8 }}>
              <Icon name="tag" size="1em" className="qy-inline-icon" /> 建议把月预算设为收入的 <b>60%~80%</b>，<br />
              留一部分储蓄，消费更从容。
            </div>
          </div>
        )}
      </div>

      {/* 设置总预算 */}
      <Sheet open={editTotal} onClose={() => setEditTotal(false)} title="月总预算">
        <div className="field">
          <label>每月计划支出（元）</label>
          <input className="input" type="number" inputMode="decimal" autoFocus
            value={totalInput} onChange={(e) => setTotalInput(e.target.value)} placeholder="例如 3000" />
        </div>
        <div className="btnrow">
          {total > 0 && <button className="btn danger" onClick={() => { set((d) => { d.budgets.total = 0 }); setEditTotal(false); toast('已清除总预算') }}>清除</button>}
          <button className="btn ghost" onClick={() => setEditTotal(false)}>取消</button>
          <button className="btn" onClick={saveTotal}>保存</button>
        </div>
      </Sheet>

      {/* 设置分类预算 */}
      <Sheet open={!!editCat} onClose={() => setEditCat(null)} title={editCat ? `${editCat.name}预算` : ''}>
        <div className="field">
          <label>每月计划支出（元）</label>
          <input className="input" type="number" inputMode="decimal" autoFocus
            value={catInput} onChange={(e) => setCatInput(e.target.value)} placeholder="输入金额，0 或留空表示清除" />
        </div>
        <div className="btnrow">
          <button className="btn ghost" onClick={() => setEditCat(null)}>取消</button>
          <button className="btn" onClick={saveCat}>保存</button>
        </div>
      </Sheet>
    </>
  )
}
