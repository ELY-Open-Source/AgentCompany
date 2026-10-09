let version = 0;

/** Marks a change the window should show; snapshots and change events carry the count so the window never reloads what it already has. */
export function bumpDataVersion(): number {
  version += 1;
  return version;
}

export function currentDataVersion(): number {
  return version;
}
