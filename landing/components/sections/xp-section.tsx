"use client";

import { useCallback, useEffect, useState } from "react";
import { Dialog, PixelButton, XpBar } from "../pixel";
import { Reveal } from "./reveal";
import { SectionHeader } from "./section-header";
import section from "./section.module.css";
import styles from "./xp-section.module.css";

const XP_PER_LEVEL = 1000;

type Stats = { phase: "loading" } | { phase: "ready"; downloads: number } | { phase: "error"; message: string };

async function fetchDownloads(): Promise<number> {
  const response = await fetch("/api/download-stats", { cache: "no-store" });
  if (!response.ok) throw new Error(`The scoreboard answered HTTP ${response.status}.`);
  const body = (await response.json()) as { downloads?: unknown };
  if (typeof body.downloads !== "number") throw new Error("The scoreboard sent a score we can't read.");
  return body.downloads;
}

export function XpSection() {
  const [stats, setStats] = useState<Stats>({ phase: "loading" });

  const load = useCallback(() => {
    setStats({ phase: "loading" });
    fetchDownloads().then(
      (downloads) => setStats({ phase: "ready", downloads }),
      (error: Error) => setStats({ phase: "error", message: error.message }),
    );
  }, []);

  useEffect(load, [load]);

  return (
    <section id="xp" className={section.section} aria-labelledby="xp-title">
      <div className={section.inner}>
        <Reveal>
          <SectionHeader
            id="xp-title"
            stage="World 5 · Experience"
            title="Every download is one XP"
            intro="A live tally from the download counter, dressed up as a level bar because we couldn't help ourselves."
          />
          <div className={styles.panel} aria-live="polite" aria-busy={stats.phase === "loading"}>
            {stats.phase === "loading" ? <p className={styles.loading}>Loading save data…</p> : null}
            {stats.phase === "ready" ? <Level downloads={stats.downloads} /> : null}
            {stats.phase === "error" ? (
              <Dialog title="Scoreboard offline" tone="danger" as="div">
                <p className={styles.error}>
                  <strong>GAME OVER</strong> for the counter, not for you. {stats.message}
                </p>
                <p className={styles.error}>Downloads still work. Continue?</p>
                <div className={styles.actions}>
                  <PixelButton onClick={load} icon="arrowRight">
                    Retry
                  </PixelButton>
                  <PixelButton href="#save-point" variant="ghost" icon="download">
                    Continue to downloads
                  </PixelButton>
                </div>
              </Dialog>
            ) : null}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Level({ downloads }: { downloads: number }) {
  const level = Math.floor(downloads / XP_PER_LEVEL);
  return (
    <Dialog title={`Community LV ${level}`} tone="accent" as="div">
      <p className={styles.score}>
        <span className={styles.number}>{downloads.toLocaleString("en-US")}</span> downloads counted
      </p>
      <XpBar value={downloads % XP_PER_LEVEL} max={XP_PER_LEVEL} label={`XP to LV ${level + 1}`} />
    </Dialog>
  );
}
