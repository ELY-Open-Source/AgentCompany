import type { ReactNode } from "react";

/**
 * Consistent header for Edit-form sections. Single style (11px uppercase
 * muted) used across Identity / Runtime / Constraints / Skills / Behavior
 * so the form reads as one rhythm instead of a mix of bold banners + bare
 * labels.
 */
export function SectionHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h3>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}
