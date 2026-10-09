/** The newest `count` runs, newest first; the snapshot lists runs oldest first (time, then insertion). */
export function newestRuns<T>(runs: T[], count: number): T[] {
  return runs.slice(-count).reverse();
}
