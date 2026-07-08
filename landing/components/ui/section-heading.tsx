import type { ReactNode } from "react";
import { Eyebrow } from "./eyebrow";

/** Eyebrow + heading + subhead block shared by every section. */
export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  className = "",
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  const alignment =
    align === "center" ? "items-center text-center mx-auto" : "items-start text-left";

  return (
    <div className={`flex max-w-[68ch] flex-col gap-3 md:gap-4 ${alignment} ${className}`}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className="text-balance text-[30px] font-medium leading-[1.12] tracking-[-0.02em] text-[var(--text)] md:text-[34px]">
        {title}
      </h2>
      {description ? (
        <p className="max-w-[62ch] text-pretty text-lg leading-relaxed text-[var(--muted)]">{description}</p>
      ) : null}
    </div>
  );
}
