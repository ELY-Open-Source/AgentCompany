import { createPortal } from "react-dom";
import { Button } from "../shared/ui";
import { t } from "../i18n/i18n";
import { formatTime } from "../pages/types";
import type { SyncFailure } from "./useSnapshot";

/** Says the data on screen is no longer current: from when it is, why updating failed, and that it keeps retrying. */
export function StaleBanner({ failure, syncedAt, onRetry }: { failure: SyncFailure; syncedAt: string | null; onRetry: () => void }) {
  // Outside the app root, so it stays usable while a dialog makes the app inert.
  return createPortal(
    <div role="alert" className="card" style={{ position: "fixed", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 900, display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", borderColor: "var(--amber, var(--red))", maxWidth: "min(720px, calc(100vw - 32px))" }}>
      <div style={{ fontSize: 13, minWidth: 0 }}>
        <strong>{t("Not up to date.")}</strong>{" "}
        {syncedAt ? t("Showing data from {time}.", { time: formatTime(syncedAt) }) : null}{" "}
        <span style={{ color: "var(--text-2)", wordBreak: "break-word" }}>{t("Updating failed: {reason} (attempt {count}).", { reason: failure.message, count: failure.attempts })}</span>
      </div>
      <Button size="small" onClick={onRetry}>{t("Retry now")}</Button>
    </div>,
    document.body,
  );
}
