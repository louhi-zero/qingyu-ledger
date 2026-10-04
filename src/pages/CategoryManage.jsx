import React, { useState } from 'react'
import { useStore } from '../store.jsx'
import { TopBar, Sheet, Seg, Confirm, Empty, EmojiPicker, CatIcon } from '../ui.jsx'
import { ALL_CAT_ICONS } from '../catIcons.js'
import { uid } from '../utils.js'

export default function CategoryManage({ nav }) {
  const { state, set, toast } = useStore()
  const [tab, setTab] = useState('expense')
  const [editCat, setEditCat] = useState(null) // 编辑一级分类 {draft, isNew}
  const [editSub, setEditSub] = useState(null) // 编辑二级 {catId, draft, isNew}
  const [emojiTarget, setEmojiTarget] = useState(null) // {kind:'cat'|'sub'}
  const [iconTab, setIconTab] = useState('lib') // v2.6 图标选择双来源：lib=图标库 / emoji
  const [delCat, setDelCat] = useState(null)
  const [delSub, setDelSub] = useState(null)

  const list = tab === 'expense' ? state.categories.expense : state.categories.income

  const newCat = () => ({ id: uid(), name: '', icon: '🏷️', color: '#2a2f3a', custom: true, children: [] })
  const newSub = () => ({ id: uid(), name: '', icon: '🏷️' })

  const saveCat = () => {
    const d = editCat.draft
    if (!d.name.trim()) { toast('请填写分类名称', 'err'); return }
    set((s) => {
      const arr = tab === 'expense' ? s.categories.expense : s.categories.income
      if (editCat.isNew) arr.push({ ...d, name: d.name.trim() })
      else {
        const idx = arr.findIndex((x) => x.id === d.id)
        if (idx >= 0) arr[idx] = { ...d, name: d.name.trim() }
      }
    })
    toast('分类已保存')
    setEditCat(null)
  }

  const saveSub = () => {
    const d = editSub.draft
    if (!d.name.trim()) { toast('请填写子分类名称', 'err'); return }
    set((s) => {
      const arr = tab === 'expense' ? s.categories.expense : s.categories.income
      const c = arr.find((x) => x.id === editSub.catId)
      if (!c.children) c.children = []
      if (editSub.isNew) c.children.push({ ...d, name: d.name.trim() })
      else {
        const idx = c.children.findIndex((x) => x.id === d.id)
        if (idx >= 0) c.children[idx] = { ...d, name: d.name.trim() }
      }
    })
    toast('子分类已保存')
    setEditSub(null)
  }

  const doDelCat = () => {
    set((s) => {
      const arr = tab === 'expense' ? s.categories.expense : s.categories.income
      const idx = arr.findIndex((x) => x.id === delCat)
      if (idx >= 0) arr.splice(idx, 1)
      // 账单保留，分类显示为未分类
    })
    toast('分类已删除，相关账单将显示为未分类')
    setDelCat(null)
  }

  const doDelSub = () => {
    set((s) => {
      const arr = tab === 'expense' ? s.categories.expense : s.categories.income
      const c = arr.find((x) => x.id === delSub.catId)
      if (c?.children) c.children = c.children.filter((x) => x.id !== delSub.id)
    })
    toast('子分类已删除')
    setDelSub(null)
  }

  const openCatEmoji = () => setEmojiTarget({ kind: 'cat' })
  const openSubEmoji = () => setEmojiTarget({ kind: 'sub' })

  const activeDraft = emojiTarget?.kind === 'cat' ? editCat?.draft : editSub?.draft

  return (
    <>
      <TopBar title="分类管理" onBack={nav.pop} />
      <div className="page-body no-tab">
        <Seg
          options={[{ value: 'expense', label: '支出分类' }, { value: 'income', label: '收入分类' }]}
          value={tab}
          onChange={setTab}
          style={{ marginBottom: 12 }}
        />

        {list.map((c) => (
          <div key={c.id} className="card" style={{ padding: 0 }}>
            <div className="cell">
              <div className="cico"><CatIcon icon={c.icon} size={20} /></div>
              <div className="cmain">
                <div className="ctitle">{c.name}{c.custom && <span className="tag" style={{ marginLeft: 6, background: 'var(--brand-weak)', color: 'var(--brand)' }}>自定义</span>}</div>
                <div className="cdesc">{(c.children || []).map((x) => x.name).join(' / ') || '无子分类'}</div>
              </div>
              <div className="cright" style={{ gap: 6 }}>
                <button className="iconbtn" onClick={() => setEditCat({ draft: { ...c, children: c.children || [] }, isNew: false })}>✏️</button>
                <button className="iconbtn" onClick={() => setEditSub({ catId: c.id, draft: newSub(), isNew: true })}>＋</button>
              </div>
            </div>
            {(c.children || []).length > 0 && (
              <div style={{ borderTop: '1px solid var(--line)' }}>
                {c.children.map((sub) => (
                  <div key={sub.id} className="cell" style={{ paddingLeft: 28 }}>
                    <div className="cico" style={{ width: 30, height: 30 }}><CatIcon icon={sub.icon} size={14} /></div>
                    <div className="cmain"><div className="ctitle" style={{ fontSize: 13.5 }}>{sub.name}</div></div>
                    <div className="cright" style={{ gap: 6 }}>
                      <button className="iconbtn" style={{ width: 30, height: 30 }}
                        onClick={() => setEditSub({ catId: c.id, draft: { ...sub }, isNew: false })}>✏️</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        <button className="btn ghost" onClick={() => setEditCat({ draft: newCat(), isNew: true })}>＋ 新建一级分类</button>
      </div>

      {/* 编辑一级分类 */}
      <Sheet open={!!editCat} onClose={() => setEditCat(null)} title={editCat?.isNew ? '新建分类' : '编辑分类'}>
        {editCat && (
          <>
            <div className="field">
              <label>图标</label>
              <button className="selectline" onClick={openCatEmoji}>
                <CatIcon icon={editCat.draft.icon} size={22} />
                <span className="muted">点击更换 ›</span>
              </button>
            </div>
            <div className="field">
              <label>名称</label>
              <input className="input" maxLength={6} value={editCat.draft.name} autoFocus
                placeholder="例如：数码装备"
                onChange={(e) => setEditCat({ ...editCat, draft: { ...editCat.draft, name: e.target.value } })} />
            </div>
            <div className="btnrow">
              {!editCat.isNew && (
                <button className="btn danger" onClick={() => { setDelCat(editCat.draft.id); setEditCat(null) }}>删除</button>
              )}
              <button className="btn ghost" onClick={() => setEditCat(null)}>取消</button>
              <button className="btn" onClick={saveCat}>保存</button>
            </div>
          </>
        )}
      </Sheet>

      {/* 编辑二级分类 */}
      <Sheet open={!!editSub} onClose={() => setEditSub(null)} title={editSub?.isNew ? '添加子分类' : '编辑子分类'}>
        {editSub && (
          <>
            <div className="field">
              <label>图标</label>
              <button className="selectline" onClick={openSubEmoji}>
                <CatIcon icon={editSub.draft.icon} size={22} />
                <span className="muted">点击更换 ›</span>
              </button>
            </div>
            <div className="field">
              <label>名称</label>
              <input className="input" maxLength={6} value={editSub.draft.name} autoFocus
                onChange={(e) => setEditSub({ ...editSub, draft: { ...editSub.draft, name: e.target.value } })} />
            </div>
            <div className="btnrow">
              {!editSub.isNew && (
                <button className="btn danger" onClick={() => { setDelSub({ catId: editSub.catId, id: editSub.draft.id }); setEditSub(null) }}>删除</button>
              )}
              <button className="btn ghost" onClick={() => setEditSub(null)}>取消</button>
              <button className="btn" onClick={saveSub}>保存</button>
            </div>
          </>
        )}
      </Sheet>

      {/* 图标选择：v2.6 图标库（线性图标）+ Emoji 双来源 */}
      <Sheet open={!!emojiTarget && (!!editCat || !!editSub)} onClose={() => setEmojiTarget(null)} title="选择图标">
        <Seg
          options={[{ value: 'lib', label: '图标库' }, { value: 'emoji', label: 'Emoji' }]}
          value={iconTab}
          onChange={setIconTab}
          style={{ marginBottom: 12 }}
        />
        {iconTab === 'lib' ? (
          <div className="ilib">
            {ALL_CAT_ICONS.map((it) => (
              <button
                key={it.key} type="button" title={it.name} aria-label={it.name}
                className={`ilib-it${activeDraft?.icon === it.src ? ' on' : ''}`}
                onClick={() => {
                  if (emojiTarget.kind === 'cat') {
                    setEditCat({ ...editCat, draft: { ...editCat.draft, icon: it.src } })
                  } else {
                    setEditSub({ ...editSub, draft: { ...editSub.draft, icon: it.src } })
                  }
                  setEmojiTarget(null)
                }}
              >
                <img src={it.src} alt="" draggable={false} />
              </button>
            ))}
          </div>
        ) : (
          <EmojiPicker
            value={activeDraft?.icon}
            onChange={(e) => {
              if (emojiTarget.kind === 'cat') {
                setEditCat({ ...editCat, draft: { ...editCat.draft, icon: e } })
              } else {
                setEditSub({ ...editSub, draft: { ...editSub.draft, icon: e } })
              }
              setEmojiTarget(null)
            }}
          />
        )}
      </Sheet>

      <Confirm
        open={!!delCat}
        title="删除该分类？"
        text="分类及其子分类将被删除，已记账单会保留并显示为未分类。"
        okText="删除"
        danger
        onOk={doDelCat}
        onCancel={() => setDelCat(null)}
      />
      <Confirm
        open={!!delSub}
        title="删除该子分类？"
        text="已记账单会保留并显示为未分类。"
        okText="删除"
        danger
        onOk={doDelSub}
        onCancel={() => setDelSub(null)}
      />
    </>
  )
}
