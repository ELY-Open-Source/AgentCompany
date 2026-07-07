import { createContext } from "react";

/**
 * The Shell owns the fixed topbar and publishes its action area as a DOM node
 * through this context. Pages portal their primary actions into that node via
 * {@link TopbarActions} so the controls stay pinned to the topbar (matching the
 * design) instead of scrolling away inside the page body.
 */
export const TopbarSlotContext = createContext<HTMLElement | null>(null);
