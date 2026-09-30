import React, { useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { TopBar, Sheet, Switch, Confirm, Seg } from '../ui.jsx'
import { EmojiPicker } from '../ui.jsx'
import { AvatarFace, useMediaActions } from '../theme.jsx'
import { txsOfLedger, txsToCSV, downloadFile, todayStr } from '../utils.js'

const APP_VERSION = '1.1.0'

export default function Settings({ nav }) {
  const { state, set, toast, loadDemo, clearAll, restoreState } = useStore()
  const s = state.settings
  const media = useMediaActions()
  const [confirmClear, setConfirmClear] = useState(false)
  const [nameOpen, setNameOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [avatarTab, setAvatarTab] = useState('emoji')
  const [name, setName] = useState(s.nickname)
  const [pending, setPending] = useState(null)
  const [busyImg, setBusyImg] = useState(false)
  const restoreRef = useRef(null)
  const avatarFileRef = useRef(null)
  const wallpaperRef = useRef(null)

  const pickImage = async (kind, file) => {
    if (!file) return
    setBusyImg(true)
    try {
      if (kind === 'avatar') {
        await media.saveAvatarPhoto(file)
        toast('头像已更新')
        setAvatarOpen(false)
      } else {
        await media.saveWallpaper(file)
        set((d) => { d.settings.glassOn = true })
        toast('壁纸已更换，液态玻璃已开启')
      }
    } catch {
      toast('图片读取失败，请换一张试试', 'err')
    } finally {
      setBusyImg(false)
    }
  }

  const exportAll = () => {
    const txs = txsOfLedger(state)
    if (!txs.length) { toast('还没有账单可导出', 'err'); return }
    downloadFile(`轻语账单_${state.ledgers.find((l) => l.id === state.currentLedgerId)?.name || ''}_${todayStr()}.csv`,
      txsToCSV(state, txs), 'text/csv')
    toast('已导出当前账本 CSV')
  }

  // 全量备份（JSON，含全部账本/账户/分类/预算/设置）
  const backupAll = () => {
    const envelope = {
      app: 'qingyu', kind: 'full-backup', appVersion: APP_VERSION,
      at: new Date().toISOString(), data: state,
    }
    downloadFile(`轻语记账_全量备份_${todayStr()}.json`,
      JSON.stringify(envelope, null, 2), 'application/json')
    toast('已导出全量备份文件')
  }

  const readRestore = (file) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ''))
        const data = parsed && parsed.kind === 'full-backup' ? parsed.data : parsed
        const valid = data && data.version && data.settings && data.categories
          && Array.isArray(data.ledgers) && data.ledgers.length > 0
          && Array.isArray(data.transactions)
        if (!valid) { toast('备份文件无法识别或已损坏', 'err'); return }
        setPending(data)
      } catch {
        toast('文件解析失败，请选择本 App 导出的 JSON 备份', 'err')
      }
    }
    reader.readAsText(file, 'utf-8')
  }

  return (
    <>
      <TopBar title="设置" onBack={nav.pop} />
      <div className="page-body no-tab">
        {/* 个人 */}
        <div className="group">
          <div className="gtitle">个人</div>
          <div className="cell" onClick={() => { setName(s.nickname); setNameOpen(true) }}>
            <div className="cico">✏️</div>
            <div className="cmain"><div className="ctitle">昵称</div></div>
            <div className="cright">{s.nickname}<span className="arrow">›</span></div>
          </div>
          <div className="cell" onClick={() => { setAvatarTab(s.avatarPhotoAt ? 'photo' : 'emoji'); setAvatarOpen(true) }}>
            <div className="cico"><AvatarFace /></div>
            <div className="cmain"><div className="ctitle">头像</div><div className="cdesc">表情或相册照片，照片随云同步</div></div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
        </div>

        {/* 外观 */}
        <div className="group">
          <div className="gtitle">外观 · 液态玻璃</div>
          <div className="cell" onClick={() => set((d) => { d.settings.glassOn = !d.settings.glassOn })}>
            <div className="cico">🧊</div>
            <div className="cmain">
              <div className="ctitle">液态玻璃效果</div>
              <div className="cdesc">半透明磨砂材质与主色晕光，低端机可关闭省电</div>
            </div>
            <div className="cright"><Switch on={s.glassOn} onChange={() => set((d) => { d.settings.glassOn = !d.settings.glassOn })} /></div>
          </div>
          {s.glassOn && (
            <div className="cell">
              <div className="cico">🌫️</div>
              <div className="cmain">
                <div className="ctitle">模糊强度</div>
                <div className="cdesc">数值越大磨砂感越强</div>
              </div>
              <div className="cright" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range" min={8} max={28} step={2} value={s.glassBlur}
                  onChange={(e) => set((d) => { d.settings.glassBlur = Number(e.target.value) })}
                  style={{ width: 110 }}
                />
                <span className="muted" style={{ width: 34, textAlign: 'right' }}>{s.glassBlur}</span>
              </div>
            </div>
          )}
          <div className="cell" onClick={() => wallpaperRef.current?.click()}>
            <div className="cico">🖼️</div>
            <div className="cmain">
              <div className="ctitle">自定义壁纸</div>
              <div className="cdesc">{s.wallpaperAt ? '已设置壁纸，点击重新选择' : '上传喜欢的图片作为玻璃背景'}</div>
            </div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
          {s.wallpaperAt && (
            <div className="cell" onClick={async () => {
              await media.clearWallpaper()
              toast('已恢复默认背景')
            }}>
              <div className="cico">↩️</div>
              <div className="cmain"><div className="ctitle">恢复默认背景</div></div>
              <div className="cright"><span className="arrow">›</span></div>
            </div>
          )}
          <input
            ref={wallpaperRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) pickImage('wallpaper', f); e.target.value = '' }}
          />
        </div>

        {/* AI */}
        <div className="group">
          <div className="gtitle">AI 智能分析</div>
          <div className="cell" onClick={() => nav.push({ page: 'aiSettings', title: 'AI 分析设置' })}>
            <div className="cico">🤖</div>
            <div className="cmain">
              <div className="ctitle">AI 账单分析</div>
              <div className="cdesc">智谱大模型月度/年度账单解读，需配置 API Key</div>
            </div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
        </div>

        {/* 记账偏好 */}
        <div className="group">
          <div className="gtitle">记账偏好</div>
          <div className="cell">
            <div className="cico">📅</div>
            <div className="cmain">
              <div className="ctitle">每月起始日</div>
              <div className="cdesc">影响账单周期与预算统计</div>
            </div>
            <div className="cright">
              <select className="input" style={{ width: 86, padding: '8px 10px' }}
                value={s.monthStartDay}
                onChange={(e) => { set((d) => { d.settings.monthStartDay = Number(e.target.value) }); toast('账期起始日已更新') }}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}日</option>)}
              </select>
            </div>
          </div>
          <div className="cell" onClick={() => set((d) => { d.settings.hideAmount = !d.settings.hideAmount })}>
            <div className="cico">🔒</div>
            <div className="cmain">
              <div className="ctitle">金额模糊</div>
              <div className="cdesc">公共场合隐藏具体金额</div>
            </div>
            <div className="cright"><Switch on={s.hideAmount} onChange={() => set((d) => { d.settings.hideAmount = !d.settings.hideAmount })} /></div>
          </div>
          <div className="cell" onClick={() => set((d) => { d.settings.dark = !d.settings.dark })}>
            <div className="cico">🌙</div>
            <div className="cmain">
              <div className="ctitle">深色模式</div>
              <div className="cdesc">夜间记账更护眼</div>
            </div>
            <div className="cright"><Switch on={s.dark} onChange={() => set((d) => { d.settings.dark = !d.settings.dark })} /></div>
          </div>
        </div>

        {/* 提醒 */}
        <div className="group">
          <div className="gtitle">记账提醒</div>
          <div className="cell" onClick={() => {
            const next = !s.remindEnabled
            set((d) => { d.settings.remindEnabled = next })
            if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
              Notification.requestPermission().catch(() => {})
            }
            toast(next ? '已开启每日提醒' : '已关闭提醒')
          }}>
            <div className="cico">⏰</div>
            <div className="cmain"><div className="ctitle">每日记账提醒</div></div>
            <div className="cright"><Switch on={s.remindEnabled} onChange={() => {
              const next = !s.remindEnabled
              set((d) => { d.settings.remindEnabled = next })
            }} /></div>
          </div>
          {s.remindEnabled && (
            <div className="cell">
              <div className="cico">🕐</div>
              <div className="cmain"><div className="ctitle">提醒时间</div></div>
              <div className="cright">
                <input type="time" className="input" style={{ width: 110, padding: '8px 10px' }}
                  value={s.remindTime}
                  onChange={(e) => set((d) => { d.settings.remindTime = e.target.value })} />
              </div>
            </div>
          )}
        </div>

        {/* 数据 */}
        <div className="group">
          <div className="gtitle">数据管理</div>
          <div className="cell" onClick={exportAll}>
            <div className="cico">📤</div>
            <div className="cmain"><div className="ctitle">导出当前账本</div><div className="cdesc">CSV 格式，可用 Excel 打开</div></div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
          <div className="cell" onClick={backupAll}>
            <div className="cico">💾</div>
            <div className="cmain"><div className="ctitle">全量备份</div><div className="cdesc">导出全部账本/账户/分类/预算/设置为 JSON</div></div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
          <div className="cell" onClick={() => restoreRef.current?.click()}>
            <div className="cico">📂</div>
            <div className="cmain"><div className="ctitle">从备份恢复</div><div className="cdesc">选择 JSON 备份，将覆盖当前全部数据</div></div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
          <div className="cell" onClick={() => nav.push({ page: 'cloud', title: '云备份' })}>
            <div className="cico">☁️</div>
            <div className="cmain"><div className="ctitle">云备份</div><div className="cdesc">WebDAV 网盘：双设备自动合并、换机恢复</div></div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
          <input ref={restoreRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) readRestore(f); e.target.value = '' }} />
          <div className="cell" onClick={() => { loadDemo(); toast('已载入示例数据，可随意体验') }}>
            <div className="cico">🎁</div>
            <div className="cmain"><div className="ctitle">载入示例数据</div><div className="cdesc">覆盖当前数据，用于体验全部功能</div></div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
          <div className="cell" onClick={() => setConfirmClear(true)}>
            <div className="cico">🗑️</div>
            <div className="cmain"><div className="ctitle" style={{ color: 'var(--expense)' }}>清空全部数据</div></div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
        </div>

        {/* 其他 */}
        <div className="group">
          <div className="cell" onClick={() => nav.push({ page: 'category', title: '分类管理' })}>
            <div className="cico">🏷️</div>
            <div className="cmain"><div className="ctitle">分类管理</div><div className="cdesc">自定义收支分类</div></div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
        </div>

        <div className="center-box muted" style={{ lineHeight: 1.8, padding: '6px 0 20px' }}>
          轻语记账 v{APP_VERSION}<br />所有功能免费 · 数据仅保存在本设备
        </div>
      </div>

      {/* 改名 */}
      <Sheet open={nameOpen} onClose={() => setNameOpen(false)} title="修改昵称">
        <div className="field">
          <input className="input" maxLength={12} value={name} autoFocus
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="btnrow">
          <button className="btn ghost" onClick={() => setNameOpen(false)}>取消</button>
          <button className="btn" onClick={() => {
            const v = name.trim() || '轻语用户'
            set((d) => { d.settings.nickname = v })
            setNameOpen(false)
            toast('昵称已更新')
          }}>保存</button>
        </div>
      </Sheet>

      {/* 头像 */}
      <Sheet open={avatarOpen} onClose={() => setAvatarOpen(false)} title="选择头像">
        <Seg
          options={[{ label: '😀 表情', value: 'emoji' }, { label: '🖼️ 相册图片', value: 'photo' }]}
          value={avatarTab}
          onChange={setAvatarTab}
        />
        <div style={{ height: 12 }} />
        {avatarTab === 'emoji' ? (
          <EmojiPicker value={s.avatar} onChange={(e) => {
            set((d) => { d.settings.avatar = e })
            setAvatarOpen(false)
            toast('头像已更新')
          }} />
        ) : (
          <div>
            <div className="center-box" style={{ padding: '6px 0 12px' }}>
              <div className="avatar" style={{ width: 72, height: 72, fontSize: 34 }}>
                <AvatarFace />
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>方形图片会自动居中裁切，压缩后上传</div>
            </div>
            <button className="btn" disabled={busyImg} onClick={() => avatarFileRef.current?.click()}>
              {busyImg ? '处理中…' : '📷 从相册选择图片'}
            </button>
            {s.avatarPhotoAt && (
              <button className="btn ghost" style={{ marginTop: 10 }} disabled={busyImg} onClick={async () => {
                await media.clearAvatarPhoto()
                setAvatarTab('emoji')
                toast('已移除头像照片')
              }}>移除照片，用回表情</button>
            )}
            <input
              ref={avatarFileRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) pickImage('avatar', f); e.target.value = '' }}
            />
          </div>
        )}
      </Sheet>

      <Confirm
        open={confirmClear}
        title="清空全部数据？"
        text="所有账单、账户、预算与设置都会被删除并恢复初始状态，且无法恢复。建议先导出备份。"
        okText="全部清空"
        danger
        onOk={() => { setConfirmClear(false); clearAll() }}
        onCancel={() => setConfirmClear(false)}
      />

      <Confirm
        open={!!pending}
        title="确定从备份恢复？"
        text={pending
          ? `备份包含 ${pending.ledgers?.length || 0} 个账本、${pending.transactions?.length || 0} 笔账单、${pending.accounts?.length || 0} 个账户。恢复将覆盖当前全部数据，建议恢复前先做一次全量备份。`
          : ''}
        okText="覆盖并恢复"
        danger
        onOk={() => {
          const ok = restoreState(pending)
          if (ok) toast('已从备份恢复')
          else toast('备份文件无法识别或已损坏', 'err')
          setPending(null)
        }}
        onCancel={() => setPending(null)}
      />
    </>
  )
}
