import React, { useState } from 'react'
import { useStore } from '../store.jsx'
import { TopBar, Seg } from '../ui.jsx'
import {
  loadAiCfg, saveAiCfg, AI_STYLES, testConnection, platformKind,
} from '../ai.js'

export default function AiSettings({ nav }) {
  const { state, set, toast } = useStore()
  const s = state.settings
  const [cfg, setCfg] = useState(() => loadAiCfg())
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const plat = platformKind()

  const persist = (patch) => {
    const next = { ...cfg, ...patch }
    setCfg(next)
    saveAiCfg(next)
  }

  const doTest = async () => {
    if (!cfg.key.trim()) { toast('请先填写 API Key', 'err'); return }
    setTesting(true)
    setTestResult(null)
    try {
      const r = await testConnection(cfg)
      setTestResult(r)
      toast(r.ok ? '连接正常' : '连接失败', r.ok ? 'ok' : 'err')
    } catch (e) {
      setTestResult({ ok: false, message: String(e?.message || e) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <TopBar title="AI 分析设置" onBack={nav.pop} />
      <div className="page-body no-tab">
        <div className="ai-hero">
          <div className="t">🤖 智谱大模型账单分析</div>
          <div className="d">
            由智谱 GLM 提供流式月度/年度账单解读。API Key 仅保存在本设备，不会随云备份上传。
          </div>
        </div>

        {/* 账号 */}
        <div className="group">
          <div className="gtitle">接口配置</div>
          <div style={{ padding: '12px 14px 4px' }}>
            <div className="field">
              <label>API Key</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="input" style={{ paddingRight: 56 }}
                  type={showKey ? 'text' : 'password'}
                  value={cfg.key}
                  placeholder="粘贴智谱 API Key（xxxxx.xxxxx）"
                  autoComplete="off"
                  onChange={(e) => persist({ key: e.target.value.trim() })}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    border: 'none', background: 'none', fontSize: 12, color: 'var(--brand)', cursor: 'pointer',
                  }}
                >{showKey ? '隐藏' : '显示'}</button>
              </div>
            </div>
            <div className="field">
              <label>模型</label>
              <input
                className="input" value={cfg.model} placeholder="glm-4.7-flash"
                onChange={(e) => persist({ model: e.target.value.trim() })}
              />
            </div>
            <div className="field">
              <label>Base URL（默认官方，用中转服务时才改）</label>
              <input
                className="input" value={cfg.baseUrl}
                onChange={(e) => persist({ baseUrl: e.target.value.trim() })}
              />
            </div>
            <button className="btn" disabled={testing} onClick={doTest}>
              {testing ? '测试中…' : '🔌 测试连接'}
            </button>
            {testResult && (
              <div className={testResult.ok ? '' : 'ai-warn'} style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.7, color: testResult.ok ? 'var(--green)' : undefined }}>
                {testResult.ok ? '✓ ' : '✕ '}{testResult.message}
              </div>
            )}
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.8, margin: '10px 0 4px' }}>
              Key 在「智谱开放平台 → API Keys」创建（open.bigmodel.cn），新用户有免费额度。
              {plat === 'browser' && ' 当前为浏览器环境，若直连被跨域拦截，请使用桌面版或 Android 版。'}
            </div>
          </div>
        </div>

        {/* 风格 */}
        <div className="group">
          <div className="gtitle">回复风格</div>
          <div style={{ padding: 14 }}>
            <Seg
              options={AI_STYLES.map((x) => ({ label: `${x.emoji} ${x.name}`, value: x.id }))}
              value={s.aiStyle}
              onChange={(v) => { set((d) => { d.settings.aiStyle = v }); toast('风格已切换') }}
            />
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.7, margin: '10px 0 4px' }}>
              {AI_STYLES.find((x) => x.id === s.aiStyle)?.prompt}
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label>自定义补充指令（可选）</label>
              <textarea
                className="input" maxLength={120} placeholder="例如：多用东北话 / 多关注咖啡开销 / 称呼我为老板"
                value={s.aiCustomStyle}
                onChange={(e) => set((d) => { d.settings.aiCustomStyle = e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* 隐私 */}
        <div className="group">
          <div className="gtitle">隐私</div>
          <div className="cell" onClick={() => set((d) => { d.settings.aiIncludeNotes = !d.settings.aiIncludeNotes })}>
            <div className="cico">📝</div>
            <div className="cmain">
              <div className="ctitle">分析时附带账单备注原文</div>
              <div className="cdesc">关闭后只上传金额与分类等统计数字</div>
            </div>
            <div className="cright">
              <button
                className={`switch ${s.aiIncludeNotes ? 'on' : ''}`}
                onClick={(e) => { e.stopPropagation(); set((d) => { d.settings.aiIncludeNotes = !d.settings.aiIncludeNotes }) }}
              />
            </div>
          </div>
          {s.aiIncludeNotes && (
            <div className="ai-warn" style={{ margin: 0, borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}>
              ⚠ 开启后，你的账单备注原文将随统计数据一起发送至智谱 AI 进行分析；请勿在备注中记录密码、证件号等敏感信息。
            </div>
          )}
        </div>

        <button className="btn ghost" onClick={() => nav.push({ page: 'ai', title: 'AI 账单分析' })}>
          去生成账单分析
        </button>
      </div>
    </>
  )
}
