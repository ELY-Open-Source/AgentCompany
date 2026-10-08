import { createHash, randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";
import { renderTaskHandoff } from "../../src/main/services/agent-task-handoff";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../src/shared/domain";
import type { ToolCall } from "../../src/main/services/provider-tool-turn";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: `call_${randomUUID()}`, name, arguments: args };
}

function harness() {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-handoff-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  let ceoId = "";
  let sourceTaskId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "HandoffCo", employeeName: "Yang", mission: "m", goal: "g" });
    const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
    ceoId = organization.createAgent({
      orgId, name: "CEO", role: "CEO", department: "Executive",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null, roleLevel: "c_suite",
    });
    sourceTaskId = organization.createTask({
      orgId, title: "Plan the launch", description: "d", status: TASK_STATUS.IN_PROGRESS, assigneeAgentId: ceoId,
      risk: RISK_LEVEL.LOW, projectId: null, goalId: null, workspaceId: null, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false,
    });
  });
  const specPath = join(tmpdir(), `ac-handoff-spec-${randomUUID()}.md`);
  writeFileSync(specPath, "v1");
  connection.db.prepare(`
    insert into file_objects(id, org_id, name, kind, size_bytes, sha256, storage_path, owner_type, owner_id, created_at)
    values ('fil_spec', ?, 'spec.md', 'document', 2, ?, ?, 'agent', ?, ?)
  `).run(orgId, sha256("v1"), specPath, ceoId, new Date().toISOString());
  const deps = { db: connection.db, organization, chat: new ChatService(connection.db) };
  const ctx: AgentToolContext = {
    orgId, agent: { id: ceoId, modelProviderId: null, modelId: null },
    taskProjectId: null, taskGoalId: null, taskId: sourceTaskId, sourceThreadId: "thr_src", workspace: null,
  };
  return { connection, deps, ctx, orgId, sourceTaskId, specPath };
}

describe("structured task handoff", () => {
  test("create_task pins inputs and carries facts, questions, and acceptance criteria", () => {
    const h = harness();
    const result = dispatchAgentTool(h.deps, h.ctx, call("create_task", {
      title: "Build the API", description: "Ship it.",
      input_file_ids: ["fil_spec"], facts: ["Postgres is the store"], open_questions: ["Rate limits?"],
      acceptance_criteria: ["All endpoint tests pass"],
    }));
    expect(result).toContain("Created task");
    const taskId = /task_id=([^)\s]+)\)/.exec(result)![1];
    const row = h.connection.db.prepare("select handoff_json from tasks where id = ?").get(taskId) as { handoff_json: string };
    expect(JSON.parse(row.handoff_json)).toEqual({
      sourceTaskId: h.sourceTaskId,
      sourceThreadId: "thr_src",
      inputs: [{ fileId: "fil_spec", name: "spec.md", sha256: sha256("v1") }],
      facts: ["Postgres is the store"],
      openQuestions: ["Rate limits?"],
      acceptanceCriteria: ["All endpoint tests pass"],
    });

    const before = renderTaskHandoff(h.connection.db, h.orgId, row.handoff_json).join("\n");
    expect(before).toContain('Delegated from task "Plan the launch"');
    expect(before).toContain('thread_id="thr_src"');
    expect(before).toContain(`spec.md (file_id=fil_spec, sha256=${sha256("v1").slice(0, 12)}): unchanged since the handoff`);
    expect(before).toContain("Verified: Postgres is the store");
    expect(before).toContain("Open question: Rate limits?");
    expect(before).toContain("Done when: All endpoint tests pass");

    writeFileSync(h.specPath, "v2 edited outside the file registry");
    expect(renderTaskHandoff(h.connection.db, h.orgId, row.handoff_json).join("\n")).toContain("CHANGED since the handoff");
    rmSync(h.specPath);
    expect(renderTaskHandoff(h.connection.db, h.orgId, row.handoff_json).join("\n")).toContain("deleted since the handoff");
    h.connection.close();
  });

  test("an input whose bytes no longer match its record is refused, not pinned", () => {
    const h = harness();
    writeFileSync(h.specPath, "tampered");
    expect(dispatchAgentTool(h.deps, h.ctx, call("create_task", { title: "Y", description: "d", input_file_ids: ["fil_spec"] })))
      .toBe("ERROR: spec.md changed on disk since it was recorded; it is not the content that was handed over.");
    expect(h.connection.db.prepare("select count(*) as n from tasks where title = 'Y'").get()).toEqual({ n: 0 });
    h.connection.close();
  });

  test("an unknown input file id fails the call and creates nothing", () => {
    const h = harness();
    expect(dispatchAgentTool(h.deps, h.ctx, call("create_task", { title: "X", description: "d", input_file_ids: ["fil_missing"] })))
      .toBe('ERROR: No file with file_id "fil_missing" exists in this company.');
    expect(h.connection.db.prepare("select count(*) as n from tasks where title = 'X'").get()).toEqual({ n: 0 });
    h.connection.close();
  });
});

describe("delegation parentage", () => {
  test("a task created inside real work becomes its subtask", () => {
    const h = harness();
    const result = dispatchAgentTool(h.deps, h.ctx, call("create_task", { title: "Child", description: "d" }));
    const childId = /task_id=([^)\s]+)\)/.exec(result)![1];
    expect(h.connection.db.prepare("select parent_task_id from tasks where id = ?").get(childId)).toEqual({ parent_task_id: h.sourceTaskId });
    h.connection.close();
  });

  test("tasks created from a chat-wake vehicle keep no parent but record their source", () => {
    const h = harness();
    h.connection.db.prepare("update tasks set origin = 'chat_wake' where id = ?").run(h.sourceTaskId);
    const result = dispatchAgentTool(h.deps, h.ctx, call("create_task", { title: "From chat", description: "d" }));
    const childId = /task_id=([^)\s]+)\)/.exec(result)![1];
    const row = h.connection.db.prepare("select parent_task_id, handoff_json from tasks where id = ?").get(childId) as { parent_task_id: string | null; handoff_json: string };
    expect(row.parent_task_id).toBeNull();
    expect(JSON.parse(row.handoff_json).sourceTaskId).toBe(h.sourceTaskId);
    h.connection.close();
  });
});

describe("delegation from a vanished task", () => {
  test("fails before creating anything", () => {
    const h = harness();
    h.connection.db.prepare("delete from tasks where id = ?").run(h.sourceTaskId);
    expect(dispatchAgentTool(h.deps, h.ctx, call("create_task", { title: "Orphan", description: "d" })))
      .toBe(`ERROR: The task this run executes (${h.sourceTaskId}) no longer exists.`);
    expect(h.connection.db.prepare("select count(*) as n from tasks where title = 'Orphan'").get()).toEqual({ n: 0 });
    h.connection.close();
  });
});
