# 少女线稿风分类图标切片：design/girl-src.jpg → public/girl/<key>.png
# 网格用墨迹投影自动检测（4 行，行内按空白分列），断言 8/6/6/8 布局；
# 每格底部的中文标签通过"末段矮且与主体有间隙"规则剔除。
# 白底转透明：alpha = 255 - 灰度，RGB 置黑（白底合成后与原图逐像素一致）。
# 输出 256×256 透明 PNG，主体等比缩放居中留 6% 边距。
# 另出 design/girl-contact-sheet.png 拼图供人工核验。
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'design' / 'girl-src.jpg'
OUT = ROOT / 'public' / 'girl'
SHEET = ROOT / 'design' / 'girl-contact-sheet.png'
INK = 170          # 灰度低于此视为墨迹
GAP = 10           # 行/列分割最小空白
LABEL_MAX_H = 60   # 低于此高度且位于底部的段视为文字标签
LABEL_BAND_H = 40  # 整幅行投影中，标签行 band 的高度上限
CANVAS = 256
MARGIN = 0.06

KEYS = [
    ['food', 'transport', 'shop', 'home', 'medical', 'edu', 'phone', 'travel'],
    ['clothes', 'game', 'pet', 'gift', 'sport', 'box'],
    ['salary', 'bonus', 'invest', 'interest', 'reimburse', 'transfer'],
    ['bill', 'stats', 'budget', 'account', 'calendar', 'search', 'settings', 'backup'],
]
EXPECT_ROWS = [len(r) for r in KEYS]


def bands(profile, gap):
    """profile: 非负计数序列 → 连续非零段 [(start, end_exclusive)]，容许 <gap 的空洞"""
    out, s, hole = [], None, 0
    for i, v in enumerate(profile):
        if v > 0:
            if s is None:
                s = i
            hole = 0
        elif s is not None:
            hole += 1
            if hole >= gap:
                out.append((s, i - hole + 1))
                s = None
    if s is not None:
        out.append((s, len(profile)))
    return out


def main():
    im = Image.open(SRC).convert('L')
    w, h = im.size
    px = im.load()
    ink = [[1 if px[x, y] < INK else 0 for x in range(w)] for y in range(h)]

    row_prof = [sum(r) for r in ink]
    raw = bands(row_prof, GAP)
    # 主图行下方的中文标签会检成独立窄 band（高 ≤ 40），并回主图行做列检测；
    # 末行标签在源图中被裁掉，故 band 交替 主图/标签/…/主图
    rows = []
    for b in raw:
        if rows and (b[1] - b[0]) <= LABEL_BAND_H:
            rows[-1] = (rows[-1][0], b[1])
        else:
            rows.append(b)
    print(f'size={w}x{h} bands={raw}')
    print(f'rows={[ (a, b - a) for a, b in rows ]}')
    assert len(rows) == len(EXPECT_ROWS), f'行数 {len(rows)} != {len(EXPECT_ROWS)}'

    out_dir = OUT
    out_dir.mkdir(parents=True, exist_ok=True)
    crops = []
    for ri, (y0, y1) in enumerate(rows):
        col_prof = [sum(ink[y][x] for y in range(y0, y1)) for x in range(w)]
        cols = bands(col_prof, GAP)
        assert len(cols) == EXPECT_ROWS[ri], \
            f'第 {ri + 1} 行列数 {len(cols)} != {EXPECT_ROWS[ri]}: {cols}'
        for ci, (x0, x1) in enumerate(cols):
            cell = [(x, y) for y in range(y0, y1) for x in range(x0, x1) if ink[y][x]]
            ys = sorted({y for _, y in cell})
            segs, s, prev = [], ys[0], ys[0]
            for y in ys[1:]:
                if y - prev > 3:
                    segs.append((s, prev + 1))
                    s = y
                prev = y
            segs.append((s, prev + 1))
            while len(segs) > 1 and (segs[-1][1] - segs[-1][0]) <= LABEL_MAX_H:
                segs.pop()  # 自底向上剔除标签与散落装饰
            ay0, ay1 = segs[0][0], segs[-1][1]
            ax0 = min(x for x, y in cell if ay0 <= y < ay1)
            ax1 = max(x for x, y in cell if ay0 <= y < ay1) + 1
            key = KEYS[ri][ci]
            crops.append((key, im.crop((ax0, ay0, ax1, ay1))))
            print(f'{key:10s} cell=({x0},{y0},{x1},{y1}) art=({ax0},{ay0},{ax1},{ay1}) '
                  f'{ax1 - ax0}x{ay1 - ay0} segs={len(segs)}')

    for key, art in crops:
        aw, ah = art.size
        scale = min((1 - 2 * MARGIN) * CANVAS / aw, (1 - 2 * MARGIN) * CANVAS / ah)
        nw, nh = max(1, round(aw * scale)), max(1, round(ah * scale))
        g = art.resize((nw, nh), Image.LANCZOS)
        canvas = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
        alpha = g.point(lambda v: 255 - v)
        black = Image.new('RGBA', (nw, nh), (0, 0, 0, 255))
        black.putalpha(alpha)
        canvas.paste(black, ((CANVAS - nw) // 2, (CANVAS - nh) // 2), black)
        canvas.save(out_dir / f'{key}.png', optimize=True)

    # 拼图核验：浅灰底 + 网格线，放大到 128 显示
    cols_n = 8
    tile, pad = 128, 6
    sheet = Image.new('RGB', (cols_n * (tile + pad) + pad, 4 * (tile + pad) + pad), (235, 235, 238))
    for i, (key, _) in enumerate(crops):
        t = Image.open(out_dir / f'{key}.png').resize((tile, tile), Image.LANCZOS)
        xx, yy = pad + (i % cols_n) * (tile + pad), pad + (i // cols_n) * (tile + pad)
        sheet.paste(t, (xx, yy), t)
    sheet.save(SHEET)
    print(f'OK {len(crops)} icons -> {out_dir}，拼图 -> {SHEET}')


if __name__ == '__main__':
    main()
