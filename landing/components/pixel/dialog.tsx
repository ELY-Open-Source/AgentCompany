import { useId, type ReactNode } from "react";
import styles from "./pixel.module.css";

export type Tone = "default" | "accent" | "danger";

/** A framed pixel window; a section's title is its heading, worn as a name-plate tab on the top edge. */
export function Dialog({ title, children, tone = "default", as: Tag = "section" }: {
  title?: ReactNode;
  children: ReactNode;
  tone?: Tone;
  as?: "section" | "div";
}) {
  const titleId = useId();
  const Plate = Tag === "section" ? "h2" : "div";
  return (
    <Tag
      className={`${styles.frame} ${styles.dialog}`}
      data-tone={tone}
      data-titled={title ? "" : undefined}
      aria-labelledby={title && Tag === "section" ? titleId : undefined}
    >
      {title ? <Plate id={titleId} className={styles.plate}>{title}</Plate> : null}
      {children}
    </Tag>
  );
}
