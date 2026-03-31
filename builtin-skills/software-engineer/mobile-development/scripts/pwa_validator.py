#!/usr/bin/env python3
"""PWA and Mobile Readiness Validator for Cloudflare Pages."""

import json
from pathlib import Path


def validate_pwa(path: str) -> dict:
    """Validate PWA configuration for Cloudflare Pages deployment."""
    project = Path(path)

    checks = {
        "manifest": False,
        "service_worker": False,
        "icons": False,
        "offline_page": False,
        "https_ready": True  # Cloudflare provides HTTPS
    }

    # Check manifest.json
    for manifest_path in ["manifest.json", "public/manifest.json", "src/manifest.json"]:
        if (project / manifest_path).exists():
            checks["manifest"] = True
            manifest = json.loads((project / manifest_path).read_text())
            if manifest.get("icons"):
                checks["icons"] = True
            break

    # Check service worker
    sw_paths = ["sw.js", "service-worker.js", "public/sw.js", "src/sw.js"]
    for sw_path in sw_paths:
        if (project / sw_path).exists():
            checks["service_worker"] = True
            break

    # Check offline page
    offline_paths = ["offline.html", "public/offline.html"]
    for offline_path in offline_paths:
        if (project / offline_path).exists():
            checks["offline_page"] = True
            break

    pwa_score = sum(checks.values()) / len(checks) * 100

    return {
        "checks": checks,
        "pwa_score": pwa_score,
        "pwa_ready": pwa_score >= 60,
        "cloudflare_optimized": checks["manifest"] and checks["https_ready"]
    }


def main():
    import sys
    path = sys.argv[1] if len(sys.argv) > 1 else "."
    print(json.dumps(validate_pwa(path), indent=2))


if __name__ == "__main__":
    main()
