/**
 * The Composio integration key ships inside the compiled main-process
 * bundle: electron.vite.config.ts reads cred.txt at the repository root
 * during build and injects the key as __COMPOSIO_API_KEY__.
 * No credential file is packaged, nothing is persisted to the database, and
 * the key is never user-visible or configurable. Rotating the key means
 * updating cred.txt and rebuilding.
 */
export function composioApiKey(): string | null {
  return normalizeComposioApiKey(typeof __COMPOSIO_API_KEY__ === "string" ? __COMPOSIO_API_KEY__ : "");
}

/** Null for blank input so callers surface "not configured" explicitly. */
export function normalizeComposioApiKey(raw: string): string | null {
  const key = raw.trim();
  return key ? key : null;
}
