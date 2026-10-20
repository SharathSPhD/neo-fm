#!/usr/bin/env python3
"""Regenerates the iOS launch (splash) images in public/splash from public/icon-512.png.

Run from apps/web: python3 scripts/gen-splash.py. The size table must match SPLASH in lib/pwa/splash.ts.
"""
from PIL import Image, ImageDraw

BG = (10, 6, 18)
# (css width, css height, pixel ratio)
SIZES = [
    (440, 956, 3), (402, 874, 3), (430, 932, 3), (393, 852, 3), (428, 926, 3), (390, 844, 3),
    (375, 812, 3), (414, 896, 3), (414, 896, 2), (414, 736, 3), (375, 667, 2), (320, 568, 2),
    (1024, 1366, 2), (834, 1194, 2), (820, 1180, 2), (810, 1080, 2), (744, 1133, 2),
]

icon = Image.open("public/icon-512.png").convert("RGBA")
for w, h, r in SIZES:
    pw, ph = w * r, h * r
    side = round(min(pw, ph) * 0.26)
    art = icon.resize((side, side), Image.LANCZOS)
    mask = Image.new("L", (side, side), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, side - 1, side - 1), radius=round(side * 0.2237), fill=255)
    canvas = Image.new("RGB", (pw, ph), BG)
    canvas.paste(art, ((pw - side) // 2, (ph - side) // 2), mask)
    canvas.save(f"public/splash/{pw}x{ph}.png", optimize=True)
