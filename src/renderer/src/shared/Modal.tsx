import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** Open modals, innermost last; everything outside the innermost one is inert. */
const stack: HTMLElement[] = [];

function syncInert(): void {
  const root = document.getElementById("root");
  const top = stack[stack.length - 1] ?? null;
  if (root) root.inert = top !== null;
  for (const layer of stack) layer.inert = layer !== top;
}

function focusables(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.offsetParent !== null || element === document.activeElement);
}

/** A modal layer above an inert app: focus starts and stays inside, Escape asks it to close, focus returns on close. */
export function Modal({ label, onEscape, onBackdrop, role = "dialog", backdropStyle, children }: {
  label: string;
  onEscape: () => void;
  /** A mouse-down on the backdrop itself, outside the content. */
  onBackdrop?: () => void;
  role?: "dialog" | "alertdialog";
  backdropStyle?: CSSProperties;
  children: ReactNode;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  // Read at the first render, before a field inside takes focus with autoFocus.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const escapeRef = useRef(onEscape);
  useEffect(() => {
    escapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    stack.push(layer);
    syncInert();
    if (!layer.contains(document.activeElement)) (focusables(layer)[0] ?? layer).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        escapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables(layer);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !layer.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    layer.addEventListener("keydown", onKeyDown);
    return () => {
      layer.removeEventListener("keydown", onKeyDown);
      stack.splice(stack.indexOf(layer), 1);
      syncInert();
      // After every layer closing in this commit has left the stack, so the opener is no longer inert.
      queueMicrotask(() => {
        if (opener && document.contains(opener)) opener.focus();
      });
    };
  }, [opener]);

  return createPortal(
    <div
      ref={layerRef}
      className="modal-backdrop"
      role={role}
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      style={backdropStyle}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onBackdrop?.(); }}
    >
      {children}
    </div>,
    document.body,
  );
}
