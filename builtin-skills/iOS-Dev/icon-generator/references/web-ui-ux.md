# Web UI/UX icon set (favicon + PWA)

## Recommended minimal output set

This set covers modern browsers + iOS home screen + Android/PWA:

- `favicon.ico` (multi-size container): include 16×16 and 32×32 (optionally 48×48)
- `apple-touch-icon.png` (180×180)
- `icon-192.png` (192×192)
- `icon-512.png` (512×512)
- `icon-maskable-512.png` (512×512, **maskable**, opaque background, padded content)

This is intentionally “minimal but effective”. You can add more sizes if you have a specific requirement.

## HTML `<head>` snippet

Use this as a starting point:

- `<link rel="icon" href="/favicon.ico">`
- `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`
- `<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">`
- `<link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png">`
- `<link rel="manifest" href="/manifest.webmanifest">` (if PWA)

## `manifest.webmanifest` example

Include both normal (“any”) and maskable icons:

```json
{
  "name": "My App",
  "short_name": "MyApp",
  "display": "standalone",
  "start_url": "/",
  "icons": [
    { "src": "/icon-192.png", "type": "image/png", "sizes": "192x192", "purpose": "any" },
    { "src": "/icon-512.png", "type": "image/png", "sizes": "512x512", "purpose": "any" },
    { "src": "/icon-maskable-512.png", "type": "image/png", "sizes": "512x512", "purpose": "maskable" }
  ]
}
```

## Maskable safe area (practical rule)

Maskable icons can be cropped into different shapes by the OS/launcher.

- Keep important content inside the **center ~80%** of the image.
- Use an **opaque background** for the full 512×512.

In the generator script, this corresponds to `--maskable-scale 0.80` (default).

## Common failure modes

- You only provide a big 512×512 and let the browser scale down → looks blurry at 16×16.
- You use transparent background for iOS “Add to Home Screen” icons → iOS may render it with an ugly fill.
- Your maskable icon has no padding → the launcher crops off your logo.
