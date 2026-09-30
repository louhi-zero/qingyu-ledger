import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { useNav } from '../App.jsx'
import { TopBar, Seg, Empty } from '../ui.jsx'
import { AiFace } from '../theme.jsx'
import {
  loadAiCfg, streamNarrative, fetchStructured, humanizeError,
} from '../ai.js'
import {
  currentPeriod, periodAdd, periodLabel, todayStr, pad2,
} from '../utils.js'

export default function AiInsight({ params = {} }) {
  const { state, set, toast } = useStore()
  const nav = useNav()
  const sd = state.settings.monthStartDay || 1
  const [kind, setKind] = useState(params.kind === 'year' ? 'year' : 'month')
  const [pKey, setPKey] = useState(params.period || currentPeriod(sd))
  const [yKey, setYKey] = useState(Number((params.period || todayStr()).slice(0, 4)))
  const key = kind === 'year' ? String(yKey) : pKey
  const label = kind === 'year' ? `${yKey}年度` : periodLabel(pKey)

  const cached = state.aiReports?.[key] || null
  const [narrative, setNarrative] = useState('')
  const [struct, setStruct] = useState(null)
  const [status, setStatus] = useState('idle') // idle | streaming | struct | done | error
  const [err, setErr] = useState('')
  const abortRef = useRef(null)
  const hasKey = !!loadAiCfg().key

  // 切周期：载入该周期缓存
  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    if (cached) {
      setNarrative(cached.narrative || '')
      setStruct(cached.struct || null)
      setStatus('done')
      setErr('')
    } else {
      setNarrative('')
      setStruct(null)
      setStatus('idle')
      setErr('')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, kind])

  const shift = (delta) => {
    if (kind === 'year') setYKey((y) => y + delta)
    else setPKey((p) => periodAdd(p, delta, sd))
  }

  const saveReport = (patch) => {
    const cfg = loadAiCfg()
    set((d) => {
      d.aiReports[key] = {
        at: new Date().toISOString(), kind, key, label,
        narrative: '', struct: null, model: cfg.model,
        ...d.aiReports[key],
        ...patch,
      }
    })
  }

  const generate = async () => {
    const cfg = loadAiCfg()
    if (!cfg.key) {
      toast('请先配置智谱 API Key', 'err')
      nav.push({ page: 'aiSettings', title: 'AI 分析设置' })
      return
    }
    const ac = new AbortController()
    abortRef.current = ac
    const scope = { kind, key }
    setStatus('streaming')
    setErr('')
    setNarrative('')
    setStruct(null)
    try {
      const text = await streamNarrative(cfg, state, scope, {
        signal: ac.signal,
        onDelta: (d) => setNarrative((v) => v + d),
      })
      saveReport({ at: new Date().toISOString(), narrative: text, struct: null })
      if (ac.signal.aborted) return
      setStatus('struct')
      try {
        const st = await fetchStructured(cfg, state, scope, { signal: ac.signal })
        if (ac.signal.aborted) return
        setStruct(st)
        if (st) saveReport({ at: new Date().toISOString(), narrative: text, struct: st })
      } catch (e) {
        if (e?.name === 'AbortError') return
        // 结构化失败不影响叙述展示
      }
      setStatus('done')
      toast('分析完成')
    } catch (e) {
      if (e?.name === 'AbortError') { setStatus(cached ? 'done' : 'idle'); return }
      setErr(humanizeError(e))
      setStatus('error')
    } finally {
      abortRef.current = null
    }
  }

  const cancel = () => { abortRef.current?.abort() }

  const busy = status === 'streaming' || status === 'struct'
  const atText = useMemo(() => {
    const at = cached?.at
    if (!at) return ''
    return at.slice(0, 16).replace('T', ' ')
  }, [cached])

  return (
    <>
      <TopBar
        title="AI 账单分析"
        onBack={nav.pop}
        right={
          <button className="iconbtn" onClick={() => nav.push({ page: 'aiSettings', title: 'AI 分析设置' })}>⚙️</button>
        }
      />
      <div className="page-body no-tab">
        {/* 周期选择 */}
        <Seg
          options={[{ label: '月度', value: 'month' }, { label: '年度', value: 'year' }]}
          value={kind}
          onChange={setKind}
          style={{ marginBottom: 10 }}
        />
        <div className="ymnav">
          <button onClick={() => shift(-1)}>‹</button>
          <div className="ym">{label}</div>
          <button onClick={() => shift(1)}>›</button>
        </div>

        {!hasKey && status === 'idle' && (
          <div className="card">
            <Empty icon="🔑" text="还没有配置智谱 API Key">
              <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.8, marginBottom: 10 }}>
                Key 只存在本机，新用户可在智谱开放平台领取免费额度。
              </div>
              <button className="btn" onClick={() => nav.push({ page: 'aiSettings', title: 'AI 分析设置' })}>去配置</button>
            </Empty>
          </div>
        )}

        {hasKey && status === 'idle' && !cached && (
          <div className="card">
            <Empty icon={<AiFace style={{ fontSize: 44 }} />} text={`让 AI 为你解读${label}的收支表现`}>
              <button className="btn" onClick={generate}>✨ 生成{label}分析</button>
              {state.settings.aiIncludeNotes && (
                <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
                  将上传本周期统计数据与账单备注原文，可在设置中关闭
                </div>
              )}
            </Empty>
          </div>
        )}

        {err && (
          <div className="card">
            <div className="ai-warn">✕ {err}</div>
            <button className="btn" onClick={generate}>重试</button>
          </div>
        )}

        {busy && (
          <div className="card">
            <div className="ai-dotrow" style={{ marginBottom: 10 }}>
              <span className="ai-pulse" />
              {status === 'streaming' ? 'AI 正在分析账单，逐字生成中…' : '正在整理结构化点评…'}
            </div>
            {narrative && (
              <div className="ai-report typing">{narrative}</div>
            )}
            <button className="btn ghost" style={{ marginTop: 12 }} onClick={cancel}>取消生成</button>
          </div>
        )}

        {!busy && (status === 'done' || cached) && narrative && (
          <>
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div className="card-title">📝 {label}解读</div>
                <button className="chip" onClick={generate}>🔄 重新生成</button>
              </div>
              <div className="ai-report">{narrative}</div>
              {atText && <div className="muted" style={{ marginTop: 10 }}>生成于 {atText}{cached?.model ? ` · ${cached.model}` : ''}</div>}
            </div>

            {struct && <StructCard struct={struct} />}
          </>
        )}

        {!busy && cached && !narrative && (
          <div className="card">
            <Empty icon="📭" text="这份报告内容已丢失，重新生成一份吧">
              <button className="btn" onClick={generate}>重新生成</button>
            </Empty>
          </div>
        )}
      </div>
    </>
  )
}

function StructCard({ struct }) {
  const hasAny = struct.title || struct.highlights?.length || struct.anomalies?.length
    || struct.prediction || struct.tips?.length
  if (!hasAny) return null
  return (
    <div className="card">
      {struct.title && (
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 10 }}>{struct.title}</div>
      )}
      {struct.highlights?.length > 0 && (
        <>
          <h4 className="ai-struct-title" style={{ fontSize: 14, margin: '6px 0 8px' }}>✨ 亮点</h4>
          {struct.highlights.map((t, i) => <div className="ai-hl" key={i}><span>🌟</span><span>{t}</span></div>)}
        </>
      )}
      {struct.anomalies?.length > 0 && (
        <>
          <h4 style={{ fontSize: 14, margin: '14px 0 8px' }}>⚠️ 值得注意</h4>
          {struct.anomalies.map((a, i) => (
            <div className="ai-anom" key={i}>
              <span>🔎</span>
              <span><b>{a.target}</b>{a.target ? '：' : ''}{a.text}</span>
            </div>
          ))}
        </>
      )}
      {struct.prediction && (
        <>
          <h4 style={{ fontSize: 14, margin: '14px 0 8px' }}>📈 走势预测</h4>
          <div className="ai-pred">{struct.prediction}</div>
        </>
      )}
      {struct.tips?.length > 0 && (
        <>
          <h4 style={{ fontSize: 14, margin: '14px 0 8px' }}>💡 行动建议</h4>
          {struct.tips.map((t, i) => <div className="ai-tip" key={i}><span>✅</span><span>{t}</span></div>)}
        </>
      )}
    </div>
  )
}
