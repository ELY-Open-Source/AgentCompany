import { randomUUID } from "node:crypto";
import type { SQLInputValue } from "node:sqlite";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SqliteRow represents dynamic row shapes from node:sqlite; callers narrow via explicit column reads
export type SqliteRow = Record<string, any>;
export type ReadAll = <T>(sql: string, ...params: SQLInputValue[]) => T[];
export type Transaction = <T>(operation: () => T) => T;

export const BOARD_READER_ID = "__board__";

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function ensureId(id: string | null | undefined): string {
  return id && id.length > 0 ? id : randomUUID();
}

export function normalizeOptionalId(id: string | null | undefined): string | null {
  return id && id.length > 0 ? id : null;
}

export function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function taskPriorityOrderSql(columnName: string): string {
  return `case ${columnName}
    when 'critical' then 4
    when 'high' then 3
    when 'medium' then 2
    when 'low' then 1
    else 0
  end`;
}
