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
    default: "text-foreground",
    success: "text-success",
    warn: "text-warning",
    danger: "text-destructive",
    accent: "text-primary",
  };
  const bgMap = {
    default: "bg-muted",
    success: "bg-success-muted",
    warn: "bg-warning-muted",
    danger: "bg-destructive-muted",
    accent: "bg-accent",
  };

  const borderMap = {
    default: "border-l-transparent",
    success: "border-l-[color:var(--success)]",
    warn: "border-l-[color:var(--warning)]",
    danger: "border-l-[color:var(--destructive)]",
    accent: "border-l-[color:var(--primary)]",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex items-center gap-4 rounded-lg border border-l-[3px] border-border bg-card px-4 py-4 text-left transition duration-200 hover:shadow-md hover:-translate-y-0.5 ${borderMap[tone]}`}
    >
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${bgMap[tone]}`}>
        <Icon size={24} weight="fill" className={toneMap[tone]} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
        <div className={`text-[28px] font-bold tracking-[-0.02em] leading-none ${toneMap[tone]}`} style={{ fontVariantNumeric: "tabular-nums" }}>{value}</div>
        {subtitle ? <div className="mt-1.5 truncate text-[11px] font-medium text-muted-foreground">{subtitle}</div> : null}
      </div>
    </button>
  );
}
