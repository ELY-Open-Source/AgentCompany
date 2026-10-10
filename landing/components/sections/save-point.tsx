"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Badge, Dialog, Icon, NpcSay, PixelButton, type IconName } from "../pixel";
import { getTrackedDownloadHref } from "../../lib/downloads";
import { detectClientPlatform } from "../../lib/platform";
import { platformDownloads, RELEASE_PAGE_URL, releaseVersion, SOURCE_URL, type PlatformDownload } from "../../lib/release-links";
import { Reveal } from "./reveal";
import { SectionHeader } from "./section-header";
import section from "./section.module.css";
import styles from "./save-point.module.css";

type PlatformId = PlatformDownload["id"];

const platformIcon: Record<PlatformId, IconName> = { macos: "apple", windows: "windows", linux: "linux" };

export function SavePoint() {
  const [selected, setSelected] = useState<PlatformId>("macos");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const platform = platformDownloads.find((item) => item.id === selected)!;

  useEffect(() => {
    void detectClientPlatform().then(({ os }) => {
      if (os !== "unknown") setSelected(os);
    });
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = platformDownloads.findIndex((item) => item.id === selected);
    const next = (index + step + platformDownloads.length) % platformDownloads.length;
    setSelected(platformDownloads[next]!.id);
    tabs.current[next]!.focus();
  }

  return (
    <section id="save-point" className={section.section} aria-labelledby="save-title">
      <div className={section.inner}>
        <Reveal>
          <SectionHeader
            id="save-title"
            stage="World 6 · Save point"
            title="Save point reached. Grab your build."
            intro={`Version ${releaseVersion}, served straight from the project's Gitea releases.`}
          />
          <div role="tablist" aria-label="Platform" className={styles.tabs} onKeyDown={onKeyDown}>
            {platformDownloads.map((item, index) => (
              <button
                key={item.id}
                ref={(node) => {
                  tabs.current[index] = node;
                }}
                id={`tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={item.id === selected}
                aria-controls="save-panel"
                tabIndex={item.id === selected ? 0 : -1}
                className={styles.tab}
                onClick={() => setSelected(item.id)}
              >
                <Icon name={platformIcon[item.id]} size={2} />
                {item.title}
              </button>
            ))}
          </div>
          <div id="save-panel" role="tabpanel" aria-labelledby={`tab-${selected}`} className={styles.panel}>
            <Dialog title={`${platform.title} builds`} tone="accent" as="div">
              <p className={styles.note}>
                {platform.id === "macos" ? <Badge tone="mint">Signed + notarized</Badge> : null}
                <span>{platform.note}</span>
              </p>
              <ul className={styles.assets}>
                {platform.assets.map((asset) => (
                  <li key={asset.id} className={styles.asset}>
                    <span className={styles.chest} aria-hidden="true">
                      <Icon name="chest" size={2} />
                    </span>
                    <span className={styles.info}>
                      <span className={styles.label}>{asset.label}</span>
                      <span className={styles.file}>{asset.fileName}</span>
                    </span>
                    <span className={styles.specs}>
                      {asset.architectures.map((arch) => (
                        <Badge key={arch}>{arch}</Badge>
                      ))}
                      <span>{asset.size}</span>
                    </span>
                    <PixelButton href={getTrackedDownloadHref(asset.id)} icon="download">
                      Download<span className={styles.srOnly}> {asset.label}</span>
                    </PixelButton>
                  </li>
                ))}
              </ul>
            </Dialog>
          </div>
          <div className={styles.footer}>
            <NpcSay
              speaker="Bit, the intern"
              portrait="bot"
              lines={[
                "Save point! Your company, your keys and your progress all live on this machine.",
                "Apple Silicon or Intel? Apple menu, About This Mac. I'll wait. I'm an NPC, waiting is my whole job.",
              ]}
            />
            <div className={styles.links}>
              <PixelButton href={RELEASE_PAGE_URL} variant="ghost" icon="flag">
                Full release notes
              </PixelButton>
              <PixelButton href={SOURCE_URL} variant="ghost" icon="chest">
                Source on Gitea
              </PixelButton>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
