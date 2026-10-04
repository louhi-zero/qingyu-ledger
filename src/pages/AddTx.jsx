import { Icon } from "../ui/icons.jsx"
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { Seg, Confirm, Empty, Sheet, CatIcon } from '../ui.jsx'
import { fmt, uid, todayStr, nowTime, addDays, accountName } from '../utils.js'
import { getObjectUrl, replaceBlob, fileToJpeg, blobToDataUrl } from '../blobdb.js'
import { loadAiCfg, parseTxText, parseReceiptImage } from '../ai.js'
import { BookIconImg } from '../theme.jsx'

// 熬夜归属：0:00–4:59 记账默认算昨天
function defaultDate(settings) {
  const now = new Date()
  if (settings?.nightAcross && now.getHours() < 5) return addDays(todayStr(), -1)
  return todayStr()
}

// 记一笔 / 编辑账单（全屏弹层）
export default function AddTx({ open, editTx, onClose }) {
  const { state, set, toast } = useStore()
  const defType = state.settings.defaultType || 'expense'
  const [type, setType] = useState(editTx ? editTx.type : defType === 'income' ? 'income' : 'expense')
  const [amount, setAmount] = useState(editTx ? String(editTx.amount) : '')
  const [categoryId, setCategoryId] = useState(editTx?.categoryId || null)
  const [subId, setSubId] = useState(null)
  const [accountId, setAccountId] = useState(editTx?.accountId || state.accounts[0]?.id || null)
  const [toAccountId, setToAccountId] = useState(editTx?.toAccountId || state.accounts[1]?.id || state.accounts[0]?.id || null)
  const [date, setDate] = useState(editTx?.date || defaultDate(state.settings))
  const [time, setTime] = useState(editTx?.time || nowTime())
  const [note, setNote] = useState(editTx?.note || '')
  const [showKp, setShowKp] = useState(true)
  const [delConfirm, setDelConfirm] = useState(false)
  const [noteEditOpen, setNoteEditOpen] = useState(false)
  const [timeOpen, setTimeOpen] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [accOpen, setAccOpen] = useState(false)
  const [accSetter, setAccSetter] = useState(null)
  // v1.6.9 记账可选账本：默认当前账本，编辑时取账单原账本
  const [ledgerId, setLedgerId] = useState(editTx?.ledgerId || state.currentLedgerId)
  const [ledgerOpen, setLedgerOpen] = useState(false)
  // 打开时对齐账本（组件常驻挂载，useState 初始值是启动时快照；切换账本后记账须取最新）
  useEffect(() => {
    if (open) setLedgerId(editTx?.ledgerId || state.currentLedgerId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editTx])
  // v1.2 标签 / 报销 / 附件 / 模板
  const [tags, setTags] = useState(editTx?.tags || [])
  const [reimburse, setReimburse] = useState(editTx?.reimburse || 'none')
  const [attachAt, setAttachAt] = useState(editTx?.attachAt || null)
  const [attachUrl, setAttachUrl] = useState(null)
  const [tagOpen, setTagOpen] = useState(false)
  const [reimOpen, setReimOpen] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const [savingTpl, setSavingTpl] = useState(false)
  const [busyAttach, setBusyAttach] = useState(false)
  const fileRef = useRef(null)
  // v1.4 智能填单 / 小票 OCR
  const [smartOpen, setSmartOpen] = useState(false)
  const [smartText, setSmartText] = useState('')
  const [smartBusy, setSmartBusy] = useState(false)
  const [ocrBusy, setOcrBusy] = useState(false)
  const ocrRef = useRef(null)
  // 新建时预生成 id，附件 Blob 以此为 key；「再记一笔」后换新
  const txIdRef = useRef(editTx?.id || uid())
  const skipCatReset = useRef(false)

  const cats = type === 'income' ? state.categories.income : state.categories.expense
  const mainCat = useMemo(() => cats.find((c) => c.id === categoryId) || cats[0], [cats, categoryId])
  const tplList = useMemo(
    () => [...(state.templates || [])].sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 8),
    [state.templates],
  )
  const histTags = useMemo(() => {
    const cnt = new Map()
    for (const t of state.transactions) for (const g of t.tags || []) cnt.set(g, (cnt.get(g) || 0) + 1)
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([g]) => g)
  }, [state.transactions, open])

  // 切换类型时重置分类（模板套用/编辑初始化除外）
  useEffect(() => {
    if (skipCatReset.current) { skipCatReset.current = false; return }
    setCategoryId(null); setSubId(null)
    if (type === 'transfer') { setTags([]); setReimburse('none'); setAttachAt(null) }
  }, [type])

  // 附件预览地址
  useEffect(() => {
    let alive = true
    if (open && attachAt) {
      getObjectUrl(`att_${txIdRef.current}`).then((u) => { if (alive) setAttachUrl(u) })
    } else {
      setAttachUrl(null)
    }
    return () => { alive = false }
  }, [open, attachAt])

  if (!open) return null

  const amt = Number(amount) || 0
  const canSave = amt > 0 && (type === 'transfer' ? accountId && toAccountId && accountId !== toAccountId : categoryId || mainCat)

  const pressKey = (k) => {
    if (k === '⌫') { setAmount((a) => a.slice(0, -1)); return }
    if (k === '.') { if (!amount.includes('.')) setAmount((a) => (a || '0') + '.'); return }
    setAmount((a) => {
      let next = a + k
      // 限制两位小数
      const [i, d] = next.split('.')
      if (d && d.length > 2) next = `${i}.${d.slice(0, 2)}`
      if (i.length > 8) return a
      if (Number(next) > 1e9) return a
      return next
    })
  }

  const save = (again = false) => {
    if (!canSave) { toast(type === 'transfer' && accountId === toAccountId ? '转入账户不能与转出账户相同' : '请输入金额', 'err'); return }
    const cat = categoryId || mainCat?.id
    const payload = {
      type, amount: Math.round(amt * 100) / 100,
      ledgerId: ledgerId || state.currentLedgerId,
      categoryId: type === 'transfer' ? null : cat,
      accountId, toAccountId: type === 'transfer' ? toAccountId : null,
      date, time, note: note.trim(),
      tags: type === 'transfer' ? [] : tags.slice(0, 6),
      reimburse: type === 'expense' ? reimburse : 'none',
      attachAt: type === 'transfer' ? null : attachAt,
    }
    set((d) => {
      if (editTx) {
        const t = d.transactions.find((x) => x.id === editTx.id)
        Object.assign(t, payload)
      } else {
        d.transactions.push({ id: txIdRef.current, createdAt: new Date().toISOString(), ...payload })
      }
    })
    toast(editTx ? '已保存修改' : `已记一笔 ${type === 'income' ? '收入' : type === 'expense' ? '支出' : '转账'} ¥${fmt(amt)}`)
    if (again) {
      setAmount(''); setNote(''); setTags([]); setReimburse('none'); setAttachAt(null)
      txIdRef.current = uid()
      setShowKp(true)
    } else {
      onClose()
    }
  }

  const del = () => {
    // v1.4 软删：移入回收站，30 天内可恢复，附件保留
    set((d) => {
      const t = d.transactions.find((x) => x.id === editTx.id)
      if (t) t.deletedAt = new Date().toISOString()
    })
    setDelConfirm(false)
    toast('已移入回收站，30 天内可在设置中恢复')
    onClose()
  }

  // 套用模板：跳过 type 切换对分类的清空
  const applyTemplate = (t) => {
    skipCatReset.current = true
    setType(t.type)
    setAmount(String(t.amount))
    setCategoryId(t.categoryId || null)
    setAccountId(t.accountId || state.accounts[0]?.id || null)
    setNote(t.note || '')
    setShowKp(true)
    toast(`已套用模板「${t.name}」`)
  }

  // 保存当前表单为模板（编辑态或已填表单均可）
  const saveAsTemplate = () => {
    const cat = categoryId || mainCat?.id
    if (!(amt > 0) || !cat) { toast('请先填好金额与分类再存为模板', 'err'); return }
    set((d) => {
      d.templates.unshift({
        id: uid(), name: note.trim().slice(0, 12) || `${catInfoOfName()?.name || '模板'}模板`,
        type, amount: Math.round(amt * 100) / 100, categoryId: cat, accountId,
        note: note.trim(), at: new Date().toISOString(),
      })
      if (d.templates.length > 30) d.templates.length = 30
    })
    toast('已保存为记账模板')
  }
  function catInfoOfName() { return state.categories[fmtTypeKey(type)]?.find((c) => c.id === (categoryId || mainCat?.id)) }
  function fmtTypeKey(t) { return t === 'income' ? 'income' : 'expense' }

  // 附件：选图 → 压缩 → 写入 IndexedDB
  const onPickAttach = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusyAttach(true)
    try {
      const jpeg = await fileToJpeg(f, { maxSize: 1280, quality: 0.8 })
      await replaceBlob(`att_${txIdRef.current}`, jpeg)
      setAttachAt(new Date().toISOString())
      toast('已添加小票照片')
    } catch {
      toast('图片处理失败，换一张试试', 'err')
    } finally {
      setBusyAttach(false)
    }
  }

  const onRemoveAttach = async () => {
    await replaceBlob(`att_${txIdRef.current}`, null).catch(() => {})
    setAttachAt(null)
    setAttachOpen(false)
    toast('已移除附件')
  }

  // ---------- v1.4 智能填单 / 小票识别 ----------
  // 把解析结果填进表单
  const applyParsed = (p, srcLabel) => {
    if (!p) { toast('没解析出账单，试试「¥28 午餐 面馆」这样的写法', 'err'); return }
    skipCatReset.current = true
    setType(p.type)
    setAmount(String(p.amount))
    setCategoryId(p.categoryId || null)
    setSubId(null)
    if (p.accountId && state.accounts.some((a) => a.id === p.accountId)) setAccountId(p.accountId)
    if (p.date) setDate(p.date)
    if (p.time) setTime(p.time)
    setNote(p.note || '')
    if (p.type === 'transfer') { setTags([]); setReimburse('none'); setAttachAt(null) }
    setShowKp(true)
    toast(srcLabel || '已填入')
  }

  const doSmartParse = async () => {
    const text = smartText.trim()
    if (!text) { toast('先输入一句话或粘贴账单文本', 'err'); return }
    setSmartBusy(true)
    try {
      const p = await parseTxText(loadAiCfg(), text, state)
      if (p) {
        applyParsed(p, p.source === 'ai' ? "AI 已解析并填入" : '已按本地规则填入，可再调整')
        setSmartOpen(false)
        setSmartText('')
      } else {
        toast('没解析出金额，写法里带上金额数字再试', 'err')
      }
    } catch (e) {
      toast(e?.name === 'AbortError' ? '已取消' : '解析失败，请重试', 'err')
    } finally {
      setSmartBusy(false)
    }
  }

  // 智能填单 Sheet 内：识别小票图 → 填表 + 原图存为附件
  const onPickOcr = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const cfg = loadAiCfg()
    if (!cfg.key) { toast('识别小票需要先在「设置 → AI 分析设置」配置智谱 API Key', 'err'); return }
    setOcrBusy(true)
    try {
      const jpeg = await fileToJpeg(f, { maxSize: 1280, quality: 0.8 })
      const p = await parseReceiptImage(cfg, await blobToDataUrl(jpeg), state)
      if (!p) { toast('没认出小票金额，可手动填写', 'err'); return }
      await replaceBlob(`att_${txIdRef.current}`, jpeg)
      applyParsed({
        type: 'expense', amount: p.amount, date: p.date, time: p.time,
        note: p.note || p.merchant || '', categoryId: p.categoryId,
      }, "小票已识别并填入，原图已作附件")
      setAttachAt(new Date().toISOString())
      setSmartOpen(false)
      setSmartText('')
    } catch (err) {
      toast(err?.name === 'AbortError' ? '已取消' : '识别失败，请重试或手动填写', 'err')
    } finally {
      setOcrBusy(false)
    }
  }

  const addTag = (g) => {
    const v = String(g || '').trim().replace(/^#/, '').slice(0, 12)
    if (!v) return
    setTags((ts) => (ts.includes(v) || ts.length >= 6 ? ts : [...ts, v]))
  }
  const removeTag = (g) => setTags((ts) => ts.filter((x) => x !== g))

  const selCat = (c, isSub) => {
    if (isSub) { setSubId(c.id); setCategoryId(mainCat.id) }
    else { setCategoryId(c.id); setSubId(null) }
    setShowKp(true)
  }

  return (
    <div className="mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet addsheet">
        <div className="sheet-head">
          <button className="sx" onClick={onClose}><Icon name="close" size="1em" className="qy-inline-icon" /></button>
          <div className="st">{editTx ? '编辑账单' : '记一笔'}</div>
          <div style={{ width: 30 }} />
        </div>
        <div className="sheet-body">
          {/* v1.2 记账模板快捷 chips */}
          {!editTx && tplList.length > 0 && (
            <div className="tpl-chips">
              {tplList.map((t) => (
                <button key={t.id} className="chip tpl-chip" onClick={() => applyTemplate(t)}>
                  <Icon name="bolt" size="1em" className="qy-inline-icon" /> {t.name} · ¥{fmt(t.amount)}
                </button>
              ))}
            </div>
          )}

          {/* v1.4 智能填单入口 */}
          {!editTx && (
            <div className="meta-row" style={{ marginBottom: 8 }}>
              <button className="meta-pill" onClick={() => setSmartOpen(true)}><Icon name="sparkles" size="1em" className="qy-inline-icon" /> 智能填单 · 一句话记一笔</button>
            </div>
          )}

          {/* 类型切换 */}
          <Seg
            options={[{ value: 'expense', label: '支出' }, { value: 'income', label: '收入' }, { value: 'transfer', label: '转账' }]}
            value={type} onChange={setType}
          />

          {/* 金额 */}
          <div className="add-amount" onClick={() => setShowKp(true)}>
            <span className="sym">¥</span>
            <div className={`num ${amount ? '' : 'ph'}`}>{amount || '0.00'}</div>
          </div>

          {/* 分类选择 */}
          {type !== 'transfer' ? (
            <>
              <div className="catbar">
                {cats.map((c) => (
                  <button key={c.id} className={`chip ${mainCat?.id === c.id ? 'on' : ''}`} onClick={() => selCat(c, false)}><CatIcon icon={c.icon} size={15} /> {c.name}</button>
                ))}
              </div>
              <div className="grid4" style={{ marginBottom: 6 }}>
                {(mainCat?.children || []).map((s) => (
                  <button key={s.id} className={`gitem ${subId === s.id ? 'on' : ''}`} onClick={() => selCat(s, true)}>
                    <div className="gi"><CatIcon icon={s.icon} size={20} /></div><span>{s.name}</span>
                  </button>
                ))}
                {!mainCat?.children?.length && (
                  <div className="muted" style={{ gridColumn: '1/-1', textAlign: 'center', padding: '10px 0' }}>全部记在「{mainCat?.name}」一级分类</div>
                )}
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 6 }}>
              <div className="selectline" onClick={() => pickAccount(setAccountId)}>
                <span>转出账户</span><b>{accountName(state, accountId)} ›</b>
              </div>
              <div className="selectline" onClick={() => pickAccount(setToAccountId)}>
                <span>转入账户</span><b>{accountName(state, toAccountId)} ›</b>
              </div>
              {accountId === toAccountId && <div className="muted" style={{ color: 'var(--expense)' }}>转入账户不能与转出账户相同</div>}
            </div>
          )}

          {/* 元信息 */}
          <div className="meta-row">
            {/* v1.6.9 记账可选账本 */}
            <button className="meta-pill" onClick={() => setLedgerOpen(true)}>
              <Icon name="book" size="1em" className="qy-inline-icon" /> <b>{state.ledgers.find((l) => l.id === (ledgerId || state.currentLedgerId))?.name || '选择账本'}</b>
            </button>
            <button className="meta-pill" onClick={() => setNoteEditOpen(true)}><Icon name="bill" size="1em" className="qy-inline-icon" /> {note ? <b>{note.slice(0, 8)}</b> : '备注'}</button>
            <button className="meta-pill" onClick={() => pickAccount(setAccountId)}><Icon name="account" size="1em" className="qy-inline-icon" /> <b>{type === 'transfer' ? accountName(state, accountId) : accountName(state, accountId)}</b></button>
            <button className="meta-pill" onClick={() => setShowDatePicker((v) => !v)}><Icon name="calendar" size="1em" className="qy-inline-icon" /> <b>{date === todayStr() ? '今天' : date.slice(5)}</b></button>
            <button className="meta-pill" onClick={() => setTimeOpen((v) => !v)}><Icon name="clock" size="1em" className="qy-inline-icon" /> <b>{time}</b></button>
          </div>
          {/* v1.2 标签 / 报销 / 附件 */}
          {type !== 'transfer' && (
            <div className="meta-row" style={{ marginTop: -2 }}>
              <button className="meta-pill" onClick={() => setTagOpen(true)}>
                #️⃣ {tags.length ? <b>{tags.map((g) => `#${g}`).join(' ')}</b> : '标签'}
              </button>
              {type === 'expense' && (
                <button className={`meta-pill ${reimburse !== 'none' ? 'pill-on' : ''}`} onClick={() => setReimOpen(true)}>
                  <Icon name="reimburse" size="1em" className="qy-inline-icon" /> {reimburse === 'pending' ? <b>待报销</b> : reimburse === 'done' ? <b>已报销</b> : '报销'}
                </button>
              )}
              <button className={`meta-pill ${attachAt ? 'pill-on' : ''}`} onClick={() => (attachAt ? setAttachOpen(true) : fileRef.current?.click())} disabled={busyAttach}>
                <Icon name="attach" size="1em" className="qy-inline-icon" /> {busyAttach ? '处理中…' : attachAt ? <b>小票</b> : '附件'}
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickAttach} />
            </div>
          )}

          {showDatePicker && (
            <div className="card" style={{ padding: 12 }}>
              <div className="chips" style={{ paddingBottom: 8 }}>
                {[['今天', todayStr()], ['昨天', addDays(todayStr(), -1)], ['前天', addDays(todayStr(), -2)]].map(([l, d]) => (
                  <button key={l} className={`chip ${date === d ? 'on' : ''}`} onClick={() => { setDate(d); setShowDatePicker(false) }}>{l}</button>
                ))}
              </div>
              <input type="date" className="input" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </div>
          )}

          {/* 键盘 */}
          {showKp ? (
            <div className="kp">
              {['1', '2', '3', '⌫', '4', '5', '6', '+', '7', '8', '9', '-', '·', '0', '00', 'OK'].map((k) => {
                if (k === '·') return <button key={k} className="fn" onClick={() => pressKey('.')}>·</button>
                // v2.6 修复：完成键用哨兵字符串 'OK'（此前数组里放 JSX 元素，字符串比较永不命中，
                // 渲染成无 onClick 的空按钮——记账无法通过键盘「完成」保存）
                if (k === 'OK') return <button key={k} className="ok" onClick={() => save(false)} aria-label="完成"><Icon name="check" size="1em" className="qy-inline-icon" /></button>
                if (k === '⌫') return <button key={k} className="fn" onClick={() => pressKey('⌫')}>⌫</button>
                // +/- 为键盘布局占位（常见支付键盘样式），不可点、不可聚焦、不可见内容
                if (k === '+' || k === '-') return <div key={k} className="kp-blank" aria-hidden="true" />
                return <button key={k} onClick={() => pressKey(k)}>{k}</button>
              })}
            </div>
          ) : (
            <button className="btn" onClick={() => save(false)} style={{ marginTop: 6 }}>完成</button>
          )}

          <div className="btnrow" style={{ marginTop: 10 }}>
            <button className="btn ghost" onClick={() => save(true)}>再记一笔</button>
            {editTx && <button className="btn ghost" onClick={saveAsTemplate}>存为模板</button>}
            {editTx && <button className="btn danger" onClick={() => setDelConfirm(true)}>删除</button>}
          </div>
        </div>

        {/* 备注/账户/时间 编辑弹层 */}
        <NoteEditor open={noteEditOpen} onClose={() => setNoteEditOpen(false)} note={note} setNote={setNote} />
        <TimeSheet open={timeOpen} onClose={() => setTimeOpen(false)} time={time} setTime={setTime} />
        <AccountSheet state={state} open={accOpen} onClose={() => setAccOpen(false)} onPick={(id) => { accSetter?.(id); setAccOpen(false) }} />

        {/* v1.6.9 账本选择弹层 */}
        <Sheet open={ledgerOpen} onClose={() => setLedgerOpen(false)} title="存入哪个账本">
          {state.ledgers.map((l) => (
            <div key={l.id} className="selectline" style={{ marginBottom: 8 }} onClick={() => { setLedgerId(l.id); setLedgerOpen(false) }}>
              <span className="ls-line">
                <BookIconImg ledgerId={l.id} icon={l.icon} className="ledger-switch-img" />
                <span style={{ fontWeight: ledgerId === l.id ? 700 : 500 }}>{l.name}</span>
                <span className="muted" style={{ fontSize: 11.5 }}>{l.template}</span>
              </span>
              {ledgerId === l.id
                ? <b style={{ color: 'var(--brand)', fontSize: 12.5 }}>已选</b>
                : <span className="arrow">›</span>}
            </div>
          ))}
        </Sheet>

        {/* v1.2 标签编辑 */}
        <Sheet open={tagOpen} onClose={() => setTagOpen(false)} title="标签">
          <div className="chips" style={{ marginBottom: 10 }}>
            {tags.map((g) => (
              <button key={g} className="chip on" onClick={() => removeTag(g)}>#{g} <Icon name="close" size="1em" className="qy-inline-icon" /></button>
            ))}
            {!tags.length && <div className="muted" style={{ padding: '4px 0 8px' }}>还没加标签，最多 6 个</div>}
          </div>
          <TagInput onAdd={addTag} />
          {histTags.filter((g) => !tags.includes(g)).length > 0 && (
            <>
              <div className="ctitle" style={{ margin: '12px 0 8px', fontSize: 12 }}>历史标签</div>
              <div className="chips">
                {histTags.filter((g) => !tags.includes(g)).map((g) => (
                  <button key={g} className="chip" onClick={() => addTag(g)}>#{g}</button>
                ))}
              </div>
            </>
          )}
          <button className="btn" style={{ marginTop: 14 }} onClick={() => setTagOpen(false)}>完成</button>
        </Sheet>

        {/* v1.2 报销状态 */}
        <Sheet open={reimOpen} onClose={() => setReimOpen(false)} title="报销状态" center>
          <Seg
            options={[
              { value: 'none', label: '不报销' },
              { value: 'pending', label: '待报销' },
              { value: 'done', label: '已报销' },
            ]}
            value={reimburse}
            onChange={(v) => { setReimburse(v); setReimOpen(false) }}
          />
          <div className="cdesc" style={{ marginTop: 10 }}>
            选「待报销」后在 发现 → 报销管理 里统一核销
          </div>
        </Sheet>

        {/* v1.4 智能填单 */}
        <Sheet open={smartOpen} onClose={() => setSmartOpen(false)} title="智能填单">
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.7, marginBottom: 10 }}>
            用一句话描述这笔账，自动识别金额、分类与日期；已配置 API Key 时由智谱 GLM 解析，未配置时按本地规则解析。
          </div>
          <textarea
            className="input" rows={3} autoFocus
            placeholder={'例如：昨天中午吃了碗面花了28块\n或：9月30日 打车 23.5 滴滴'}
            value={smartText} onChange={(e) => setSmartText(e.target.value)}
          />
          <button className="btn" style={{ marginTop: 12 }} disabled={smartBusy} onClick={doSmartParse}>
            {smartBusy ? '解析中…' : <><Icon name="sparkles" size="1em" className="qy-inline-icon" /> 解析并填入</>}
          </button>
          <button className="btn ghost" style={{ marginTop: 10 }} disabled={ocrBusy || smartBusy} onClick={() => ocrRef.current?.click()}>
            {ocrBusy ? '识别中…' : <><Icon name="camera" size="1em" className="qy-inline-icon" /> 识别小票图片自动填单</>}
          </button>
          <input ref={ocrRef} type="file" accept="image/*" hidden onChange={onPickOcr} />
        </Sheet>

        {/* v1.2 附件预览 */}
        <Sheet open={attachOpen} onClose={() => setAttachOpen(false)} title="小票照片">
          {attachUrl && (
            <div style={{ textAlign: 'center' }}>
              <img src={attachUrl} alt="小票" style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 12, border: '1px solid var(--line)' }} />
              <div className="btnrow" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => { setAttachOpen(false); fileRef.current?.click() }}>换一张</button>
                <button className="btn danger" onClick={onRemoveAttach}>移除</button>
              </div>
            </div>
          )}
        </Sheet>
      </div>

      <Confirm open={delConfirm} title="删除这条账单？" text="将移入回收站，30 天内可在「设置 → 回收站」恢复" okText="删除" danger onOk={del} onCancel={() => setDelConfirm(false)} />
    </div>
  )

  // 内部小弹层（声明在此以访问 state）
  function pickAccount(fn) { setAccSetter(() => fn); setAccOpen(true) }
}

// 备注编辑
function NoteEditor({ open, onClose, note, setNote }) {
  const [v, setV] = useState(note)
  useEffect(() => setV(note), [note, open])
  if (!open) return null
  return (
    <div className="mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet center" style={{ background: 'var(--card)', padding: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>备注</div>
        <textarea className="input" autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="这笔钱花在哪了？"
          onKeyDown={(e) => { if (e.key === 'Enter') { setNote(v); onClose() } }} />
        <button className="btn" style={{ marginTop: 12 }} onClick={() => { setNote(v.trim()); onClose() }}>保存</button>
      </div>
    </div>
  )
}

// 时间选择
function TimeSheet({ open, onClose, time, setTime }) {
  if (!open) return null
  return (
    <div className="mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet center" style={{ background: 'var(--card)', padding: 20, minWidth: 240 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>交易时间</div>
        <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value || time)} />
        <button className="btn" style={{ marginTop: 12 }} onClick={onClose}>确定</button>
      </div>
    </div>
  )
}

// 账户选择
function AccountSheet({ state, open, onClose, onPick }) {
  if (!open) return null
  return (
    <div className="mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet">
        <div className="sheet-head">
          <button className="sx" onClick={onClose}><Icon name="close" size="1em" className="qy-inline-icon" /></button>
          <div className="st">选择账户</div><div style={{ width: 30 }} />
        </div>
        <div className="sheet-body">
          {state.accounts.length ? state.accounts.map((a) => (
            <div className="selectline" key={a.id} style={{ marginBottom: 8 }} onClick={() => onPick(a.id)}>
              <span>{a.icon} {a.name}</span><span className="arrow">›</span>
            </div>
          )) : <Empty icon="svg:account" text="还没有账户，去「资产」添加一个" />}
        </div>
      </div>
    </div>
  )
}

// v1.2 标签输入
function TagInput({ onAdd }) {
  const [v, setV] = useState('')
  const submit = () => { if (v.trim()) { onAdd(v); setV('') } }
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        className="input" style={{ flex: 1 }} value={v} autoFocus
        placeholder="输入标签，回车添加"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
      />
      <button className="btn" style={{ padding: '0 16px' }} onClick={submit}>添加</button>
    </div>
  )
}
