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
    success: "text-green-600 dark:text-green-400",
    warn: "text-yellow-600 dark:text-yellow-400",
    danger: "text-destructive",
    accent: "text-primary",
  };
  const bgMap = {
    default: "bg-muted",
    success: "bg-green-100 dark:bg-green-900/50",
    warn: "bg-yellow-100 dark:bg-yellow-900/50",
    danger: "bg-red-100 dark:bg-red-900/50",
    accent: "bg-accent",
  };

  const borderMap = {
    default: "border-l-transparent",
    success: "border-l-[color:var(--primary)]",
    warn: "border-l-[color:var(--destructive)]",
    danger: "border-l-[color:var(--destructive)]",
    accent: "border-l-[color:var(--primary)]",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex items-center gap-4 rounded-lg border border-l-[3px] border-border bg-card px-4 py-4 text-left transition duration-150 hover:border-border hover:shadow-sm ${borderMap[tone]}`}
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
