import { Modal } from "../../shared/Modal";
import { approvalKindLabel } from "../../i18n/labels";
import { useState } from "react";
import { Button, IconButton, Pill } from "../../shared/ui";
import type { ApprovalRecord } from "../../../../shared/domain";
import { APPROVAL_STATE } from "../../../../shared/domain";
import type { ApprovalDrift } from "../../../../shared/approval-pin";
import { formatRelative } from "../types";
import { RISK_TONES } from "./risk-tones";
import { t } from "../../i18n/i18n";

export function ApprovalDetailDialog({
  approval,
  requester,
  onClose,
  onDecide,
  onOpenTask,
}: {
  approval: ApprovalRecord | null;
  requester: string;
  onClose: () => void;
  /** Resolves once the decision is saved; the dialog stays open until then and shows a refusal. */
  onDecide: (state: "approved" | "declined", notes?: string) => Promise<void>;
  onOpenTask: (taskId: string) => void;
}) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (state: "approved" | "declined") => {
    setSaving(true);
    setError(null);
    onDecide(state, notes || undefined).catch((reason: unknown) => {
      setSaving(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };
  if (!approval) return null;
  const tone = RISK_TONES[approval.risk];
  if (!tone) throw new Error("Approval risk tone is missing.");
  return (
    <Modal label={approval.title} onEscape={onClose} onBackdrop={onClose}>
      <div className="modal">
        <div className="row" style={{ alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
          <h2 className="modal-title" style={{ margin: 0, flex: 1 }}>{approval.title}</h2>
          <IconButton icon="x" label={t("Close")} onClick={onClose} />
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: tone.color, fontWeight: 540, letterSpacing: "0.02em" }}>{tone.label}</span>
          <span style={{ color: "var(--text-4)" }}>·</span>
          <Pill>{approvalKindLabel(approval.kind)}</Pill>
        </div>
        <p style={{ margin: "0 0 16px", color: "var(--text-2)", fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
          {approval.details}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "10px 14px", fontSize: 12 }}>
          <span style={{ color: "var(--text-3)" }}>{t("Requested by")}</span>
          <span>{requester}</span>
          {approval.sourceEntityType && (
            <>
              <span style={{ color: "var(--text-3)" }}>{t("Source")}</span>
              {approval.sourceEntityType === "task" && approval.sourceEntityId
                ? (
                  <span>
                    <button type="button" className="link-button" onClick={() => onOpenTask(approval.sourceEntityId!)}>{t("Edit the task")}</button>
                    <span style={{ color: "var(--text-3)" }}> · {t("Changing the task replaces this request with a fresh one.")}</span>
                  </span>
                )
                : <span>{humanizeKind(approval.sourceEntityType)}</span>}
            </>
          )}
          <span style={{ color: "var(--text-3)" }}>{t("Requested")}</span>
          <span>{formatRelative(approval.createdAt)}</span>
        </div>
        <textarea
          className="input"
          aria-label={t("Decision notes")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          style={{ marginTop: 14 }}
        />
        {error && <div className="form-error" role="alert">{t("Not decided: {reason}", { reason: error })}</div>}
        <div className="modal-actions">
          <Button onClick={() => submit("declined")} disabled={saving}>{t("Decline")}</Button>
          <Button tone="primary" onClick={() => submit("approved")} disabled={saving}>{t("Approve")}</Button>
        </div>
      </div>
    </Modal>
  );
}

function humanizeKind(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A decided request in full: what was asked, the notes given, who decided and when, and whether it changed since. */
export function ApprovalRecordDialog({ approval, requester, decider, drift, onClose, onOpenTask }: {
  approval: ApprovalRecord | null;
  requester: string;
  decider: string;
  drift: ApprovalDrift | null;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  if (!approval) return null;
  const outcome = approval.state === APPROVAL_STATE.APPROVED ? t("Approved") : approval.state === APPROVAL_STATE.SUPERSEDED ? t("Replaced by an edit") : t("Declined");
  return (
    <Modal label={t("Record of {title}", { title: approval.title })} onEscape={onClose} onBackdrop={onClose}>
      <div className="modal">
        <div className="row" style={{ alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
          <h2 className="modal-title" style={{ margin: 0, flex: 1 }}>{approval.title}</h2>
          <IconButton icon="x" label={t("Close")} onClick={onClose} />
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          <Pill>{outcome}</Pill>
          <Pill>{approvalKindLabel(approval.kind)}</Pill>
          {drift && <Pill tone="amber">{drift === "changed" ? t("Changed since approval") : t("Removed since approval")}</Pill>}
        </div>
        <p style={{ margin: "0 0 16px", color: "var(--text-2)", fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{approval.details}</p>
        <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: "10px 14px", fontSize: 12 }}>
          <span style={{ color: "var(--text-3)" }}>{t("Requested by")}</span>
          <span>{requester} · {formatRelative(approval.createdAt)}</span>
          <span style={{ color: "var(--text-3)" }}>{t("Decided by")}</span>
          <span>{decider}{approval.decidedAt ? ` · ${formatRelative(approval.decidedAt)}` : ""}</span>
          <span style={{ color: "var(--text-3)" }}>{t("Decision notes")}</span>
          <span style={{ whiteSpace: "pre-wrap" }}>{approval.decisionNotes ?? t("No notes")}</span>
          {approval.sourceEntityType === "task" && approval.sourceEntityId && (
            <>
              <span style={{ color: "var(--text-3)" }}>{t("Source")}</span>
              <button type="button" className="link-button" style={{ textAlign: "left" }} onClick={() => onOpenTask(approval.sourceEntityId!)}>{t("Open task")}</button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
