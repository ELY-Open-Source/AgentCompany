import { writeFileSync, readFileSync, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import log from "electron-log/main.js";
import type { RunLogChunk } from "@shared/types";
import type { ReadAll, Transaction } from "./helpers";

/**
 * Find the last complete UTF-8 character boundary in a buffer.
 * Returns the number of bytes up to (and including) the last complete character.
 * This prevents corrupting multi-byte CJK characters when slicing at chunk edges.
 */
export function findUtf8Boundary(buffer: Buffer, bytesRead: number): number {
  if (bytesRead === 0) return 0;
  let pos = bytesRead - 1;
  while (pos >= 0 && (buffer[pos] & 0xc0) === 0x80) {
    pos--;
  }
  if (pos < 0) return bytesRead;
  const lead = buffer[pos];
  let charLen: number;
  if ((lead & 0x80) === 0) charLen = 1;
  else if ((lead & 0xe0) === 0xc0) charLen = 2;
  else if ((lead & 0xf0) === 0xe0) charLen = 3;
  else if ((lead & 0xf8) === 0xf0) charLen = 4;
  else return bytesRead;
  if (pos + charLen <= bytesRead) return bytesRead;
  return pos;
}

/**
 * Run log file-IO helpers extracted from runs.ts. Every method is spread
 * into the final `buildRunMethods` result so AppDatabase call-sites remain
 * unchanged. `writeFileSync` is re-exported indirectly through createRun
 * (still in runs.ts) via the shared logs directory.
 */
export function buildRunLogMethods(
  getDb: () => DatabaseSync,
  _readAll: ReadAll,
  _transaction: Transaction,
) {
  return {
    appendRunLog(runId: string, stream: "stdout" | "stderr", chunk: string) {
      const run = getDb().prepare("select log_path as logPath from runs where id = ?").get(runId) as { logPath: string | null } | undefined;
      if (!run?.logPath) return;
      return appendFile(run.logPath, `[${new Date().toISOString()}][${stream}] ${chunk}`, "utf8");
    },

    readRunLog(runId: string) {
      const run = getDb().prepare("select log_path as logPath from runs where id = ?").get(runId) as { logPath: string | null } | undefined;
      if (!run?.logPath) return "";
      try {
        return readFileSync(run.logPath, "utf8");
      } catch (err) {
        log.warn(`[database/runs] readFileSync failed for run ${runId} log ${run.logPath}:`, err instanceof Error ? err.message : String(err));
        return "";
      }
    },

    readRunLogChunk(runId: string, offset = 0, limit = 65_536): RunLogChunk {
      const run = getDb().prepare("select log_path as logPath from runs where id = ?").get(runId) as { logPath: string | null } | undefined;
      if (!run?.logPath || !existsSync(run.logPath)) {
        return { content: "", offset: 0, nextOffset: 0, totalBytes: 0, eof: true };
      }

      const totalBytes = statSync(run.logPath).size;
      const safeOffset = Math.max(0, Math.min(offset, totalBytes));
      const safeLimit = Math.max(1_024, Math.min(limit, 262_144));
      const bytesToRead = Math.max(0, Math.min(safeLimit, totalBytes - safeOffset));

      if (bytesToRead === 0) {
        return { content: "", offset: safeOffset, nextOffset: safeOffset, totalBytes, eof: true };
      }

      const fileDescriptor = openSync(run.logPath, "r");
      try {
        const buffer = Buffer.allocUnsafe(bytesToRead);
        const bytesRead = readSync(fileDescriptor, buffer, 0, bytesToRead, safeOffset);
        const safeBytesRead = findUtf8Boundary(buffer, bytesRead);
        const nextOffset = safeOffset + safeBytesRead;
        return {
          content: buffer.subarray(0, safeBytesRead).toString("utf8"),
          offset: safeOffset,
          nextOffset,
          totalBytes,
          eof: nextOffset >= totalBytes,
        };
      } finally {
        closeSync(fileDescriptor);
      }
    },
  };
}

// Re-exported so runs.ts can still use writeFileSync on run creation.
export { writeFileSync };
