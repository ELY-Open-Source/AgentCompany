type BatchCallback = () => void;

export function createEventBatcher(callback: BatchCallback, windowMs = 50) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule() {
    if (timer !== null) return; // already scheduled -- coalesce
    timer = setTimeout(() => {
      timer = null;
      callback();
    }, windowMs);
  }

  function flush() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      callback();
    }
  }

  function dispose() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { schedule, flush, dispose };
}
