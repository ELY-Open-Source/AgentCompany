import { type ReactNode } from "react";

export function Eyebrow({
  children,
  tone = "muted",
  className = "",
}: {
  children: ReactNode;
  tone?: "muted" | "primary" | "warning" | "destructive" | "success";
  className?: string;
}) {
  const toneClass =
    tone === "primary"
      ? "text-primary"
      : tone === "warning"
        ? "text-warning"
        : tone === "destructive"
          ? "text-destructive"
          : tone === "success"
            ? "text-success"
            : "text-muted-foreground";
  return (
    <div className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${toneClass} ${className}`}>
      {children}
    </div>
  );
}
