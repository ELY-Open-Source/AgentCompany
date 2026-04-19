import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Trash, XCircle } from "./icons";
import { ActionButton } from "./primitives";
import { useFocusTrap } from "./hooks";

const EASE = [0.16, 1, 0.3, 1] as const;

/* ------------------------------------------------------------------ */
/*  StatusPill                                                         */
/* ------------------------------------------------------------------ */

export function StatusPill({ status }: { status: string }) {
  const positive = ["ready", "active", "running", "succeeded", "approved", "achieved", "done"].includes(status);
  const negative = ["error", "failed", "cancelled", "blocked", "rejected", "interrupted"].includes(status);
  const warning = ["auth_required", "degraded", "pending", "in_review", "todo", "queued", "not_installed"].includes(status);
  const checking = status === "detected";
  const toneClass = positive
    ? "text-success"
    : negative
      ? "text-destructive"
      : warning
        ? "text-warning"
        : "text-muted-foreground";
  const dotClass = positive
    ? "bg-success"
    : negative
      ? "bg-destructive"
      : warning
        ? "bg-warning"
        : "bg-[color:var(--muted-foreground)]";

  const displayLabel = checking ? "checking" : status.replaceAll("_", " ");

  return (
    <span className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.12em] ${toneClass}`}>
      {checking ? (
        <span className="h-2 w-2 animate-pulse rounded-full bg-[color:var(--muted-foreground)]" aria-hidden="true" />
      ) : (
        <span className={`h-2 w-2 rounded-full ${dotClass}`} aria-hidden="true" />
      )}
      {displayLabel}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  InlineNotice                                                       */
/* ------------------------------------------------------------------ */

export function InlineNotice({
  message,
  tone = "danger",
  action,
}: {
  message: string;
  tone?: "danger" | "success" | "warn";
  action?: ReactNode;
}) {
  const toneClass = tone === "success"
    ? "border-success bg-success-muted text-success"
    : tone === "warn"
      ? "border-warning bg-warning-muted text-warning"
      : "border-destructive bg-destructive-muted text-destructive";
  const role = tone === "danger" || (tone === "warn" && action) ? "alert" : "status";
  return (
    <div className={`rounded-lg border px-4 py-3 text-[13px] ${toneClass}`} role={role}>
      {action ? (
        <div className="flex items-start justify-between gap-3">
          <span>{message}</span>
          {action}
        </div>
      ) : message}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ConfirmDialog                                                      */
/* ------------------------------------------------------------------ */

export function ConfirmDialog({ open, title, message, errorMessage, onConfirm, onCancel, confirmTone = "danger", confirmLabel = "Confirm", cancelLabel = "Cancel" }: {
  open: boolean;
  title: string;
  message: string;
  errorMessage?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  confirmTone?: "default" | "accent" | "danger";
  confirmLabel?: string;
  cancelLabel?: string;
}) {
  const trapRef = useFocusTrap(open);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: EASE }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--foreground)]/45"
          onClick={onCancel}
        >
          <motion.div
            ref={trapRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE }}
            className="w-full max-w-[400px] rounded-lg bg-card border border-border p-6 shadow-lg"
            onClick={e => e.stopPropagation()}
          >
            <div id="confirm-dialog-title" className="text-[16px] font-semibold text-foreground mb-2">{title}</div>
            <div className="text-[13px] text-muted-foreground mb-6">{message}</div>
            {errorMessage ? <div className="mb-4"><InlineNotice message={errorMessage} /></div> : null}
            <div className="flex gap-3 justify-end">
              <ActionButton label={cancelLabel} onClick={onCancel} />
              <ActionButton label={confirmLabel} tone={confirmTone} onClick={onConfirm} />
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/*  InlineConfirmDelete                                                */
/* ------------------------------------------------------------------ */

export function InlineConfirmDelete({
  entityLabel,
  onConfirm,
  onCancel,
}: {
  entityLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[color:var(--destructive)] bg-destructive-muted px-4 py-3">
      <span className="text-[13px] text-destructive">Delete {entityLabel}?</span>
      <ActionButton label="Yes, delete" tone="danger" onClick={onConfirm} icon={Trash} />
      <ActionButton label="Cancel" onClick={onCancel} icon={XCircle} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  EmptyState                                                         */
/* ------------------------------------------------------------------ */

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      className="px-1 py-8 text-center"
    >
      <div className="mb-2 text-[15px] font-semibold text-foreground">{title}</div>
      {detail ? <div className="mx-auto max-w-[48ch] text-[13px] leading-relaxed text-muted-foreground">{detail}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </motion.div>
  );
}
