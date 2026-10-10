"use client";

import { useEffect, useState } from "react";
import { PixelButton } from "../pixel";
import { getTrackedDownloadHref, type ReleaseDownloadAsset } from "../../lib/downloads";
import { detectClientPlatform, recommendedAsset, type DetectedPlatform } from "../../lib/platform";
import styles from "./title-screen.module.css";

/** Server renders "Choose your platform"; the browser swaps in the build for this machine. */
export function PlatformCta() {
  const [detected, setDetected] = useState<{ platform: DetectedPlatform; asset: ReleaseDownloadAsset | null } | null>(null);

  useEffect(() => {
    void detectClientPlatform().then((platform) => setDetected({ platform, asset: recommendedAsset(platform) }));
  }, []);

  const asset = detected?.asset ?? null;
  if (!asset) {
    const mac = detected?.platform.os === "macos";
    return (
      <span className={styles.cta}>
        <PixelButton href="#save-point" icon="download">
          {mac ? "Choose your Mac build" : "Choose your platform"}
        </PixelButton>
        <span className={styles.ctaNote}>{mac ? "Apple Silicon or Intel" : "macOS · Windows · Linux"}</span>
      </span>
    );
  }

  return (
    <span className={styles.cta}>
      <PixelButton href={getTrackedDownloadHref(asset.id)} icon="download">
        Download for {asset.platformTitle}
      </PixelButton>
      <span className={styles.ctaNote}>
        {asset.label} · {asset.size} · <a href="#save-point">other builds</a>
      </span>
    </span>
  );
}
