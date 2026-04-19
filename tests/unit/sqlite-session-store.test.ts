import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { AppDatabase } from "../../src/main/database";
import { SqliteSessionStore } from "../../src/main/agent-runtime/sqlite-session-store";

/**
 * Verifies the SqliteSessionStore round-trips pi `AgentMessage` values
 * correctly through the `session_entries` table.
 */
describe("SqliteSessionStore", () => {
  let tempDir: string;
  let db: AppDatabase;
  const TASK_SESSION_ID = "task-session-test-1";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-session-store-"));
    db = new AppDatabase(tempDir);
    db.init();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("appends and reloads pi user/assistant messages preserving order", () => {
    const store = new SqliteSessionStore(db, TASK_SESSION_ID);
    const userMessage: AgentMessage = {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: Date.now(),
    } as AgentMessage;
    const assistantMessage: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      stopReason: "stop",
      provider: "anthropic",
      model: { id: "claude-opus-4-5" },
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      timestamp: Date.now(),
    } as unknown as AgentMessage;
    store.appendMessage(userMessage);
    store.appendMessage(assistantMessage);
    const loaded = store.loadMessages();
    expect(loaded).toHaveLength(2);
    expect((loaded[0] as { role: string }).role).toBe("user");
    expect((loaded[1] as { role: string }).role).toBe("assistant");
  });
});
