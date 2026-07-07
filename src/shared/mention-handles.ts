export const RESERVED_MENTION_HANDLES = new Set(["board", "oncall"]);

export function canonicalMentionHandle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function assertUsableMentionName(value: string): void {
  if (RESERVED_MENTION_HANDLES.has(canonicalMentionHandle(value))) {
    throw new Error("Mention handle is reserved.");
  }
}
