# Unreal Engine packaging icons (optional target)

## What UE typically expects

- **Windows**: a multi-resolution `.ico` (commonly max 256×256)
- **macOS**: an `.icns` (UE may require `.icns` even if Apple has moved toward asset catalogs)
- **Linux**: usually a `.png` (commonly 256×256)

## What this skill generates

Using `--targets ue`, the script outputs:

- `ue/windows/icon.ico` (multi-size)
- `ue/mac/AppIcon.iconset/` (iconset PNGs)
- `ue/linux/icon-256.png`, `ue/linux/icon-512.png`

### Creating `.icns` (macOS)

Creating `.icns` is easiest on macOS with `iconutil`.

- Input: the `AppIcon.iconset/` folder
- Output: `AppIcon.icns`

If you’re not on macOS, keep the `.iconset` in source control and generate `.icns` on a Mac build machine.

## Quality reminder

Even if a single “master” PNG exists, small sizes often need a simplified design.
If your 16×16 looks mushy, create a simplified icon variant and regenerate.
