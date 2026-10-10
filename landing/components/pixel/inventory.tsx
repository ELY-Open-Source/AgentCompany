"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "./icon";
import styles from "./pixel.module.css";

export type InventoryItem = { icon: IconName; name: string; description: ReactNode };

/** An RPG item menu: a grid of slots, arrow keys move the selection, the box below describes the chosen item. */
export function Inventory({ items }: { items: InventoryItem[] }) {
  const [selected, setSelected] = useState(0);
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const infoId = useId();
  const item = items[selected]!;

  const select = (index: number) => {
    const next = Math.max(0, Math.min(items.length - 1, index));
    setSelected(next);
    refs.current[next]?.focus();
  };

  const columns = () => {
    const tops = refs.current.map((slot) => slot?.offsetTop);
    return tops.filter((top) => top === tops[0]).length;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight") select(selected + 1);
    else if (event.key === "ArrowLeft") select(selected - 1);
    else if (event.key === "ArrowDown") select(selected + columns());
    else if (event.key === "ArrowUp") select(selected - columns());
    else if (event.key === "Home") select(0);
    else if (event.key === "End") select(items.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div className={styles.inventory}>
      <ul role="listbox" aria-label="Inventory" className={styles.slots} onKeyDown={onKeyDown}>
        {items.map((entry, index) => (
          <li
            key={entry.name}
            ref={(slot) => {
              refs.current[index] = slot;
            }}
            role="option"
            aria-selected={index === selected}
            aria-describedby={index === selected ? infoId : undefined}
            tabIndex={index === selected ? 0 : -1}
            className={styles.slot}
            onClick={() => select(index)}
            onFocus={() => setSelected(index)}
          >
            <Icon name={entry.icon} size={3} />
            <span className={styles.visuallyHidden}>{entry.name}</span>
          </li>
        ))}
      </ul>
      <div id={infoId} className={`${styles.frame} ${styles.itemInfo}`} aria-live="polite">
        <p className={styles.itemName}>
          <Icon name={item.icon} />
          {item.name}
        </p>
        <p>{item.description}</p>
      </div>
    </div>
  );
}
