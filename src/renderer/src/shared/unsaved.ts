import { useEffect } from "react";

/** "page": input lost when its page is left; "app": input kept across pages and lost only when the app closes. */
export type UnsavedScope = "page" | "app";

const sources = new Map<symbol, UnsavedScope>();
let reported = false;

/** Main asks before closing the window or quitting while anything is unsaved. */
function report(): void {
  const unsaved = sources.size > 0;
  if (unsaved === reported) return;
  reported = unsaved;
  void window.agentCompany.reportUnsaved({ unsaved }).then((result) => {
    if (!result.ok) console.error(`[unsaved] could not tell the app about unsaved input: ${result.error.message}`);
  });
}

export function setUnsaved(token: symbol, scope: UnsavedScope | null): void {
  if (scope) sources.set(token, scope);
  else sources.delete(token);
  report();
}

/** Registers input that leaving would discard, for as long as `dirty` holds. */
export function useUnsaved(dirty: boolean, scope: UnsavedScope = "page"): void {
  useEffect(() => {
    if (!dirty) return;
    const token = Symbol("unsaved");
    setUnsaved(token, scope);
    return () => setUnsaved(token, null);
  }, [dirty, scope]);
}

/** True while input exists that switching pages would discard. */
export function hasPageUnsaved(): boolean {
  return [...sources.values()].includes("page");
}
