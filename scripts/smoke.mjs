/* v1.6 集成冒烟（Electron 无头，加载 dist 产物）：
 * 1. 我的页头部白色质感（玻璃关：实色白卡；玻璃开：白色磨砂 rgba 0.68）
 * 2. 头像上传任意背景图片（红底）成功并持久化
 * 3. 底部菜单图标：非白底图片拦截、白底图片成功、TabBar 渲染图片图标
 * 4. 点击反馈开关切换 data-tap
 * 5. 关键设置持久化
 * 运行：npm run test:smoke （需先 npm run build）
 */
import { app, BrowserWindow } from 'electron'
import fs from 'fs'
import http from 'node:http'
import os from 'os'
import path from 'path'

// v1.10.1 测试产物一律落 E 盘（C 盘已满）：userData/temp/cache/crashDumps 全部挂到 TEMP 下的临时目录，
// TEMP 持久化到 E:\Temp 后（setx），Electron 测试不再触碰 C 盘 Roaming/LocalAppData
// 启动时清扫上次残留（退出瞬间 Chromium 可能仍锁文件，will-quit 清理会失败，故退出清理只做兜底）
try {
  for (const d of fs.readdirSync(os.tmpdir())) {
    if (d.startsWith('qy-smoke-v16-')) fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true })
  }
} catch { /* 清理失败忽略 */ }
const smokeTmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qy-smoke-v16-'))
app.setPath('userData', smokeTmpRoot)
app.setPath('temp', smokeTmpRoot)
app.setPath('cache', path.join(smokeTmpRoot, 'cache'))
app.setPath('crashDumps', path.join(smokeTmpRoot, 'crash'))
app.on('will-quit', () => { try { fs.rmSync(smokeTmpRoot, { recursive: true, force: true }) } catch { /* 清理失败忽略 */ } })
// Windows 下窗口被遮挡会被 Chromium 判定为隐藏而停帧（transition 不推进），禁用原生遮挡检测
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 轮询取值：React state → localStorage 落盘可能 >1s（隐藏窗口更慢），固定 sleep 会竞态
async function pollTrue(run, js, timeout = 6000) {
  const t0 = Date.now()
  for (;;) {
    const v = await run(js)
    if (v) return true
    if (Date.now() - t0 > timeout) return false
    await sleep(250)
  }
}

app.whenReady().then(async () => {
  const results = []
  const assert = (name, cond) => {
    results.push([cond ? 'PASS' : 'FAIL', name])
    console.log((cond ? 'PASS  ' : 'FAIL  ') + name)
  }
  let failed = false
  try {
    // v1.9.0/v1.10.0 本地假 WebDAV：通用 Map 文件存储（GET/PUT/HEAD/MKCOL/OPTIONS + ETag 乐观锁）。
    // qingyu-profile.json 单独计数（profilePuts/profileBody/putLog 兼容 v1.9.0 断言），backup.json 计入 backupPuts；
    // 主进程可直接读写 files Map（v1.10.0 场景 G1 预置云端种子）。渲染进程经真实 fetch 打到此处，验证端到端同步链路
    const files = new Map() // 文件名 → { text, etag }
    let etagN = 0
    let profilePuts = 0
    let profileBody = ''
    let backupPuts = 0
    const putLog = []
    const nextEtag = () => 'w' + (++etagN)
    const stub = http.createServer((req, res) => {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
      const name = p.split('/').filter(Boolean).pop() || ''
      const send = (code, body = '', etag = null) => {
        const h = { 'Access-Control-Allow-Origin': '*' }
        if (etag) h.ETag = etag
        res.writeHead(code, h); res.end(body)
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, PUT, HEAD, MKCOL, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        })
        return res.end()
      }
      if (req.method === 'MKCOL') return send(201)
      if (req.method === 'HEAD') { const f = files.get(name); return f ? send(200, '', f.etag) : send(404) }
      if (req.method === 'GET') { const f = files.get(name); return f ? send(200, f.text, f.etag) : send(404) }
      if (req.method === 'PUT') {
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => {
          const f = files.get(name)
          const ifMatch = req.headers['if-match']
          if (ifMatch && f && f.etag !== ifMatch) return send(412)
          const etag = nextEtag()
          files.set(name, { text: body, etag })
          if (name === 'qingyu-profile.json') {
            profilePuts++; profileBody = body
            try { putLog.push(JSON.parse(body).data.nickname) } catch { putLog.push('BAD') }
          }
          if (name === 'backup.json') backupPuts++
          send(201, '', etag)
        })
        return
      }
      send(404)
    })
    await new Promise((r) => stub.listen(0, '127.0.0.1', r))
    const stubUrl = `http://127.0.0.1:${stub.address().port}/dav/qingyu/backup.json`

    const win = new BrowserWindow({
      width: 430, height: 900, show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    })
    await win.loadFile(path.join(process.cwd(), 'dist', 'index.html'))
    await sleep(700)
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 3) console.log('  [renderer error]', String(message).slice(0, 300))
    })
    const run = (js) => win.webContents.executeJavaScript(js)

    // 预置：跳过欢迎页 + 预置坏 WebDAV 配置（保护 v1.6 头像场景走原换头像弹层；坏地址让 v1.10.0 自动同步静默失败，不影响前面的功能断言）
    await run(`(() => {
      const k = 'qingyu_state_v3'
      const s = JSON.parse(localStorage.getItem(k) || 'null')
      if (!s) return 'no-state'
      s.settings.welcomed = true
      localStorage.setItem(k, JSON.stringify(s))
      localStorage.setItem('qingyu_sync_cfg_v1', JSON.stringify({ url: 'http://127.0.0.1:9/dav/qingyu/backup.json', username: '', password: '' }))
      return 'ok'
    })()`)
    await win.loadFile(path.join(process.cwd(), 'dist', 'index.html'))
    await sleep(900)

    // 页内工具：造图（fill 底色 + 可选彩色圆点）并注入最近的一个 .sheet 文件输入
    const INJECT = `(kind) => new Promise((resolve) => {
      const c = document.createElement('canvas'); c.width = 200; c.height = 200
      const x = c.getContext('2d')
      if (kind === 'nonwhite') { x.fillStyle = '#e05555'; x.fillRect(0, 0, 200, 200) }
      else { x.fillStyle = '#ffffff'; x.fillRect(0, 0, 200, 200); x.fillStyle = '#4c7dff'; x.beginPath(); x.arc(100, 100, 36, 0, 7); x.fill() }
      c.toBlob((b) => {
        const f = new File([b], 't.png', { type: 'image/png' })
        const dt = new DataTransfer(); dt.items.add(f)
        const input = [...document.querySelectorAll('.sheet input[type=file]')].pop()
        if (!input) { resolve('no-input'); return }
        input.files = dt.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
        resolve('ok')
      }, 'image/png')
    })`
    const clickText = `(sel, txt) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(txt))
      if (el) el.click()
      return !!el
    }`

    // 1. 我的页：浅色质感头部（玻璃关 → 白→浅蓝灰渐变卡，非透明）
    await run(`[...document.querySelectorAll('.tab')].pop().click()`)
    await sleep(400)
    const headOff = await run(`(() => {
      const el = document.querySelector('.me-head')
      const cs = getComputedStyle(el)
      return { bgImg: cs.backgroundImage, color: cs.color }
    })()`)
    assert('玻璃关：头部为白→浅蓝灰渐变卡（不透明）', headOff.bgImg.includes('linear-gradient') && headOff.bgImg.includes('255'))
    assert('玻璃关：头部文字为深色墨色', headOff.color === 'rgb(31, 36, 48)')
    // v1.6.4：根级页顶部预留状态栏安全区 + 玻璃过渡再次提速（0.24s→0.16s，backdrop-filter 不参与过渡）
    assert('我的页顶部预留安全区（paddingTop=12px 基础间距）', await run(`getComputedStyle(document.querySelector('.page-body')).paddingTop === '12px'`))
    assert('玻璃材质过渡提速至 0.16s', await run(`getComputedStyle(document.querySelector('.group')).transitionDuration.includes('0.16s')`))
    assert('backdrop-filter 不参与过渡（避免逐帧重新光栅化卡顿）', await run(`!getComputedStyle(document.querySelector('.group')).transitionProperty.includes('backdrop-filter')`))

    // 2. 头像上传非白底（红底）图片 → 成功（轮询等落盘；IndexedDB 写入在隐藏窗口下可能 >6s）
    await run(`document.querySelector('.me-head .avatar-wrap').click()`)
    await sleep(400)
    await run(`(${INJECT})('nonwhite')`)
    const av = await pollTrue(run, `(() => { const s = JSON.parse(localStorage.getItem('qingyu_state_v3')); return s.settings.avatarPhotoAt || null })()`, 15000)
    assert('头像：红底图片上传成功（avatarPhotoAt 已写入）', av)

    // 3. 进设置 → 外观与个性化
    await run(`(${clickText})('.cell', '设置')`)
    await sleep(400)
    await run(`(${clickText})('.cell', '外观与个性化')`)
    await sleep(400)

    // 4. 开玻璃 → 返回我的页断言白色磨砂
    await run(`(${clickText})('.cell', '液态玻璃效果')`)
    await sleep(300)
    assert('玻璃开：data-glass=on', await run(`document.documentElement.dataset.glass === 'on'`))

    // v1.6.4 P0 回归：直接点开关滑块（非行内其他区域）必须只切换一次。
    // 旧缺陷：Switch 的 onClick 冒泡到外层 .cell 的 onClick，一次点击切两次=无反应
    await run(`document.querySelector('.cell button.switch').click()`)
    await sleep(200)
    assert('直接点开关：玻璃被关闭（无双重切换抵消）', await run(`document.documentElement.dataset.glass === 'off'`))
    await run(`document.querySelector('.cell button.switch').click()`)
    await sleep(200)
    assert('再次点开关：玻璃重新开启', await run(`document.documentElement.dataset.glass === 'on'`))

    // v1.6.7 启动引导期：开启后先 data-gboot=1（首帧不挂 backdrop-filter），两帧/150ms 内自动清除。
    // 用 MutationObserver 在页面侧记录，避免轮询错过仅存在两帧的引导态。
    await run(`window.__gbootSeen = false;
      window.__gbootObs && window.__gbootObs.disconnect();
      window.__gbootObs = new MutationObserver(() => { if (document.documentElement.dataset.gboot === '1') window.__gbootSeen = true });
      window.__gbootObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-gboot'] });`)
    await run(`document.querySelector('.cell button.switch').click()`)
    await sleep(200)
    assert('引导期前置：玻璃已关闭', await run(`document.documentElement.dataset.glass === 'off'`))
    await run(`document.querySelector('.cell button.switch').click()`)
    await sleep(300)
    assert('开启瞬间进入 gboot 引导期（首帧零模糊光栅化）', await run(`window.__gbootSeen === true`))
    assert('引导期 ~两帧后结束（data-gboot 已清除）', await run(`document.documentElement.dataset.gboot === undefined`))
    // v1.6.7 晕光：径向渐变代替大半径高斯滤镜
    assert('晕光使用径向渐变（无 blur 滤镜）', await run(`(() => {
      const el = document.querySelector('.bd-glow'); const cs = getComputedStyle(el)
      return cs.backgroundImage.includes('radial-gradient') && (cs.filter === 'none' || cs.filter === '')
    })()`) === true)
    // v1.6.7 模糊滑杆：拖动后模糊半径 + 遮罩浓度（--g-veil）实时联动
    const setBlur = (v) => run(`(() => {
      const r = document.querySelector('input[type=range]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(r, '${v}'); r.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    // 取所有数字/小数 token 的最后一个作为 rgba alpha（避免在模板字符串里转义括号）
    const readBlur = () => run(`(() => {
      const g = document.querySelector('.group')
      const cs = getComputedStyle(g)
      const bf = cs.backdropFilter || cs.webkitBackdropFilter || ''
      const bg = getComputedStyle(document.querySelector('.bd-veil')).backgroundColor
      const nums = bg.match(/[\\d.]+/g) || []
      const blurM = bf.match(/blur\\(([^)]+)\\)/)
      return { blur: blurM ? blurM[1] : null, veil: Number(nums[nums.length - 1]) }
    })()`)
    await setBlur(8); await sleep(120)
    const b8 = await readBlur()
    assert('模糊滑杆 8：材质模糊 8px', b8.blur === '8px')
    assert('模糊滑杆 8：遮罩浓度 0.8（低值=浓霜）', Math.abs(b8.veil - 0.8) < 0.02)
    await setBlur(28); await sleep(120)
    const b28 = await readBlur()
    assert('模糊滑杆 28：材质模糊 28px', b28.blur === '28px')
    assert('模糊滑杆 28：遮罩浓度 0.6（高值=通透）', Math.abs(b28.veil - 0.6) < 0.02)
    await setBlur(16) // 恢复默认

    // v1.6.8 按压缩放独立开关：关闭 → data-tap=off，再开回来
    await run(`(${clickText})('.cell', '按压缩放动画')`)
    await sleep(200)
    assert('按压缩放关：data-tap=off', await run(`document.documentElement.dataset.tap === 'off'`))
    await run(`(${clickText})('.cell', '按压缩放动画')`)
    await sleep(200)
    assert('按压缩放开：data-tap=on', await run(`document.documentElement.dataset.tap === 'on'`))

    // v1.6.8 震动强度四档（v1.7.1 改为可视化档位卡片）：桩换 navigator.vibrate 捕获入参，pointerdown 实测各档时长
    await run(`window.__vibs = [];
      const origVib = navigator.vibrate ? navigator.vibrate.bind(navigator) : () => true;
      Object.defineProperty(navigator, 'vibrate', { configurable: true, writable: true,
        value: (p) => { window.__vibs.push(Array.isArray(p) ? p.slice() : p); return true } });
      window.__tapCell = (extra) => {
        const el = document.querySelector('.vib-card .vib-test');
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, isPrimary: true, clientX: 10, clientY: 10 }));
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
      };
      'ok'`)
    assert('震动卡片：4 个可视化档位', await run(`document.querySelectorAll('.vib-card .vib-opt').length === 4`))
    assert('震动卡片：档位含毫秒标注与描述', await run(`!!document.querySelector('.vib-card .vib-meta em') && document.querySelector('.vib-card').textContent.includes('10ms')`))
    const setVibLevel = async (idx) => {
      await run(`document.querySelectorAll('.vib-card .vib-opts .vib-opt')[${idx}].click()`)
      await sleep(150)
    }
    await setVibLevel(2)
    assert('标准档选中态：波形柱点亮 3 根 + 勾选', await run(`document.querySelectorAll('.vib-opt.on .vib-bars i.lit').length === 3 && document.querySelector('.vib-opt.on .vib-check').textContent === '✓'`))
    await run(`window.__vibs = []; window.__tapCell()`)
    await sleep(60)
    assert('震动标准档：pointerdown 触发 10ms', await run(`JSON.stringify(window.__vibs)`).then((v) => JSON.parse(v)).then((a) => a.includes(10)).catch(() => false))
    await setVibLevel(1)
    assert('轻柔档选中态：波形柱点亮 1 根', await run(`document.querySelectorAll('.vib-opt.on .vib-bars i.lit').length === 1`))
    await run(`window.__vibs = []; document.querySelector('.vib-card .vib-test').click()`)
    await sleep(60)
    assert('试震按钮：轻柔档触发 6ms', await run(`JSON.stringify(window.__vibs)`).then((v) => JSON.parse(v)).then((a) => a.includes(6)).catch(() => false))
    await run(`window.__vibs = []; window.__tapCell()`)
    await sleep(60)
    assert('震动轻柔档：pointerdown 触发 6ms', await run(`JSON.stringify(window.__vibs)`).then((v) => JSON.parse(v)).then((a) => a.includes(6)).catch(() => false))
    await setVibLevel(3)
    await run(`window.__vibs = []; window.__tapCell()`)
    await sleep(60)
    assert('震动明快档：触发 20ms', await run(`JSON.stringify(window.__vibs)`).then((v) => JSON.parse(v)).then((a) => a.includes(20)).catch(() => false))
    // 滑动超过 14px → 撤震 vibrate(0)
    await run(`window.__vibs = [];
      const el = document.querySelector('.vib-card .vib-test');
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, clientX: 10, clientY: 10 }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 40, clientY: 10 }));
      'ok'`)
    await sleep(60)
    assert('滑动意图撤震：调用 vibrate(0)', await run(`JSON.stringify(window.__vibs)`).then((v) => JSON.parse(v)).then((a) => a.includes(0)).catch(() => false))
    await setVibLevel(0)
    assert('关闭档：试震按钮禁用', await run(`document.querySelector('.vib-card .vib-test').disabled === true`))
    await run(`window.__vibs = []; window.__tapCell()`)
    await sleep(60)
    const vibOff = await run(`JSON.stringify(window.__vibs)`)
    assert('震动关闭档：不再触发震动', JSON.parse(vibOff).length === 0)
    await setVibLevel(2) // 恢复标准

    // v1.6.8 文案识别沙盒在「提醒与收支监控」页：外观 → 设置主页 → 提醒页，测完再回外观
    await run(`history.back()`)
    await sleep(350)
    await run(`(${clickText})('.cell', '提醒与收支监控')`)
    await sleep(400)
    assert('监控页：文案识别沙盒渲染', await run(`!!document.querySelector('.notify-sandbox textarea')`))
    await run(`(() => {
      const ta = document.querySelector('.notify-sandbox textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '微信支付-9.90'); ta.dispatchEvent(new Event('input', { bubbles: true }));
      [...document.querySelectorAll('.notify-sandbox button')].find((b) => b.textContent.includes('测试识别')).click();
      return true;
    })()`)
    await sleep(150)
    assert('沙盒：支出文案识别成功（微信/支出/9.9）', await run(`!!document.querySelector('.sandbox-ok') && document.querySelector('.sandbox-ok').textContent.includes('支出') && document.querySelector('.sandbox-ok').textContent.includes('9.9')`))
    await run(`(() => {
      const ta = document.querySelector('.notify-sandbox textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '【支付宝】验证码 583210'); ta.dispatchEvent(new Event('input', { bubbles: true }));
      [...document.querySelectorAll('.notify-sandbox button')].find((b) => b.textContent.includes('测试识别')).click();
      return true;
    })()`)
    await sleep(150)
    assert('沙盒：验证码噪声识别为失败态', await run(`!!document.querySelector('.sandbox-fail') && !document.querySelector('.sandbox-ok')`))
    await run(`history.back()`)
    await sleep(350)
    await run(`(${clickText})('.cell', '外观与个性化')`)
    await sleep(400)

    // v1.6.8 发现页图标：红底（非白底）也允许上传 → discIconAt 写入
    // v1.6.9 入口已改为个性化预览卡（skin-card）
    await run(`[...document.querySelectorAll('.skin-card')].find((c) => c.textContent.includes('发现页功能图标')).click()`)
    await sleep(400)
    assert('发现图标 Sheet：14 个功能选择器', await run(`document.querySelectorAll('.discicon-grid .tabicon-item').length === 14`))
    await run(`(${INJECT})('nonwhite')`)
    const discSaved = await pollTrue(run, `(() => { const s = JSON.parse(localStorage.getItem('qingyu_state_v3')); return s.settings.discIconAt?.scan || null })()`, 15000)
    assert('发现图标：任意背景图片上传成功（scan 已写入，无白底拦截）', !!discSaved)
    await run(`document.querySelector('.sheet-head .sx')?.click()`)
    await sleep(300)

    // v1.6.3 玻璃开关端到端耗时实测：点击 → data-glass 翻转（即时响应）→ 首个 background-color
    // transitionend（视觉完成），要求翻转 <100ms、全程 <1s。
    // 注意：隐藏/被遮挡窗口不产合成帧、transition 不推进（见 v1.5 教训），计时期间需显示并聚焦窗口，
    // 且须等渲染进程处理完可见性变更（show 后立即点击会让过渡在"隐藏"瞬间创建而被冻结）
    win.show()
    win.focus()
    await sleep(300)
    const timing = await run(`new Promise((resolve) => {
      const t0 = performance.now()
      let flipped = null
      const obs = new MutationObserver(() => {
        if (flipped === null && document.documentElement.dataset.glass === 'off') flipped = Math.round(performance.now() - t0)
      })
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-glass'] })
      const el = document.querySelector('.group')
      let done = false
      el.addEventListener('transitionend', (ev) => {
        if (ev.propertyName === 'background-color' && !done) {
          done = true; obs.disconnect()
          resolve({ flipped, total: Math.round(performance.now() - t0), timeout: false })
        }
      })
      setTimeout(() => {
        if (!done) { done = true; obs.disconnect(); resolve({ flipped, total: Math.round(performance.now() - t0), timeout: true }) }
      }, 3000)
      const c = [...document.querySelectorAll('.cell')].find((e) => e.textContent.includes('液态玻璃效果'))
      if (c) c.click()
      else resolve({ flipped: -1, total: -1, timeout: true })
    })`)
    win.hide()
    await sleep(150)
    console.log(`  (实测：翻转 ${timing.flipped}ms，视觉完成 ${timing.total}ms${timing.timeout ? '，超时' : ''})`)
    assert('玻璃开关：状态翻转即时（<100ms）', timing.flipped >= 0 && timing.flipped < 100)
    assert('玻璃开关：1 秒内完成视觉切换', !timing.timeout && timing.total >= 0 && timing.total < 1000)
    // 恢复开启（后续持久化断言依赖 glassOn=true）
    await run(`(${clickText})('.cell', '液态玻璃效果')`)
    await sleep(400)

    // 5. 底部菜单图标：非白底拦截 → 白底成功（v1.6.1 仅图片方式，无表情入口；v1.6.9 入口为预览卡）
    await run(`[...document.querySelectorAll('.skin-card')].find((c) => c.textContent.includes('底部菜单图标')).click()`)
    await sleep(400)
    assert('图标 Sheet：四个页签选择器渲染', await run(`document.querySelectorAll('.tabicon-item').length === 4`))
    assert('图标 Sheet：无表情自定义入口（无 .seg 切换）', await run(`document.querySelector('.sheet .seg') === null`))
    await run(`(${INJECT})('nonwhite')`)
    await sleep(1200)
    const t1 = await run(`(() => { const s = JSON.parse(localStorage.getItem('qingyu_state_v3')); return s.settings.tabIconAt?.home || null })()`)
    assert('图标：红底图片被拦截（home 未写入）', t1 === null)
    await run(`(${INJECT})('white')`)
    const t2 = await pollTrue(run, `(() => { const s = JSON.parse(localStorage.getItem('qingyu_state_v3')); return s.settings.tabIconAt?.home || null })()`, 15000)
    assert('图标：白底图片上传成功（home 已写入）', !!t2)
    await run(`document.querySelector('.sheet-head .sx')?.click()`)
    await sleep(300)

    // 6. 返回根级我的页：白色磨砂 + TabBar 图片图标
    await run(`history.back()`)
    await sleep(300)
    await run(`history.back()`)
    await sleep(400)
    const headOn = await run(`(() => {
      const cs = getComputedStyle(document.querySelector('.me-head'))
      return { img: cs.backgroundImage, border: cs.borderTopColor, blur: cs.backdropFilter || cs.webkitBackdropFilter }
    })()`)
    assert('玻璃开：头部为纯白液态玻璃（渐变白 34%→18%）', headOn.img.includes('linear-gradient') && headOn.img.includes('rgba(255, 255, 255, 0.34)') && headOn.img.includes('rgba(255, 255, 255, 0.18)'))
    assert('玻璃开：白色半透明描边', headOn.border === 'rgba(255, 255, 255, 0.45)')
    assert('玻璃开：头部启用 backdrop 模糊', typeof headOn.blur === 'string' && headOn.blur.includes('blur'))
    assert('TabBar 首个页签渲染自定义图片图标', await run(`!!document.querySelector('.tabbar .tab .tico img')`))

    // v1.6.8 切到发现页：14 个功能入口 + 自定义图片图标实际渲染（玻璃容器内图片填满圆角）
    await run(`[...document.querySelectorAll('.tab')].find((b) => b.textContent.includes('发现')).click()`)
    await sleep(500)
    assert('发现页：14 个功能入口渲染', await run(`document.querySelectorAll('.grid4 .gitem').length === 14`))
    const discRender = await pollTrue(run, `!!document.querySelector('.gitem .gi.gi-img img')`, 15000)
    assert('发现页：自定义图片图标已渲染到功能入口', !!discRender)
    let discImgBox = null
    if (discRender) {
      discImgBox = await run(`(() => {
        const gi = document.querySelector('.gitem .gi.gi-img'); const cs = getComputedStyle(gi)
        const img = gi.querySelector('img'); const ics = getComputedStyle(img)
        return { overflow: cs.overflow, fit: ics.objectFit, radius: ics.borderTopLeftRadius }
      })()`)
    }
    assert('发现页图标：图片铺满圆角方块（object-fit:cover）',
      !!discRender && discImgBox && discImgBox.fit === 'cover' && discImgBox.overflow === 'hidden')
    assert('发现页：自定义图标入口按钮存在', await run(`!![...document.querySelectorAll('button')].find((b) => b.textContent.includes('自定义图标'))`))
    await run(`[...document.querySelectorAll('.tab')].find((b) => b.textContent.includes('我的')).click()`) // 回到「我的」
    await sleep(400)

    // ============ v1.6.9 账本图标 / 首页切换 / 记账选账本 ============
    // 8. 首页顶部账本切换器
    await run(`[...document.querySelectorAll('.tab')].find((b) => b.textContent.includes('明细')).click()`)
    await sleep(500)
    assert('首页顶部渲染账本切换器', await run(`!!document.querySelector('.ledger-switch')`))
    await run(`document.querySelector('.ledger-switch').click()`)
    await sleep(400)
    assert('切换 Sheet：初始仅 1 个账本', await run(`document.querySelectorAll('.sheet .selectline').length === 1`))
    // 经「管理账本」进账本页新建「旅行」
    await run(`[...document.querySelectorAll('.sheet button')].find((b) => b.textContent.includes('管理账本')).click()`)
    await sleep(500)
    await run(`[...document.querySelectorAll('.iconbtn')].pop().click()`)
    await sleep(400)
    await run(`(() => {
      const i = document.querySelector('.sheet input.input')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(i, '旅行'); i.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await run(`[...document.querySelectorAll('.sheet .btnrow .btn')].find((b) => b.textContent === '保存').click()`)
    await sleep(400)
    assert('新建账本「旅行」已持久化', await pollTrue(run, `(() => { const s = JSON.parse(localStorage.getItem('qingyu_state_v3')); return s.ledgers.some((l) => l.name === '旅行') })()`, 8000))
    await run(`history.back()`)
    await sleep(400)

    // 9. 切换 Sheet 点击即切
    await run(`document.querySelector('.ledger-switch').click()`)
    await sleep(400)
    assert('切换 Sheet：两个账本可选', await run(`document.querySelectorAll('.sheet .selectline').length === 2`))
    await run(`[...document.querySelectorAll('.sheet .selectline')].find((e) => e.textContent.includes('旅行')).click()`)
    const switched = await pollTrue(run, `(() => {
      const s = JSON.parse(localStorage.getItem('qingyu_state_v3'))
      const travel = s.ledgers.find((l) => l.name === '旅行')
      return travel && s.currentLedgerId === travel.id
    })()`, 8000)
    assert('点击「旅行」即切换当前账本', switched)
    assert('切换器标题实时更新为「旅行」', await run(`document.querySelector('.ledger-switch').textContent.includes('旅行')`))

    // 10. 记一笔自选存入账本（首个 pill 是「智能填单」，账本 pill 用 📒 定位）
    await run(`document.querySelector('.tab-add').click()`)
    await sleep(500)
    assert('记账页：账本 pill 显示当前账本「旅行」', await run(`(() => {
      const p = [...document.querySelectorAll('.addsheet .meta-pill')].find((b) => b.textContent.includes('📒'))
      return p ? p.textContent.includes('旅行') : 'no-pill'
    })()`))
    await run(`[...document.querySelectorAll('.addsheet .meta-pill')].find((b) => b.textContent.includes('📒')).click()`)
    await sleep(400)
    assert('账本选择弹层：列出全部账本', await run(`document.querySelectorAll('.sheet .selectline').length === 2`))
    await run(`[...document.querySelectorAll('.sheet .selectline')].find((e) => e.textContent.includes('默认账本')).click()`)
    await sleep(300)
    assert('账本 pill 已改为「默认账本」', await run(`(() => {
      const p = [...document.querySelectorAll('.addsheet .meta-pill')].find((b) => b.textContent.includes('📒'))
      return p ? p.textContent.includes('默认账本') : 'no-pill'
    })()`))
    await run(`(() => {
      const nums = ['1', '0', '0']
      for (const n of nums) [...document.querySelectorAll('.kp button')].find((b) => b.textContent === n).click()
      return true
    })()`)
    await run(`[...document.querySelectorAll('.kp button')].find((b) => b.textContent === '完成').click()`)
    const savedLedger = await pollTrue(run, `(() => {
      const s = JSON.parse(localStorage.getItem('qingyu_state_v3'))
      const def = s.ledgers.find((l) => l.name === '默认账本')
      const t = (s.transactions || []).filter((x) => !x.deletedAt).pop()
      return !!(t && t.amount === 100 && t.ledgerId === def.id)
    })()`, 8000)
    assert('记账存入所选账本（默认账本），当前账本仍为「旅行」', savedLedger
      && await run(`(() => { const s = JSON.parse(localStorage.getItem('qingyu_state_v3')); const tr = s.ledgers.find((l) => l.name === '旅行'); return s.currentLedgerId === tr.id })()`))

    // 11. 账本自定义图标：我的页 → 我的账本 → 编辑默认账本 → 上传红底图
    await run(`[...document.querySelectorAll('.tab')].find((b) => b.textContent.includes('我的')).click()`)
    await sleep(400)
    await run(`(${clickText})('.cell', '我的账本')`)
    await sleep(500)
    await run(`document.querySelector('.grid3 .gitem').click()`)
    await sleep(400)
    await run(`(${INJECT})('nonwhite')`)
    const bookSaved = await pollTrue(run, `(() => {
      const s = JSON.parse(localStorage.getItem('qingyu_state_v3'))
      const def = s.ledgers.find((l) => l.name === '默认账本')
      return (s.settings.bookIconAt || {})[def.id] || null
    })()`, 15000)
    assert('账本图标：任意背景图片上传成功（bookIconAt 写入）', !!bookSaved)
    assert('编辑弹层：图标预览渲染为图片', await pollTrue(run, `!!document.querySelector('.bookicon-preview img')`, 8000))
    await run(`document.querySelector('.sheet-head .sx')?.click()`)
    await sleep(300)
    assert('账本卡：自定义图标已渲染（gi-img 图片铺满）', await pollTrue(run, `!!document.querySelector('.grid3 .gitem .gi.gi-img img')`, 8000))
    await run(`history.back()`)
    await sleep(400)

    // 12. 个性化设置视觉预览卡
    await run(`(${clickText})('.cell', '设置')`)
    await sleep(400)
    await run(`(${clickText})('.cell', '外观与个性化')`)
    await sleep(500)
    assert('个性化：视觉预览卡 4 张渲染', await run(`document.querySelectorAll('.skin-grid .skin-card').length === 4`))
    assert('个性化：预览卡含壁纸/启动页/底部图标/发现图标',
      await run(`(() => { const t = document.querySelector('.skin-grid').textContent; return t.includes('自定义壁纸') && t.includes('启动页背景') && t.includes('底部菜单图标') && t.includes('发现页功能图标') })()`))
    assert('个性化：底部图标卡显示已自定义计数', await run(`[...document.querySelectorAll('.skin-card')].some((c) => c.textContent.includes('已自定义 1/4'))`))
    await run(`history.back()`)
    await sleep(300)
    await run(`history.back()`)
    await sleep(300)

    // 7. 持久化汇总
    const persist = await run(`(() => { const s = JSON.parse(localStorage.getItem('qingyu_state_v3')).settings; return { glass: s.glassOn, tap: s.tapFeedback, tapScale: s.tapScale, vib: s.vibrateLevel, avatar: !!s.avatarPhotoAt, icon: !!s.tabIconAt?.home, disc: !!s.discIconAt?.scan, book: Object.values(s.bookIconAt || {}).some(Boolean) } })()`)
    assert('持久化：glassOn=true', persist.glass === true)
    assert('持久化：tapFeedback=true', persist.tap === true)
    assert('持久化：tapScale=true（拆分迁移正确）', persist.tapScale === true)
    assert('持久化：vibrateLevel=2（恢复标准档）', persist.vib === 2)
    assert('持久化：avatarPhotoAt 已写入', persist.avatar === true)
    assert('持久化：tabIconAt.home 已写入', persist.icon === true)
    assert('持久化：discIconAt.scan 已写入', persist.disc === true)
    assert('持久化：bookIconAt 已写入', persist.book === true)

    // ============ v1.7.1 应用内更新（可视化安装组件：询问 → 静默下载仅 APK → 点击安装） ============
    // 13. mock GitHub Releases API；先测 Web/Electron 兜底（强制无原生桥 → 外链）
    await run(`(() => {
      window.__qyNativeFetch = window.fetch.bind(window) // v1.9.0 资料云存档块要恢复原生 fetch（smoke 无 preload，WebDAV 走渲染进程 fetch）
      window.__openedUrl = null
      window.open = (url) => { window.__openedUrl = url; return null }
      window.__shaExpect = 'a'.repeat(64)
      window.fetch = (u) => {
        const url = String(u)
        if (url.includes('/releases/latest')) {
          return Promise.resolve(new Response(JSON.stringify({
            tag_name: 'v9.9.9', name: 'v9.9.9', draft: false, prerelease: false,
            body: '## 更新内容\\n1. 新增应用内更新\\n2. 修复若干问题',
            published_at: '2026-10-01T08:00:00Z',
            assets: [
              { name: 'qingyu-v9.9.9-android.apk', browser_download_url: 'https://x/v9.9.9.apk', size: 5242880, created_at: '2026-10-01' },
              { name: 'qingyu-v9.9.9-android.apk.sha256', browser_download_url: 'https://x/v9.9.9.sha256', created_at: '2026-10-01' },
            ],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        }
        if (url.includes('.sha256')) return Promise.resolve(new Response(window.__shaExpect + '  qingyu.apk\\n', { status: 200 }))
        return Promise.resolve(new Response('{}', { status: 200 }))
      }
      window.__qyUpdateBridge = null // 测试钩子：强制 web 路径
      localStorage.removeItem('qingyu_update_dismissed_v1')
      return 'ok'
    })()`)
    await run(`[...document.querySelectorAll('.cell')].find((e) => e.textContent.includes('关于')).click()`)
    await sleep(400)
    await run(`[...document.querySelectorAll('.sheet button')].find((b) => b.textContent.includes('检查更新')).click()`)
    await sleep(600)
    assert('可视化组件：发现 v9.9.9 并渲染更新日志（markdown 符号已清理）',
      await run(`(() => { const m = document.querySelector('.upd-modal'); const v = [...document.querySelectorAll('.upd-ver')].some((e) => e.textContent.includes('v9.9.9'))
        const notes = document.querySelector('.upd-notes')
        return !!m && v && !!notes && notes.textContent.includes('新增应用内更新') && !notes.textContent.includes('##') })()`))
    assert('Web 端：显示「前往下载页」而非更新按钮',
      await run(`!![...document.querySelectorAll('.upd-modal .btn')].find((b) => b.textContent.includes('前往下载页'))
        && ![...document.querySelectorAll('.upd-modal .btn')].some((b) => b.textContent.includes('立即更新'))`))
    assert('Web 端：不显示自动下载开关（仅原生有意义）',
      await run(`!document.querySelector('.upd-autodl')`))
    await run(`[...document.querySelectorAll('.upd-modal .btn')].find((b) => b.textContent.includes('前往下载页')).click()`)
    await sleep(200)
    assert('Web 端：点击打开对应 GitHub Release 页', await run(`(window.__openedUrl || '').includes('releases/tag/v9.9.9')`))
    await run(`document.querySelector('.upd-modal .upd-later').click()`)
    await sleep(300)
    assert('「以后再说」按版本写入 dismissed', await run(`localStorage.getItem('qingyu_update_dismissed_v1') === 'v9.9.9'`))
    await run(`[...document.querySelectorAll('.sheet-head .sx')].forEach((b) => b.click())`)
    await sleep(300)

    // 14. mock 原生桥：用户选择更新 → 静默下载（仅 APK，不安装）→ 进度环/浮卡 → 就绪 → 点击安装
    await run(`(() => {
      window.__installCalled = null
      window.__cancelCalled = false
      window.__resolveDl = null
      window.__shaExpect = 'b'.repeat(64)
      window.__makeBridge = () => {
        let cbs = []
        return {
          addListener: async (ev, cb) => { window.__bridgeLog.push('add ' + ev); if (ev === 'downloadProgress') cbs.push(cb); return { remove() { window.__bridgeLog.push('remove ' + ev); cbs = cbs.filter((x) => x !== cb) } } },
          download: async (opts) => {
            window.__bridgeLog.push('download enter ' + opts.fileName)
            await new Promise((r) => setTimeout(() => { cbs.forEach((cb) => cb({ progress: 30, received: 30, total: 100 })); r() }, 20))
            await new Promise((r) => { window.__resolveDl = r })
            window.__bridgeLog.push('download resolved')
            return { path: '/data/Download/' + opts.fileName, sha256: window.__dlSha, bytes: 5242880 }
          },
          cancelDownload: async () => { window.__cancelCalled = true; window.__bridgeLog.push('cancel') },
          installerInfo: async () => ({ platform: 'android', sdkInt: 30, canInstall: true }),
          openInstallSettings: async () => {},
          install: async ({ path }) => { window.__installCalled = path; window.__bridgeLog.push('install'); return { launched: true } },
        }
      }
      window.__bridgeLog = []
      window.__dlSha = 'b'.repeat(64) // 与 __shaExpect 一致 → 校验通过
      window.__qyUpdateBridge = window.__makeBridge()
      localStorage.removeItem('qingyu_update_dismissed_v1')
      return 'ok'
    })()`)
    await run(`[...document.querySelectorAll('.cell')].find((e) => e.textContent.includes('关于')).click()`)
    await sleep(400)
    await run(`[...document.querySelectorAll('.sheet button')].find((b) => b.textContent.includes('检查更新')).click()`)
    await sleep(600)
    assert('原生：弹窗含「立即更新」按钮与自动下载开关',
      await run(`!![...document.querySelectorAll('.upd-modal .btn')].find((b) => b.textContent.includes('立即更新'))
        && !!document.querySelector('.upd-autodl')`))
    assert('用户未选择前不自动下载（静默仅发生在用户确认后）',
      await run(`!window.__bridgeLog.some((l) => l.startsWith('download enter'))`))
    assert('默认自动后台下载关闭（发现新版先询问）',
      await run(`JSON.parse(localStorage.getItem('qingyu_state_v3')).settings.updateAutoDl === false`))
    // 开关：开启并持久化（手动确认下载不受开关影响）
    await run(`document.querySelector('.upd-autodl button.switch').click()`)
    await sleep(200)
    assert('自动后台下载开关可开启并持久化', await pollTrue(run,
      `JSON.parse(localStorage.getItem('qingyu_state_v3')).settings.updateAutoDl === true`, 5000))
    await run(`[...document.querySelectorAll('.upd-modal .btn')].find((b) => b.textContent.includes('立即更新')).click()`)
    await sleep(400)
    assert('弹窗内：下载态显示进度环 30% 与「只下载不安装」说明',
      await run(`!!document.querySelector('.upd-ring') && document.querySelector('.ur-pct').textContent === '30%'
        && document.querySelector('.upd-modal').textContent.includes('只下载不安装')`))
    await run(`document.querySelector('.upd-modal .upd-x').click()`) // 最小化到浮卡后台等待
    await sleep(300)
    const dlFloat = await pollTrue(run,
      `!!document.querySelector('.upd-float') && document.querySelector('.upd-float').textContent.includes('30%')`, 6000)
    assert('浮卡：后台下载中显示进度 30%（进度只涨不跌）', dlFloat)
    await run(`window.__resolveDl && window.__resolveDl()`)
    const readyFloat = await pollTrue(run,
      `!![...document.querySelectorAll('.upd-float b')].some((b) => b.textContent.includes('已就绪'))`, 8000)
    assert('SHA-256 校验通过 → 浮卡进入就绪态（仍未安装）', readyFloat && await run(`window.__installCalled === null`))
    await run(`[...document.querySelectorAll('.sheet-head .sx')].forEach((b) => b.click())`) // 关「关于」弹窗，露出浮卡
    await sleep(300)
    await run(`document.querySelector('.upd-float').click()`) // ready → 打开可视化组件
    await sleep(400)
    assert('可视化组件就绪态：出现「立即安装」按钮',
      await run(`!![...document.querySelectorAll('.upd-modal .btn')].find((b) => b.textContent.includes('立即安装'))`))
    await run(`[...document.querySelectorAll('.upd-modal .btn')].find((b) => b.textContent.includes('立即安装')).click()`)
    await sleep(400)
    assert('点击安装：向系统安装器传出下载好的 APK 路径',
      await run(`(window.__installCalled || '').includes('qingyu-v9.9.9-android.apk')`))
    await run(`document.querySelector('.upd-modal .upd-x').click()`)
    await sleep(200)

    // 15. SHA-256 不符（下载摘要与 .sha256 资产不一致）→ 失败态并删除可疑文件
    await run(`(() => {
      window.__installCalled = null
      window.__cancelCalled = false
      window.__resolveDl = null
      window.__dlSha = 'c'.repeat(64)     // 实际下载算出的摘要
      window.__shaExpect = 'd'.repeat(64) // CI 发布的期望摘要
      window.__bridgeLog = []
      window.__qyUpdateBridge = window.__makeBridge()
      return 'ok'
    })()`)
    await run(`[...document.querySelectorAll('.cell')].find((e) => e.textContent.includes('关于')).click()`)
    await sleep(400)
    await run(`[...document.querySelectorAll('.sheet button')].find((b) => b.textContent.includes('检查更新')).click()`)
    await sleep(600)
    // 上一轮持久化为开：available 态切回关并验证落盘
    await run(`document.querySelector('.upd-autodl button.switch').click()`)
    await sleep(200)
    assert('自动后台下载开关可关闭并持久化', await pollTrue(run,
      `JSON.parse(localStorage.getItem('qingyu_state_v3')).settings.updateAutoDl === false`, 5000))
    await run(`[...document.querySelectorAll('.upd-modal .btn')].find((b) => b.textContent.includes('立即更新')).click()`)
    await sleep(300)
    await run(`document.querySelector('.upd-modal .upd-x').click()`) // 最小化到浮卡
    await sleep(200)
    await run(`window.__resolveDl && window.__resolveDl()`)
    const errFloat = await pollTrue(run,
      `!!document.querySelector('.upd-float') && document.querySelector('.upd-float').textContent.includes('失败')`, 8000)
    assert('SHA 不符：浮卡进入失败态', errFloat)
    assert('SHA 不符：已调用原生 cancel 删除可疑安装包', await run(`window.__cancelCalled === true`))
    await run(`[...document.querySelectorAll('.sheet-head .sx')].forEach((b) => b.click())`) // 关「关于」弹窗
    await sleep(300)
    await run(`document.querySelector('.upd-float').click()`) // error → 打开可视化组件
    await sleep(300)
    assert('可视化组件：展示 SHA-256 完整性校验失败文案',
      await run(`!!document.querySelector('.upd-modal .sandbox-fail') && document.querySelector('.upd-modal .sandbox-fail').textContent.includes('SHA-256')`))
    await run(`document.querySelector('.upd-modal .upd-later').click()`) // 以后再说关闭弹窗
    await sleep(200)

    // ============ v1.8.0 AI 回复风格（预设可视化 / 自定义参数 / 角色两阶段生成 + 缓存） ============
    // 16. mock 网络与平台：强制 web 路径（platformKind 测试钩子）+ 维基检索/摘录 + chat/completions（门闩控制阶段2时序）
    await run(`(() => {
      window.__qyForceWeb = true
      localStorage.setItem('qingyu_ai_cfg_v1', JSON.stringify({ key: 'sk-smoke-test', model: 'glm-4.7-flash', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' }))
      window.__wikiCalls = 0
      window.__chatCalls = 0
      window.__resolveChat = null
      window.__cardMock = {
        name: '芙宁娜', title: '水神·原神', emoji: '🌊',
        traits: ['戏剧化', '骄傲任性', '内心敏感'],
        speech: ['句式华丽夸张，带舞台腔', '常以「本小姐」自称'],
        tone: '语气华丽夸张、情绪高昂，偶有娇嗔但不越界',
        vocab: ['哼哼~', '本小姐'],
        usage: '适合日常账单点评与月度总结',
        prompt: '你是芙宁娜，枫丹前任水神兼大明星。分析账单时以「本小姐」自称，称呼用户为「亲爱的观众」，句式华丽夸张带戏剧腔，多用舞台与演出比喻，情绪高昂但点到即止；发现严重超支时收起玩笑，用少见的认真口吻提醒。',
      }
      window.fetch = (u) => {
        const url = String(u)
        if (url.includes('zh.wikipedia.org')) {
          window.__wikiCalls++
          if (url.includes('list=search')) {
            return Promise.resolve(new Response(JSON.stringify({ query: { search: [{ title: '芙宁娜' }] } }), { status: 200 }))
          }
          return Promise.resolve(new Response(JSON.stringify({ query: { pages: { p1: { title: '芙宁娜', extract: '芙宁娜是米哈游开发的游戏《原神》中的角色，枫丹前任水神，性格戏剧化、骄傲任性，喜爱戏剧与甜点，常以华丽舞台腔说话，内心敏感渴望被认可。' } } } }), { status: 200 }))
        }
        if (url.includes('chat/completions')) {
          window.__chatCalls++
          return new Promise((resolve) => {
            window.__resolveChat = () => resolve(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(window.__cardMock) } }] }), { status: 200 }))
          })
        }
        return Promise.resolve(new Response('{}', { status: 200 }))
      }
      return 'ok'
    })()`)

    // 17. 我的 → 设置 → AI 助手 → AI 账单分析（aiSettings）
    await run(`(${clickText})('.cell', '设置')`)
    await sleep(400)
    await run(`(${clickText})('.cell', 'AI 助手')`)
    await sleep(400)
    await run(`(${clickText})('.cell', 'AI 账单分析')`)
    await sleep(500)
    assert('AI 设置：三模式分段器（预设/自定义/角色扮演）', await run(`(() => {
      const bs = [...document.querySelectorAll('.seg button')]
      return bs.some((b) => b.textContent.includes('预设')) && bs.some((b) => b.textContent.includes('自定义')) && bs.some((b) => b.textContent.includes('角色扮演'))
    })()`))
    assert('AI 设置：预设 4 张可视化风格卡（emoji/名称/描述/选中勾）', await run(`(() => {
      if (document.querySelectorAll('.style-cards .style-card').length !== 4) return false
      const on = document.querySelector('.style-card.on')
      return !!document.querySelector('.stc-emoji') && !!document.querySelector('.stc-desc') && !!on && !!on.querySelector('.stc-check')
    })()`))

    // 18. 点预设卡即切换
    await run(`[...document.querySelectorAll('.style-card')].find((c) => c.textContent.includes('犀利毒舌')).click()`)
    assert('预设卡：点击「犀利毒舌」即切换（aiStyle=sharp）', await pollTrue(run,
      `JSON.parse(localStorage.getItem('qingyu_state_v3')).settings.aiStyle === 'sharp'`, 6000))

    // 19. 自定义参数面板：四维选择 + 实时预览卡
    await run(`[...document.querySelectorAll('.seg button')].find((b) => b.textContent.includes('自定义')).click()`)
    await sleep(400)
    assert('自定义面板：四维参数行 + 实时风格卡预览', await run(`document.querySelectorAll('.attrs-row').length === 4 && !!document.querySelector('.sc-view.sc-preview')`))
    await run(`[...document.querySelectorAll('.attrs-row .seg button')].find((b) => b.textContent === '幽默').click()`)
    assert('自定义：改语气为「幽默」落盘', await pollTrue(run,
      `JSON.parse(localStorage.getItem('qingyu_state_v3')).settings.aiStyleAttrs.tone === 'humor'`, 6000))
    assert('自定义：预览卡实时反映参数组合', await run(`(() => {
      const i = document.querySelector('.sc-preview .sc-tt i')
      return !!i && i.textContent.includes('幽默') && i.textContent.includes('适中') && i.textContent.includes('小段落')
    })()`))
    assert('自定义：预览卡展示组合后的风格指令', await run(`document.querySelector('.sc-preview .sc-tone').textContent.includes('语气轻松幽默')`))

    // 20. 角色扮演：输入芙宁娜 → 两阶段生成（阶段2 被门闩挂起以断言进度态）
    await run(`[...document.querySelectorAll('.seg button')].find((b) => b.textContent.includes('角色扮演')).click()`)
    await sleep(400)
    assert('角色面板：输入框 + 生成按钮 + 两阶段与缓存说明', await run(`(() => {
      const p = document.querySelector('.char-panel')
      return !!p && !!p.querySelector('.char-input-row input') && !!p.querySelector('.char-gen-btn')
        && p.textContent.includes('两阶段生成') && p.textContent.includes('缓存')
    })()`))
    await run(`(() => {
      const i = document.querySelector('.char-input-row input')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(i, '芙宁娜'); i.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await run(`document.querySelector('.char-gen-btn').click()`)
    const genPhase = await pollTrue(run, `(() => {
      const steps = document.querySelectorAll('.cp-steps i')
      return steps.length === 2 && steps[0].className === 'done' && steps[1].className === 'on'
    })()`, 6000)
    assert('两阶段进度：① 检索完成 → ② AI 合成进行中', genPhase)
    assert('生成中：按钮禁用并显示「生成中…」', await run(`(() => {
      const b = document.querySelector('.char-gen-btn')
      return b.disabled && b.textContent.includes('生成中')
    })()`))
    assert('阶段1：维基检索 + 摘录共 2 次请求', await run(`window.__wikiCalls === 2`))
    assert('阶段2：AI 合成调用 1 次', await run(`window.__chatCalls === 1`))
    await run(`window.__resolveChat && window.__resolveChat()`)
    const cardShown = await pollTrue(run, `(() => {
      const v = document.querySelector('.char-panel .sc-view')
      return !!v && v.textContent.includes('芙宁娜')
    })()`, 8000)
    assert('风格卡渲染：头像/名称/头衔 + 性格特质/语言习惯/口头禅/语气规范/风格指令', await run(`(() => {
      const v = document.querySelector('.char-panel .sc-view')
      if (!v) return false
      return !!v.querySelector('.sc-ava') && !!v.querySelector('.sc-chips span') && !!v.querySelector('.sc-line')
        && !!v.querySelector('.sc-prompt') && v.textContent.includes('性格特质') && v.textContent.includes('语言习惯')
        && v.textContent.includes('口头禅') && v.textContent.includes('语气规范')
    })()`))
    assert('风格卡：注明检索来源（维基百科·芙宁娜·N 字资料）', cardShown && await run(`(() => {
      const n = document.querySelector('.sc-note')
      return !!n && n.textContent.includes('维基百科') && n.textContent.includes('芙宁娜') && n.textContent.includes('字资料')
    })()`))
    assert('缓存：风格卡已写入本机（qingyu_style_cards_v1）', await run(`(() => {
      const o = JSON.parse(localStorage.getItem('qingyu_style_cards_v1') || '{}')
      return Object.keys(o).length === 1 && !!o['芙宁娜']
    })()`))

    // 21. 应用角色风格
    await run(`[...document.querySelectorAll('.sc-acts .btn')].find((b) => b.textContent.includes('应用此风格')).click()`)
    assert('应用角色风格：aiStyle=char + aiCharName 落盘', await pollTrue(run, `(() => {
      const s = JSON.parse(localStorage.getItem('qingyu_state_v3')).settings
      return s.aiStyle === 'char' && s.aiCharName === '芙宁娜'
    })()`, 6000))
    assert('应用后：卡片带「使用中」徽标且应用按钮禁用', await run(`(() => {
      const v = document.querySelector('.char-panel .sc-view')
      const u = v && v.querySelector('.sc-using')
      const b = [...document.querySelectorAll('.sc-acts .btn')].find((x) => x.textContent.includes('当前使用中'))
      return !!u && u.textContent === '使用中' && !!b && b.disabled
    })()`))

    // 22. 缓存命中：同名再生成瞬时返回，不再发起任何网络请求
    await run(`window.__wikiCalls = 0; window.__chatCalls = 0; 'ok'`)
    await run(`document.querySelector('.char-gen-btn').click()`)
    const cacheHit = await pollTrue(run, `(() => {
      const n = document.querySelector('.sc-note')
      return !!n && n.textContent.includes('已命中本机缓存')
    })()`, 6000)
    assert('缓存命中：同名角色免检索免生成（0 次网络请求）', cacheHit
      && await run(`window.__wikiCalls === 0 && window.__chatCalls === 0`))

    // 23. AI 分析页：顶部当前风格徽标（芙宁娜）
    await run(`[...document.querySelectorAll('.btn')].find((b) => b.textContent.includes('去生成账单分析')).click()`)
    await sleep(500)
    assert('AI 分析页：风格徽标显示角色名与头衔，可点击更换', await run(`(() => {
      const p = document.querySelector('.ai-style-pill')
      return !!p && p.querySelector('.asp-main b').textContent.includes('芙宁娜')
        && p.querySelector('.asp-main i').textContent.includes('水神') && p.textContent.includes('更换')
    })()`))
    assert('AI 分析页：徽标显示角色 emoji', await run(`document.querySelector('.asp-emoji').textContent === '🌊'`))
    await run(`history.back()`)
    await sleep(400)

    // 24. 删除缓存：使用中的角色卡被删 → 自动回落预设温柔
    await run(`document.querySelector('.sc-del').click()`)
    assert('删除缓存：本机风格卡清空 + 角色风格回落 tender', await pollTrue(run, `(() => {
      const s = JSON.parse(localStorage.getItem('qingyu_state_v3')).settings
      const o = JSON.parse(localStorage.getItem('qingyu_style_cards_v1') || '{}')
      return s.aiStyle === 'tender' && s.aiCharName === '' && Object.keys(o).length === 0
    })()`, 6000))
    assert('删除缓存：面板自动回到预设卡片视图', await run(`document.querySelector('.char-panel') === null && document.querySelectorAll('.style-cards .style-card').length === 4`))

    // ============ v1.9.0 用户资料云存档（变更检测 → 打包 → 校验 → 自动上传） ============
    // 25. 退回根页面（子页面无 TabBar，循环 back 直到出现）
    // 恢复原生 fetch：本块 WebDAV 走渲染进程 fetch（smoke 无 preload 桥），前面 v1.7.1/v1.8.0 的 mock 会拦截并假 200
    await run(`window.__qyNativeFetch && (window.fetch = window.__qyNativeFetch); 'ok'`)
    for (let i = 0; i < 6; i++) {
      if (await run(`!!document.querySelector('.tabbar')`)) break
      await run(`history.back()`)
      await sleep(400)
    }
    await run(`[...document.querySelectorAll('.tab')].find((b) => b.textContent.includes('我的')).click()`)
    await sleep(500)
    // 改名 helper：点 .me-name → （未登录态弹登录引导时点「暂不登录，先改个昵称」）→ Sheet 输入 → 保存修改
    const renameTo = async (name) => {
      await run(`document.querySelector('.me-name').click()`)
      await sleep(400)
      await run(`(() => {
        const b = [...document.querySelectorAll('.sheet button')].find((x) => x.textContent.includes('暂不登录，先改个昵称'))
        if (b) b.click()
        return 'ok'
      })()`)
      await sleep(300)
      await run(`(() => {
        const i = document.querySelector('.sheet input.input')
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(i, '${name}'); i.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`)
      await run(`[...document.querySelectorAll('.sheet button')].find((b) => b.textContent.includes('保存修改')).click()`)
      await sleep(400)
    }
    // 场景 A：未配置 WebDAV → 改昵称 → 静默跳过（0 上传、无记录）
    await run(`localStorage.removeItem('qingyu_sync_cfg_v1'); localStorage.removeItem('qingyu_profile_sync_v1'); 'ok'`)
    await renameTo('未配置用户')
    await sleep(4000)
    assert('未配置 WebDAV：改昵称静默跳过（0 上传、无本机记录）',
      await run(`localStorage.getItem('qingyu_profile_sync_v1') === null`) && profilePuts === 0)

    // 场景 B：配置本地假 WebDAV → 改昵称 → 防抖后自动打包上传（端到端成功链路）
    await run(`localStorage.setItem('qingyu_sync_cfg_v1', JSON.stringify({ url: '${stubUrl}', username: '', password: '' })); 'ok'`)
    await renameTo('云存档用户')
    let uploaded = false
    for (let i = 0; i < 24; i++) {
      await sleep(500)
      const st = await run(`JSON.stringify({ nick: (JSON.parse(localStorage.getItem('qingyu_state_v3') || '{}')?.settings || {}).nickname, rec: JSON.parse(localStorage.getItem('qingyu_profile_sync_v1') || 'null') })`)
      let parsed = null
      try { parsed = JSON.parse(st) } catch { /* ignore */ }
      if (i % 4 === 3) console.log(`  (B诊断 t+${((i + 1) * 0.5).toFixed(1)}s nick=${parsed?.nick} rec=${JSON.stringify(parsed?.rec)} puts=${profilePuts} ${JSON.stringify(putLog)})`)
      if (parsed?.rec?.at && parsed.rec.data?.nickname === '云存档用户' && !parsed.rec.error) { uploaded = true; break }
    }
    assert('变更检测：昵称改动后自动打包上传并落本机记录（无手动同步）', uploaded && profilePuts === 1)
    assert('档案包内容：kind/昵称/设备号齐备且过校验格式', (() => {
      try {
        const env = JSON.parse(profileBody)
        return env.kind === 'qingyu-user-archive-v1' && env.app === 'qingyu' && env.deviceId
          && env.data.nickname === '云存档用户' && !('transactions' in env.data)
      } catch { return false }
    })())

    // 场景 C：资料未变化的 state 更新（打卡）→ 签名不变 → 不上传
    await run(`(() => { const p = document.querySelector('.punch'); if (p && !p.disabled) p.click(); return 'ok' })()`)
    await sleep(3500)
    assert('打卡等无关变化：资料签名不变 → 不上传（0 新增请求）', profilePuts === 1)

    // 场景 D：云备份页 cell 显示最近存档时间；手动存档未变化 → 明确反馈且不再上传
    await run(`(${clickText})('.cell', '设置')`)
    await sleep(400)
    await run(`(${clickText})('.cell', '数据与安全')`)
    await sleep(400)
    await run(`(${clickText})('.cell', '云备份')`)
    await sleep(500)
    assert('云备份页：用户资料云存档 cell 显示最近存档时间',
      await run(`(() => {
        const c = [...document.querySelectorAll('.cell')].find((e) => e.textContent.includes('用户资料云存档'))
        return !!c && /\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}/.test(c.textContent)
      })()`))
    await run(`[...document.querySelectorAll('.cell')].find((e) => e.textContent.includes('用户资料云存档')).click()`)
    await sleep(500)
    assert('手动立即存档：资料未变化 → 明确反馈且不再上传',
      await run(`[...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('资料未变化'))`) && profilePuts === 1)
    await run(`history.back()`)
    await sleep(300)
    await run(`history.back()`)
    await sleep(300)
    await run(`history.back()`)
    await sleep(400)

    // 场景 E：服务不可达 → 失败 toast + 失败原因记录本机
    await run(`localStorage.setItem('qingyu_sync_cfg_v1', JSON.stringify({ url: 'http://127.0.0.1:1/dav/qingyu/backup.json', username: '', password: '' })); 'ok'`)
    await renameTo('失败测试')
    const errSeen = await pollTrue(run, `(() => {
      const r = JSON.parse(localStorage.getItem('qingyu_profile_sync_v1') || 'null')
      return !!r && !!r.error && !!r.error.message
    })()`, 12000)
    assert('上传失败：失败原因记录到本机（下次成功后清除）', errSeen && profilePuts === 1)
    assert('上传失败：弹错误提示（资料变化触发的失败必须可见）',
      await run(`[...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('资料云存档失败'))`))
    // 云备份页 cell 转为失败态展示
    await run(`[...document.querySelectorAll('.tab')].find((b) => b.textContent.includes('我的')).click()`)
    await sleep(400)
    await run(`(${clickText})('.cell', '设置')`)
    await sleep(400)
    await run(`(${clickText})('.cell', '数据与安全')`)
    await sleep(400)
    await run(`(${clickText})('.cell', '云备份')`)
    await sleep(500)
    assert('云备份页：失败后 cell 显示失败原因',
      await run(`(() => {
        const c = [...document.querySelectorAll('.cell')].find((e) => e.textContent.includes('用户资料云存档'))
        return !!c && c.textContent.includes('最近存档失败')
      })()`))

    // ============ v1.10.0 云同步（未登录头像引导 / 换机自动导入 / 变化自动上传） ============
    // 场景 F：未配置 WebDAV → 点头像 → 坚果云登录引导 Sheet（回到根页面）
    for (let i = 0; i < 6; i++) {
      if (await run(`!!document.querySelector('.tabbar')`)) break
      await run(`history.back()`)
      await sleep(400)
    }
    await run(`[...document.querySelectorAll('.tab')].find((b) => b.textContent.includes('我的')).click()`)
    await sleep(500)
    await run(`localStorage.removeItem('qingyu_sync_cfg_v1'); 'ok'`)
    // cloudReady 渲染时求值：开/关一次改名 Sheet 强制重渲染，让头像点击分流生效
    await run(`document.querySelector('.me-name').click()`)
    await sleep(400)
    await run(`(() => { const b = [...document.querySelectorAll('.sheet .sx')].pop(); if (b) b.click(); return 'ok' })()`)
    await sleep(300)
    // v1.10.1 未登录徽标：昵称旁琥珀色「未登录」胶囊，点击同样直达登录引导
    assert('未登录徽标：我的页显示「未登录」胶囊',
      await run(`(() => { const c = document.querySelector('.me-cloud'); return !!c && c.textContent.includes('未登录') })()`))
    await run(`document.querySelector('.me-cloud').click()`)
    await sleep(500)
    assert('未登录徽标：点击弹出坚果云登录引导',
      await run(`(() => { const h = document.querySelector('.sheet-head'); return !!h && h.textContent.includes('登录坚果云') })()`))
    await run(`(() => { const b = [...document.querySelectorAll('.sheet .sx')].pop(); if (b) b.click(); return 'ok' })()`)
    await sleep(300)
    await run(`document.querySelector('.me-head .avatar-wrap').click()`)
    await sleep(500)
    assert('未登录点头像：弹出坚果云登录引导',
      await run(`(() => {
        const h = document.querySelector('.sheet-head')
        return !!h && h.textContent.includes('登录坚果云') && document.querySelector('.sheet').textContent.includes('同步账单，换机不丢数据')
      })()`))
    await run(`window.open = (u) => { window.__jgyOpened = u; return null }; 'ok'`)
    await run(`(${clickText})('.sheet button', '打开坚果云登录页')`)
    await sleep(400)
    assert('登录引导：跳转坚果云登录页链接正确',
      await run(`(window.__jgyOpened || '').includes('jianguoyun.com/d/login')`))
    await run(`(${clickText})('.sheet button', '去应用内配置')`)
    await sleep(600)
    assert('登录引导：去应用内配置 → 落在云备份页',
      await run(`(() => {
        const t = document.body.textContent
        return t.includes('一键填入坚果云') && t.includes('配置后账单变化会自动双向同步')
      })()`))

    // 场景 G1：换机场景 —— 全新安装（空库）冷启动自动从云端导入资料与账单（restore 模式）
    // 云端种子 = 当前本机数据 + 云端昵称 + 标记账单（必须在修改后取值，模拟"另一台设备"的数据）
    const seedStateJson = await run(`(() => {
      const s = JSON.parse(localStorage.getItem('qingyu_state_v3'))
      s.settings.nickname = '云端用户'
      s.settings.welcomed = true
      const last = (s.transactions || []).slice(-1)[0]
      s.transactions.push({ id: 'tx-cloud-1', ledgerId: s.currentLedgerId, date: '2026-10-01', time: '12:00', type: 'expense', amount: 66.6, categoryId: last ? last.categoryId : null, accountId: last ? last.accountId : null, note: '云端导入的测试账单', createdAt: '2026-10-01T12:00' })
      return JSON.stringify(s)
    })()`)
    // 主进程直接种云端快照（新设备视角：云端已有老设备的数据）
    files.set('backup.json', { text: JSON.stringify({ app: 'qingyu', kind: 'qingyu-cloud-v1', appVersion: '1.9.0', at: new Date().toISOString(), deviceId: 'smoke-seed-device', data: JSON.parse(seedStateJson) }), etag: 'w-seed' })
    // 清空本机模拟换机 → 配置好坚果云（视为登录）→ 冷启动
    await run(`localStorage.clear(); localStorage.setItem('qingyu_sync_cfg_v1', JSON.stringify({ url: '${stubUrl}', username: '', password: '' })); 'ok'`)
    await win.loadFile(path.join(process.cwd(), 'dist', 'index.html'))
    await sleep(900)
    const restored = await pollTrue(run, `(() => {
      const last = JSON.parse(localStorage.getItem('qingyu_sync_last_v1') || 'null')
      if (!last || last.mode !== 'restore') return false
      const s = JSON.parse(localStorage.getItem('qingyu_state_v3') || 'null')
      return !!s && s.settings.nickname === '云端用户' && s.transactions.some((t) => t.id === 'tx-cloud-1')
    })()`, 25000)
    if (!restored) {
      const diag = await run(`JSON.stringify({
        last: JSON.parse(localStorage.getItem('qingyu_sync_last_v1') || 'null'),
        base: !!localStorage.getItem('qingyu_sync_base_v1'),
        cfg: localStorage.getItem('qingyu_sync_cfg_v1'),
        nick: ((JSON.parse(localStorage.getItem('qingyu_state_v3') || 'null') || {}).settings || {}).nickname,
        txN: (((JSON.parse(localStorage.getItem('qingyu_state_v3') || 'null') || {}).transactions) || []).length,
        marker: (((JSON.parse(localStorage.getItem('qingyu_state_v3') || 'null') || {}).transactions) || []).some((t) => t.id === 'tx-cloud-1'),
        welcomed: ((JSON.parse(localStorage.getItem('qingyu_state_v3') || 'null') || {}).settings || {}).welcomed,
        ledgers: (((JSON.parse(localStorage.getItem('qingyu_state_v3') || 'null') || {}).ledgers) || []).length,
        cats: Object.keys((((JSON.parse(localStorage.getItem('qingyu_state_v3') || 'null') || {}).categories) || {})).map((k) => k + ':' + ((JSON.parse(localStorage.getItem('qingyu_state_v3') || 'null')).categories[k] || []).length).join(','),
      })`)
      console.log('  (G1诊断 ' + diag + ' cloudEtag=' + ((files.get('backup.json') || {}).etag || 'none') + ')')
    }
    assert('换机场景：全新安装冷启动自动从云端导入资料与账单（restore 模式）', restored)

    // 场景 G2：登录后数据变化 → 账单快照自动推上云端
    await sleep(2000)
    await run(`[...document.querySelectorAll('.tab')].find((b) => b.textContent.includes('我的')).click()`)
    await sleep(500)
    await renameTo('自动上传用户')
    let pushed = false
    for (let i = 0; i < 30; i++) {
      await sleep(500)
      let nick = null
      try { nick = JSON.parse(files.get('backup.json').text)?.data?.settings?.nickname } catch { /* ignore */ }
      if (i % 8 === 7) console.log(`  (G2诊断 t+${((i + 1) * 0.5).toFixed(1)}s cloudNick=${nick} backupPuts=${backupPuts})`)
      if (nick === '自动上传用户') { pushed = true; break }
    }
    assert('变化自动上传：改昵称后账单快照自动推上云端（含新昵称）', pushed)

    // 场景 H：已配置 WebDAV → 点头像 → 原换头像弹层（回归保护）
    await run(`document.querySelector('.me-head .avatar-wrap').click()`)
    await sleep(500)
    assert('已登录点头像：仍是「换个形象」弹层',
      await run(`(() => {
        const h = document.querySelector('.sheet-head')
        return !!h && h.textContent.includes('换个形象')
      })()`))
    await run(`(() => { const b = [...document.querySelectorAll('.sheet .sx')].pop(); if (b) b.click(); return 'ok' })()`)
    await sleep(300)
  } catch (e) {
    results.push(['FAIL', '异常: ' + (e && e.message)])
    console.log('FAIL  异常: ' + (e && e.message))
  }
  for (const [s, n] of results) if (s === 'FAIL') failed = true
  console.log(failed ? 'SMOKE FAILED' : 'SMOKE ALL PASSED (' + results.length + ')')
  app.exit(failed ? 1 : 0)
})
