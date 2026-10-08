import type { KnowledgeEntryRecord } from "../../../../shared/domain";

export type EntryState = "active" | "superseded" | "expired";

export function entryState(entry: KnowledgeEntryRecord, now: string): EntryState {
  if (entry.supersededBy) return "superseded";
  if (entry.validUntil && entry.validUntil <= now) return "expired";
  return "active";
}
