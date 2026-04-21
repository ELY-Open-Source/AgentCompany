import type { ReactNode } from "react";
import { Eyebrow } from "./ui";

/**
 * Two-pane layout with an optional section header.
 * - `split="vertical"` (default): stacks primary over secondary with rhythmic whitespace.
 * - `split="horizontal"`: primary (register) on the left, secondary (focus) on the right.
 *   Use horizontal when the two panes share a single focus — selecting a row on the
 *   left updates the inspector on the right, and the page should present one idea.
 *
 * `action` docks a single control (e.g. a primary "+ Add" button) to the right of the
 * header row. When a title/eyebrow is present the action sits on the header's baseline;
 * when the header is absent, the action sits in its own right-aligned row above the body.
 * Keep it to one element — this slot exists so the control has a home, not a stage.
 *
 * Use `Panel` (from ui/) for single-slot sections. Use this when rendering a primary + secondary pane.
 */
export function TwoPaneLayout({
  title,
  eyebrow,
  primary,
  secondary,
  split = "vertical",
  action,
}: {
  title?: string;
  eyebrow?: string;
  primary: ReactNode;
  secondary: ReactNode;
  split?: "vertical" | "horizontal";
  action?: ReactNode;
}) {
  const hasHeader = Boolean(title || eyebrow);
  const body =
    split === "horizontal" ? (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] lg:items-start">
        <div className="min-w-0">{primary}</div>
        <div className="min-w-0">{secondary}</div>
      </div>
    ) : (
      <div className="space-y-14">{primary}{secondary}</div>
    );
  return (
    <div className="space-y-14">
      {hasHeader ? (
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            {eyebrow ? <Eyebrow className="mb-1">{eyebrow}</Eyebrow> : null}
            {title ? <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">{title}</h2> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : action ? (
        <div className="flex justify-end">{action}</div>
      ) : null}
      {body}
    </div>
  );
}
