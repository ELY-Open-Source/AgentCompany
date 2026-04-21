import type { TooltipContentProps } from "recharts";

export type ChartTooltipLabelMode = "date" | "plain";

interface ChartTooltipExtraProps {
  valuePrefix?: string;
  valueSuffix?: string;
  /**
   * How to interpret the raw `label` coming from recharts.
   * - "date" (default): parse `YYYY-MM-DD` strings into "Mon DD, YYYY".
   * - "plain": pass through the raw label as-is (category axes, names, etc.).
   * `labelFormatter`, if provided, still wins over both modes.
   */
  labelMode?: ChartTooltipLabelMode;
  labelFormatter?: (label: string | number | undefined) => string;
}

type Props = Partial<TooltipContentProps<number, string>> & ChartTooltipExtraProps;

/** Pure helper: format a raw label as a localized date, or return it unchanged on failure. */
export function formatDateLabel(label: string | number | undefined): string {
  if (typeof label !== "string") return String(label);
  const parsed = new Date(label + "T00:00:00");
  if (Number.isNaN(parsed.getTime())) return label;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Pure helper: pass-through formatter for category / name labels. */
export function formatPlainLabel(label: string | number | undefined): string {
  if (label === undefined || label === null) return "";
  return String(label);
}

/** Pure helper: decide whether the label row should render at all. */
export function shouldRenderLabel(label: string | number | undefined): boolean {
  if (label === undefined || label === null) return false;
  if (typeof label === "string" && label.length === 0) return false;
  return true;
}

function pickDefaultFormatter(mode: ChartTooltipLabelMode) {
  return mode === "plain" ? formatPlainLabel : formatDateLabel;
}

export function ChartTooltip({
  active,
  payload,
  label,
  valuePrefix = "",
  valueSuffix = "",
  labelMode = "date",
  labelFormatter,
}: Props) {
  if (!active || !payload?.length) return null;

  const renderLabel = shouldRenderLabel(label);
  const formatLabel = labelFormatter ?? pickDefaultFormatter(labelMode);
  const labelText = renderLabel ? formatLabel(label) : "";

  return (
    <div
      className="rounded-lg border border-border bg-card px-3 py-2 shadow-md"
      style={{ maxWidth: 200, zIndex: 50 }}
    >
      {renderLabel && labelText ? (
        <div className="text-[11px] text-muted-foreground">{labelText}</div>
      ) : null}
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
