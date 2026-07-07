import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * The org's Composio API key. When the database has none, a developer
 * credential file next to the app (cred.txt, first line "Composio apikey:
 * ak_...", gitignored) seeds it once for this org — the product owner's
 * local path. Packaged installs configure the key in Settings instead; a
 * missing file simply yields null.
 */
export function resolveComposioApiKey(db: DatabaseSync, orgId: string, credentialFileDir: string = process.cwd()): string | null {
  const stored = db.prepare(
    "select value from composio_settings where org_id = ? and key = 'api_key' limit 1",
  ).get(orgId) as { value: string } | undefined;
  if (stored?.value) return stored.value;

  const path = join(credentialFileDir, "cred.txt");
  if (!existsSync(path)) return null;
  const firstLine = readFileSync(path, "utf8").split("\n")[0] ?? "";
  const key = firstLine.split(":").slice(1).join(":").trim();
  if (!key) return null;

  const now = new Date().toISOString();
  const upsert = db.prepare(`
    insert into composio_settings(org_id, key, value, updated_at) values (?, ?, ?, ?)
    on conflict(org_id, key) do update set value = excluded.value, updated_at = excluded.updated_at
  `);
  upsert.run(orgId, "api_key", key, now);
  upsert.run(orgId, "entity_id", orgId, now);
  return key;
}
