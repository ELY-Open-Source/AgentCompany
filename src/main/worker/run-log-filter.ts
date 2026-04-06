/**
 * Run-log noise filter.
 *
 * CLI adapters emit stdout/stderr containing system-level JSON messages,
 * hook lifecycle events, skill injection notices, and assistant internals
 * (thinking/tool_use). This module strips those lines before they reach
 * the user-facing run log on disk.
 */

const RE_SKILL_INJECTION = /^\[agent-company\] Injected managed skill /;
const RE_OMC_HOOK = /^\[omc:hooks\]/;
const RE_AGENT_COMPANY_LOG = /^\[agent-company\] (?:heartbeat|hook_|system_)/;

/** Matches system JSON except `init` subtype (which carries session metadata). */
const RE_SYSTEM_JSON = /^\{"type"\s*:\s*"system"\s*,\s*"subtype"\s*:\s*"(?!init")/;

/** Matches assistant thinking/tool_use JSON — internal reasoning, not user-visible output. */
const RE_ASSISTANT_INTERNAL =
  /^\{"type"\s*:\s*"assistant"\s*,\s*"subtype"\s*:\s*"(?:thinking|tool_use)"/;

const RE_COMPACTING = /^Compacting conversation\.\.\./;

function isNoisyLine(line: string): boolean {
  const trimmed = line.trimStart();
  if (trimmed.length === 0) return false;

  return (
    RE_SKILL_INJECTION.test(trimmed) ||
    RE_OMC_HOOK.test(trimmed) ||
    RE_AGENT_COMPANY_LOG.test(trimmed) ||
    RE_SYSTEM_JSON.test(trimmed) ||
    RE_ASSISTANT_INTERNAL.test(trimmed) ||
    RE_COMPACTING.test(trimmed)
  );
}

/**
 * Filters a raw log chunk by removing noisy lines.
 * @returns The cleaned chunk, or `null` if the entire chunk is noise.
 */
export function filterRunLogChunk(
  _stream: "stdout" | "stderr",
  chunk: string,
): string | null {
  const lines = chunk.split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    if (!isNoisyLine(line)) {
      kept.push(line);
    }
  }

  if (kept.length === 0) return null;

  const result = kept.join("\n");
  return result.length === 0 ? null : result;
}
