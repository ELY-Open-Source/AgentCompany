/** Shared argument validation for agent tool implementations. */

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`"${field}" is required.`);
  return value.trim();
}

export function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function optionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`"${field}" must be an array.`);
  return value.map((item, index) => requireString(item, `${field}[${index}]`));
}
