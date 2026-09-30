import React, { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { useNav } from '../App.jsx'
import { TopBar, Seg, Empty } from '../ui.jsx'
import { Donut, Bars } from '../charts.jsx'
import {
  fmt, fmt0, todayStr, periodOf, periodAdd, periodLabel, weekdayOf,
  txsOfPeriod, txsOfWeek, txsOfYear, sumBy, statByCategory, weekKey, weekDays, weekLabel,
  pad2, periodBounds, round2, yearOf,
} from '../utils.js'

export default function ChartsPage() {
  const { state } = useStore()
  const nav = useNav()
  const sd = state.settings.monthStartDay || 1
  const [scope, setScope] = useState('month') // week | month | year
  const [period, setPeriod] = useState(periodOf(todayStr(), sd))
  const [week, setWeek] = useState(weekKey(todayStr()))
  const [year, setYear] = useState(yearOf(todayStr(), sd))
  const [metric, setMetric] = useState('balance') // balance | expense | income

  const weekTxs = useMemo(() => txsOfWeek(state, week), [state, week])
  const monthTxs = useMemo(() => txsOfPeriod(state, period), [state, period])
  const yearTxs = useMemo(() => txsOfYear(state, year), [state, year])

  const curTxs = scope === 'week' ? weekTxs : scope === 'month' ? monthTxs : yearTxs
  const exp = sumBy(curTxs, 'expense')
  const inc = sumBy(curTxs, 'income')
  const bal = round2(inc - exp)
  const metricVal = metric === 'balance' ? bal : metric === 'expense' ? exp : inc

  // 周视图数据
  const weekData = useMemo(() => {
    return weekDays(week).map((ds) => {
      const day = curTxs.filter((t) => t.date === ds)
      return { label: weekdayOf(ds).replace('星期', ''), value: sumBy(day, metric === 'income' ? 'income' : 'expense') }
    })
  }, [week, curTxs, metric])
  const weekTotal = sumBy(weekTxs, metric === 'income' ? 'income' : 'expense')
  const weekAvg = round2(weekTotal / 7)

  // 年视图数据
  const yearData = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const p = `${year}-${pad2(i + 1)}`
      const [s, e] = periodBounds(p, sd)
      const list = yearTxs.filter((t) => t.date >= s && t.date < e)
      return {
        label: `${i + 1}月`,
        value: metric === 'income' ? sumBy(list, 'income') : sumBy(list, 'expense'),
        inc: sumBy(list, 'income'), exp: sumBy(list, 'expense'),
      }
    })
  }, [year, yearTxs, metric, sd])

  // 分类排行
  const catStats = useMemo(() => statByCategory(curTxs, metric === 'income' ? 'income' : 'expense', state), [curTxs, metric, state])
  const statTotal = catStats.reduce((a, c) => a + c.value, 0)

  const colorOf = metric === 'income' ? 'var(--income)' : metric === 'balance' ? 'var(--brand)' : 'var(--expense)'

  const navTitle = () => {
    if (scope === 'week') return weekLabel(week)
    if (scope === 'month') return periodLabel(period)
    return `${year}年`
  }
  const navShift = (dir) => {
    if (scope === 'week') setWeek((w) => {
      const d = new Date(w); d.setDate(d.getDate() + 7 * dir)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })
    else if (scope === 'month') setPeriod((p) => periodAdd(p, dir, sd))
    else setYear((y) => String(Number(y) + dir))
  }

  return (
    <>
      <TopBar title="图表" right={<span className="muted">{curTxs.length} 笔</span>} />
      <div className="page-body">
        <div style={{ marginBottom: 12 }}>
          <Seg options={[{ value: 'week', label: '周' }, { value: 'month', label: '月账单' }, { value: 'year', label: '年账单' }]} value={scope} onChange={setScope} />
        </div>

        <div className="ymnav">
          <button onClick={() => navShift(-1)}>‹</button>
          <div className="ym">{navTitle()}</div>
          <button onClick={() => navShift(1)}>›</button>
        </div>

        {/* 汇总 */}
        <div className="card">
          <div style={{ marginBottom: 10 }}>
            <Seg options={[{ value: 'balance', label: '结余' }, { value: 'expense', label: '支出' }, { value: 'income', label: '收入' }]} value={metric} onChange={setMetric} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="muted">{metric === 'balance' ? '结余' : metric === 'expense' ? '总支出' : '总收入'}</div>
            <div className="big-num" style={{ color: metric === 'balance' ? (bal >= 0 ? 'var(--ink)' : 'var(--expense)') : colorOf }}>
              ¥{fmt(metricVal)}
            </div>
            {scope === 'week' && metric !== 'balance' && (
              <div className="muted">平均值 ¥{fmt(weekAvg)} / 天</div>
            )}
            {metric === 'balance' && (
              <div className="muted">收 ¥{fmt(inc)} · 支 ¥{fmt(exp)}</div>
            )}
          </div>
        </div>

        {curTxs.length === 0 ? (
          <div className="card"><Empty icon="📊" text="记几笔再来看统计" /></div>
        ) : (
          <>
            {/* AI 解读（仅月/年视图） */}
            {scope !== 'week' && (
              <AiMiniCard
                report={state.aiReports?.[scope === 'year' ? year : period]}
                onOpen={() => nav.push({
                  page: 'ai', title: 'AI 账单分析',
                  params: { kind: scope, period: scope === 'year' ? year : period },
                })}
              />
            )}

            {/* 周：每日柱状 */}
            {scope === 'week' && metric !== 'balance' && (
              <div className="card">
                <div className="card-title">每日{metric === 'expense' ? '支出' : '收入'}</div>
                <div style={{ marginTop: 10 }}>
                  <Bars data={weekData} color={colorOf} />
                </div>
              </div>
            )}

            {/* 年：每月柱状 */}
            {scope === 'year' && (
              <div className="card">
                <div className="card-title">{metric === 'income' ? '月收入' : '月支出'}</div>
                <div style={{ marginTop: 10 }}>
                  <Bars data={yearData} color={colorOf} />
                </div>
                <div className="hr" />
                <table className="plain">
                  <thead><tr><th>月份</th><th>收入</th><th>支出</th><th>结余</th></tr></thead>
                  <tbody>
                    {yearData.filter((m) => m.inc || m.exp).map((m) => (
                      <tr key={m.label}>
                        <td>{m.label}</td><td>{fmt(m.inc)}</td><td>{fmt(m.exp)}</td>
                        <td style={{ color: m.inc - m.exp >= 0 ? 'var(--green)' : 'var(--expense)' }}>{fmt(m.inc - m.exp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 分类占比（周/月） */}
            {scope !== 'year' && (
              <div className="card">
                <div className="card-title">
                  {metric === 'income' ? '收入' : '支出'}分类占比
                  <span className="muted" style={{ fontWeight: 400, marginLeft: 'auto' }}>共 {catStats.length} 类</span>
                </div>
                <div style={{ marginTop: 10 }}>
                  <Donut
                    data={catStats.map((c) => ({ label: c.name, value: c.value, color: c.color }))}
                    centerLabel={metric === 'income' ? '总收入' : '总支出'}
                    centerValue={`¥${fmt(statTotal)}`}
                  />
                </div>
              </div>
            )}

            {/* 排行榜 */}
            {catStats.length > 0 && (
              <div className="card">
                <div className="card-title" style={{ marginBottom: 6 }}>
                  {metric === 'income' ? '收入' : '支出'}排行榜
                </div>
                {catStats.map((c, i) => (
                  <div className="rankrow" key={c.id}>
                    <span className="rk">{i + 1}</span>
                    <div className="txicon" style={{ background: c.color + '1c', width: 34, height: 34, fontSize: 17 }}>{c.icon}</div>
                    <div className="rmain">
                      <div className="rname"><span>{c.name} <span className="muted">×{c.count}</span></span><span className="rv">¥{fmt(c.value)}</span></div>
                      <div className="rbar"><i style={{ width: `${statTotal ? (c.value / statTotal) * 100 : 0}%`, background: c.color }} /></div>
                    </div>
                    <span className="muted" style={{ width: 38, textAlign: 'right' }}>{Math.round((c.value / (statTotal || 1)) * 100)}%</span>
                  </div>
                ))}
                <div className="muted" style={{ textAlign: 'center', paddingTop: 8 }}>点占比条可回到图表查看</div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

// AI 解读摘要卡：无缓存时是入口，有缓存时展示结构化亮点
function AiMiniCard({ report, onOpen }) {
  const st = report?.struct
  return (
    <div
      className="card"
      style={{
        cursor: 'pointer',
        background: 'linear-gradient(135deg, rgba(111,107,255,.13), rgba(76,125,255,.07))',
        border: '1px solid color-mix(in srgb, var(--brand2) 22%, transparent)',
      }}
      onClick={onOpen}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 26 }}>🤖</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14.5 }}>
            {st?.title || 'AI 解读本期账单'}
          </div>
          {st?.highlights?.[0] ? (
            <div className="muted" style={{ marginTop: 3, fontSize: 12.5, lineHeight: 1.6 }}>
              🌟 {st.highlights[0]}
            </div>
          ) : report?.narrative ? (
            <div className="muted" style={{ marginTop: 3, fontSize: 12.5 }}>已生成解读，点击查看完整报告</div>
          ) : (
            <div className="muted" style={{ marginTop: 3, fontSize: 12.5 }}>大模型分析收支结构、异常与建议</div>
          )}
          {st?.prediction && (
            <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.6 }}>
              📈 {st.prediction}
            </div>
          )}
        </div>
        <span className="arrow muted">›</span>
      </div>
    </div>
  )
}
