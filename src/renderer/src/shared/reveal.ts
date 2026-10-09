import { useEffect } from "react";

const TRIES = 30;
const EVERY_MS = 100;

/** Brings the object a link opened into view and marks it, waiting briefly for content that loads after the page. */
export function useRevealObject(id: string | null | undefined): void {
  useEffect(() => {
    if (!id) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const find = () => {
      const node = document.querySelector(`[data-object-id="${CSS.escape(id)}"]`);
      if (node) {
        node.scrollIntoView({ block: "center" });
        node.setAttribute("data-revealed", "true");
        return;
      }
      tries += 1;
      if (tries < TRIES) timer = setTimeout(find, EVERY_MS);
      else console.warn(`[reveal] ${id} is not on screen`);
    };
    find();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [id]);
}
