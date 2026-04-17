import type { DatabaseSync, SQLInputValue } from "node:sqlite";

export type ReadAll = <T>(sql: string, ...params: SQLInputValue[]) => T[];
export type Transaction = <T>(operation: () => T) => T;

export type Migration = {
  version: number;
  name: string;
  sql?: string;
  fn?: () => void;
};

export type MigrationDeps = {
  db: DatabaseSync;
  readAll: ReadAll;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function columnExists(
  db: DatabaseSync,
  table: string,
  column: string,
): boolean {
  const rows = db.prepare(`pragma table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return rows.some((row) => row.name === column);
}

export function tableExists(db: DatabaseSync, table: string): boolean {
  const row = db
    .prepare("select name from sqlite_master where type = 'table' and name = ?")
    .get(table) as { name: string } | undefined;
  return !!row;
}

export function addColumnIfMissing(
  db: DatabaseSync,
  table: string,
  column: string,
  sql: string,
): void {
  if (!columnExists(db, table, column)) db.prepare(sql).run();
}
