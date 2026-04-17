import { type ReactNode } from "react";

export function Panel({
  title,
  eyebrow,
  children,
  action,
  className = "",
  tone = "plain",
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  tone?: "plain" | "surface";
}) {
  return (
    <section className={`space-y-4 ${className}`}>
      <div className={`flex items-end justify-between gap-4 ${tone === "surface" ? "border-b border-border pb-3" : ""}`}>
        <div>
          {eyebrow ? <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">{eyebrow}</div> : null}
          <h2 className="text-[20px] font-bold tracking-[-0.025em] text-foreground">{title}</h2>
        </div>
        {action}
      </div>
      <div>{children}</div>
    </section>
  );
}
