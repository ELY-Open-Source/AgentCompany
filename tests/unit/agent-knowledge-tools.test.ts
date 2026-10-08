import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";
import { relevantKnowledgeLines } from "../../src/main/services/agent-knowledge-tools";

function harness() {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-knowledge-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  let agentId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "K", employeeName: "Y", mission: "m", goal: "g" });
    agentId = organization.createAgent({ orgId, name: "Ana", role: "Engineer", department: "Engineering", modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null });
  });
  const ctx: AgentToolContext = {
    orgId, agent: { id: agentId, modelProviderId: null, modelId: null },
    taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null,
  };
  const run = (name: string, args: Record<string, unknown>) =>
    dispatchAgentTool({ db: connection.db, organization, chat: new ChatService(connection.db) }, ctx, { id: `c_${randomUUID()}`, name, arguments: args });
  return { connection, orgId, agentId, run };
}

describe("knowledge in the execution chain", () => {
  test("agents record knowledge and find it again by search", () => {
    const h = harness();
    expect(h.run("record_knowledge", { topic: "Booking storage", content: "The booking API stores orders in Postgres, not MySQL.", category: "decision", importance: "high" }))
      .toMatch(/^Recorded knowledge entry kne_/);
    h.run("record_knowledge", { topic: "Brand colors", content: "Use teal and sand.", category: "preference" });
    const row = h.connection.db.prepare("select source_type, source_id, importance from knowledge_entries where topic = 'Booking storage'").get();
    expect(row).toEqual({ source_type: "agent", source_id: h.agentId, importance: "high" });

    const found = h.run("search_knowledge", { query: "which database for bookings postgres" });
    expect(found).toContain("Booking storage [decision, high");
    expect(found).not.toContain("Brand colors");
    expect(h.run("search_knowledge", { query: "kubernetes" })).toBe('No knowledge matches "kubernetes".');
    expect(h.run("record_knowledge", { topic: "x", content: "y", category: "z", importance: "urgent" })).toBe('ERROR: "importance" must be one of: low, normal, high.');
    expect(h.run("record_knowledge", { topic: "x", content: "y", category: "z", importance: "" })).toBe('ERROR: "importance" must be one of: low, normal, high.');
    expect(h.run("search_knowledge", { query: "postgres", limit: "nonsense" })).toBe('ERROR: "limit" must be a whole number from 1 to 30.');
    expect(h.run("search_knowledge", { query: "postgres", limit: 0 })).toBe('ERROR: "limit" must be a whole number from 1 to 30.');
    expect(h.run("read_messages", { channel: "general", limit: 99 })).toBe('ERROR: "limit" must be a whole number from 1 to 30.');
    expect(h.connection.db.prepare("select count(*) as n from knowledge_entries where topic = 'x'").get()).toEqual({ n: 0 });
    h.connection.close();
  });

  test("only knowledge relevant to the task enters its prompt", () => {
    const h = harness();
    h.run("record_knowledge", { topic: "Booking storage", content: "The booking API stores orders in Postgres.", category: "decision" });
    h.run("record_knowledge", { topic: "Brand colors", content: "Use teal and sand.", category: "preference" });
    const lines = relevantKnowledgeLines(h.connection.db, h.orgId, "Build the booking API").join("\n");
    expect(lines).toContain("Company knowledge that may apply (search_knowledge for more):");
    expect(lines).toContain("- Booking storage [decision, normal");
    expect(lines).not.toContain("Brand colors");
    expect(relevantKnowledgeLines(h.connection.db, h.orgId, "Plan the offsite")).toEqual([]);
    h.connection.close();
  });
});
