import { useEffect, useRef, useState, type ReactNode } from "react";

/** Anchored popover used for filter and overflow menus. Closes on outside
 * click or Escape so triggers across the app stay functional and consistent. */
export function Popover({
  align = "end",
  trigger,
  children,
}: {
  align?: "start" | "end";
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="popover-anchor" ref={anchorRef}>
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {open && (
        <div className={`popover-panel ${align}`.trim()} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu-label">{children}</div>;
}

export function MenuRow({
  active = false,
  danger = false,
  onClick,
  children,
}: {
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-current={active ? "true" : undefined}
      className={`menu-row ${active ? "active" : ""} ${danger ? "danger" : ""}`.replace(/\s+/g, " ").trim()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function MenuDivider() {
  return <div className="menu-divider" />;
}
