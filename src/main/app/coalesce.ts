/**
 * Wraps a notification callback so bursts collapse into one trailing call.
 * Agent run loops emit change events per tool turn; without coalescing every
 * emission forces the renderer through a full snapshot reload, which starves
 * the UI thread once the database grows.
 */
export function coalesce(fn: () => void, delayMs: number): () => void {
  let timer: NodeJS.Timeout | null = null;
  return () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, delayMs);
  };
}
