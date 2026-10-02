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
import {
  collectProfile, buildArchive, validateArchive, shouldUpload,
  parseProfileArchive, profilePatch, PROFILE_ARCHIVE_KIND,
} from '../src/userarchive.js'
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

// v1.7.1 震动强度 UI：可视化档位卡片替换拥挤的分段控件
assert('震动强度改为 VibrateCard 组件', settingsJs.includes('function VibrateCard'))
assert('四档元数据（关/轻柔/标准/明快）', settingsJs.includes('VIBRATE_LEVELS') && settingsJs.includes("label: '明快'"))
assert('波形柱可视化（vib-bars + lit 点亮）', settingsJs.includes('vib-bars') && css.includes('.vib-bars i.lit'))
assert('选中态勾选与品牌描边', css.includes('.vib-opt.on') && settingsJs.includes("vib-check"))
assert('手动试震按钮', settingsJs.includes('vib-test') && settingsJs.includes('感受一下这个档位'))
assert('旧 vibrate-cell 拥挤布局已移除', !settingsJs.includes('vibrate-cell') && !css.includes('.vibrate-cell'))
// v1.10.1 防拥挤：2×2 网格（每格 ~150px 挤压描述省略）改单列全宽，描述完整展示
assert('震动档位单列全宽布局（防拥挤，描述不再省略）',
  css.includes(".vib-opts { display: grid; grid-template-columns: 1fr; gap: 8px; }")
  && !css.includes('grid-template-columns: 1fr 1fr; gap: 8px'))
assert('描述字号回到可读范围（11.5px，无省略号截断）',
  css.includes('font-size: 11.5px; line-height: 1.4; color: var(--ink3);')
  && !/\.vib-meta i[^}]*text-overflow/.test(css))

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
assert('版本 versionCode 24 / 2.0.0', gradle.includes('versionCode 24') && gradle.includes('versionName "2.0.0"'))
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
assert('package.json 版本 2.0.0', pkgJson.version === '2.0.0')
// v1.10.0 起快照版本号由 syncOnce 打包，CloudBackup 不再直接引用 APP_VERSION
for (const f of ['Settings.jsx', 'Profile.jsx']) {
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
assert('出厂默认 updateAutoDl=false（发现新版先询问）+ 迁移兜底',
  emptyState().settings.updateAutoDl === false
  && storeJs.includes("typeof s.settings.updateAutoDl !== 'boolean'"))

// v1.7.1 可视化安装组件：用户选择 → 静默仅下载 APK → 用户点击安装
assert('导出 UpdatePrompt 可视化安装组件',
  updateCtxJsx.includes('export function UpdatePrompt') && updateCtxJsx.includes("className=\"upd-modal\""))
assert('旧 UpdateSheetCenter 已移除（单一更新 UI）', !updateCtxJsx.includes('UpdateSheetCenter'))
assert('发现新版默认弹窗询问（autoDl 关/手动均打开 prompt）',
  updateCtxJsx.includes('setPromptOpen(true)'))
assert('仅 autoDl 显式开启才静默预下载',
  updateCtxJsx.includes('autoDlRef.current') && updateCtxJsx.includes("=== true"))
assert('用户点「立即更新」才开始下载', updateCtxJsx.includes('立即更新'))
assert('静默边界文案：只下载安装包、不会自动安装',
  updateCtxJsx.includes('不会自动安装') && updateCtxJsx.includes('仅静默下载安装包'))
assert('就绪态由用户点击「立即安装」触发（无 useEffect 自动安装）',
  updateCtxJsx.includes('立即安装')
  && !/useEffect\(\(\)\s*=>\s*\{?[^}]*install\(/.test(updateCtxJsx))
assert('下载可视化：环形进度 + 百分比', updateCtxJsx.includes('upd-ring') && updateCtxJsx.includes('ur-pct'))
assert('App.jsx 挂载 UpdatePrompt（替代 Sheet 中心）',
  appJs2.includes('UpdatePrompt') && !appJs2.includes('UpdateSheetCenter'))
const css3 = css
assert('弹窗样式齐备（遮罩/卡片/状态头像/进度环）',
  css3.includes('.upd-mask') && css3.includes('.upd-modal') && css3.includes('.upd-hero') && css3.includes('.ur-fill'))

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
assert('update.js 版本单一源为 2.0.0', APP_VERSION === '2.0.0')

// ---------- 9. v1.8.0 AI 风格卡（纯函数 + 源码断言） ----------
console.log('v1.8.0 AI 回复风格卡：')
const {
  STYLE_ATTRS, normalizeStyleAttrs, composeStylePrompt, styleAttrsDesc,
  validateStyleCard, buildWikiUrls,
} = await import('../src/stylecard.js')
const styleKeyOf2 = (await import('../src/utils.js')).styleKeyOf
assert('styleKeyOf 规范化：去空白/间隔符 + 小写',
  styleKeyOf2('  芙宁娜 ') === '芙宁娜' && styleKeyOf2('Furina·de·Fontaine') === 'furinadefontaine'
  && styleKeyOf2("NEUviLlette.") === 'neuvillette')
assert('自定义参数四维齐全（语气5/正式度3/篇幅3/结构3）',
  STYLE_ATTRS.tone.length === 5 && STYLE_ATTRS.formality.length === 3 && STYLE_ATTRS.length.length === 3 && STYLE_ATTRS.structure.length === 3)
assert('normalizeStyleAttrs：非法入参回落默认 + 非法选项逐维修正',
  JSON.stringify(normalizeStyleAttrs(null)) === JSON.stringify({ tone: 'gentle', formality: 'balanced', length: 'std', structure: 'para' })
  && normalizeStyleAttrs({ tone: 'oops', formality: 'formal' }).tone === 'gentle'
  && normalizeStyleAttrs({ tone: 'oops', formality: 'formal' }).formality === 'formal')
assert('composeStylePrompt：四维选择全部拼入提示词',
  composeStylePrompt({ tone: 'humor', formality: 'casual', length: 'short', structure: 'list' }).includes('轻松幽默')
  && composeStylePrompt({ tone: 'humor', formality: 'casual', length: 'short', structure: 'list' }).includes('要点列表'))
assert('composeStylePrompt：未知维度回落第一项不崩溃',
  composeStylePrompt({}).includes('温柔友善') && composeStylePrompt(undefined).includes('温柔友善'))
assert('styleAttrsDesc：标签点号拼接', styleAttrsDesc({ tone: 'sharp', formality: 'formal', length: 'detail', structure: 'mix' }) === '犀利 · 正式 · 详尽 · 混合')

// 校验协议
const goodCard = {
  name: '芙宁娜', title: '不休独舞 · 原神', emoji: '🌊',
  traits: ['戏剧化', '自尊心强', '口是心非'],
  speech: ['自称「本小姐」', '夸张的感叹句式', '爱提「审判」'],
  tone: '浮夸戏剧化，傲娇但心软', vocab: ['审判！', '本小姐'],
  usage: '适合轻松场景', prompt: '你将以芙宁娜的口吻进行财务分析：自称本小姐，把每期账单当成一场审判现场，用夸张戏剧化的句式点评，但数据结论必须严谨，不人身攻击。',
}
const vc = validateStyleCard(goodCard, '芙宁娜')
assert('validateStyleCard：合法卡通过并归一', !!vc && vc.name === '芙宁娜' && vc.traits.length === 3 && vc.prompt.length >= 40)
assert('validateStyleCard：超长字段截断', validateStyleCard({ ...goodCard, title: 'x'.repeat(60) }, '芙宁娜').title.length === 24)
assert('validateStyleCard：角色名对不上 → 拒绝', validateStyleCard(goodCard, '钟离') === null)
assert('validateStyleCard：名字双向包含容忍（芙宁娜(Furina)）', !!validateStyleCard({ ...goodCard, name: '芙宁娜(Furina)' }, '芙宁娜'))
assert('validateStyleCard：性格特质不足 2 条 → 拒绝', validateStyleCard({ ...goodCard, traits: ['只有一条'] }, '芙宁娜') === null)
assert('validateStyleCard：指令过短 → 拒绝', validateStyleCard({ ...goodCard, prompt: '太短' }, '芙宁娜') === null)
assert('validateStyleCard：非对象 → 拒绝', validateStyleCard(null, '芙宁娜') === null && validateStyleCard('x', '芙宁娜') === null)

// 维基检索 URL 构造
const wu = buildWikiUrls('芙宁娜')
assert('buildWikiUrls：MediaWiki 检索/摘录端点 + CORS origin=*',
  wu.search.startsWith('https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=')
  && wu.search.includes('origin=*')
  && wu.extract('芙宁娜').includes('prop=extracts&explaintext=1&exintro=1')
  && decodeURIComponent(wu.search).includes('芙宁娜'))

// 源码断言：两阶段生成 / 缓存 / 平台选路 / 无循环依赖
const stylecardSrc = readFileSync(new URL('../src/stylecard.js', import.meta.url), 'utf-8')
const aiSrc = readFileSync(new URL('../src/ai.js', import.meta.url), 'utf-8')
const aiSettingsSrc = readFileSync(new URL('../src/pages/AiSettings.jsx', import.meta.url), 'utf-8')
const aiInsightSrc = readFileSync(new URL('../src/pages/AiInsight.jsx', import.meta.url), 'utf-8')
const settingsSrc = readFileSync(new URL('../src/pages/Settings.jsx', import.meta.url), 'utf-8')
assert('两阶段生成：先缓存检查，再检索，再 AI 合成',
  stylecardSrc.indexOf('getCachedCard(name)') < stylecardSrc.indexOf("onPhase?.('search'") && stylecardSrc.indexOf("onPhase?.('search'") < stylecardSrc.indexOf("onPhase?.('generate'"))
assert('缓存命中免检索免生成（90% 提速）', stylecardSrc.includes('cached: true'))
assert('校验不过带原因重试一次', stylecardSrc.includes('for (let i = 0; i < 2; i++)') && stylecardSrc.includes('上次输出未通过校验'))
assert('检索失败降级模型知识，不阻断', stylecardSrc.includes('未检索到') && stylecardSrc.includes('return null // 网络失败'))
assert('ai.js 不 import stylecard（避免循环依赖）', !aiSrc.includes('from \'./stylecard.js\''))
assert('buildMessages 支持 custom/char 双模式',
  aiSrc.includes("mode === 'custom'") && aiSrc.includes("mode === 'char'")
  && aiSrc.includes('qingyu_style_cards_v1') && aiSrc.includes('角色卡缓存丢失时的优雅回落'))
assert('ATTRS_TABLE 与 STYLE_ATTRS 提示词逐条一致',
  Object.entries(STYLE_ATTRS).every(([k, list]) => list.every((x) => aiSrc.includes(`${x.id}: '${x.prompt}'`))))
assert('postText 已导出供风格卡生成复用', aiSrc.includes('export async function postText'))
assert('平台钩子 __qyForceWeb 强制 web 路径（便于冒烟 mock）', aiSrc.includes('__qyForceWeb'))
assert('AI 设置页：三模式切换 + 预设可视化卡片',
  aiSettingsSrc.includes('🎭 预设') && aiSettingsSrc.includes('🎛️ 自定义') && aiSettingsSrc.includes('✨ 角色扮演')
  && aiSettingsSrc.includes('style-cards') && aiSettingsSrc.includes('stc-check'))
assert('AI 设置页：角色两阶段进度与缓存徽标',
  aiSettingsSrc.includes('① 联网检索角色资料') && aiSettingsSrc.includes('② AI 合成风格卡')
  && aiSettingsSrc.includes('已命中本机缓存') && aiSettingsSrc.includes('char-cached'))
assert('AI 设置页：自定义参数实时预览卡', aiSettingsSrc.includes('sc-preview') && aiSettingsSrc.includes('styleAttrsDesc'))
assert('AI 分析页：当前风格徽标可见 + 直达设置',
  aiInsightSrc.includes('ai-style-pill') && aiInsightSrc.includes('activeStyleInfo'))
assert('风格卡样式齐备（卡片/参数行/进度/徽标）',
  css.includes('.sc-view') && css.includes('.attrs-row') && css.includes('.char-spin') && css.includes('.ai-style-pill'))
assert('出厂默认：aiStyleAttrs 四维 + aiCharName 空',
  JSON.stringify(es.settings.aiStyleAttrs) === JSON.stringify({ tone: 'gentle', formality: 'balanced', length: 'std', structure: 'para' })
  && es.settings.aiCharName === '')
const storeSrc = readFileSync(new URL('../src/store.jsx', import.meta.url), 'utf-8')
assert('迁移兜底：aiStyleAttrs 非法对象重建 + aiCharName 字符串化',
  storeSrc.includes('aiStyleAttrs') && storeSrc.includes("typeof s.settings.aiCharName !== 'string'"))
assert('UI 审计修复：月份切换/图标按钮触达 36/38px + ink3 对比度提升',
  css.includes('.ymnav button { width: 36px; height: 36px; }') && css.includes('.iconbtn { width: 38px; height: 38px; }')
  && css.includes('--ink3: #878f9f'))

// ---------- 10. v1.9.0 用户资料云存档（纯函数 + 源码断言） ----------
console.log('v1.9.0 用户资料云存档：')
const profileSrc = readFileSync(new URL('../src/userarchive.js', import.meta.url), 'utf-8')
const cloudSrc = readFileSync(new URL('../src/pages/CloudBackup.jsx', import.meta.url), 'utf-8')

// collectProfile 严格挑字段
const fakeSettings = { nickname: '小明', avatar: '🐣', avatarPhotoAt: '2026-10-01T00:00:00Z', dark: true, hideAmount: true, nickname2: '杂鱼' }
assert('collectProfile 只挑昵称/头像三字段，不带其他设置',
  JSON.stringify(Object.keys(collectProfile(fakeSettings))) === JSON.stringify(['nickname', 'avatar', 'avatarPhotoAt']))
assert('collectProfile 非法类型归一（坏昵称→空串、坏时间戳→null）',
  collectProfile({ nickname: 123, avatar: 456, avatarPhotoAt: 789 }).nickname === ''
  && collectProfile({ nickname: 123, avatar: 456, avatarPhotoAt: 789 }).avatar === ''
  && collectProfile({ nickname: 123, avatar: 456, avatarPhotoAt: 789 }).avatarPhotoAt === null)

// buildArchive 打包信封
const penv = buildArchive({ nickname: '小明', avatar: '🐣', avatarPhotoAt: null }, 'dev-001', '1.9.0', '2026-10-02T00:00:00Z')
assert('buildArchive 信封结构（app/kind/at/deviceId/data）',
  penv.app === 'qingyu' && penv.kind === PROFILE_ARCHIVE_KIND && penv.at === '2026-10-02T00:00:00Z'
  && penv.deviceId === 'dev-001' && penv.data.nickname === '小明')

// validateArchive 上传前校验协议
assert('validateArchive：合法包通过', validateArchive(penv) === '')
assert('validateArchive：非对象拒绝', validateArchive(null) !== '' && validateArchive('x') !== '' && validateArchive([]) !== '')
assert('validateArchive：类型不符拒绝', validateArchive({ ...penv, kind: 'other' }) !== '')
assert('validateArchive：缺数据体拒绝', validateArchive({ ...penv, data: null }) !== '')
assert('validateArchive：空昵称拒绝', validateArchive({ ...penv, data: { ...penv.data, nickname: '  ' } }) !== '')
assert('validateArchive：超长昵称（33 字）拒绝', validateArchive({ ...penv, data: { ...penv.data, nickname: '超'.repeat(33) } }) !== '')
assert('validateArchive：头像时间戳非法拒绝', validateArchive({ ...penv, data: { ...penv.data, avatarPhotoAt: 123 } }) !== '')
assert('validateArchive：超体积包拒绝',
  validateArchive({ ...penv, data: { ...penv.data, nickname: 'x', avatar: '囍'.repeat(70 * 1024) } }) !== '')

// shouldUpload 变更检测（只上传真正变化过的资料）
assert('shouldUpload：从未上传过 → 上传（首次建档）', shouldUpload(penv.data, null) === true)
assert('shouldUpload：与上次记录一致 → 跳过（0 请求前提）', shouldUpload(penv.data, { at: 'x', data: penv.data }) === false)
assert('shouldUpload：昵称变化 → 上传', shouldUpload({ ...penv.data, nickname: '新名' }, { data: penv.data }) === true)
assert('shouldUpload：头像时间戳变化 → 上传',
  shouldUpload({ ...penv.data, avatarPhotoAt: '2026-10-02T01:00:00Z' }, { data: penv.data }) === true)

// parseProfileArchive + profilePatch（从云端恢复联动）
assert('parseProfileArchive：合法档案通过', parseProfileArchive(JSON.stringify(penv))?.data.nickname === '小明')
assert('parseProfileArchive：脏 JSON/类型不符/校验不过 → null',
  parseProfileArchive('{oops') === null
  && parseProfileArchive(JSON.stringify({ ...penv, kind: 'x' })) === null
  && parseProfileArchive(JSON.stringify({ ...penv, data: { ...penv.data, nickname: '' } })) === null)
assert('profilePatch：提取三字段补丁且昵称去首尾空白',
  JSON.stringify(profilePatch(penv)) === JSON.stringify({ nickname: '小明', avatar: '🐣', avatarPhotoAt: null }))
assert('profilePatch：非法档案 → null', profilePatch({ ...penv, kind: 'x' }) === null)

// 源码断言：触发链路与 UI
assert('store.jsx 订阅资料签名（stableJson + collectProfile + syncProfileArchive）',
  storeSrc.includes('profileSig') && storeSrc.includes('collectProfile') && storeSrc.includes('syncProfileArchive'))
assert('冷启动 6s 自愈 + 资料变化 2.5s 防抖', storeSrc.includes('isFirst ? 6000 : 2500'))
assert('云备份页：用户资料云存档 cell + 手动存档（含未变化/未配置反馈）',
  cloudSrc.includes('用户资料云存档') && cloudSrc.includes('onProfileSync')
  && cloudSrc.includes('资料未变化，云端已是最新') && cloudSrc.includes('请先在上方填写 WebDAV 文件地址'))
assert('从云端恢复联动资料档案（parseProfileArchive/profilePatch 对齐昵称头像）',
  cloudSrc.includes('parseProfileArchive') && cloudSrc.includes('profilePatch') && cloudSrc.includes('资料档案'))
assert('档案不含账单数据（userarchive.js 无 transactions 引用）', !profileSrc.includes('transactions'))
assert('未配置 WebDAV 静默跳过（not-configured）', profileSrc.includes("status: 'skipped', reason: 'not-configured'"))
assert('失败原因记录到本机（qingyu_profile_sync_v1.error）',
  profileSrc.includes('error: { at: new Date().toISOString(), message') && profileSrc.includes('LS_PROFILE_SYNC'))

// ---------- 11. v1.10.0 账单自动同步（runAutoSync 编排：登录导入 + 变化自动上传） ----------
console.log('v1.10.0 账单自动同步：')

// node 无 localStorage：先装 mock 再动态加载 autosync（getWebdavCfg/getDeviceId 走 localStorage）
const lsStore = new Map()
globalThis.localStorage = {
  getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: (k) => lsStore.delete(k),
}
const auto = await import('../src/autosync.js')
const ua11 = await import('../src/userarchive.js')

// 假云端：Map 文件存储 + ETag 乐观锁（put 带 If-Match，错配抛 412；getFile/putFile 服务图片资产与档案）
function fakeCloud11() {
  const files = new Map()
  let etagN = 0
  const stats = { gets: 0, puts: 0, lastPutBody: null }
  const nextEtag = () => 'w' + (++etagN)
  const transportFor = (cfgUrl) => {
    const name = cfgUrl.split('/').pop() || 'backup.json'
    return {
      async get() {
        stats.gets++
        const f = files.get(name)
        return f ? { env: f.text, etag: f.etag } : null
      },
      async put(text, etag) {
        const f = files.get(name)
        if (etag && f && f.etag !== etag) { const e = new Error('云端已被其他设备更新'); e.status = 412; throw e }
        stats.puts++
        stats.lastPutBody = text
        files.set(name, { text, etag: nextEtag() })
        return { status: 201 }
      },
      async getFile(n) { const f = files.get(n); return f ? f.text : null },
      async putFile(n, text) { files.set(n, { text, etag: nextEtag() }); return { status: 201 } },
    }
  }
  return { files, stats, transportFor }
}

const CFG_URL11 = 'http://fake.cloud/dav/qingyu/backup.json'
const setCfg11 = () => lsStore.set('qingyu_sync_cfg_v1', JSON.stringify({ url: CFG_URL11, username: 'u', password: 'p' }))
// 预置资料档案记录与 state 一致 → runAutoSync 顺带的 syncProfileArchive 走 unchanged（0 请求，不真发网络）
const seedProfileRec11 = (state) => lsStore.set(
  ua11.LS_PROFILE_SYNC,
  JSON.stringify({ at: 'seed', deviceId: 'seed', data: collectProfile(state.settings), error: null }),
)
const mkSnapshotEnv = (data, deviceId) => ({
  app: 'qingyu', kind: 'qingyu-cloud-v1', appVersion: '1.9.0',
  at: '2026-10-02T00:00:00Z', deviceId, data,
})
// 场景隔离：清掉上一场景留下的 base/last（真实场景里 restore=全新安装无 base）
const clearSyncLS11 = () => { lsStore.delete(auto.LS_BASE); lsStore.delete(auto.LS_LAST) }

// ① 未配置 → skipped
{
  const fake = fakeCloud11()
  lsStore.delete('qingyu_sync_cfg_v1')
  const r = await auto.runAutoSync({ state: emptyState(), restoreState: () => true, toast: null, silent: true, transport: fake.transportFor(CFG_URL11) })
  assert('未配置 WebDAV → skipped（不产生任何请求）',
    r.status === 'skipped' && r.reason === 'not-configured' && fake.stats.gets === 0 && fake.stats.puts === 0)
}

// ② 本机有数据 + 云端为空 → first-upload
{
  const fake = fakeCloud11()
  setCfg11()
  clearSyncLS11()
  const s = emptyState()
  seedProfileRec11(s)
  const toasts = []
  let restored = null
  const r = await auto.runAutoSync({
    state: s, restoreState: (d) => { restored = d; return true },
    toast: (m) => toasts.push(m), silent: false, transport: fake.transportFor(CFG_URL11),
  })
  const snap = JSON.parse(fake.stats.lastPutBody || '{}')
  assert('本机有数据+云端为空 → first-upload 并 PUT 快照',
    r.status === 'ok' && r.mode === 'first-upload' && fake.stats.puts >= 1
    && snap.data?.settings?.nickname === '轻语用户')
  assert('first-upload：restoreState 已写回 + base/last 落盘',
    !!restored && JSON.parse(lsStore.get(auto.LS_BASE) || 'null')?.settings?.nickname === '轻语用户'
    && JSON.parse(lsStore.get(auto.LS_LAST) || 'null')?.mode === 'first-upload')
  assert('silent=false 成功 toast「已连接，本机数据已上传云端」',
    toasts.some((m) => m.includes('已连接，本机数据已上传云端')))
}

// ③ 空库 + 云端有数据 → restore 导入（换机场景）
{
  const fake = fakeCloud11()
  const cloudData = emptyState()
  cloudData.settings.nickname = '云端用户'
  cloudData.settings.welcomed = true
  cloudData.transactions.push({ id: 'tx-cloud-1', date: '2026-10-01', type: 'expense', amount: 66.6, note: '云端导入的测试账单', categoryId: '', accountId: '' })
  fake.files.set('backup.json', { text: JSON.stringify(mkSnapshotEnv(cloudData, 'cloud-dev')), etag: 'w-seed' })
  setCfg11()
  clearSyncLS11()
  seedProfileRec11(cloudData)
  const toasts = []
  let restored = null
  const r = await auto.runAutoSync({
    state: emptyState(), restoreState: (d) => { restored = d; return true },
    toast: (m) => toasts.push(m), silent: true, transport: fake.transportFor(CFG_URL11),
  })
  assert('空库+云端有数据 → restore 导入（换机场景）', r.status === 'ok' && r.mode === 'restore')
  assert('restore：云端账单与昵称已导入本机',
    restored?.transactions?.some((t) => t.note === '云端导入的测试账单' && t.amount === 66.6)
    && restored?.settings?.nickname === '云端用户')
  assert('restore 也回写云端快照（PUT 恒定）', fake.stats.puts >= 1)
  assert('silent=true restore 全程静默（无 toast）', toasts.length === 0)
}

// ④ base 与云端一致 + 本机新账单 → merge
{
  const fake = fakeCloud11()
  const baseData = emptyState()
  baseData.settings.welcomed = true
  fake.files.set('backup.json', { text: JSON.stringify(mkSnapshotEnv(baseData, 'cloud-dev')), etag: 'w7' })
  setCfg11()
  clearSyncLS11()
  lsStore.set(auto.LS_BASE, JSON.stringify(baseData)) // 上次同步的 base 与云端一致
  seedProfileRec11(baseData)
  const local = JSON.parse(JSON.stringify(baseData))
  local.transactions.push({ id: 'tx-local-1', date: '2026-10-02', type: 'expense', amount: 12.5, note: '本机新增的账单', categoryId: '', accountId: '' })
  const r = await auto.runAutoSync({
    state: local, restoreState: () => true, toast: null, silent: true, transport: fake.transportFor(CFG_URL11),
  })
  assert('base 与云端一致 + 本机新账单 → merge 模式', r.status === 'ok' && r.mode === 'merge')
  assert('merge：本机新账单已合并并推上云端',
    fake.stats.lastPutBody.includes('本机新增的账单')
    && JSON.parse(lsStore.get(auto.LS_BASE) || 'null')?.transactions?.some((t) => t.note === '本机新增的账单'))
}

// ⑤⑥⑦ 失败路径
{
  setCfg11()
  const r = await auto.runAutoSync({
    state: emptyState(), restoreState: () => true, toast: null, silent: true,
    transport: { get: async () => { throw new Error('网络断了') } },
  })
  const last = JSON.parse(lsStore.get(auto.LS_LAST) || 'null')
  assert('transport 抛错 → status error', r.status === 'error' && r.message.includes('网络断了'))
  assert('失败记录落盘 LS_LAST.error（含时间与消息）',
    last?.error?.message === '网络断了' && typeof last?.error?.at === 'string')
  const toasts = []
  await auto.runAutoSync({
    state: emptyState(), restoreState: () => true, toast: (m, t) => toasts.push([m, t]), silent: false,
    transport: { get: async () => { throw new Error('密码不对') } },
  })
  assert('silent=false 失败 toast「同步失败」', toasts.some(([m, t]) => m.includes('同步失败') && t === 'err'))
  const r3 = await auto.runAutoSync({
    state: emptyState(), restoreState: () => false, toast: null, silent: true,
    transport: fakeCloud11().transportFor(CFG_URL11),
  })
  assert('restoreState 拒绝写入 → error 不落库', r3.status === 'error' && r3.message.includes('校验失败'))
}

// 源码断言：订阅触发链路与 UI
const autoSrc = readFileSync(new URL('../src/autosync.js', import.meta.url), 'utf-8')
const profileSrc11 = readFileSync(new URL('../src/pages/Profile.jsx', import.meta.url), 'utf-8')
assert('store.jsx 订阅数据签名 dataSig（stableJson）驱动自动同步',
  storeSrc.includes('const dataSig = useMemo(() => stableJson(state), [state])') && storeSrc.includes("from './autosync.js'"))
assert('冷启动 8s 自动导入 + 数据变化 3s 防抖自动同步', storeSrc.includes('isFirst ? 8000 : 3000'))
assert('防重入 + 尾随补跑（autoBusy/autoRedo + 1.5s）',
  storeSrc.includes('autoBusy') && storeSrc.includes('autoRedo') && storeSrc.includes('1500'))
assert('云备份页：测试连接/立即同步复用 runAutoSync（silent=false）',
  (cloudSrc.match(/await runAutoSync\(\{ state, restoreState, toast, silent: false \}\)/g) || []).length === 2)
assert('云备份页：自动同步说明 + 最近一次失败可见',
  cloudSrc.includes('配置后账单变化会自动双向同步') && cloudSrc.includes('最近一次失败'))
assert('未登录点头像 → 坚果云登录引导 Sheet',
  profileSrc11.includes('loggedIn ? setAvatarOpen(true) : setLoginOpen(true)')
  && profileSrc11.includes('title="登录坚果云"') && profileSrc11.includes('同步账单，换机不丢数据'))
assert('登录引导：打开坚果云登录页 + 去应用内配置',
  profileSrc11.includes('jianguoyun.com/d/login') && profileSrc11.includes("nav.push({ page: 'cloud' })"))
// v1.11.0 未登录徽标：昵称旁琥珀色「未登录」胶囊（me-cloud），未配置或手动关同步时均显示，点击直达登录引导
assert('未登录徽标：me-cloud 胶囊仅未登录时显示，点击弹登录引导',
  profileSrc11.includes("className=\"me-cloud\"") && profileSrc11.includes('aria-label="坚果云未登录，点击登录"')
  && profileSrc11.includes('!loggedIn && (') && profileSrc11.includes('onClick={() => setLoginOpen(true)}'))
assert('未登录徽标样式：me-tags 并排 + 琥珀色警示（不影响已登录态）',
  css.includes('.me-tags') && css.includes('.me-cloud') && css.includes('#ff9f43'))
assert('昵称直接显示「未登录」：未登录态 displayName 为「未登录」，点昵称仍可改名',
  profileSrc11.includes("displayName = loggedIn ? state.settings.nickname : '未登录'")
  && profileSrc11.includes("setName(state.settings.nickname); setNameOpen(true)"))
assert('云备份页有开启云同步开关（cloudSyncOff）',
  cloudSrc.includes('开启云同步') && cloudSrc.includes('cloudSyncOff'))
assert('runAutoSync 尊重 cloudSyncOff 用户开关：关闭时 user-disabled 跳过',
  autoSrc.includes("state?.settings?.cloudSyncOff === true") && autoSrc.includes("'user-disabled'"))
assert('设置页有可视化更新卡片（UpdateCard，常驻非弹窗）',
  settingsSrc.includes('UpdateCard') && settingsSrc.includes('upd?.openPrompt()'))
assert('更新卡片样式齐备（7 种状态 + 环形进度 + 深色适配）',
  css.includes('.upd-card') && css.includes('.upd-card-idle') && css.includes('.upd-card-new')
  && css.includes('.upd-card-ring') && css.includes('[data-theme="dark"] .upd-card-idle'))
assert('关于文案：数据可自选同步到坚果云', profileSrc11.includes('可自选同步到你的坚果云'))
assert('runAutoSync 顺带对齐资料档案（syncProfileArchive silent）',
  autoSrc.includes('syncProfileArchive(result.data, { toast, silent: true })'))

console.log(failed === 0 ? `\n全部通过：${passed} 项` : `\n${failed} 项失败`)
process.exit(failed ? 1 : 0)
