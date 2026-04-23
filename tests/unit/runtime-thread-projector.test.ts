import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import { AppDatabase } from "../../src/main/database";
import { RuntimeThreadProjector } from "../../src/main/agent-runtime/runtime-thread-projector";
import { findTaskThread } from "../../src/main/thread-integration/thread-helpers";

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function textMessage(role: string, text: string, timestamp = Date.now()) {
  return {
    role,
    timestamp,
    content: [{ type: "text", text }],
  };
}

describe("RuntimeThreadProjector", () => {
  it("projects assistant messages without internal prompt and tool noise", async () => {
    const profileDir = await createTempDir("agentcompany-thread-projector-");
    const db = new AppDatabase(profileDir);
    db.init();

    try {
      const companyId = db.core.company.saveCompany({
        name: "Thread Co",
        description: "Thread projection test",
        status: "active",
      });
      const agentId = db.core.agents.saveAgent({
        companyId,
        name: "CTO",
        role: "CTO",
        title: "Chief Technology Officer",
        status: "active",
        reportsTo: null,
        connectorId: "openai-codex",
        workspaceId: null,
        model: null,
        capabilities: "Engineering",
        budgetMonthlyUsd: 100,
      });
      const taskId = db.core.tasks.saveTask({
        companyId,
        title: "Coordinate launch",
        description: "Keep the launch thread readable.",
        assigneeAgentId: agentId,
        priority: "high",
        status: "todo",
      });

      const projector = new RuntimeThreadProjector({
        db,
        logger: { warn: () => {} },
        resolveAgentName: () => "CTO",
        lookupInboundCorrelation: () => null,
      });
      const envelope = { runId: "run-1", agentId, companyId, taskId };

      projector.recordThreadEvent(envelope, textMessage("user", "Internal initial user turn."));
      projector.recordThreadEvent(envelope, textMessage("toolResult", "Tool output."));
      projector.recordThreadEvent(envelope, {
        role: "assistant",
        timestamp: Date.now(),
        content: [{ type: "toolCall", name: "bash" }],
      });
      projector.recordThreadEvent(envelope, textMessage("assistant", "Launch owner update sent to Product."));

      const thread = findTaskThread(db, taskId, companyId);
      if (!thread) throw new Error("Expected task thread to be created.");
      const events = db.core.threads.listThreadEvents(thread.id, companyId, { limit: 10 });

      expect(events.map((event) => event.body)).toEqual(["Launch owner update sent to Product."]);
      expect(events[0].actorId).toBe(agentId);
      expect(events[0].actorType).toBe("agent");
      expect(events[0].eventType).toBe("message");
    } finally {
      db.close();
    }
  });

  it("keeps live correlated inbound messages in the thread", async () => {
    const profileDir = await createTempDir("agentcompany-thread-inbound-");
    const db = new AppDatabase(profileDir);
    db.init();

    try {
      const companyId = db.core.company.saveCompany({
        name: "Inbound Co",
        description: "Inbound projection test",
        status: "active",
      });
      const agentId = db.core.agents.saveAgent({
        companyId,
        name: "CEO",
        role: "CEO",
        title: "Chief Executive Officer",
        status: "active",
        reportsTo: null,
        connectorId: "openai-codex",
        workspaceId: null,
        model: null,
        capabilities: "Leadership",
        budgetMonthlyUsd: 100,
      });
      const peerId = db.core.agents.saveAgent({
        companyId,
        name: "CTO",
        role: "CTO",
        title: "Chief Technology Officer",
        status: "active",
        reportsTo: agentId,
        connectorId: "openai-codex",
        workspaceId: null,
        model: null,
        capabilities: "Engineering",
        budgetMonthlyUsd: 100,
      });
      const taskId = db.core.tasks.saveTask({
        companyId,
        title: "Answer engineering",
        description: "Respond in the thread.",
        assigneeAgentId: agentId,
        priority: "high",
        status: "todo",
      });
      const timestamp = Date.now();
      const projector = new RuntimeThreadProjector({
        db,
        logger: { warn: () => {} },
        resolveAgentName: () => "CEO",
        lookupInboundCorrelation: () => ({
          messageId: "message-1",
          fromAgentId: peerId,
          senderKind: "agent",
          piTimestamp: timestamp,
        }),
      });

      projector.recordThreadEvent(
        { runId: "run-1", agentId, companyId, taskId },
        textMessage("user", "Can you approve the deployment?", timestamp),
      );

      const thread = findTaskThread(db, taskId, companyId);
      if (!thread) throw new Error("Expected task thread to be created.");
      const events = db.core.threads.listThreadEvents(thread.id, companyId, { limit: 10 });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: peerId,
        actorType: "agent",
        eventType: "message",
        body: "Can you approve the deployment?",
      });
    } finally {
      db.close();
    }
  });
});
