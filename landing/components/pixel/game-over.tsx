import { useId, type ReactNode } from "react";
import { Menu } from "./menu-list";
import styles from "./pixel.module.css";

/** A failure as a game-over screen; CONTINUE? offers YES and NO, and both continue. */
export function GameOver({ title = "GAME OVER", message, onContinue, continueHref }: {
  title?: string;
  message: ReactNode;
  onContinue?: () => void;
  continueHref?: string;
}) {
  const titleId = useId();
  const href = continueHref ?? (onContinue ? undefined : "/");
  return (
    <section className={`${styles.frame} ${styles.gameOver}`} data-tone="danger" aria-labelledby={titleId}>
      <h1 id={titleId} className={styles.gameOverTitle}>{title}</h1>
      <div className={styles.gameOverMessage}>{message}</div>
      <div className={styles.gameOverPrompt}>
        <span>CONTINUE?</span>
        <Menu
          label="Continue?"
          orientation="horizontal"
          items={[
            { label: "YES", href, onSelect: onContinue },
            { label: "NO", hint: "(the hero continues anyway)", href, onSelect: onContinue },
          ]}
        />
      </div>
    </section>
  );
}
