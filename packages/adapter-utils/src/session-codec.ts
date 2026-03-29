import type { AdapterSessionCodec } from "./types.js";

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

interface SessionCodecOptions {
  /** Additional key aliases for sessionId beyond "sessionId" and "session_id" (e.g. "sessionID" for Gemini/OpenCode). */
  extraSessionIdKeys?: string[];
}

/**
 * Creates a standard session codec shared across adapters.
 * All adapters use the same serialize/deserialize/getDisplayId logic,
 * differing only in which keys they accept for sessionId.
 */
export function createStandardSessionCodec(options?: SessionCodecOptions): AdapterSessionCodec {
  const extraKeys = options?.extraSessionIdKeys ?? [];

  function readSessionId(record: Record<string, unknown>): string | null {
    return (
      readNonEmptyString(record.sessionId) ??
      readNonEmptyString(record.session_id) ??
      extraKeys.reduce<string | null>((found, key) => found ?? readNonEmptyString(record[key]), null)
    );
  }

  function extractFields(record: Record<string, unknown>) {
    const sessionId = readSessionId(record);
    if (!sessionId) return null;
    const cwd =
      readNonEmptyString(record.cwd) ??
      readNonEmptyString(record.workdir) ??
      readNonEmptyString(record.folder);
    const workspaceId = readNonEmptyString(record.workspaceId) ?? readNonEmptyString(record.workspace_id);
    const repoUrl = readNonEmptyString(record.repoUrl) ?? readNonEmptyString(record.repo_url);
    const repoRef = readNonEmptyString(record.repoRef) ?? readNonEmptyString(record.repo_ref);
    return {
      sessionId,
      ...(cwd ? { cwd } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(repoUrl ? { repoUrl } : {}),
      ...(repoRef ? { repoRef } : {}),
    };
  }

  return {
    deserialize(raw: unknown) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
      return extractFields(raw as Record<string, unknown>);
    },
    serialize(params: Record<string, unknown> | null) {
      if (!params) return null;
      return extractFields(params);
    },
    getDisplayId(params: Record<string, unknown> | null) {
      if (!params) return null;
      return readSessionId(params);
    },
  };
}
