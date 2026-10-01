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
    await run(`(${clickText})('.cell', '发现页功能图标')`)
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

    // 5. 底部菜单图标：非白底拦截 → 白底成功（v1.6.1 仅图片方式，无表情入口）
    await run(`(${clickText})('.cell', '底部菜单图标')`)
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

    // 7. 持久化汇总
    const persist = await run(`(() => { const s = JSON.parse(localStorage.getItem('qingyu_state_v3')).settings; return { glass: s.glassOn, tap: s.tapFeedback, tapScale: s.tapScale, vib: s.vibrateLevel, avatar: !!s.avatarPhotoAt, icon: !!s.tabIconAt?.home, disc: !!s.discIconAt?.scan } })()`)
    assert('持久化：glassOn=true', persist.glass === true)
    assert('持久化：tapFeedback=true', persist.tap === true)
    assert('持久化：tapScale=true（拆分迁移正确）', persist.tapScale === true)
    assert('持久化：vibrateLevel=2（恢复标准档）', persist.vib === 2)
    assert('持久化：avatarPhotoAt 已写入', persist.avatar === true)
    assert('持久化：tabIconAt.home 已写入', persist.icon === true)
    assert('持久化：discIconAt.scan 已写入', persist.disc === true)
  } catch (e) {
    results.push(['FAIL', '异常: ' + (e && e.message)])
    console.log('FAIL  异常: ' + (e && e.message))
  }
  for (const [s, n] of results) if (s === 'FAIL') failed = true
  console.log(failed ? 'SMOKE FAILED' : 'SMOKE ALL PASSED (' + results.length + ')')
  app.exit(failed ? 1 : 0)
})
