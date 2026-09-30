/* 桌面开发启动器：先开一个终端执行 `npm run dev`，再运行 `npm run desktop`
 * 会以 VITE_DEV_SERVER_URL 启动 Electron 指向本地 Vite。
 */
process.env.VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
require('child_process').spawn(
  require('path').join('node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron'),
  ['.'],
  { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' }
).on('exit', (code) => process.exit(code || 0))
