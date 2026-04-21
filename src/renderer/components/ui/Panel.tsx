import { type ReactNode } from "react";

export function Panel({
  title,
  eyebrow,
  children,
  action,
  className = "",
  tone = "plain",
}: {
  title?: string;
  eyebrow?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  tone?: "plain" | "surface";
}) {
  const hasHeader = Boolean(title || eyebrow || action);
  return (
    <section className={`space-y-4 ${className}`}>
      {hasHeader ? (
        <div className={`flex items-end justify-between gap-4 ${tone === "surface" ? "border-b border-border pb-3" : ""}`}>
          <div>
            {eyebrow ? <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">{eyebrow}</div> : null}
            {title ? <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">{title}</h2> : null}
          </div>
          {action}
        </div>
      ) : null}
      <div>{children}</div>
    </section>
  );
}
