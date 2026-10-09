/** What a batch of decisions did: the requests decided, and each that failed with why. */
export interface BatchResult {
  approved: string[];
  failed: Array<{ id: string; title: string; reason: string }>;
}

/** Decides the requests one at a time, so each result is known and none races another; a failure does not stop the rest. */
export async function decideEach<T extends { id: string; title: string }>(
  items: T[],
  decideOne: (item: T) => Promise<void>,
  onProgress: (done: number) => void,
): Promise<BatchResult> {
  const result: BatchResult = { approved: [], failed: [] };
  for (const item of items) {
    try {
      await decideOne(item);
      result.approved.push(item.id);
    } catch (error) {
      result.failed.push({ id: item.id, title: item.title, reason: error instanceof Error ? error.message : String(error) });
    }
    onProgress(result.approved.length + result.failed.length);
  }
  return result;
}
