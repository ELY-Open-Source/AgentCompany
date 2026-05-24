export function readProviderResponseId(rawResponseJson: string): string | null {
  const parsed = JSON.parse(rawResponseJson) as unknown;
  if (!isRecord(parsed)) return null;
  const id = parsed.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function requireStreamText(parts: string[]): string {
  const text = parts.join("");
  if (!text.trim()) throw new Error("Provider stream returned no text content.");
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
