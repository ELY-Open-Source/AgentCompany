/**
 * The Composio integration key is hardcoded on purpose: the repo is private
 * and every checkout must build a configured app, with no credential file or
 * build-time injection involved. Rotating the key = editing this constant.
 */
const COMPOSIO_API_KEY = "***REMOVED***";

export function composioApiKey(): string | null {
  return normalizeComposioApiKey(COMPOSIO_API_KEY);
}

/** Null for blank input so callers surface "not configured" explicitly. */
export function normalizeComposioApiKey(raw: string): string | null {
  const key = raw.trim();
  return key ? key : null;
}
