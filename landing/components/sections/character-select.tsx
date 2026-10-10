"use client";

import { useState } from "react";
import { Badge, Dialog, Icon, NpcSay, PixelButton } from "../pixel";
import { modes, type Mode } from "../../lib/content";
import { Reveal } from "./reveal";
import { SectionHeader } from "./section-header";
import section from "./section.module.css";
import styles from "./character-select.module.css";

const verdict: Record<Mode["id"], string[]> = {
  ceo: ["Bold. The CEO hires, approves and ships while you get a snack.", "It still can't close a goal by itself. The auditor holds that key."],
  cofounder: ["Classic co-op. The CEO does the grinding and pings you before anything risky.", "Big hires and risky work land in your Approvals. Deliverables wait for your review."],
};

export function CharacterSelect() {
  const [picked, setPicked] = useState<Mode["id"]>("cofounder");

  return (
    <section id="modes" className={section.section} aria-labelledby="modes-title">
      <div className={section.inner}>
        <Reveal>
          <SectionHeader
            id="modes-title"
            stage="World 2 · Character select"
            title="Choose your CEO"
            intro="Same company, two play styles. You pick one during setup."
          />
          <div className={styles.roster}>
            {modes.map((mode, index) => {
              const selected = mode.id === picked;
              return (
                <div key={mode.id} className={styles.card} data-selected={selected}>
                  <span className={styles.player} aria-hidden="true">
                    {selected ? `P${index + 1} ▼` : ""}
                  </span>
                  <Dialog title={mode.name} tone={selected ? "accent" : "default"} as="div">
                    <div className={styles.portrait} aria-hidden="true">
                      <Icon name={mode.icon} size={4} />
                    </div>
                    <p className={styles.class}>
                      <Badge>Class: {mode.className}</Badge>
                    </p>
                    <p className={styles.pitch}>{mode.pitch}</p>
                    <dl className={styles.stats}>
                      {mode.stats.map((stat) => (
                        <div key={stat.label} className={styles.stat}>
                          <dt>{stat.label}</dt>
                          <dd>{stat.value}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className={styles.special}>
                      <span>Special:</span> {mode.special}
                    </p>
                    <PixelButton variant={selected ? "primary" : "ghost"} onClick={() => setPicked(mode.id)} icon={selected ? "check" : "sword"}>
                      {selected ? `${mode.name} selected` : `Select ${mode.name}`}
                    </PixelButton>
                  </Dialog>
                </div>
              );
            })}
          </div>
          <div className={styles.npc} aria-live="polite">
            <NpcSay key={picked} speaker="Bit, the intern" portrait="bot" lines={verdict[picked]} />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
