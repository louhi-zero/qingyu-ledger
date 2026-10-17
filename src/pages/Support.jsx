/* v2.5 赞助与鸣谢页：收款码（微信/支付宝，点击放大）+ 赞助名单 + 内测鸣谢名单
 * 名单数据源（v3.6.6）：远端 support.json 优先（仓库即 CMS，改文件 + push 即更新名单），
 * 拉取失败回落 src/support.js 内置兜底数组——离线/私有仓库期页面永不空白。
 * v2.8 移除「找到作者」分组：社交入口与发现页作者卡重复，统一保留发现页入口
 */
import React, { useEffect, useState } from 'react'
import { useNav } from '../App.jsx'
import { TopBar, Sheet } from '../ui.jsx'
import { SPONSORS, TESTERS } from '../support.js'
import { getCmsJson, parseSupport } from '../cms.js'
import { round2 } from '../utils.js'

export default function Support({ nav }) {
  const nav2 = useNav()
  const [zoom, setZoom] = useState(null) // { title, src }
  const [remote, setRemote] = useState(null)
  useEffect(() => {
    let alive = true
    getCmsJson('support.json', { cacheKey: 'qingyu_support_cache_v1', parse: parseSupport }).then((d) => {
      if (alive) setRemote(d)
    })
    return () => { alive = false }
  }, [])
  const sponsors = remote ? remote.sponsors : SPONSORS
  const testers = remote ? remote.testers : TESTERS
  const total = round2(sponsors.reduce((a, s) => a + Number(s.amount || 0), 0))

  return (
    <>
      <TopBar title="赞助与鸣谢" onBack={nav.pop || nav2.pop} />
      <div className="page-body no-tab">
        {/* 收款码 */}
        <div className="group">
          <div className="gtitle">请作者喝杯奶茶</div>
          <div className="donate-row">
            <button className="donate-card" style={{ borderColor: 'var(--income)' }} onClick={() => setZoom({ title: '微信赞助', src: './donate/wechat.png' })}>
              <img src="./donate/wechat.png" alt="微信收款码" loading="lazy" />
              <span className="dlabel" style={{ color: 'var(--income)' }}>微信</span>
            </button>
            <button className="donate-card" style={{ borderColor: 'var(--brand)' }} onClick={() => setZoom({ title: '支付宝赞助', src: './donate/alipay.jpg' })}>
              <img src="./donate/alipay.jpg" alt="支付宝收款码" loading="lazy" />
              <span className="dlabel" style={{ color: 'var(--brand)' }}>支付宝</span>
            </button>
          </div>
          <div className="muted" style={{ fontSize: 12, padding: '2px 16px 10px', lineHeight: 1.7 }}>
            点击二维码可放大，截图后到对应 App「扫一扫」从相册识别即可赞助。金额不限，心意最重要；赞助后可在群里告知作者记入名单。
          </div>
        </div>

        {/* 赞助名单 */}
        <div className="group">
          <div className="gtitle">赞助名单{sponsors.length > 0 && `（共 ${sponsors.length} 人 · ¥${total}）`}</div>
          {sponsors.length > 0 ? (
            <div className="roll-list">
              {sponsors.map((s, i) => (
                <div className="roll-item" key={i}>
                  <span className="ridx">{i + 1}</span>
                  <span className="rname">{s.id}</span>
                  <span className="ramt">¥{s.amount}元</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12.5, padding: '4px 16px 12px' }}>虚位以待——点击上方收款码成为第一位赞助者</div>
          )}
        </div>

        {/* 内测鸣谢 */}
        <div className="group">
          <div className="gtitle">内测鸣谢</div>
          {testers.length > 0 ? (
            <div className="roll-list">
              <div className="tester-flow">
                {testers.map((t, i) => <span className="tester-chip" key={i}>{t}</span>)}
              </div>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12.5, padding: '4px 16px 12px' }}>内测结束后在此鸣谢参与用户</div>
          )}
        </div>
      </div>

      {/* 收款码放大 */}
      <Sheet open={!!zoom} onClose={() => setZoom(null)} title={zoom?.title || ''}>
        {zoom && (
          <div style={{ textAlign: 'center' }}>
            <img src={zoom.src} alt={zoom.title} style={{ maxWidth: '100%', maxHeight: 420, borderRadius: 14 }} />
            <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>长按或截图保存，到对应 App「扫一扫」从相册识别</div>
          </div>
        )}
      </Sheet>
    </>
  )
}
