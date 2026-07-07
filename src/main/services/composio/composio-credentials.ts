import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * The org's Composio API key. A developer credential file next to the app
 * (cred.txt, first line "Composio apikey: ak_...", gitignored) is the source
 * of truth whenever it exists: rotating the key in the file takes effect on
 * the next resolution, replacing whatever the database held. Packaged
 * installs have no credential file and manage the key in Settings instead.
 */
export function resolveComposioApiKey(db: DatabaseSync, orgId: string, credentialFileDir: string = process.cwd()): string | null {
  const stored = db.prepare(
    "select value from composio_settings where org_id = ? and key = 'api_key' limit 1",
  ).get(orgId) as { value: string } | undefined;

  const fileKey = readCredentialFile(credentialFileDir);
  if (!fileKey) return stored?.value ?? null;
  if (stored?.value === fileKey) return fileKey;

  const now = new Date().toISOString();
  const upsert = db.prepare(`
    insert into composio_settings(org_id, key, value, updated_at) values (?, ?, ?, ?)
    on conflict(org_id, key) do update set value = excluded.value, updated_at = excluded.updated_at
  `);
  upsert.run(orgId, "api_key", fileKey, now);
  upsert.run(orgId, "entity_id", orgId, now);
  return fileKey;
}

function readCredentialFile(dir: string): string | null {
  const path = join(dir, "cred.txt");
  if (!existsSync(path)) return null;
  const firstLine = readFileSync(path, "utf8").split("\n")[0] ?? "";
  const key = firstLine.split(":").slice(1).join(":").trim();
  return key || null;
}
