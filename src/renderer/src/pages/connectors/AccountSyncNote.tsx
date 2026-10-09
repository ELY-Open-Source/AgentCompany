import { Button } from "../../shared/ui";
import { t } from "../../i18n/i18n";
import { formatTime } from "../types";
import type { AccountSync } from "./useConnectorCatalog";

/** Says whether the account statuses shown are what Composio reports now, and when they were last checked. */
export function AccountSyncNote({ sync, onRetry }: { sync: AccountSync; onRetry: () => void }) {
  if (sync.phase === "failed") {
    return (
      <div role="alert" className="row" style={{ gap: 10, fontSize: "var(--fs-body)", marginBottom: 14, color: "var(--red)" }}>
        <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>{t("Account status could not be checked with Composio, so the statuses below may be out of date. Reason: {reason}", { reason: sync.message })}</span>
        <Button size="small" onClick={onRetry}>{t("Retry")}</Button>
      </div>
    );
  }
  return (
    <div role="status" style={{ fontSize: "var(--fs-body)", marginBottom: 14, color: "var(--text-3)" }}>
      {sync.phase === "syncing" ? t("Checking account status with Composio…") : t("Account status checked with Composio at {time}.", { time: formatTime(sync.at) })}
    </div>
  );
}
