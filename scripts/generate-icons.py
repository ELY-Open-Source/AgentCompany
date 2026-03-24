#!/usr/bin/env python3
"""Generate AgentCompany icons from SVG sources using cairosvg.

Two icon families:
  - Web (circle bg):  icon.svg  → landing favicon + website logo
  - App (square bg):  icon-app.svg → Electron app icon (Apple HIG, OS applies mask)
  - Tray: rendered from logo.svg for menu bar / notification area
"""

from __future__ import annotations

import io
import os
import shutil
import subprocess
from pathlib import Path

# ── Ensure cairo library is discoverable on macOS (Homebrew) ──────────
for _lib_dir in ("/opt/homebrew/opt/cairo/lib", "/usr/local/opt/cairo/lib"):
    if Path(_lib_dir).exists():
        os.environ["DYLD_LIBRARY_PATH"] = (
            _lib_dir + ":" + os.environ.get("DYLD_LIBRARY_PATH", "")
        )
        break

import cairosvg  # noqa: E402  — must come after DYLD_LIBRARY_PATH setup
from PIL import Image  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
LANDING = ROOT / "landing" / "public"
ICONSET = ASSETS / "icon.iconset"
LOGO_SVG = ROOT / "logo.svg"

# SVG sources
WEB_SVG = ASSETS / "icon.svg"        # circle bg — web favicon
APP_SVG = ASSETS / "icon-app.svg"    # square bg — Electron (Apple HIG)

SIZE = 1024


# ── Helpers ───────────────────────────────────────────────────────────

def svg_to_image(svg_path: Path, width: int, height: int | None = None) -> Image.Image:
    """Render an SVG to a Pillow RGBA Image at the given size."""
    h = height or width
    png_data = cairosvg.svg2png(
        url=str(svg_path), output_width=width, output_height=h,
    )
    return Image.open(io.BytesIO(png_data)).convert("RGBA")


def svg_bytes_to_image(svg_bytes: bytes, width: int, height: int | None = None) -> Image.Image:
    """Render SVG bytes to a Pillow RGBA Image."""
    h = height or width
    png_data = cairosvg.svg2png(
        bytestring=svg_bytes, output_width=width, output_height=h,
    )
    return Image.open(io.BytesIO(png_data)).convert("RGBA")


# ── Web icons (circle background) ────────────────────────────────────

def generate_web_icons() -> None:
    """Generate favicon.ico and icon.png for the landing site (circle bg)."""
    print("Generating web icons from icon.svg (circle bg)…")
    master = svg_to_image(WEB_SVG, SIZE)

    # PNG for apple-touch-icon / og
    web_png = LANDING / "icon.png"
    master.save(web_png, format="PNG")
    print(f"  → {web_png}")

    # Copy SVG to landing
    shutil.copy2(WEB_SVG, LANDING / "icon.svg")
    print(f"  → {LANDING / 'icon.svg'}")

    # ICO with multiple sizes for favicon
    favicon = LANDING / "favicon.ico"
    master.save(
        favicon, format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"  → {favicon}")


# ── App icons (square background, Apple HIG) ─────────────────────────

def generate_app_icons() -> None:
    """Generate Electron app icons: PNG, ICO, ICNS (square bg, Apple HIG)."""
    print("Generating app icons from icon-app.svg (square bg, Apple HIG)…")
    master = svg_to_image(APP_SVG, SIZE)

    # Main PNG
    png_path = ASSETS / "icon.png"
    master.save(png_path, format="PNG")
    print(f"  → {png_path}")

    # Windows ICO
    ico_path = ASSETS / "icon.ico"
    master.save(
        ico_path, format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"  → {ico_path}")

    # macOS ICNS via iconutil
    generate_icns(master)


def generate_icns(master: Image.Image) -> None:
    """Generate .icns from a master image using macOS iconutil."""
    if ICONSET.exists():
        shutil.rmtree(ICONSET)
    ICONSET.mkdir(parents=True, exist_ok=True)

    for size in (16, 32, 64, 128, 256, 512):
        master.resize((size, size), Image.Resampling.LANCZOS).save(
            ICONSET / f"icon_{size}x{size}.png", format="PNG",
        )
        master.resize((size * 2, size * 2), Image.Resampling.LANCZOS).save(
            ICONSET / f"icon_{size}x{size}@2x.png", format="PNG",
        )

    icns_path = ASSETS / "icon.icns"
    subprocess.run(
        ["iconutil", "-c", "icns", str(ICONSET), "-o", str(icns_path)],
        check=True,
    )
    shutil.rmtree(ICONSET)
    print(f"  → {icns_path}")


# ── Tray / notification area icons ───────────────────────────────────

def generate_tray_icons() -> None:
    """Generate tray icons following Apple HIG for menu bar.

    - Color (Windows/Linux): square bg with logo, 32×32 and 64×64
    - Template (macOS): monochrome black logo on transparent, 22×22 and 44×44
    """
    print("Generating tray icons…")

    # Color tray icons — render app icon (square bg) at small sizes
    for name, size in [("tray-icon.png", 32), ("tray-icon@2x.png", 64)]:
        img = svg_to_image(APP_SVG, size)
        img.save(ASSETS / name, format="PNG")
        print(f"  → {ASSETS / name}")

    # macOS template icons — black logo silhouette on transparent
    # Read logo.svg paths, render as black on transparent
    logo_svg = LOGO_SVG.read_text()

    for name, size in [("tray-iconTemplate.png", 22), ("tray-iconTemplate@2x.png", 44)]:
        # Create SVG with black fill, sized to target
        template_svg = _make_template_svg(logo_svg, size)
        img = svg_bytes_to_image(template_svg.encode("utf-8"), size)
        img.save(ASSETS / name, format="PNG")
        print(f"  → {ASSETS / name}")


def _make_template_svg(logo_svg_content: str, target_size: int) -> str:
    """Create a macOS template SVG: black logo silhouette on transparent bg."""
    # Logo viewBox is 0 0 122 126 — scale to fit target with padding
    padding = max(2, int(target_size * 0.1))
    available = target_size - 2 * padding
    # Scale to fit height (taller dimension)
    scale = available / 126
    logo_w = 122 * scale
    # Center horizontally
    offset_x = (target_size - logo_w) / 2
    offset_y = padding

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {target_size} {target_size}" fill="none">
  <g transform="translate({offset_x:.1f} {offset_y:.1f}) scale({scale:.4f})">
    <path fill="#000000" d="M 76.604813 111.661926 C 65.070183 111.662621 53.987053 111.662621 42.757744 111.662621 C 45.2239 101.998177 45.297546 101.949265 53.830105 102.036659 C 57.279823 102.071999 60.730202 102.04248 64.259201 102.04248 C 62.159458 93.316338 61.799103 93.009819 51.340881 91.341682 C 59.312901 73.847687 67.193756 56.553749 75.587578 38.134155 C 86.933441 62.965954 97.804642 86.758881 108.711754 110.630394 C 100.707413 111.871689 92.355965 107.246559 88.107536 98.852119 C 84.207748 91.146538 80.800591 83.191696 77.172813 75.348343 C 76.340195 73.54818 75.492958 71.754791 74.614624 69.877441 C 69.107384 75.691788 68.008286 81.475128 71.005882 88.088753 C 74.413452 95.606903 77.813919 103.128281 81.452705 111.167984 C 79.55114 111.381325 78.303734 111.521271 76.604813 111.661926 Z"/>
    <path fill="#000000" d="M 26.805992 87.743256 C 38.616821 61.830872 50.261688 36.260269 62.470131 9.452141 C 65.732315 17.818909 71.145126 23.524567 66.258224 33.086182 C 55.518253 54.099815 46.339973 75.911873 36.533691 97.402336 C 32.699284 105.805443 26.495394 110.823158 16.012421 111.410957 C 19.72117 103.270836 23.180601 95.67794 26.805992 87.743256 Z"/>
  </g>
</svg>"""


# ── Main ──────────────────────────────────────────────────────────────

def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    LANDING.mkdir(parents=True, exist_ok=True)

    generate_web_icons()
    generate_app_icons()
    generate_tray_icons()

    print("\nDone! All icons generated.")


if __name__ == "__main__":
    main()
