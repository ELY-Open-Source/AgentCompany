import { type ElementType } from "react";
import { Spinner } from "./Spinner";

export function ActionButton({
  label,
  onClick,
  icon: Icon,
  tone = "default",
  loading = false,
  disabled = false,
  iconOnly = false,
  type = "button",
  ariaLabel,
}: {
  label: string;
  onClick?: () => void;
  icon?: ElementType;
  tone?: "default" | "accent" | "danger";
  loading?: boolean;
  disabled?: boolean;
  iconOnly?: boolean;
  type?: "button" | "submit" | "reset";
  ariaLabel?: string;
}) {
  const isDisabled = loading || disabled;
  const toneClass =
    tone === "accent"
      ? "border-transparent bg-primary text-primary-foreground shadow-[0_1px_3px_rgba(74,93,122,0.35)] hover:bg-primary/90"
      : tone === "danger"
        ? "border-transparent bg-destructive text-primary-foreground shadow-[0_1px_3px_rgba(220,53,69,0.3)] hover:brightness-90"
        : "border-border bg-card text-foreground hover:bg-muted";

  const sizing = iconOnly
    ? "h-10 w-10 p-0 justify-center"
    : "gap-2 px-4 py-2.5";

  return (
    <button
      type={type}
      aria-label={iconOnly ? (ariaLabel ?? label) : ariaLabel}
      title={iconOnly ? label : undefined}
      className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 inline-flex shrink-0 items-center whitespace-nowrap rounded-lg border text-[12px] font-bold transition-all duration-150 active:scale-[0.97] active:translate-y-px ${sizing} ${toneClass} ${isDisabled ? "pointer-events-none opacity-60" : ""} ${loading ? "scale-[0.98]" : ""}`}
      onClick={onClick}
      disabled={isDisabled}
      aria-busy={loading}
    >
      {loading ? (
        <Spinner size={16} />
      ) : Icon ? (
        <Icon size={16} />
      ) : null}
      {iconOnly ? null : <span className="whitespace-nowrap">{label}</span>}
    </button>
  );
}
