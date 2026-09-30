import React from 'react'
import { useStore } from '../store.jsx'
import { useNav } from '../App.jsx'
import { Seg, StatRow, Bar, Amount } from '../ui.jsx'
import { Ring } from '../charts.jsx'
import { fmt, periodOf, periodLabel, txsOfPeriod, sumBy, netWorth, round2, todayStr } from '../utils.js'

export default function Discover() {
  const { state } = useStore()
  const nav = useNav()
  const sd = state.settings.monthStartDay || 1
  const period = periodOf(todayStr(), sd)
  const txs = txsOfPeriod(state, period)
  const exp = sumBy(txs, 'expense')
  const inc = sumBy(txs, 'income')
  const bal = round2(inc - exp)
  const budget = state.budgets?.total || 0
  const remain = round2(budget - exp)
  const usePct = budget > 0 ? (exp / budget) * 100 : 0
  const nw = netWorth(state)

  const tools = [
    { icon: '🏦', name: '资产管家', page: 'assets' },
    { icon: '🏠', name: '房贷计算器', page: 'loan' },
    { icon: '💱', name: '汇率换算', page: 'fx' },
    { icon: '🧾', name: '发票助手', page: 'invoice' },
    { icon: '📥', name: '账单导入', page: 'import' },
    { icon: '🔁', name: '周期记账', page: 'recurring' },
    { icon: '📒', name: '账本管理', page: 'ledgers' },
    { icon: '🪄', name: '消费点评', page: 'review' },
  ]
  const aiReport = state.aiReports?.[period]

  return (
    <>
      <TopBarStatic title="发现" />
      <div className="page-body">
        {/* 本月概览 */}
        <div className="card">
          <div className="card-title">{periodLabel(period)}账单
            <span className="muted" style={{ fontWeight: 400, marginLeft: 'auto' }}>{txs.length} 笔</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <StatRow items={[
              { k: '收入', v: `¥${fmt(inc)}`, color: 'var(--income)' },
              { k: '支出', v: `¥${fmt(exp)}`, color: 'var(--expense)' },
              { k: '结余', v: `¥${fmt(bal)}`, color: bal >= 0 ? 'var(--green)' : 'var(--expense)' },
            ]} />
          </div>
        </div>

        {/* 预算卡 */}
        <div className="card" style={{ cursor: 'pointer' }} onClick={() => nav.push({ page: 'budget' })}>
          <div className="card-title">
            {periodLabel(period)}总预算
            {budget <= 0 && <button className="chip on" style={{ marginLeft: 'auto' }} onClick={(e) => { e.stopPropagation(); nav.push({ page: 'budget' }) }}>+ 设置预算</button>}
          </div>
          {budget > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12 }}>
              <Ring pct={usePct} color={usePct > 100 ? 'var(--expense)' : usePct > 80 ? 'var(--warn)' : 'var(--brand)'} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                  <span className="muted">剩余预算</span>
                  <b style={{ color: remain >= 0 ? 'var(--green)' : 'var(--expense)' }}>¥{fmt(remain)}</b>
                </div>
                <div className="muted" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>本月预算</span><span>¥{fmt(budget)}</span>
                </div>
                <div className="muted" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>本月支出</span><span>¥{fmt(exp)}</span>
                </div>
                {usePct > 100 && <div className="muted" style={{ color: 'var(--expense)', marginTop: 6 }}>⚠ 已超支 ¥{fmt(exp - budget)}</div>}
              </div>
            </div>
          ) : (
            <div className="muted" style={{ marginTop: 10, lineHeight: 1.7 }}>
              还没有预算。设一个总预算，再给分类配上预算，超支前会提醒你。
            </div>
          )}
        </div>

        {/* 资产卡 */}
        <div className="card" style={{ cursor: 'pointer' }} onClick={() => nav.push({ page: 'assets' })}>
          <div className="card-title">资产管家
            <span className="muted arrow" style={{ marginLeft: 'auto' }}>›</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <StatRow items={[
              { k: '资产', v: `¥${fmt(nw.asset)}` },
              { k: '负债', v: `¥${fmt(nw.debt)}`, color: 'var(--expense)' },
              { k: '净资产', v: `¥${fmt(nw.net)}`, color: 'var(--brand)' },
            ]} />
          </div>
        </div>

        {/* AI 账单分析横幅 */}
        <div className="card" style={{ background: 'linear-gradient(135deg, rgba(111,107,255,.14), rgba(76,125,255,.08))', border: '1px solid color-mix(in srgb, var(--brand2) 25%, transparent)', cursor: 'pointer' }} onClick={() => nav.push({ page: 'ai', title: 'AI 账单分析', params: { kind: 'month', period } })}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 34 }}>🤖</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>AI 账单分析</div>
              <div className="muted" style={{ marginTop: 2 }}>
                {aiReport?.struct?.title || '智谱大模型解读本月收支，支持四种风格'}
              </div>
            </div>
            <span className="arrow muted">›</span>
          </div>
        </div>

        {/* 消费点评横幅 */}
        <div className="card" style={{ background: 'var(--grad-soft)', border: '1px solid color-mix(in srgb, var(--brand) 18%, transparent)', cursor: 'pointer' }} onClick={() => nav.push({ page: 'review' })}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 34 }}>🪄</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>本月消费点评</div>
              <div className="muted" style={{ marginTop: 2 }}>一键生成一段话点评与可执行建议</div>
            </div>
            <span className="arrow muted">›</span>
          </div>
        </div>

        {/* 常用功能 */}
        <div className="card">
          <div className="card-title" style={{ marginBottom: 12 }}>常用功能</div>
          <div className="grid4">
            {tools.map((t) => (
              <button key={t.page} className="gitem" onClick={() => nav.push({ page: t.page })}>
                <div className="gi">{t.icon}</div>
                <span>{t.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function TopBarStatic({ title }) {
  return (
    <div className="topbar">
      <div className="side" />
      <div className="title">{title}</div>
      <div className="side r" />
    </div>
  )
}
