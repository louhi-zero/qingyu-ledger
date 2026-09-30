/* v1.0 云同步验收脚本（无第三方依赖，node scripts/sync-test.mjs）
 * 1) 内置最小 WebDAV HTTP 服务（OPTIONS CORS / HEAD / GET / PUT+ETag+If-Match / MKCOL）
 * 2) 双设备交替「新增 / 编辑 / 删除」各一轮，最终两端 deepStrictEqual（diff = 0）
 * 3) 同一笔两端改不同：两份均保留（原 id + __dup__ 设备副本）
 * 4) 传输层：404 / ETag 乐观锁 412 / CORS 头 / HEAD / MKCOL
 */
import assert from 'node:assert/strict'
import { demoState, emptyState } from '../src/seed.js'
import { mergeStates, syncOnce, parseRemote, makeSnapshot, stableJson, deepClone, isPristineState } from '../src/sync.js'
import { WebDavTransport } from '../src/webdav.js'
import { startServer } from './webdav-stub.mjs'

let pass = 0
const ok = (name) => { pass++; console.log('  ✓ ' + name) }

// ---------- 最小 WebDAV 桩（见 webdav-stub.mjs） ----------

// 模拟一台设备
class Device {
  constructor(id, data) { this.id = id; this.local = deepClone(data); this.base = null; this.last = null }
}
async function devSync(dev, t) {
  const remote = await t.get()
  const r = await syncOnce({
    local: deepClone(dev.local),
    base: dev.base ? deepClone(dev.base) : null,
    remoteText: remote ? remote.env : null,
    remoteEtag: remote ? remote.etag : null,
    localDevice: dev.id,
    appVersion: '1.0.0',
    transport: t,
  })
  dev.local = r.data
  dev.base = deepClone(r.data)
  dev.last = r
  return r
}
const editTx = (state, id, patch) => {
  const tx = state.transactions.find((x) => x.id === id)
  Object.assign(tx, patch)
}
const addTx = (state, id, amount) => state.transactions.push({
  id, ledgerId: state.currentLedgerId, date: '2026-09-30', time: '12:00',
  type: 'expense', amount, categoryId: state.categories.expense[0].id,
  accountId: state.accounts[0]?.id || null, note: '同步测试' + id, createdAt: '2026-09-30T12:00',
})

// ---------- 开始 ----------
const srv = await startServer()
const tA = new WebDavTransport({ url: srv.url, username: 'u', password: 'p' })
const tB = new WebDavTransport({ url: srv.url, username: 'u', password: 'p' })
const tOther = new WebDavTransport({ url: srv.url.replace('backup.json', 'other.json'), username: 'u', password: 'p' })

console.log('传输层 HTTP 语义：')
assert.equal(await tOther.get(), null, '404 应返回 null')
ok('GET 404 → null（云端尚无文件）')
const head = await fetch(srv.url, { method: 'OPTIONS' })
assert.equal(head.headers.get('access-control-allow-origin'), '*')
assert.ok(head.headers.get('access-control-expose-headers').includes('etag'))
ok('OPTIONS 返回 CORS 头并暴露 ETag')

console.log('双设备增删改合并：')
const s0 = demoState()
const tx3 = s0.transactions[2].id
const tx5 = s0.transactions[4].id
const tx7 = s0.transactions[6].id
const tx8 = s0.transactions[7].id
const amt3 = s0.transactions[2].amount
const amt8 = s0.transactions[7].amount
const VAL_A = 1111.11
const VAL_B = 2222.22
const VAL_8 = 8888.88

const A = new Device('dev-AAAAAA', s0)
const B = new Device('dev-BBBBBB', emptyState()) // B 是一台出厂新机
let r

// 1) A 先记账再首次上云（独立修改 tx8 留待并发轮做断言）
addTx(A.local, 'sync-a1', 10.01)
r = await devSync(A, tA)
assert.equal(r.mode, 'first-upload')
ok(`A 首次上云（${r.mode}）`)

// 2) B 新机先同步恢复
r = await devSync(B, tB)
assert.equal(r.mode, 'restore')
assert.equal(B.local.transactions.length, A.local.transactions.length)
assert.equal(stableJson(B.local), stableJson(A.local))
ok('B 新机从云端恢复，与 A 完全一致')

// 3) 两台设备基于共同基线 A1 各自离线改动（并发编辑）
//    A：新增 a2、删除 tx7、独自修改 tx8、与 B 同改 tx3（不同值）
addTx(A.local, 'sync-a2', 30.03)
A.local.transactions = A.local.transactions.filter((x) => x.id !== tx7)
editTx(A.local, tx8, { amount: VAL_8 })
editTx(A.local, tx3, { amount: VAL_A, note: 'A改的' })
//    B：新增 b1、删除 tx5、把 tx3 改成另一个值
addTx(B.local, 'sync-b1', 20.02)
B.local.transactions = B.local.transactions.filter((x) => x.id !== tx5)
editTx(B.local, tx3, { amount: VAL_B, note: 'B改的' })
// 4) 先后同步（顺序不影响结果）
r = await devSync(A, tA)
assert.equal(r.mode, 'merge')
const rb = await devSync(B, tB)
assert.ok(rb.mode === 'merge' || rb.mode === 'merge-retry')
ok('并发新增/删除/同笔改不同值后两端合并')

// 5) B 不动再同步一次，应收敛
await devSync(B, tB)
// 6) A 也再同步一次
await devSync(A, tA)
assert.equal(stableJson(A.local), stableJson(B.local), '两端最终状态必须完全一致')
ok('双端继续同步后完全收敛，逐条 diff = 0')

// v1.1：AI 报告缓存 / 图片资产元数据跨端同步
A.local.aiReports = A.local.aiReports || {}
A.local.aiReports['2026-09'] = { at: '2026-10-01T08:00:00Z', kind: 'month', key: '2026-09', label: '2026年9月', narrative: '九月报告', struct: { title: '稳中有进' }, model: 'glm-4.7-flash' }
A.local.assetsMeta = A.local.assetsMeta || {}
A.local.assetsMeta.avatar = { at: '2026-10-01T09:00:00Z', hash: 'avatar-hash-a' }
A.local.assetsMeta.wallpaper = { at: null, hash: null }
await devSync(A, tA)
await devSync(B, tB)
assert.equal(B.local.aiReports['2026-09'].narrative, '九月报告')
assert.equal(B.local.aiReports['2026-09'].struct.title, '稳中有进')
assert.equal(B.local.assetsMeta.avatar.hash, 'avatar-hash-a')
assert.deepEqual(B.local.assetsMeta.wallpaper, { at: null, hash: null })
ok('AI 报告缓存与头像/壁纸资产元数据随同步下发到另一台设备')

// v1.2：tags / reimburse / attachAt / templates 跨端同步（行内新字段随整行三向合并）
A.local.templates = A.local.templates || []
A.local.templates.push({ id: 'tpl1', name: '午餐模板', type: 'expense', amount: 22, categoryId: 'c1', accountId: 'a1', note: '', at: '2026-10-01T00:00:00Z' })
const tagTxId = A.local.transactions[0].id
Object.assign(A.local.transactions[0], { tags: ['聚餐', '同事'], reimburse: 'pending', attachAt: '2026-10-02T00:00:00Z' })
await devSync(A, tA)
await devSync(B, tB)
const bTx = B.local.transactions.find((x) => x.id === tagTxId)
assert.deepEqual(bTx.tags, ['聚餐', '同事'])
assert.equal(bTx.reimburse, 'pending')
assert.equal(bTx.attachAt, '2026-10-02T00:00:00Z')
assert.equal(B.local.templates.find((t) => t.id === 'tpl1')?.name, '午餐模板')
ok('交易行级 v1.2 字段（标签/报销/附件时间）与记账模板跨端下发一致')

// v1.3：goals / fxRates / 账户新字段（币种、信用卡、债务）跨端同步
A.local.goals = A.local.goals || []
A.local.goals.push({ id: 'goal1', name: '旅行基金', icon: '🧳', target: 20000, saved: 5000, deadline: '2027-03-01', note: '', at: '2026-10-03T00:00:00Z' })
A.local.fxRates = { ...(A.local.fxRates || {}), USD: 7.35 }
A.local.accounts.push({ id: 'acc-cc1', name: '外币信用卡', type: 'credit', icon: '🪪', initial: 0, color: '#ab47bc', currency: 'USD', billingDay: 5, dueDay: 23, creditLimit: 30000 })
await devSync(A, tA)
await devSync(B, tB)
assert.equal(B.local.goals.find((g) => g.id === 'goal1')?.name, '旅行基金')
assert.equal(B.local.fxRates.USD, 7.35)
const bCc = B.local.accounts.find((a) => a.id === 'acc-cc1')
assert.equal(bCc?.currency, 'USD')
assert.equal(bCc?.billingDay, 5)
assert.equal(bCc?.creditLimit, 30000)
assert.equal(stableJson(A.local), stableJson(B.local), 'v1.3 字段合并后两端必须收敛一致')
ok('v1.3 储蓄目标/汇率表/账户新字段跨端下发一致，两端收敛')

// 结果断言
const ids = new Set(A.local.transactions.map((x) => x.id))
assert.ok(ids.has('sync-a1') && ids.has('sync-a2') && ids.has('sync-b1'), '三笔新增都在')
ok('两台设备各新增的账单全部保留')
assert.ok(!ids.has(tx5) && !ids.has(tx7), '两笔删除都生效')
ok('两端各删除的账单均已删除')
const t8 = A.local.transactions.find((x) => x.id === tx8)
assert.equal(t8.amount, VAL_8)
ok('仅一端编辑的账单采用该端修改')
const dupRows = A.local.transactions.filter((x) => x.id.startsWith(tx3 + '__dup__'))
assert.equal(dupRows.length, 1, '冲突副本恰好 1 条')
const main3 = A.local.transactions.find((x) => x.id === tx3)
const keptMain = Math.min(VAL_A, VAL_B)
const keptDup = Math.max(VAL_A, VAL_B)
assert.equal(main3.amount, keptMain)
assert.equal(dupRows[0].amount, keptDup)
assert.ok(/冲突副本/.test(dupRows[0].note || dupRows[0].name || ''))
ok(`同笔两端改不同：原值保留较小内容(${keptMain})，冲突副本保留另一份(${keptDup})`)
const conflictLog = rb.conflicts.filter((c) => c.type.startsWith('row')).length
assert.ok(conflictLog >= 1)
ok('合并结果中记录了冲突清单')

console.log('传输层乐观锁：')
const headNow = await tA.get()
await assert.rejects(async () => tA.put('{"x":1}', '"W/"stale-nope"'), /云端快照已被其他设备更新/)
ok('If-Match 不匹配 → 412（防互相覆盖）')
const headRes = await fetch(srv.url, { method: 'HEAD', headers: { authorization: 'Basic ' + Buffer.from('u:p').toString('base64') } })
assert.equal(headRes.status, 200)
assert.ok(headRes.headers.get('etag'))
ok('HEAD 返回 200 与 ETag')

console.log('合并器边界用例：')
// 编辑 vs 删除：两个方向
{
  const base = { transactions: [{ id: 'r1', amount: 1, note: '' }] }
  const edited = { transactions: [{ id: 'r1', amount: 2, note: '' }] }
  const deleted = { transactions: [] }
  const m1 = mergeStates(base, edited, deleted, { localDevice: 'dev-l', remoteDevice: 'dev-r' }).data
  assert.equal(m1.transactions.length, 1)
  assert.equal(m1.transactions[0].amount, 2)
  const m2 = mergeStates(base, deleted, edited, { localDevice: 'dev-l', remoteDevice: 'dev-r' }).data
  assert.equal(m2.transactions.length, 1)
  assert.equal(m2.transactions[0].amount, 2)
  ok('一端编辑一端删除 → 编辑优先保留')
}
// 对称性：交换两端身份，结果一致
{
  const base = { transactions: [{ id: 'r1', amount: 1 }], settings: { x: 1 }, budgets: { total: 0, byCategory: {} }, currentLedgerId: 'L', review: null }
  const l = { transactions: [{ id: 'r1', amount: 2 }], settings: { x: 2 }, budgets: { total: 0, byCategory: {} }, currentLedgerId: 'L', review: null }
  const rem = { transactions: [{ id: 'r1', amount: 3 }], settings: { x: 3 }, budgets: { total: 0, byCategory: {} }, currentLedgerId: 'L', review: null }
  const m1 = mergeStates(base, l, rem, { localDevice: 'dev-l', remoteDevice: 'dev-r' }).data
  const m2 = mergeStates(base, rem, l, { localDevice: 'dev-r', remoteDevice: 'dev-l' }).data
  assert.equal(stableJson(m1), stableJson(m2))
  assert.equal(m1.transactions[0].amount, 2)
  ok('冲突结果与哪台设备先合无关（确定性一致）')
}
// 打卡并集 / 反馈去重 / 设置标量冲突
{
  const base = { checkins: ['2026-09-29'], feedbacks: [{ text: 'f0', at: 't0' }], settings: { nickname: '老', monthStartDay: 1 }, budgets: { total: 100, byCategory: { c1: 10 } }, currentLedgerId: 'L0', review: null }
  const l = { checkins: ['2026-09-29', '2026-09-30'], feedbacks: [{ text: 'f0', at: 't0' }, { text: 'fl', at: 'tl' }], settings: { nickname: '甲', monthStartDay: 1 }, budgets: { total: 200, byCategory: { c1: 10, c2: 20 } }, currentLedgerId: 'L1', review: null }
  const rem = { checkins: ['2026-09-28', '2026-09-29'], feedbacks: [{ text: 'f0', at: 't0' }, { text: 'fr', at: 'tr' }], settings: { nickname: '乙', monthStartDay: 1 }, budgets: { total: 300, byCategory: { c1: 10, c2: 20 } }, currentLedgerId: 'L2', review: null }
  const m = mergeStates(base, l, rem, { localDevice: 'l', remoteDevice: 'r' }).data
  assert.deepEqual(m.checkins, ['2026-09-28', '2026-09-29', '2026-09-30'])
  assert.equal(m.feedbacks.length, 3)
  assert.equal(m.budgets.total, 200) // 200 < 300 确定性小值
  assert.equal(m.budgets.byCategory.c1, 10)
  assert.equal(m.settings.nickname, '乙' > '甲' ? '甲' : '乙')
  ok('打卡并集、反馈按内容去重、标量冲突确定性取值')
}
// v1.1：aiReports / assetsMeta 的 LWW 合并
{
  const l = {
    aiReports: {
      '2026-08': { at: '2026-09-01T00:00:00Z', narrative: '八月旧' },
      '2026-09': { at: '2026-09-30T00:00:00Z', narrative: '九月本机新' },
    },
    assetsMeta: {
      avatar: { at: '2026-09-02T00:00:00Z', hash: 'la' },
      wallpaper: { at: null, hash: null },
    },
  }
  const rem = {
    aiReports: {
      '2026-09': { at: '2026-09-20T00:00:00Z', narrative: '九月云端旧' },
      '2026': { at: '2026-12-31T00:00:00Z', narrative: '年报云端' },
    },
    assetsMeta: {
      avatar: { at: '2026-09-01T00:00:00Z', hash: 'ra' },
      wallpaper: { at: '2026-09-03T00:00:00Z', hash: 'rw' },
    },
  }
  const merged = mergeStates({}, l, rem, { localDevice: 'l', remoteDevice: 'r' })
  const m = merged.data
  assert.deepEqual(Object.keys(m.aiReports).sort(), ['2026', '2026-08', '2026-09'])
  assert.equal(m.aiReports['2026-09'].narrative, '九月本机新') // 同 key 取 at 新者
  assert.equal(m.aiReports['2026-08'].narrative, '八月旧')
  assert.equal(m.aiReports['2026'].narrative, '年报云端')
  assert.equal(m.assetsMeta.avatar.hash, 'la') // 本机较新
  assert.equal(m.assetsMeta.wallpaper.hash, 'rw') // 删除态(at=null)输给云端有值
  // 交换两端身份，LWW 结果必须完全一致（确定性）
  const m2 = mergeStates({}, rem, l, { localDevice: 'r', remoteDevice: 'l' }).data
  assert.equal(stableJson(m.aiReports), stableJson(m2.aiReports))
  assert.equal(stableJson(m.assetsMeta), stableJson(m2.assetsMeta))
  assert.equal(merged.conflicts.length, 0) // LWW 不产生冲突记录
  ok('AI 报告并集/同键取新、资产按 at 的 LWW（含删除态），且双端确定性一致')
}
// 快照信封兼容
{
  const env = JSON.stringify({ app: 'qingyu', kind: 'full-backup', appVersion: '0.9.0', at: 'x', data: s0 })
  const parsed = parseRemote(env)
  assert.equal(parsed.data.transactions.length, s0.transactions.length)
  assert.equal(parseRemote(JSON.stringify(makeSnapshot(s0, 'dev-x', '1.0.0').data && makeSnapshot(s0, 'dev-x', '1.0.0'))).deviceId, 'dev-x')
  ok('兼容 v0.9 全量备份信封与 v1.0 快照')
}
// 空状态识别
assert.ok(isPristineState(emptyState()))
assert.ok(!isPristineState(s0))
ok('出厂空状态识别准确（新机云恢复判定）')

srv.server.close()
console.log(`\n全部通过：${pass} 项断言，diff=0 验收成功`)
