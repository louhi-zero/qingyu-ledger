import { Icon } from "../ui/icons.jsx"
import React, { useMemo, useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { TopBar, Empty } from '../ui.jsx'
import { isImgIcon } from '../catIcons.js'
import { fileToJpeg, blobToDataUrl, replaceBlob } from '../blobdb.js'
import { loadAiCfg, parseReceiptImage } from '../ai.js'
import { fmt, todayStr, uid, round2 } from '../utils.js'

// v1.4 扫票记账：拍照/选小票 → GLM-4V 识别 → 确认入账（原图作附件）
export default function ScanReceipt({ nav }) {
  const { state, set, toast } = useStore()
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null) // dataURL 预览
  const [jpeg, setJpeg] = useState(null) // 附件本体
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayStr())
  const [time, setTime] = useState('12:00')
  const [note, setNote] = useState('')
  const [categoryId, setCategoryId] = useState(null)
  const [accountId, setAccountId] = useState(null)
  const cfg = useMemo(() => loadAiCfg(), [])

  const reset = () => {
    setPreview(null); setJpeg(null); setAmount(''); setNote('')
    setDate(todayStr()); setTime('12:00'); setCategoryId(null); setAccountId(null)
  }

  const pick = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!cfg.key) { toast('先在「AI 分析设置」中配置智谱 API Key', 'err'); return }
    setBusy(true)
    try {
      const img = await fileToJpeg(f, { maxSize: 1280, quality: 0.8 })
      const dataUrl = await blobToDataUrl(img)
      const p = await parseReceiptImage(cfg, dataUrl, state)
      setPreview(dataUrl)
      setJpeg(img)
      if (!p) {
        // 图片可预览，金额需手填
        setAmount(''); setNote('')
        toast('没认出金额，请手动填写后入账', 'err')
        return
      }
      setAmount(String(p.amount))
      setDate(p.date || todayStr())
      setTime(p.time || '12:00')
      setNote(p.note || p.merchant || '')
      setCategoryId(p.categoryId || null)
      toast(p.merchant ? `已识别：${p.merchant}` : '已识别小票金额')
    } catch (err) {
      reset()
      toast(err?.name === 'AbortError' ? '已取消' : '识别失败，请重试', 'err')
    } finally {
      setBusy(false)
    }
  }

  const commit = () => {
    const amt = round2(Number(amount) || 0)
    if (!(amt > 0)) { toast('请填写金额', 'err'); return }
    const id = uid()
    set((d) => {
      d.transactions.push({
        id, ledgerId: d.currentLedgerId, createdAt: new Date().toISOString(),
        type: 'expense', amount: amt,
        categoryId: categoryId || d.categories.expense[0]?.id || null,
        accountId: accountId || d.accounts[0]?.id || null,
        date, time, note: note.trim(),
        tags: [], reimburse: 'none',
        attachAt: jpeg ? new Date().toISOString() : null,
        deletedAt: null,
      })
    })
    if (jpeg) replaceBlob(`att_${id}`, jpeg).catch(() => {})
    toast(`已入账 ¥${fmt(amt)}，小票原图已作附件`)
    reset()
  }

  const cats = state.categories.expense
  // v2.6 图片图标无法拼进纯文本，回落为仅分类名
  const catName = (id) => {
    for (const c of cats) {
      if (c.id === id) return isImgIcon(c.icon) ? c.name : `${c.icon} ${c.name}`
      const sub = (c.children || []).find((x) => x.id === id)
      if (sub) return isImgIcon(sub.icon) ? `${c.name}·${sub.name}` : `${sub.icon} ${c.name}·${sub.name}`
    }
    return '自动识别'
  }

  return (
    <>
      <TopBar title="扫票记账" onBack={nav.pop} />
      <div className="page-body no-tab">
        {!cfg.key && (
          <div className="card">
            <Empty icon="svg:camera" text="识别小票需要智谱 GLM-4V 视觉模型，先去配置 API Key（识别在小票图上传后进行，原图只存你自己的设备）">
              <button className="btn" onClick={() => nav.push({ page: 'aiSettings', title: 'AI 分析设置' })}>去配置 AI Key</button>
            </Empty>
          </div>
        )}

        {cfg.key && !preview && (
          <div className="card">
            <button
              className="btn" style={{ width: '100%', padding: '26px 0' }}
              disabled={busy} onClick={() => fileRef.current?.click()}
            >
              {busy ? '识别中，请稍候…' : <><Icon name="camera" size="1em" className="qy-inline-icon" /> 拍摄 / 选择小票</>}
            </button>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.8, marginTop: 12 }}>
              支持购物小票、发票、支付账单截图。识别出金额、日期与商家后可修改再入账，小票原图会自动作为账单附件保存。
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
          </div>
        )}

        {cfg.key && preview && (
          <>
            <div className="card">
              <img src={preview} alt="小票" style={{ width: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 12, border: '1px solid var(--line)' }} decoding="async" />
            </div>
            <div className="card">
              <div className="card-title">确认入账</div>
              <div className="field" style={{ marginTop: 10 }}>
                <label>金额（元）</label>
                <input className="input" type="number" inputMode="decimal" value={amount}
                  placeholder="0.00"
                  onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="field">
                <label>日期 / 时间</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
                  <input className="input" type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label>分类（{catName(categoryId)}）</label>
                <select className="input" value={categoryId || ''} onChange={(e) => setCategoryId(e.target.value || null)}>
                  <option value="">自动识别</option>
                  {cats.map((c) => (
                    <optgroup key={c.id} label={`${c.icon} ${c.name}`}>
                      <option value={c.id}>{c.icon} {c.name}</option>
                      {(c.children || []).map((s) => <option key={s.id} value={s.id}>{s.icon} {c.name}·{s.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>账户</label>
                <select className="input" value={accountId || state.accounts[0]?.id || ''} onChange={(e) => setAccountId(e.target.value || null)}>
                  {state.accounts.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>备注</label>
                <input className="input" maxLength={20} value={note} placeholder="消费摘要"
                  onChange={(e) => setNote(e.target.value)} />
              </div>
              <div className="btnrow">
                <button className="btn ghost" onClick={reset}>重新选图</button>
                <button className="btn" onClick={commit}>记一笔支出</button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
