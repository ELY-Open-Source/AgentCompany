"use client";

import { motion } from "framer-motion";
import { AsciiBackground } from "./ascii-background";
import { platformDownloads, releaseVersion } from "./release-links.generated";

export function DownloadSection() {
  return (
    <section id="download" className="py-24 lg:py-40 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      <motion.div
        className="relative mx-auto max-w-5xl rounded-3xl p-14 lg:p-24 overflow-hidden"
        style={{
          background: "linear-gradient(135deg, var(--cta) 0%, color-mix(in srgb, var(--cta) 85%, #000) 100%)",
        }}
        initial={{ opacity: 0, scale: 0.92 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <AsciiBackground cssVar="--text-on-cta" baseOpacity={0.1} speed={0.8} />

        <div
          className="absolute inset-0 pointer-events-none opacity-[0.03]"
          aria-hidden="true"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='256' height='256' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E\")",
            backgroundRepeat: "repeat",
            backgroundSize: "128px 128px",
          }}
        />

        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse at top right, rgba(255,255,255,0.12) 0%, transparent 50%), radial-gradient(ellipse at bottom left, rgba(255,255,255,0.06) 0%, transparent 50%)",
          }}
        />

        <div className="relative z-10 flex flex-col items-center text-center">
          <h2 className="font-serif italic text-[clamp(2rem,1.5rem+2.5vw,3.25rem)] tracking-[-0.01em] text-[var(--text-on-cta)] mb-6">
            Install the Right Build for Your Machine
          </h2>
          <p className="text-[var(--text-on-cta-muted)] text-lg max-w-xl mx-auto mb-12 leading-relaxed">
            Full release matrix hosted on our Cloudflare release lane. Version {releaseVersion}.
          </p>

          <div className="w-full mt-2 grid grid-cols-1 md:grid-cols-3 gap-6">
            {platformDownloads.map((download, index) => (
              <motion.div
                key={download.id}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.5, delay: 0.08 * index, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-2xl border border-white/10 bg-white/6 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] p-6 lg:p-7 text-left"
              >
                <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--text-on-cta-faint)] mb-3">
                  {download.title}
                </p>
                <p className="text-[var(--text-on-cta-muted)] text-sm leading-relaxed mb-4">{download.note}</p>
                <div className="space-y-2.5">
                  {download.assets.map((asset) => (
                    <a
                      key={asset.id}
                      href={asset.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/12 bg-black/10 px-4 py-3 text-sm text-[var(--text-on-cta)] transition-colors duration-200 hover:bg-black/18"
                    >
                      <span className="font-semibold tracking-tight">{asset.label}</span>
                      <span className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--text-on-cta-faint)]">
                        {asset.note}
                      </span>
                    </a>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>
    </section>
  );
}
