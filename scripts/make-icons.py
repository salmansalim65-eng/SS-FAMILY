#!/usr/bin/env python3
"""Draw the PWA icons — a white house on the app's own green.

No dependencies on purpose: this needs to run anywhere, and the icons are
simple enough that a few lines of geometry beat pulling in an image library.
Run from the repo root:  python3 scripts/make-icons.py
"""
import struct
import zlib

BG = (15, 104, 73)      # palm-600, the green used throughout the app
FG = (255, 255, 255)


def render(size, ss=3):
    """Draw at size*ss, then box-filter down so the curves are not jagged."""
    n = size * ss
    N = float(n)
    rad = 0.22 * N
    apex, left, right = (0.50 * N, 0.24 * N), (0.16 * N, 0.52 * N), (0.84 * N, 0.52 * N)
    body = (0.26 * N, 0.50 * N, 0.74 * N, 0.80 * N)
    door = (0.43 * N, 0.61 * N, 0.57 * N, 0.80 * N)

    def in_round_rect(x, y):
        if rad <= x <= N - rad or rad <= y <= N - rad:
            return 0 <= x <= N and 0 <= y <= N
        cx = rad if x < rad else N - rad
        cy = rad if y < rad else N - rad
        return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad

    def in_triangle(x, y, a, b, c):
        def side(p, q):
            return (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0])
        d = (side(a, b), side(b, c), side(c, a))
        return not (any(v < 0 for v in d) and any(v > 0 for v in d))

    def in_rect(x, y, r):
        return r[0] <= x <= r[2] and r[1] <= y <= r[3]

    acc = [[[0, 0, 0, 0] for _ in range(size)] for _ in range(size)]
    for py in range(n):
        y = py + 0.5
        row = acc[py // ss]
        for px in range(n):
            x = px + 0.5
            if not in_round_rect(x, y):
                continue
            white = in_triangle(x, y, apex, left, right) or in_rect(x, y, body)
            if white and in_rect(x, y, door):
                white = False
            r, g, b = FG if white else BG
            cell = row[px // ss]
            cell[0] += r
            cell[1] += g
            cell[2] += b
            cell[3] += 255

    samples = ss * ss
    raw = bytearray()
    for row in acc:
        raw.append(0)                       # PNG filter type: none
        for r, g, b, a in row:
            if a == 0:
                raw += bytes(4)             # fully transparent corner
            else:
                covered = a / 255.0
                raw += bytes((round(r / covered), round(g / covered),
                              round(b / covered), round(a / samples)))
    return bytes(raw)


def png(size, raw):
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)   # 8-bit RGBA
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


if __name__ == '__main__':
    for s in (192, 512):
        with open(f'public/icon-{s}.png', 'wb') as fh:
            fh.write(png(s, render(s)))
        print(f'public/icon-{s}.png')
