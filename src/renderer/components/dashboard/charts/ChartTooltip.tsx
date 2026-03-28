import type { TooltipContentProps } from "recharts";

interface ChartTooltipExtraProps {
  valuePrefix?: string;
  valueSuffix?: string;
}

type Props = Partial<TooltipContentProps<number, string>> & ChartTooltipExtraProps;

export function ChartTooltip({
  active,
  payload,
  label,
  valuePrefix = "",
  valueSuffix = "",
}: Props) {
  if (!active || !payload?.length) return null;

  const dateStr =
    typeof label === "string"
      ? new Date(label + "T00:00:00").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : String(label);

  return (
    <div
      className="rounded-lg border border-border bg-card px-3 py-2 shadow-md"
      style={{ maxWidth: 200, zIndex: 50 }}
    >
      <div className="text-[11px] text-muted-foreground">{dateStr}</div>
      {payload.map((entry, i) => (
        <div key={i} className="mt-1 flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span
            className="text-[13px] font-semibold text-foreground"
            style={{
              fontFamily: "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {valuePrefix}
            {typeof entry.value === "number"
              ? entry.value.toLocaleString()
              : entry.value}
            {valueSuffix}
          </span>
        </div>
      ))}
    </div>
  );
}
