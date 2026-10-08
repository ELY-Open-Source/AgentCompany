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

/** Omitted means the default; anything supplied must be a whole number from 1 to max. */
export function optionalLimit(value: unknown, field: string, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`"${field}" must be a whole number from 1 to ${max}.`);
  }
  return value;
}

/** Omitted means the default; anything supplied must be one of the allowed values. */
export function optionalEnum(value: unknown, field: string, allowed: readonly string[], fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`"${field}" must be one of: ${allowed.join(", ")}.`);
  return value;
}
