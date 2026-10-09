import { GameOver } from "../shared/GameOver";
import { t } from "../i18n/i18n";
import type { SyncFailure } from "./useSnapshot";

/** What the window shows before the first data arrives: starting, or why loading failed and that it keeps retrying. */
export function StartupScreen({ failure, onRetry }: { failure: SyncFailure | null; onRetry: () => void }) {
  return (
    <div className="app-shell" style={{ display: "grid", placeItems: "center", padding: 24 }}>
      {failure ? (
        <GameOver
          title={t("AgentCompany could not load its data.")}
          error={failure.message}
          note={t("Retrying every few seconds (attempt {count}); Continue tries now.", { count: failure.attempts })}
          onContinue={onRetry}
        />
      ) : (
        <div role="status" style={{ color: "var(--text-3)" }}>{t("Starting AgentCompany…")}</div>
      )}
    </div>
  );
}
