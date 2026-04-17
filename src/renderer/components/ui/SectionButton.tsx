import { type ElementType } from "react";
import { Badge } from "./Badge";

export function SectionButton({
  active,
  label,
  icon: Icon,
  onClick,
  badge,
  badgeTone,
  collapsed = false,
}: {
  active: boolean;
  label: string;
  icon: ElementType;
  onClick: () => void;
  badge?: number;
  badgeTone?: "default" | "warn" | "danger";
  collapsed?: boolean;
}) {
  if (collapsed) {
    return (
      <button
        aria-current={active ? "page" : undefined}
        aria-label={label}
        title={label}
        className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 relative flex w-full items-center justify-center rounded-lg p-2 transition duration-150 ${
          active
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
        onClick={onClick}
      >
        <Icon size={18} weight={active ? "fill" : "regular"} className={active ? "text-primary" : ""} />
        {badge ? (
          <span className={`absolute right-1 top-1 h-[6px] w-[6px] rounded-full ${
            badgeTone === "danger" ? "bg-destructive" : badgeTone === "warn" ? "bg-warning" : "bg-[color:var(--muted-foreground)]"
          }`} />
        ) : null}
      </button>
    );
  }
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 relative flex w-full items-center gap-2.5 rounded-lg px-3 py-[7px] text-left transition duration-150 ${
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
      onClick={onClick}
    >
      <span className={`absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-all duration-200 ${active ? "opacity-100 scale-y-100" : "opacity-0 scale-y-0"}`} aria-hidden="true" />
      <Icon size={17} weight={active ? "fill" : "regular"} className={active ? "text-primary" : ""} />
      <span className={`text-[13px] tracking-[0.005em] ${active ? "font-bold" : "font-medium"}`}>{label}</span>
      {badge ? <Badge count={badge} tone={badgeTone} /> : null}
    </button>
  );
}
