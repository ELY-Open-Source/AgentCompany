import { describe, expect, it } from "vitest";
import type { AppDatabase } from "../../src/main/database";
import {
  DOCUMENT_LIFECYCLE_PROCESSOR_DEFAULTS,
  STALE_LOCK_TIMEOUT_MS,
} from "../../src/main/constants";
import { makeLifecycleProcessorOptions } from "../../src/main/document-lifecycle-processor";

describe("runtime constants", () => {
  it("uses one stale lock timeout for task lease recovery", () => {
    expect(STALE_LOCK_TIMEOUT_MS).toBe(15 * 60 * 1000);
  });

  it("uses shared document lifecycle processor defaults", () => {
    const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
    const options = makeLifecycleProcessorOptions({
      db: {} as AppDatabase,
      logger,
    });

    expect(options.maxAttempts).toBe(DOCUMENT_LIFECYCLE_PROCESSOR_DEFAULTS.maxAttempts);
    expect(options.staleRunningMs).toBe(DOCUMENT_LIFECYCLE_PROCESSOR_DEFAULTS.staleRunningMs);
    expect(options.batchSize).toBe(DOCUMENT_LIFECYCLE_PROCESSOR_DEFAULTS.batchSize);
    expect(options.sweepIntervalMs).toBe(DOCUMENT_LIFECYCLE_PROCESSOR_DEFAULTS.sweepIntervalMs);
  });
});
