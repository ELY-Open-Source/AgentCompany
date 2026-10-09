/** A snapshot read at an older data version than the one on screen is a late answer; showing it would undo newer data. */
export function supersedes(shownVersion: number, incomingVersion: number): boolean {
  return incomingVersion >= shownVersion;
}
