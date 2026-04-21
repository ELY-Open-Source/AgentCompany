import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useFocusTrap } from "./hooks";

const EASE = [0.16, 1, 0.3, 1] as const;

/* ------------------------------------------------------------------ */
/*  Modal                                                              */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  title,
  onClose,
  children,
  width = "640px",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  const trapRef = useFocusTrap(open);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: EASE }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--foreground)]/45"
          onClick={onClose}
        >
          <motion.div
            ref={trapRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ scale: 0.96, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 8 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="flex w-full flex-col rounded-lg border border-border bg-card shadow-xl"
            style={{ maxWidth: width, maxHeight: "85vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5">
              <h2 className="min-w-0 truncate text-[16px] font-bold tracking-[-0.015em] text-foreground">{title}</h2>
              <button
                type="button"
                className="ml-3 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                aria-label="Close"
              >
                <svg width="16" height="16" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </button>
            </div>
            <div className="min-h-0 min-w-0 overflow-y-auto overflow-x-auto px-5 py-4" style={{ overflowWrap: "break-word", wordBreak: "break-word" }}>{children}</div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/*  ListFrame                                                          */
/* ------------------------------------------------------------------ */

export function ListFrame({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`border-y border-border ${className}`}>{children}</div>;
}

/* ------------------------------------------------------------------ */
/*  ListRow                                                            */
/* ------------------------------------------------------------------ */

export function ListRow({
  children,
  className = "",
  onClick,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  /**
   * Optional accessible name for the row. Required whenever the row's visible
   * children don't already include readable text (e.g. icon-only or graphic
   * rows). Omit when children already provide a textual label.
   */
  ariaLabel?: string;
}) {
  if (onClick) {
    // Use role="button" on a div (instead of a native <button>) so callers can
    // nest real <button> elements inside for per-action controls (edit, delete,
    // status pills). Nested <button> inside <button> is invalid HTML.
    //
    // `has-[[data-row-action]:hover]:bg-transparent` suppresses the row's
    // hover bg when the pointer is actually over an inner action cluster
    // (marked with `data-row-action`). This way hover tells the user where
    // the click lands: on the row, or on the action — never both at once.
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        className={`block w-full cursor-pointer border-b border-border px-5 py-4 text-left transition-colors last:border-b-0 hover:bg-muted/50 has-[[data-row-action]:hover]:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${className}`}
        onClick={onClick}
        onKeyDown={(event) => {
          // Only handle keys that originated on the row itself. Without this
          // guard, Space/Enter dispatched from a nested <button> (e.g. an
          // action pill) would bubble up, get preventDefault'd, and trigger
          // the row's onClick — swallowing the inner button's own activation.
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onClick();
          }
        }}
      >
        {children}
      </div>
    );
  }
  return <div className={`border-b border-border px-5 py-4 last:border-b-0 ${className}`}>{children}</div>;
}
