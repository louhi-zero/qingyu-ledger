/* 收支监控（微信/支付宝捕获）深度测试：真实文案语料 + 处理器行为 + 原生接线断言
 *
 * 覆盖：
 *  1. parseMoneyNotify 深度语料（微信/支付宝真实通知文案、千分位/万元、噪声、边界）
 *  2. makeNotifyHandler 行为（会话/跨启动去重、softSeen 15s、跨通道金额去重、
 *     同通道重复支付放行、test 注入跳过抑制、onCleanup 钩子、AI 兜底语义）
 *  3. pageToNotifyEntry 深度语料（千分位页、付款方式陷阱、时间提取）
 *  4. 原生/接线源码断言（QyA11yPlugin 注册、test 标记贯通、负时间差保护）
 */
import { readFileSync } from 'node:fs'
import { parseMoneyNotify } from '../src/utils.js'

let pass = 0
let fail = 0
const failures = []
function assert(name, ok) {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}`) }
}

// ---- localStorage mock（先装再 import，seenMark/a11ySeenMark 调用期读取）----
const lsMap = new Map()
const prevLS = globalThis.localStorage
globalThis.localStorage = {
  getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
  setItem: (k, v) => { lsMap.set(k, String(v)) },
  removeItem: (k) => { lsMap.delete(k) },
}

const MM = 'com.tencent.mm'
const ALI = 'com.eg.android.AlipayGphone'

// ============ 一、parseMoneyNotify 深度语料 ============
console.log('parseMoneyNotify 深度语料：')
const cases = [
  // —— 微信收入 ——
  [['微信支付', '微信支付收款0.01元，可在账单详情查看', MM], { amount: 0.01, kind: 'income', source: 'wechat' }],
  [['微信收款助手', '收到转账100.00元', MM], { amount: 100, kind: 'income', source: 'wechat' }],
  [['微信支付', '张三向你转账150.00元，可点击确认收款', MM], { amount: 150, kind: 'income', source: 'wechat' }],
  [['微信支付', '二维码收款到账3.50元', MM], { amount: 3.5, kind: 'income', source: 'wechat' }],
  [['微信支付', '转账-来自老王 66.00元', MM], { amount: 66, kind: 'income', source: 'wechat' }],
  [['微信支付', '来自李四的转账 88.88元', MM], { amount: 88.88, kind: 'income', source: 'wechat' }],
  [['微信支付', '退款已原路退回 ¥50.00', MM], { amount: 50, kind: 'income', source: 'wechat' }],
  [['微信支付', '群收款：张三向你收款20.00元', MM], { amount: 20, kind: 'income', source: 'wechat' }],
  [['微信支付', '成功收款88.00元', MM], { amount: 88, kind: 'income', source: 'wechat' }],
  // —— 微信支出 ——
  [['微信支付', '微信支付-9.90', MM], { amount: 9.9, kind: 'expense', source: 'wechat' }],
  [['微信支付', '付款成功 ¥25.00', MM], { amount: 25, kind: 'expense', source: 'wechat' }],
  [['微信支付', '向商户支付9.9元', MM], { amount: 9.9, kind: 'expense', source: 'wechat' }],
  [['微信支付', '已支付15.80元', MM], { amount: 15.8, kind: 'expense', source: 'wechat' }],
  [['微信支付', '商户消费¥199.00', MM], { amount: 199, kind: 'expense', source: 'wechat' }],
  [['微信支付', '转账给张三 50.00元', MM], { amount: 50, kind: 'expense', source: 'wechat' }],
  [['微信支付', '向李四转账300.00元', MM], { amount: 300, kind: 'expense', source: 'wechat' }],
  [['微信支付', '充值成功：手机话费100.00元', MM], { amount: 100, kind: 'expense', source: 'wechat' }],
  [['微信支付', '你已成功付款给商户 ¥42.50', MM], { amount: 42.5, kind: 'expense', source: 'wechat' }],
  // —— 支付宝 ——
  [['支付宝', '付款成功 ¥25.00', ALI], { amount: 25, kind: 'expense', source: 'alipay' }],
  [['支付宝', '收款成功 ¥8.80', ALI], { amount: 8.8, kind: 'income', source: 'alipay' }],
  [['支付宝', '支付宝消费成功，实付8.80元', ALI], { amount: 8.8, kind: 'expense', source: 'alipay' }],
  [['支付宝', '余额宝收益发放1.23元', ALI], { amount: 1.23, kind: 'income', source: 'alipay' }],
  [['支付宝', '领取成功，红包¥6.66已存入余额宝', ALI], { amount: 6.66, kind: 'income', source: 'alipay' }],
  [['支付宝', '转账成功，向王五转账¥200.00', ALI], { amount: 200, kind: 'expense', source: 'alipay' }],
  [['支付宝', '经营收款88.00元', ALI], { amount: 88, kind: 'income', source: 'alipay' }],
  [['支付宝', '退款成功 ¥12.00', ALI], { amount: 12, kind: 'income', source: 'alipay' }],
  [['支付宝', '你收到一笔转账 ¥150.00', ALI], { amount: 150, kind: 'income', source: 'alipay' }],
  // —— 金额格式边界 ——
  [['微信支付', '微信支付收款10000.00元', MM], { amount: 10000, kind: 'income', source: 'wechat' }],
  [['微信支付', '微信支付-1,234.56', MM], { amount: 1234.56, kind: 'expense', source: 'wechat' }],
  [['支付宝', '付款成功 ¥1,068.00', ALI], { amount: 1068, kind: 'expense', source: 'alipay' }],
  [['微信支付', '微信支付-1,234,567.89', MM], { amount: 1234567.89, kind: 'expense', source: 'wechat' }],
  [['支付宝', '到账1万元（对方转账）', ALI], { amount: 10000, kind: 'income', source: 'alipay' }],
  [['微信支付', '收到转账1.5万元', MM], { amount: 15000, kind: 'income', source: 'wechat' }],
  [['微信支付', '微信支付-9.9', MM], { amount: 9.9, kind: 'expense', source: 'wechat' }],
  // —— 噪声（绝不弹窗）——
  [['微信支付', '验证码 583210，请勿泄露给他人', MM], null],
  [['支付宝', '你的账号刚刚在 Windows 登录', ALI], null],
  [['微信支付', '快递已到菜鸟驿站，取件码 8-2-3012', MM], null],
  [['支付宝', '信用卡还款提醒：10月账单 3,000.00元', ALI], null],
  [['微信支付', '安全提示：你的账户存在风险', MM], null],
  [['支付宝', '账单日出账提醒', ALI], null],
  [['微信支付', '有新的服务通知', MM], null],
  [['微信支付', '支付失败，请重试', MM], null],
  [['微信支付', '零钱提现到银行卡 ¥500.00（资金变动）', MM], null], // 提现非收支
  [['微信支付', '向商户支付0.00元', MM], null],
  [['微信支付', '收款99999999.00元', MM], null],
  [['美团外卖', '订单已支付 35.00元', 'com.sankuai.meituan'], null],
  // —— pkg 缺失按文本判源 ——
  [['', '支付宝到账100.00元', ''], { amount: 100, kind: 'income', source: 'alipay' }],
  [['', '微信支付-9.90', ''], { amount: 9.9, kind: 'expense', source: 'wechat' }],
  // —— 日期/时间戳陷阱 ——
  [['微信支付', '2026-10-01 对账单已生成', MM], null],
  [['微信支付', '付款成功 ¥25.00 交易时间 2026-10-02 14:30', MM], { amount: 25, kind: 'expense', source: 'wechat' }],
]
for (const [args, want] of cases) {
  const got = parseMoneyNotify(...args)
  const ok = want === null
    ? got === null
    : !!got && got.amount === want.amount && got.kind === want.kind && got.source === want.source
  const label = `${args[1].slice(0, 24)} → ${want ? `${want.source}/${want.kind}/${want.amount}` : 'null'}`
  assert(label, ok)
}

// ============ 二、makeNotifyHandler 行为 ============
console.log('makeNotifyHandler 统一管线行为：')
const { makeNotifyHandler } = await import('../src/notifyCatch.js')
const { makeA11yHandler, pageToNotifyEntry } = await import('../src/a11ycatch.js')
const realFetch = globalThis.fetch
const aiResp = (content) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })

function freshCtx() {
  const caught = []
  const dropped = []
  const h = makeNotifyHandler((x) => caught.push(x), {
    aiFallback: true,
    loadCfg: () => ({ key: 'k', model: 'm', baseUrl: 'https://x' }),
    onCleanup: (key) => dropped.push(key),
  })
  return { caught, dropped, h }
}

try {
  // 1) 会话内精确去重 + onCleanup
  {
    const { caught, dropped, h } = freshCtx()
    globalThis.fetch = async () => { throw new Error('不应发起 AI 请求') }
    await h({ title: '微信支付', text: '微信支付-9.90', pkg: MM, ts: 1000, key: 'r1' })
    await h({ title: '微信支付', text: '微信支付-9.90', pkg: MM, ts: 1000, key: 'r2' })
    assert('精确签名去重（同 ts 副本只弹一次）', caught.length === 1 && caught[0].amount === 9.9)
    assert('去重命中 → onCleanup 清理离线副本', dropped.length === 1 && dropped[0] === 'r2')
  }

  // 2) 跨启动去重（localStorage 持久化签名，新实例不再弹）
  {
    const { caught, h } = freshCtx()
    await h({ title: '微信支付', text: '微信支付-7.70', pkg: MM, ts: 2000 })
    const h2 = makeNotifyHandler((x) => caught.push(x), { aiFallback: false, loadCfg: () => ({}) })
    await h2({ title: '微信支付', text: '微信支付-7.70', pkg: MM, ts: 2000 })
    assert('跨启动持久化去重（seen 表命中不重弹）', caught.length === 1)
  }

  // 3) softSeen 15s 窗口：同内容演进式重发（不同 ts）5s 内吸收，20s 外放行
  {
    const { caught, dropped, h } = freshCtx()
    await h({ title: '微信支付', text: '微信支付-5.00', pkg: MM, ts: 100000 })
    await h({ title: '微信支付', text: '微信支付-5.00', pkg: MM, ts: 105000, key: 's1' })
    assert('softSeen：同文本 15s 内重发被吸收', caught.length === 1 && dropped[0] === 's1')
    await h({ title: '微信支付', text: '微信支付-5.00', pkg: MM, ts: 120000 })
    assert('softSeen：20s 后同文本同金额真第二笔放行（同通道不抑制）', caught.length === 2)
  }

  // 4) 跨通道金额去重：通知先弹 → 无障碍同金额被抑制；顺序反过来也抑制
  {
    const { caught, dropped, h } = freshCtx()
    const a11yH = makeA11yHandler((x) => caught.push(x), { notifyHandler: h })
    await h({ title: '微信支付', text: '微信支付-40.00', pkg: MM, ts: 300000 })
    await a11yH({ key: 'p1', sig: 'c1', pkg: MM, ts: 301000, texts: ['支付成功', '¥40.00', '收款方 全家便利店'] })
    assert('跨通道：通知→支付页 30s 内同金额只弹一次', caught.length === 1)
    assert('跨通道抑制 → 清理无障碍离线副本（onCleanup）', dropped.includes('p1'))
    // 反序：支付页先弹 → 通知到达被抑制
    await a11yH({ key: 'p2', sig: 'c2', pkg: MM, ts: 302000, texts: ['支付成功', '¥55.00', '收款方 肯德基'] })
    await h({ title: '微信支付', text: '微信支付-55.00', pkg: MM, ts: 303000, key: 'n1' })
    assert('跨通道：支付页→通知 反序同样只弹一次', caught.length === 2)
  }

  // 5) 同通道两笔真实同金额支付：30s 内第二笔不被吞（漏单回归）
  {
    const { caught, h } = freshCtx()
    await h({ title: '微信支付', text: '微信支付-6.00', pkg: MM, ts: 500000 })
    await h({ title: '微信支付', text: '微信支付-6.00', pkg: MM, ts: 525000 })
    assert('同通道同金额 30s 内第二笔仍弹窗（防真实漏单）', caught.length === 2)
  }

  // 6) test 注入跳过抑制：连续两次测试通知都弹窗
  {
    const { caught, h } = freshCtx()
    await h({ title: '微信支付', text: '微信支付收款0.01元，可在账单详情查看', pkg: MM, ts: 600000, test: true })
    await h({ title: '微信支付', text: '微信支付收款0.01元，可在账单详情查看', pkg: MM, ts: 601000, test: true })
    assert('test 注入跳过 15s/30s 抑制（连点测试按钮每次都弹）', caught.length === 2)
  }

  // 7) AI 兜底语义
  {
    const { caught, h } = freshCtx()
    // 无金额转账消息 → AI 兜底弹窗（金额可 null → 用户补填）
    globalThis.fetch = async () => aiResp('{"isPay":true,"kind":"income","amount":0,"note":"李四转账"}')
    await h({ title: '微信支付', text: '你收到一条转账消息', pkg: MM, ts: 700000 })
    assert('AI 兜底：金额缺失 → 弹空金额窗（amount=null）', caught.length === 1 && caught[0].amount === null)
    // 非支付语境门控：不发起 AI 请求
    const before = caught.length
    globalThis.fetch = async () => { throw new Error('门控外不应调用 AI') }
    await h({ title: '张三', text: '明天一起吃饭啊', pkg: MM, ts: 701000 })
    assert('AI 门控：普通聊天直接跳过（0 请求）', caught.length === before)
    // AI HTTP 失败 → 静默不弹
    globalThis.fetch = async () => { throw new Error('network down') }
    await h({ title: '微信支付', text: '你收到一条转账消息', pkg: MM, ts: 702000 })
    assert('AI 失败静默（不影响监听主流程）', caught.length === before)
    // AI 认定非支付 → 静默
    globalThis.fetch = async () => aiResp('{"isPay":false,"kind":null,"amount":0,"note":""}')
    await h({ title: '微信支付', text: '你收到一条转账消息', pkg: MM, ts: 703000 })
    assert('AI 认定非支付 → 静默', caught.length === before)
  }

  // 8) 噪声离线副本不误删（本地规则认不出也不删队列，下次启动 seen 命中自愈清理）
  {
    const { caught, dropped, h } = freshCtx()
    globalThis.fetch = async () => { throw new Error('不应调用 AI') }
    await h({ title: '微信支付', text: '有新的服务通知', pkg: MM, ts: 800000, key: 'noise1' })
    assert('噪声通知不弹窗', caught.length === 0)
    assert('噪声通知不误删队列条目（下次启动 seen 命中后自愈清理）', !dropped.includes('noise1'))
    await h({ title: '微信支付', text: '有新的服务通知', pkg: MM, ts: 800000, key: 'noise1' })
    assert('噪声副本二次进入：seen 命中 → 清理（自愈）', dropped.includes('noise1'))
  }

  // 9) 无障碍通道深语料（pageToNotifyEntry）
  console.log('pageToNotifyEntry 深度语料：')
  const aliBig = pageToNotifyEntry(['支付宝', '付款成功', '¥1,068.00', '付款方式 余额', '商户 星巴克', '交易时间 2026-10-02 14:30:05'], ALI)
  assert('千分位金额页归一（¥1,068.00 → 1068）', !!aliBig && aliBig.amount === 1068)
  const wxBig = pageToNotifyEntry(['支付成功', '¥12,345.67', '付款方式 零钱', '收款方 京东商城'], MM)
  assert('万位千分位页（¥12,345.67 → 12345.67）', !!wxBig && wxBig.amount === 12345.67)
  const aliIn = pageToNotifyEntry(['收款成功', '13.50元', '来自 张三', '2026-09-30 22:01'], ALI)
  assert('支付宝收款页（元形式金额 + 收入）', !!aliIn && aliIn.kind === 'income' && aliIn.amount === 13.5)
  const zeroDec = pageToNotifyEntry(['支付成功', '¥88', '收款方 瑞幸咖啡'], MM)
  assert('无小数金额页（¥88 → 88.00）', !!zeroDec && zeroDec.amount === 88 && zeroDec.text === '微信支付-88.00 瑞幸咖啡')
  assert('付款方式陷阱回归（「付款方式 余额」不当对方）',
    !!aliBig && aliBig.counterparty === '星巴克' && pageToNotifyEntry(['付款成功', '¥8.80', '付款方式 余额'], ALI).counterparty === null)
  assert('20 字以上对方截断', (() => {
    const r = pageToNotifyEntry(['支付成功', '¥10.00', '收款方 ' + '很长的店铺名字'.repeat(4)], MM)
    return !!r && r.counterparty.length === 20
  })())
  assert('纯广告页（噪声词过滤）→ null',
    pageToNotifyEntry(['扫一扫', '领福利', '¥88.00'], MM) === null)
  assert('页面无金额 → null', pageToNotifyEntry(['支付成功', '收款方 星巴克'], MM) === null)

  // 10) makeA11yHandler：test 透传 + 首条放行
  {
    const { caught, h } = freshCtx()
    const a11yH = makeA11yHandler((x) => caught.push(x), { notifyHandler: h })
    await a11yH({ key: 't1', sig: 'test-1', pkg: MM, ts: 900000, test: true, texts: ['支付成功', '¥25.00', '收款方 瑞幸咖啡'] })
    await a11yH({ key: 't2', sig: 'test-2', pkg: MM, ts: 901000, test: true, texts: ['支付成功', '¥25.00', '收款方 瑞幸咖啡'] })
    assert('a11y test 注入连续两次均弹窗（跳过跨通道抑制）', caught.length === 2)
  }
} finally {
  globalThis.fetch = realFetch
  if (prevLS === undefined) delete globalThis.localStorage
  else globalThis.localStorage = prevLS
}

// ============ 四、原生/接线源码断言 ============
console.log('原生接线源码断言：')
const mainJava = readFileSync(new URL('../android/app/src/main/java/com/qingyu/ledger/MainActivity.java', import.meta.url), 'utf-8')
const pluginJava = readFileSync(new URL('../android/app/src/main/java/com/qingyu/ledger/NotifyCatchPlugin.java', import.meta.url), 'utf-8')
const a11yPluginJava = readFileSync(new URL('../android/app/src/main/java/com/qingyu/ledger/QyA11yPlugin.java', import.meta.url), 'utf-8')
const svcJava = readFileSync(new URL('../android/app/src/main/java/com/qingyu/ledger/NotifyCatchService.java', import.meta.url), 'utf-8')
const a11ySvcJava = readFileSync(new URL('../android/app/src/main/java/com/qingyu/ledger/QyA11yService.java', import.meta.url), 'utf-8')
const appSrc = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf-8')
const notifyJs = readFileSync(new URL('../src/notifyCatch.js', import.meta.url), 'utf-8')

assert('【严重】QyA11yPlugin 在 MainActivity 注册（未注册=无障碍通道在真机整体失效）',
  mainJava.includes('registerPlugin(QyA11yPlugin.class)'))
assert('NotifyCatchPlugin 在 MainActivity 注册', mainJava.includes('registerPlugin(NotifyCatchPlugin.class)'))
assert('testEmit 标记 test=true（测试注入跳过去重抑制）',
  pluginJava.includes('emit(title, text, pkg, System.currentTimeMillis(), true)'))
assert('pendingEnqueueSample 持久化 test 标记',
  a11yPluginJava.includes('enqueuePage(getContext()') && pluginJava.includes('"test"') && a11yPluginJava.includes('"test"'))
assert('真实通知链路默认 test=false（Service 4 参调用不受影响）',
  svcJava.includes('NotifyCatchPlugin.enqueue(this, title, text, pkg, postTime);')
  && svcJava.includes('NotifyCatchPlugin.emit(title, text, pkg, postTime);'))
assert('入队去重防负时间差（ts 早于队首不误判重复）',
  pluginJava.includes('dt >= 0') && a11yPluginJava.includes('dt >= 0'))
assert('无障碍 Service 采集调用保持 4 参（test 默认 false）',
  a11ySvcJava.includes('QyA11yPlugin.enqueuePage(this, pkg, now, sig, texts);')
  && a11ySvcJava.includes('QyA11yPlugin.emitPage(pkg, now, sig, texts);'))
assert('App 层 onCleanup：确认/忽略后同时清理通知队列与支付页队列',
  appSrc.includes('removePendingNotifies([key])') && appSrc.includes('removePendingPages([key])'))
assert('App 层离线消费透传 test 标记',
  appSrc.includes('test: !!it.test'))
assert('makeNotifyHandler 支持 onCleanup 注入（默认 removePendingNotifies）',
  notifyJs.includes('onCleanup'))

// 【严重回归】thenable 扁平化陷阱：插件代理的 then 会抛 Unimplemented，它绝不能成为
// Promise 结算值（v1.5-v2.4 真机全灭的根因）。验证门面模式：await 门面立即完成且方法可转发。
{
  const evil = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return () => { throw new Error('"X.then()" is not implemented') }
      return (arg) => ({ called: prop, arg })
    },
  })
  const facade = new Proxy({}, {
    get(_t, prop, recv) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
      return Reflect.get(evil, prop, evil)
    },
  })
  const t0 = Date.now()
  const resolved = await Promise.resolve({ proxy: facade }).then((x) => x.proxy)
  assert('门面可被 await（非 thenable，不触发扁平化挂死）', resolved === facade && Date.now() - t0 < 1000)
  assert('门面转发方法调用（isListening 等经 Reflect.get 到原代理）',
    resolved.isListening().called === 'isListening')
  assert('门面屏蔽 then/catch/finally（promise 机制视为普通值）',
    facade.then === undefined && facade.catch === undefined && facade.finally === undefined)
  const viaAsync = await (async () => facade)()
  assert('门面经 async return 也不再挂起', viaAsync === facade)
  assert('源码三处 getter 均使用非 thenable 门面（notifyCatch/a11ycatch/update）',
    notifyJs.includes("prop === 'then' || prop === 'catch' || prop === 'finally'")
    && readFileSync(new URL('../src/a11ycatch.js', import.meta.url), 'utf-8').includes("prop === 'then'")
    && readFileSync(new URL('../src/update.js', import.meta.url), 'utf-8').includes("prop === 'then'"))
}

// ============ 五、AI 上传脱敏（v2.5） ============
console.log('AI 上传脱敏：')
const { maskSensitive } = await import('../src/utils.js')
const seedSrc = readFileSync(new URL('../src/seed.js', import.meta.url), 'utf-8')
const aiSrcFull = readFileSync(new URL('../src/ai.js', import.meta.url), 'utf-8')
const aiSettingsSrc = readFileSync(new URL('../src/pages/AiSettings.jsx', import.meta.url), 'utf-8')

assert('手机号打码（13812345678 → 138****5678）',
  maskSensitive('联系老王 13812345678 确认') === '联系老王 138****5678 确认')
assert('分隔符手机号打码（138 1234 5678）',
  maskSensitive('电话138-1234-5678请回') === '电话138****5678请回')
assert('身份证打码（18 位校验码通过 → 前3后2；校验不过按卡号处理）',
  maskSensitive('身份证110101199001011237登记') === '身份证110*************37登记'
  && maskSensitive('号320102199001011234').includes('3201******234'))
assert('银行卡/订单号打码（16 位 → 前4后3）',
  maskSensitive('尾号6222021888881234到账') === '尾号6222******234到账')
assert('金额不受影响（两位小数与整数）',
  maskSensitive('实付25.00元，共1068元') === '实付25.00元，共1068元')
assert('日期时间不受影响',
  maskSensitive('2026-10-03 12:30:45 交易') === '2026-10-03 12:30:45 交易')
assert('混合文本一次打码全部敏感串',
  (() => {
    const r = maskSensitive('张三 13912345678 转账，单号4111111111111111，证320102199001011234')
    return !/13912345678|4111111111111111|320102199001011234/.test(r) && r.includes('139****5678')
  })())
assert('seed 默认 aiMask=true', seedSrc.includes('aiMask: true, // v2.5 AI 上传脱敏'))
assert('ai.js：buildMessages 传 mask（settings.aiMask 门控）',
  aiSrcFull.includes('state.settings.aiMask !== false'))
assert('ai.js：aiParseNotify 上传前 maskSensitive（门控用原文）',
  aiSrcFull.includes('const safeTitle = cfg.mask !== false ? maskSensitive(title) : title'))
assert('AiSettings：脱敏开关 UI（默认开 + 截图不脱敏说明）',
  aiSettingsSrc.includes('上传前脱敏') && aiSettingsSrc.includes('aiMask')
  && aiSettingsSrc.includes('无法自动脱敏'))
assert('App：监控 AI 兜底 cfg 跟随主设置（aiMaskRef + loadAiCfg 合并）',
  appSrc.includes('aiMaskRef.current') && appSrc.includes("loadCfg: () => ({ ...loadAiCfg(), mask: aiMaskRef.current })"))
assert('监控区隐私说明含 AI 兜底脱敏声明',
  readFileSync(new URL('../src/pages/SettingsSections.jsx', import.meta.url), 'utf-8').includes('自动脱敏'))

// buildStatsPayload 行为：含敏感串的备注在默认载荷中被打码，关闭后原样
{
  const { buildStatsPayload } = await import('../src/ai.js')
  const fakeState = {
    settings: { monthStartDay: 1, aiIncludeNotes: true },
    ledgers: [{ id: 'l1', name: '默认账本' }],
    currentLedgerId: 'l1',
    categories: { expense: [], income: [] },
    accounts: [],
    transactions: [{
      id: 't1', ledgerId: 'l1', date: '2026-10-02', time: '12:00', type: 'expense',
      amount: 25, categoryId: null, accountId: null, note: '给李四 13812345678 代付',
      tags: [], reimburse: 'none', attachAt: null, deletedAt: null, createdAt: '',
    }],
  }
  const masked = buildStatsPayload(fakeState, { kind: 'month', key: '2026-10' })
  const raw = buildStatsPayload(fakeState, { kind: 'month', key: '2026-10' }, true, false)
  const mStr = JSON.stringify(masked)
  const rStr = JSON.stringify(raw)
  assert('buildStatsPayload 默认脱敏（备注中手机号打码）',
    !mStr.includes('13812345678') && mStr.includes('138****5678'))
  assert('buildStatsPayload mask=false 原样上传（用户显式关闭）', rStr.includes('13812345678'))
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 收支监控深度测试：${pass} 通过 / ${fail} 失败`)
if (fail) { for (const f of failures) console.log(`   FAIL: ${f}`); process.exit(1) }
