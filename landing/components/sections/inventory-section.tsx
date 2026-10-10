import { Inventory, NpcSay } from "../pixel";
import { items } from "../../lib/content";
import { Reveal } from "./reveal";
import { SectionHeader } from "./section-header";
import section from "./section.module.css";
import styles from "./inventory-section.module.css";

export function InventorySection() {
  return (
    <section id="items" className={section.section} aria-labelledby="items-title">
      <div className={section.inner}>
        <Reveal>
          <SectionHeader
            id="items-title"
            stage="World 3 · Inventory"
            title="Everything in the bag"
            intro="Nine items, zero microtransactions. Select a slot to read the description."
          />
          <div className={styles.layout}>
            <Inventory items={items} />
            <NpcSay
              speaker="Bit, the intern"
              portrait="bot"
              lines={[
                "Arrow keys move the cursor. Enter inspects. No, you can't sell the auditor to a merchant.",
                "My favourite is the pixel office. At night the desk screens glow. Same as real offices, minus the overtime.",
              ]}
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
