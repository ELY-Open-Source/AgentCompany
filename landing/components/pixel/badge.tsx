import type { ReactNode } from "react";
import styles from "./pixel.module.css";

export type BadgeTone = "default" | "accent" | "mint" | "danger";

/** A small notched tag, like a status chip on a game card. */
export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: BadgeTone }) {
  return <span className={styles.badge} data-tone={tone}>{children}</span>;
}
