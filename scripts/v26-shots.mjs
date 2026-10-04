/* v2.6 视觉验证：黑白灰 + 分类线性图标 + 背景轮播 + 视频/轮播设置 + 图标库选择器
 * Electron 加载 dist，逐页截图供图片理解审查。运行：node scripts/v26-shots.mjs （需先 npm run build）
 */
import { app, BrowserWindow } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'

try {
  for (const d of fs.readdirSync(os.tmpdir())) {
    if (d.startsWith('qy-shots-')) fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true })
  }
} catch { /* ignore */ }
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qy-shots-'))
app.setPath('userData', tmpRoot)
app.setPath('temp', tmpRoot)
app.setPath('cache', path.join(tmpRoot, 'cache'))
app.on('will-quit', () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* ignore */ } })
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SHOT_DIR = path.join(process.cwd(), '_analysis', 'shots-v26')
fs.mkdirSync(SHOT_DIR, { recursive: true })

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 430, height: 900, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  })
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) console.log('  [renderer error]', String(message).slice(0, 200))
  })
  await win.loadFile(path.join(process.cwd(), 'dist', 'index.html'))
  await sleep(700)
  const run = (js) => win.webContents.executeJavaScript(js)

  // 预置跳过欢迎页/启动页
  await run(`(() => {
    const k = 'qingyu_state_v3'
    const s = JSON.parse(localStorage.getItem(k) || 'null')
    if (s) { s.settings.welcomed = true; localStorage.setItem(k, JSON.stringify(s)) }
    localStorage.setItem('qingyu_splash_off', '1')
    return 'ok'
  })()`)
  await win.loadFile(path.join(process.cwd(), 'dist', 'index.html'))
  await sleep(900)

  const shot = async (name) => {
    if (!win.isVisible()) { win.show(); win.focus(); await sleep(400) }
    const img = await win.webContents.capturePage()
    const file = path.join(SHOT_DIR, name + '.png')
    fs.writeFileSync(file, img.toPNG())
    console.log('SHOT ' + file)
  }
  // 子页（stack>0）不渲染 TabBar：先退栈再点 tab
  const goRoot = async () => {
    await run(`document.querySelector('.tabbar') ? 'root' : history.back()`)
    await sleep(400)
  }
  const goTab = async (label) => {
    await goRoot()
    await run(`[...document.querySelectorAll('.tab')].find((b) => b.textContent.includes('${label}'))?.click()`)
    await sleep(450)
  }
  const clickCell = async (txt) => {
    const ok = await run(`(() => {
      const el = [...document.querySelectorAll('.cell')].find((e) => e.textContent.includes('${txt}'))
      if (el) { el.click(); return true }
      return false
    })()`)
    await sleep(450)
    return ok
  }

  // 载入示例数据（数据与安全 页），让首页/记账有真实内容
  await goTab('我的')
  await clickCell('设置')
  await clickCell('数据与安全')
  await clickCell('载入示例数据')
  await goRoot()
  await goRoot()
  await goTab('明细')
  await sleep(600)

  // 1. 首页：樱花背景 + 黑白灰 + 线性 tab 图标 + 账单列表分类图标的整体观感
  await shot('01-home')
  // 2. 记一笔：分类 chip 线性图标
  await run(`document.querySelector('.tab-add')?.click()`)
  await sleep(550)
  await shot('02-add')
  await run(`document.querySelector('.sheet-head .sx')?.click()`)
  await sleep(300)
  // 3. 发现页：语义三色宫格
  await goTab('发现')
  await shot('03-discover')
  // 4. 我的页：黑白灰头部 + 打卡按钮
  await goTab('我的')
  await shot('04-profile')
  // 5. 外观与个性化：背景循环播放/轮换间隔/视频动态背景 设置项
  await clickCell('设置')
  await clickCell('外观与个性化')
  await run(`window.scrollTo(0, 400)`)
  await sleep(300)
  await shot('05-appearance')
  // 6. 分类管理 → 编辑分类 → 图标库选择器（28 枚网格）
  await run(`history.back()`)
  await sleep(400)
  await clickCell('数据与安全')
  await clickCell('分类管理')
  await run(`document.querySelector('.iconbtn')?.click()`) // 第一张卡 ✏️
  await sleep(400)
  await run(`[...document.querySelectorAll('.selectline')].find((e) => e.textContent.includes('点击更换'))?.click()`)
  await sleep(500)
  await shot('06-iconlib')

  console.log('V26 SHOTS DONE')
  app.exit(0)
}).catch((e) => { console.error('FATAL', e); app.exit(1) })
