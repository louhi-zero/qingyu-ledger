/* v2.5 赞助与鸣谢页：收款码（微信/支付宝，点击放大）+ 赞助名单 + 内测鸣谢名单
 * 名单数据维护在 src/support.js（SPONSORS / TESTERS 两个常量数组）
 */
import React, { useState } from 'react'
import { useStore } from '../store.jsx'
import { useNav } from '../App.jsx'
import { TopBar, Sheet } from '../ui.jsx'
import { Icon, BRAND_COLORS } from '../ui/icons.jsx'
import { openExternal, LINKS } from '../links.js'
import { SPONSORS, TESTERS } from '../support.js'
import { round2 } from '../utils.js'

export default function Support({ nav }) {
  const { toast } = useStore()
  const nav2 = useNav()
  const [zoom, setZoom] = useState(null) // { title, src }
  const total = round2(SPONSORS.reduce((a, s) => a + Number(s.amount || 0), 0))

  const openLink = (url, scheme) => {
    if (!openExternal(url, scheme)) toast('无法打开链接', 'err')
  }

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
          <div className="gtitle">赞助名单{SPONSORS.length > 0 && `（共 ${SPONSORS.length} 人 · ¥${total}）`}</div>
          {SPONSORS.length > 0 ? (
            <div className="roll-list">
              {SPONSORS.map((s, i) => (
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
          {TESTERS.length > 0 ? (
            <div className="roll-list">
              <div className="tester-flow">
                {TESTERS.map((t, i) => <span className="tester-chip" key={i}>{t}</span>)}
              </div>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12.5, padding: '4px 16px 12px' }}>内测结束后在此鸣谢参与用户</div>
          )}
        </div>

        {/* 社区 */}
        <div className="group">
          <div className="gtitle">找到作者</div>
          <div className="cell" onClick={() => openExternal(LINKS.qqGroup.url)}>
            <div className="cico"><Icon name="brandQq" size={20} color={BRAND_COLORS.tencentqq} /></div>
            <div className="cmain"><div className="ctitle">加入闲聊群</div><div className="cdesc">QQ 群【{LINKS.qqGroup.name}】· 反馈与交流</div></div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
          <div className="cell" onClick={() => openExternal(LINKS.bilibili.url, LINKS.bilibili.scheme)}>
            <div className="cico"><Icon name="bilibili" size={20} color={BRAND_COLORS.bilibili} /></div>
            <div className="cmain"><div className="ctitle">B站主页</div><div className="cdesc">更新动态与教程视频</div></div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
          <div className="cell" onClick={() => openExternal(LINKS.xiaoheihe.url)}>
            <div className="cico"><Icon name="deviceGamepad" size={20} color={BRAND_COLORS.xiaoheihe} /></div>
            <div className="cmain"><div className="ctitle">小黑盒</div><div className="cdesc">作者主页</div></div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
          <div className="cell" onClick={() => openExternal(LINKS.douyin.url)}>
            <div className="cico"><Icon name="tiktok" size={20} color={BRAND_COLORS.tiktok} /></div>
            <div className="cmain"><div className="ctitle">抖音</div><div className="cdesc">作者主页</div></div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
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
