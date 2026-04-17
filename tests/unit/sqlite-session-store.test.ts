import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { AppDatabase } from "../../src/main/database";
import { SqliteSessionStore } from "../../src/main/agent-runtime/sqlite-session-store";

/**
 * Verifies the SqliteSessionStore round-trips pi `AgentMessage` values
 * correctly through the new `session_entries` table (migration 27).
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

  it("appends a compaction marker that does not appear as a message", () => {
    const store = new SqliteSessionStore(db, TASK_SESSION_ID);
    store.appendMessage({ role: "user", content: [{ type: "text", text: "first" }], timestamp: Date.now() } as AgentMessage);
    store.appendCompaction("Earlier conversation summarised: planning phase complete.");
    const loaded = store.loadMessages();
    expect(loaded).toHaveLength(1);
  });

  it("replaceMessages supersedes prior rows and inserts new ones in order", () => {
    const store = new SqliteSessionStore(db, TASK_SESSION_ID);
    store.appendMessage({ role: "user", content: [{ type: "text", text: "old-1" }], timestamp: Date.now() } as AgentMessage);
    store.appendMessage({ role: "assistant", content: [{ type: "text", text: "old-2" }], timestamp: Date.now() } as AgentMessage);

    const compacted: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "context summary" }], timestamp: Date.now() } as AgentMessage,
    ];
    store.replaceMessages(compacted, "Summary of prior turns.");

    const active = store.loadMessages();
    expect(active).toHaveLength(1);
    expect((active[0] as { content: { text: string }[] }).content[0]?.text).toBe("context summary");

    // Check: pre-replace messages must still exist as superseded audit rows.
    const all = db.sessionEntries.listAll(TASK_SESSION_ID);
    const supersededCount = all.filter((row) => row.isSuperseded).length;
    expect(supersededCount).toBe(2);
  });
});
