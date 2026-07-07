import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * The Composio integration key ships with the product: cred.txt (first line
 * "Composio apikey: ak_...", gitignored) sits at the project root in
 * development and inside the packaged app's resources directory in
 * production. Wherever the file exists it is the source of truth — rotating
 * the key in the file replaces whatever the database held on the next
 * resolution. It is not user-configurable.
 */
export function resolveComposioApiKey(db: DatabaseSync, orgId: string, credentialFileDirs: string[] = defaultCredentialDirs()): string | null {
  const stored = db.prepare(
    "select value from composio_settings where org_id = ? and key = 'api_key' limit 1",
  ).get(orgId) as { value: string } | undefined;

  const fileKey = readCredentialFile(credentialFileDirs);
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

/** Project root in dev; the app's resources directory when packaged. */
export function defaultCredentialDirs(): string[] {
  const dirs = [process.cwd()];
  if (process.resourcesPath) dirs.push(process.resourcesPath);
  return dirs;
}

function readCredentialFile(dirs: string[]): string | null {
  for (const dir of dirs) {
    const path = join(dir, "cred.txt");
    if (!existsSync(path)) continue;
    const firstLine = readFileSync(path, "utf8").split("\n")[0] ?? "";
    const key = firstLine.split(":").slice(1).join(":").trim();
    if (key) return key;
  }
  return null;
}
