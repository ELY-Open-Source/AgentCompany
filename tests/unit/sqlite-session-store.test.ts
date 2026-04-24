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

  it("writes schema versioned envelopes for new messages", () => {
    const store = new SqliteSessionStore(db, TASK_SESSION_ID);
    store.appendMessage({
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1,
    } as AgentMessage);

    const row = db.projection.sessionEntries.listActive(TASK_SESSION_ID)[0];
    const payload = JSON.parse(row?.payloadJson ?? "{}") as {
      schemaVersion?: number;
      kind?: string;
      message?: { role?: string; timestamp?: number };
    };
    expect(payload.schemaVersion).toBe(1);
    expect(payload.kind).toBe("agent_message");
    expect(payload.message).toMatchObject({ role: "user", timestamp: 1 });
  });

  it("reads legacy raw AgentMessage payloads", () => {
    db.projection.sessionEntries.append({
      taskSessionId: TASK_SESSION_ID,
      kind: "message",
      role: "user",
      payloadJson: JSON.stringify({
        role: "user",
        content: [{ type: "text", text: "legacy" }],
      }),
    });
    const store = new SqliteSessionStore(db, TASK_SESSION_ID);

    const loaded = store.loadMessages();

    expect(loaded).toHaveLength(1);
    expect((loaded[0] as { role?: string }).role).toBe("user");
    expect((loaded[0] as { timestamp?: number }).timestamp).toEqual(expect.any(Number));
  });

  it("rejects invalid message shapes before writing session_entries", () => {
    const store = new SqliteSessionStore(db, TASK_SESSION_ID);

    expect(() => store.appendMessage({
      role: "bad-role",
      content: [{ type: "text", text: "invalid" }],
    } as unknown as AgentMessage)).toThrow('invalid role "bad-role"');

    expect(db.projection.sessionEntries.listActive(TASK_SESSION_ID)).toHaveLength(0);
  });

  it("rejects new messages without a finite timestamp before writing session_entries", () => {
    const store = new SqliteSessionStore(db, TASK_SESSION_ID);

    expect(() => store.appendMessage({
      role: "user",
      content: [{ type: "text", text: "missing timestamp" }],
    } as AgentMessage)).toThrow("timestamp must be a finite number");
    expect(() => store.appendMessage({
      role: "user",
      content: [{ type: "text", text: "bad timestamp" }],
      timestamp: Number.NaN,
    } as AgentMessage)).toThrow("timestamp must be a finite number");
    expect(db.projection.sessionEntries.listActive(TASK_SESSION_ID)).toHaveLength(0);
  });

  it("rejects new messages with invalid content before writing session_entries", () => {
    const store = new SqliteSessionStore(db, TASK_SESSION_ID);

    expect(() => store.appendMessage({
      role: "user",
      content: null,
      timestamp: 1,
    } as unknown as AgentMessage)).toThrow("content must be a string or an array");
    expect(db.projection.sessionEntries.listActive(TASK_SESSION_ID)).toHaveLength(0);
  });

  it("fails reads with the corrupt row id when payload JSON is invalid", () => {
    db.projection.sessionEntries.append({
      taskSessionId: TASK_SESSION_ID,
      kind: "message",
      role: "user",
      payloadJson: "{",
    });
    const row = db.projection.sessionEntries.listActive(TASK_SESSION_ID)[0];
    const store = new SqliteSessionStore(db, TASK_SESSION_ID);

    expect(() => store.loadMessages()).toThrow(`Invalid session entry ${row?.id} payload JSON`);
  });

  it("fails reads with the corrupt row id when payload shape drifts", () => {
    db.projection.sessionEntries.append({
      taskSessionId: TASK_SESSION_ID,
      kind: "message",
      role: null,
      payloadJson: JSON.stringify({ schemaVersion: 1, kind: "agent_message", message: { role: "assistant" }, persistedAt: new Date().toISOString() }),
    });
    const row = db.projection.sessionEntries.listActive(TASK_SESSION_ID)[0];
    const store = new SqliteSessionStore(db, TASK_SESSION_ID);

    expect(() => store.loadMessages()).toThrow(`Invalid session entry ${row?.id} AgentMessage`);
  });

  it("durably compacts oversized active transcripts into a summary plus recent rows", () => {
    const store = new SqliteSessionStore(db, TASK_SESSION_ID);
    for (let i = 0; i < 46; i += 1) {
      const role = i % 2 === 0 ? "user" : "assistant";
      store.appendMessage({
        role,
        content: [{
          type: "text",
          text: `${role} turn ${i}\n${"context ".repeat(6_000)}`,
        }],
        timestamp: i,
      } as AgentMessage);
    }

    const loaded = store.loadMessages();
    const activeRows = db.projection.sessionEntries.listActive(TASK_SESSION_ID);
    const superseded = db.queryAll<{ count: number }>(
      "select count(*) as count from session_entries where task_session_id = ? and is_superseded = 1",
      TASK_SESSION_ID,
    )[0]?.count ?? 0;

    expect(loaded.length).toBeLessThan(46);
    expect(activeRows).toHaveLength(loaded.length);
    expect(activeRows[0]?.sequence).toBe(1);
    expect(activeRows[0]?.role).toBe("user");
    expect(activeRows.slice(1).every((row, index, rows) => index === 0 || row.sequence > (rows[index - 1]?.sequence ?? 0))).toBe(true);
    expect(superseded).toBeGreaterThan(0);
    expect((loaded[0] as { role?: string }).role).toBe("user");
    const firstContent = (loaded[0] as { content?: Array<{ text?: string }> }).content;
    expect(firstContent?.[0]?.text).toContain("Context summary");

    store.appendMessage({
      role: "user",
      content: [{ type: "text", text: "continue" }],
      timestamp: 10_000,
    } as AgentMessage);
    const appended = db.projection.sessionEntries.listActive(TASK_SESSION_ID).at(-1);
    const allMaxSequence = db.queryAll<{ maxSeq: number }>(
      "select max(sequence) as maxSeq from session_entries where task_session_id = ?",
      TASK_SESSION_ID,
    )[0]?.maxSeq;
    expect(appended?.sequence).toBe(47);
    expect(allMaxSequence).toBe(47);
  });
});
