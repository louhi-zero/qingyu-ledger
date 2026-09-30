import React, { useMemo, useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { TopBar, Sheet, Empty } from '../ui.jsx'
import {
  parseBillCSV, uid, nowTime, todayStr, txsToCSV, downloadFile, txsOfLedger,
  findCat, catInfo, accountName, fmt, hashStr,
} from '../utils.js'

const SAMPLE = `交易时间,交易类型,交易对方,商品说明,金额
2026-09-01 12:30,支出,某餐厅,餐饮美食-午餐,35.00
2026-09-02 08:05,支出,地铁公司,交通出行-公交地铁,6.00
2026-09-05 10:00,收入,某公司,工资,8800.00`

export default function ImportPage({ nav }) {
  const { state, set, toast } = useStore()
  const [drafts, setDrafts] = useState(null)
  const [sel, setSel] = useState({})
  const fileRef = useRef(null)
  const existing = useRef(new Set())

  const readFile = (file) => {
    const reader = new FileReader()
    reader.onload = () => {
      let text = String(reader.result || '')
      try {
        // 简单处理 GBK 场景仍可能乱码，提示 UTF-8
        const list = parseBillCSV(text, state)
        if (!list.length) {
          toast('未识别到有效账单，请确认文件内容格式', 'err')
          return
        }
        const hashes = new Set(state.transactions.map((t) => hashStr(`${t.date}|${t.time}|${t.type}|${t.amount}|${t.note || ''}`)))
        existing.current = hashes
        const pick = {}
        let dup = 0
        for (const d of list) {
          const key = hashStr(`${d.date}|${d.time}|${d.type}|${d.amount}|${d.note || ''}`)
          if (hashes.has(key) || hashes.has(d.sourceHash)) { dup++; pick[d.sourceHash] = false }
          else pick[d.sourceHash] = true
        }
        setSel(pick)
        setDrafts(list)
        toast(`识别到 ${list.length} 笔${dup ? `，其中 ${dup} 笔疑似重复` : ''}`)
      } catch (e) {
        toast('解析失败：' + e.message, 'err')
      }
    }
    reader.readAsText(file, 'utf-8')
  }

  const checkedCount = drafts ? drafts.filter((d) => sel[d.sourceHash]).length : 0

  const confirmImport = () => {
    const chosen = drafts.filter((d) => sel[d.sourceHash])
    if (!chosen.length) { toast('请勾选要导入的账单', 'err'); return }
    set((d) => {
      for (const dr of chosen) {
        d.transactions.push({
          id: uid(), ledgerId: d.currentLedgerId,
          date: dr.date, time: dr.time || nowTime(),
          type: dr.type, amount: dr.amount,
          categoryId: dr.categoryId, accountId: dr.accountId,
          note: dr.note ? `[导入]${dr.note}` : '[导入]账单',
          createdAt: new Date().toISOString(),
        })
      }
    })
    toast(`成功导入 ${chosen.length} 笔账单`)
    setDrafts(null)
  }

  const doExport = () => {
    const txs = txsOfLedger(state)
    if (!txs.length) { toast('当前账本还没有账单', 'err'); return }
    downloadFile(`轻语账单_${todayStr()}.csv`, txsToCSV(state, txs), 'text/csv')
    toast('已导出 CSV 文件')
  }

  const toggleAll = (v) => {
    const pick = {}
    for (const d of drafts) pick[d.sourceHash] = v
    setSel(pick)
  }

  return (
    <>
      <TopBar title="账单导入 / 导出" onBack={nav.pop} />
      <div className="page-body no-tab">
        <div className="card">
          <div className="card-title">📥 导入支付宝 / 微信账单</div>
          <div className="card-sub">支持从支付宝、微信导出的 CSV 账单，自动识别日期、金额与收支方向，并按关键词猜测分类。重复账单会自动标记。</div>
          <div style={{ height: 12 }} />
          <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = '' }} />
          <div className="btnrow">
            <button className="btn" onClick={() => fileRef.current?.click()}>选择 CSV 文件</button>
          </div>
          <div style={{ height: 10 }} />
          <button className="btn ghost" onClick={() => {
            const list = parseBillCSV(SAMPLE, state)
            const pick = {}
            list.forEach((d) => { pick[d.sourceHash] = true })
            setSel(pick); setDrafts(list)
          }}>用示例数据试一下</button>
        </div>

        <div className="card">
          <div className="card-title">📤 导出当前账本</div>
          <div className="card-sub">导出为 UTF-8 编码 CSV，可用 Excel 打开，也可以重新导回本 App。</div>
          <div style={{ height: 12 }} />
          <button className="btn ghost" onClick={doExport}>导出 {txsOfLedger(state).length} 笔账单</button>
        </div>

        <div className="card" style={{ background: 'var(--grad-soft)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.8 }}>
            💡 操作路径：<br />
            支付宝 → 我的 → 账单 → 「...」→ 开具交易流水 → 选 CSV<br />
            微信 → 我 → 服务 → 钱包 → 账单 → 常见问题 → 下载账单
          </div>
        </div>
      </div>

      {/* 导入预览 */}
      <Sheet open={!!drafts} onClose={() => setDrafts(null)} title={`导入预览（${checkedCount}/${drafts?.length || 0}）`}>
        {drafts && (
          <>
            <div className="btnrow" style={{ marginBottom: 10 }}>
              <button className="btn ghost" onClick={() => toggleAll(true)}>全选</button>
              <button className="btn ghost" onClick={() => toggleAll(false)}>全不选</button>
            </div>
            <div className="txlist" style={{ marginBottom: 12 }}>
              {drafts.map((d) => {
                const checked = !!sel[d.sourceHash]
                const info = d.categoryId ? catInfo(state, d) : null
                return (
                  <label key={d.sourceHash} className="txitem" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={checked} style={{ width: 18, height: 18 }}
                      onChange={(e) => setSel((s) => ({ ...s, [d.sourceHash]: e.target.checked }))} />
                    <div className="txicon" style={{ background: d.type === 'income' ? 'var(--income-weak)' : 'var(--expense-weak)', fontSize: 16 }}>
                      {info?.icon || (d.type === 'income' ? '💰' : '❓')}
                    </div>
                    <div className="txmain">
                      <div className="txname" style={{ fontSize: 14 }}>{d.note || (d.type === 'income' ? '收入' : '支出')}</div>
                      <div className="txnote">{d.date} {d.time}{info ? ` · ${info.main}` : ' · 未识别分类，导入后可编辑'}</div>
                    </div>
                    <div className={`txamt ${d.type === 'income' ? 'in' : 'out'}`} style={{ fontSize: 14 }}>
                      {d.type === 'income' ? '+' : '-'}¥{fmt(d.amount)}
                    </div>
                  </label>
                )
              })}
            </div>
            <button className="btn" onClick={confirmImport}>导入选中的 {checkedCount} 笔</button>
          </>
        )}
      </Sheet>
    </>
  )
}
