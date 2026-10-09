import { DiscardConfirm } from "./DiscardConfirm";
import { Modal } from "./Modal";
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
    <Modal label={title} onEscape={requestClose} onBackdrop={requestClose}>
      <form className="modal" aria-busy={busy} onInput={() => setEdited(true)} onChange={() => setEdited(true)} onSubmit={submit}>
        <h2 className="modal-title">{title}</h2>
        <div style={{ display: "grid", gap: 12 }}>{children}</div>
        <div className="modal-actions">
          <Button tone="ghost" onClick={requestClose}>{hideSubmit ? t("Close") : t("Cancel")}</Button>
          {!hideSubmit && <Button tone="primary" type="submit" disabled={busy}>{busy ? t("Working…") : submitLabel}</Button>}
        </div>
      </form>
      {confirming && <DiscardConfirm onKeep={() => setConfirming(false)} onDiscard={onClose} />}
    </Modal>
  );
}
