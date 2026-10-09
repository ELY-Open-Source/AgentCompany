import type { DatabaseSync } from "node:sqlite";
import { camel } from "../../src/main/services/snapshot-service";

/** A table's rows with camel-cased keys, for asserting backend records the app no longer ships to the window. */
export function tableRows(db: DatabaseSync, table: string, orderBy: string, booleans: string[] = []): Array<Record<string, unknown>> {
  return (db.prepare(`select * from ${table} order by ${orderBy}`).all() as Array<Record<string, unknown>>).map((row) => {
    const next = camel(row as Record<string, string | number | null>);
    for (const key of booleans) next[key] = next[key] === 1;
    return next;
  });
}
