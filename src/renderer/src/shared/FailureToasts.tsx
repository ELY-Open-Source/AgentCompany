import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./ui";
import { t } from "../i18n/i18n";

const SHOWN = 3;

/** Any failure no screen handled itself (a rejected action or a thrown handler) is shown here until dismissed, so nothing fails without a trace. */
export function FailureToasts() {
  const [failures, setFailures] = useState<Array<{ id: number; message: string }>>([]);
  useEffect(() => {
    let next = 0;
    const show = (reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      setFailures((current) => [...current, { id: next++, message }].slice(-SHOWN));
    };
    const onRejection = (event: PromiseRejectionEvent) => show(event.reason);
    const onError = (event: ErrorEvent) => show(event.error ?? event.message);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);
  if (failures.length === 0) return null;
  // Outside the app root, so a failure can be read and dismissed while a dialog makes the app inert.
  return createPortal(
    <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 1000, display: "grid", gap: 8, maxWidth: 420 }}>
      {failures.map((failure) => (
        <div key={failure.id} role="alert" className="card" style={{ display: "flex", gap: 8, alignItems: "flex-start", borderColor: "var(--red)", padding: 12 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: "var(--fs-body)" }}>
            <strong style={{ display: "block", marginBottom: 2 }}>{t("That did not work")}</strong>
            <span style={{ color: "var(--text-2)", wordBreak: "break-word" }}>{failure.message}</span>
          </div>
          <IconButton icon="x" label={t("Dismiss")} onClick={() => setFailures((current) => current.filter((item) => item.id !== failure.id))} />
        </div>
      ))}
    </div>,
    document.body,
  );
}
