import type { FormEvent, ReactNode } from "react";
import { useBusySubmit } from "./useBusySubmit";
import { Button } from "./ui";
import { t } from "../i18n/i18n";

export function Dialog({
  title,
  open,
  children,
  submitLabel,
  onClose,
  onSubmit,
  hideSubmit = false,
}: {
  title: string;
  open: boolean;
  children: ReactNode;
  submitLabel: string;
  onClose: () => void;
  /** Returning the request's promise keeps the dialog busy until it settles: no second submit, and the button says so. */
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<unknown>;
  hideSubmit?: boolean;
}) {
  const { busy, submit } = useBusySubmit(onSubmit);
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="modal" aria-busy={busy} onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
        <h2 className="modal-title">{title}</h2>
        <div style={{ display: "grid", gap: 12 }}>{children}</div>
        <div className="modal-actions">
          <Button tone="ghost" onClick={onClose}>{hideSubmit ? t("Close") : t("Cancel")}</Button>
          {!hideSubmit && <Button tone="primary" type="submit" disabled={busy}>{busy ? t("Working…") : submitLabel}</Button>}
        </div>
      </form>
    </div>
  );
}
