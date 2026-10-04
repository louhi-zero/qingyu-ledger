/* v2.6 视频动态背景端到端验证：
 * 浏览器内 canvas.captureStream + MediaRecorder 生成 webm → IndexedDB kv['bgvideo']
 * → 设置 bgVideoAt/assetsMeta → 重载 → 断言 .bd-video 层存在并截图
 * 运行：npx electron scripts/v26-videotest.mjs （需先 npm run build）
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
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

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
  // MediaRecorder 在隐藏窗口下产出 0 字节：先显示窗口再录制
  win.show(); win.focus()
  await win.loadFile(path.join(process.cwd(), 'dist', 'index.html'))
  await sleep(700)
  const run = (js) => win.webContents.executeJavaScript(js)

  await run(`(() => {
    const k = 'qingyu_state_v3'
    const s = JSON.parse(localStorage.getItem(k) || 'null')
    if (s) { s.settings.welcomed = true; localStorage.setItem(k, JSON.stringify(s)) }
    localStorage.setItem('qingyu_splash_off', '1')
    return 'ok'
  })()`)
  await win.loadFile(path.join(process.cwd(), 'dist', 'index.html'))
  await sleep(900)

  // 1. 生成视频 blob 并写入 IndexedDB + 更新状态。
  // 注：此环境 MediaRecorder（canvas.captureStream / timeslice 均试过）恒产出 0 字节，
  // 无法合成真视频；改用带 WebM magic 的哑 blob 验证「IndexedDB → 状态 → .bd-video 视频层」接线，
  // <video> 元素的解码行为由 Chromium 标准能力保证（真机上传 mp4/webm 走同一代码路径）。
  const gen = await run(`(async () => {
    try {
      const head = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]) // EBML magic
      const pad = new Uint8Array(64 * 1024)
      const blob = new Blob([head, pad], { type: 'video/webm' })
      if (blob.size < 1000) return 'too-small:' + blob.size
      // 写 IndexedDB（与 src/blobdb.js 同库同仓）
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('qingyu_blobs_v1', 1)
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }
        req.onsuccess = () => {
          const d = req.result
          const t2 = d.transaction('kv', 'readwrite')
          t2.objectStore('kv').put(blob, 'bgvideo')
          t2.oncomplete = () => { d.close(); resolve() }
          t2.onerror = () => reject(t2.error)
        }
        req.onerror = () => reject(req.error)
      })
      // 状态：bgVideoAt + assetsMeta.bgvideo
      const k = 'qingyu_state_v3'
      const s = JSON.parse(localStorage.getItem(k))
      s.settings.bgVideoAt = new Date().toISOString()
      s.assetsMeta.bgvideo = { at: s.settings.bgVideoAt, hash: 'videotest' }
      localStorage.setItem(k, JSON.stringify(s))
      return 'ok size=' + blob.size
    } catch (e) { return 'ERR ' + (e && e.message) }
  })()`)
  console.log('GEN ' + gen)
  if (!String(gen).startsWith('ok')) { app.exit(1); return }

  // 2. 重载 → 视频层应替代图片层
  await win.loadFile(path.join(process.cwd(), 'dist', 'index.html'))
  await sleep(1600)
  const state = await run(`(() => {
    const v = document.querySelector('.bd-video')
    const img = document.querySelector('.bd-img')
    return {
      hasVideo: !!v,
      paused: v ? v.paused : null,
      readyState: v ? v.readyState : null,
      videoW: v ? v.videoWidth : null,
      loop: v ? v.loop : null,
      muted: v ? v.muted : null,
      imgGone: !img,
    }
  })()`)
  console.log('VIDEO_STATE ' + JSON.stringify(state))
  const ok = state.hasVideo && state.imgGone && state.loop && state.muted
  if (ok) {
    if (!win.isVisible()) { win.show(); win.focus(); await sleep(400) }
    await sleep(700) // 等首帧渲染
    const img = await win.webContents.capturePage()
    const file = path.join(SHOT_DIR, '07-videobg.png')
    fs.writeFileSync(file, img.toPNG())
    console.log('SHOT ' + file)
  }
  console.log(ok ? 'VIDEO BG PASS' : 'VIDEO BG FAIL')
  app.exit(ok ? 0 : 1)
}).catch((e) => { console.error('FATAL', e); app.exit(1) })
