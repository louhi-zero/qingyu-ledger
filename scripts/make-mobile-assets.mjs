/* 生成 Capacitor 资源源图（供 @capacitor/assets 在 CI 派生各密度）：
 *   resources/icon.png        1024×1024 应用图标（由 public/icon-512.png 2× 放大）
 *   resources/splash.png      2732×2732 浅色启动屏，图标居中
 *   resources/splash-dark.png 2732×2732 深色启动屏
 * PNG 解码/面积加权缩放/编码与 make-ico.mjs 同一套零依赖实现。
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync, deflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const COLOR_TYPES = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
const CH_TO_TYPE = { 1: 0, 3: 2, 4: 6 }

function decodePng(buf) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (!buf.subarray(0, 8).equals(sig)) throw new Error('not a PNG')
  let p = 8
  let w = 0, h = 0, depth = 0, type = 0, interlace = 0
  const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const kind = buf.toString('ascii', p + 4, p + 8)
    const data = buf.subarray(p + 8, p + 8 + len)
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      depth = data[8]; type = data[9]; interlace = data[12]
    } else if (kind === 'IDAT') idat.push(data)
    else if (kind === 'IEND') break
    p += 12 + len
  }
  if (interlace !== 0) throw new Error('interlaced PNG unsupported')
  if (depth !== 8 || !(type in COLOR_TYPES)) throw new Error(`unsupported PNG depth=${depth} type=${type}`)
  const ch = COLOR_TYPES[type]
  const stride = w * ch
  const raw = inflateSync(Buffer.concat(idat))
  const out = Buffer.alloc(h * stride)
  let pos = 0
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++]
    const lineStart = y * stride
    const prevStart = lineStart - stride
    for (let x = 0; x < stride; x++) {
      const cur = raw[pos++]
      const a = x >= ch ? out[lineStart + x - ch] : 0
      const b = y > 0 ? out[prevStart + x] : 0
      const c = y > 0 && x >= ch ? out[prevStart + x - ch] : 0
      let v
      switch (filter) {
        case 0: v = cur; break
        case 1: v = cur + a; break
        case 2: v = cur + b; break
        case 3: v = cur + ((a + b) >> 1); break
        default: {
          const pp = a + b - c
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
          v = cur + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
        }
      }
      out[lineStart + x] = v & 0xff // PNG 规范：反滤波结果 mod 256（不能用饱和 clamp，高频图会毁图）
    }
  }
  return { w, h, ch, data: out }
}

function resize(src, tw, th) {
  const { w, h, ch, data } = src
  const dst = Buffer.alloc(tw * th * ch)
  for (let dy = 0; dy < th; dy++) {
    const sy0 = (dy * h) / th, sy1 = ((dy + 1) * h) / th
    for (let dx = 0; dx < tw; dx++) {
      const sx0 = (dx * w) / tw, sx1 = ((dx + 1) * w) / tw
      const acc = new Float64Array(ch)
      let area = 0
      const iy0 = Math.floor(sy0), iy1 = Math.min(h, Math.ceil(sy1))
      const ix0 = Math.floor(sx0), ix1 = Math.min(w, Math.ceil(sx1))
      for (let sy = iy0; sy < iy1; sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0)
        for (let sx = ix0; sx < ix1; sx++) {
          const wt = (Math.min(sx + 1, sx1) - Math.max(sx, sx0)) * wy
          const o = (sy * w + sx) * ch
          for (let k = 0; k < ch; k++) acc[k] += data[o + k] * wt
          area += wt
        }
      }
      const o = (dy * tw + dx) * ch
      for (let k = 0; k < ch; k++) dst[o + k] = Math.round(acc[k] / area)
    }
  }
  return { w: tw, h: th, ch, data: dst }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff]
  return (c ^ 0xffffffff) >>> 0
}
function chunk(kind, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const type = Buffer.from(kind, 'ascii')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, data])), 0)
  return Buffer.concat([len, type, data, crc])
}
function encodePng(img) {
  const { w, h, ch, data } = img
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = CH_TO_TYPE[ch]; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const stride = w * ch
  const raw = Buffer.alloc(h * (stride + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// 纯色底 + 居中贴片（alpha 合成），输出 RGB 图
function composeSplash(size, bg, fg) {
  const data = Buffer.alloc(size * size * 3)
  const [br, bgc, bb] = bg
  for (let i = 0; i < size * size; i++) {
    data[i * 3] = br; data[i * 3 + 1] = bgc; data[i * 3 + 2] = bb
  }
  const off = Math.round((size - fg.w) / 2)
  const fch = fg.ch
  for (let y = 0; y < fg.h; y++) {
    for (let x = 0; x < fg.w; x++) {
      const fo = (y * fg.w + x) * fch
      const di = ((off + y) * size + off + x) * 3
      const alpha = fch === 4 ? fg.data[fo + 3] / 255 : fch === 2 ? fg.data[fo + 1] / 255 : 1
      // 源可能是灰度（ch 1/2）或 RGB/RGBA
      const sr = fch >= 3 ? fg.data[fo] : fg.data[fo]
      const sg = fch >= 3 ? fg.data[fo + 1] : fg.data[fo]
      const sb = fch >= 3 ? fg.data[fo + 2] : fg.data[fo]
      data[di] = Math.round(sr * alpha + br * (1 - alpha))
      data[di + 1] = Math.round(sg * alpha + bgc * (1 - alpha))
      data[di + 2] = Math.round(sb * alpha + bb * (1 - alpha))
    }
  }
  return { w: size, h: size, ch: 3, data }
}

const src = decodePng(readFileSync(join(root, 'public', 'icon-512.png')))
if (src.w !== src.h) throw new Error('icon-512.png 必须是正方形')

const outDir = join(root, 'resources')
mkdirSync(outDir, { recursive: true })

// 图标：512 → 1024（整倍数面积加权，无锐度损失）
const icon1024 = resize(src, 1024, 1024)
const iconPath = join(outDir, 'icon.png')
writeFileSync(iconPath, encodePng(icon1024))

// 启动屏：2732 见方，图标取边长 880（约三分之一）居中
const fg = resize(src, 880, 880)
const light = composeSplash(2732, [0xf3, 0xf5, 0xfa], fg) // --bg: #f3f5fa
const dark = composeSplash(2732, [0x14, 0x16, 0x1d], fg) // --bg 暗色: #14161d
const splashPath = join(outDir, 'splash.png')
const splashDarkPath = join(outDir, 'splash-dark.png')
writeFileSync(splashPath, encodePng(light))
writeFileSync(splashDarkPath, encodePng(dark))

console.log(`wrote:\n  ${iconPath}\n  ${splashPath}\n  ${splashDarkPath}`)
