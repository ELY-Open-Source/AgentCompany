import type { Metadata } from "next";
import { GameOver } from "../components/pixel";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Game over · AgentCompany",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <main className={`${styles.page} ${styles.lost}`}>
      <GameOver
        message="404: you wandered off the map. The CEO checked the org chart twice and nobody here owns this page."
        continueHref="/"
      />
    </main>
  );
}
