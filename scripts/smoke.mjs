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

    // 1. 我的页：白色质感头部（玻璃关 → 实色白卡）
    await run(`[...document.querySelectorAll('.tab')].pop().click()`)
    await sleep(400)
    const headOff = await run(`(() => {
      const el = document.querySelector('.me-head')
      const cs = getComputedStyle(el)
      return { bg: cs.backgroundColor, color: cs.color }
    })()`)
    assert('玻璃关：头部为白卡（rgb(255,255,255)）', headOff.bg === 'rgb(255, 255, 255)')
    assert('玻璃关：头部文字为深色墨色', headOff.color === 'rgb(31, 36, 48)')
    // v1.6.2：根级页顶部预留状态栏安全区 + 玻璃过渡提速
    assert('我的页顶部预留安全区（paddingTop=12px 基础间距）', await run(`getComputedStyle(document.querySelector('.page-body')).paddingTop === '12px'`))
    assert('玻璃材质过渡提速至 0.24s', await run(`getComputedStyle(document.querySelector('.group')).transitionDuration.includes('0.24s')`))

    // 2. 头像上传非白底（红底）图片 → 成功（轮询等落盘）
    await run(`document.querySelector('.me-head .avatar').click()`)
    await sleep(400)
    await run(`(${INJECT})('nonwhite')`)
    const av = await pollTrue(run, `(() => { const s = JSON.parse(localStorage.getItem('qingyu_state_v3')); return s.settings.avatarPhotoAt || null })()`)
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
    // 关掉点击反馈 → data-tap=off；再开回来
    await run(`(${clickText})('.cell', '按压缩放与轻震动')`)
    await sleep(200)
    assert('点击反馈关：data-tap=off', await run(`document.documentElement.dataset.tap === 'off'`))
    await run(`(${clickText})('.cell', '按压缩放与轻震动')`)
    await sleep(200)
    assert('点击反馈开：data-tap=on', await run(`document.documentElement.dataset.tap === 'on'`))

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
    await sleep(1200)
    const t2 = await run(`(() => { const s = JSON.parse(localStorage.getItem('qingyu_state_v3')); return s.settings.tabIconAt?.home || null })()`)
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

    // 7. 持久化汇总
    const persist = await run(`(() => { const s = JSON.parse(localStorage.getItem('qingyu_state_v3')).settings; return { glass: s.glassOn, tap: s.tapFeedback, avatar: !!s.avatarPhotoAt, icon: !!s.tabIconAt?.home } })()`)
    assert('持久化：glassOn=true', persist.glass === true)
    assert('持久化：tapFeedback=true', persist.tap === true)
    assert('持久化：avatarPhotoAt 已写入', persist.avatar === true)
    assert('持久化：tabIconAt.home 已写入', persist.icon === true)
  } catch (e) {
    results.push(['FAIL', '异常: ' + (e && e.message)])
    console.log('FAIL  异常: ' + (e && e.message))
  }
  for (const [s, n] of results) if (s === 'FAIL') failed = true
  console.log(failed ? 'SMOKE FAILED' : 'SMOKE ALL PASSED (' + results.length + ')')
  app.exit(failed ? 1 : 0)
})
