/* v1.6 单元测试（纯 Node，无 DOM）：
 * 1. isWhiteBgPixels 白底像素判定（头像/底部图标共用的强制校验）
 * 2. parseMoneyNotify 通知收支解析
 * 3. normalizeTabIconAt 底部图标时间戳表归一
 * 4. emptyState 出厂默认值（tapFeedback / tabIconAt / notifyCatch）
 * 运行：npm run test:unit
 */
import { isWhiteBgPixels, parseMoneyNotify, normalizeTabIconAt } from '../src/utils.js'
import { emptyState } from '../src/seed.js'

let passed = 0
let failed = 0
function assert(name, cond) {
  if (cond) {
    passed++
    console.log('  ✓ ' + name)
  } else {
    failed++
    console.log('  ✗ ' + name)
  }
}

// ---------- 1. isWhiteBgPixels ----------
console.log('isWhiteBgPixels 白底像素判定：')
function mkPixels(w, h, fill) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const c = fill(x, y)
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255
    }
  }
  return { data, w, h }
}
assert('纯白图通过', isWhiteBgPixels(mkPixels(64, 64, () => [255, 255, 255]).data, 64, 64) === true)
assert('浅灰 235 均匀底通过', isWhiteBgPixels(mkPixels(64, 64, () => [235, 235, 235]).data, 64, 64) === true)
assert('红底不通过', isWhiteBgPixels(mkPixels(64, 64, () => [224, 85, 85]).data, 64, 64) === false)
assert('白底 + 中央彩色主体通过（四角白）', (() => {
  const p = mkPixels(64, 64, (x, y) => (x > 20 && x < 44 && y > 20 && y < 44 ? [66, 133, 244] : [255, 255, 255]))
  return isWhiteBgPixels(p.data, 64, 64) === true
})())
assert('单角彩色不通过', (() => {
  const p = mkPixels(64, 64, (x, y) => (x < 12 && y < 12 ? [255, 170, 60] : [255, 255, 255]))
  return isWhiteBgPixels(p.data, 64, 64) === false
})())

// ---------- 2. parseMoneyNotify ----------
console.log('parseMoneyNotify 通知解析：')
const parseCases = [
  [['微信支付', '微信支付收款12.50元', 'com.tencent.mm'], { amount: 12.5, kind: 'income', source: 'wechat' }],
  [['支付宝', '支付宝到账100.00元', 'com.eg.android.AlipayGphone'], { amount: 100, kind: 'income', source: 'alipay' }],
  [['', '微信红包', 'com.tencent.mm'], null], // 无金额
  [['服务通知', '您已支出25元（滴滴出行）', 'com.tencent.mm'], { amount: 25, kind: 'expense', source: 'wechat' }],
  [['', '【支付宝】验证码 583210，10元', 'com.eg.android.AlipayGphone'], null], // 噪声
  [['微信支付', '支付成功 ¥3.00元', 'com.tencent.mm'], { amount: 3, kind: 'expense', source: 'wechat' }],
  [['美团外卖', '订单已送达 35元', 'com.sankuai.meituan'], null], // 非目标来源
  [['', '你收到一笔转账 88元', ''], null], // 无法判定来源
  [['微信支付', '向商户支付9.9元', 'com.tencent.mm'], { amount: 9.9, kind: 'expense', source: 'wechat' }],
  [['支付宝', '付款成功 199.00元', 'com.eg.android.AlipayGphone'], { amount: 199, kind: 'expense', source: 'alipay' }],
]
for (const [args, want] of parseCases) {
  const got = parseMoneyNotify(...args)
  const ok = want === null
    ? got === null
    : got && got.amount === want.amount && got.kind === want.kind && got.source === want.source
  assert(`${JSON.stringify(args[1] || args[0])} → ${want ? `${want.source}/${want.kind}/${want.amount}` : 'null'}`, ok)
}

// ---------- 3. normalizeTabIconAt ----------
console.log('normalizeTabIconAt 归一：')
const n1 = normalizeTabIconAt(null)
assert('null → 四 key 全 null', JSON.stringify(n1) === JSON.stringify({ home: null, charts: null, discover: null, profile: null }))
const n2 = normalizeTabIconAt({ home: '2026-01-01T00:00.000Z', charts: 123, garbage: 'x' })
assert('部分值补齐 + 字符串化 + 未知 key 丢弃',
  n2.home === '2026-01-01T00:00.000Z' && n2.charts === '123' && n2.discover === null && n2.profile === null && !('garbage' in n2))
const n3 = normalizeTabIconAt([1, 2])
assert('数组视为非法 → 全 null', n3.home === null && n3.charts === null)

// ---------- 4. emptyState 默认值 ----------
console.log('emptyState 出厂默认：')
const es = emptyState()
assert('tapFeedback 默认开启', es.settings.tapFeedback === true)
assert('tabIconAt 四 key 形状正确', JSON.stringify(normalizeTabIconAt(es.settings.tabIconAt)) === JSON.stringify({ home: null, charts: null, discover: null, profile: null }))
assert('notifyCatch 默认关闭', es.settings.notifyCatch === false)
assert('glassOn 默认关闭', es.settings.glassOn === false)

console.log(failed === 0 ? `\n全部通过：${passed} 项` : `\n${failed} 项失败`)
process.exit(failed ? 1 : 0)
