import type { ReactNode } from "react";

type ButtonVariant = "primary" | "ghost";
type ButtonSize = "md" | "sm";

const base =
  "eyebrow inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[20px] text-sm transition-colors";

const sizeClasses: Record<ButtonSize, string> = {
  md: "h-11 px-6",
  sm: "h-9 px-4",
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-[var(--cta)] text-[var(--text-on-cta)] hover:bg-[var(--cta-hover)]",
  ghost: "border border-[var(--border-strong)] text-[var(--text-secondary)] hover:border-[var(--muted)]",
};

/** Link-styled call to action. Every landing CTA is an anchor. */
export function Button({
  children,
  href,
  variant = "primary",
  size = "md",
  external = false,
  className = "",
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  external?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`${base} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
    >
      {children}
    </a>
  );
}
