"use client";

import { useState } from "react";
import { Dialog, MenuList, NpcSay } from "../pixel";
import { faqs } from "../../lib/content";
import { Reveal } from "./reveal";
import { SectionHeader } from "./section-header";
import section from "./section.module.css";
import styles from "./faq-section.module.css";

export function FaqSection() {
  const [active, setActive] = useState(0);
  const faq = faqs[active]!;

  return (
    <section id="faq" className={section.section} aria-labelledby="faq-title">
      <div className={section.inner}>
        <Reveal>
          <SectionHeader
            id="faq-title"
            stage="World 7 · Talk to the NPC"
            title="Ask the guide anything (from this list)"
            intro="Pick a question. The guide answers in character, but the facts are real."
          />
          <div className={styles.layout}>
            <Dialog title="Ask about…" as="div">
              <MenuList
                label="Questions"
                items={faqs.map((item, index) => ({ label: item.question, onSelect: () => setActive(index) }))}
              />
            </Dialog>
            <div aria-live="polite">
              <NpcSay key={active} speaker="Bit, the intern" portrait="bot" lines={faq.answer} typewriter />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
