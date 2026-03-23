import { Component, useEffect, useRef, type ElementType, type ErrorInfo, type ReactNode } from "react";

export function Badge({ count, tone = "default" }: { count: number; tone?: "default" | "warn" | "danger" }) {
  if (count <= 0) return null;
  const toneClass = tone === "danger" ? "bg-[color:var(--danger)] text-[color:var(--text-on-accent)]" : tone === "warn" ? "bg-[color:var(--warn)] text-[color:var(--text-on-accent)]" : "bg-[color:var(--muted)] text-[color:var(--text-on-accent)]";
  return (
    <span className={`ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${toneClass}`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function SectionButton({
  active,
  label,
  icon: Icon,
  onClick,
  badge,
  badgeTone,
  collapsed = false,
}: {
  active: boolean;
  label: string;
  icon: ElementType;
  onClick: () => void;
  badge?: number;
  badgeTone?: "default" | "warn" | "danger";
  collapsed?: boolean;
}) {
  if (collapsed) {
    return (
      <button
        aria-current={active ? "page" : undefined}
        aria-label={label}
        title={label}
        className={`focus-ring relative flex w-full items-center justify-center rounded-[6px] p-2 transition duration-150 ${
          active
            ? "bg-[color:var(--panel-soft)] text-[color:var(--text)]"
            : "text-[color:var(--muted-strong)] hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"
        }`}
        onClick={onClick}
      >
        <Icon size={18} weight={active ? "fill" : "regular"} className={active ? "text-[color:var(--accent)]" : ""} />
        {badge ? (
          <span className={`absolute right-1 top-1 h-[6px] w-[6px] rounded-full ${
            badgeTone === "danger" ? "bg-[color:var(--danger)]" : badgeTone === "warn" ? "bg-[color:var(--warn)]" : "bg-[color:var(--muted)]"
          }`} />
        ) : null}
      </button>
    );
  }
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={`focus-ring relative flex w-full items-center gap-2.5 rounded-[6px] px-3 py-[7px] text-left transition duration-150 ${
        active
          ? "bg-[color:var(--accent-soft)] text-[color:var(--text)]"
          : "text-[color:var(--muted-strong)] hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"
      }`}
      onClick={onClick}
    >
      {active ? <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-[color:var(--accent)]" aria-hidden="true" /> : null}
      <Icon size={17} weight={active ? "fill" : "regular"} className={active ? "text-[color:var(--accent)]" : ""} />
      <span className={`text-[13px] tracking-[0.005em] ${active ? "font-bold" : "font-medium"}`}>{label}</span>
      {badge ? <Badge count={badge} tone={badgeTone} /> : null}
    </button>
  );
}

export function Panel({
  title,
  eyebrow,
  children,
  action,
  className = "",
  tone = "plain",
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  tone?: "plain" | "surface";
}) {
  return (
    <section className={`space-y-4 ${className}`}>
      <div className={`flex items-end justify-between gap-4 ${tone === "surface" ? "border-b border-[color:var(--line)] pb-3" : ""}`}>
        <div>
          {eyebrow ? <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--accent-text)]">{eyebrow}</div> : null}
          <h2 className="text-[20px] font-bold tracking-[-0.025em] text-[color:var(--text)]">{title}</h2>
        </div>
        {action}
      </div>
      <div>{children}</div>
    </section>
  );
}

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

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--text)]/45" onClick={onClose}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex w-full flex-col rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] shadow-xl"
        style={{ maxWidth: width, maxHeight: "80vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--line)] px-5 py-3.5">
          <h2 className="text-[16px] font-bold tracking-[-0.015em] text-[color:var(--text)]">{title}</h2>
          <button
            type="button"
            className="focus-ring rounded-[6px] p-1 text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[12px] font-medium text-[color:var(--muted-strong)]">{label}</div>
      {children}
    </label>
  );
}

export function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  readOnly = false,
  disabled = false,
  label,
  id,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  readOnly?: boolean;
  disabled?: boolean;
  label?: string;
  id?: string;
  ariaLabel?: string;
}) {
  const input = (
    <input
      id={id}
      aria-label={ariaLabel}
      type={type}
      className="focus-ring w-full rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-3.5 py-2.5 text-[14px] text-[color:var(--text)] placeholder:text-[color:var(--muted)] disabled:cursor-not-allowed disabled:opacity-60"
      value={value}
      placeholder={placeholder}
      readOnly={readOnly}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
  if (label) {
    return (
      <label className="block">
        <div className="mb-1.5 text-[12px] font-medium text-[color:var(--muted-strong)]">{label}</div>
        {input}
      </label>
    );
  }
  return input;
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4,
  label,
  readOnly = false,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  label?: string;
  readOnly?: boolean;
  disabled?: boolean;
}) {
  const textarea = (
    <textarea
      className="focus-ring w-full rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-3.5 py-2.5 text-[14px] text-[color:var(--text)] placeholder:text-[color:var(--muted)] disabled:cursor-not-allowed disabled:opacity-60"
      value={value}
      rows={rows}
      placeholder={placeholder}
      readOnly={readOnly}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
  if (label) {
    return (
      <label className="block">
        <div className="mb-1.5 text-[12px] font-medium text-[color:var(--muted-strong)]">{label}</div>
        {textarea}
      </label>
    );
  }
  return textarea;
}

export function Select({
  value,
  onChange,
  options,
  compact = false,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  compact?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  const select = (
    <select
      className={`focus-ring w-full border bg-[color:var(--panel)] text-[color:var(--text)] ${
        compact
          ? "rounded-[6px] border-[color:var(--line)] px-2.5 py-1.5 text-[13px] font-medium"
          : "rounded-[8px] border-[color:var(--line)] px-3.5 py-2.5 text-[14px]"
      } disabled:cursor-not-allowed disabled:opacity-60`}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-[color:var(--panel)] text-[color:var(--text)]">
          {option.label}
        </option>
      ))}
    </select>
  );
  if (label) {
    return (
      <label className="block">
        <div className="mb-1.5 text-[12px] font-medium text-[color:var(--muted-strong)]">{label}</div>
        {select}
      </label>
    );
  }
  return select;
}

export function ActionButton({
  label,
  onClick,
  icon: Icon,
  tone = "default",
  loading = false,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  icon?: ElementType;
  tone?: "default" | "accent" | "danger";
  loading?: boolean;
  disabled?: boolean;
}) {
  const isDisabled = loading || disabled;
  const toneClass =
    tone === "accent"
      ? "border-transparent bg-[color:var(--accent)] text-[color:var(--text-on-accent)] shadow-[0_1px_3px_rgba(74,93,122,0.35)] hover:bg-[color:var(--accent-hover)]"
      : tone === "danger"
        ? "border-transparent bg-[color:var(--danger)] text-[color:var(--text-on-accent)] shadow-[0_1px_3px_rgba(220,53,69,0.3)] hover:brightness-90"
        : "border-[color:var(--line)] bg-[color:var(--panel)] text-[color:var(--text)] hover:bg-[color:var(--panel-soft)]";

  return (
    <button
      className={`focus-ring inline-flex items-center gap-2 rounded-[8px] border px-4 py-2.5 text-[12px] font-bold transition duration-150 active:translate-y-px ${toneClass} ${isDisabled ? "pointer-events-none opacity-60" : ""} ${loading ? "scale-[0.98]" : ""}`}
      onClick={onClick}
      disabled={isDisabled}
      aria-busy={loading}
    >
      {loading ? (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3" />
          <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : Icon ? (
        <Icon size={16} />
      ) : null}
      <span>{label}</span>
    </button>
  );
}

export function StatusPill({ status }: { status: string }) {
  const positive = ["ready", "active", "running", "succeeded", "approved", "achieved", "done"].includes(status);
  const negative = ["error", "failed", "cancelled", "blocked", "rejected", "interrupted"].includes(status);
  const warning = ["auth_required", "degraded", "pending", "in_review", "todo", "queued", "not_installed"].includes(status);
  const checking = status === "detected";
  const toneClass = positive
    ? "text-[color:var(--success)]"
    : negative
      ? "text-[color:var(--danger)]"
      : warning
        ? "text-[color:var(--warn)]"
        : "text-[color:var(--muted-strong)]";
  const dotClass = positive
    ? "bg-[color:var(--success)]"
    : negative
      ? "bg-[color:var(--danger)]"
      : warning
        ? "bg-[color:var(--warn)]"
        : "bg-[color:var(--muted)]";

  const displayLabel = checking ? "checking" : status.replaceAll("_", " ");

  return (
    <span className={`inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] ${toneClass}`}>
      {checking ? (
        <span className="h-2 w-2 animate-pulse rounded-full bg-[color:var(--muted)]" aria-hidden="true" />
      ) : (
        <span className={`h-2 w-2 rounded-full ${dotClass}`} aria-hidden="true" />
      )}
      {displayLabel}
    </span>
  );
}

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
    ? "border-[color:var(--success)] bg-[color:var(--success-soft)] text-[color:var(--success)]"
    : tone === "warn"
      ? "border-[color:var(--warn)] bg-[color:var(--warn-soft)] text-[color:var(--warn)]"
      : "border-[color:var(--danger)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]";
  return (
    <div className={`rounded-[8px] border px-4 py-3 text-[13px] ${toneClass}`} role={tone === "danger" ? "alert" : "status"}>
      {action ? (
        <div className="flex items-start justify-between gap-3">
          <span>{message}</span>
          {action}
        </div>
      ) : message}
    </div>
  );
}

export function ConfirmDialog({ open, title, message, errorMessage, onConfirm, onCancel }: {
  open: boolean;
  title: string;
  message: string;
  errorMessage?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
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

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--text)]/45" onClick={onCancel}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-[400px] rounded-[8px] bg-[color:var(--panel)] border border-[color:var(--line)] p-6 shadow-lg"
        onClick={e => e.stopPropagation()}
      >
        <div id="confirm-dialog-title" className="text-[16px] font-semibold text-[color:var(--text)] mb-2">{title}</div>
        <div className="text-[13px] text-[color:var(--muted)] mb-6">{message}</div>
        {errorMessage ? <div className="mb-4"><InlineNotice message={errorMessage} /></div> : null}
        <div className="flex gap-3 justify-end">
          <ActionButton label="Cancel" onClick={onCancel} />
          <ActionButton label="Confirm" tone="danger" onClick={onConfirm} />
        </div>
      </div>
    </div>
  );
}

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
    <div className="px-1 py-8 text-center">
      <div className="mb-2 text-[15px] font-semibold text-[color:var(--text)]">{title}</div>
      {detail ? <div className="mx-auto max-w-[48ch] text-[13px] leading-relaxed text-[color:var(--muted)]">{detail}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ListFrame({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`border-y border-[color:var(--line)] ${className}`}>{children}</div>;
}

export function ListRow({
  children,
  className = "",
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <button
        type="button"
        className={`focus-ring block w-full border-b border-[color:var(--line)] px-5 py-4 text-left last:border-b-0 ${className}`}
        onClick={onClick}
      >
        {children}
      </button>
    );
  }
  return <div className={`border-b border-[color:var(--line)] px-5 py-4 last:border-b-0 ${className}`}>{children}</div>;
}

export function useFocusTrap(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !ref.current) return;

    const container = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const focusableNow = container.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusableNow.length === 0) return;

      const first = focusableNow[0];
      const last = focusableNow[focusableNow.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    container.addEventListener("keydown", handleKeyDown);
    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [active]);

  return ref;
}

export function useReducedMotion() {
  const query = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  // Return static value — Electron doesn't change this mid-session
  return query?.matches ?? false;
}

export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="p-8 text-center" role="alert">
          <div className="text-[15px] font-semibold text-[color:var(--danger)] mb-2">Something went wrong</div>
          <ActionButton label="Reload page" onClick={() => window.location.reload()} />
        </div>
      );
    }
    return this.props.children;
  }
}
