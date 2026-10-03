/* v2.2 更新模块视觉验证：Electron 加载 dist，mock 原生桥与 GitHub API，
 * 逐状态截图（卡片 idle/可更新/断点续传/下载中/就绪/失败/检查失败/后台浮卡），
 * 供图片理解审查布局与文案。运行：node scripts/update-shots.mjs （需先 npm run build）
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
const SHOT_DIR = path.join(os.tmpdir(), 'upd-shots')
fs.mkdirSync(SHOT_DIR, { recursive: true })

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 430, height: 900, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  })
  await win.loadFile(path.join(process.cwd(), 'dist', 'index.html'))
  await sleep(700)
  const run = (js) => win.webContents.executeJavaScript(js)

  // 预置跳过欢迎页 + 预置演示数据（视觉更真实）
  await run(`(() => {
    const k = 'qingyu_state_v3'
    const s = JSON.parse(localStorage.getItem(k) || 'null')
    if (s) { s.settings.welcomed = true; localStorage.setItem(k, JSON.stringify(s)) }
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
  // 子页（stack>0）不渲染 TabBar：先 history.back() 退栈再点底部 tab
  const goTab = async (label) => {
    await run(`document.querySelector('.tabbar') ? 'root' : history.back()`)
    await sleep(450)
    await run(`[...document.querySelectorAll('.tab')].find((b) => b.textContent.includes('${label}'))?.click()`)
    await sleep(450)
  }
  const openAbout = async () => {
    await run(`document.querySelector('.sheet-head .sx')?.click()`)
    await sleep(200)
    await run(`[...document.querySelectorAll('.cell')].find((e) => e.textContent.includes('关于轻语记账')).click()`)
    await sleep(350)
  }
  const checkUpdate = async () => {
    await openAbout()
    await run(`[...document.querySelectorAll('.sheet button')].find((b) => b.textContent.includes('检查更新')).click()`)
    await sleep(700)
  }
  // fetch mock 开关：mode=latest 返回 v9.9.9；mode=empty 无新版；mode=dead 全部断网
  const setNet = (mode) => run(`(() => {
    const sha = ${JSON.stringify('a'.repeat(64))}
    window.__netMode = ${JSON.stringify(mode)}
    window.fetch = (u) => {
      const url = String(u)
      if (window.__netMode === 'dead') return Promise.reject(new Error('ERR_INTERNET_DISCONNECTED'))
      if (url.includes('/releases/latest')) {
        if (window.__netMode === 'empty') return Promise.resolve(new Response('{}', { status: 200 }))
        return Promise.resolve(new Response(JSON.stringify({
          tag_name: 'v9.9.9', name: 'v9.9.9', draft: false, prerelease: false,
          body: '## 更新内容\\n1. 断点续传：中断后重试自动从断点继续\\n2. 定期检查更新，更省心\\n3. 下载失败提示更友好',
          published_at: '2026-10-03T08:00:00Z',
          assets: [
            { name: 'qingyu-v9.9.9-android.apk', browser_download_url: 'https://github.com/x/v9.9.9.apk', size: 27996979, created_at: '2026-10-03' },
            { name: 'qingyu-v9.9.9-android.apk.sha256', browser_download_url: 'https://github.com/x/v9.9.9.sha256', created_at: '2026-10-03' },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (url.includes('.sha256')) return Promise.resolve(new Response(sha + '  qingyu.apk\\n', { status: 200 }))
      return Promise.resolve(new Response('{}', { status: 200 }))
    }
    return 'ok'
  })()`)

  // mock 原生桥：partialBytes 控制断点场景；download 先 emit 进度再挂起等 __resolveDl
  const setBridge = (partialBytes, dlSha) => run(`(() => {
    window.__resolveDl = null
    window.__removeCalled = null
    window.__dlSha = ${JSON.stringify(dlSha || 'a'.repeat(64))}
    const partial = ${JSON.stringify(partialBytes)}
    let cbs = []
    window.__qyUpdateBridge = {
      addListener: async (ev, cb) => { if (ev === 'downloadProgress') cbs.push(cb); return { remove() { cbs = cbs.filter((x) => x !== cb) } } },
      download: async (opts) => {
        await new Promise((r) => setTimeout(() => { cbs.forEach((cb) => cb({ progress: 55, received: 15351040, total: 27996979 })); r() }, 40))
        await new Promise((r) => { window.__resolveDl = r })
        return { path: '/data/Download/' + opts.fileName, sha256: window.__dlSha, bytes: 27996979, resumed: partial > 0 }
      },
      partialInfo: async () => ({ exists: partial > 0, bytes: partial }),
      removeFile: async ({ path }) => { window.__removeCalled = path; return { deleted: true } },
      cancelDownload: async () => {},
      installerInfo: async () => ({ platform: 'android', sdkInt: 30, canInstall: true }),
      openInstallSettings: async () => {},
      install: async ({ path: p }) => ({ launched: true, path: p }),
    }
    localStorage.removeItem('qingyu_update_dismissed_v1')
    localStorage.removeItem('qingyu_update_check_v1')
    return 'ok'
  })()`)

  try {
    // ===== S1 设置页 UpdateCard（idle：已是最新版本） =====
    await setNet('empty')
    await setBridge(0)
    await run(`[...document.querySelectorAll('.tab')].pop().click()`)
    await sleep(400)
    await run(`[...document.querySelectorAll('.cell')].find((e) => e.textContent.includes('设置')).click()`)
    await sleep(3200) // 等 2.5s 启动自动检查完成 → idle
    await shot('S1-card-idle')

    // ===== S2 弹窗：发现新版本（立即更新） =====
    await setNet('latest')
    await goTab('我的')
    await checkUpdate()
    await shot('S2-prompt-available')

    // ===== S3 断点续传：按钮变「继续下载（断点续传）」+ 已下载提示 =====
    await setBridge(8388608)
    await run(`[...document.querySelectorAll('.upd-later')].find((b) => b.textContent.includes('以后再说'))?.click()`)
    await sleep(300)
    await checkUpdate()
    await shot('S3-prompt-resume')

    // ===== S4 下载中：环形进度 55% + 已下载/共 =====
    await run(`[...document.querySelectorAll('.upd-modal .btn')].find((b) => b.textContent.includes('继续下载')).click()`)
    await sleep(900)
    await shot('S4-prompt-downloading')

    // ===== S4b 后台浮卡：最小化到浮卡 =====
    await run(`document.querySelector('.upd-modal .upd-x').click()`)
    await sleep(500)
    await shot('S4b-float-downloading')

    // ===== S5 就绪：立即安装 =====
    await run(`window.__resolveDl ? (window.__resolveDl(), 'ok') : 'no-latch'`)
    await sleep(1400)
    await run(`document.querySelector('.upd-float')?.click()`) // 浮卡 → 打开弹窗
    await sleep(500)
    await shot('S5-prompt-ready')

    // ===== S6 SHA 校验失败：损坏包已删除 + 断点续传提示 =====
    await run(`document.querySelector('.upd-modal .upd-x')?.click()`)
    await sleep(300)
    await setBridge(8388608, 'c'.repeat(64)) // 摘要不匹配
    await checkUpdate() // 重新检查 → available
    await run(`[...document.querySelectorAll('.upd-modal .btn')].find((b) => b.textContent.includes('继续下载')).click()`)
    await sleep(1200)
    await run(`window.__resolveDl ? (window.__resolveDl(), 'ok') : 'no-latch'`)
    await sleep(1400)
    await shot('S6-prompt-sha-error')

    // ===== S7 检查失败（断网）：友好错误视图 =====
    await run(`document.querySelector('.upd-modal .upd-x')?.click()`)
    await sleep(300)
    await setNet('dead')
    await setBridge(0)
    await goTab('我的')
    await checkUpdate()
    await shot('S7-prompt-check-error')

    console.log('DONE ' + SHOT_DIR)
  } catch (e) {
    console.log('ERR ' + (e && e.message))
  } finally {
    await sleep(200)
    app.quit()
  }
})
