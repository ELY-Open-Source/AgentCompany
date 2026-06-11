import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** Hover-intent timings. Open is brisk; close is forgiving so the cursor can
 * cross the gap between a row and its submenu without it collapsing. */
const OPEN_DELAY_MS = 90;
const CLOSE_DELAY_MS = 320;

interface Point {
  x: number;
  y: number;
}

interface CascadeController {
  openId: string | null;
  /** A row asks to become the open one (on hover). Honors the safe triangle. */
  hoverRow: (id: string) => void;
  /** A row/submenu cancels the pending close (cursor is still inside the menu). */
  keepOpen: () => void;
  /** The cursor left the whole menu — close after the grace delay. */
  scheduleClose: () => void;
  /** Submenus register their element so the safe triangle can read its edge. */
  registerSubmenu: (id: string, element: HTMLElement | null) => void;
  closeNow: () => void;
}

const CascadeContext = createContext<CascadeController | null>(null);

function sign(a: Point, b: Point, c: Point): number {
  return (a.x - c.x) * (b.y - c.y) - (b.x - c.x) * (a.y - c.y);
}

/** Is point p inside triangle a-b-c (inclusive of edges)? Exported for tests. */
export function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * A menu whose rows can each reveal a side submenu on hover. The container owns
 * the single open row and the cursor→submenu "safe triangle": when a submenu is
 * open and the cursor is travelling toward it, hovers over sibling rows are
 * ignored, so a natural diagonal move never snaps the target submenu shut.
 */
export function CascadeMenu({ children, className }: { children: ReactNode; className?: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openIdRef = useRef<string | null>(null);
  const pointer = useRef<Point>({ x: 0, y: 0 });
  const priorPointer = useRef<Point>({ x: 0, y: 0 });
  const submenus = useRef<Map<string, HTMLElement>>(new Map());
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const setOpen = useCallback((id: string | null) => {
    openIdRef.current = id;
    setOpenId(id);
  }, []);

  const clearOpenTimer = () => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  };
  const clearCloseTimer = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  /** True when the cursor is sweeping toward the currently open submenu. The
   * apex is the prior cursor sample; the base is the submenu's near (left) edge. */
  const movingTowardSubmenu = (): boolean => {
    const current = openIdRef.current;
    if (!current) return false;
    const element = submenus.current.get(current);
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const apex = priorPointer.current;
    const top: Point = { x: rect.left, y: rect.top };
    const bottom: Point = { x: rect.left, y: rect.bottom };
    return pointInTriangle(pointer.current, apex, top, bottom);
  };

  const hoverRow = useCallback((id: string) => {
    clearCloseTimer();
    if (id === openIdRef.current) {
      clearOpenTimer();
      return;
    }
    // Defer switching while the cursor is en route to the open submenu.
    if (openIdRef.current && movingTowardSubmenu()) return;
    clearOpenTimer();
    openTimer.current = window.setTimeout(() => setOpen(id), OPEN_DELAY_MS);
  }, [setOpen]);

  const keepOpen = useCallback(() => {
    clearCloseTimer();
  }, []);

  const scheduleClose = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => setOpen(null), CLOSE_DELAY_MS);
  }, [setOpen]);

  const closeNow = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    setOpen(null);
  }, [setOpen]);

  const registerSubmenu = useCallback((id: string, element: HTMLElement | null) => {
    if (element) submenus.current.set(id, element);
    else submenus.current.delete(id);
  }, []);

  useEffect(() => () => { clearOpenTimer(); clearCloseTimer(); }, []);

  const controller: CascadeController = { openId, hoverRow, keepOpen, scheduleClose, registerSubmenu, closeNow };

  return (
    <div
      className={className}
      onMouseMove={(event) => {
        priorPointer.current = pointer.current;
        pointer.current = { x: event.clientX, y: event.clientY };
      }}
      onMouseLeave={scheduleClose}
    >
      <CascadeContext.Provider value={controller}>{children}</CascadeContext.Provider>
    </div>
  );
}

/**
 * A row that reveals `submenu` to its right on hover. Composes with sibling rows
 * through the surrounding {@link CascadeMenu} so only one submenu shows and the
 * safe triangle governs switching.
 */
export function CascadeRow({
  id,
  children,
  submenu,
}: {
  id: string;
  children: ReactNode;
  submenu: (close: () => void) => ReactNode;
}) {
  const controller = useContext(CascadeContext);
  if (!controller) throw new Error("CascadeRow must be used inside a CascadeMenu.");
  const open = controller.openId === id;
  const submenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    controller.registerSubmenu(id, open ? submenuRef.current : null);
    return () => controller.registerSubmenu(id, null);
  }, [controller, id, open]);

  return (
    <div className="cascade-row-anchor" onMouseEnter={() => controller.hoverRow(id)}>
      {children}
      {open && (
        <div
          ref={submenuRef}
          role="menu"
          className="cascade-submenu"
          onMouseEnter={controller.keepOpen}
          onMouseLeave={controller.scheduleClose}
        >
          {submenu(controller.closeNow)}
        </div>
      )}
    </div>
  );
}
