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
