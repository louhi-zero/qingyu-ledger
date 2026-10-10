import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// v3.3 把 public/sw.js 里的 __QY_SW_VERSION__ 替换为本次构建的唯一标识。
// 每次发版缓存桶必变 → 旧版本缓存在 activate 时被清理，
// 杜绝「升级后仍命中旧入口页 → 引用已不存在的旧 assets → 打开 App 卡启动页」。
function swVersion() {
  let outDir = 'dist'
  return {
    name: 'qy-sw-version',
    apply: 'build',
    configResolved(cfg) {
      outDir = cfg.build.outDir
    },
    closeBundle() {
      const file = resolve(process.cwd(), outDir, 'sw.js')
      try {
        const src = readFileSync(file, 'utf8')
        const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
        const ver = `${stamp}-${createHash('sha1').update(src).digest('hex').slice(0, 8)}`
        writeFileSync(file, src.replace(/__QY_SW_VERSION__/g, ver))
      } catch { /* 未产出 sw.js 时静默跳过 */ }
    },
  }
}

export default defineConfig({
  // 相对路径，便于 Electron file:// 直接加载 dist；Web 服务在根路径同样可用
  base: './',
  plugins: [react(), swVersion()],
  server: { host: true, port: 5173 },
})
