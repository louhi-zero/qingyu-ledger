import React, { useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { useNav } from '../App.jsx'
import { Seg, StatRow, Bar, Amount, Sheet } from '../ui.jsx'
import { Icon, BRAND_COLORS, SEMANTIC_COLOR } from '../ui/icons.jsx'
import { openExternal, LINKS } from '../links.js'
import { Ring } from '../charts.jsx'
import { AiFace, useDiscIconImgs } from '../theme.jsx'
import { fmt, periodOf, periodLabel, txsOfPeriod, sumBy, netWorth, round2, todayStr } from '../utils.js'
import { getNotice, unreadNotice, loadRead, saveRead, noticeKey } from '../notice.js'

// v1.6.8 发现页功能图标自定义：key 与设置弹层共用
export const DISCOVER_TOOLS = [
  { key: 'scan', icon: 'camera', name: '扫票记账', page: 'scan' },
  { key: 'assets', icon: 'buildingBank', name: '资产管家', page: 'assets' },
  { key: 'creditCards', icon: 'creditCard', name: '信用卡', page: 'creditCards' },
  { key: 'debts', icon: 'trendingDown', name: '债务管理', page: 'debts' },
  { key: 'goals', icon: 'targetArrow', name: '储蓄目标', page: 'goals' },
  { key: 'reimburse', icon: 'briefcase', name: '报销管理', page: 'reimburse' },
  { key: 'templates', icon: 'bolt', name: '记账模板', page: 'templates' },
  { key: 'loan', icon: 'home', name: '房贷计算器', page: 'loan' },
  { key: 'fx', icon: 'currencyDollar', name: '汇率换算', page: 'fx' },
  { key: 'invoice', icon: 'receipt', name: '发票助手', page: 'invoice' },
  { key: 'import', icon: 'download', name: '账单导入', page: 'import' },
  { key: 'recurring', icon: 'repeat', name: '周期记账', page: 'recurring' },
  { key: 'ledgers', icon: 'books', name: '账本管理', page: 'ledgers' },
  { key: 'review', icon: 'wand', name: '消费点评', page: 'review' },
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
              <Icon name="bellRinging" size={17} color="var(--brand)" /> 公告
              <span className="ncount">{noticeList.length}</span>
              {noticeUnread > 0 && <span className="ndot" aria-label={`${noticeUnread} 条未读公告`} />}
              <span className="muted" style={{ fontWeight: 400, marginLeft: 'auto', fontSize: 12 }}>{noticeList[0].date}</span>
            </div>
            <div className="card-sub" style={{ marginTop: 6 }}>{noticeList[0].title}</div>
          </div>
        )}
        {/* 作者与社区（v2.5，参考作者卡片：头像 + 名字 + 社交图标行） */}
        <div className="card author-card">
          <div className="author-avatar author-avatar-fallback"><Icon name="user" size={26} color="#fff" /></div>
          <div className="author-info">
            <div className="author-name">洛希</div>
            <div className="author-role">作者 · 轻语记账</div>
          </div>
          <div className="author-links">
            <button className="slink" title="小黑盒" aria-label="小黑盒主页" onClick={() => openExternal(LINKS.xiaoheihe.url)}>
              <Icon name="deviceGamepad" size={19} color={BRAND_COLORS.xiaoheihe} />
            </button>
            <button className="slink" title="B站" aria-label="B站主页" onClick={() => openExternal(LINKS.bilibili.url, LINKS.bilibili.scheme)}>
              <Icon name="bilibili" size={19} color={BRAND_COLORS.bilibili} />
            </button>
            <button className="slink" title="抖音" aria-label="抖音主页" onClick={() => openExternal(LINKS.douyin.url)}>
              <Icon name="tiktok" size={19} color={BRAND_COLORS.tiktok} />
            </button>
          </div>
        </div>
        <div className="card" style={{ cursor: 'pointer', padding: '12px 16px' }} onClick={() => openExternal(LINKS.qqGroup.url)}>
          <div className="card-title" style={{ gap: 8, marginBottom: 0 }}>
            <Icon name="brandQq" size={20} color={BRAND_COLORS.tencentqq} />
            加入闲聊群【{LINKS.qqGroup.name}】
            <span className="muted" style={{ fontWeight: 400, marginLeft: 'auto', fontSize: 12 }}>点击加入 ›</span>
          </div>
        </div>

        {/* 支持作者（v2.5：收款码 + 赞助名单 + 内测鸣谢） */}
        <div className="card" style={{ cursor: 'pointer', padding: '12px 16px' }} onClick={() => nav.push({ page: 'support', title: '赞助与鸣谢' })}>
          <div className="card-title" style={{ gap: 8, marginBottom: 0 }}>
            <Icon name="heartHandshake" size={20} color="var(--brand)" />
            赞助与鸣谢
            <span className="muted" style={{ fontWeight: 400, marginLeft: 'auto', fontSize: 12 }}>名单与收款码 ›</span>
          </div>
        </div>

        {/* 本月概览 */}
        <div className="card">
          <div className="card-title">{periodLabel(period)}账单
            <span className="muted" style={{ fontWeight: 400, marginLeft: 'auto' }}>{txs.length} 笔</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <StatRow items={[
              { k: '收入', v: `¥${fmt(inc)}`, color: 'var(--income)' },
              { k: '支出', v: `¥${fmt(exp)}`, color: 'var(--expense)' },
              { k: bal < 0 ? '超支' : '结余', v: `¥${fmt(Math.abs(bal))}`, color: bal >= 0 ? 'var(--green)' : 'var(--expense)' },
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
                {usePct > 100 && <div className="muted" style={{ color: 'var(--expense)', marginTop: 6 }}><Icon name="warning" size="1em" className="qy-inline-icon" /> 已超支 ¥{fmt(exp - budget)}</div>}
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
            <div><Icon name="wand" size={30} color="var(--brand)" /></div>
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
            >
              <Icon name="palette" size={15} color="var(--ink3)" />
              <span style={{ fontSize: 12 }}>自定义图标</span>
            </button>
          </div>
          <div className="grid4">
            {DISCOVER_TOOLS.map((t) => (
              <button key={t.key} className="gitem" onClick={() => nav.push({ page: t.page })}>
                <div className={`gi${discImgs[t.key] ? ' gi-img' : ''}`}>
                  {discImgs[t.key]
                    ? <img src={discImgs[t.key]} alt="" decoding="async" draggable="false" />
                    : <Icon name={t.icon} size={22} color={SEMANTIC_COLOR(t.key)} />}
                </div>
                <span>{t.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 公告列表（打开即清除红点，已在 openNotice 中记录已读） */}
        <Sheet open={noticeOpen} onClose={() => setNoticeOpen(false)} title="公告">
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
