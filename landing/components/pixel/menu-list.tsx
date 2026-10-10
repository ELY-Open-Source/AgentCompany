"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import styles from "./pixel.module.css";

export type MenuItem = { label: ReactNode; href?: string; onSelect?: () => void; hint?: ReactNode };

/** A game menu: one tab stop, arrow keys move the blinking ▶ cursor, Enter picks. */
export function Menu({ items, label, orientation }: {
  items: MenuItem[];
  label: string;
  orientation: "vertical" | "horizontal";
}) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);

  const moveTo = (index: number) => {
    const next = (index + items.length) % items.length;
    setActive(next);
    refs.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const vertical = orientation === "vertical";
    if (event.key === (vertical ? "ArrowDown" : "ArrowRight")) moveTo(active + 1);
    else if (event.key === (vertical ? "ArrowUp" : "ArrowLeft")) moveTo(active - 1);
    else if (event.key === "Home") moveTo(0);
    else if (event.key === "End") moveTo(items.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <ul role="menu" aria-label={label} aria-orientation={orientation} className={styles.menu} data-orientation={orientation} onKeyDown={onKeyDown}>
      {items.map((item, index) => {
        const shared = {
          role: "menuitem",
          tabIndex: index === active ? 0 : -1,
          className: styles.menuItem,
          "data-active": index === active ? "" : undefined,
          ref: (element: HTMLElement | null) => {
            refs.current[index] = element;
          },
          onFocus: () => setActive(index),
          onMouseEnter: () => setActive(index),
          onClick: item.onSelect,
        };
        const body = (
          <>
            <span>{item.label}</span>
            {item.hint ? <span className={styles.menuHint}>{item.hint}</span> : null}
          </>
        );
        return (
          <li role="none" key={index}>
            {item.href ? <a {...shared} href={item.href}>{body}</a> : <button type="button" {...shared}>{body}</button>}
          </li>
        );
      })}
    </ul>
  );
}

export function MenuList({ items, label }: { items: MenuItem[]; label: string }) {
  return <Menu items={items} label={label} orientation="vertical" />;
}
