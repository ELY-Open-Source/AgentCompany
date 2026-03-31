#!/usr/bin/env python3
"""Generate icon assets for web UI/UX (favicons + PWA icons) and optional UE packaging.

This script is designed to be simple, predictable, and cross-platform.

Inputs:
  - A single source image: preferably a square 1024x1024 PNG.
  - SVG is accepted only if optional rasterizers are installed.

Outputs (by default):
  - Web/PWA: favicon.ico (multi-size), apple-touch-icon.png, icon-192.png, icon-512.png,
             icon-maskable-512.png (padded + background).
  - UE (optional): Windows icon.ico (multi-size), macOS .iconset folder, Linux PNGs.

Dependencies:
  - Pillow (required): pip install pillow

Usage:
  python scripts/generate_icons.py --input icon.png --out ./dist --targets web
  python scripts/generate_icons.py --input icon.png --out ./dist --targets web,ue

Notes:
  - For SVG input: export to a 1024x1024 PNG first (recommended) unless you install CairoSVG.
"""

from __future__ import annotations

import argparse
import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional


try:
    from PIL import Image
except ImportError as e:  # pragma: no cover
    raise SystemExit(
        "Pillow is required. Install it with: pip install pillow"
    ) from e


@dataclass(frozen=True)
class Options:
    input_path: Path
    out_dir: Path
    targets: set[str]
    pad_to_square: bool
    background: str
    maskable_scale: float
    resample: int


def _parse_hex_color(value: str) -> tuple[int, int, int, int]:
    v = value.strip().lstrip("#")
    if len(v) == 6:
        r = int(v[0:2], 16)
        g = int(v[2:4], 16)
        b = int(v[4:6], 16)
        return (r, g, b, 255)
    if len(v) == 8:
        r = int(v[0:2], 16)
        g = int(v[2:4], 16)
        b = int(v[4:6], 16)
        a = int(v[6:8], 16)
        return (r, g, b, a)
    raise ValueError(f"Invalid color '{value}'. Use #RRGGBB or #RRGGBBAA")


def _is_svg(path: Path) -> bool:
    return path.suffix.lower() == ".svg"


def _load_image(path: Path) -> Image.Image:
    if _is_svg(path):
        # Best-effort: try cairosvg if installed, else fail with actionable guidance.
        try:
            import cairosvg  # type: ignore

            png_bytes = cairosvg.svg2png(url=str(path))
            from io import BytesIO

            return Image.open(BytesIO(png_bytes)).convert("RGBA")
        except ImportError as e:
            raise SystemExit(
                "SVG input requires CairoSVG (pip install cairosvg) or export SVG to a 1024x1024 PNG first."
            ) from e
    return Image.open(path).convert("RGBA")


def _ensure_square(img: Image.Image, pad_to_square: bool, background_rgba: tuple[int, int, int, int]) -> Image.Image:
    w, h = img.size
    if w == h:
        return img
    if not pad_to_square:
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        return img.crop((left, top, left + side, top + side))
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), background_rgba)
    x = (side - w) // 2
    y = (side - h) // 2
    canvas.alpha_composite(img, (x, y))
    return canvas


def _resize(img: Image.Image, size: int, resample: int) -> Image.Image:
    if img.size == (size, size):
        return img
    return img.resize((size, size), resample=resample)


def _fit_with_padding(img: Image.Image, size: int, content_scale: float, background_rgba: tuple[int, int, int, int], resample: int) -> Image.Image:
    """Create a square icon with padding.

    For maskable icons, we want important content inside a safe zone.
    A pragmatic default is to fit the original artwork inside a centered square
    with side length = size * content_scale.
    """

    content_scale = max(0.1, min(content_scale, 1.0))
    inner = int(round(size * content_scale))
    inner = max(1, min(inner, size))
    inner_img = _resize(img, inner, resample)
    canvas = Image.new("RGBA", (size, size), background_rgba)
    x = (size - inner) // 2
    y = (size - inner) // 2
    canvas.alpha_composite(inner_img, (x, y))
    return canvas


def _write_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="PNG", optimize=True)


def _write_ico(source_square: Image.Image, path: Path, sizes: Iterable[int], resample: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    icon_sizes = [(s, s) for s in sizes]

    # Pillow expects the base image to be at least as large as the biggest size.
    max_size = max(sizes)
    base = _resize(source_square, max_size, resample)
    base.save(path, format="ICO", sizes=icon_sizes)


def generate_web(opts: Options, src_square: Image.Image) -> None:
    # Minimal, modern set (good coverage without going crazy):
    # - favicon.ico (16/32/48)
    # - apple-touch-icon.png (180)
    # - icon-192.png, icon-512.png
    # - icon-maskable-512.png (opaque background + safe padding)
    out = opts.out_dir

    _write_ico(src_square, out / "favicon.ico", sizes=[16, 32, 48], resample=opts.resample)
    _write_png(_resize(src_square, 180, opts.resample), out / "apple-touch-icon.png")
    _write_png(_resize(src_square, 192, opts.resample), out / "icon-192.png")
    _write_png(_resize(src_square, 512, opts.resample), out / "icon-512.png")

    bg = _parse_hex_color(opts.background)
    maskable = _fit_with_padding(
        img=src_square,
        size=512,
        content_scale=opts.maskable_scale,
        background_rgba=bg,
        resample=opts.resample,
    )
    _write_png(maskable, out / "icon-maskable-512.png")


def generate_ue(opts: Options, src_square: Image.Image) -> None:
    out = opts.out_dir

    # Windows: multi-size .ico. Minimum recommended set includes 16/24/32/48/256.
    _write_ico(src_square, out / "ue" / "windows" / "icon.ico", sizes=[16, 24, 32, 48, 64, 128, 256], resample=opts.resample)

    # macOS: generate a .iconset folder; creating .icns requires iconutil on macOS.
    iconset_dir = out / "ue" / "mac" / "AppIcon.iconset"
    iconset_dir.mkdir(parents=True, exist_ok=True)

    # Standard mac iconset filenames.
    mac_entries: list[tuple[str, int]] = [
        ("icon_16x16.png", 16),
        ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32),
        ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128),
        ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256),
        ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512),
        ("icon_512x512@2x.png", 1024),
    ]
    for filename, size in mac_entries:
        _write_png(_resize(src_square, size, opts.resample), iconset_dir / filename)

    # Linux: PNG is typically fine.
    _write_png(_resize(src_square, 256, opts.resample), out / "ue" / "linux" / "icon-256.png")
    _write_png(_resize(src_square, 512, opts.resample), out / "ue" / "linux" / "icon-512.png")


def _parse_targets(value: str) -> set[str]:
    targets = {t.strip().lower() for t in value.split(",") if t.strip()}
    allowed = {"web", "ue"}
    unknown = targets - allowed
    if unknown:
        raise ValueError(f"Unknown targets: {', '.join(sorted(unknown))}. Use: web, ue")
    return targets


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate web/PWA and UE icon assets from a single source image.")
    parser.add_argument("--input", required=True, help="Path to source image (PNG recommended; SVG supported with cairosvg).")
    parser.add_argument("--out", required=True, help="Output directory.")
    parser.add_argument("--targets", default="web", help="Comma-separated: web, ue (default: web)")
    parser.add_argument(
        "--no-pad",
        action="store_true",
        help="Do not pad to square. If the input is not square, crop instead.",
    )
    parser.add_argument(
        "--background",
        default="#000000",
        help="Background color for maskable icons and padding. Use #RRGGBB or #RRGGBBAA (default: #000000)",
    )
    parser.add_argument(
        "--maskable-scale",
        type=float,
        default=0.80,
        help="Scale of the artwork inside maskable icon canvas (default: 0.80).",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    targets = _parse_targets(args.targets)

    # Pillow resampling: prefer high-quality downsampling.
    # Use getattr to satisfy type checkers across Pillow versions/stubs.
    resample = (
        getattr(getattr(Image, "Resampling", None), "LANCZOS", None)
        or getattr(Image, "LANCZOS", None)
        or getattr(Image, "ANTIALIAS", None)
        or getattr(Image, "BICUBIC", 3)
    )

    opts = Options(
        input_path=input_path,
        out_dir=out_dir,
        targets=targets,
        pad_to_square=not args.no_pad,
        background=args.background,
        maskable_scale=args.maskable_scale,
        resample=resample,
    )

    bg = _parse_hex_color(opts.background)
    src = _load_image(opts.input_path)
    src_square = _ensure_square(src, pad_to_square=opts.pad_to_square, background_rgba=bg)

    if "web" in opts.targets:
        generate_web(opts, src_square)
    if "ue" in opts.targets:
        generate_ue(opts, src_square)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
