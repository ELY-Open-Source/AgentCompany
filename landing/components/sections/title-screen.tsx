import { Badge, PixelButton } from "../pixel";
import { PixelWorld } from "../world";
import { releaseVersion, SOURCE_URL } from "../../lib/release-links";
import { Logotype } from "./logotype";
import { PlatformCta } from "./platform-cta";
import styles from "./title-screen.module.css";

export function TitleScreen() {
  return (
    <section id="top" className={styles.hero} aria-labelledby="title-heading">
      <PixelWorld className={styles.world} focus="right" />
      <div className={styles.content}>
        <h1 id="title-heading" className={styles.heading}>
          <span className={styles.srOnly}>AgentCompany</span>
          <Logotype />
        </h1>
        <div className={styles.window}>
          <p className={styles.tagline}>Run an autonomous AI company on your desktop.</p>
          <p className={styles.sub}>
            Set a goal. An AI CEO hires the team and hands out the work. Nobody clears the level until an isolated
            auditor approves the evidence.
          </p>
        </div>
        <div className={styles.dock}>
          <p className={styles.press} aria-hidden="true">
            ▶ PRESS START
          </p>
          <div className={styles.actions}>
            <PlatformCta />
            <PixelButton href={SOURCE_URL} variant="ghost" icon="github">
              View source on GitHub
            </PixelButton>
          </div>
          <p className={styles.meta}>
            <Badge tone="accent">v{releaseVersion}</Badge>
            <span>No account · Keys stay local · EN / 中文</span>
          </p>
        </div>
      </div>
      <div className={styles.ground} aria-hidden="true" />
    </section>
  );
}
