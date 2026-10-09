import { Modal } from "./Modal";
import { Button } from "./ui";
import { t } from "../i18n/i18n";

/** Asks before typed input is thrown away, as its own layer above the dialog; Escape keeps editing. */
export function DiscardConfirm({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  return (
    <Modal label={t("Discard your changes?")} role="alertdialog" onEscape={onKeep} onBackdrop={onKeep}>
      <div className="modal" style={{ maxWidth: 360 }}>
        <p style={{ margin: "0 0 12px", fontSize: "var(--fs-body)" }}>{t("Discard your changes?")}</p>
        <div className="modal-actions">
          <Button tone="ghost" onClick={onKeep}>{t("Keep editing")}</Button>
          <Button tone="primary" onClick={onDiscard}>{t("Discard")}</Button>
        </div>
      </div>
    </Modal>
  );
}
