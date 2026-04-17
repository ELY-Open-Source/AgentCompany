import type { ReactNode } from "react";
import { Eyebrow } from "./ui";

/**
 * Two-slot workspace layout with a section header.
 * Use `Panel` for single-slot sections; use this when rendering a primary + secondary pane.
 */
export function EntityWorkspace({
  title,
  eyebrow,
  primary,
  secondary,
}: {
  title: string;
  eyebrow?: string;
  primary: ReactNode;
  secondary: ReactNode;
}) {
  return (
    <div className="space-y-14">
      <div>
        {eyebrow ? <Eyebrow className="mb-1">{eyebrow}</Eyebrow> : null}
        <h2 className="text-[20px] font-bold tracking-[-0.025em] text-foreground">{title}</h2>
      </div>
      <div className="space-y-14">{primary}{secondary}</div>
    </div>
  );
}
