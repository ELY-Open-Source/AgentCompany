"use client";

import { useEffect, useState } from "react";
import { Download } from "reicon-react/icons/Download";
import { Container } from "../ui/container";
import { Reveal } from "../ui/reveal";
import { SectionHeading } from "../ui/section-heading";
import { platformDownloads, releaseVersion } from "../../lib/release-links.generated";
import { DOWNLOAD_COUNT_SEED, getTrackedDownloadHref } from "../../lib/downloads";

export function DownloadSection() {
  const [downloadCount, setDownloadCount] = useState(DOWNLOAD_COUNT_SEED);

  useEffect(() => {
    let cancelled = false;

    async function loadDownloadCount() {
      try {
        const response = await fetch("/api/download-stats", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Failed to fetch download count: ${response.status}`);
        }
        const data = (await response.json()) as { downloads?: number };
        if (!cancelled && typeof data.downloads === "number") {
          setDownloadCount(data.downloads);
        }
      } catch {
        // Keep the seeded count visible when the dynamic endpoint is unavailable.
      }
    }

    void loadDownloadCount();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section id="download" className="scroll-mt-20 py-20 md:py-28">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="Download"
            title="Install the build for your machine"
            align="center"
            className="mx-auto"
          />
        </Reveal>

        <Reveal delay={60}>
          <p className="eyebrow mt-4 text-center text-sm text-[var(--muted)]">
            Version {releaseVersion} · {downloadCount.toLocaleString("en-US")} downloads
          </p>
        </Reveal>

        <Reveal delay={120} className="mt-12 grid gap-5 md:grid-cols-3">
          {platformDownloads.map((platform) => (
            <div key={platform.id} className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6">
              <p className="eyebrow text-sm text-[var(--text)]">{platform.title}</p>
              <p className="mt-2 text-sm text-[var(--muted)]">{platform.note}</p>
              <div className="mt-5 space-y-2.5">
                {platform.assets.map((asset) => (
                  <a
                    key={asset.id}
                    href={getTrackedDownloadHref(asset.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-sm text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    <span className="font-medium tracking-tight">{asset.label}</span>
                    <Download size={16} className="shrink-0 opacity-50" />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}
