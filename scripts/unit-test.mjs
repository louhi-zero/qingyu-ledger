/* v1.6 单元测试（纯 Node，无 DOM）：
 * 1. isWhiteBgPixels 白底像素判定（头像/底部图标共用的强制校验）
 * 2. parseMoneyNotify 通知收支解析
 * 3. normalizeTabIconAt 底部图标时间戳表归一
 * 4. emptyState 出厂默认值（tapFeedback / tabIconAt / notifyCatch / noticeEnabled）
 * 5. AndroidManifest 权限声明
 * 6. notice 公告解析与筛选（v1.6.5）
 * 运行：npm run test:unit
 */
import { isWhiteBgPixels, parseMoneyNotify, normalizeTabIconAt, normalizeDiscIconAt, DISCOVER_ICON_KEYS } from '../src/utils.js'
import { parseNotice, noticeKey, unreadNotice, importantPending } from '../src/notice.js'
import { emptyState } from '../src/seed.js'
import { readFileSync, existsSync } from 'node:fs'

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
  // v1.6.8 真实文案扩充
  [['微信支付', '微信支付-9.90', 'com.tencent.mm'], { amount: 9.9, kind: 'expense', source: 'wechat' }],
  [['支付宝', '支付宝-25.00', 'com.eg.android.AlipayGphone'], { amount: 25, kind: 'expense', source: 'alipay' }],
  [['微信支付', '付款成功 ¥25.00', 'com.tencent.mm'], { amount: 25, kind: 'expense', source: 'wechat' }],
  [['微信支付', '二维码收款到账3.50元', 'com.tencent.mm'], { amount: 3.5, kind: 'income', source: 'wechat' }],
  [['支付宝', '商户消费¥88.00', 'com.eg.android.AlipayGphone'], { amount: 88, kind: 'expense', source: 'alipay' }],
  [['支付宝', '余额宝收益发放1.23元', 'com.eg.android.AlipayGphone'], { amount: 1.23, kind: 'income', source: 'alipay' }],
  [['微信支付', '转账-来自老王 66.00元', 'com.tencent.mm'], { amount: 66, kind: 'income', source: 'wechat' }],
  [['微信支付', '转账给张三 50.00元', 'com.tencent.mm'], { amount: 50, kind: 'expense', source: 'wechat' }],
  [['微信支付', '微信支付 9.90', 'com.tencent.mm'], { amount: 9.9, kind: 'expense', source: 'wechat' }],
  [['微信支付', '2026-10-01 对账单已生成', 'com.tencent.mm'], null], // 日期里的 -10 不能误判金额
  [['支付宝', '信用卡还款提醒 10月账单', 'com.eg.android.AlipayGphone'], null], // 还款提醒噪声
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
assert('noticeEnabled 默认开启', es.settings.noticeEnabled === true)

// ---------- 5. Android 权限声明 ----------
console.log('AndroidManifest 权限：')
const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf-8')
assert('声明 VIBRATE 权限（navigator.vibrate 生效前提）', manifest.includes('android.permission.VIBRATE'))
assert('声明 INTERNET 权限', manifest.includes('android.permission.INTERNET'))

// ---------- 6. 公告 notice.js 纯函数（v1.6.5） ----------
console.log('notice 公告解析与筛选：')
const good = parseNotice(JSON.stringify({
  version: 2,
  list: [
    { title: '版本更新', content: '内容A', important: true, date: '2026-10-01' },
    { title: '  空标题省略  ', content: '内容B', important: 'yes', date: '2026-9-1' },
    { title: '', content: '无标题丢弃' },
    null,
  ],
}))
assert('合法 JSON 解析出 version', good && good.version === 2)
assert('脏条目过滤（空标题/null 丢弃，合法条目保留）', good.list.length === 2)
assert('title 去首尾空格', good.list[1].title === '空标题省略')
assert('important 非布尔视为 false', good.list[1].important === false)
assert('date 格式非法置空', good.list[1].date === '')
assert('noticeKey = title_date', noticeKey(good.list[0]) === '版本更新_2026-10-01')
assert('非法 JSON → null', parseNotice('{oops') === null)
assert('缺 list → null', parseNotice('{"version":1}') === null)
const long = parseNotice(JSON.stringify({ version: 1, list: [{ title: 't'.repeat(99), content: 'c'.repeat(9999), date: '2026-10-01' }] }))
assert('title/content 超长截断', long.list[0].title.length === 60 && long.list[0].content.length === 600)
const over = parseNotice(JSON.stringify({ version: 1, list: Array.from({ length: 30 }, (_, i) => ({ title: `t${i}`, content: 'x', date: '2026-10-01' })) }))
assert('列表超 20 条截断', over.list.length === 20)
assert('unreadNotice：未读过 → 全部未读', unreadNotice(good.list, '').length === 2)
assert('unreadNotice：晚于 lastRead 才算未读', unreadNotice(good.list, '2026-09-30').length === 1 && unreadNotice(good.list, '2026-10-01').length === 0)
const pend = importantPending(good.list, ['版本更新_2026-10-01'])
assert('importantPending：已确认的排除', pend.length === 0)
assert('importantPending：未确认的保留且仅重要', importantPending(good.list, []).length === 1 && importantPending(good.list, [])[0].title === '版本更新')

// ---------- 7. v1.6.7 玻璃启动提速 / 模糊可调 / 震动即时（源码断言） ----------
console.log('v1.6.7 性能与反馈：')
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf-8')
const appJs = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf-8')
const themeJs = readFileSync(new URL('../src/theme.jsx', import.meta.url), 'utf-8')
const settingsJs = readFileSync(new URL('../src/pages/SettingsSections.jsx', import.meta.url), 'utf-8')
assert('晕光不再使用 blur(72px) 滤镜（径向渐变替代）', !css.includes('filter: blur(72px)'))
assert('晕光改用 radial-gradient', css.includes('radial-gradient(circle at 50% 45%'))
assert('存在 gboot 启动引导期规则', css.includes('[data-glass="on"][data-gboot="1"]'))
assert('遮罩浓度与模糊联动变量 --g-veil', css.includes('--g-veil: calc(') && css.includes('--glass-blur-n'))
assert('theme 下发无单位 --glass-blur-n', themeJs.includes(`setProperty('--glass-blur-n'`))
assert('gboot 两帧后移除（双 requestAnimationFrame + 兜底定时器）', themeJs.includes("dataset.gboot = '1'") && (themeJs.match(/requestAnimationFrame/g) || []).length >= 2)
assert('弹层模糊跟随滑杆（不再硬编码 22px）', !css.includes('blur(22px)'))
assert('我的页统计条模糊跟随滑杆（不再硬编码 10px）', !css.includes('blur(10px)'))
assert('震动监听在 pointerdown（落下即震，非 click）', appJs.includes("addEventListener('pointerdown'") && !appJs.includes("addEventListener('click', h"))
assert('震动监听 passive（不阻塞滚动/点击）', appJs.includes("{ passive: true, capture: true }"))
assert('滑杆拖动零延迟直写 CSS 变量', settingsJs.includes(`setProperty('--glass-blur-n'`))
assert('滑杆触控热区 touch-action: pan-y', css.includes('touch-action: pan-y'))

// ---------- 8. v1.6.8 发现页图标 / 震动档位 / 签名 / 原生链路 ----------
console.log('v1.6.8 发现图标·震动·签名·监控链路：')
assert('DISCOVER_ICON_KEYS 共 14 个功能', DISCOVER_ICON_KEYS.length === 14)
const d1 = normalizeDiscIconAt(null)
assert('discIconAt 空值 → 14 key 全 null', Object.keys(d1).length === 14 && Object.values(d1).every((v) => v === null))
const d2 = normalizeDiscIconAt({ scan: 123, garbage: 'x', assets: '2026-10-01T00:00.000Z' })
assert('discIconAt 合法值保留且字符串化、未知 key 丢弃',
  d2.scan === '123' && d2.assets === '2026-10-01T00:00.000Z' && !('garbage' in d2) && d2.fx === null)
const discSeed = normalizeDiscIconAt(es.settings.discIconAt)
assert('出厂默认含 discIconAt 空表', Object.keys(discSeed).length === 14)
assert('出厂默认 tapScale=true / vibrateLevel=2', es.settings.tapScale === true && es.settings.vibrateLevel === 2)

const storeJs = readFileSync(new URL('../src/store.jsx', import.meta.url), 'utf-8')
assert('迁移：老 tapFeedback=false → vibrateLevel=0；tapScale 跟随 tapFeedback',
  storeJs.includes("s.settings.vibrateLevel = s.settings.tapFeedback === false ? 0 : 2")
  && storeJs.includes("s.settings.tapScale = s.settings.tapFeedback !== false"))
assert('vibrateLevel 非法值兜底为 2', storeJs.includes("s.settings.vibrateLevel = 2"))
assert('迁移归一 discIconAt', storeJs.includes('normalizeDiscIconAt(s.settings.discIconAt)'))

const appJs2 = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf-8')
assert('震动四档时长 0/6/10/20ms', appJs2.includes('[0, 6, 10, 20][vibrateLevel]'))
assert('滑动撤震（vibrate(0) + 14px 阈值）', appJs2.includes('navigator.vibrate(0)') && appJs2.includes('MOVE_LIMIT = 196'))

const themeJs2 = readFileSync(new URL('../src/theme.jsx', import.meta.url), 'utf-8')
assert('发现图标存储动作（144 裁切，不做白底拦截）',
  themeJs2.includes('saveDiscIcon') && themeJs2.includes(`replaceBlob(`) && themeJs2.includes("maxSize: 144"))
assert('发现图标 hook useDiscIconImgs 存在', themeJs2.includes('export function useDiscIconImgs'))
const discoverJs = readFileSync(new URL('../src/pages/Discover.jsx', import.meta.url), 'utf-8')
assert('发现页导出 14 项工具表', (discoverJs.match(/key: '/g) || []).length === 14)
assert('发现页渲染自定义图片图标', discoverJs.includes('useDiscIconImgs') && discoverJs.includes("discImgs[t.key] ? ' gi-img'"))
assert('发现页有自定义入口', discoverJs.includes('自定义图标'))
assert('发现图标不做白底限制（文案明确）', settingsJs.includes('任意背景图片均可'))

const gradle = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf-8')
assert('release 默认使用入库密钥 qingyu-release.p12', gradle.includes('qingyu-release.p12'))
assert('release buildType 固定 signingConfig（无签名包禁止发布）', gradle.includes('signingConfig signingConfigs.release'))
assert('启用 v1/v2/v3 签名方案', gradle.includes('enableV3Signing') && gradle.includes('v2SigningEnabled true'))
assert('版本 versionCode 16 / 1.6.8', gradle.includes('versionCode 16') && gradle.includes('versionName "1.6.8"'))
const workflow = readFileSync(new URL('../.github/workflows/android.yml', import.meta.url), 'utf-8')
assert('CI 始终构建 release APK（Secrets 仅用于可选覆盖）',
  workflow.includes('./gradlew assembleRelease')
  && (workflow.match(/if: steps\.keystore_check\.outputs\.has/g) || []).length === 1)
assert('Release 固定挂 release 包（不回退 debug）', workflow.includes('apk/release/*.apk | head -n1') && !workflow.includes('apk/debug/*.apk | head'))
assert('签名密钥随仓库入库', existsSync(new URL('../android/app/qingyu-release.p12', import.meta.url)))

const notifyJava = readFileSync(new URL('../android/app/src/main/java/com/qingyu/ledger/NotifyCatchService.java', import.meta.url), 'utf-8')
assert('服务提取 EXTRA_BIG_TEXT / MessagingStyle',
  notifyJava.includes('EXTRA_BIG_TEXT') && notifyJava.includes('lastMessagingText') && notifyJava.includes('android.messages'))
assert('断开后主动 requestRebind 自愈', notifyJava.includes('requestRebind'))
const pluginJava = readFileSync(new URL('../android/app/src/main/java/com/qingyu/ledger/NotifyCatchPlugin.java', import.meta.url), 'utf-8')
assert('插件提供 testEmit 端到端测试方法', pluginJava.includes('public void testEmit') && pluginJava.includes('emit(title, text, pkg)'))
assert('连接状态变化推 listening 事件', pluginJava.includes('notifyListeners("listening"'))
assert('caught 事件不做滞留投递（避免打开 App 弹旧账）', pluginJava.includes('notifyListeners("caught", data, false)'))
const notifyJs = readFileSync(new URL('../src/notifyCatch.js', import.meta.url), 'utf-8')
assert('JS 桥暴露 testNotifyEmit', notifyJs.includes('export async function testNotifyEmit') && notifyJs.includes('P.testEmit'))
assert('设置页含文案识别沙盒', settingsJs.includes('notify-sandbox') && settingsJs.includes('文案识别测试'))

const iconXml = readFileSync(new URL('../android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml', import.meta.url), 'utf-8')
assert('自适应图标引用 PNG 前/后景（无 inset，全幅构图）',
  iconXml.includes('@mipmap/ic_launcher_foreground') && !iconXml.includes('inset'))
assert('各密度图标齐备（xxxhdpi 前景/后景/方/圆）',
  existsSync(new URL('../android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', import.meta.url))
  && existsSync(new URL('../android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png', import.meta.url))
  && existsSync(new URL('../android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png', import.meta.url)))
assert('PWA 图标已替换（文件非空且非旧 SVG emoji 占位）',
  existsSync(new URL('../public/icon-192.png', import.meta.url)) && readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf-8').includes('data:image/png;base64'))
const iconBg = readFileSync(new URL('../android/app/src/main/res/values/ic_launcher_background.xml', import.meta.url), 'utf-8')
assert('自适应图标底色为新蓝 #556197', iconBg.includes('#556197'))
const manifestAndroid = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf-8')
assert('Manifest 使用 mipmap 图标', manifestAndroid.includes('@mipmap/ic_launcher'))

console.log(failed === 0 ? `\n全部通过：${passed} 项` : `\n${failed} 项失败`)
process.exit(failed ? 1 : 0)
