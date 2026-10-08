import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";

function harness(reviewDeliverables: boolean) {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-docs-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  let agentId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "D", employeeName: "Y", mission: "m", goal: "g" });
    agentId = organization.createAgent({ orgId, name: "Ana", role: "PM", department: "Product", modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null });
  });
  connection.db.prepare("update organizations set review_deliverables = ? where id = ?").run(reviewDeliverables ? 1 : 0, orgId);
  const ctx: AgentToolContext = {
    orgId, agent: { id: agentId, modelProviderId: null, modelId: null },
    taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null,
  };
  const run = (name: string, args: Record<string, unknown>) =>
    dispatchAgentTool({ db: connection.db, organization, chat: new ChatService(connection.db) }, ctx, { id: `c_${randomUUID()}`, name, arguments: args });
  return { connection, orgId, run };
}

describe("agent document tools", () => {
  test("documents an agent wrote can be found, read in pages, and updated", () => {
    const h = harness(false);
    const created = h.run("create_document", { title: "Booking PRD", doc_type: "prd", content: Array.from({ length: 3000 }, (_, i) => `Requirement ${i + 1}: booking flow`).join("\n") });
    const docId = /doc_id=(doc_\w+)/.exec(created)![1];
    h.run("create_document", { title: "Q3 Report", doc_type: "report", content: "Revenue grew." });

    expect(h.run("list_documents", { query: "booking" })).toMatch(new RegExp(`^Booking PRD \\(doc_id=${docId}, prd, draft, \\d+ chars`));
    expect(h.run("list_documents", { doc_type: "report" })).toMatch(/^Q3 Report \(doc_id=doc_\w+, report/);
    expect(h.run("list_documents", { query: "kubernetes" })).toBe('No documents match "kubernetes".');

    const page = h.run("read_document", { doc_id: docId });
    expect(page.startsWith("Booking PRD (prd, draft)\n\n[lines 1-")).toBe(true);
    expect(page).toContain("[more: pass start_line=");
    expect(h.run("read_document", { doc_id: docId, search: "Requirement 2999:" })).toContain("2999: Requirement 2999: booking flow");

    expect(h.run("update_document", { doc_id: docId, content: "Requirement 1: rebooking", reason: "Scope cut" })).toBe(`Updated document "Booking PRD" (doc_id=${docId}).`);
    expect(h.run("read_document", { doc_id: docId })).toBe("Booking PRD (prd, draft)\n\nRequirement 1: rebooking");
    expect(h.run("update_document", { doc_id: docId, content: "x" })).toBe('ERROR: "reason" is required.');
    expect(h.run("read_document", { doc_id: "doc_missing" })).toBe('ERROR: No document with doc_id "doc_missing".');
    expect(h.run("read_document", { doc_id: docId, search: 123 })).toBe('ERROR: "search" is required.');
    expect(h.run("list_documents", { doc_type: "novel" })).toBe('ERROR: "doc_type" must be one of: prd, spec, memo, report, runbook, proposal, policy, guide.');
    h.connection.close();
  });

  test("in review mode an update goes to Approvals", () => {
    const h = harness(true);
    const docId = /doc_id=(doc_\w+)/.exec(h.run("create_document", { title: "Policy", doc_type: "policy", content: "v1" }))![1];
    expect(h.run("update_document", { doc_id: docId, content: "v2", reason: "Tighter wording" })).toContain("queued for board review");
    const approvals = h.connection.db.prepare("select title from approvals where org_id = ? and kind = 'deliverable_review' order by created_at").all(h.orgId);
    expect(approvals).toEqual([{ title: "Review policy: Policy" }, { title: "Review policy update: Policy" }]);
    h.connection.close();
  });
});
