#!/usr/bin/env python3
"""Генерация иконок PWA (icons/icon-192.png, icons/icon-512.png).

Нужны растровые PNG, чтобы браузер вообще предлагал «установить приложение»:
одного SVG для installability недостаточно. Рисуем сканлайн-заливкой, без
Pillow и внешних зависимостей — PNG пишется через zlib вручную.

    python3 tools/make-icons.py
"""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "icons")

def _rgb(t):  # RGBA, непрозрачно — буфер везде 4-канальный
    return t + (255,)

BG      = _rgb((13, 17, 23))        # #0d1117
EDGE    = _rgb((42, 54, 68))        # #2a3644
WATER_D = _rgb((22, 80, 122))       # #16507a
WATER_L = _rgb((49, 201, 255))      # #31c9ff
DAM     = _rgb((127, 140, 153))     # #7f8c99
BOLT    = _rgb((255, 210, 63))      # #ffd23f


def wave(y0, amp, period, phase=0.0, x0=0.0, x1=1.0, n=64):
    pts = [(x0, y0)]
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        pts.append((x, y0 + amp * math.sin(2 * math.pi * x / period + phase)))
    pts.append((x1, y0))
    return pts


def bolt_poly():
    return [(0.60, 0.10), (0.30, 0.55), (0.47, 0.55),
            (0.40, 0.90), (0.74, 0.42), (0.55, 0.42)]


def dam_poly():
    return [(0.40, 0.34), (0.62, 0.34), (0.66, 0.78), (0.36, 0.78)]


def water_poly(base, amp, period, phase):
    top = wave(base, amp, period, phase)
    return top + [(1.0, 1.0), (0.0, 1.0)]


def inset(points, k, cx=0.5, cy=0.5):
    return [(cx + (x - cx) * k, cy + (y - cy) * k) for x, y in points]


def rounded_rect_pts(r=0.16, n=8):
    """Приближение скруглённого квадрата для сканлайн-заливки."""
    pts = []
    corners = [(1 - r, r, -90, 0), (1 - r, 1 - r, 0, 90),
               (r, 1 - r, 90, 180), (r, r, 180, 270)]
    for cx, cy, a0, a1 in corners:
        for i in range(n + 1):
            a = math.radians(a0 + (a1 - a0) * i / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def render_full(size, scale=2, inset_k=0.9):
    S = size * scale
    buf = [BG] * (S * S)

    def poly_px(poly):
        return [(x * S, y * S) for x, y in poly]

    def fill(poly, color):
        poly = poly_px(poly)
        ys = [p[1] for p in poly]
        y0 = max(0, int(min(ys)))
        y1 = min(S - 1, int(max(ys)))
        n = len(poly)
        for py in range(y0, y1 + 1):
            yc = py + 0.5
            xi = []
            for i in range(n):
                ax, ay = poly[i]
                bx, by = poly[(i + 1) % n]
                if (ay <= yc < by) or (by <= yc < ay):
                    xi.append(ax + (yc - ay) * (bx - ax) / (by - ay))
            xi.sort()
            for k in range(0, len(xi) - 1, 2):
                xa = max(0, int(xi[k]))
                xb = min(S - 1, int(xi[k + 1]))
                base = py * S
                for px in range(xa, xb + 1):
                    buf[base + px] = color

    def rounded(color, k):
        fill(inset(rounded_rect_pts(), k), color)

    rounded(EDGE, 1.0)
    rounded(BG, 0.965)
    fill(inset(water_poly(0.72, 0.035, 0.34, 0.0), inset_k), WATER_D)
    fill(inset(water_poly(0.80, 0.030, 0.34, math.pi), inset_k), WATER_L)
    fill(inset(dam_poly(), inset_k), DAM)
    fill(inset(bolt_poly(), inset_k), BOLT)

    if scale == 1:
        return [tuple(buf[i]) for i in range(S * S)], size
    out = []
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0
            for dy in range(scale):
                for dx in range(scale):
                    px = buf[((y * scale + dy) * S + x * scale + dx)]
                    r += px[0]; g += px[1]; b += px[2]; a += px[3]
            d = scale * scale
            out.append((r // d, g // d, b // d, a // d))
    return out, size


def write_png(path, pixels, size):
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter: none
        for x in range(size):
            r, g, b, a = pixels[y * size + x]
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print(f"{os.path.relpath(path, ROOT)}: {size}×{size}, {len(png)} байт")


def main():
    os.makedirs(OUT, exist_ok=True)
    for size, inset_k in ((192, 0.92), (512, 0.70)):   # 512 — с запасом под maskable crop
        px, n = render_full(size, scale=2, inset_k=inset_k)
        write_png(os.path.join(OUT, f"icon-{size}.png"), px, n)


if __name__ == "__main__":
    main()
