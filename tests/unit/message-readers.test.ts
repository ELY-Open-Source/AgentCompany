import { describe, expect, test } from "vitest";
import { messageReaders } from "../../src/renderer/src/pages/chat/chat-helpers";
import type { AgentRecord, ChatMessageRecord, TaskRunRecord } from "../../src/shared/domain";

function run(agentId: string | null, contextJson: string | null): TaskRunRecord {
  return {
    id: `run_${Math.random()}`, orgId: "org", taskId: "tsk", agentId, providerId: null, providerRequestId: null,
    executionContextId: null, serviceIdentityId: null, workspaceMountJson: "[]", secretScopeJson: "{}",
    trigger: "chat_mention", state: "completed", createdAt: "", startedAt: null, completedAt: null, errorMessage: null, contextJson,
  };
}

function message(id: string, createdAt: string, editedAt: string | null = null): ChatMessageRecord {
  return { id, createdAt, editedAt } as ChatMessageRecord;
}

const agents = [{ id: "a1", name: "CEO" }, { id: "a2", name: "Dana" }] as AgentRecord[];
const entry = (id: string, version: string) => ({ id, version });
const manifest = (history: object[], fresh: object[], midRun: object[]) =>
  JSON.stringify({ threadId: "t", history, fresh, omittedCount: 0, midRun });

describe("message readers", () => {
  test("collects each agent once per message across history, fresh, and mid-run entries", () => {
    const messages = [message("m1", "t1"), message("m2", "t2"), message("m3", "t3")];
    const readers = messageReaders([
      run("a1", manifest([entry("m1", "t1")], [entry("m2", "t2")], [entry("m3", "t3")])),
      run("a1", manifest([entry("m2", "t2")], [], [])),
      run("a2", manifest([], [entry("m2", "t2")], [])),
      run("a2", null),
      run(null, manifest([entry("m1", "t1")], [], [])),
    ], agents, messages);
    expect(Object.fromEntries(readers)).toEqual({ m1: ["CEO"], m2: ["CEO", "Dana"], m3: ["CEO"] });
  });

  test("a message edited after it was read is unread until a run sees the new version", () => {
    const messages = [message("m1", "t1", "t9")];
    expect(messageReaders([run("a1", manifest([], [entry("m1", "t1")], []))], agents, messages).size).toBe(0);
    expect(Object.fromEntries(messageReaders([run("a1", manifest([], [entry("m1", "t9")], []))], agents, messages))).toEqual({ m1: ["CEO"] });
  });
});
