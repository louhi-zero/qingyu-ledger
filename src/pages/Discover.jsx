import React, { useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { useNav } from '../App.jsx'
import { Seg, StatRow, Bar, Amount, Sheet } from '../ui.jsx'
import { Ring } from '../charts.jsx'
import { AiFace, useDiscIconImgs } from '../theme.jsx'
import { fmt, periodOf, periodLabel, txsOfPeriod, sumBy, netWorth, round2, todayStr } from '../utils.js'
import { getNotice, unreadNotice, loadRead, saveRead, noticeKey } from '../notice.js'

// v1.6.8 发现页功能图标自定义：key 与设置弹层共用
export const DISCOVER_TOOLS = [
  { key: 'scan', icon: '📸', name: '扫票记账', page: 'scan' },
  { key: 'assets', icon: '🏦', name: '资产管家', page: 'assets' },
  { key: 'creditCards', icon: '🪪', name: '信用卡', page: 'creditCards' },
  { key: 'debts', icon: '📉', name: '债务管理', page: 'debts' },
  { key: 'goals', icon: '🎯', name: '储蓄目标', page: 'goals' },
  { key: 'reimburse', icon: '💼', name: '报销管理', page: 'reimburse' },
  { key: 'templates', icon: '⚡', name: '记账模板', page: 'templates' },
  { key: 'loan', icon: '🏠', name: '房贷计算器', page: 'loan' },
  { key: 'fx', icon: '💱', name: '汇率换算', page: 'fx' },
  { key: 'invoice', icon: '🧾', name: '发票助手', page: 'invoice' },
  { key: 'import', icon: '📥', name: '账单导入', page: 'import' },
  { key: 'recurring', icon: '🔁', name: '周期记账', page: 'recurring' },
  { key: 'ledgers', icon: '📒', name: '账本管理', page: 'ledgers' },
  { key: 'review', icon: '🪄', name: '消费点评', page: 'review' },
]

export default function Discover() {
  const { state } = useStore()
  const nav = useNav()
  const discImgs = useDiscIconImgs(DISCOVER_TOOLS.map((t) => t.key))
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

  const aiReport = state.aiReports?.[period]

  // v1.6.5 公告卡：拉取 notice.json（三级缓存），未读红点，点击看全文
  const [noticeList, setNoticeList] = useState([])
  const [noticeUnread, setNoticeUnread] = useState(0)
  const [noticeOpen, setNoticeOpen] = useState(false)
  useEffect(() => {
    let alive = true
    getNotice().then((n) => {
      if (!alive || !n?.list?.length) return
      const sorted = [...n.list].sort((a, b) => (a.date < b.date ? 1 : -1))
      setNoticeList(sorted)
      setNoticeUnread(unreadNotice(sorted, loadRead()).length)
    }).catch(() => {})
    return () => { alive = false }
  }, [])
  const openNotice = () => {
    setNoticeOpen(true)
    if (noticeList.length) {
      saveRead(noticeList[0].date || todayStr()) // 列表按日期倒序，首个即最新
      setNoticeUnread(0)
    }
  }

  return (
    <>
      <TopBarStatic title="发现" />
      <div className="page-body">
        {/* 公告卡 */}
        {noticeList.length > 0 && state.settings.noticeEnabled !== false && (
          <div className="card" style={{ cursor: 'pointer' }} onClick={openNotice}>
            <div className="card-title" style={{ gap: 8 }}>
              📢 公告
              <span className="ncount">{noticeList.length}</span>
              {noticeUnread > 0 && <span className="ndot" aria-label={`${noticeUnread} 条未读公告`} />}
              <span className="muted" style={{ fontWeight: 400, marginLeft: 'auto', fontSize: 12 }}>{noticeList[0].date}</span>
            </div>
            <div className="card-sub" style={{ marginTop: 6 }}>{noticeList[0].title}</div>
          </div>
        )}
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
            <AiFace style={{ fontSize: 34, lineHeight: 1 }} />
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
          <div className="card-title" style={{ marginBottom: 12 }}>
            常用功能
            <button
              type="button"
              className="disc-custom-btn"
              onClick={() => nav.push({ page: 'settingsSection', title: '外观与个性化', params: { section: 'appearance' } })}
            >🎨 自定义图标</button>
          </div>
          <div className="grid4">
            {DISCOVER_TOOLS.map((t) => (
              <button key={t.key} className="gitem" onClick={() => nav.push({ page: t.page })}>
                <div className={`gi${discImgs[t.key] ? ' gi-img' : ''}`}>
                  {discImgs[t.key]
                    ? <img src={discImgs[t.key]} alt="" decoding="async" draggable="false" />
                    : t.icon}
                </div>
                <span>{t.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 公告列表（打开即清除红点，已在 openNotice 中记录已读） */}
      <Sheet open={noticeOpen} onClose={() => setNoticeOpen(false)} title="📢 公告">
        <div className="nlist">
          {noticeList.map((a) => (
            <div key={noticeKey(a)} className="nitem">
              <div className="nitem-head">
                <b>{a.title}</b>
                {a.important && <span className="tag" style={{ color: 'var(--expense)' }}>重要</span>}
                <span className="muted" style={{ marginLeft: 'auto', fontSize: 11.5 }}>{a.date}</span>
              </div>
              <div className="nitem-body">{a.content}</div>
            </div>
          ))}
        </div>
      </Sheet>
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
