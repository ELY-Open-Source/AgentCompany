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
  "social_account",
  "scheduled_post",
] as const;

export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

export interface SearchResultRecord {
  entityType: SearchEntityType;
  entityId: string;
  title: string;
  preview: string;
  facets: Record<string, string>;
}
