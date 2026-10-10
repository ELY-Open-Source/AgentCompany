import { Badge, Dialog, Icon, NpcSay } from "../pixel";
import { party } from "../../lib/content";
import { Reveal } from "./reveal";
import { SectionHeader } from "./section-header";
import section from "./section.module.css";
import styles from "./party-roster.module.css";

export function PartyRoster() {
  const total = party.reduce((sum, group) => sum + group.members.length, 0);
  return (
    <section id="party" className={section.section} aria-labelledby="party-title">
      <div className={section.inner}>
        <Reveal>
          <SectionHeader
            id="party-title"
            stage="World 4 · Party roster"
            title="Recruit any model into the party"
            intro={`${total} ways to power your CEO, sorted by how they join.`}
          />
          <ul className={styles.grid}>
            {party.map((group) => (
              <li key={group.name}>
                <Dialog title={group.name} as="div">
                  <p className={styles.blurb}>
                    <Badge>{group.badge}</Badge>
                    <span>{group.blurb}</span>
                  </p>
                  <ul className={styles.members}>
                    {group.members.map((member) => (
                      <li key={member}>
                        <Icon name={group.icon} size={1} />
                        <span>{member}</span>
                      </li>
                    ))}
                  </ul>
                </Dialog>
              </li>
            ))}
          </ul>
          <div className={styles.npc}>
            <NpcSay
              speaker="Bit, the intern"
              portrait="bot"
              lines={["One provider is enough to start. Settings has a Providers panel for when you want to recruit more."]}
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
