"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Dialog, Icon, NpcSay, XpBar } from "../pixel";
import { quests } from "../../lib/content";
import { Reveal } from "./reveal";
import { SectionHeader } from "./section-header";
import section from "./section.module.css";
import styles from "./quest-log.module.css";

export function QuestLog() {
  const [active, setActive] = useState(0);
  const nodes = useRef<(HTMLButtonElement | null)[]>([]);
  const quest = quests[active]!;

  function onKeyDown(event: KeyboardEvent) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (active + step + quests.length) % quests.length;
    setActive(next);
    nodes.current[next]!.focus();
  }

  return (
    <section id="quests" className={section.section} aria-labelledby="quests-title">
      <div className={section.inner}>
        <Reveal>
          <SectionHeader
            id="quests-title"
            stage="World 1 · New game"
            title="Quest log: six checkpoints to your first company"
            intro="The setup wizard is the tutorial level. One key, a few names, one goal. Then the CEO takes the controller."
          />
          <ol className={styles.map} aria-label="Onboarding steps" onKeyDown={onKeyDown}>
            {quests.map((item, index) => (
              <li key={item.stage} className={styles.stop} data-state={index < active ? "cleared" : index === active ? "current" : "ahead"}>
                <button
                  ref={(node) => {
                    nodes.current[index] = node;
                  }}
                  type="button"
                  className={styles.node}
                  aria-current={index === active ? "step" : undefined}
                  tabIndex={index === active ? 0 : -1}
                  onClick={() => setActive(index)}
                >
                  <span className={styles.flag}>
                    <Icon name={item.icon} size={3} />
                  </span>
                  <span className={styles.stageNo}>{item.stage}</span>
                  <span className={styles.name}>{item.title}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className={styles.detail}>
            <Dialog title={`Stage ${quest.stage} · ${quest.title}`} tone={quest.optional ? "default" : "accent"} as="div">
              <p className={styles.body} aria-live="polite">
                {quest.body}
              </p>
              <XpBar value={active + 1} max={quests.length} label="Setup progress" />
            </Dialog>
            <NpcSay
              speaker="Bit, the intern"
              portrait="bot"
              lines={[
                "Six steps. I've seen speedrunners finish before their coffee cooled.",
                "You only need one provider. The connectors at the end are a side quest, so Skip is a legal move.",
              ]}
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
