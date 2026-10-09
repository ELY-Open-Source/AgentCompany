import { Button } from "../shared/ui";
import { t } from "../i18n/i18n";
import type { SyncFailure } from "./useSnapshot";

/** What the window shows before the first data arrives: starting, or why loading failed and that it keeps retrying. */
export function StartupScreen({ failure, onRetry }: { failure: SyncFailure | null; onRetry: () => void }) {
  return (
    <div className="app-shell" style={{ display: "grid", placeItems: "center", padding: 24 }}>
      {failure ? (
        <div role="alert" style={{ maxWidth: 480, display: "grid", gap: 12, textAlign: "center" }}>
          <strong>{t("AgentCompany could not load its data.")}</strong>
          <div className="mono" style={{ fontSize: 12, color: "var(--text-2)", wordBreak: "break-word" }}>{failure.message}</div>
          <div style={{ fontSize: 13, color: "var(--text-3)" }}>{t("Retrying every few seconds (attempt {count}).", { count: failure.attempts })}</div>
          <div><Button onClick={onRetry}>{t("Retry now")}</Button></div>
        </div>
      ) : (
        <div role="status" style={{ color: "var(--text-3)" }}>{t("Starting AgentCompany…")}</div>
      )}
    </div>
  );
}
