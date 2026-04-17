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
