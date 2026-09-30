import React, { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { useNav } from '../App.jsx'
import { TopBar, Sheet, Empty, Seg, Amount } from '../ui.jsx'
import {
  fmt, todayStr, addDays, periodOf, periodAdd, periodLabel, weekdayOf,
  txsOfPeriod, sumBy, catInfo, accountName, findCat, parseD, fmtD, pad2, WEEK_CN,
} from '../utils.js'

export default function Home() {
  const { state, set, toast } = useStore()
  const nav = useNav()
  const sd = state.settings.monthStartDay || 1
  const [period, setPeriod] = useState(periodOf(todayStr(), sd))
  const [view, setView] = useState('list') // list | calendar
  const [sumType, setSumType] = useState('expense')
  const [filter, setFilter] = useState('all') // all|expense|income|transfer
  const [catFilter, setCatFilter] = useState(null)
  const [tagSel, setTagSel] = useState([]) // v1.2 标签多选
  const [tagFilterOpen, setTagFilterOpen] = useState(false)
  const [q, setQ] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [daySheet, setDaySheet] = useState(null) // 某日账单

  const txs = useMemo(() => txsOfPeriod(state, period), [state, period])
  const expense = sumBy(txs, 'expense')
  const income = sumBy(txs, 'income')
  const balance = Math.round((income - expense) * 100) / 100

  // 全部历史标签（筛选面板用）
  const allTags = useMemo(() => {
    const s = new Set()
    for (const t of state.transactions) for (const g of t.tags || []) s.add(g)
    return [...s].sort()
  }, [state.transactions])

  // 筛选 + 搜索
  const filtered = useMemo(() => {
    let list = txs
    if (filter !== 'all') list = list.filter((t) => t.type === filter)
    if (catFilter) list = list.filter((t) => t.categoryId === catFilter)
    if (tagSel.length) list = list.filter((t) => (t.tags || []).some((g) => tagSel.includes(g)))
    if (q.trim()) {
      const kw = q.trim().toLowerCase()
      list = list.filter((t) =>
        (t.note || '').toLowerCase().includes(kw) ||
        String(t.amount).includes(kw) ||
        (t.tags || []).some((g) => g.toLowerCase().includes(kw)) ||
        catInfo(state, t).name.includes(kw) ||
        accountName(state, t.accountId).includes(kw))
    }
    return list
  }, [txs, filter, catFilter, tagSel, q, state])

  // 按日分组（倒序）
  const groups = useMemo(() => {
    const m = new Map()
    for (const t of filtered) {
      if (!m.has(t.date)) m.set(t.date, [])
      m.get(t.date).push(t)
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])

  const ledger = state.ledgers.find((l) => l.id === state.currentLedgerId)

  return (
    <>
      <TopBar
        title={ledger ? `${ledger.icon} ${ledger.name}` : '轻语记账'}
        right={
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="iconbtn" onClick={() => setView(view === 'list' ? 'calendar' : 'list')} title="切换视图">
              {view === 'list' ? '📅' : '📋'}
            </button>
            <button className="iconbtn" onClick={() => setSearchOpen(true)} title="搜索">🔍</button>
          </div>
        }
      />
      <div className="page-body">
        {/* 汇总卡 */}
        <div className="home-head">
          <div className="hm-ym">
            <button onClick={() => setPeriod(periodAdd(period, -1, sd))}>‹</button>
            <div className="ym">{periodLabel(period)}</div>
            <button onClick={() => setPeriod(periodAdd(period, 1, sd))}>›</button>
          </div>
          <div className="hm-tabs">
            <button className={sumType === 'expense' ? 'on' : ''} onClick={() => setSumType('expense')}>支出</button>
            <button className={sumType === 'income' ? 'on' : ''} onClick={() => setSumType('income')}>收入</button>
          </div>
          <div className="hm-amount">
            <span className="cur">¥</span>
            <Amount value={sumType === 'expense' ? expense : income} sign={false} prefix="" className={state.settings.hideAmount ? '' : ''} />
          </div>
          <div className="hm-meta">
            <span>{sumType === 'expense' ? '支出' : '收入'} {filtered.length} 笔{filtered.length !== txs.length ? `（共 ${txs.length} 笔）` : ''}</span>
            <span>结余 <Amount value={balance} /></span>
          </div>
        </div>

        {/* 快捷入口 */}
        <div className="quickrow">
          <button className="quick" onClick={() => nav.push({ page: 'budget' })}>
            <div className="qicon">🎯</div>预算
          </button>
          <button className="quick" onClick={() => nav.push({ page: 'assets' })}>
            <div className="qicon">🏦</div>资产
          </button>
          <button className="quick" onClick={() => nav.push({ page: 'ledgers' })}>
            <div className="qicon">📒</div>账本
          </button>
          <button className="quick" onClick={() => nav.push({ page: 'review' })}>
            <div className="qicon">🪄</div>点评
          </button>
        </div>

        {view === 'list' ? (
          <>
            {/* 筛选 */}
            <div className="chips">
              {[['all', '全部'], ['expense', '支出'], ['income', '收入'], ['transfer', '转账']].map(([v, l]) => (
                <button key={v} className={`chip ${filter === v ? 'on' : ''}`} onClick={() => { setFilter(v); setCatFilter(null) }}>{l}</button>
              ))}
              {catFilter && (
                <button className="chip on warn" onClick={() => setCatFilter(null)}>
                  {catInfo(state, { type: 'expense', categoryId: catFilter }).main} ✕
                </button>
              )}
              {allTags.length > 0 && (
                <button
                  className={`chip ${tagSel.length ? 'on' : ''}`}
                  onClick={() => setTagFilterOpen(true)}
                ># {tagSel.length ? `${tagSel.length} 个标签` : '标签'}</button>
              )}
            </div>

            {groups.length === 0 ? (
              <div className="card">
                <Empty icon="🌱" text={q ? '换个条件试试，没有匹配的账单' : '本月还没有记录\n账本不会自己长大，该记一笔啦'} />
              </div>
            ) : groups.map(([date, list]) => {
              const dayExp = sumBy(list, 'expense')
              const dayInc = sumBy(list, 'income')
              return (
                <div key={date} style={{ marginBottom: 12 }}>
                  <div className="dayhead">
                    <span>{date.slice(5).replace('-', '月')}日 {weekdayOf(date)}</span>
                    <span className="dsub">
                      {dayInc > 0 && <span style={{ color: 'var(--income)' }}>收 {fmt(dayInc)} </span>}
                      {dayExp > 0 && <span style={{ color: 'var(--expense)' }}>支 {fmt(dayExp)}</span>}
                    </span>
                  </div>
                  <div className="txlist">
                    {list.map((t) => {
                      const info = catInfo(state, t)
                      return (
                        <div key={t.id} className="txitem" onClick={() => nav.openAdd(t)}>
                          <div className="txicon" style={{ background: info.color + '1c' }}>{info.icon}</div>
                          <div className="txmain">
                            <div className="txname">
                              {t.type === 'transfer' ? `${accountName(state, t.accountId)} → ${accountName(state, t.toAccountId)}` : info.name}
                              {t.reimburse === 'pending' && <span title="待报销" style={{ marginLeft: 4 }}>🧾</span>}
                              {t.attachAt && <span title="有小票照片" style={{ marginLeft: 3, fontSize: 11 }}>📎</span>}
                            </div>
                            <div className="txnote">
                              {[
                                t.note,
                                (t.tags || []).length ? t.tags.map((g) => `#${g}`).join(' ') : '',
                                t.time,
                                t.type !== 'transfer' ? accountName(state, t.accountId) : '',
                              ].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          <div className={`txamt ${t.type === 'income' ? 'in' : t.type === 'transfer' ? 'tr' : 'out'}`}>
                            {t.type === 'income' ? '+' : t.type === 'expense' ? '-' : ''}
                            {state.settings.hideAmount ? <span className="blur">88.88</span> : fmt(t.amount)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </>
        ) : (
          <CalendarView period={period} sd={sd} txs={txs} onDay={(d) => setDaySheet(d)} />
        )}
      </div>

      {/* 搜索 */}
      <Sheet open={searchOpen} onClose={() => setSearchOpen(false)} title="搜索账单">
        <div className="searchbar" style={{ marginBottom: 10 }}>
          <span>🔍</span>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜备注 / 分类 / 金额 / 账户" />
          {q && <button className="iconbtn" style={{ width: 26, height: 26 }} onClick={() => setQ('')}>✕</button>}
        </div>
        {q.trim() ? (
          filtered.length ? (
            <div className="txlist">
              {filtered.slice(0, 30).map((t) => {
                const info = catInfo(state, t)
                return (
                  <div key={t.id} className="txitem" onClick={() => { setSearchOpen(false); nav.openAdd(t) }}>
                    <div className="txicon" style={{ background: info.color + '1c' }}>{info.icon}</div>
                    <div className="txmain">
                      <div className="txname">{info.name}</div>
                      <div className="txnote">{t.date} {[t.note, accountName(state, t.accountId)].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div className={`txamt ${t.type === 'income' ? 'in' : 'out'}`}>
                      {t.type === 'income' ? '+' : '-'}{fmt(t.amount)}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : <Empty icon="🔍" text="没有匹配的账单，换个关键词试试" />
        ) : (
          <div className="muted" style={{ textAlign: 'center', padding: '20px 0' }}>支持搜索最近所有账单</div>
        )}
      </Sheet>

      {/* 日历某日账单 */}
      <Sheet open={!!daySheet} onClose={() => setDaySheet(null)} title={daySheet ? `${daySheet.slice(5).replace('-', '月')}日 ${weekdayOf(daySheet)}` : ''}>
        {daySheet && <DayList date={daySheet} />}
      </Sheet>

      {/* v1.2 标签筛选 */}
      <Sheet open={tagFilterOpen} onClose={() => setTagFilterOpen(false)} title="按标签筛选">
        {allTags.length ? (
          <>
            <div className="chips">
              {allTags.map((g) => (
                <button
                  key={g}
                  className={`chip ${tagSel.includes(g) ? 'on' : ''}`}
                  onClick={() => setTagSel((s) => (s.includes(g) ? s.filter((x) => x !== g) : [...s, g]))}
                >#{g}</button>
              ))}
            </div>
            <div className="btnrow" style={{ marginTop: 14 }}>
              {tagSel.length > 0 && <button className="btn ghost" onClick={() => setTagSel([])}>清除筛选</button>}
              <button className="btn" onClick={() => setTagFilterOpen(false)}>看结果</button>
            </div>
          </>
        ) : <Empty icon="#️⃣" text="还没有标签\n记一笔时可以给账单加标签" />}
      </Sheet>
    </>
  )
}

function DayList({ date }) {
  const { state } = useStore()
  const nav = useNav()
  const list = state.transactions
    .filter((t) => t.ledgerId === state.currentLedgerId && t.date === date && !t.deletedAt)
    .sort((a, b) => b.time.localeCompare(a.time))
  if (!list.length) return <Empty icon="🍃" text="这一天没有账单" />
  return (
    <div className="txlist">
      {list.map((t) => {
        const info = catInfo(state, t)
        return (
          <div key={t.id} className="txitem" onClick={() => { nav.openAdd(t) }}>
            <div className="txicon" style={{ background: info.color + '1c' }}>{info.icon}</div>
            <div className="txmain">
              <div className="txname">{t.type === 'transfer' ? '转账' : info.name}</div>
              <div className="txnote">{[t.note, t.time].filter(Boolean).join(' · ')}</div>
            </div>
            <div className={`txamt ${t.type === 'income' ? 'in' : 'out'}`}>
              {t.type === 'income' ? '+' : '-'}{fmt(t.amount)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CalendarView({ period, sd, txs, onDay }) {
  const [y, m] = period.split('-').map(Number)
  // 显示自然月网格；期初/期末账单按日期所在期筛选已由上层完成
  const first = `${y}-${pad2(m)}-01`
  const firstDow = (parseD(first).getDay() + 6) % 7 // 周一=0
  const dim = new Date(y, m, 0).getDate()
  const today = todayStr()
  const byDay = {}
  for (const t of txs) {
    if (!byDay[t.date]) byDay[t.date] = { e: 0, i: 0 }
    if (t.type === 'expense') byDay[t.date].e += Number(t.amount)
    if (t.type === 'income') byDay[t.date].i += Number(t.amount)
  }
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= dim; d++) cells.push(`${y}-${pad2(m)}-${pad2(d)}`)
  while (cells.length % 7) cells.push(null)

  return (
    <div className="cal">
      <div className="cal-week">
        {['一', '二', '三', '四', '五', '六', '日'].map((w) => <div key={w}>{w}</div>)}
      </div>
      <div className="cal-grid">
        {cells.map((ds, i) => {
          if (!ds) return <div key={i} className="cal-cell dim" />
          const info = byDay[ds]
          return (
            <button key={i} className={`cal-cell ${ds === today ? 'today' : ''}`} onClick={() => onDay(ds)}>
              <span className="d">{Number(ds.slice(8))}</span>
              {info && info.e > 0 && <span className="e">-{Math.round(info.e)}</span>}
              {info && info.i > 0 && <span className="i">+{Math.round(info.i)}</span>}
            </button>
          )
        })}
      </div>
      <div className="muted" style={{ textAlign: 'center', marginTop: 8 }}>点击日期查看当天账单</div>
    </div>
  )
}
