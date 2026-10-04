import { Icon } from "../ui/icons.jsx"
import React, { useMemo, useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { TopBar, Sheet, Confirm } from '../ui.jsx'
import { LEDGER_TEMPLATES } from '../seed.js'
import { txsOfLedger, uid, fmt } from '../utils.js'
import { useBookIconUrl, useMediaActions } from '../theme.jsx'
import { replaceBlob } from '../blobdb.js'

function blankLedger() {
  return { id: uid(), name: '', icon: "svg:book", template: '标准账本' }
}

// 账本图标：自定义图片优先（IndexedDB 'bookicon_<id>'），否则 emoji
function LedgerIcon({ l, className = 'gi', style }) {
  const url = useBookIconUrl(l.id)
  if (url) return <div className={`${className} gi-img`} style={style}><img className="gi-img-img" src={url} alt="" decoding="async" draggable={false} /></div>
  return <div className={className} style={style}>{l.icon}</div>
}

export default function Ledgers({ nav }) {
  const { state, set, toast } = useStore()
  const media = useMediaActions()
  const [edit, setEdit] = useState(null)
  const [delId, setDelId] = useState(null)
  const [busyIcon, setBusyIcon] = useState(false)
  const iconFileRef = useRef(null)
  const editIconUrl = useBookIconUrl(edit?.id)

  const counts = useMemo(() => {
    const m = {}
    for (const l of state.ledgers) m[l.id] = txsOfLedger(state, l.id).length
    return m
  }, [state])

  const save = () => {
    if (!edit.name.trim()) { toast('请填写账本名称', 'err'); return }
    set((d) => {
      const idx = d.ledgers.findIndex((l) => l.id === edit.id)
      const data = { ...edit, name: edit.name.trim() }
      if (idx >= 0) d.ledgers[idx] = data
      else d.ledgers.push(data)
    })
    toast('账本已保存')
    setEdit(null)
  }

  const doDelete = () => {
    replaceBlob(`bookicon_${delId}`, null).catch(() => {})
    set((d) => {
      d.ledgers = d.ledgers.filter((l) => l.id !== delId)
      d.transactions = d.transactions.filter((t) => t.ledgerId !== delId)
      if (d.currentLedgerId === delId) d.currentLedgerId = d.ledgers[0]?.id || null
    })
    toast('账本及其账单已删除')
    setDelId(null)
  }

  // 上传账本图标：自动居中裁切 128×128，任意背景均可
  const onPickIcon = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || !edit) return
    setBusyIcon(true)
    try {
      await media.saveBookIcon(edit.id, f)
      toast('图标已更新')
    } catch {
      toast('图片处理失败，换一张试试', 'err')
    } finally {
      setBusyIcon(false)
    }
  }

  return (
    <>
      <TopBar
        title="我的账本"
        onBack={nav.pop}
        right={<button className="iconbtn" onClick={() => setEdit(blankLedger())}>＋</button>}
      />
      <div className="page-body no-tab">
        <div className="card" style={{ background: 'var(--grad-soft)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.7 }}>
            <Icon name="books" size="1em" className="qy-inline-icon" /> 不同用途分开记：日常、旅行、装修、报销互不干扰。<br />
            点击账本即可切换，首页顶部也能随时一键切换。
          </div>
        </div>

        <div className="grid3">
          {state.ledgers.map((l) => (
            <button key={l.id} className="gitem" style={{ background: 'var(--card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', padding: '12px 4px' }}
              onClick={() => setEdit({ ...l })}>
              <LedgerIcon l={l} style={state.currentLedgerId === l.id ? { background: 'var(--brand-weak)', boxShadow: 'inset 0 0 0 2px var(--brand)' } : {}} />
              <span style={{ color: 'var(--ink)', fontWeight: 700, maxWidth: 100, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {l.name}
              </span>
              <span className="muted">{counts[l.id] || 0} 笔{state.currentLedgerId === l.id ? ' · 使用中' : ''}</span>
            </button>
          ))}
        </div>

        {/* 当前账本快捷切换 */}
        <div className="group" style={{ marginTop: 12 }}>
          <div className="gtitle">切换当前账本</div>
          {state.ledgers.map((l) => (
            <div key={l.id} className="cell" onClick={() => {
              set((d) => { d.currentLedgerId = l.id })
              toast(`已切换到「${l.name}」`)
            }}>
              <LedgerIcon l={l} className="cico" />
              <div className="cmain">
                <div className="ctitle">{l.name}</div>
                <div className="cdesc">{l.template} · {counts[l.id] || 0} 笔账单</div>
              </div>
              <div className="cright">
                {state.currentLedgerId === l.id && <span style={{ color: 'var(--brand)', fontWeight: 700 }}>使用中</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 编辑账本 */}
      <Sheet open={!!edit} onClose={() => setEdit(null)}
        title={edit && state.ledgers.some((l) => l.id === edit.id) ? '编辑账本' : '新建账本'}>
        {edit && (
          <>
            <div className="field">
              <label>选择模板</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                {LEDGER_TEMPLATES.map((t) => (
                  <button key={t.name} className={`gitem ${edit.template === t.name ? 'on' : ''}`}
                    onClick={() => setEdit({ ...edit, template: t.name, icon: t.icon })}>
                    <div className="gi">{t.icon}</div>
                    <span>{t.name}</span>
                  </button>
                ))}
              </div>
            </div>
            {/* v1.6.9 自定义账本图标：上传图片优先于模板 emoji */}
            <div className="field">
              <label>账本图标</label>
              <div className="bookicon-row">
                <div className="bookicon-preview">
                  {editIconUrl
                    ? <img src={editIconUrl} alt="" decoding="async" draggable={false} />
                    : (edit.icon || <><Icon name="book" size="1em" className="qy-inline-icon" /></>)}
                </div>
                <button className="btn ghost" style={{ flex: 1, margin: 0 }} disabled={busyIcon} onClick={() => iconFileRef.current?.click()}>
                  {busyIcon ? '处理中…' : <><Icon name="image" size="1em" className="qy-inline-icon" /> 上传自定义图标</>}
                </button>
                {editIconUrl && (
                  <button className="btn ghost" style={{ margin: 0 }} disabled={busyIcon} onClick={async () => {
                    await media.clearBookIcon(edit.id)
                    toast('已恢复默认图标')
                  }}>恢复</button>
                )}
              </div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>上传任意图片自动居中裁切为方形图标，液态玻璃自动适配</div>
              <input ref={iconFileRef} type="file" accept="image/*" hidden onChange={onPickIcon} />
            </div>
            <div className="field">
              <label>账本名称</label>
              <input className="input" value={edit.name} maxLength={10}
                placeholder="例如：日本蜜月行"
                onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
            <div className="btnrow">
              {state.ledgers.some((l) => l.id === edit.id) && state.ledgers.length > 1 && (
                <button className="btn danger" onClick={() => { setDelId(edit.id); setEdit(null) }}>删除</button>
              )}
              <button className="btn ghost" onClick={() => setEdit(null)}>取消</button>
              <button className="btn" onClick={save}>保存</button>
            </div>
          </>
        )}
      </Sheet>

      <Confirm
        open={!!delId}
        title="删除账本？"
        text="该账本下的全部账单将一并删除，且无法恢复。"
        okText="删除"
        danger
        onOk={doDelete}
        onCancel={() => setDelId(null)}
      />
    </>
  )
}
