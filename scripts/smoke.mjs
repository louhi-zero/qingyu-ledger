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
import os from 'os'
import path from 'path'

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'qy-smoke-v16-')))
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

    // 预置：跳过欢迎页
    await run(`(() => {
      const k = 'qingyu_state_v3'
      const s = JSON.parse(localStorage.getItem(k) || 'null')
      if (!s) return 'no-state'
      s.settings.welcomed = true
      localStorage.setItem(k, JSON.stringify(s))
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

    // v1.6.8 震动强度四档：桩换 navigator.vibrate 捕获入参，pointerdown 实测各档时长
    await run(`window.__vibs = [];
      const origVib = navigator.vibrate ? navigator.vibrate.bind(navigator) : () => true;
      Object.defineProperty(navigator, 'vibrate', { configurable: true, writable: true,
        value: (p) => { window.__vibs.push(Array.isArray(p) ? p.slice() : p); return true } });
      window.__tapCell = (extra) => {
        const el = document.querySelector('.vibrate-cell') || document.querySelector('.cell');
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, isPrimary: true, clientX: 10, clientY: 10 }));
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
      };
      'ok'`)
    const setVibLevel = async (idx) => {
      await run(`document.querySelectorAll('.vibrate-cell .seg button')[${idx}].click()`)
      await sleep(150)
    }
    await setVibLevel(2)
    await run(`window.__vibs = []; window.__tapCell()`)
    await sleep(60)
    assert('震动标准档：pointerdown 触发 10ms', await run(`JSON.stringify(window.__vibs)`).then((v) => JSON.parse(v)).then((a) => a.includes(10)).catch(() => false))
    await setVibLevel(1)
    await run(`window.__vibs = []; window.__tapCell()`)
    await sleep(60)
    assert('震动轻柔档：触发 6ms', await run(`JSON.stringify(window.__vibs)`).then((v) => JSON.parse(v)).then((a) => a.includes(6)).catch(() => false))
    await setVibLevel(3)
    await run(`window.__vibs = []; window.__tapCell()`)
    await sleep(60)
    assert('震动明快档：触发 20ms', await run(`JSON.stringify(window.__vibs)`).then((v) => JSON.parse(v)).then((a) => a.includes(20)).catch(() => false))
    // 滑动超过 14px → 撤震 vibrate(0)
    await run(`window.__vibs = [];
      const el = document.querySelector('.vibrate-cell');
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, clientX: 10, clientY: 10 }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 40, clientY: 10 }));
      'ok'`)
    await sleep(60)
    assert('滑动意图撤震：调用 vibrate(0)', await run(`JSON.stringify(window.__vibs)`).then((v) => JSON.parse(v)).then((a) => a.includes(0)).catch(() => false))
    await setVibLevel(0)
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

    // ============ v1.7.0 应用内更新（Web 兜底 + mock 原生桥全状态机 + SHA 校验） ============
    // 13. mock GitHub Releases API；先测 Web/Electron 兜底（强制无原生桥 → 外链）
    await run(`(() => {
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
    assert('更新中心：发现 v9.9.9 并渲染更新日志（markdown 符号已清理）',
      await run(`(() => { const v = [...document.querySelectorAll('.upd-ver')].some((e) => e.textContent.includes('v9.9.9'))
        const notes = document.querySelector('.upd-notes')
        return v && notes && notes.textContent.includes('新增应用内更新') && !notes.textContent.includes('##') })()`))
    assert('Web 端：显示「前往下载页」而非下载按钮',
      await run(`!![...document.querySelectorAll('.sheet .btn')].find((b) => b.textContent.includes('前往下载页'))
        && ![...document.querySelectorAll('.sheet .btn')].some((b) => b.textContent.includes('立即下载'))`))
    assert('Web 端：不显示自动下载开关（仅原生有意义）',
      await run(`![...document.querySelectorAll('.sheet .cell')].some((e) => e.textContent.includes('自动下载'))`))
    await run(`[...document.querySelectorAll('.sheet .btn')].find((b) => b.textContent.includes('前往下载页')).click()`)
    await sleep(200)
    assert('Web 端：点击打开对应 GitHub Release 页', await run(`(window.__openedUrl || '').includes('releases/tag/v9.9.9')`))
    await run(`[...document.querySelectorAll('.sheet .upd-later')].find((b) => b.textContent.includes('以后再说')).click()`)
    await sleep(300)
    assert('「以后再说」按版本写入 dismissed', await run(`localStorage.getItem('qingyu_update_dismissed_v1') === 'v9.9.9'`))

    // 14. mock 原生桥：受控下载（进度浮卡）→ SHA 匹配 → 就绪 → 拉起安装器
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
    await run(`[...document.querySelectorAll('.sheet-head .sx')].forEach((b) => b.click())`)
    await sleep(400)
    await run(`[...document.querySelectorAll('.cell')].find((e) => e.textContent.includes('关于')).click()`)
    await sleep(400)
    await run(`[...document.querySelectorAll('.sheet button')].find((b) => b.textContent.includes('检查更新')).click()`)
    await sleep(600)
    assert('原生：显示「立即下载」与自动下载开关',
      await run(`!![...document.querySelectorAll('.sheet .btn')].find((b) => b.textContent.includes('立即下载'))
        && [...document.querySelectorAll('.sheet .cell')].some((e) => e.textContent.includes('自动下载'))`))
    await run(`[...document.querySelectorAll('.sheet .btn')].find((b) => b.textContent.includes('立即下载')).click()`)
    await sleep(300)
    await run(`[...document.querySelectorAll('.sheet-head .sx')].pop().click()`) // 关更新 Sheet（关于弹窗留在下层）
    await sleep(300)
    const dlFloat = await pollTrue(run,
      `!!document.querySelector('.upd-float') && document.querySelector('.upd-float').textContent.includes('30%')`, 6000)
    assert('浮卡：下载中显示进度 30%（进度只涨不跌）', dlFloat)
    await run(`window.__resolveDl && window.__resolveDl()`)
    const readyFloat = await pollTrue(run,
      `!![...document.querySelectorAll('.upd-float b')].some((b) => b.textContent.includes('已就绪'))`, 8000)
    assert('SHA-256 校验通过 → 浮卡进入就绪态', readyFloat)
    await run(`document.querySelector('.upd-float').click()`) // ready → 直接安装
    await sleep(400)
    assert('点击安装：向系统安装器传出下载好的 APK 路径',
      await run(`(window.__installCalled || '').includes('qingyu-v9.9.9-android.apk')`))

    // 15. SHA-256 不符（下载摘要与 .sha256 资产不一致）→ 失败态并删除可疑文件
    await run(`(() => {
      window.__cancelCalled = false
      window.__resolveDl = null
      window.__dlSha = 'c'.repeat(64)     // 实际下载算出的摘要
      window.__shaExpect = 'd'.repeat(64) // CI 发布的期望摘要
      window.__qyUpdateBridge = window.__makeBridge()
      return 'ok'
    })()`)
    await run(`[...document.querySelectorAll('.sheet-head .sx')].forEach((b) => b.click())`)
    await sleep(400)
    await run(`[...document.querySelectorAll('.cell')].find((e) => e.textContent.includes('关于')).click()`)
    await sleep(400)
    await run(`[...document.querySelectorAll('.sheet button')].find((b) => b.textContent.includes('检查更新')).click()`)
    await sleep(600)
    await run(`[...document.querySelectorAll('.sheet .btn')].find((b) => b.textContent.includes('立即下载')).click()`)
    await sleep(300)
    await run(`[...document.querySelectorAll('.sheet-head .sx')].pop().click()`)
    await sleep(200)
    await run(`window.__resolveDl && window.__resolveDl()`)
    const errFloat = await pollTrue(run,
      `!!document.querySelector('.upd-float') && document.querySelector('.upd-float').textContent.includes('失败')`, 8000)
    assert('SHA 不符：浮卡进入失败态', errFloat)
    assert('SHA 不符：已调用原生 cancel 删除可疑安装包', await run(`window.__cancelCalled === true`))
    await run(`document.querySelector('.upd-float').click()`) // error → 打开 Sheet
    await sleep(300)
    assert('Sheet：展示 SHA-256 完整性校验失败文案',
      await run(`!!document.querySelector('.sandbox-fail') && document.querySelector('.sandbox-fail').textContent.includes('SHA-256')`))
    // 自动下载开关持久化（更新 Sheet 内开关，切到关再验证落盘）
    await run(`(() => {
      const cell = [...document.querySelectorAll('.sheet .cell')].find((e) => e.textContent.includes('自动下载'))
      cell.querySelector('button.switch').click()
      return true
    })()`)
    await sleep(300)
    assert('自动下载开关可关闭并持久化', await pollTrue(run,
      `JSON.parse(localStorage.getItem('qingyu_state_v3')).settings.updateAutoDl === false`, 5000))
    await run(`[...document.querySelectorAll('.sheet-head .sx')].forEach((b) => b.click())`)
    await sleep(300)
  } catch (e) {
    results.push(['FAIL', '异常: ' + (e && e.message)])
    console.log('FAIL  异常: ' + (e && e.message))
  }
  for (const [s, n] of results) if (s === 'FAIL') failed = true
  console.log(failed ? 'SMOKE FAILED' : 'SMOKE ALL PASSED (' + results.length + ')')
  app.exit(failed ? 1 : 0)
})
