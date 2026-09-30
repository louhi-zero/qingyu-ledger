import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // 相对路径，便于 Electron file:// 直接加载 dist；Web 服务在根路径同样可用
  base: './',
  plugins: [react()],
  server: { host: true, port: 5173 },
})
