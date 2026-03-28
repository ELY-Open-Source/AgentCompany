import type { ReactNode } from "react";

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
        {eyebrow ? <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{eyebrow}</div> : null}
        <h2 className={`${eyebrow ? "mt-2" : ""} text-[18px] font-semibold tracking-[-0.01em] text-foreground`}>{title}</h2>
      </div>
      <div className="space-y-14">{primary}{secondary}</div>
    </div>
  );
}
