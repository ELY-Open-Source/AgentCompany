import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";
import { relevantKnowledgeLines } from "../../src/main/services/agent-knowledge-tools";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../src/shared/domain";

function harness() {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-knowledge-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  let agentId = "";
  let otherAgentId = "";
  let projectA = "";
  let projectB = "";
  let taskA = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "K", employeeName: "Y", mission: "m", goal: "g" });
    agentId = organization.createAgent({ orgId, name: "Ana", role: "Engineer", department: "Engineering", modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null });
    otherAgentId = organization.createAgent({ orgId, name: "Ben", role: "Engineer", department: "Engineering", modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null });
    projectA = organization.createProject({ orgId, name: "Bookings", description: "d", goalId: null, leadAgentId: null });
    projectB = organization.createProject({ orgId, name: "Billing", description: "d", goalId: null, leadAgentId: null });
    taskA = organization.createTask({
      orgId, title: "Build bookings", description: "d", status: TASK_STATUS.BACKLOG, assigneeAgentId: agentId,
      risk: RISK_LEVEL.LOW, projectId: projectA, goalId: null, workspaceId: null, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false,
    });
  });
  const ctx = (agent: string, projectId: string | null, taskId: string | null): AgentToolContext => ({
    orgId, agent: { id: agent, modelProviderId: null, modelId: null },
    taskProjectId: projectId, taskGoalId: null, taskId, sourceThreadId: null, workspace: null,
  });
  const run = (context: AgentToolContext, name: string, args: Record<string, unknown>) =>
    dispatchAgentTool({ db: connection.db, organization, chat: new ChatService(connection.db) }, context, { id: `c_${randomUUID()}`, name, arguments: args });
  const reader = (agent: string, projectId: string | null, taskId: string | null) => ({ orgId, agentId: agent, projectId, goalId: null, taskId });
  return { connection, orgId, agentId, otherAgentId, projectA, projectB, taskA, ctx, run, reader };
}

describe("knowledge in the execution chain", () => {
  test("agents record knowledge and find it again by search", () => {
    const h = harness();
    const ana = h.ctx(h.agentId, null, null);
    expect(h.run(ana, "record_knowledge", { topic: "Booking storage", content: "The booking API stores orders in Postgres, not MySQL.", category: "decision", importance: "high" }))
      .toMatch(/^Recorded knowledge entry kne_/);
    h.run(ana, "record_knowledge", { topic: "Brand colors", content: "Use teal and sand.", category: "preference" });
    const row = h.connection.db.prepare("select source_type, source_id, importance, scope_type, scope_id from knowledge_entries where topic = 'Booking storage'").get();
    expect(row).toEqual({ source_type: "agent", source_id: h.agentId, importance: "high", scope_type: "organization", scope_id: null });

    const found = h.run(ana, "search_knowledge", { query: "which database for bookings postgres" });
    expect(found).toContain("Booking storage [decision, high, organization, id=");
    expect(found).not.toContain("Brand colors");
    expect(h.run(ana, "search_knowledge", { query: "kubernetes" })).toBe('No knowledge matches "kubernetes".');
    expect(h.run(ana, "record_knowledge", { topic: "x", content: "y", category: "z", importance: "urgent" })).toBe('ERROR: "importance" must be one of: low, normal, high.');
    expect(h.run(ana, "record_knowledge", { topic: "x", content: "y", category: "z", importance: "" })).toBe('ERROR: "importance" must be one of: low, normal, high.');
    expect(h.run(ana, "search_knowledge", { query: "postgres", limit: "nonsense" })).toBe('ERROR: "limit" must be a whole number from 1 to 30.');
    expect(h.run(ana, "search_knowledge", { query: "postgres", limit: 0 })).toBe('ERROR: "limit" must be a whole number from 1 to 30.');
    expect(h.run(ana, "read_messages", { channel: "general", limit: 99 })).toBe('ERROR: "limit" must be a whole number from 1 to 30.');
    expect(h.connection.db.prepare("select count(*) as n from knowledge_entries where topic = 'x'").get()).toEqual({ n: 0 });
    h.connection.close();
  });

  test("only knowledge relevant to the task enters its prompt", () => {
    const h = harness();
    const ana = h.ctx(h.agentId, null, null);
    h.run(ana, "record_knowledge", { topic: "Booking storage", content: "The booking API stores orders in Postgres.", category: "decision" });
    h.run(ana, "record_knowledge", { topic: "Brand colors", content: "Use teal and sand.", category: "preference" });
    const lines = relevantKnowledgeLines(h.connection.db, h.reader(h.agentId, null, null), "Build the booking API").join("\n");
    expect(lines).toContain("Company knowledge that may apply (search_knowledge for more):");
    expect(lines).toContain("- Booking storage [decision, normal, organization");
    expect(lines).not.toContain("Brand colors");
    expect(relevantKnowledgeLines(h.connection.db, h.reader(h.agentId, null, null), "Plan the offsite")).toEqual([]);
    h.connection.close();
  });
});

describe("knowledge scope and validity", () => {
  test("project, task, and agent scopes only reach readers inside them", () => {
    const h = harness();
    const inTask = h.ctx(h.agentId, h.projectA, h.taskA);
    h.run(inTask, "record_knowledge", { topic: "Retry rule", content: "Booking payment retries twice.", category: "decision", scope: "project" });
    h.run(inTask, "record_knowledge", { topic: "Draft state", content: "Booking draft lives in drafts table.", category: "fact", scope: "task" });
    h.run(inTask, "record_knowledge", { topic: "My habit", content: "I prefer small booking commits.", category: "preference", scope: "agent" });
    const scopes = h.connection.db.prepare("select topic, scope_type, scope_id from knowledge_entries order by topic").all();
    expect(scopes).toEqual([
      { topic: "Draft state", scope_type: "task", scope_id: h.taskA },
      { topic: "My habit", scope_type: "agent", scope_id: h.agentId },
      { topic: "Retry rule", scope_type: "project", scope_id: h.projectA },
    ]);
    const seen = (reader: ReturnType<typeof h.reader>) => relevantKnowledgeLines(h.connection.db, reader, "booking").join("\n");
    const insideAll = seen(h.reader(h.agentId, h.projectA, h.taskA));
    expect(["Retry rule", "Draft state", "My habit"].every((topic) => insideAll.includes(topic))).toBe(true);
    const otherProject = seen(h.reader(h.otherAgentId, h.projectB, null));
    expect(otherProject).toBe("");
    const sameProjectOtherAgent = seen(h.reader(h.otherAgentId, h.projectA, null));
    expect(sameProjectOtherAgent).toContain("Retry rule");
    expect(sameProjectOtherAgent).not.toContain("Draft state");
    expect(sameProjectOtherAgent).not.toContain("My habit");
    expect(h.run(h.ctx(h.agentId, null, null), "record_knowledge", { topic: "x", content: "y", category: "z", scope: "project" }))
      .toBe("ERROR: This run has no project to scope knowledge to.");
    h.connection.close();
  });

  test("expired and superseded entries stop applying; replacements are tracked", () => {
    const h = harness();
    const ana = h.ctx(h.agentId, null, null);
    h.run(ana, "record_knowledge", { topic: "Promo code", content: "Booking promo SPRING applies.", category: "fact", valid_until: "2020-01-01T00:00:00Z" });
    const oldId = /kne_\w+/.exec(h.run(ana, "record_knowledge", { topic: "Booking price", content: "Booking costs 10 dollars.", category: "fact" }))![0];
    const newId = /kne_\w+/.exec(h.run(ana, "record_knowledge", { topic: "Booking price", content: "Booking costs 12 dollars.", category: "fact", supersedes: oldId }))![0];
    expect(h.connection.db.prepare("select superseded_by from knowledge_entries where id = ?").get(oldId)).toEqual({ superseded_by: newId });
    const found = h.run(ana, "search_knowledge", { query: "booking" });
    expect(found).toContain("12 dollars");
    expect(found).not.toContain("10 dollars");
    expect(found).not.toContain("SPRING");
    expect(h.run(ana, "record_knowledge", { topic: "p", content: "q", category: "fact", supersedes: oldId }))
      .toBe(`ERROR: Knowledge entry ${oldId} was already superseded by ${newId}.`);
    expect(h.run(ana, "record_knowledge", { topic: "p", content: "q", category: "fact", valid_until: "next week" }))
      .toBe('ERROR: "valid_until" must be a UTC ISO timestamp like 2026-12-31T00:00:00Z, got "next week".');
    expect(h.run(ana, "record_knowledge", { topic: "p", content: "q", category: "fact", valid_until: "" })).toBe('ERROR: "valid_until" is required.');
    expect(h.run(ana, "record_knowledge", { topic: "p", content: "q", category: "fact", supersedes: 123 })).toBe('ERROR: "supersedes" is required.');
    expect(h.connection.db.prepare("select count(*) as n from knowledge_entries where topic = 'p'").get()).toEqual({ n: 0 });

    h.connection.db.prepare("delete from knowledge_entries where id = ?").run(newId);
    expect(h.connection.db.prepare("select superseded_by from knowledge_entries where id = ?").get(oldId)).toEqual({ superseded_by: newId });
    expect(h.run(ana, "search_knowledge", { query: "booking" })).not.toContain("10 dollars");
    h.connection.close();
  });
});
