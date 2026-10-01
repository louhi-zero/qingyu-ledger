import React, { useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { TopBar, Confirm } from '../ui.jsx'
import { WebDavTransport } from '../webdav.js'
import { parseRemote } from '../sync.js'
import {
  getDeviceId, readLastProfileSync, syncProfileArchive,
  parseProfileArchive, profilePatch, PROFILE_ARCHIVE_FILE,
} from '../userarchive.js'
import { runAutoSync, readLS, writeLS, readSyncLast, pullPushAssets, LS_BASE, LS_LAST } from '../autosync.js'

const JIANGUO_URL = 'https://dav.jianguoyun.com/dav/qingyu/backup.json'
const LS_CFG = 'qingyu_sync_cfg_v1'

function getDevice() {
  return getDeviceId() // v1.9.0 起与资料云存档共用同一设备号（userarchive.js 持有生成逻辑）
}
function fmtTime(at) {
  if (!at) return '从未同步'
  try {
    const d = new Date(at)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return at }
}

export default function CloudBackup({ nav }) {
  const { state, toast, restoreState } = useStore()
  const savedCfg = readLS(LS_CFG, { url: '', username: '', password: '' })
  const [url, setUrl] = useState(savedCfg.url || '')
  const [username, setUsername] = useState(savedCfg.username || '')
  const [password, setPassword] = useState(savedCfg.password || '')
  const [busy, setBusy] = useState('')
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [showJgyTip, setShowJgyTip] = useState(false)
  const [last, setLast] = useState(() => readSyncLast())
  // v1.9.0 用户资料云存档状态（最近自动/手动存档记录，含失败原因）
  const [lastProfile, setLastProfile] = useState(() => readLastProfileSync())
  const logRef = useRef(null)

  const cfg = () => ({ url: url.trim(), username: username.trim(), password })

  const validateCfg = (c) => {
    if (!/^https?:\/\//.test(c.url)) return '请填写完整的 WebDAV 文件地址（https://…）'
    return ''
  }

  const saveCfg = () => writeLS(LS_CFG, cfg())

  const applyJianguo = () => {
    if (!url.trim()) setUrl(JIANGUO_URL)
    setShowJgyTip(true)
    toast('已填入坚果云地址：账号填邮箱，密码填第三方应用密码')
  }

  // v1.10.0 测试连接成功视为「登录」，随后立即自动同步一次（登录后自动导入用户数据和账单）
  const onTest = async () => {
    const c = cfg()
    const err = validateCfg(c)
    if (err) { toast(err, 'err'); return }
    saveCfg()
    setBusy('test')
    try {
      const msg = await new WebDavTransport(c).test()
      toast(msg)
      // v1.10.0 测试通过视为「登录」：立即自动同步一次（云端有数据拉取合并，本机数据上传）
      const r = await runAutoSync({ state, restoreState, toast, silent: false })
      if (r.status === 'ok') setLast(readSyncLast())
    } catch (e) {
      toast(e.message, 'err')
    } finally { setBusy('') }
  }

  // 立即同步：下载 → 三向合并 → 上传（v1.10.0 起与自动同步共用 runAutoSync 编排）
  const onSync = async () => {
    const c = cfg()
    const err = validateCfg(c)
    if (err) { toast(err, 'err'); return }
    saveCfg()
    setBusy('sync')
    try {
      await runAutoSync({ state, restoreState, toast, silent: false })
      setLast(readSyncLast())
    } finally { setBusy('') }
  }

  // v1.9.0 手动立即存档资料（显式反馈：跳过/未变化/成功/失败都给 toast）
  const onProfileSync = async () => {
    setBusy('profile')
    try {
      const r = await syncProfileArchive(state, { toast, silent: false })
      if (r.status === 'uploaded') {
        setLastProfile(readLastProfileSync())
        toast('资料已云存档')
      } else if (r.status === 'unchanged') {
        toast('资料未变化，云端已是最新')
      } else if (r.status === 'skipped') {
        toast('请先在上方填写 WebDAV 文件地址', 'err')
      } else if (r.status === 'error') {
        setLastProfile(readLastProfileSync())
      }
    } finally { setBusy('') }
  }

  // 从云端恢复：直接以云端快照为准（新机换机场景）
  const onRestore = async () => {
    setConfirmRestore(false)
    const c = cfg()
    const err = validateCfg(c)
    if (err) { toast(err, 'err'); return }
    setBusy('restore')
    try {
      const remote = await new WebDavTransport(c).get()
      if (!remote) { toast('云端还没有备份文件', 'err'); return }
      const env = parseRemote(remote.env)
      // v1.9.0 资料档案联动：自动云存档的昵称/头像通常比全量快照更新，恢复时以档案对齐
      let profileNote = ''
      try {
        const rawProfile = await new WebDavTransport(c).getFile(PROFILE_ARCHIVE_FILE)
        const penv = rawProfile ? parseProfileArchive(rawProfile) : null
        const patch = penv ? profilePatch(penv) : null
        if (patch && env.data?.settings) {
          Object.assign(env.data.settings, patch)
          profileNote = '（资料档案：昵称/头像已对齐云端）'
        }
      } catch { /* 档案缺失或读取失败不阻断恢复 */ }
      // 恢复时按云端元数据把头像/壁纸也拉到本机（失败不阻断数据恢复）
      const assetNote = await pullPushAssets(new WebDavTransport(c), env.data)
      if (!restoreState(env.data)) throw new Error('云端数据无法识别')
      writeLS(LS_BASE, env.data)
      const info = { at: new Date().toISOString(), mode: 'cloud-restore', conflicts: 0, detail: [], error: null }
      writeLS(LS_LAST, info)
      setLast(info)
      toast('已从云端恢复' + assetNote + profileNote)
    } catch (e) {
      toast('恢复失败：' + e.message, 'err')
    } finally { setBusy('') }
  }

  const conflictText = last?.detail?.length
    ? last.detail.slice(0, 30).map((c) => {
      if (c.type === 'scalar') return `设置冲突：${c.path}（已保留${c.kept === 'local' ? '本机' : '云端'}值）`
      if (c.type === 'edit-vs-delete') return `${c.col} 中「${c.id}」一端删除一端修改，已保留修改后的版本`
      if (c.type === 'deleted') return `${c.col} 中「${c.id}」已按${c.side === 'local' ? '云端' : '本机'}的删除同步`
      if (c.dupId) return `${c.col} 中「${c.id}」两端修改不同，已保留冲突副本 ${c.dupId}`
      return `${c.col} · ${c.type}`
    }).join('\n')
    : ''

  return (
    <>
      <TopBar title="云备份" onBack={nav.pop} />
      <div className="page-body no-tab">
        <div className="group">
          <div className="gtitle">WebDAV 配置</div>
          <div className="cell" style={{ display: 'block' }}>
            <div className="ctitle" style={{ marginBottom: 6 }}>
              云端文件地址
              <button
                type="button"
                onClick={applyJianguo}
                style={{ float: 'right', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, border: '1px solid var(--line)', background: 'var(--card2)', color: 'var(--ink2)' }}
              >🌰 一键填入坚果云</button>
            </div>
            <input className="input" placeholder={JIANGUO_URL}
              value={url} onChange={(e) => setUrl(e.target.value)} autoCapitalize="off" />
            <div className="cdesc" style={{ marginTop: 6 }}>建议用坚果云等支持 WebDAV 的网盘；密码填应用专用密码，不是登录密码</div>
            {showJgyTip && (
              <div style={{ marginTop: 8, padding: '9px 11px', borderRadius: 10, background: 'var(--card2)', border: '1px solid var(--line)', fontSize: 12, lineHeight: 1.7, color: 'var(--ink2)' }}>
                坚果云应用密码获取：登录 <b>坚果云网页版</b> → 右上角账户 → <b>安全选项</b> → <b>第三方应用管理</b> → 添加应用（名称随意，如“轻语记账”），把生成的密码填入上方密码栏；账号填坚果云注册邮箱。
                {' '}<a href="https://help.jianguoyun.com/?p=2064" target="_blank" rel="noreferrer">查看官方教程 ↗</a>
              </div>
            )}
          </div>
          <div className="cell" style={{ display: 'block' }}>
            <div className="ctitle" style={{ marginBottom: 6 }}>账号</div>
            <input className="input" placeholder="WebDAV 账号（邮箱或用户名）"
              value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="off" />
          </div>
          <div className="cell" style={{ display: 'block' }}>
            <div className="ctitle" style={{ marginBottom: 6 }}>密码 / 应用专用密码</div>
            <input className="input" type="password" placeholder="仅保存在本设备，用于访问云端"
              value={password} onChange={(e) => setPassword(e.target)} />
          </div>
          <div className="cell">
            <div className="cico">🔌</div>
            <div className="cmain"><div className="ctitle">测试连接</div><div className="cdesc">验证地址、账号与密码是否可用</div></div>
            <div className="cright"><button className="btn ghost" disabled={!!busy} onClick={onTest}>
              {busy === 'test' ? '检测中…' : '测试'}
            </button></div>
          </div>
        </div>

        <div className="group">
          <div className="gtitle">同步</div>
          {/* v1.9.0 用户资料云存档：检测到昵称/头像变化自动打包上传，点击可手动立即存档 */}
          <div className="cell" onClick={busy ? undefined : onProfileSync}>
            <div className="cico">🪪</div>
            <div className="cmain">
              <div className="ctitle">用户资料云存档</div>
              <div className="cdesc">
                {lastProfile?.error
                  ? `最近存档失败：${lastProfile.error.message}`
                  : '检测到昵称/头像变化自动打包上传，点击立即存档'}
              </div>
            </div>
            <div className="cright">
              {busy === 'profile' ? (
                <button className="btn ghost" disabled>存档中…</button>
              ) : (
                <span className="muted">{lastProfile?.error ? '⚠ 失败' : (lastProfile?.at ? fmtTime(lastProfile.at) : '未存档')}</span>
              )}
            </div>
          </div>
          <div className="cell" onClick={busy ? undefined : onSync}>
            <div className="cico">☁️</div>
            <div className="cmain">
              <div className="ctitle">立即同步</div>
              <div className="cdesc">配置后账单变化会自动双向同步；也可在此手动同步</div>
            </div>
            <div className="cright"><button className="btn" disabled={!!busy}>
              {busy === 'sync' ? '同步中…' : '同步'}
            </button></div>
          </div>
          <div className="cell" onClick={() => setConfirmRestore(true)}>
            <div className="cico">📥</div>
            <div className="cmain">
              <div className="ctitle">从云端恢复</div>
              <div className="cdesc">换机/新设备：直接以云端数据为准覆盖本机</div>
            </div>
            <div className="cright"><button className="btn ghost" disabled={!!busy}>
              {busy === 'restore' ? '恢复中…' : '恢复'}
            </button></div>
          </div>
        </div>

        <div className="group">
          <div className="gtitle">状态</div>
          <div className="cell">
            <div className="cico">🕒</div>
            <div className="cmain">
              <div className="ctitle">最近同步</div>
              {last?.error && <div className="cdesc">最近一次失败：{last.error.message}</div>}
            </div>
            <div className="cright muted">{last?.error ? '⚠ 异常' : fmtTime(last?.at)}</div>
          </div>
          <div className="cell">
            <div className="cico">🆔</div>
            <div className="cmain"><div className="ctitle">本设备标识</div><div className="cdesc">冲突副本会用它命名</div></div>
            <div className="cright muted">{String(getDevice()).slice(0, 8)}</div>
          </div>
          {!!last?.conflicts && (
            <div className="cell" onClick={() => logRef.current?.showModal?.()}>
              <div className="cico">⚠️</div>
              <div className="cmain"><div className="ctitle">最近冲突</div>
                <div className="cdesc">{last.conflicts} 处（两端改动不一致时均已保留副本，可人工核对）</div></div>
              <div className="cright"><span className="arrow">›</span></div>
            </div>
          )}
          {conflictText && (
            <pre className="muted" ref={logRef}
              style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.6, padding: '4px 14px 14px', margin: 0 }}>
              {conflictText}
            </pre>
          )}
        </div>

        <div className="center-box muted" style={{ lineHeight: 1.7, padding: '6px 14px 20px' }}>
          同步采用「全量快照 + 逐行合并」：两台设备交替记账/编辑/删除后同步，数据自动对齐；
          同一笔两端改成不一样时，两份都会保留，其中一份标注为冲突副本。<br />
          浏览器内同步要求网盘允许跨域访问；桌面版无此限制。
        </div>
      </div>

      <Confirm
        open={confirmRestore}
        title="从云端恢复？"
        text="将用云端快照覆盖本机全部数据（账本、账单、账户、设置）。仅建议换机或新设备时使用；日常双端记账请用「立即同步」。"
        okText="覆盖并恢复"
        danger
        onOk={onRestore}
        onCancel={() => setConfirmRestore(false)}
      />
    </>
  )
}
