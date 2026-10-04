import React, { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { TopBar, Empty, Confirm, CatIcon } from '../ui.jsx'
import { catInfo, fmt, accountName } from '../utils.js'
import { blobDel } from '../blobdb.js'

const DAY = 86400000
const KEEP_DAYS = 30

// v1.4 回收站：软删账单 30 天内可恢复，超期自动清除（见 store.jsx 启动清理）
export default function Trash({ nav }) {
  const { state, set, toast } = useStore()
  const [purgeId, setPurgeId] = useState(null)
  const [restoreId, setRestoreId] = useState(null)

  const list = useMemo(
    () => state.transactions
      .filter((t) => t.deletedAt)
      .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt))),
    [state.transactions],
  )

  const doRestore = () => {
    set((d) => {
      const t = d.transactions.find((x) => x.id === restoreId)
      if (t) t.deletedAt = null
    })
    setRestoreId(null)
    toast('已恢复该账单')
  }

  const doPurge = () => {
    const id = purgeId
    set((d) => { d.transactions = d.transactions.filter((x) => x.id !== id) })
    blobDel(`att_${id}`).catch(() => {})
    setPurgeId(null)
    toast('已彻底删除')
  }

  const purgeTarget = list.find((t) => t.id === purgeId)

  return (
    <>
      <TopBar title="回收站" onBack={nav.pop} />
      <div className="page-body no-tab">
        <div className="card" style={{ background: 'var(--grad-soft)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.8 }}>
            🗑️ 删除的账单会在这里保留 {KEEP_DAYS} 天，期间可随时恢复；超过 {KEEP_DAYS} 天将在下次打开轻语记账时自动清除。
          </div>
        </div>

        {!list.length && (
          <div className="card">
            <Empty icon="🍃" text="回收站是空的，删除的账单会先出现在这里" />
          </div>
        )}

        {list.map((t) => {
          const info = catInfo(state, t)
          const days = Math.floor((Date.now() - new Date(t.deletedAt).getTime()) / DAY)
          const left = Math.max(0, KEEP_DAYS - days)
          return (
            <div key={t.id} className="cell" style={{ alignItems: 'center' }}>
              <div className="cico" style={{ background: info.color + '22', opacity: .7 }}><CatIcon icon={info.icon} size={18} /></div>
              <div className="cmain">
                <div className="ctitle">{t.type === 'transfer' ? '转账' : info.name}
                  <span className="muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 6 }}>
                    {t.note ? t.note.slice(0, 12) : accountName(state, t.accountId)}
                  </span>
                </div>
                <div className="cdesc">{t.date} {t.time} 删除 · 剩 {left} 天自动清除</div>
              </div>
              <div className="cright" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <b className={t.type === 'income' ? '' : t.type === 'expense' ? '' : ''}
                  style={{ color: t.type === 'income' ? 'var(--income)' : t.type === 'expense' ? 'var(--expense)' : 'var(--ink)' }}>
                  {t.type === 'income' ? '+' : t.type === 'expense' ? '-' : ''}{fmt(t.amount)}
                </b>
                <button className="chip" onClick={() => setRestoreId(t.id)}>恢复</button>
                <button className="chip" style={{ color: 'var(--expense)' }} onClick={() => setPurgeId(t.id)}>✕</button>
              </div>
            </div>
          )
        })}
      </div>

      <Confirm
        open={!!restoreId}
        title="恢复这笔账单？"
        text="恢复后回到原账本，参与统计与余额计算。"
        okText="恢复"
        onOk={doRestore}
        onCancel={() => setRestoreId(null)}
      />
      <Confirm
        open={!!purgeId}
        title="彻底删除？"
        text={purgeTarget ? `「${catInfo(state, purgeTarget).name} ¥${fmt(purgeTarget.amount)}」将被永久删除，附件一并清除，无法恢复。` : ''}
        okText="彻底删除"
        danger
        onOk={doPurge}
        onCancel={() => setPurgeId(null)}
      />
    </>
  )
}
