// v3.1 Android Keystore 安全存储（API Key 等敏感数据脱离 localStorage）
//
// 原生端：SecureStorePlugin 用 AndroidKeyStore 生成的 AES-256 密钥加密后存 SharedPreferences，
// 密钥本身不可导出（TEE 保护）。JS 端：启动时 initSecureStore() 异步 hydrate 到内存缓存
// （含 localStorage 旧明文一次性迁移+清除），同步读走内存缓存——loadAiCfg 等同步调用方签名不变。
// Web/Electron 无原生插件 → 回落 localStorage 原行为。
import { Capacitor, registerPlugin } from '@capacitor/core'

export const SECURE_KEY_AI = 'ai_cfg_v1'
export const LEGACY_AI_KEY = 'qingyu_ai_cfg_v1'

let store = null
try {
  store = registerPlugin('SecureStore')
} catch { /* 非原生环境回落 */ }

const isNative = () => Capacitor.isNativePlatform() && !!store

let cache = {} // { [secureKey]: json }
let hydrated = false
let hydrating = null

/** 启动时调用一次：Keystore → 内存缓存；localStorage 旧明文一次性迁移进 Keystore 后清除 */
export function initSecureStore() {
  if (!isNative() || hydrating) return hydrating || Promise.resolve()
  hydrating = (async () => {
    try {
      const legacy = localStorage.getItem(LEGACY_AI_KEY)
      if (legacy) {
        await store.set({ key: SECURE_KEY_AI, value: legacy })
        localStorage.removeItem(LEGACY_AI_KEY)
      }
      const r = await store.get({ key: SECURE_KEY_AI })
      if (r && r.value) {
        try {
          const parsed = JSON.parse(r.value) || {}
          // 竞态防护：hydrate 在途时用户可能已保存（cache 已有新值），
          // 此时不能用启动快照覆盖刚写入的配置，仅在缓存为空时采纳
          if (!Object.keys(cache).length) cache = parsed
        } catch { cache = {} }
      }
      hydrated = true
    } catch { hydrated = true }
  })()
  return hydrating
}

/** 等 hydrate 完成（App 启动时 await，保证后续同步读准确） */
export function secureReady() {
  return hydrating || Promise.resolve()
}

/** 同步读（hydrate 完成后为 Keystore 数据；启动早期短暂回落 localStorage/默认值） */
export function secureGetJson(key) {
  if (key in cache) return cache[key]
  try {
    const raw = localStorage.getItem(LEGACY_AI_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

/** 异步写：Keystore 持久化 + 内存缓存；非原生回落 localStorage */
export async function secureSetJson(key, value) {
  cache[key] = value
  if (isNative()) {
    try { await store.set({ key, value: JSON.stringify(value ?? null) }) } catch { /* 内存保留 */ }
    return true
  }
  try { localStorage.setItem(LEGACY_AI_KEY, JSON.stringify(value ?? null)) } catch { /* ignore */ }
  return true
}
