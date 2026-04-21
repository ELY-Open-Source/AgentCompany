import type React from "react";
import { Eyebrow } from "../ui";

export function MetricCard({
  label,
  value,
  icon: Icon,
  onClick,
  subtitle,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  onClick?: () => void;
  subtitle?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-4 text-left transition duration-200 hover:bg-muted/40"
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent">
        <Icon size={24} weight="fill" className="text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <Eyebrow>{label}</Eyebrow>
        <div className="text-[28px] font-semibold tracking-[-0.02em] leading-none text-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>{value}</div>
        {subtitle ? <div className="mt-1.5 truncate text-[11px] font-medium text-muted-foreground">{subtitle}</div> : null}
      </div>
    </button>
  );
}
