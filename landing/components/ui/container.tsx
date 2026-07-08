import type { ReactNode } from "react";

/** Page-width wrapper: 1280px max, adaline grid margins (16px → 48px). */
export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1280px] px-4 md:px-12 ${className}`}>{children}</div>;
}
