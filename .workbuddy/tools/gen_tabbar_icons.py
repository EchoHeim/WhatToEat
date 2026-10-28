# -*- coding: utf-8 -*-
"""
Generate WeChat mini-program tabBar icons (81x81 RGBA PNG).

No third-party deps: shapes are described as signed-distance-to-centerline
functions, coverage is computed analytically (1px wide AA ramp), and the PNG
is encoded with zlib + struct.
"""
import math
import os
import struct
import zlib

OUT_DIR = r"D:\Personal\WhatToEat\images\tabbar"
PREVIEW = r"D:\Personal\WhatToEat\.workbuddy\tmp\tabbar_preview.png"

SIZE = 81          # output px per icon
VB = 100.0         # design viewbox units
STROKE = 7.2       # stroke width, viewbox units
PX = VB / SIZE     # one output pixel expressed in viewbox units
HW = STROKE / 2.0

INACTIVE = (139, 139, 134)   # #8B8B86  (app.json tabBar color)
ACTIVE = (232, 93, 63)       # #E85D3F  (app.json selectedColor)

# --------------------------------------------------------------------------
# distance primitives (all return distance from point to shape centerline)
# --------------------------------------------------------------------------


def seg(ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    l2 = vx * vx + vy * vy

    def d(px, py):
        wx, wy = px - ax, py - ay
        t = 0.0 if l2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / l2))
        return math.hypot(wx - t * vx, wy - t * vy)

    return d


def ring(cx, cy, r):
    def d(px, py):
        return abs(math.hypot(px - cx, py - cy) - r)

    return d


def arc(cx, cy, r, a0, a1):
    """Arc from a0 to a1 degrees, clockwise on screen (y axis points down)."""
    span = (a1 - a0) % 360.0 or 360.0
    p0 = (cx + r * math.cos(math.radians(a0)), cy + r * math.sin(math.radians(a0)))
    p1 = (cx + r * math.cos(math.radians(a1)), cy + r * math.sin(math.radians(a1)))
    e0 = seg(p0[0], p0[1], p0[0], p0[1])
    e1 = seg(p1[0], p1[1], p1[0], p1[1])

    def d(px, py):
        ang = math.degrees(math.atan2(py - cy, px - cx))
        t = (ang - a0) % 360.0
        if t <= span:
            return abs(math.hypot(px - cx, py - cy) - r)
        return min(e0(px, py), e1(px, py))

    return d


def rrect(cx, cy, hw, hh, r):
    """Outline of a rounded rectangle -> distance to its boundary centreline."""

    def d(px, py):
        qx = abs(px - cx) - (hw - r)
        qy = abs(py - cy) - (hh - r)
        sdf = math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r
        return abs(sdf)

    return d


def polyline(*pts):
    parts = [seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) for i in range(len(pts) - 1)]

    def d(px, py):
        return min(p(px, py) for p in parts)

    return d


# --------------------------------------------------------------------------
# icon definitions (100 x 100 viewbox)
# --------------------------------------------------------------------------

ICONS = {
    # 首页 —— 房子
    "home": [
        polyline((12, 47), (50, 13), (88, 47)),          # 屋顶
        polyline((22, 41), (22, 86), (78, 86), (78, 41)),  # 墙体
        polyline((40, 86), (40, 63), (60, 63), (60, 86)),  # 门
    ],
    # 菜谱 —— 饭碗 + 筷子
    "dishes": [
        arc(47, 58, 36, 0, 180),                          # 碗身
        seg(6, 58, 88, 58),                               # 碗口
        seg(48, 62, 76, 10),                              # 筷子 1
        seg(60, 68, 88, 16),                              # 筷子 2
    ],
    # 记录 —— 记录本
    "records": [
        rrect(50, 52, 28, 36, 10),                        # 本子外框
        seg(36, 38, 64, 38),
        seg(36, 53, 64, 53),
        seg(36, 68, 52, 68),
    ],
    # 我的 —— 人像
    "mine": [
        ring(50, 30, 16.5),                               # 头
        arc(50, 90, 32, 180, 360),                        # 肩
    ],
}


# --------------------------------------------------------------------------
# rasterizer
# --------------------------------------------------------------------------


def render(shapes, color):
    r, g, b = color
    rows = []
    for j in range(SIZE):
        py = (j + 0.5) * PX
        row = bytearray()
        for i in range(SIZE):
            px = (i + 0.5) * PX
            d = min(s(px, py) for s in shapes)
            cov = (HW - d) / PX + 0.5
            cov = 0.0 if cov < 0.0 else (1.0 if cov > 1.0 else cov)
            a = int(round(cov * 255))
            row += bytes((r, g, b, a))
        rows.append(bytes(row))
    return rows


def encode_png(path, width, height, rows):
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    blob = b"\x89PNG\r\n\x1a\n"
    blob += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    blob += chunk(b"IDAT", zlib.compress(raw, 9))
    blob += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(blob)
    return len(blob)


def composite(dst, ox, oy, rows, bg):
    """Alpha-composite an RGBA patch onto an opaque RGB canvas."""
    for j, row in enumerate(rows):
        for i in range(SIZE):
            r, g, b, a = row[i * 4:i * 4 + 4]
            if a == 0:
                continue
            t = a / 255.0
            y, x = oy + j, ox + i
            idx = (y * len(dst[0]) + x) * 3
            dst[y][x] = (
                int(round(r * t + bg[0] * (1 - t))),
                int(round(g * t + bg[1] * (1 - t))),
                int(round(b * t + bg[2] * (1 - t))),
            )


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    log = []
    rendered = {}

    for name, shapes in ICONS.items():
        for suffix, color in (("", INACTIVE), ("-active", ACTIVE)):
            rows = render(shapes, color)
            fn = name + suffix + ".png"
            size = encode_png(os.path.join(OUT_DIR, fn), SIZE, SIZE, rows)
            rendered[(name, suffix)] = rows
            log.append("%-24s %6d bytes" % (fn, size))

    # preview sheet: row 1 = inactive, row 2 = active, order = tab order
    pad, gap = 20, 16
    order = ["home", "dishes", "records", "mine"]
    w = pad * 2 + len(order) * SIZE + (len(order) - 1) * gap
    h = pad * 2 + 2 * SIZE + gap
    bg = (255, 253, 248)
    canvas = [[bg for _ in range(w)] for _ in range(h)]
    for idx, name in enumerate(order):
        ox = pad + idx * (SIZE + gap)
        composite(canvas, ox, pad, rendered[(name, "")], bg)
        composite(canvas, ox, pad + SIZE + gap, rendered[(name, "-active")], bg)

    rows = []
    for y in range(h):
        row = bytearray()
        for x in range(w):
            c = canvas[y][x]
            row += bytes((c[0], c[1], c[2], 255))
        rows.append(bytes(row))
    encode_png(PREVIEW, w, h, rows)

    log.append("")
    log.append("output dir: " + OUT_DIR)
    log.append("preview   : " + PREVIEW + "  (%dx%d)" % (w, h))
    with open(r"D:\Personal\WhatToEat\.workbuddy\tmp\gen_log.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(log))


main()
