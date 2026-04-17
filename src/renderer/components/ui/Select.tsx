import { CaretDown } from "./icons";

/**
 * Native <select> + explicit caret icon. We render our own CaretDown so
 * the affordance is consistent across platforms (macOS shows dual-arrow,
 * Windows/Linux a single caret of varying contrast) and visible against
 * dark themes. `appearance: none` collapses the native chrome so the
 * caret we render is the only visual indicator; padding-right reserves
 * space for it so long option labels don't overlap.
 */
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
    <div className="relative">
      <select
        className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full max-w-full appearance-none border bg-card text-foreground ${
          compact
            ? "rounded-lg border-border pl-2.5 pr-7 py-1.5 text-[13px] font-medium"
            : "rounded-lg border-border pl-3.5 pr-9 py-2.5 text-[14px]"
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
      <CaretDown
        size={compact ? 12 : 14}
        weight="bold"
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground ${compact ? "right-2" : "right-3"} ${disabled ? "opacity-40" : ""}`}
        aria-hidden="true"
      />
    </div>
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
