"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, MenuList } from "../pixel";
import { nav } from "../../lib/content";
import styles from "./top-bar.module.css";

/** Phone navigation: a MENU button that opens a pause-menu window; Escape or a pick closes it. */
export function SiteMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current!.querySelector<HTMLElement>('[role="menuitem"]')!.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current!.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current!.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={root} className={styles.menu}>
      <button
        ref={button}
        type="button"
        className={styles.menuButton}
        aria-expanded={open}
        aria-controls="site-menu"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "▼" : "▶"} Menu
      </button>
      {open ? (
        <div id="site-menu" className={styles.popover}>
          <Dialog title="Paused" as="div">
            <MenuList label="Sections" items={nav.map((link) => ({ label: link.label, href: link.href, onSelect: () => setOpen(false) }))} />
          </Dialog>
        </div>
      ) : null}
    </div>
  );
}
