/* v1.1 AI 模块验收（无第三方依赖，node scripts/ai-test.mjs）
 * 1) SSE 分块解析：跨块切割 / [DONE] / 心跳与非 data 行容错
 * 2) 结构化 JSON 提取：纯 JSON、```json 包裹、前后缀文字、异常字段裁剪
 * 3) 统计载荷：月/年结构、金额字段为有限数、分类按一级名合并、备注开关
 * 4) Prompt 组装：风格预设注入
 */
import assert from 'node:assert/strict'
import { demoState, emptyState } from '../src/seed.js'
import { currentPeriod, todayStr } from '../src/utils.js'
import {
  parseSSEChunks, extractJson, buildStatsPayload, buildMessages,
  AI_STYLES, styleOf, defaultAiCfg,
} from '../src/ai.js'

let pass = 0
const ok = (name) => { pass++; console.log('  ✓ ' + name) }

// ---------- SSE ----------
console.log('SSE 解析：')
const sseEvent = (obj) => `data: ${JSON.stringify(obj)}\n\n`
const e1 = parseSSEChunks('', sseEvent({ choices: [{ delta: { content: '你好' } }] }))
assert.equal(e1.buffer, '')
assert.deepEqual(e1.deltas, ['你好'])
ok('单块单事件解析')

const part = sseEvent({ choices: [{ delta: { content: '记账' } }] }) + sseEvent({ choices: [{ delta: { content: '开心' } }] })
// 13 字符一片地切碎，必然多次切在事件/UTF 与事件边界上
{
  let buf = ''
  const got = []
  for (let i = 0; i < part.length; i += 13) {
    const r = parseSSEChunks(buf, part.slice(i, i + 13))
    buf = r.buffer
    got.push(...r.deltas)
  }
  assert.deepEqual(got, ['记账', '开心'])
  assert.equal(buf, '')
  ok('跨 chunk 任意切割正确拼接')
}
// 首片只给半包
{
  let st = parseSSEChunks('', part.slice(0, 10))
  assert.deepEqual(st.deltas, [])
  st = parseSSEChunks(st.buffer, part.slice(10))
  assert.deepEqual(st.deltas, ['记账', '开心'])
  ok('半包缓冲后整片到达')
}

let st2 = parseSSEChunks('', ': 心跳注释\n\ndata: [DONE]\n\n')
assert.deepEqual(st2.deltas, [])
ok('心跳行与 [DONE] 被忽略')

const st3 = parseSSEChunks('', 'event: message\ndata: {"choices":[{"delta":{"content":"A"}}]}\n\nid: xx\n\n')
assert.deepEqual(st3.deltas, ['A'])
ok('多行事件仅取 data 行')

// 半包留在 buffer
const half = 'data: {"choices":[{"delta":{"content":"余'
const st4 = parseSSEChunks('', half)
assert.deepEqual(st4.deltas, [])
assert.ok(st4.buffer.includes('余'))
ok('不完整事件留在 buffer 等待后续')

// ---------- JSON 提取 ----------
console.log('结构化 JSON：')
assert.deepEqual(
  extractJson('{"title":"稳","highlights":["a"],"anomalies":[],"prediction":"","tips":["t1","t2"]}'),
  { title: '稳', highlights: ['a'], anomalies: [], prediction: '', tips: ['t1', 't2'] },
)
ok('纯 JSON 直接解析')
const wrapped = extractJson('好的，这是结果：\n```json\n{"title":"x","highlights":[],"anomalies":[],"prediction":"p","tips":[]}\n```\n以上。')
assert.equal(wrapped.title, 'x')
assert.equal(wrapped.prediction, 'p')
ok('markdown 代码块包裹可提取')
assert.equal(extractJson('没有 JSON 的回复'), null)
ok('无 JSON 返回 null（降级纯文本）')
const messy = extractJson('{"title":"超长标题'.padEnd(0) + '","highlights":["ok",1,null,"x"],"anomalies":[{"target":"餐饮"},{"text":"有说明"}],"prediction":"p","tips":["a","b","c","d","e"]}')
assert.equal(messy.highlights.length, 2, '非字符串项过滤')
assert.equal(messy.tips.length, 4, 'tips 截断 4 条')
assert.equal(messy.anomalies.length, 1, '无 text 的异常项过滤')
ok('结构字段裁剪与类型过滤')

// ---------- 统计载荷 ----------
console.log('统计载荷：')
const state = demoState()
const sd = state.settings.monthStartDay
const pKey = currentPeriod(sd)
const yKey = todayStr().slice(0, 4)

const month = buildStatsPayload(state, { kind: 'month', key: pKey }, true)
assert.equal(month.scope.kind, 'month')
assert.equal(month.scope.key, pKey)
assert.ok(month.summary.expense > 0, '演示数据当期应有支出')
assert.ok(month.summary.income > 0)
assert.equal(typeof month.summary.avgDailyExpense, 'number')
assert.ok(month.dailyExpense.length >= 1)
assert.ok(month.dailyExpense.length <= month.range.daysTotal)
ok('月报载荷：总览/日均/日趋势齐全')

assert.ok(month.topExpenseCategories.length > 0)
for (const c of month.topExpenseCategories) {
  assert.equal(typeof c.value, 'number')
  assert.ok(c.pct >= 0 && c.pct <= 100, '占比 0~100')
}
const names = month.topExpenseCategories.map((c) => c.name)
assert.equal(new Set(names).size, names.length, '一级分类不应重名（子类已合并）')
ok('分类支出按一级名合并且带占比')

assert.ok(month.notes.length > 0, '演示数据含备注，应抽到 samples')
assert.ok(month.notes.every((n) => n.samples.length <= 2))
const monthNoNotes = buildStatsPayload(state, { kind: 'month', key: pKey }, false)
assert.deepEqual(monthNoNotes.notes, [])
ok('备注随开关附入/移除')

const year = buildStatsPayload(state, { kind: 'year', key: yKey }, false)
assert.equal(year.months.length, 12, '年报固定 12 个月')
assert.ok(year.topExpenseCategories.length >= 0)
assert.equal(year.scope.label, `${yKey}年度`)
ok('年报载荷：12 月序列')

const empty = emptyState()
const m0 = buildStatsPayload(empty, { kind: 'month', key: pKey }, true)
assert.equal(m0.summary.expense, 0)
assert.equal(m0.summary.balance, 0)
assert.deepEqual(m0.topExpenseCategories, [])
assert.equal(m0.budget.total, 0)
ok('空状态载荷不崩、零值正确')

// ---------- Prompt ----------
console.log('Prompt 组装：')
const bm = buildMessages(state, { kind: 'month', key: pKey })
assert.equal(bm.messages.length, 2)
assert.equal(bm.messages[0].role, 'system')
assert.ok(bm.messages[0].content.includes(styleOf('tender').prompt))
assert.ok(bm.messages[1].content.includes(pKey))
ok('默认温柔风格注入 system，用户消息含周期数据')
state.settings.aiStyle = 'sharp'
state.settings.aiCustomStyle = '多用东北话'
const bm2 = buildMessages(state, { kind: 'year', key: yKey })
assert.ok(bm2.messages[0].content.includes(styleOf('sharp').prompt))
assert.ok(bm2.messages[0].content.includes('多用东北话'))
assert.ok(bm2.messages[1].content.includes('年度'))
ok('风格切换与自定义补充指令生效')
assert.equal(AI_STYLES.length, 4)

// ---------- 配置默认值 ----------
const cfg = defaultAiCfg()
assert.ok(cfg.baseUrl.startsWith('https://'))
assert.ok(cfg.model.includes('glm'))
ok('默认 AI 配置为智谱 https 端点与 GLM 模型')

console.log(`\nAI 模块全部通过：${pass} 项断言`)
