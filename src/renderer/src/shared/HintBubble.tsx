import type { ReactNode } from "react";
import { Icon } from "./Icon";

/** A hint spoken by the office guide: a pixel portrait and a speech bubble, so help reads like a character talking. */
export function HintBubble({ children }: { children: ReactNode }) {
  return (
    <div className="hint-bubble" role="note">
      <span className="hint-speaker" aria-hidden="true"><Icon name="bot" /></span>
      <p className="hint-text">{children}</p>
    </div>
  );
}
