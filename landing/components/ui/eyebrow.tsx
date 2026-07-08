import type { ReactNode } from "react";

/** Small-caps mono label used above section headings. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`eyebrow inline-flex items-center gap-1.5 text-sm text-[var(--muted)] ${className}`}>
      {children}
    </span>
  );
}
