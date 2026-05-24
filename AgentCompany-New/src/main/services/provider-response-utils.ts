import { createHash } from "node:crypto";

export function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

export function readProviderResponseId(rawResponseJson: string): string | null {
  const parsed = JSON.parse(rawResponseJson) as unknown;
  if (!isRecord(parsed)) return null;
  const id = parsed.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function readProviderFailureMessage(rawResponseJson: string, status: string): string {
  const parsed = JSON.parse(rawResponseJson) as unknown;
  if (!isRecord(parsed)) return `Provider background response ended with status ${status}.`;
  const error = parsed.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (isRecord(error) && typeof error.message === "string" && error.message.trim()) return error.message.trim();
  const incomplete = parsed.incomplete_details;
  if (isRecord(incomplete) && typeof incomplete.reason === "string" && incomplete.reason.trim()) return incomplete.reason.trim();
  return `Provider background response ended with status ${status}.`;
}

export function requireStreamText(parts: string[]): string {
  const text = parts.join("");
  if (!text.trim()) throw new Error("Provider stream returned no text content.");
  return text;
}

export function requireBackgroundText(text: string | null, providerKey: string): string {
  if (!text?.trim()) throw new Error(`${providerKey} background response returned no text content.`);
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
