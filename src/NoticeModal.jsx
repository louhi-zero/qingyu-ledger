import { Icon } from "./ui/icons.jsx"
import React from 'react'
import { noticeKey, addConfirmed } from './notice.js'

/* v1.6.5 重要公告强弹窗（机制移植自 NexBox ImportantAnnouncementModal）
 * 与原版的差异：本组件只在 App.jsx 判定「接收公告开关开启 且 存在未确认重要公告」时才挂载，
 * 不存在"关了公告设置仍被拦门"的问题（原版缺陷①）。
 * 弹窗本身仍无  / 无遮罩关闭 / 无 Esc —— 重要通知必须点「知道了」确认后写入已确认列表。
 */
export default function NoticeModal({ notice, remain = 0, onConfirm }) {
  if (!notice) return null
  return (
    <div className="nmodal" role="alertdialog" aria-modal="true" aria-label="重要公告">
      <div className="ncard">
        <div className="ncard-head">
          <div className="ncard-title"><Icon name="megaphone" size="1em" className="qy-inline-icon" /> {notice.title}</div>
          <div className="ncard-date">
            {notice.date || ' '}
            {remain > 0 && <span style={{ marginLeft: 8 }}>还有 {remain} 条重要通知</span>}
          </div>
        </div>
        <div className="ncard-body">{notice.content}</div>
        <div className="ncard-foot">
          <button
            className="btn"
            onClick={() => { addConfirmed(noticeKey(notice)); onConfirm?.() }}
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  )
}
