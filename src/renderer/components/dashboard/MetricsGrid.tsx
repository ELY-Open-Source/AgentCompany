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

  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring flex items-center gap-3.5 rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3.5 text-left transition duration-150 hover:border-[color:var(--line-strong)] hover:shadow-sm"
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] ${bgMap[tone]}`}>
        <Icon size={20} weight="fill" className={toneMap[tone]} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-[color:var(--muted)]">{label}</div>
        <div className={`text-[20px] font-bold tracking-[-0.02em] leading-tight ${toneMap[tone]}`}>{value}</div>
        {subtitle ? <div className="mt-0.5 truncate text-[11px] text-[color:var(--muted)]">{subtitle}</div> : null}
      </div>
    </button>
  );
}
