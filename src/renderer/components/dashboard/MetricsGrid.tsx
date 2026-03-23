import type React from "react";

export function MetricCard({
  label,
  value,
  icon: Icon,
  tone = "default",
  onClick,
  subtitle,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  tone?: "default" | "success" | "warn" | "danger" | "accent";
  onClick?: () => void;
  subtitle?: string;
}) {
  const toneMap = {
    default: "text-[color:var(--text)]",
    success: "text-[color:var(--success)]",
    warn: "text-[color:var(--warn)]",
    danger: "text-[color:var(--danger)]",
    accent: "text-[color:var(--accent)]",
  };
  const bgMap = {
    default: "bg-[color:var(--panel-soft)]",
    success: "bg-[color:var(--success-soft)]",
    warn: "bg-[color:var(--warn-soft)]",
    danger: "bg-[color:var(--danger-soft)]",
    accent: "bg-[color:var(--accent-soft)]",
  };

  const borderMap = {
    default: "border-l-transparent",
    success: "border-l-[color:var(--success)]",
    warn: "border-l-[color:var(--warn)]",
    danger: "border-l-[color:var(--danger)]",
    accent: "border-l-[color:var(--accent)]",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-ring flex items-center gap-4 rounded-[8px] border border-l-[3px] border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-4 text-left transition duration-150 hover:border-[color:var(--line-strong)] hover:shadow-sm ${borderMap[tone]}`}
    >
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] ${bgMap[tone]}`}>
        <Icon size={24} weight="fill" className={toneMap[tone]} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{label}</div>
        <div className={`text-[28px] font-bold tracking-[-0.02em] leading-none ${toneMap[tone]}`} style={{ fontVariantNumeric: "tabular-nums" }}>{value}</div>
        {subtitle ? <div className="mt-1.5 truncate text-[11px] font-medium text-[color:var(--muted)]">{subtitle}</div> : null}
      </div>
    </button>
  );
}
