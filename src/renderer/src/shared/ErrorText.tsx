import { useState } from "react";
import { Button } from "./ui";
import { t } from "../i18n/i18n";

/** A failure reason shown whole (wrapped, never cut) with a way to copy it, so the full cause can be read or passed on. */
export function ErrorText({ message, action }: { message: string; action?: { label: string; onClick: () => void } }) {
  // The copy result belongs to the message it was for; a new message starts fresh.
  const [copied, setCopied] = useState<{ message: string; ok: boolean } | null>(null);
  const copy = copied && copied.message === message ? (copied.ok ? "copied" : "failed") : "idle";
  const copyMessage = () => {
    void window.agentCompany.copyText({ text: message }).then((result) => {
      if (!result.ok) console.error(`[errors] copy failed: ${result.error.message}`);
      setCopied({ message, ok: result.ok });
    }, (error: unknown) => {
      console.error(`[errors] copy failed: ${error instanceof Error ? error.message : String(error)}`);
      setCopied({ message, ok: false });
    });
  };
  return (
    <div role="alert" className="row" style={{ gap: 10, alignItems: "flex-start", fontSize: "var(--fs-body)", color: "var(--red)", marginBottom: 14 }}>
      <span style={{ flex: 1, minWidth: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", userSelect: "text" }}>{message}</span>
      <Button size="small" onClick={copyMessage}>{copy === "copied" ? t("Copied") : copy === "failed" ? t("Copy failed") : t("Copy")}</Button>
      {action && <Button size="small" onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}
