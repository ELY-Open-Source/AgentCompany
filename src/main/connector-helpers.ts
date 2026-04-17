/**
 * Normalise a CLI command value read from the connectors table or a user form.
 *
 * Collapses surrounding whitespace so CLI dispatch does not fork an empty
 * argument or pass leading/trailing spaces to spawn().
 */
export function normalizeCommandValue(value: string | null | undefined): string {
  return (value ?? "").trim();
}
