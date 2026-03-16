#!/usr/bin/env python3
"""Generate AgentCompany app icons (PNG, ICO, ICNS, SVG).

Design v3b: Bold "A" monogram that doubles as an org-chart hierarchy.
Two terracotta legs meet at an apex, with three warm crossbars of
decreasing brightness (CEO → Managers → ICs).  All tones stay warm.
"""

from __future__ import annotations

import math
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ICONSET = ASSETS / "icon.iconset"
PNG_PATH = ASSETS / "icon.png"
ICO_PATH = ASSETS / "icon.ico"
ICNS_PATH = ASSETS / "icon.icns"
SVG_PATH = ASSETS / "icon.svg"
SIZE = 1024

# ── Brand palette ──────────────────────────────────────────────────────
TERRACOTTA = (217, 119, 69)        # #d97745
SLATE_TOP = (17, 19, 21)           # #111315
SLATE_BOT = (27, 31, 35)           # #1b1f23

# Bar colours — all warm, decreasing brightness
BAR_CEO = (255, 235, 215)          # warm cream — brightest
BAR_MGR = (235, 180, 140)          # warm peach
BAR_IC  = (190, 140, 105)          # muted terracotta


def rgba(r: int, g: int, b: int, a: int = 255) -> tuple[int, int, int, int]:
    return (r, g, b, a)


def blend(
    a: tuple[int, ...], b: tuple[int, ...], t: float,
) -> tuple[int, ...]:
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def build_icon() -> Image.Image:
    # ── 1. Gradient background with warm glow ──────────────────────────
    bg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    px = bg.load()
    top_c = rgba(*SLATE_TOP)
    bot_c = rgba(*SLATE_BOT)
    glow_cx, glow_cy = SIZE * 0.44, SIZE * 0.34
    glow_r = SIZE * 0.78

    for y in range(SIZE):
        t = y / (SIZE - 1)
        base = blend(top_c, bot_c, t)
        for x in range(SIZE):
            d = math.hypot(x - glow_cx, y - glow_cy) / glow_r
            warmth = max(0.0, 1.0 - d) ** 1.8 * 0.13
            px[x, y] = blend(base, rgba(*TERRACOTTA), warmth)

    # ── 2. Rounded-rect mask + shadow ──────────────────────────────────
    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    mask = Image.new("L", (SIZE, SIZE), 0)
    inset = 64
    ImageDraw.Draw(mask).rounded_rectangle(
        (inset, inset, SIZE - inset, SIZE - inset), radius=224, fill=255,
    )
    shadow_alpha = mask.filter(ImageFilter.GaussianBlur(28))
    shadow_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 48))
    shadow_layer.putalpha(shadow_alpha)
    icon.alpha_composite(shadow_layer, (0, 12))
    icon.alpha_composite(bg)
    icon.putalpha(mask)

    # ── 3. Draw the "A" mark ───────────────────────────────────────────
    overlay = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    cx = SIZE // 2
    apex_y = 200
    base_y = 800
    leg_w = 64
    base_half = 250

    def leg_x(y: int) -> tuple[float, float]:
        t = (y - apex_y) / (base_y - apex_y)
        spread = base_half * t
        return (cx - spread, cx + spread)

    ll_top, _ = leg_x(apex_y)
    ll_bot, _ = leg_x(base_y)
    _, lr_top = leg_x(apex_y)
    _, lr_bot = leg_x(base_y)

    left_leg = [
        (ll_top - leg_w * 0.35, apex_y),
        (ll_top + leg_w * 0.35, apex_y),
        (ll_bot + leg_w, base_y),
        (ll_bot - leg_w, base_y),
    ]
    right_leg = [
        (lr_top - leg_w * 0.35, apex_y),
        (lr_top + leg_w * 0.35, apex_y),
        (lr_bot + leg_w, base_y),
        (lr_bot - leg_w, base_y),
    ]

    draw.polygon(left_leg, fill=rgba(*TERRACOTTA, 240))
    draw.polygon(right_leg, fill=rgba(*TERRACOTTA, 240))

    # ── 4. Three crossbars — warm tones, hierarchy brightness ──────────
    bar_h = 42
    bar_r = 12
    bar_pad = 14

    tiers = [
        (440, rgba(*BAR_CEO)),
        (545, rgba(*BAR_MGR)),
        (650, rgba(*BAR_IC)),
    ]

    for bar_cy, fill in tiers:
        left_cx, right_cx = leg_x(bar_cy)
        bx0 = int(left_cx + bar_pad)
        bx1 = int(right_cx - bar_pad)
        draw.rounded_rectangle(
            (bx0, bar_cy - bar_h // 2, bx1, bar_cy + bar_h // 2),
            radius=bar_r,
            fill=fill,
        )

    # ── 5. Apex beacon ─────────────────────────────────────────────────
    dot_r = 20
    dot_cy = apex_y - 2
    draw.ellipse(
        (cx - dot_r, dot_cy - dot_r, cx + dot_r, dot_cy + dot_r),
        fill=rgba(*BAR_CEO),
    )

    icon.alpha_composite(overlay)
    return icon


def save_svg() -> None:
    svg = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="none">
  <defs>
    <linearGradient id="bg" x1="200" x2="824" y1="96" y2="928" gradientUnits="userSpaceOnUse">
      <stop stop-color="#111315"/>
      <stop offset="1" stop-color="#1b1f23"/>
    </linearGradient>
    <radialGradient id="glow" cx="0" cy="0" r="1"
      gradientTransform="translate(450 348) rotate(36) scale(800)" gradientUnits="userSpaceOnUse">
      <stop stop-color="#d97745" stop-opacity=".13"/>
      <stop offset="1" stop-color="#d97745" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="896" height="896" x="64" y="64" rx="224" fill="url(#bg)"/>
  <rect width="896" height="896" x="64" y="64" rx="224" fill="url(#glow)"/>
  <polygon points="490,200 534,200 578,800 298,800" fill="#d97745" fill-opacity=".94"/>
  <polygon points="490,200 534,200 726,800 446,800" fill="#d97745" fill-opacity=".94"/>
  <rect x="400" y="419" width="224" height="42" rx="12" fill="#ffebd7"/>
  <rect x="374" y="524" width="276" height="42" rx="12" fill="#ebb48c"/>
  <rect x="348" y="629" width="328" height="42" rx="12" fill="#be8c69"/>
  <circle cx="512" cy="198" r="20" fill="#ffebd7"/>
</svg>
"""
    SVG_PATH.write_text(svg, encoding="utf-8")


def save_png_and_ico(image: Image.Image) -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    image.save(PNG_PATH, format="PNG")
    image.save(
        ICO_PATH,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


def save_icns(image: Image.Image) -> None:
    if ICONSET.exists():
        shutil.rmtree(ICONSET)
    ICONSET.mkdir(parents=True, exist_ok=True)

    for size in (16, 32, 64, 128, 256, 512):
        image.resize((size, size), Image.Resampling.LANCZOS).save(
            ICONSET / f"icon_{size}x{size}.png", format="PNG",
        )
        image.resize((size * 2, size * 2), Image.Resampling.LANCZOS).save(
            ICONSET / f"icon_{size}x{size}@2x.png", format="PNG",
        )

    subprocess.run(
        ["iconutil", "-c", "icns", str(ICONSET), "-o", str(ICNS_PATH)],
        check=True,
    )
    shutil.rmtree(ICONSET)


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    save_svg()
    image = build_icon()
    save_png_and_ico(image)
    save_icns(image)
    print(f"Generated: {PNG_PATH}, {ICO_PATH}, {ICNS_PATH}, {SVG_PATH}")


if __name__ == "__main__":
    main()
