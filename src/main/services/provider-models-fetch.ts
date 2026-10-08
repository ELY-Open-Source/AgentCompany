import type { ProviderModelEntry } from "../../shared/provider-models";
import { getJson, type JsonRecord } from "./provider-http";

/**
 * Live model-list fetching. Each provider that exposes a standard models
 * endpoint (OpenAI `/v1/models`, Anthropic `/v1/models`) returns its current
 * catalog; we map it to {id, name} with no curation and no fabricated entries.
 * An empty or malformed response throws — the caller surfaces the real error
 * rather than falling back to a stale static list.
 */

const MAX_MODEL_PAGES = 50;

export function mapOpenAiModels(data: unknown): ProviderModelEntry[] {
  return collectModels(modelItems(data), (item, id) => ({ id, name: id }));
}

export function mapAnthropicModels(data: unknown): ProviderModelEntry[] {
  return collectModels(modelItems(data), (item, id) => ({
    id,
    name: typeof item.display_name === "string" && item.display_name.trim() ? item.display_name.trim() : id,
  }));
}

/** OpenAI-style lists come whole; one that says has_more is followed through OpenAI's `after` cursor. */
export async function fetchOpenAiModels(modelsUrl: string, headers: Record<string, string>): Promise<ProviderModelEntry[]> {
  return mapOpenAiModels({ data: await fetchAllPages(modelsUrl, headers, (cursor) => withQuery(modelsUrl, { after: cursor })) });
}

/** Anthropic pages 20 models by default; ask for its largest page and follow `after_id` to the end. */
export async function fetchAnthropicModels(modelsUrl: string, headers: Record<string, string>): Promise<ProviderModelEntry[]> {
  const first = withQuery(modelsUrl, { limit: "1000" });
  return mapAnthropicModels({ data: await fetchAllPages(first, headers, (cursor) => withQuery(modelsUrl, { limit: "1000", after_id: cursor })) });
}

async function fetchAllPages(firstUrl: string, headers: Record<string, string>, nextUrl: (cursor: string) => string): Promise<unknown[]> {
  const items: unknown[] = [];
  let url = firstUrl;
  for (let page = 1; page <= MAX_MODEL_PAGES; page += 1) {
    const { data } = await getJson(url, headers);
    items.push(...modelItems(data));
    if (!isRecord(data) || data.has_more !== true) return items;
    if (typeof data.last_id !== "string" || !data.last_id) throw new Error("The provider said it has more models but no cursor to fetch them.");
    url = nextUrl(data.last_id);
  }
  throw new Error(`The provider's model list ran past ${MAX_MODEL_PAGES} pages.`);
}

function withQuery(url: string, params: Record<string, string>): string {
  const target = new URL(url);
  for (const [name, value] of Object.entries(params)) target.searchParams.set(name, value);
  return target.toString();
}

function modelItems(data: unknown): unknown[] {
  if (!isRecord(data) || !Array.isArray(data.data)) throw new Error("Provider model list response was not in the expected shape.");
  return data.data;
}

function collectModels(list: unknown[], toEntry: (item: JsonRecord, id: string) => ProviderModelEntry): ProviderModelEntry[] {
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
