#!/usr/bin/env python3
"""Generate AgentCompany app icons (PNG, ICO, ICNS) and tray icons.

Design v4: Circle background #191919 with #FBFAF5 "A" logo.
Uses the actual logo paths from logo.svg rendered via cairosvg/Pillow.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ICONSET = ASSETS / "icon.iconset"
PNG_PATH = ASSETS / "icon.png"
ICO_PATH = ASSETS / "icon.ico"
ICNS_PATH = ASSETS / "icon.icns"
SVG_PATH = ASSETS / "icon.svg"
SIZE = 1024

# ── Brand palette ──────────────────────────────────────────────────────
BG_COLOR = (25, 25, 25)           # #191919
LOGO_COLOR = (251, 250, 245)      # #FBFAF5


def build_icon() -> Image.Image:
    """Build the app icon by rendering icon.svg via cairosvg, or fallback to Pillow."""
    # Try cairosvg first (best quality)
    try:
        import cairosvg
        svg_data = SVG_PATH.read_bytes()
        png_data = cairosvg.svg2png(bytestring=svg_data, output_width=SIZE, output_height=SIZE)
        import io
        return Image.open(io.BytesIO(png_data)).convert("RGBA")
    except Exception:
        pass

    # Fallback: draw programmatically with Pillow
    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(icon)

    # Circle background
    margin = SIZE // 2 - 480
    draw.ellipse(
        (margin, margin, SIZE - margin, SIZE - margin),
        fill=(*BG_COLOR, 255),
    )

    # Draw the "A" monogram — same geometry as the old icon but in new color
    cx = SIZE // 2
    apex_y = 200
    base_y = 800
    leg_w = 64
    base_half = 250
    fill = (*LOGO_COLOR, 245)

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

    draw.polygon(left_leg, fill=fill)
    draw.polygon(right_leg, fill=fill)

    # Crossbars — all same cream color with varying opacity for hierarchy
    bar_h = 42
    bar_r = 12
    bar_pad = 14

    tiers = [
        (440, (*LOGO_COLOR, 255)),
        (545, (*LOGO_COLOR, 210)),
        (650, (*LOGO_COLOR, 175)),
    ]

    for bar_cy, bar_fill in tiers:
        left_cx, right_cx = leg_x(bar_cy)
        bx0 = int(left_cx + bar_pad)
        bx1 = int(right_cx - bar_pad)
        draw.rounded_rectangle(
            (bx0, bar_cy - bar_h // 2, bx1, bar_cy + bar_h // 2),
            radius=bar_r,
            fill=bar_fill,
        )

    # Apex beacon
    dot_r = 20
    dot_cy = apex_y - 2
    draw.ellipse(
        (cx - dot_r, dot_cy - dot_r, cx + dot_r, dot_cy + dot_r),
        fill=(*LOGO_COLOR, 255),
    )

    return icon


def build_tray_icons() -> None:
    """Generate tray/notification area icons for all platforms."""
    # Color tray icon (Windows/Linux) — 32x32 and 64x64
    for name, size in [("tray-icon.png", 32), ("tray-icon@2x.png", 64)]:
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        margin = 1
        draw.ellipse((margin, margin, size - margin, size - margin), fill=(*BG_COLOR, 255))

        # Simple A shape scaled to tray size
        cx = size // 2
        top_y = int(size * 0.18)
        bot_y = int(size * 0.82)
        spread = int(size * 0.28)
        w = max(2, int(size * 0.06))

        draw.polygon([
            (cx - w, top_y), (cx + w, top_y),
            (cx + spread + w, bot_y), (cx + spread - w, bot_y),
        ], fill=(*LOGO_COLOR, 240))
        draw.polygon([
            (cx - w, top_y), (cx + w, top_y),
            (cx - spread + w, bot_y), (cx - spread - w, bot_y),
        ], fill=(*LOGO_COLOR, 240))

        # Crossbar
        bar_y = int(size * 0.52)
        bar_h = max(2, int(size * 0.06))
        bar_left = cx - int(spread * 0.55)
        bar_right = cx + int(spread * 0.55)
        draw.rectangle((bar_left, bar_y, bar_right, bar_y + bar_h), fill=(*LOGO_COLOR, 255))

        img.save(ASSETS / name, format="PNG")

    # macOS template icons (monochrome black + alpha)
    for name, size in [("tray-iconTemplate.png", 22), ("tray-iconTemplate@2x.png", 44)]:
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        cx = size // 2
        top_y = int(size * 0.15)
        bot_y = int(size * 0.85)
        spread = int(size * 0.3)
        w = max(1, int(size * 0.06))

        draw.polygon([
            (cx - w, top_y), (cx + w, top_y),
            (cx + spread + w, bot_y), (cx + spread - w, bot_y),
        ], fill=(0, 0, 0, 220))
        draw.polygon([
            (cx - w, top_y), (cx + w, top_y),
            (cx - spread + w, bot_y), (cx - spread - w, bot_y),
        ], fill=(0, 0, 0, 220))

        bar_y = int(size * 0.52)
        bar_h = max(1, int(size * 0.06))
        bar_left = cx - int(spread * 0.55)
        bar_right = cx + int(spread * 0.55)
        draw.rectangle((bar_left, bar_y, bar_right, bar_y + bar_h), fill=(0, 0, 0, 240))

        img.save(ASSETS / name, format="PNG")


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
    image = build_icon()
    save_png_and_ico(image)
    save_icns(image)
    build_tray_icons()
    print(f"Generated: {PNG_PATH}, {ICO_PATH}, {ICNS_PATH}")
    print(f"Generated tray icons in {ASSETS}")


if __name__ == "__main__":
    main()
