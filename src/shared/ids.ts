export type EntityId = string;

export function createId(prefix: string): EntityId {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}
