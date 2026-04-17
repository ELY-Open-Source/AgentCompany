import { type ElementType, type ReactNode as ReactNodeType } from "react";

/* ------------------------------------------------------------------ */
/*  Spinner                                                            */
/* ------------------------------------------------------------------ */

export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      style={{ width: size, height: size }}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Eyebrow                                                            */
/* ------------------------------------------------------------------ */

export function Eyebrow({
  children,
  tone = "muted",
  className = "",
}: {
  children: ReactNodeType;
  tone?: "muted" | "primary" | "warning" | "destructive" | "success";
  className?: string;
}) {
  const toneClass =
    tone === "primary"
      ? "text-primary"
      : tone === "warning"
        ? "text-warning"
        : tone === "destructive"
          ? "text-destructive"
          : tone === "success"
            ? "text-success"
            : "text-muted-foreground";
  return (
    <div className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${toneClass} ${className}`}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Card                                                               */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  className = "",
  padded = true,
  as: Tag = "div",
}: {
  children: ReactNodeType;
  className?: string;
  padded?: boolean;
  as?: "div" | "section" | "article";
}) {
  const padding = padded ? "p-4" : "";
  return (
    <Tag className={`rounded-lg border border-border bg-card ${padding} ${className}`}>
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ */
/*  Badge                                                              */
/* ------------------------------------------------------------------ */

export function Badge({ count, tone = "default" }: { count: number; tone?: "default" | "warn" | "danger" }) {
  if (count <= 0) return null;
  const toneClass = tone === "danger" ? "bg-destructive text-primary-foreground" : tone === "warn" ? "bg-warning text-primary-foreground" : "bg-[color:var(--muted-foreground)] text-primary-foreground";
  return (
    <span className={`ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${toneClass}`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  SectionButton                                                      */
/* ------------------------------------------------------------------ */

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
        className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 relative flex w-full items-center justify-center rounded-lg p-2 transition duration-150 ${
          active
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
        onClick={onClick}
      >
        <Icon size={18} weight={active ? "fill" : "regular"} className={active ? "text-primary" : ""} />
        {badge ? (
          <span className={`absolute right-1 top-1 h-[6px] w-[6px] rounded-full ${
            badgeTone === "danger" ? "bg-destructive" : badgeTone === "warn" ? "bg-warning" : "bg-[color:var(--muted-foreground)]"
          }`} />
        ) : null}
      </button>
    );
  }
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 relative flex w-full items-center gap-2.5 rounded-lg px-3 py-[7px] text-left transition duration-150 ${
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
      onClick={onClick}
    >
      <span className={`absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-all duration-200 ${active ? "opacity-100 scale-y-100" : "opacity-0 scale-y-0"}`} aria-hidden="true" />
      <Icon size={17} weight={active ? "fill" : "regular"} className={active ? "text-primary" : ""} />
      <span className={`text-[13px] tracking-[0.005em] ${active ? "font-bold" : "font-medium"}`}>{label}</span>
      {badge ? <Badge count={badge} tone={badgeTone} /> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

import { type ReactNode } from "react";

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
      <div className={`flex items-end justify-between gap-4 ${tone === "surface" ? "border-b border-border pb-3" : ""}`}>
        <div>
          {eyebrow ? <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">{eyebrow}</div> : null}
          <h2 className="text-[20px] font-bold tracking-[-0.025em] text-foreground">{title}</h2>
        </div>
        {action}
      </div>
      <div>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Field                                                              */
/* ------------------------------------------------------------------ */

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/*  Input                                                              */
/* ------------------------------------------------------------------ */

export function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  readOnly = false,
  disabled = false,
  label,
  hint,
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
  hint?: string;
  id?: string;
  ariaLabel?: string;
}) {
  const input = (
    <input
      id={id}
      aria-label={ariaLabel}
      type={type}
      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
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
        <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
          {label}
          {hint ? <span title={hint} className="cursor-help text-[10px] text-muted-foreground/60 hover:text-muted-foreground">(?)</span> : null}
        </div>
        {input}
      </label>
    );
  }
  return input;
}

/* ------------------------------------------------------------------ */
/*  TextArea                                                           */
/* ------------------------------------------------------------------ */

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4,
  label,
  hint,
  readOnly = false,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  label?: string;
  hint?: string;
  readOnly?: boolean;
  disabled?: boolean;
}) {
  const textarea = (
    <textarea
      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full max-w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 break-words"
      style={{ overflowWrap: "anywhere", wordBreak: "break-word", whiteSpace: "pre-wrap" }}
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
        <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
          {label}
          {hint ? <span title={hint} className="cursor-help text-[10px] text-muted-foreground/60 hover:text-muted-foreground">(?)</span> : null}
        </div>
        {textarea}
      </label>
    );
  }
  return textarea;
}

/* ------------------------------------------------------------------ */
/*  Select                                                             */
/* ------------------------------------------------------------------ */

export function Select({
  value,
  onChange,
  options,
  compact = false,
  label,
  hint,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  compact?: boolean;
  label?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const select = (
    <select
      className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full max-w-full border bg-card text-foreground ${
        compact
          ? "rounded-lg border-border px-2.5 py-1.5 text-[13px] font-medium"
          : "rounded-lg border-border px-3.5 py-2.5 text-[14px]"
      } disabled:cursor-not-allowed disabled:opacity-60 truncate`}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-card text-foreground">
          {option.label.length > 80 ? option.label.slice(0, 77) + "..." : option.label}
        </option>
      ))}
    </select>
  );
  if (label) {
    return (
      <label className="block">
        <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
          {label}
          {hint ? <span title={hint} className="cursor-help text-[10px] text-muted-foreground/60 hover:text-muted-foreground">(?)</span> : null}
        </div>
        {select}
      </label>
    );
  }
  return select;
}

/* ------------------------------------------------------------------ */
/*  ActionButton                                                       */
/* ------------------------------------------------------------------ */

export function ActionButton({
  label,
  onClick,
  icon: Icon,
  tone = "default",
  loading = false,
  disabled = false,
  iconOnly = false,
  type = "button",
  ariaLabel,
}: {
  label: string;
  onClick?: () => void;
  icon?: ElementType;
  tone?: "default" | "accent" | "danger";
  loading?: boolean;
  disabled?: boolean;
  iconOnly?: boolean;
  type?: "button" | "submit" | "reset";
  ariaLabel?: string;
}) {
  const isDisabled = loading || disabled;
  const toneClass =
    tone === "accent"
      ? "border-transparent bg-primary text-primary-foreground shadow-[0_1px_3px_rgba(74,93,122,0.35)] hover:bg-primary/90"
      : tone === "danger"
        ? "border-transparent bg-destructive text-primary-foreground shadow-[0_1px_3px_rgba(220,53,69,0.3)] hover:brightness-90"
        : "border-border bg-card text-foreground hover:bg-muted";

  const sizing = iconOnly
    ? "h-10 w-10 p-0 justify-center"
    : "gap-2 px-4 py-2.5";

  return (
    <button
      type={type}
      aria-label={iconOnly ? (ariaLabel ?? label) : ariaLabel}
      title={iconOnly ? label : undefined}
      className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 inline-flex items-center rounded-lg border text-[12px] font-bold transition-all duration-150 active:scale-[0.97] active:translate-y-px ${sizing} ${toneClass} ${isDisabled ? "pointer-events-none opacity-60" : ""} ${loading ? "scale-[0.98]" : ""}`}
      onClick={onClick}
      disabled={isDisabled}
      aria-busy={loading}
    >
      {loading ? (
        <Spinner size={16} />
      ) : Icon ? (
        <Icon size={16} />
      ) : null}
      {iconOnly ? null : <span>{label}</span>}
    </button>
  );
}
