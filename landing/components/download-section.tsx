"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { platformDownloads, releaseVersion } from "./release-links.generated";
import { DOWNLOAD_COUNT_SEED, getTrackedDownloadHref } from "../lib/downloads";

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
        const data = await response.json() as { downloads?: number };
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
    <section id="download" className="py-24 lg:py-40 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-16 lg:mb-20"
        >
          <p className="font-mono text-xs font-medium uppercase tracking-[0.25em] text-[var(--accent)] mb-5">
            Download
          </p>
          <h2 className="font-serif text-[clamp(2rem,1.5rem+2.5vw,3.25rem)] tracking-[-0.01em] text-[var(--text)]">
            Install the Right Build for Your Machine
          </h2>
          <p className="text-[var(--muted)] text-lg mt-5 leading-relaxed">
            Version {releaseVersion} · {downloadCount.toLocaleString("en-US")} downloads
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {platformDownloads.map((download, index) => (
            <motion.div
              key={download.id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.5, delay: 0.08 * index, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-[22px] border border-[var(--border)] bg-[var(--panel)] p-6 lg:p-7"
            >
              <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--muted)] mb-4">
                {download.title}
              </p>
              <p className="text-xs text-[var(--muted)] mb-4">{download.note}</p>
              <div className="space-y-2.5">
                {download.assets.map((asset) => (
                  <a
                    key={asset.id}
                    href={getTrackedDownloadHref(asset.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between rounded-[16px] border border-[var(--border)] bg-[var(--panel-soft)] px-4 py-3 text-sm text-[var(--text)] transition-colors duration-200 hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    <span className="font-semibold tracking-tight">{asset.label}</span>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="shrink-0 ml-2 opacity-40"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </a>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
