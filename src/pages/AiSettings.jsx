import { Icon } from "../ui/icons.jsx"
import React, { useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { TopBar, Seg } from '../ui.jsx'
import {
  loadAiCfg, saveAiCfg, AI_STYLES, testConnection, platformKind,
} from '../ai.js'
import {
  STYLE_ATTRS, styleAttrsDesc, composeStylePrompt, generateStyleCard,
  getCachedCard, removeCachedCard, cachedCardNames,
} from '../stylecard.js'
import { styleKeyOf } from '../utils.js'

export default function AiSettings({ nav }) {
  const { state, set, toast } = useStore()
  const s = state.settings
  const [cfg, setCfg] = useState(() => loadAiCfg())
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const plat = platformKind()
  const mode = s.aiStyle === 'custom' ? 'custom' : s.aiStyle === 'char' ? 'char' : 'preset'

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
          <div className="t"><Icon name="robot" size="1em" className="qy-inline-icon" /> 智谱大模型账单分析</div>
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
              {testing ? '测试中…' : <><Icon name="plug" size="1em" className="qy-inline-icon" /> 测试连接</>}
            </button>
            {testResult && (
              <div className={testResult.ok ? '' : 'ai-warn'} style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.7, color: testResult.ok ? 'var(--green)' : undefined }}>
                {testResult.ok ? <><Icon name="check" size="1em" className="qy-inline-icon" /> </> : <><Icon name="close" size="1em" className="qy-inline-icon" /> </>}{testResult.message}
              </div>
            )}
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.8, margin: '10px 0 4px' }}>
              Key 在「智谱开放平台 → API Keys」创建（open.bigmodel.cn），新用户有免费额度。
              {plat === 'browser' && ' 当前为浏览器环境，若直连被跨域拦截，请使用桌面版或 Android 版。'}
            </div>
          </div>
        </div>

        {/* 风格 */}
        <StyleSection cfg={cfg} s={s} set={set} toast={toast} />

        {/* 隐私 */}
        <div className="group">
          <div className="gtitle">隐私</div>
          {/* v2.5 上传脱敏：手机号/身份证/银行卡等高敏数字串进模型前自动打码，默认开启 */}
          <div className="cell" onClick={() => set((d) => { d.settings.aiMask = d.settings.aiMask === false ? true : false })}>
            <div className="cico"><Icon name="shield" size="1em" className="qy-inline-icon" /></div>
            <div className="cmain">
              <div className="ctitle">上传前脱敏</div>
              <div className="cdesc">手机号/身份证/银行卡号自动打码后再发给 AI（金额不受影响）</div>
            </div>
            <div className="cright">
              <button
                className={`switch ${s.aiMask !== false ? 'on' : ''}`}
                onClick={(e) => { e.stopPropagation(); set((d) => { d.settings.aiMask = d.settings.aiMask === false ? true : false }) }}
              />
            </div>
          </div>
          <div className="cell" onClick={() => set((d) => { d.settings.aiIncludeNotes = !d.settings.aiIncludeNotes })}>
            <div className="cico"><Icon name="bill" size="1em" className="qy-inline-icon" /></div>
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
          {(s.aiIncludeNotes || s.aiMask === false) && (
            <div className="ai-warn" style={{ margin: 0, borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}>
              {s.aiIncludeNotes
                ? `⚠ 开启后，你的账单备注原文将随统计数据一起发送至智谱 AI 进行分析${s.aiMask !== false ? '（其中手机号/身份证/银行卡号会先自动打码）' : '；请勿在备注中记录密码、证件号等敏感信息'}。`
                : <><Icon name="warning" size="1em" className="qy-inline-icon" /> 已关闭脱敏：账单统计中的文本（备注除外）将原样发送给 AI。</>}
              截图识别（小票/支付页）为原图上传，无法自动脱敏，请注意截图内容。
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

/* ============ v1.8.0 回复风格：预设 / 自定义参数 / 角色扮演 ============ */
function StyleSection({ cfg, s, set, toast }) {
  const mode = s.aiStyle === 'custom' ? 'custom' : s.aiStyle === 'char' ? 'char' : 'preset'
  return (
    <div className="group">
      <div className="gtitle">回复风格</div>
      <div style={{ padding: 14 }}>
        <Seg
          options={[
            { label: <><Icon name="masks" size="1em" className="qy-inline-icon" /> 预设</>, value: 'preset' },
            { label: <><Icon name="sliders" size="1em" className="qy-inline-icon" /> 自定义</>, value: 'custom' },
            { label: <><Icon name="sparkles" size="1em" className="qy-inline-icon" /> 角色扮演</>, value: 'char' },
          ]}
          value={mode}
          onChange={(v) => {
            set((d) => {
              if (v === 'preset') d.settings.aiStyle = d.settings.aiStyle === 'custom' || d.settings.aiStyle === 'char'
                ? 'tender' : d.settings.aiStyle
              else d.settings.aiStyle = v
            })
          }}
        />

        {mode === 'preset' && (
          <div className="style-cards">
            {AI_STYLES.map((x) => (
              <button
                key={x.id} type="button"
                className={'style-card' + (s.aiStyle === x.id ? ' on' : '')}
                onClick={() => { set((d) => { d.settings.aiStyle = x.id }); toast(`已切换：${x.name}`) }}
              >
                <span className="stc-emoji">{x.emoji}</span>
                <span className="stc-name">{x.name}</span>
                <span className="stc-desc">{x.prompt}</span>
                {s.aiStyle === x.id && <span className="stc-check"><Icon name="check" size="1em" className="qy-inline-icon" /></span>}
              </button>
            ))}
          </div>
        )}

        {mode === 'custom' && <CustomStylePanel s={s} set={set} />}

        {mode === 'char' && <CharStylePanel cfg={cfg} s={s} set={set} toast={toast} />}

        <div className="field" style={{ marginTop: 14 }}>
          <label>补充指令（所有风格通用，可选）</label>
          <textarea
            className="input" maxLength={120} placeholder="例如：多用东北话 / 多关注咖啡开销 / 称呼我为老板"
            value={s.aiCustomStyle}
            onChange={(e) => set((d) => { d.settings.aiCustomStyle = e.target.value })}
          />
        </div>
      </div>
    </div>
  )
}

/* ---------- 自定义参数面板：四维选择 + 实时风格卡预览 ---------- */
function CustomStylePanel({ s, set }) {
  const attrs = s.aiStyleAttrs || {}
  const setAttr = (k, v) => set((d) => { d.settings.aiStyleAttrs = { ...d.settings.aiStyleAttrs, [k]: v } })
  const rows = [
    ['tone', '语气'], ['formality', '正式度'], ['length', '篇幅'], ['structure', '结构'],
  ]
  return (
    <div className="attrs-panel">
      {rows.map(([k, label]) => (
        <div className="attrs-row" key={k}>
          <div className="attrs-label">{label}</div>
          <Seg
            options={STYLE_ATTRS[k].map((x) => ({ label: x.label, value: x.id }))}
            value={attrs[k]}
            onChange={(v) => setAttr(k, v)}
          />
        </div>
      ))}
      {/* 实时风格卡预览：所选参数即时可见 */}
      <div className="sc-view sc-preview">
        <div className="sc-head">
          <span className="sc-ava"><Icon name="sliders" size="1em" className="qy-inline-icon" /></span>
          <div className="sc-tt">
            <b>自定义风格<em className="sc-using">预览</em></b>
            <i>{styleAttrsDesc(attrs)}</i>
          </div>
        </div>
        <div className="sc-tone">{composeStylePrompt(attrs)}</div>
      </div>
    </div>
  )
}

/* ---------- 角色扮演面板：两阶段生成（联网检索 → AI 合成）+ 缓存 ---------- */
function CharStylePanel({ cfg, s, set, toast }) {
  const [name, setName] = useState(s.aiStyle === 'char' ? s.aiCharName : '')
  const [phase, setPhase] = useState('') // '' | 'search' | 'generate'
  const [card, setCard] = useState(() => (s.aiStyle === 'char' ? getCachedCard(s.aiCharName) : null))
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const key = styleKeyOf(name)
  const using = s.aiStyle === 'char' && !!key && styleKeyOf(s.aiCharName) === key

  // 输入的名字已有缓存卡时，即时展示（无需生成）
  useEffect(() => {
    if (!key || phase) return
    const c = getCachedCard(name)
    if (c && styleKeyOf(c.name) !== styleKeyOf(card?.name || '')) {
      setCard(c)
      setNote('已命中本机缓存，直接可用')
      setErr('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, phase])

  const generate = async () => {
    if (!name.trim()) { toast('请先输入角色或人物名', 'err'); return }
    if (!cfg.key) { toast('请先在上方配置 API Key', 'err'); return }
    setErr(''); setCard(null); setNote('')
    setPhase('search')
    try {
      const r = await generateStyleCard(cfg, name, {
        onPhase: (p) => {
          if (p === 'search') setPhase('search')
          else if (p === 'generate') setPhase('generate')
        },
      })
      setPhase('')
      setCard(r.card)
      setNote(r.cached
        ? '已命中本机缓存，未重新检索'
        : (r.materialChars ? `阶段1 检索：维基百科「${r.wikiTitle}」${r.materialChars} 字资料` : '阶段1 未检索到维基资料，已用模型知识生成'))
    } catch (e) {
      setPhase('')
      setErr(e?.message || '生成失败，请重试')
    }
  }

  const apply = () => {
    if (!card) return
    set((d) => { d.settings.aiStyle = 'char'; d.settings.aiCharName = card.name })
    toast(`已应用「${card.name}」风格`)
  }
  const regen = async () => {
    if (!card) return
    removeCachedCard(card.name)
    setName(card.name)
    await generate()
  }
  const del = () => {
    if (!card) return
    removeCachedCard(card.name)
    if (using) set((d) => { d.settings.aiStyle = 'tender'; d.settings.aiCharName = '' })
    setCard(null); setNote('')
    toast('已删除该风格卡缓存')
  }

  const cachedNames = cachedCardNames()
  return (
    <div className="char-panel">
      <div className="char-input-row">
        <input
          className="input" placeholder="输入角色或人物名，如：芙宁娜"
          value={name} maxLength={24}
          onChange={(e) => { setName(e.target.value); setNote(''); setErr('') }}
        />
        <button className="btn char-gen-btn" disabled={!!phase || !name.trim()} onClick={generate}>
          {phase === 'search' ? '检索中…' : phase === 'generate' ? '生成中…' : <><Icon name="sparkles" size="1em" className="qy-inline-icon" /> 生成风格卡</>}
        </button>
      </div>
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.7, margin: '8px 0 2px' }}>
        两阶段生成：先联网检索维基百科资料，再由 AI 合成风格卡；同名角色只生成一次，之后直接用缓存。
      </div>

      {phase && (
        <div className="char-progress">
          <span className="char-spin" />
          <div className="cp-steps">
            <i className={phase === 'search' ? 'on' : 'done'}>① 联网检索角色资料</i>
            <i className={phase === 'generate' ? 'on' : ''}>② AI 合成风格卡</i>
          </div>
        </div>
      )}

      {err && <div className="ai-warn" style={{ marginTop: 10 }}><Icon name="close" size="1em" className="qy-inline-icon" /> {err}</div>}

      {card && <StyleCardView card={card} using={using} note={note} onApply={apply} onRegen={regen} onDelete={del} />}

      {cachedNames.length > 0 && !card && !phase && (
        <div className="char-cached">
          <label>本机已缓存</label>
          <div className="sc-chips">
            {cachedNames.map((n) => (
              <button key={n} type="button" onClick={() => { setName(n); setNote('') }}>{n}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- 风格卡视觉组件（角色卡与自定义预览共用） ---------- */
export function StyleCardView({ card, using, note, onApply, onRegen, onDelete }) {
  return (
    <div className="sc-view">
      <div className="sc-head">
        <span className="sc-ava">{card.emoji || <><Icon name="masks" size="1em" className="qy-inline-icon" /></>}</span>
        <div className="sc-tt">
          <b>{card.name}{using && <em className="sc-using">使用中</em>}</b>
          <i>{card.title}{card.source ? ` · ${card.source}` : ''}</i>
        </div>
      </div>
      {card.traits?.length > 0 && (
        <div className="sc-sec"><label>性格特质</label>
          <div className="sc-chips">{card.traits.map((t, i) => <span key={i}>{t}</span>)}</div>
        </div>
      )}
      {card.speech?.length > 0 && (
        <div className="sc-sec"><label>语言习惯</label>
          {card.speech.map((t, i) => <div className="sc-line" key={i}>「{t}」</div>)}
        </div>
      )}
      {card.vocab?.length > 0 && (
        <div className="sc-sec"><label>口头禅</label>
          <div className="sc-chips">{card.vocab.map((t, i) => <span key={i}>{t}</span>)}</div>
        </div>
      )}
      {card.tone && <div className="sc-sec"><label>语气规范</label><div className="sc-line">{card.tone}</div></div>}
      {card.usage && <div className="sc-sec"><label>适用场景</label><div className="sc-line">{card.usage}</div></div>}
      <div className="sc-sec"><label>风格指令（拼入系统提示词）</label><div className="sc-prompt">{card.prompt}</div></div>
      {note && <div className="sc-note"><Icon name="bolt" size="1em" className="qy-inline-icon" /> {note}</div>}
      {onApply && (
        <div className="sc-acts">
          <button className="btn" disabled={using} onClick={onApply}>{using ? '当前使用中' : '应用此风格'}</button>
          <button className="btn ghost" onClick={onRegen}>重新生成</button>
          <button className="sc-del" onClick={onDelete}>删除缓存</button>
        </div>
      )}
    </div>
  )
}
