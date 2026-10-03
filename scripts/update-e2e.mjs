/* v2.3 更新链路端到端真网验证（Node 直连，无任何 mock）：
 * 1. 检测：以 v2.2 旧版本视角请求 GitHub Releases API（真实网络）→ parseRelease 应解析出 v2.3
 * 2. 下载：按 update.js 的镜像候选顺序（gh-proxy → ghfast → 官方直连）真实流式下载 APK
 * 3. 校验：.sha256 文本同样多源获取，本地计算 SHA-256 与之比对（与应用内安装前校验同算法）
 * 用法：node scripts/update-e2e.mjs [旧版本号=2.2]
 */
import { checkForUpdate, buildDownloadCandidates, fetchSha256WithFallback } from '../src/update.js'
import { createHash } from 'node:crypto'

const OLD_VERSION = process.argv[2] || '2.2'
const results = []
const assert = (name, cond) => {
  results.push([cond, name])
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name)
}

// ---------- 1. 检测（真实 GitHub API） ----------
console.log(`[1/3] 检测更新：以 v${OLD_VERSION} 视角请求 GitHub API …`)
const info = await checkForUpdate(OLD_VERSION, { force: true }).catch((e) => {
  console.log('  检测失败：' + (e && e.message))
  return null
})
assert(`检测到新版本 Release（期望 v2.3，实际 ${info?.tag || '无'}）`, !!info && info.tag === 'v2.3')
assert('版本解析正确（version=2.3 > 旧版）', !!info && info.version === '2.3')
assert('APK 资产解析正确（名称 + 大小 + 直链）',
  !!info && /qingyu-v2\.3-android\.apk$/i.test(info.apkName) && info.size > 1024 * 1024
  && /^https:\/\/github\.com\//.test(info.apkUrl))
assert('SHA-256 校验文件配对（CI 随包上传）', !!info && /qingyu-v2\.3-android\.apk\.sha256$/i.test(info.sha256Url))

// ---------- 2. 下载（镜像候选顺序，真实流式） ----------
if (!info) {
  console.log('检测失败，跳过下载校验')
} else {
  console.log('[2/3] 下载 APK（候选顺序：加速镜像 ×2 → 官方直连）…')
  const candidates = buildDownloadCandidates(info.apkUrl)
  console.log('  候选：' + candidates.map((u, i) => (i < candidates.length - 2 ? '镜像' : i < candidates.length - 1 ? '镜像2' : '直连')).join(' → '))
  let buf = null
  let via = ''
  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i]
    const label = i < candidates.length - 1 ? `镜像#${i + 1}` : '官方直连'
    try {
      const t0 = Date.now()
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 120_000)
      const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' })
      clearTimeout(timer)
      if (!res.ok) throw new Error('HTTP_' + res.status)
      const ab = await res.arrayBuffer()
      if (ab.byteLength < 1024 * 1024) throw new Error('TOO_SMALL ' + ab.byteLength)
      buf = Buffer.from(ab)
      via = label
      console.log(`  ✓ ${label} 成功：${(buf.length / 1024 / 1024).toFixed(2)} MB / ${(Date.now() - t0) / 1000}s`)
      break
    } catch (e) {
      console.log(`  ✗ ${label} 失败（${String(e && e.message).slice(0, 60)}）→ 换下一候选`)
    }
  }
  assert(`APK 下载成功（经由 ${via}，${buf ? (buf.length / 1024 / 1024).toFixed(2) + ' MB' : '失败'}）`, !!buf)
  assert('下载字节数与 Release 元数据一致', !!buf && buf.length === info.size)

  // ---------- 3. 完整性校验（与应用内安装前同算法：SHA-256） ----------
  console.log('[3/3] 完整性校验：SHA-256 …')
  const expect = await fetchSha256WithFallback(info.sha256Url)
  assert('成功获取 CI 发布的 .sha256 校验文本', !!expect && /^[0-9a-f]{64}$/.test(expect))
  const actual = buf ? createHash('sha256').update(buf).digest('hex') : ''
  console.log(`  期望 ${expect || '(空)'}\n  实际 ${actual}`)
  assert('SHA-256 完全一致（安装前校验必然通过）', !!expect && expect === actual)
}

const failed = results.filter(([c]) => !c).length
console.log(failed ? `\n${failed} 项失败` : `\n全部通过：${results.length} 项`)
process.exit(failed ? 1 : 0)
