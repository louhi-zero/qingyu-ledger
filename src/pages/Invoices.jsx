import React, { useState } from 'react'
import { useStore } from '../store.jsx'
import { TopBar, Sheet, Confirm, Empty } from '../ui.jsx'
import { uid } from '../utils.js'

function blankInv() {
  return { id: uid(), name: '', taxNo: '', address: '', phone: '', bank: '', account: '' }
}

function CopyText({ label, value }) {
  const copy = () => {
    const done = () => {}
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).catch(() => {})
    } else {
      const ta = document.createElement('textarea')
      ta.value = value; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      document.body.removeChild(ta)
    }
  }
  return (
    <div className="selectline copyable" onClick={copy} style={{ marginBottom: 8 }}>
      <span className="muted" style={{ minWidth: 70 }}>{label}</span>
      <b style={{ flex: 1, marginLeft: 8, wordBreak: 'break-all', textAlign: 'right', fontSize: 13.5 }}>{value || '—'}</b>
      <span style={{ marginLeft: 8, color: 'var(--brand)', fontSize: 12 }}>复制</span>
    </div>
  )
}

export default function Invoices({ nav }) {
  const { state, set, toast } = useStore()
  const [edit, setEdit] = useState(null)
  const [view, setView] = useState(null)
  const [delId, setDelId] = useState(null)

  const save = () => {
    if (!edit.name.trim()) { toast('请填写抬头名称', 'err'); return }
    if (!edit.taxNo.trim()) { toast('请填写税号', 'err'); return }
    set((d) => {
      const idx = d.invoices.findIndex((x) => x.id === edit.id)
      const data = { ...edit, name: edit.name.trim(), taxNo: edit.taxNo.trim() }
      if (idx >= 0) d.invoices[idx] = data
      else d.invoices.push(data)
    })
    toast('发票抬头已保存')
    setEdit(null)
  }

  const doDelete = () => {
    set((d) => { d.invoices = d.invoices.filter((x) => x.id !== delId) })
    toast('已删除')
    setDelId(null)
  }

  const f = (label, key, ph) => (
    <div className="field">
      <label>{label}</label>
      <input className="input" value={edit[key]} placeholder={ph}
        onChange={(e) => setEdit({ ...edit, [key]: e.target.value })} />
    </div>
  )

  return (
    <>
      <TopBar
        title="发票助手"
        onBack={nav.pop}
        right={<button className="iconbtn" onClick={() => setEdit(blankInv())}>＋</button>}
      />
      <div className="page-body no-tab">
        <div className="card" style={{ background: 'var(--grad-soft)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.7 }}>
            🧾 保存常用发票抬头与税号，<br />
            开票时点击即可一键复制，不用再翻聊天记录。
          </div>
        </div>

        {state.invoices.length === 0 ? (
          <div className="card">
            <Empty icon="🧾" text="还没有保存发票抬头">
              <button className="btn" onClick={() => setEdit(blankInv())}>＋ 添加抬头</button>
            </Empty>
          </div>
        ) : (
          <div className="group">
            {state.invoices.map((inv) => (
              <div key={inv.id} className="cell" onClick={() => setView(inv)}>
                <div className="cico">🧾</div>
                <div className="cmain">
                  <div className="ctitle">{inv.name}</div>
                  <div className="cdesc">税号 {inv.taxNo}</div>
                </div>
                <div className="cright"><span className="arrow">›</span></div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 查看 / 复制 */}
      <Sheet open={!!view} onClose={() => setView(null)} title="发票抬头">
        {view && (
          <>
            <div style={{ textAlign: 'center', margin: '4px 0 14px' }}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>{view.name}</div>
            </div>
            <CopyText label="税号" value={view.taxNo} />
            {view.address && <CopyText label="地址" value={view.address} />}
            {view.phone && <CopyText label="电话" value={view.phone} />}
            {view.bank && <CopyText label="开户行" value={view.bank} />}
            {view.account && <CopyText label="账号" value={view.account} />}
            <div className="hr" />
            <div className="btnrow">
              <button className="btn danger" onClick={() => { setDelId(view.id); setView(null) }}>删除</button>
              <button className="btn ghost" onClick={() => { setEdit({ ...view }); setView(null) }}>编辑</button>
            </div>
          </>
        )}
      </Sheet>

      {/* 编辑 */}
      <Sheet open={!!edit} onClose={() => setEdit(null)}
        title={edit && state.invoices.some((x) => x.id === edit.id) ? '编辑抬头' : '添加抬头'}>
        {edit && (
          <>
            {f('抬头名称 *', 'name', '公司全称或个人姓名')}
            {f('纳税人识别号 *', 'taxNo', '统一社会信用代码')}
            {f('注册地址（选填）', 'address', '')}
            {f('注册电话（选填）', 'phone', '')}
            {f('开户银行（选填）', 'bank', '')}
            {f('银行账号（选填）', 'account', '')}
            <div className="btnrow">
              <button className="btn ghost" onClick={() => setEdit(null)}>取消</button>
              <button className="btn" onClick={save}>保存</button>
            </div>
          </>
        )}
      </Sheet>

      <Confirm
        open={!!delId}
        title="删除发票抬头？"
        text="删除后不可恢复。"
        okText="删除"
        danger
        onOk={doDelete}
        onCancel={() => setDelId(null)}
      />
    </>
  )
}
