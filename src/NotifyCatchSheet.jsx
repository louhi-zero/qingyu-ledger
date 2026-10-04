import { Icon } from "./ui/icons.jsx"
/* v1.5 收支监控确认弹窗：捕获到微信/支付宝收支通知后弹出，
 * 金额/方向/分类/账户可改，确认后才入账（不静默自动记账）。
 * 仅 Android 原生端会触发（见 notifyCatch.js），桌面/浏览器不会渲染。
 *
 * v2.0.2 重构：
 * - 弹窗队列化：多条通知排队处理（App.jsx 传 caught=队首, queueLen=队列长度）
 * - AI 兜底通知：amount 可能为 null（方向可信但金额缺失，如转账消息）→ 金额留空由用户补填
 * -  截图识别：通知里没金额时，选支付详情页截图 → GLM-4V 视觉模型提取金额/方向
 */
import React, { useEffect, useRef, useState } from 'react'
import { useStore } from './store.jsx'
import { Sheet, Seg } from './ui.jsx'
import { isImgIcon } from './catIcons.js'
import { uid, todayStr, nowTime, round2 } from './utils.js'
import { loadAiCfg, aiParsePayScreenshot, humanizeError } from './ai.js'

const SRC_META = {
  wechat: { name: '微信', icon: "svg:message" },
  alipay: { name: '支付宝', icon: "svg:alipay" },
  ai: { name: '智能识别', icon: "svg:robot" },
  vision: { name: '截图识别', icon: "svg:image" },
}

// 压缩截图：最长边 1280、JPEG 0.85（GLM-4V 识别足够，控制上传体积）
function shotToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      try {
        const MAX = 1280
        const scale = Math.min(1, MAX / Math.max(img.width, img.height))
        const cv = document.createElement('canvas')
        cv.width = Math.max(1, Math.round(img.width * scale))
        cv.height = Math.max(1, Math.round(img.height * scale))
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height)
        resolve(cv.toDataURL('image/jpeg', 0.85))
      } catch (e) { reject(e) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('IMAGE_DECODE')) }
    img.src = url
  })
}

export default function NotifyCatchSheet({ caught, queueLen = 0, onClose }) {
  const { state, set, toast } = useStore()
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState('expense')
  const [catId, setCatId] = useState('')
  const [accId, setAccId] = useState('')
  const [note, setNote] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const shotRef = useRef(null)

  const catsOf = (k) => state.categories[k === 'income' ? 'income' : 'expense'] || []

  // 捕获到新通知 → 初始化表单
  useEffect(() => {
    if (!caught) return
    setAmount(caught.amount == null || !(caught.amount > 0) ? '' : caught.amount.toFixed(2))
    setKind(caught.kind)
    setNote([caught.title, caught.text].filter(Boolean).join(' · ').slice(0, 60))
    // 默认账户：按来源匹配虚拟账户（微信钱包/支付宝），否则第一个账户
    const kw = caught.source === 'wechat' ? '微信' : caught.source === 'alipay' ? '支付宝' : ''
    const acc = kw ? state.accounts.find((a) => (a.name || '').includes(kw)) : null
    setAccId(acc?.id || state.accounts[0]?.id || '')
    // 默认分类：收入且提到红包 → 红包分类；AI 备注摘要可用作分类猜测；其余取该收支方向的第一项
    const cats = catsOf(caught.kind)
    const text = `${caught.title || ''}${caught.text || ''}${caught.note || ''}`
    const guessed = caught.kind === 'income' && /红包/.test(text)
      ? cats.find((c) => /红包/.test(c.name))
      : null
    setCatId(guessed?.id || cats[0]?.id || '')
  }, [caught])

  if (!caught) return null
  const meta = SRC_META[caught.source] || { name: '通知', icon: "svg:mail" }

  const save = () => {
    const amt = round2(Number(amount))
    if (!(amt > 0)) { toast('请输入正确的金额', 'err'); return }
    set((d) => {
      d.transactions.push({
        id: uid(), ledgerId: d.currentLedgerId,
        // v2.1 无障碍捕获携带页面内交易时间（精确到分），通知流回退当前时间
        date: caught.txDate || todayStr(), time: caught.txTime || nowTime(),
        type: kind, amount: amt,
        categoryId: catId || null, accountId: accId || d.accounts[0]?.id || null, toAccountId: null,
        note: note.trim(), tags: [], reimburse: 'none', attachAt: null, deletedAt: null,
        createdAt: new Date().toISOString(), viaNotify: caught.source,
      })
    })
    toast(`已记入${kind === 'income' ? '收入' : '支出'} ¥${amt.toFixed(2)}`)
    onClose()
  }

  // v2.0.2 截图识别：通知没金额时用 GLM-4V 读支付截图补齐
  const onShot = async (file) => {
    if (!file || aiBusy) return
    const cfg = loadAiCfg()
    if (!cfg.key) { toast('请先在「AI 助手」里配置智谱 API Key', 'err'); return }
    setAiBusy(true)
    try {
      const dataUrl = await shotToDataUrl(file)
      const r = await aiParsePayScreenshot(cfg, dataUrl)
      if (!r) { toast('识别不出金额，试试更清晰的截图', 'err'); return }
      setAmount(r.amount.toFixed(2))
      setKind(r.kind)
      setCatId(catsOf(r.kind)[0]?.id || '')
      if (r.note) setNote((prev) => (prev ? `${prev} · ${r.note}` : r.note).slice(0, 40))
      toast('截图识别成功，请确认后入账')
    } catch (e) {
      toast('识别失败：' + humanizeError(e), 'err')
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title="监控到收支，记一笔？">
      <div className="center-box" style={{ padding: '2px 0 10px' }}>
        <span className="tag">{meta.icon} {meta.name}通知</span>
        {queueLen > 1 && <span className="tag" style={{ marginLeft: 6 }}>待处理 {queueLen - 1} 条</span>}
        <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
          {[caught.title, caught.text].filter(Boolean).join('：') || '未读到通知内容'}
        </div>
      </div>
      <Seg
        options={[{ label: <><Icon name="cash" size="1em" className="qy-inline-icon" /> 支出</>, value: 'expense' }, { label: <><Icon name="salary" size="1em" className="qy-inline-icon" /> 收入</>, value: 'income' }]}
        value={kind}
        onChange={(v) => { setKind(v); setCatId(catsOf(v)[0]?.id || '') }}
      />
      <div style={{ height: 10 }} />
      <div className="field">
        <label>金额（元）</label>
        <input className="input" inputMode="decimal" value={amount} autoFocus
          onChange={(e) => {
            const [i, f] = e.target.value.split('.')
            setAmount(f && f.length > 2 ? `${i}.${f.slice(0, 2)}` : e.target.value)
          }} />
      </div>
      <div className="field">
        <label>分类</label>
        <select className="input" value={catId} onChange={(e) => setCatId(e.target.value)}>
          {catsOf(kind).map((c) => <option key={c.id} value={c.id}>{isImgIcon(c.icon) ? c.name : `${c.icon} ${c.name}`}</option>)}
        </select>
      </div>
      <div className="field">
        <label>账户</label>
        <select className="input" value={accId} onChange={(e) => setAccId(e.target.value)}>
          {state.accounts.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label>备注</label>
        <input className="input" maxLength={40} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {/* v2.0.2 截图识别：通知里没金额时，用视觉模型读支付截图补齐 */}
      <button className="btn ghost" disabled={aiBusy} onClick={() => shotRef.current?.click()}>
        {aiBusy ? <><Icon name="robot" size="1em" className="qy-inline-icon" /> 识别中…</> : <><Icon name="camera" size="1em" className="qy-inline-icon" /> 截图识别金额（支付详情页截图）</>}
      </button>
      <input ref={shotRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onShot(f); e.target.value = '' }} />
      <div className="btnrow" style={{ marginTop: 10 }}>
        <button className="btn ghost" onClick={onClose}>忽略</button>
        <button className="btn" onClick={save}>记入账单</button>
      </div>
    </Sheet>
  )
}
