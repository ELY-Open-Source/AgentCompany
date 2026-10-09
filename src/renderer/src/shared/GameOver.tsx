import type { ReactNode } from "react";
import { Button } from "./ui";
import { t } from "../i18n/i18n";

/** A failure as a game-over screen: what failed, the error itself, what happens next, and Continue to try again. */
export function GameOver({ title, error, note, onContinue }: { title: string; error: string; note: ReactNode; onContinue: () => void }) {
  return (
    <div role="alert" className="game-over modal">
      <div className="game-over-banner" aria-hidden="true">{t("GAME OVER")}</div>
      <strong>{title}</strong>
      <div className="mono game-over-error">{error}</div>
      <div className="game-over-note">{note}</div>
      <div><Button tone="primary" onClick={onContinue}>{t("Continue")}</Button></div>
    </div>
  );
}
