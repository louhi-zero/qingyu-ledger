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
import {
  compareVersions, normalizeVersion, pickUpdateAssets, parseRelease,
  shouldAutoCheck, APP_VERSION,
} from '../src/update.js'
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
assert('版本 versionCode 18 / 1.7.0', gradle.includes('versionCode 18') && gradle.includes('versionName "1.7.0"'))
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

// ---------- 9. v1.6.9 账本图标 / 首页切换 / 记账选账本 / 个性化预览 ----------
console.log('v1.6.9 账本图标·切换·记账选账本：')
assert('出厂默认含 bookIconAt 空表', es.settings.bookIconAt && typeof es.settings.bookIconAt === 'object' && !Array.isArray(es.settings.bookIconAt))
assert('迁移归一 bookIconAt（非对象兜底空表）', storeJs.includes("s.settings.bookIconAt || typeof s.settings.bookIconAt !== 'object'"))
assert('账本图标存储动作（128 裁切，任意背景）',
  themeJs2.includes('saveBookIcon') && themeJs2.includes("maxSize: 128, quality: 0.88"))
assert('账本图标 hook useBookIconUrl + BookIconImg 组件（单账本 hook，规避变长数组 hooks 违规）',
  themeJs2.includes('export function useBookIconUrl') && themeJs2.includes('export function BookIconImg')
  && !themeJs2.includes('useBookIconImgs'))
const ledgersJs = readFileSync(new URL('../src/pages/Ledgers.jsx', import.meta.url), 'utf-8')
assert('账本编辑弹层支持上传自定义图标', ledgersJs.includes('saveBookIcon(edit.id, f)') && ledgersJs.includes('上传自定义图标'))
assert('账本列表渲染自定义图片图标（图片优先）', ledgersJs.includes('useBookIconUrl') && ledgersJs.includes('gi-img'))
assert('删除账本时清理图标 Blob', ledgersJs.includes('replaceBlob(`bookicon_${delId}`, null)'))
const homeJs = readFileSync(new URL('../src/pages/Home.jsx', import.meta.url), 'utf-8')
assert('首页顶部账本切换器（胶囊按钮 + 箭头）', homeJs.includes('ledger-switch') && homeJs.includes('切换账本'))
assert('首页切换弹层点击即切 + 管理入口', homeJs.includes('d.currentLedgerId = l.id') && homeJs.includes('nav.push({ page: \'ledgers\''))
const addTxJs = readFileSync(new URL('../src/pages/AddTx.jsx', import.meta.url), 'utf-8')
assert('记账默认当前账本、编辑取账单原账本', addTxJs.includes('editTx?.ledgerId || state.currentLedgerId'))
assert('保存落入所选账本（payload 携带 ledgerId）', addTxJs.includes('ledgerId: ledgerId || state.currentLedgerId'))
assert('记账页账本选择弹层（存入哪个账本）', addTxJs.includes('存入哪个账本') && addTxJs.includes('setLedgerId(l.id)'))
const css2 = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf-8')
assert('个性化预览卡样式齐备（skin-grid/卡/缩略图）',
  css2.includes('.skin-grid') && css2.includes('.skin-card') && css2.includes('.skin-thumb'))
assert('账本切换器样式齐备（ledger-switch/bookicon）', css2.includes('.ledger-switch') && css2.includes('.bookicon-preview'))
const pkgJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))
assert('package.json 版本 1.7.0', pkgJson.version === '1.7.0')
for (const f of ['Settings.jsx', 'Profile.jsx', 'CloudBackup.jsx']) {
  const src = readFileSync(new URL(`../src/pages/${f}`, import.meta.url), 'utf-8')
  assert(`版本单一源 ${f} 引用 APP_VERSION（无硬编码版本号）`,
    src.includes("from '../update.js'") && /APP_VERSION/.test(src) && !/1\.6\.9|1\.6\.8/.test(src))
}

// ---------- 10. v1.7.0 应用内更新（版本比较/资产挑选/release 解析/纯 JS 可测链路） ----------
console.log('v1.7.0 应用内更新：')
assert('normalizeVersion 去 v 前缀与空白', normalizeVersion(' v1.7.0 ') === '1.7.0')
assert('版本比较：新版更大', compareVersions('1.7.0', '1.6.9') === 1)
assert('版本比较：带 v 前缀相等', compareVersions('v1.7.0', '1.7.0') === 0)
assert('版本比较：1.10.0 > 1.9.0（位数陷阱）', compareVersions('v1.10.0', '1.9.0') === 1)
assert('版本比较：旧版更小', compareVersions('1.6.0', '1.7.0') === -1)
assert('版本比较：位长不一 1.7 < 1.7.1', compareVersions('1.7', '1.7.1') === -1)
assert('版本比较：非法版本按 0 处理不崩溃', compareVersions('abc', '1.0.0') === -1)

const fakeAssets = [
  { name: 'qingyu-v1.7.0-android.apk.sha256', browser_download_url: 'https://x/1.sha256', created_at: '2026-10-01' },
  { name: 'other.txt', browser_download_url: 'https://x/other.txt' },
  { name: 'qingyu-v1.7.0-android.apk', browser_download_url: 'https://x/1.apk', size: 5242880, created_at: '2026-10-01' },
]
const picked = pickUpdateAssets(fakeAssets)
assert('资产挑选：选中 -android.apk', picked.apk?.name === 'qingyu-v1.7.0-android.apk')
assert('资产挑选：配对同名 .sha256 校验文件', picked.sha256?.browser_download_url === 'https://x/1.sha256')
assert('资产挑选：无 APK → 双 null', pickUpdateAssets([{ name: 'a.txt' }]).apk === null
  && pickUpdateAssets([]).sha256 === null)

const fakeRelease = {
  tag_name: 'v9.9.9', name: 'v9.9.9', body: '## 更新内容\n**修复**若干问题', draft: false, prerelease: false,
  published_at: '2026-10-01T08:00:00Z', assets: fakeAssets,
}
const parsed = parseRelease(fakeRelease, '1.7.0')
assert('parseRelease：高版本返回完整信息（tag/notes/size/sha256Url）',
  parsed && parsed.version === '9.9.9' && parsed.apkUrl === 'https://x/1.apk'
  && parsed.size === 5242880 && parsed.sha256Url === 'https://x/1.sha256' && parsed.publishedAt === '2026-10-01')
assert('parseRelease：草稿/预发布不更新', parseRelease({ ...fakeRelease, draft: true }, '1.0.0') === null
  && parseRelease({ ...fakeRelease, prerelease: true }, '1.0.0') === null)
assert('parseRelease：版本不高于当前 → null', parseRelease(fakeRelease, '9.9.9') === null
  && parseRelease(fakeRelease, '10.0.0') === null)
assert('parseRelease：非法 tag/无 APK → null',
  parseRelease({ tag_name: 'latest', assets: fakeAssets }, '1.0.0') === null
  && parseRelease({ tag_name: 'v1.1.0', assets: [] }, '1.0.0') === null)

const TTL = 60 * 60 * 1000
assert('自动检查节流：无记录/超 1 小时才检查，期内跳过',
  shouldAutoCheck(0, TTL) === true
  && shouldAutoCheck(1000, 1000 + TTL + 1) === true
  && shouldAutoCheck(1000, 1000 + TTL - 1) === false)

// 源码级安全断言（对标 NexBox 风险清单）
const updateJs = readFileSync(new URL('../src/update.js', import.meta.url), 'utf-8')
assert('更新模块无硬编码访问令牌（规避 NexBox P1）',
  !/Bearer\s+[A-Za-z0-9-]{8,}/.test(updateJs) && !/WmAt/.test(updateJs))
assert('更新源为 GitHub Releases 官方 API（公开仓库匿名）', updateJs.includes('api.github.com/repos'))
assert('Web/Electron 外链兜底（打开 Release 页）', updateJs.includes("window.open(url, '_blank'"))
assert('测试钩子 window.__qyUpdateBridge 可注入 mock 桥', updateJs.includes('__qyUpdateBridge'))

const updateCtxJsx = readFileSync(new URL('../src/update-ctx.jsx', import.meta.url), 'utf-8')
assert('更新状态机含 下载/校验/就绪/失败 全相位',
  ['downloading', 'verifying', 'ready', 'error'].every((s) => updateCtxJsx.includes(`'${s}'`)))
assert('SHA-256 不符：取消并删除文件（不止字节数校验）',
  updateCtxJsx.includes('fetchSha256') && updateCtxJsx.includes('cancelApkDownload()')
  && updateCtxJsx.includes('SHA-256 不一致'))
assert('无轮询定时器（启动一次 + 手动，同 NexBox 克制策略）', !updateCtxJsx.includes('setInterval'))
assert('「以后再说」按版本静默（dismissed tag）', updateCtxJsx.includes('markDismissed')
  && updateCtxJsx.includes('dismissedTag()'))
assert('下载进度只涨不跌（Math.max）', updateCtxJsx.includes('pct > progressRef.current'))
assert('关闭自动下载开关立即取消进行中任务', updateCtxJsx.includes("status === 'downloading'"))
assert('出厂默认 updateAutoDl=true + 迁移兜底',
  emptyState().settings.updateAutoDl === true
  && storeJs.includes("typeof s.settings.updateAutoDl !== 'boolean'"))

const updatePluginJava = readFileSync(new URL('../android/app/src/main/java/com/qingyu/ledger/UpdatePlugin.java', import.meta.url), 'utf-8')
assert('原生下载：边下边算 SHA-256（MessageDigest）', updatePluginJava.includes('MessageDigest.getInstance("SHA-256")'))
assert('原生下载：AtomicBoolean 可取消 + 取消删半成品',
  updatePluginJava.includes('AtomicBoolean') && updatePluginJava.includes('CANCEL.set(true)') && updatePluginJava.includes('outFile.delete()'))
assert('原生下载：手动跟随重定向（GitHub release 302）',
  updatePluginJava.includes('setInstanceFollowRedirects(false)') && updatePluginJava.includes('openWithRedirects'))
assert('原生下载：Content-Length 字节数校验 + sync 刷盘',
  updatePluginJava.includes('SIZE_MISMATCH') && updatePluginJava.includes('getFD().sync()'))
assert('原生下载：进度 200ms 节流防跳闪', updatePluginJava.includes('200'))
assert('安装：FileProvider + 未知来源授权判定/引导',
  updatePluginJava.includes('FileProvider.getUriForFile') && updatePluginJava.includes('canRequestPackageInstalls')
  && updatePluginJava.includes('ACTION_MANAGE_UNKNOWN_APP_SOURCES')
  && updatePluginJava.includes('application/vnd.android.package-archive'))
assert('安装：canonical path 穿越防护 + 只接受 https',
  updatePluginJava.includes('getCanonicalPath().startsWith') && updatePluginJava.includes('startsWith("https://")'))

const manifestUpd = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf-8')
assert('Manifest 声明 REQUEST_INSTALL_PACKAGES', manifestUpd.includes('android.permission.REQUEST_INSTALL_PACKAGES'))
const filePaths = readFileSync(new URL('../android/app/src/main/res/xml/file_paths.xml', import.meta.url), 'utf-8')
assert('FileProvider 覆盖 app-specific Download 目录', filePaths.includes('<external-files-path') && filePaths.includes('Download/'))
const mainAct = readFileSync(new URL('../android/app/src/main/java/com/qingyu/ledger/MainActivity.java', import.meta.url), 'utf-8')
assert('MainActivity 注册 AppUpdate 插件', mainAct.includes('registerPlugin(UpdatePlugin.class)'))
assert('CI 随包生成并上传 .sha256', workflow.includes('sha256sum') && workflow.includes('.apk.sha256'))
assert('update.js 版本单一源为 1.7.0', APP_VERSION === '1.7.0')

console.log(failed === 0 ? `\n全部通过：${passed} 项` : `\n${failed} 项失败`)
process.exit(failed ? 1 : 0)
