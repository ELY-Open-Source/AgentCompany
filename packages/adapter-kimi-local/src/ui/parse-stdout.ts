import type { TranscriptEntry } from "@agentcompany/adapter-utils";

export function parseKimiStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const text = line.trim();
  if (!text) return [];
  return [{ kind: "stdout", ts, text: line }];
}
