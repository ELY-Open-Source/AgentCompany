import type { ProviderModelEntry } from "../../shared/provider-models";
import { getJson, type JsonRecord } from "./provider-http";

/**
 * Live model-list fetching. Each provider that exposes a standard models
 * endpoint (OpenAI `/v1/models`, Anthropic `/v1/models`) returns its current
 * catalog; we map it to {id, name} with no curation and no fabricated entries.
 * An empty or malformed response throws — the caller surfaces the real error
 * rather than falling back to a stale static list.
 */

export function mapOpenAiModels(data: unknown): ProviderModelEntry[] {
  return collectModels(data, (item, id) => ({ id, name: id }));
}

export function mapAnthropicModels(data: unknown): ProviderModelEntry[] {
  return collectModels(data, (item, id) => ({
    id,
    name: typeof item.display_name === "string" && item.display_name.trim() ? item.display_name.trim() : id,
  }));
}

export async function fetchOpenAiModels(modelsUrl: string, headers: Record<string, string>): Promise<ProviderModelEntry[]> {
  const response = await getJson(modelsUrl, headers);
  return mapOpenAiModels(response.data);
}

export async function fetchAnthropicModels(modelsUrl: string, headers: Record<string, string>): Promise<ProviderModelEntry[]> {
  const response = await getJson(modelsUrl, headers);
  return mapAnthropicModels(response.data);
}

function collectModels(data: unknown, toEntry: (item: JsonRecord, id: string) => ProviderModelEntry): ProviderModelEntry[] {
  const list = isRecord(data) && Array.isArray(data.data) ? data.data : null;
  if (!list) throw new Error("Provider model list response was not in the expected shape.");
  const entries: ProviderModelEntry[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    entries.push(toEntry(item, id));
  }
  if (entries.length === 0) throw new Error("Provider returned no models.");
  return entries;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
