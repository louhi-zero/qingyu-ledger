/* v1.8.0 AI 回复风格卡（自定义参数 + 角色风格两阶段生成）
 *
 * 三种风格来源（aiStyle 取值）：
 *   preset：AI_STYLES 四预设（ai.js）
 *   custom：用户自选参数（语气/正式度/长度/结构）→ composeStylePrompt 本地组合，无需 AI 调用
 *   char  ：角色风格卡（如「芙宁娜」）→ generateStyleCard 两阶段生成：
 *             阶段1 联网检索：维基百科 MediaWiki API 抓角色资料（Electron 走 qyHttp 桥、
 *                             浏览器/Capacitor 直连 fetch + origin=*；失败降级模型知识）
 *             阶段2 卡片生成：AI 将资料合成结构化风格卡 JSON
 *           校验协议 validateStyleCard：字段齐全/长度合理/角色名匹配，不合格重试一次
 *           缓存 qingyu_style_cards_v1：同名角色命中即免检索免生成（瞬时返回）
 *
 * 隐私：风格卡仅存本机 localStorage，不随云备份上传；生成时只发送角色名与公开资料给 AI。
 */
import { styleKeyOf } from './utils.js'
import { postText, AiHttpError, platformKind } from './ai.js'

export const STYLE_CARD_KEY = 'qingyu_style_cards_v1'
const WIKI_API = 'https://zh.wikipedia.org/w/api.php'
const WIKI_TIMEOUT = 8000

// ---------- 自定义风格参数（本地组合，不走 AI） ----------
export const STYLE_ATTRS = {
  tone: [
    { id: 'gentle', label: '温柔', prompt: '语气温柔友善、有共情感' },
    { id: 'humor', label: '幽默', prompt: '语气轻松幽默、可以适度玩梗调侃' },
    { id: 'sharp', label: '犀利', prompt: '语气犀利直接、一针见血' },
    { id: 'calm', label: '沉稳', prompt: '语气沉稳克制、像可靠的顾问' },
    { id: 'energetic', label: '元气', prompt: '语气元气满满、多用 emoji 和短句' },
  ],
  formality: [
    { id: 'casual', label: '口语化', prompt: '用大白话，像朋友聊天' },
    { id: 'balanced', label: '适中', prompt: '口语为主、必要时用专业词并解释' },
    { id: 'formal', label: '正式', prompt: '措辞正式规范、像书面报告' },
  ],
  length: [
    { id: 'short', label: '精简', prompt: '篇幅精简，只讲最重要的结论' },
    { id: 'std', label: '标准', prompt: '篇幅适中，结论与建议并重' },
    { id: 'detail', label: '详尽', prompt: '篇幅详尽，展开讲清来龙去脉' },
  ],
  structure: [
    { id: 'para', label: '小段落', prompt: '分成几个自然小段' },
    { id: 'list', label: '要点式', prompt: '多用要点列表，一条一个信息' },
    { id: 'mix', label: '混合', prompt: '先小段定调，再用要点列建议' },
  ],
}

export function defaultStyleAttrs() {
  return { tone: 'gentle', formality: 'balanced', length: 'std', structure: 'para' }
}

export function normalizeStyleAttrs(a) {
  const d = defaultStyleAttrs()
  if (!a || typeof a !== 'object') return d
  const out = {}
  for (const k of Object.keys(d)) {
    out[k] = STYLE_ATTRS[k].some((x) => x.id === a[k]) ? a[k] : d[k]
  }
  return out
}

// 参数 → 提示词片段（确定性本地组合，无网络调用）
export function composeStylePrompt(attrs) {
  const a = normalizeStyleAttrs(attrs)
  const pick = (k) => STYLE_ATTRS[k].find((x) => x.id === a[k])
  return [
    `请按以下回复风格输出：${pick('tone').prompt}；${pick('formality').prompt}；${pick('length').prompt}；${pick('structure').prompt}。`,
  ].join('')
}

// 自定义风格的展示描述（用于风格卡预览）
export function styleAttrsDesc(attrs) {
  const a = normalizeStyleAttrs(attrs)
  return ['tone', 'formality', 'length', 'structure']
    .map((k) => STYLE_ATTRS[k].find((x) => x.id === a[k]).label).join(' · ')
}

// ---------- 风格卡缓存（localStorage，本机不云同步） ----------
export function loadStyleCards() {
  try {
    const raw = localStorage.getItem(STYLE_CARD_KEY)
    const obj = raw ? JSON.parse(raw) : {}
    return obj && typeof obj === 'object' ? obj : {}
  } catch { return {} }
}
function persistCards(all) {
  try { localStorage.setItem(STYLE_CARD_KEY, JSON.stringify(all)) } catch { /* 配额 */ }
}
export function getCachedCard(name) {
  const card = loadStyleCards()[styleKeyOf(name)]
  return card && validateStyleCard(card, name) ? card : null
}
export function saveCachedCard(card) {
  const all = loadStyleCards()
  all[styleKeyOf(card.name)] = card
  persistCards(all)
}
export function removeCachedCard(name) {
  const all = loadStyleCards()
  delete all[styleKeyOf(name)]
  persistCards(all)
}
export function cachedCardNames() {
  return Object.values(loadStyleCards())
    .map((c) => c.name)
    .filter(Boolean)
}

// ---------- 校验协议 ----------
const clip = (v, n) => String(v || '').trim().slice(0, n)
// 归一化字符串数组：过滤空值、截断单项、截断数量；不足 min 条返回 null（校验失败）
function clipArr(v, min, max, itemMax) {
  if (!Array.isArray(v)) return null
  const items = v
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x) => x.trim().slice(0, itemMax))
    .slice(0, max)
  return items.length >= min ? items : null
}

// 严格校验 + 归一：通过返回归一化后的卡，不通过返回 null
export function validateStyleCard(card, wantName) {
  if (!card || typeof card !== 'object') return null
  const name = clip(card.name, 24)
  const wk = styleKeyOf(wantName)
  // 名字必须能对上（双向包含，容忍「芙宁娜(Furina)」这类输出）
  if (!name || !wk || !(styleKeyOf(name).includes(wk) || wk.includes(styleKeyOf(name)))) return null
  const traits = clipArr(card.traits, 2, 6, 16)
  const speech = clipArr(card.speech, 1, 6, 40)
  const vocab = clipArr(card.vocab, 0, 6, 20) || []
  const prompt = clip(card.prompt, 400)
  if (!traits || !speech) return null
  if (prompt.length < 40) return null
  return {
    name,
    title: clip(card.title, 24),
    emoji: clip(card.emoji, 4) || '🎭',
    traits, speech, vocab,
    tone: clip(card.tone, 60),
    usage: clip(card.usage, 80),
    prompt,
    at: typeof card.at === 'string' ? card.at : new Date().toISOString(),
    source: clip(card.source, 40),
  }
}

// ---------- 阶段1：维基百科检索（MediaWiki API） ----------
// 纯函数：构造检索 URL（单测覆盖）
export function buildWikiUrls(name) {
  const q = encodeURIComponent(name)
  return {
    search: `${WIKI_API}?action=query&list=search&srsearch=${q}&srlimit=1&format=json&origin=*`,
    extract: (title) => `${WIKI_API}?action=query&prop=extracts&explaintext=1&exintro=1&redirects=1&titles=${encodeURIComponent(title)}&format=json&origin=*`,
  }
}

async function wikiGetJson(url) {
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ac && setTimeout(() => ac.abort(), WIKI_TIMEOUT)
  try {
    // Electron：走主进程 https 桥（无 CORS）；浏览器/Capacitor：直连（origin=* 已带 CORS 头）
    if (platformKind() === 'electron') {
      const parts = []
      const r = await window.qyHttp.requestStream(
        { url, method: 'GET', headers: { Accept: 'application/json' } },
        (t) => parts.push(t),
      )
      if (!r.ok) throw new Error(`wiki http ${r.status}`)
      return JSON.parse(parts.join(''))
    }
    const res = await fetch(url, ac ? { signal: ac.signal } : {})
    if (!res.ok) throw new Error(`wiki http ${res.status}`)
    return await res.json()
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// 返回 { text, title, source }；检索失败/无条目返回 null（调用方降级模型知识）
export async function wikiSearchExtract(name, { signal } = {}) {
  try {
    const urls = buildWikiUrls(name)
    const s = await wikiGetJson(urls.search)
    const hit = s?.query?.search?.[0]
    if (!hit) return null
    // 检索结果标题须与角色名对得上（双向包含），避免拿同名异物条目
    const tk = styleKeyOf(hit.title)
    const nk = styleKeyOf(name)
    if (!(tk.includes(nk) || nk.includes(tk))) return null
    const e = await wikiGetJson(urls.extract(hit.title))
    const pages = e?.query?.pages
    const page = pages && pages[Object.keys(pages)[0]]
    const text = typeof page?.extract === 'string' ? page.extract.replace(/\s+/g, ' ').trim().slice(0, 1600) : ''
    if (!text) return null
    return { text, title: page.title, source: 'zh.wikipedia.org' }
  } catch (e) {
    if (e?.name === 'AbortError' || signal?.aborted) throw e
    return null // 网络失败 → 降级模型知识，不阻断生成
  }
}

// ---------- 阶段2 + 编排：角色风格卡生成 ----------
const CARD_SYS = [
  '你是「角色语言风格卡」生成器，为记账 App 的财务分析助手生成角色扮演风格卡。',
  '根据给出的角色资料，严格只输出一个 JSON 对象（不要 markdown 代码块，不要多余文字），格式：',
  '{"name":"角色名","title":"头衔·出处，16字内","emoji":"最贴合的一个emoji","traits":["3-5条性格特质，每条12字内"],"speech":["2-4条语言习惯或句式特征，每条30字内"],"tone":"语气规范，40字内","vocab":["2-5个口头禅或高频词"],"usage":"适用场景与边界，50字内","prompt":"以该角色口吻做财务分析的完整指令，120-200字：写清自称、对用户的称呼、句式习惯、情绪边界，保持角色感但不人身攻击、不编造数据"}',
  '要求：忠于资料与角色公认设定，不虚构设定；资料为空时基于你已有的知识；没有把握的字段给空数组或空字符串。',
].join('\n')

function parseCardJson(content) {
  if (!content || typeof content !== 'string') return null
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(content.slice(start, end + 1)) } catch { return null }
}

async function chatOnce(cfg, user, { signal } = {}) {
  const body = JSON.stringify({
    model: cfg.model,
    messages: [
      { role: 'system', content: CARD_SYS },
      { role: 'user', content: user },
    ],
    stream: false,
    temperature: 0.4,
    response_format: { type: 'json_object' },
    max_tokens: 900,
  })
  const r = await postText(cfg, body, { signal })
  if (!r.ok) throw new AiHttpError(r.status, r.text)
  let parsed
  try { parsed = JSON.parse(r.text) } catch { return null }
  return parseCardJson(parsed.choices?.[0]?.message?.content || '')
}

/**
 * 生成（或命中缓存返回）角色风格卡。
 * onPhase(phase, detail)：'cache' | 'search' | 'generate' | 'done'
 * 返回 { card, cached, materialChars, wikiTitle }；失败抛 Error（message 已人话）。
 */
export async function generateStyleCard(cfg, rawName, { onPhase, signal } = {}) {
  const name = String(rawName || '').trim().slice(0, 24)
  if (!name) throw new Error('请先输入角色或人物名')
  if (!cfg?.key) throw new Error('请先在上方配置 API Key')

  // 缓存命中：跳过检索与生成（同角色二次使用瞬时完成）
  const cached = getCachedCard(name)
  if (cached) {
    onPhase?.('cache', cached)
    return { card: cached, cached: true, materialChars: 0, wikiTitle: '' }
  }

  // 阶段1：联网检索角色资料
  onPhase?.('search', name)
  let material = ''
  let wikiTitle = ''
  let source = ''
  const wiki = await wikiSearchExtract(name, { signal })
  if (wiki) { material = wiki.text; wikiTitle = wiki.title; source = wiki.source }

  // 阶段2：AI 合成风格卡（校验不过带原因重试一次）
  onPhase?.('generate', material ? `${material.length} 字资料` : '模型知识库')
  const userMsg = [
    `角色名：${name}`,
    material
      ? `公开资料（${source}「${wikiTitle}」）：\n${material}`
      : '公开资料：未检索到（可能网络不可用），请基于你已有的知识生成；若完全不认识该角色，请把 traits/speech/vocab 给空数组。',
  ].join('\n')
  let lastFail = ''
  for (let i = 0; i < 2; i++) {
    const raw = await chatOnce(cfg, i === 0 ? userMsg : `${userMsg}\n\n上次输出未通过校验（${lastFail}），请严格按格式重新输出，prompt 不少于 120 字。`, { signal })
    const card = validateStyleCard(raw, name)
    if (card) {
      if (!card.tone && !card.usage) { lastFail = '缺少 tone/usage'; continue }
      card.source = source || 'AI 知识库'
      saveCachedCard(card)
      onPhase?.('done', card)
      return { card, cached: false, materialChars: material.length, wikiTitle }
    }
    lastFail = '字段缺失或格式不符'
  }
  throw new Error('风格卡生成失败：模型输出未通过校验，请重试或换个名字')
}

// ---------- 当前生效风格解析（UI 展示用；ai.js 内联同款逻辑避免循环依赖） ----------
export function activeStyleInfo(state) {
  const s = state?.settings || {}
  const mode = s.aiStyle
  if (mode === 'char') {
    const card = getCachedCard(s.aiCharName)
    if (card) {
      return { mode, name: card.name, emoji: card.emoji, desc: card.title || '角色风格', detail: card.tone }
    }
    return { mode, name: s.aiCharName || '角色风格', emoji: '🎭', desc: '缓存已失效', detail: '' }
  }
  if (mode === 'custom') {
    return { mode, name: '自定义', emoji: '🎛️', desc: styleAttrsDesc(s.aiStyleAttrs), detail: (s.aiCustomStyle || '').slice(0, 40) }
  }
  const preset = ['tender', 'sharp', 'pro', 'cute'].includes(mode) ? mode : 'tender'
  const map = { tender: ['温柔鼓励', '🌷'], sharp: ['犀利毒舌', '🌶️'], pro: ['专业财务师', '💼'], cute: ['俏皮可爱', '🍭'] }
  return { mode: preset, name: map[preset][0], emoji: map[preset][1], desc: '预设风格', detail: '' }
}
