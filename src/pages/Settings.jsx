import React, { useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { useNav, DEFAULT_TAB_ICONS } from '../App.jsx'
import { TopBar, Sheet, Switch, Confirm, Seg, EmojiPicker } from '../ui.jsx'
import { AvatarFace, AiFace, useAiFacePhoto, useWelcomeBg, useMediaActions } from '../theme.jsx'
import { txsOfLedger, txsToCSV, downloadFile, todayStr, FX_RATES } from '../utils.js'

const APP_VERSION = '1.4.0'

const FX_CODES = Object.keys(FX_RATES).filter((c) => c !== 'CNY')

const TAB_ICON_ITEMS = [
  { key: 'home', name: '明细' },
  { key: 'charts', name: '图表' },
  { key: 'discover', name: '发现' },
  { key: 'profile', name: '我的' },
]

export default function Settings({ nav }) {
  const { state, set, toast, loadDemo, clearAll, restoreState } = useStore()
  const s = state.settings
  const media = useMediaActions()
  const aiFacePhoto = useAiFacePhoto()
  const welcomeBg = useWelcomeBg()
  const [confirmClear, setConfirmClear] = useState(false)
  const [nameOpen, setNameOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [avatarTab, setAvatarTab] = useState('emoji')
  const [name, setName] = useState(s.nickname)
  const [pending, setPending] = useState(null)
  const [busyImg, setBusyImg] = useState(false)
  // v1.3 个性化
  const [tabIconOpen, setTabIconOpen] = useState(false)
  const [pickTab, setPickTab] = useState(null) // 正在选图标的 tab key
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  const [aiFaceOpen, setAiFaceOpen] = useState(false)
  const [aiFaceTab, setAiFaceTab] = useState('emoji')
  // v1.3 资金管理：本位币与汇率
  const [fxOpen, setFxOpen] = useState(false)
  const restoreRef = useRef(null)
  const avatarFileRef = useRef(null)
  const wallpaperRef = useRef(null)
  const welcomeFileRef = useRef(null)
  const aiFaceFileRef = useRef(null)

  const pickImage = async (kind, file) => {
    if (!file) return
    setBusyImg(true)
    try {
      if (kind === 'avatar') {
        await media.saveAvatarPhoto(file)
        toast('头像已更新')
        setAvatarOpen(false)
      } else if (kind === 'wallpaper') {
        await media.saveWallpaper(file)
        set((d) => { d.settings.glassOn = true })
        toast('壁纸已更换，液态玻璃已开启')
      } else if (kind === 'welcome') {
        await media.saveWelcomeBg(file)
        toast('启动页背景已更新')
        setWelcomeOpen(false)
      } else if (kind === 'aiface') {
        await media.saveAiFace(file)
        toast('AI 形象已更新')
        setAiFaceOpen(false)
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
          <div className="cell" onClick={() => { setPickTab(null); setTabIconOpen(true) }}>
            <div className="cico">🧩</div>
            <div className="cmain">
              <div className="ctitle">底部菜单图标</div>
              <div className="cdesc">把明细/图表/发现/我的换成喜欢的图标</div>
            </div>
            <div className="cright">
              <span className="tico-preview">{TAB_ICON_ITEMS.some((t) => s.tabIcons?.[t.key]) ? '已自定义' : '默认'}</span>
              <span className="arrow">›</span>
            </div>
          </div>
          <div className="cell" onClick={() => setWelcomeOpen(true)}>
            <div className="cico">🌅</div>
            <div className="cmain">
              <div className="ctitle">启动页背景</div>
              <div className="cdesc">{s.welcomeBgAt ? '已设置，点击重新选择' : '上传一张图，首次打开更有专属感'}</div>
            </div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
        </div>

        {/* AI */}
        <div className="group">
          <div className="gtitle">AI 智能分析</div>
          <div className="cell" onClick={() => { setAiFaceTab(s.aiFaceAt ? 'photo' : 'emoji'); setAiFaceOpen(true) }}>
            <div className="cico"><AiFace style={{ fontSize: 22, lineHeight: 1 }} /></div>
            <div className="cmain">
              <div className="ctitle">AI 助手形象</div>
              <div className="cdesc">出现在账单分析、消费点评入口处</div>
            </div>
            <div className="cright"><span className="arrow">›</span></div>
          </div>
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
          <div className="cell" onClick={() => setFxOpen(true)}>
            <div className="cico">💱</div>
            <div className="cmain">
              <div className="ctitle">本位币与汇率</div>
              <div className="cdesc">人民币 CNY · 1 美元 ≈ {(state.fxRates?.USD ?? FX_RATES.USD.rate).toFixed(2)}</div>
            </div>
            <div className="cright"><span className="arrow">›</span></div>
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
          <div className="cell" onClick={() => set((d) => { d.settings.nightAcross = !d.settings.nightAcross })}>
            <div className="cico">🦉</div>
            <div className="cmain">
              <div className="ctitle">熬夜归属前一天</div>
              <div className="cdesc">凌晨 0-5 点记账默认算昨天（记「昨晚」更顺手）</div>
            </div>
            <div className="cright"><Switch on={s.nightAcross} onChange={() => set((d) => { d.settings.nightAcross = !d.settings.nightAcross })} /></div>
          </div>
          <div className="cell" onClick={() => {
            const next = !s.remindEnabled
            set((d) => { d.settings.remindEnabled = next })
            if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
              Notification.requestPermission().catch(() => {})
            }
            toast(next ? '已开启每日提醒' : '已关闭提醒')
          }}>
            <div className="cico">⏰</div>
            <div className="cmain">
              <div className="ctitle">每日记账提醒</div>
              <div className="cdesc">App 内走系统定时通知，浏览器/桌面版为页面通知</div>
            </div>
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
          <div className="cell" onClick={() => nav.push({ page: 'trash', title: '回收站' })}>
            <div className="cico">♻️</div>
            <div className="cmain">
              <div className="ctitle">回收站</div>
              <div className="cdesc">删除的账单保留 30 天，可恢复</div>
            </div>
            <div className="cright">
              {state.transactions.some((t) => t.deletedAt) && (
                <span className="tico-preview">{state.transactions.filter((t) => t.deletedAt).length} 件</span>
              )}
              <span className="arrow">›</span>
            </div>
          </div>
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

      {/* 底部菜单图标 */}
      <Sheet open={tabIconOpen} onClose={() => { setTabIconOpen(false); setPickTab(null) }} title="底部菜单图标">
        {pickTab ? (
          <div>
            <button className="chip" style={{ marginBottom: 10 }} onClick={() => setPickTab(null)}>‹ 返回</button>
            <EmojiPicker
              value={s.tabIcons?.[pickTab] || DEFAULT_TAB_ICONS[pickTab]}
              onChange={(e) => {
                set((d) => { d.settings.tabIcons[pickTab] = e })
                setPickTab(null)
                toast('图标已更新')
              }}
            />
          </div>
        ) : (
          <div>
            {TAB_ICON_ITEMS.map((t) => (
              <div key={t.key} className="cell" style={{ padding: '11px 4px' }} onClick={() => setPickTab(t.key)}>
                <div className="tico-cell">{s.tabIcons?.[t.key] || DEFAULT_TAB_ICONS[t.key]}</div>
                <div className="cmain"><div className="ctitle">{t.name}</div></div>
                <div className="cright muted">点击更换<span className="arrow">›</span></div>
              </div>
            ))}
            <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => {
              set((d) => { d.settings.tabIcons = {} })
              toast('已恢复默认图标')
            }}>恢复默认图标</button>
          </div>
        )}
      </Sheet>

      {/* 启动页背景 */}
      <Sheet open={welcomeOpen} onClose={() => setWelcomeOpen(false)} title="启动页背景">
        <div className="center-box" style={{ padding: '6px 0 12px' }}>
          <div className={`welcome-preview${welcomeBg ? ' has-img' : ''}`}>
            {welcomeBg && <img src={welcomeBg} alt="" decoding="async" draggable={false} />}
            {!welcomeBg && <span style={{ fontSize: 30 }}>🌅</span>}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {welcomeBg ? '已设置背景，下次首次打开生效' : '当前为默认渐变背景'}
          </div>
        </div>
        <button className="btn" disabled={busyImg} onClick={() => welcomeFileRef.current?.click()}>
          {busyImg ? '处理中…' : '📷 选择背景图片'}
        </button>
        {s.welcomeBgAt && (
          <button className="btn ghost" style={{ marginTop: 10 }} disabled={busyImg} onClick={async () => {
            await media.clearWelcomeBg()
            toast('已恢复默认背景')
          }}>恢复默认渐变背景</button>
        )}
        <input
          ref={welcomeFileRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) pickImage('welcome', f); e.target.value = '' }}
        />
      </Sheet>

      {/* AI 助手形象 */}
      <Sheet open={aiFaceOpen} onClose={() => setAiFaceOpen(false)} title="AI 助手形象">
        <Seg
          options={[{ label: '😀 表情', value: 'emoji' }, { label: '🖼️ 相册图片', value: 'photo' }]}
          value={aiFaceTab}
          onChange={setAiFaceTab}
        />
        <div style={{ height: 12 }} />
        {aiFaceTab === 'emoji' ? (
          <div>
            <div className="center-box" style={{ padding: '6px 0 12px' }}>
              <div className="aiface-preview"><AiFace /></div>
            </div>
            <EmojiPicker value={s.aiFace} onChange={(e) => {
              set((d) => { d.settings.aiFace = e; d.settings.aiFaceAt = null })
              media.clearAiFace().catch(() => {})
              toast('AI 形象已更新')
            }} />
          </div>
        ) : (
          <div>
            <div className="center-box" style={{ padding: '6px 0 12px' }}>
              <div className="aiface-preview"><AiFace /></div>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>方形图片会自动居中裁切</div>
            </div>
            <button className="btn" disabled={busyImg} onClick={() => aiFaceFileRef.current?.click()}>
              {busyImg ? '处理中…' : '📷 从相册选择图片'}
            </button>
            {s.aiFaceAt && (
              <button className="btn ghost" style={{ marginTop: 10 }} disabled={busyImg} onClick={async () => {
                await media.clearAiFace()
                setAiFaceTab('emoji')
                toast('已移除照片，用回表情')
              }}>移除照片，用回表情</button>
            )}
            <input
              ref={aiFaceFileRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) pickImage('aiface', f); e.target.value = '' }}
            />
          </div>
        )}
      </Sheet>

      {/* 本位币与汇率（v1.3 多币种） */}
      <Sheet open={fxOpen} onClose={() => setFxOpen(false)} title="本位币与汇率">
        <div className="field">
          <label>本位币（统计折算目标）</label>
          <select className="input" value="CNY" disabled><option value="CNY">人民币 CNY</option></select>
          <div className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.7 }}>
            外币账户按下方汇率折算为人民币，参与净资产与资产合计；交易与图表仍按账户币种记录。汇率为离线手动值，可按银行牌价自行修改。
          </div>
        </div>
        <div className="field">
          <label>汇率（1 单位外币 ≈ 人民币）</label>
          {FX_CODES.map((c) => (
            <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <div style={{ width: 92, flexShrink: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{c}</div>
                <div className="muted" style={{ fontSize: 11 }}>{FX_RATES[c].name} {FX_RATES[c].sym}</div>
              </div>
              <input className="input" type="number" inputMode="decimal" step="0.0001"
                value={state.fxRates?.[c] ?? FX_RATES[c].rate}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  set((d) => { d.fxRates[c] = Number.isFinite(v) && v > 0 ? v : 1 })
                }} />
            </div>
          ))}
        </div>
        <button className="btn ghost" onClick={() => {
          set((d) => {
            for (const c of FX_CODES) d.fxRates[c] = FX_RATES[c].rate
          })
          toast('已恢复默认参考汇率')
        }}>恢复默认参考汇率</button>
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
