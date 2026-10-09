import { useState, type FormEvent, type ReactNode } from "react";
import { useUnsaved } from "./unsaved";
import { useBusySubmit } from "./useBusySubmit";
import { Button } from "./ui";
import { t } from "../i18n/i18n";

export function Dialog(props: {
  title: string;
  open: boolean;
  children: ReactNode;
  submitLabel: string;
  onClose: () => void;
  /** Returning the request's promise keeps the dialog busy until it settles: no second submit, and the button says so. */
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<unknown>;
  hideSubmit?: boolean;
}) {
  // The body mounts per opening, so each opening starts clean.
  return props.open ? <DialogBody {...props} /> : null;
}

function DialogBody({ title, children, submitLabel, onClose, onSubmit, hideSubmit = false }: Parameters<typeof Dialog>[0]) {
  const { busy, submit } = useBusySubmit(onSubmit);
  const [edited, setEdited] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useUnsaved(edited);
  const requestClose = () => (edited ? setConfirming(true) : onClose());
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={requestClose}>
      <form className="modal" aria-busy={busy} onMouseDown={(event) => event.stopPropagation()} onInput={() => setEdited(true)} onChange={() => setEdited(true)} onSubmit={submit}>
        <h2 className="modal-title">{title}</h2>
        <div style={{ display: "grid", gap: 12 }}>{children}</div>
        {confirming ? (
          // Keyed rows remount, so a clicked plain button is never reused as the submit button (whose default action would then submit).
          <div key="confirm" className="modal-actions" role="alertdialog" aria-label={t("Discard your changes?")}>
            <span style={{ marginRight: "auto", fontSize: 13 }}>{t("Discard your changes?")}</span>
            <Button tone="ghost" onClick={() => setConfirming(false)}>{t("Keep editing")}</Button>
            <Button tone="primary" onClick={onClose}>{t("Discard")}</Button>
          </div>
        ) : (
          <div key="actions" className="modal-actions">
            <Button tone="ghost" onClick={requestClose}>{hideSubmit ? t("Close") : t("Cancel")}</Button>
            {!hideSubmit && <Button tone="primary" type="submit" disabled={busy}>{busy ? t("Working…") : submitLabel}</Button>}
          </div>
        )}
      </form>
    </div>
  );
}
