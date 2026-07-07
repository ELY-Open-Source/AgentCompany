import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TopbarSlotContext } from "./topbar-context";

export function TopbarActions({ children }: { children: ReactNode }) {
  const slot = useContext(TopbarSlotContext);
  if (!slot) return null;
  return createPortal(children, slot);
}
