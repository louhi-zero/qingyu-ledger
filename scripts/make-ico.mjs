/* 把 public/icon-512.png 缩放为多帧并打成 Windows ICO（PNG 内嵌，Vista+ 支持）
 * 输出到 build/icon.ico，供 electron-builder NSIS 使用（要求至少含 256x256）。
 * 纯 Node（zlib）手写 PNG 解码 / 面积加权缩放 / PNG 编码，零第三方依赖，跨平台。
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync, deflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const COLOR_TYPES = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } // 灰度/调色板/灰度Alpha/RGB/RGBA -> 每像素字节(仅8位)
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
      out[lineStart + x] = v < 0 ? 0 : v > 255 ? 255 : v
    }
  }
  return { w, h, ch, data: out }
}

/* 面积加权降采样（box），目标尺寸大于源时最近邻放大 */
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
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
    raw[y * (stride + 1)] = 0 // filter: None（缩放后像素规整，体积差异很小）
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const src = decodePng(readFileSync(join(root, 'public', 'icon-512.png')))
if (src.w !== src.h) throw new Error('icon-512.png 必须是正方形')
const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = sizes.map((size) => ({ size, png: encodePng(resize(src, size, size)) }))

const headerSize = 6, entrySize = 16
let cursor = headerSize + entrySize * images.length
const entries = images.map((img) => {
  const h = Buffer.alloc(entrySize)
  h.writeUInt8(img.size >= 256 ? 0 : img.size, 0)
  h.writeUInt8(img.size >= 256 ? 0 : img.size, 1)
  h.writeUInt8(0, 2); h.writeUInt8(0, 3)
  h.writeUInt16LE(1, 4)
  h.writeUInt16LE(32, 6)
  h.writeUInt32LE(img.png.length, 8)
  h.writeUInt32LE(cursor, 12)
  cursor += img.png.length
  return { header: h, png: img.png }
})

const header = Buffer.alloc(headerSize)
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4)

// ICO 布局：文件头 + 全部目录项 + 全部图像数据（目录项偏移即按此布局计算）
const out = Buffer.concat([header, ...entries.map((e) => e.header), ...entries.map((e) => e.png)])
const outPath = join(root, 'build', 'icon.ico')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, out)
console.log(`wrote ${outPath} (${out.length} bytes, ${images.length} sizes: ${sizes.join('/')})`)
