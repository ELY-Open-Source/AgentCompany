import type { ReactNode } from "react";

/** Rounded meadow pill, optionally a link. */
export function Badge({
  children,
  href,
  className = "",
}: {
  children: ReactNode;
  href?: string;
  className?: string;
}) {
  const classes = `eyebrow inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1.5 text-sm bg-[var(--accent-soft)] text-[var(--accent)] transition-colors ${className}`;

  if (href) {
    return (
      <a href={href} className={classes}>
        {children}
      </a>
    );
  }

  return <span className={classes}>{children}</span>;
}
