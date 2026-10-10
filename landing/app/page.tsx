import { CharacterSelect } from "../components/sections/character-select";
import { Credits } from "../components/sections/credits";
import { FaqSection } from "../components/sections/faq-section";
import { InventorySection } from "../components/sections/inventory-section";
import { PartyRoster } from "../components/sections/party-roster";
import { QuestLog } from "../components/sections/quest-log";
import { SavePoint } from "../components/sections/save-point";
import { TitleScreen } from "../components/sections/title-screen";
import { TopBar } from "../components/sections/top-bar";
import { XpSection } from "../components/sections/xp-section";
import styles from "./page.module.css";

export default function Page() {
  return (
    <div className={styles.page}>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      <TopBar />
      <main id="main" tabIndex={-1}>
        <TitleScreen />
        <QuestLog />
        <CharacterSelect />
        <InventorySection />
        <PartyRoster />
        <XpSection />
        <SavePoint />
        <FaqSection />
      </main>
      <Credits />
    </div>
  );
}
