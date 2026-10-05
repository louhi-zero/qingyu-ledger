/* 数据一致性回归测试（md 报告：删除账单后汇总/笔数/列表不同步）
 *
 * 报告描述的场景在当前架构（单一 state 派生 + txsOfLedger 统一软删过滤）下无法复现：
 * 列表、汇总、笔数全部派生自同一 state.transactions，删除（软删 deletedAt）即时生效。
 * 本测试锁定该场景，防止未来引入独立缓存/双数据源时回归。
 *
 * 运行：node scripts/consistency-test.mjs
 */
import assert from 'node:assert'
import { emptyState } from '../src/seed.js'
import { txsOfPeriod, txsOfLedger, sumBy, round2 } from '../src/utils.js'

let pass = 0
let fail = 0
const ok = (name, cond) => { if (cond) { pass++ } else { fail++; console.log('  ✗ ' + name) } }
const softDelete = (st, id) => {
  const t = st.transactions.find((x) => x.id === id)
  if (t) t.deletedAt = new Date().toISOString()
}
const restore = (st, id) => {
  const t = st.transactions.find((x) => x.id === id)
  if (t) t.deletedAt = null
}

// ---- 构造：账本1（支1000 + 收10001）、账本2（支50 + 收200）----
const st = emptyState()
const l1 = st.ledgers[0]
const l2 = { id: 'lg2', name: '撒网重点', icon: 'svg:book', template: '标准账本' }
st.ledgers.push(l2)
st.currentLedgerId = l1.id
const mk = (id, ledgerId, type, amount, time) => ({
  id, ledgerId, type, amount, date: '2026-10-04', time,
  note: '', tags: [], categoryId: null, accountId: null, toAccountId: null,
  reimburse: 'none', attachAt: null, deletedAt: null, createdAt: '',
})
st.transactions.push(
  mk('a1', l1.id, 'expense', 1000, '10:00'),
  mk('a2', l1.id, 'income', 10001, '10:01'),
  mk('b1', l2.id, 'expense', 50, '11:00'),
  mk('b2', l2.id, 'income', 200, '11:01'),
)

const summary = (state, period = '2026-10') => {
  const txs = txsOfPeriod(state, period)
  return {
    count: txs.length,
    expense: sumBy(txs, 'expense'),
    income: sumBy(txs, 'income'),
    balance: round2(sumBy(txs, 'income') - sumBy(txs, 'expense')),
  }
}

// 场景 0：基线——删除前汇总与列表一致（md 附录 0:00-0:11 ✓）
{
  const s = summary(st)
  ok('基线：汇总=列表（2 笔 / 支 1000 / 收 10001 / 结余 9001）',
    s.count === 2 && s.expense === 1000 && s.income === 10001 && s.balance === 9001)
}

// 场景 1：依次软删账本1 两笔 → 汇总归零、列表空、笔数 0（md 现象 1+2）
softDelete(st, 'a1')
softDelete(st, 'a2')
{
  const s = summary(st)
  ok('删除全部后：汇总归零、列表空、笔数 0（列表/汇总同源）',
    s.count === 0 && s.expense === 0 && s.income === 0 && s.balance === 0
    && txsOfLedger(st).length === 0)
}

// 场景 2：账本2——删除单笔收入 → 结余 -50；恢复 → 150（md 回归清单）
st.currentLedgerId = l2.id
{
  const before = summary(st)
  ok('账本2 基线：2 笔 / 支 50 / 收 200 / 结余 150',
    before.count === 2 && before.expense === 50 && before.income === 200 && before.balance === 150)
  softDelete(st, 'b2')
  const after = summary(st)
  ok('删单笔收入（200）：1 笔 / 结余 -50', after.count === 1 && after.balance === -50)
  restore(st, 'b2')
  ok('恢复该笔：2 笔 / 结余还原 150', summary(st).count === 2 && summary(st).balance === 150)
}

// 场景 3：切换账本再切回 → 删除状态保持、数据正确（md 回归清单）
st.currentLedgerId = l1.id
ok('切回账本1：仍为空（删除状态跨账本切换保持）', summary(st).count === 0)
st.currentLedgerId = l2.id
ok('再切账本2：2 笔 / 结余 150（不受账本1 操作影响）',
  summary(st).count === 2 && summary(st).balance === 150)

console.log(`${fail === 0 ? '✅' : '❌'} 数据一致性回归：${pass} 通过 / ${fail} 失败`)
if (fail) process.exit(1)
