/* 轻语记账 v1.1 AI 账单分析（智谱 GLM）
 *
 * 平台选路（postSSE/postText）：
 *   1. Electron 桌面：window.qyHttp.requestStream（主进程 https 白名单转发，天然无 CORS）
 *   2. Capacitor APK：启用 CapacitorHttp 后全局 fetch 已被原生替换，直接 fetch
 *   3. 浏览器：直连 fetch（智谱若拦截 CORS，会给出使用桌面版/APK 的中文引导）
 *
 * 隐私：API Key/模型/BaseURL 仅存本机 localStorage（qingyu_ai_cfg_v1），
 * 不进入云备份快照；备注是否上传由 settings.aiIncludeNotes 控制。
 * 金额口径：只读取 utils 已 round2 的数值用于展示，AI 不参与任何金额计算。
 */
import {
  round2, sumBy, statByCategory, catInfo, findCat, accountById,
  txsOfLedger, txsInRange, txsOfPeriod, periodBounds, periodAdd, periodLabel,
  yearBounds, addDays, parseD, todayStr, pad2, parseTxTextLocal, guessCategoryId,
} from './utils.js'

// ---------- 本机配置（不云同步） ----------
export const AI_CFG_KEY = 'qingyu_ai_cfg_v1'
export const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
export const DEFAULT_MODEL = 'glm-4.7-flash'

export function defaultAiCfg() {
  return { key: '', model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }
}
export function loadAiCfg() {
  try {
    const raw = localStorage.getItem(AI_CFG_KEY)
    if (!raw) return defaultAiCfg()
    const c = JSON.parse(raw)
    return {
      key: typeof c.key === 'string' ? c.key : '',
      model: c.model || DEFAULT_MODEL,
      baseUrl: c.baseUrl || DEFAULT_BASE_URL,
    }
  } catch {
    return defaultAiCfg()
  }
}
export function saveAiCfg(cfg) {
  localStorage.setItem(AI_CFG_KEY, JSON.stringify({
    key: cfg.key || '',
    model: cfg.model || DEFAULT_MODEL,
    baseUrl: (cfg.baseUrl || DEFAULT_BASE_URL).trim(),
  }))
}

// ---------- 回复风格 ----------
export const AI_STYLES = [
  {
    id: 'tender', name: '温柔鼓励', emoji: '🌷',
    prompt: '语气像温柔贴心的好朋友，多用鼓励与共情，先肯定做得好的地方，再委婉提醒，绝不指责。',
  },
  {
    id: 'sharp', name: '犀利毒舌', emoji: '🌶️',
    prompt: '语气犀利幽默、一针见血，可以适度吐槽和玩梗，像损友一样点醒用户，但结尾必须给出建设性的话，不做人身攻击。',
  },
  {
    id: 'pro', name: '专业财务师', emoji: '💼',
    prompt: '语气专业克制、条理清晰，像持证财务顾问，关注结构、比率、趋势与风险，用数据说话，少用感叹号，不用 emoji。',
  },
  {
    id: 'cute', name: '俏皮可爱', emoji: '🍭',
    prompt: '语气俏皮可爱、元气满满，多用 emoji 和短句，像二次元小管家，把财务建议讲得轻松好玩。',
  },
]
export function styleOf(id) {
  return AI_STYLES.find((s) => s.id === id) || AI_STYLES[0]
}

const SYS_BASE = [
  '你是「轻语记账」App 内置的个人财务分析助手。你将收到用户某一记账周期的账单统计 JSON（金额单位：元）。',
  '要求：',
  '1) 所有结论必须基于给出的数据，不许编造交易、金额或比率；数据不足时直接说明；',
  '2) 使用简体中文，口语化，有温度，不罗列 JSON 字段；',
  '3) 不提供证券投资、税务、法律等专业建议，不讨论政治与敏感话题；',
  '4) 称呼用户为「你」，不要输出免责声明。',
].join('\n')

const NARR_TASK_MONTH = '请输出本期账单的风格化解读：先用一句话定调，然后讲支出结构、最突出的分类或单日、与上一周期的变化、预算执行（若有）、做得好的地方与改进建议，最后用一句话鼓励。350字左右，分成2-4个小段，可以适度使用与你的风格相符的 emoji。'
const NARR_TASK_YEAR = '请输出年度账单的风格化解读：全年收支总览、支出最高/最低的月份、消费结构与习惯变化、年度结余表现、对下一年的具体建议。450字左右，分成3-5个小段。'

export const STRUCT_PROMPT = [
  '请再基于以上数据输出结构化点评。严格只输出一个 JSON 对象，不要 markdown 代码块，不要任何多余文字。格式：',
  '{"title":"不超过16字的本期一句话标题","highlights":["3条以内值得肯定的亮点"],"anomalies":[{"target":"异常对象，填分类名/日期/账户","text":"异常说明"}],"prediction":"对本期结束时支出或结余的预测，一句话","tips":["2到4条具体、可执行的建议"]}',
  '没有把握的字段给空数组或空字符串。',
].join('\n')

// ---------- 平台 ----------
export function platformKind() {
  // __qyForceWeb：冒烟测试钩子，强制走浏览器 fetch 路径便于 mock（同类先例 __qyUpdateBridge）
  if (typeof window !== 'undefined' && window.__qyForceWeb) return 'browser'
  if (typeof window !== 'undefined' && window.qyHttp && window.qyHttp.requestStream) return 'electron'
  if (typeof window !== 'undefined' && window.Capacitor) return 'capacitor'
  return 'browser'
}

function endpoint(cfg, path) {
  return (cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '') + path
}
function authHeaders(cfg) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.key}`,
  }
}

// 逐块 POST：onChunk(rawText) 多次回调，resolve { status, ok, text }
async function postSSE(cfg, body, { signal } = {}, onChunk) {
  const url = endpoint(cfg, '/chat/completions')
  const chunks = []
  if (platformKind() === 'electron') {
    const r = await window.qyHttp.requestStream(
      { url, method: 'POST', headers: authHeaders(cfg), body },
      (t) => { chunks.push(t); onChunk(t) },
    )
    return { status: r.status, ok: r.ok, text: chunks.join('') }
  }
  const res = await fetch(url, {
    method: 'POST', headers: authHeaders(cfg), body, signal,
  })
  let text = ''
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const t = dec.decode(value, { stream: true })
      text += t
      onChunk(t)
    }
  } else {
    text = await res.text()
    onChunk(text)
  }
  return { status: res.status, ok: res.ok, text }
}

// 一次性 POST（结构化 JSON 调用、风格卡生成共用；非流式响应也可复用 SSE 通道）
export async function postText(cfg, body, { signal } = {}) {
  const url = endpoint(cfg, '/chat/completions')
  if (platformKind() === 'electron') {
    const parts = []
    const r = await window.qyHttp.requestStream(
      { url, method: 'POST', headers: authHeaders(cfg), body },
      (t) => parts.push(t),
    )
    return { status: r.status, ok: r.ok, text: parts.join('') }
  }
  const res = await fetch(url, { method: 'POST', headers: authHeaders(cfg), body, signal })
  return { status: res.status, ok: res.ok, text: await res.text() }
}

// ---------- SSE 解析（纯函数，便于单测） ----------
export function parseSSEChunks(buffer, text) {
  const merged = buffer + text
  const blocks = merged.split(/\r?\n\r?\n/)
  const rest = blocks.pop() || ''
  const deltas = []
  for (const block of blocks) {
    for (const line of block.split(/\r?\n/)) {
      const t = line.trimStart()
      if (!t.startsWith('data:')) continue
      const data = t.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        const json = JSON.parse(data)
        const d = json.choices?.[0]?.delta?.content
        if (typeof d === 'string' && d) deltas.push(d)
      } catch { /* 不完整/心跳/非 JSON，忽略 */ }
    }
  }
  return { buffer: rest, deltas }
}

// 从模型回复中提取 JSON 对象（容忍 ```json 包裹与前后缀文字）
export function extractJson(content) {
  if (!content || typeof content !== 'string') return null
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(content.slice(start, end + 1))
    if (obj && typeof obj === 'object') return normalizeStruct(obj)
  } catch { /* fallthrough */ }
  return null
}
function asStrArray(v, limit) {
  if (!Array.isArray(v)) return []
  return v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).slice(0, limit)
}
function normalizeStruct(o) {
  return {
    title: typeof o.title === 'string' ? o.title.slice(0, 40) : '',
    highlights: asStrArray(o.highlights, 3),
    anomalies: Array.isArray(o.anomalies)
      ? o.anomalies
        .filter((x) => x && typeof x === 'object')
        .map((x) => ({ target: String(x.target || '').slice(0, 20), text: String(x.text || '').slice(0, 120) }))
        .filter((x) => x.text)
        .slice(0, 4)
      : [],
    prediction: typeof o.prediction === 'string' ? o.prediction.slice(0, 160) : '',
    tips: asStrArray(o.tips, 4),
  }
}

// ---------- 错误 ----------
export class AiHttpError extends Error {
  constructor(status, text) {
    super(`AI request failed: ${status}`)
    this.status = status
    this.text = text
  }
}
export function humanizeError(e) {
  if (e instanceof AiHttpError) {
    if (e.status === 401) return 'API Key 无效或已过期，请检查后重试'
    if (e.status === 402 || e.status === 403) return '智谱账户权限不足或余额已用完，请检查账户状态'
    if (e.status === 429) return '请求过于频繁或免费额度已用尽，请稍后再试'
    if (e.status >= 500) return '智谱服务暂时不可用，请稍后重试'
    return `请求失败（HTTP ${e.status}），请检查网络与模型设置`
  }
  if (e && e.name === 'AbortError') return '已取消生成'
  // TypeError: Failed to fetch（浏览器 CORS / 断网）
  return '无法连接智谱服务：浏览器可能拦截了跨域请求。请改用桌面版或 Android 版（原生网络通道不受此限制），或检查网络后重试'
}

// ---------- 统计载荷 ----------
function mergedCatStats(txs, type, state) {
  // statByCategory 以记账时的 categoryId 分组（子类各自成组），这里按一级类名合并
  const map = new Map()
  for (const g of statByCategory(txs, type, state)) {
    const cur = map.get(g.name)
    if (cur) {
      cur.value = round2(cur.value + g.value)
      cur.count += g.count
    } else {
      map.set(g.name, { name: g.name, icon: g.icon, value: g.value, count: g.count })
    }
  }
  return [...map.values()].sort((a, b) => b.value - a.value)
}
function withPct(list, total) {
  return list.map((g) => ({ ...g, pct: total > 0 ? Math.round((g.value / total) * 1000) / 10 : 0 }))
}
function budgetInfo(state, expenseTotal, expTx) {
  const total = Number(state.budgets?.total || 0)
  if (total <= 0) return { total: 0, usedPct: null }
  const cats = state.categories?.expense || []
  const byCat = []
  for (const [cid, amt] of Object.entries(state.budgets?.byCategory || {})) {
    if (!amt) continue
    const spent = round2(expTx
      .filter((t) => {
        const f = findCat(cats, t.categoryId)
        return f && f.cat.id === cid
      })
      .reduce((a, t) => a + Number(t.amount), 0))
    const name = cats.find((c) => c.id === cid)?.name || '分类'
    byCat.push({ category: name, budget: amt, used: spent, usedPct: Math.round((spent / amt) * 1000) / 10 })
  }
  byCat.sort((a, b) => b.usedPct - a.usedPct)
  return { total, used: expenseTotal, usedPct: Math.round((expenseTotal / total) * 1000) / 10, byCategory: byCat.slice(0, 5) }
}
function accountsExpense(expTx, state) {
  const map = new Map()
  for (const t of expTx) {
    const name = accountById(state, t.accountId)?.name || '未指定账户'
    map.set(name, round2((map.get(name) || 0) + Number(t.amount)))
  }
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6)
}
function collectNotes(txs, state) {
  const byMain = new Map()
  for (const t of txs) {
    const note = (t.note || '').trim()
    if (t.type !== 'expense' || !note) continue
    const main = catInfo(state, t).main
    if (!byMain.has(main)) byMain.set(main, [])
    const arr = byMain.get(main)
    if (arr.length < 2) arr.push(note.slice(0, 20))
  }
  return [...byMain.entries()].slice(0, 8).map(([category, samples]) => ({ category, samples }))
}

function buildMonth(state, key, sd, ledgerName, includeNotes) {
  const [start, end] = periodBounds(key, sd)
  const txs = txsInRange(txsOfLedger(state), start, end)
  const expTx = txs.filter((t) => t.type === 'expense')
  const incTx = txs.filter((t) => t.type === 'income')
  const expense = round2(expTx.reduce((a, t) => a + Number(t.amount), 0))
  const income = round2(incTx.reduce((a, t) => a + Number(t.amount), 0))
  const prevKey = periodAdd(key, -1, sd)
  const prevTxs = txsOfPeriod(state, prevKey)
  const prevExpense = round2(sumBy(prevTxs, 'expense'))
  const prevIncome = round2(sumBy(prevTxs, 'income'))
  const daysTotal = Math.max(1, Math.round((parseD(end) - parseD(start)) / 86400000))
  const today = todayStr()
  const elapsed = today >= end ? daysTotal : today < start ? 0
    : Math.min(daysTotal, Math.round((parseD(today) - parseD(start)) / 86400000) + 1)
  const byDay = new Map()
  for (const t of expTx) byDay.set(t.date, round2((byDay.get(t.date) || 0) + Number(t.amount)))
  const daily = []
  for (let i = 0; i < daysTotal; i++) {
    const ds = addDays(start, i)
    if (ds > today) break
    daily.push({ date: ds.slice(5), expense: byDay.get(ds) || 0 })
  }
  return {
    scope: { kind: 'month', key, label: periodLabel(key), ledgerName, monthStartDay: sd },
    range: { start, end, daysElapsed: elapsed, daysTotal, inProgress: today >= start && today < end },
    summary: {
      expense, income, balance: round2(income - expense),
      txCount: txs.length, expenseCount: expTx.length,
      avgDailyExpense: elapsed > 0 ? round2(expense / elapsed) : 0,
      savingRate: income > 0 ? Math.round(((income - expense) / income) * 1000) / 10 : null,
    },
    compare: {
      prevLabel: periodLabel(prevKey), prevExpense, prevIncome,
      expenseMomPct: prevExpense > 0 ? Math.round(((expense - prevExpense) / prevExpense) * 1000) / 10 : null,
      incomeMomPct: prevIncome > 0 ? Math.round(((income - prevIncome) / prevIncome) * 1000) / 10 : null,
    },
    topExpenseCategories: withPct(mergedCatStats(expTx, 'expense', state).slice(0, 8), expense),
    topIncomeCategories: mergedCatStats(incTx, 'income', state).slice(0, 5),
    budget: budgetInfo(state, expense, expTx),
    accountsExpense: accountsExpense(expTx, state),
    dailyExpense: daily,
    notes: includeNotes ? collectNotes(txs, state) : [],
  }
}

function buildYear(state, year, sd, ledgerName, includeNotes) {
  const [start, end] = yearBounds(year, sd)
  const txs = txsInRange(txsOfLedger(state), start, end)
  const expTx = txs.filter((t) => t.type === 'expense')
  const incTx = txs.filter((t) => t.type === 'income')
  const expense = round2(expTx.reduce((a, t) => a + Number(t.amount), 0))
  const income = round2(incTx.reduce((a, t) => a + Number(t.amount), 0))
  const byMonth = new Map()
  for (const t of txs) {
    const m = Number(t.date.slice(5, 7))
    const cur = byMonth.get(m) || { month: m, expense: 0, income: 0, count: 0 }
    if (t.type === 'expense') cur.expense = round2(cur.expense + Number(t.amount))
    else if (t.type === 'income') cur.income = round2(cur.income + Number(t.amount))
    cur.count++
    byMonth.set(m, cur)
  }
  const months = Array.from({ length: 12 }, (_, i) => byMonth.get(i + 1) || { month: i + 1, expense: 0, income: 0, count: 0 })
  const [ps, pe] = yearBounds(String(Number(year) - 1), sd)
  const prevTxs = txsInRange(txsOfLedger(state), ps, pe)
  const prevExpense = round2(prevTxs.filter((t) => t.type === 'expense').reduce((a, t) => a + Number(t.amount), 0))
  const prevIncome = round2(prevTxs.filter((t) => t.type === 'income').reduce((a, t) => a + Number(t.amount), 0))
  const peak = months.slice().sort((a, b) => b.expense - a.expense)[0]
  const low = months.filter((m) => m.expense > 0).sort((a, b) => a.expense - b.expense)[0] || null
  return {
    scope: { kind: 'year', key: year, label: `${year}年度`, ledgerName, monthStartDay: sd },
    range: { start, end },
    summary: {
      expense, income, balance: round2(income - expense),
      txCount: txs.length, expenseCount: expTx.length,
      monthlyAvgExpense: round2(expense / 12),
      savingRate: income > 0 ? Math.round(((income - expense) / income) * 1000) / 10 : null,
    },
    compare: {
      prevLabel: `${Number(year) - 1}年度`, prevExpense, prevIncome,
      expenseYoyPct: prevExpense > 0 ? Math.round(((expense - prevExpense) / prevExpense) * 1000) / 10 : null,
      incomeYoyPct: prevIncome > 0 ? Math.round(((income - prevIncome) / prevIncome) * 1000) / 10 : null,
    },
    months,
    peakMonth: peak && peak.expense > 0 ? { month: peak.month, expense: peak.expense } : null,
    lowMonth: low ? { month: low.month, expense: low.expense } : null,
    topExpenseCategories: withPct(mergedCatStats(expTx, 'expense', state).slice(0, 8), expense),
    topIncomeCategories: mergedCatStats(incTx, 'income', state).slice(0, 5),
    accountsExpense: accountsExpense(expTx, state),
    notes: includeNotes ? collectNotes(txs, state) : [],
  }
}

export function buildStatsPayload(state, scope, includeNotes = true) {
  const sd = state.settings.monthStartDay || 1
  const ledgerName = state.ledgers.find((l) => l.id === state.currentLedgerId)?.name || '默认账本'
  return scope.kind === 'year'
    ? buildYear(state, scope.key, sd, ledgerName, includeNotes)
    : buildMonth(state, scope.key, sd, ledgerName, includeNotes)
}

// ---------- Prompt 组装 ----------
// v1.8.0 当前生效风格提示词：preset 四预设 | custom 参数组合 | char 角色风格卡（读本机缓存）
// 注意：这里内联读角色卡缓存（不 import stylecard.js），避免 ai.js ↔ stylecard.js 循环依赖
function activeStylePrompt(settings) {
  const mode = settings.aiStyle
  if (mode === 'custom') {
    // 自定义参数组合提示词（与 stylecard.js composeStylePrompt 同规则，但 ai.js 不依赖它）
    return composeAttrsPrompt(settings.aiStyleAttrs)
  }
  if (mode === 'char') {
    try {
      const all = JSON.parse(localStorage.getItem('qingyu_style_cards_v1') || '{}')
      const key = String(settings.aiCharName || '').trim().toLowerCase().replace(/[\s·・.。,，'’"“”-]/g, '')
      const card = all[key]
      if (card && typeof card.prompt === 'string' && card.prompt.length >= 40) {
        return `${card.prompt}\n保持角色口吻的同时，仍须遵守上述财务助手的所有规则与数据边界。`
      }
    } catch { /* 缓存损坏 → 回落预设 */ }
    return styleOf('tender').prompt // 角色卡缓存丢失时的优雅回落
  }
  return styleOf(mode).prompt
}
// 自定义参数 → 提示词（本地组合，不走 AI；与 STYLE_ATTRS 表保持同步）
const ATTRS_TABLE = {
  tone: { gentle: '语气温柔友善、有共情感', humor: '语气轻松幽默、可以适度玩梗调侃', sharp: '语气犀利直接、一针见血', calm: '语气沉稳克制、像可靠的顾问', energetic: '语气元气满满、多用 emoji 和短句' },
  formality: { casual: '用大白话，像朋友聊天', balanced: '口语为主、必要时用专业词并解释', formal: '措辞正式规范、像书面报告' },
  length: { short: '篇幅精简，只讲最重要的结论', std: '篇幅适中，结论与建议并重', detail: '篇幅详尽，展开讲清来龙去脉' },
  structure: { para: '分成几个自然小段', list: '多用要点列表，一条一个信息', mix: '先小段定调，再用要点列建议' },
}
function composeAttrsPrompt(attrs) {
  const a = attrs && typeof attrs === 'object' ? attrs : {}
  const pick = (k) => ATTRS_TABLE[k][a[k]] || ATTRS_TABLE[k][Object.keys(ATTRS_TABLE[k])[0]]
  return `请按以下回复风格输出：${pick('tone')}；${pick('formality')}；${pick('length')}；${pick('structure')}。`
}

export function buildMessages(state, scope) {
  const custom = (state.settings.aiCustomStyle || '').trim()
  const payload = buildStatsPayload(state, scope, state.settings.aiIncludeNotes !== false)
  const system = [SYS_BASE, activeStylePrompt(state.settings), custom ? `额外风格要求：${custom}` : '']
    .filter(Boolean).join('\n')
  const task = scope.kind === 'year' ? NARR_TASK_YEAR : NARR_TASK_MONTH
  const user = `以下是「${payload.scope.ledgerName}」${payload.scope.label}的账单统计（单位：元）：\n`
    + `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n\n${task}`
  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    payload,
  }
}

// ---------- 对外调用 ----------
// 风格化叙述（流式）。onDelta(增量文本)；返回完整文本
export async function streamNarrative(cfg, state, scope, { onDelta, signal } = {}) {
  const { messages } = buildMessages(state, scope)
  const body = JSON.stringify({ model: cfg.model, messages, stream: true, temperature: 0.8 })
  let buf = ''
  let full = ''
  const r = await postSSE(cfg, body, { signal }, (chunk) => {
    const out = parseSSEChunks(buf, chunk)
    buf = out.buffer
    for (const d of out.deltas) {
      full += d
      try { onDelta?.(d) } catch { /* 回调异常不中断 */ }
    }
  })
  if (!r.ok) throw new AiHttpError(r.status, r.text)
  return full
}

// 结构化点评（非流式 json_object）；失败返回 null（页面降级为纯文本）
export async function fetchStructured(cfg, state, scope, { signal } = {}) {
  const { messages } = buildMessages(state, scope)
  const body = JSON.stringify({
    model: cfg.model,
    messages: [...messages, { role: 'user', content: STRUCT_PROMPT }],
    stream: false,
    temperature: 0.2,
    response_format: { type: 'json_object' },
  })
  const r = await postText(cfg, body, { signal })
  if (!r.ok) throw new AiHttpError(r.status, r.text)
  let parsed
  try {
    parsed = JSON.parse(r.text)
  } catch {
    return null
  }
  return extractJson(parsed.choices?.[0]?.message?.content || '')
}

// 连通性测试：发一条最短对话，返回 { ok, message }
export async function testConnection(cfg) {
  const body = JSON.stringify({
    model: cfg.model,
    messages: [{ role: 'user', content: 'ping，请只回复 pong' }],
    stream: false,
    max_tokens: 16,
  })
  const r = await postText(cfg, body)
  if (!r.ok) {
    const e = new AiHttpError(r.status, r.text)
    return { ok: false, message: humanizeError(e) }
  }
  return { ok: true, message: '连接正常，API Key 有效' }
}

// 报告缓存 key
export const reportKey = (kind, key) => (kind === 'year' ? String(key) : String(key))

// ---------- v1.4 智能填单：口语文本 → 结构化账单 ----------
function mapCategory(state, name, type) {
  if (!name) return null
  const clean = String(name).trim()
  if (!clean) return null
  const list = type === 'income' ? state.categories.income : state.categories.expense
  for (const c of list) {
    if (c.name === clean) return c.id
    const sub = (c.children || []).find((x) => x.name === clean)
    if (sub) return sub.id
  }
  for (const c of list) {
    if (c.name.includes(clean) || clean.includes(c.name)) return c.id
    for (const sub of c.children || []) {
      if (sub.name.includes(clean) || clean.includes(sub.name)) return sub.id
    }
  }
  return null
}
function mapAccount(state, name) {
  if (!name) return null
  const clean = String(name).trim()
  if (!clean) return null
  const hit = state.accounts.find((a) => a.name === clean)
    || state.accounts.find((a) => a.name.includes(clean) || clean.includes(a.name))
  return hit ? hit.id : null
}

// GLM 结构化解析（非流式 json_object）；失败抛错/返回 null
export async function parseTxTextAI(cfg, text, state, { signal } = {}) {
  const today = todayStr()
  const expNames = state.categories.expense.map((c) => c.name).join('、')
  const incNames = state.categories.income.map((c) => c.name).join('、')
  const accNames = state.accounts.map((a) => a.name).join('、')
  const sys = [
    '你是记账助手。从用户的一句话或粘贴文本中抽取一笔账单，严格只输出一个 JSON 对象，不要 markdown 代码块，格式：',
    '{"type":"expense|income|transfer","amount":数字(元),"date":"YYYY-MM-DD","time":"HH:mm","note":"不超过20字","category":"分类名","account":"账户名"}',
    `今天是 ${today}；「昨天/前天/上周」等要换算成具体日期。`,
    `type=expense 时 category 从：${expNames}；type=income 时从：${incNames}。`,
    `account 尽量从：${accNames} 里选，不确定给空字符串。`,
    '无法确定就给默认：type=expense、date=今天、time=12:00，category/account/note 空字符串。金额必须大于 0。',
  ].join('\n')
  const body = JSON.stringify({
    model: cfg.model,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: String(text || '').slice(0, 200) },
    ],
    stream: false,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    max_tokens: 220,
  })
  const r = await postText(cfg, body, { signal })
  if (!r.ok) throw new AiHttpError(r.status, r.text)
  let parsed
  try { parsed = JSON.parse(r.text) } catch { return null }
  const content = parsed?.choices?.[0]?.message?.content || ''
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let j
  try { j = JSON.parse(content.slice(start, end + 1)) } catch { return null }
  const amount = round2(Number(j.amount))
  if (!(amount > 0)) return null
  const type = ['expense', 'income', 'transfer'].includes(j.type) ? j.type : 'expense'
  return {
    type,
    amount,
    date: /^\d{4}-\d{2}-\d{2}$/.test(j.date || '') ? j.date : today,
    time: /^\d{1,2}:\d{2}/.test(j.time || '') ? j.time.slice(0, 5) : null,
    note: typeof j.note === 'string' ? j.note.trim().slice(0, 20) : '',
    categoryId: type === 'transfer' ? null : mapCategory(state, j.category, type),
    accountId: mapAccount(state, j.account),
    source: 'ai',
  }
}

// 统一入口：配置了 Key 走 AI，无 Key / AI 失败 / 解析不出 → 本地正则兜底
export async function parseTxText(cfg, text, state, { signal } = {}) {
  if (cfg?.key) {
    try {
      const r = await parseTxTextAI(cfg, text, state, { signal })
      if (r) return r
    } catch (e) {
      if (e?.name === 'AbortError') throw e
    }
  }
  return parseTxTextLocal(text, state)
}

// ---------- v1.4 扫票 OCR：GLM-4V 多模态识别小票 ----------
export async function parseReceiptImage(cfg, dataUrl, state, { signal } = {}) {
  const today = todayStr()
  const catNames = state.categories.expense.map((c) => c.name).join('、')
  const sys = [
    '你是小票识别助手。识别图片中的购物小票/发票/支付账单截图，严格只输出一个 JSON 对象，不要 markdown 代码块，格式：',
    '{"total":数字(元,实付合计),"date":"YYYY-MM-DD","time":"HH:mm","merchant":"商家名","category":"分类名","note":"不超过16字的消费摘要"}',
    `今天是 ${today}。date/time 取小票上的交易时间，识别不出用今天和 12:00。`,
    'total 取「实收/合计/实付/本次支付」金额；没有金额就输出 {"total":0}。',
    `category 只能从这些支出分类里选：${catNames}。`,
  ].join('\n')
  const body = JSON.stringify({
    model: cfg.model,
    messages: [
      { role: 'system', content: sys },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: '识别这张小票并按要求输出 JSON' },
        ],
      },
    ],
    stream: false,
    temperature: 0.1,
    max_tokens: 300,
  })
  const r = await postText(cfg, body, { signal })
  if (!r.ok) throw new AiHttpError(r.status, r.text)
  let parsed
  try { parsed = JSON.parse(r.text) } catch { return null }
  const content = parsed?.choices?.[0]?.message?.content || ''
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let j
  try { j = JSON.parse(content.slice(start, end + 1)) } catch { return null }
  const amount = round2(Number(j.total))
  if (!(amount > 0)) return null
  const merchant = typeof j.merchant === 'string' ? j.merchant.trim().slice(0, 16) : ''
  return {
    amount,
    date: /^\d{4}-\d{2}-\d{2}$/.test(j.date || '') ? j.date : today,
    time: /^\d{1,2}:\d{2}/.test(j.time || '') ? j.time.slice(0, 5) : '12:00',
    merchant,
    note: (typeof j.note === 'string' && j.note.trim()) ? j.note.trim().slice(0, 16) : merchant,
    categoryId: guessCategoryId(state, `${merchant} ${j.category || ''}`, 'expense'),
    source: 'ocr',
  }
}
