import type { MouseEventHandler, ReactNode } from "react";
import { Icon, type IconName } from "./icon";
import styles from "./pixel.module.css";

/** A chunky button that sinks into its base when pressed; with href it is a link that looks the part. */
export function PixelButton({ children, href, onClick, variant = "primary", icon }: {
  children: ReactNode;
  href?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  variant?: "primary" | "ghost";
  icon?: IconName;
}) {
  const content = (
    <>
      {icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </>
  );
  if (href) {
    return <a className={styles.button} data-variant={variant} href={href} onClick={onClick}>{content}</a>;
  }
  return <button type="button" className={styles.button} data-variant={variant} onClick={onClick}>{content}</button>;
}
