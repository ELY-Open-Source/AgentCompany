export const SEARCH_ENTITY_TYPES = [
  "employee",
  "agent",
  "task",
  "goal",
  "project",
  "workspace",
  "approval",
  "chat_space",
  "chat_message",
  "file",
  "provider",
  "document",
  "knowledge",
] as const;

export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

/** One page of the hits the person may read, and how many there are in all. */
export interface SearchPage {
  results: SearchResultRecord[];
  total: number;
}

export interface SearchResultRecord {
  entityType: SearchEntityType;
  entityId: string;
  title: string;
  preview: string;
  facets: Record<string, string>;
}
