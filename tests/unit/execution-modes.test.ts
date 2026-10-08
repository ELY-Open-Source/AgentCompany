import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";
import { ApprovalService } from "../../src/main/services/approval-service";
import { requireAssignedAgent } from "../../src/main/services/task-run-preparation";
import type { TaskExecutionTaskRow } from "../../src/main/services/task-prompts";

function call(name: string, args: Record<string, unknown>) {
  return { id: `call_${randomUUID()}`, name, arguments: args };
}

interface Harness {
  connection: DatabaseConnection;
  orgId: string;
  ceoId: string;
  ctx: AgentToolContext;
  deps: { db: DatabaseConnection["db"]; organization: OrganizationService; chat: ChatService };
}

function harness(mode: "ai_ceo" | "ai_cofounder"): Harness {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-mode-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  const workspaceRoot = join(tmpdir(), `ac-mode-ws-${randomUUID()}`);
  mkdirSync(workspaceRoot, { recursive: true });
  let orgId = "";
  let ceoId = "";
  let workspaceId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({
      organizationName: "OrbitOps",
      employeeName: "Yang",
      mission: "m",
      goal: "g",
      executionMode: mode,
      autoApproveHires: mode === "ai_ceo",
      reviewDeliverables: mode === "ai_cofounder",
    });
    const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
    ceoId = organization.createAgent({
      orgId, name: "CEO", role: "CEO", department: "Executive",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null, roleLevel: "c_suite",
    });
    workspaceId = organization.createWorkspace({ orgId, name: "HQ", localPath: workspaceRoot, projectId: null });
  });
  return {
    connection,
    orgId,
    ceoId,
    ctx: {
      orgId,
      agent: { id: ceoId, modelProviderId: null, modelId: null },
      taskProjectId: null,
      taskGoalId: null, taskId: null, sourceThreadId: null,
      workspace: { id: workspaceId, localPath: workspaceRoot, writeAccess: true },
    },
    deps: { db: connection.db, organization, chat: new ChatService(connection.db) },
  };
}

function pendingApprovals(h: Harness, kind: string): Array<{ state: string; source_entity_type: string | null }> {
  return h.connection.db.prepare(
    "select state, source_entity_type from approvals where org_id = ? and kind = ?",
  ).all(h.orgId, kind) as Array<{ state: string; source_entity_type: string | null }>;
}

describe("execution modes", () => {
  test("AI Co-Founder mode queues every deliverable and document for board review", () => {
    const h = harness("ai_cofounder");
    const wrote = dispatchAgentTool(h.deps, h.ctx, call("write_deliverable", { path: "plan/business-plan.md", content: "# Plan" }));
    expect(wrote).toContain("queued for board review");
    const doc = dispatchAgentTool(h.deps, h.ctx, call("create_document", { title: "Launch memo", doc_type: "memo", content: "Ship it." }));
    expect(doc).toContain("queued for board review");

    const reviews = pendingApprovals(h, "deliverable_review");
    expect(reviews).toHaveLength(2);
    expect(reviews.every((review) => review.state === "pending")).toBe(true);
    expect(reviews.map((review) => review.source_entity_type).sort()).toEqual(["document", "file"]);
  });

  test("AI CEO mode ships deliverables without review", () => {
    const h = harness("ai_ceo");
    const wrote = dispatchAgentTool(h.deps, h.ctx, call("write_deliverable", { path: "plan/business-plan.md", content: "# Plan" }));
    expect(wrote).not.toContain("board review");
    dispatchAgentTool(h.deps, h.ctx, call("create_document", { title: "Launch memo", doc_type: "memo", content: "Ship it." }));
    expect(pendingApprovals(h, "deliverable_review")).toHaveLength(0);
  });

  test("AI Co-Founder mode holds above-threshold hires; AI CEO mode clears them", () => {
    // Hiring policies require review above $5,000/month; the mode decides
    // whether that review waits for the operator or clears automatically.
    const hireAva = (h: Harness) => {
      const providerId = (h.connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(h.orgId) as { id: string }).id;
      h.connection.transaction(() => h.deps.organization.createAgent({
        orgId: h.orgId, name: "Ava", role: "Designer", department: "Product",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 600000, managerAgentId: h.ceoId,
      }));
    };

    const cofounder = harness("ai_cofounder");
    hireAva(cofounder);
    const held = cofounder.connection.db.prepare(
      "select state from approvals where org_id = ? and kind = 'agent_hire' and title like '%Ava%'",
    ).get(cofounder.orgId) as { state: string };
    expect(held.state).toBe("pending");

    const ceoMode = harness("ai_ceo");
    hireAva(ceoMode);
    const cleared = ceoMode.connection.db.prepare(
      "select state from approvals where org_id = ? and kind = 'agent_hire' and title like '%Ava%'",
    ).get(ceoMode.orgId) as { state: string };
    expect(cleared.state).toBe("approved");
  });

  test("a hire held for review is not on staff until approved, and a declined one never is", () => {
    const h = harness("ai_cofounder");
    const db = h.connection.db;
    const providerId = (db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(h.orgId) as { id: string }).id;
    const hire = (name: string) => h.connection.transaction(() => h.deps.organization.createAgent({
      orgId: h.orgId, name, role: "Designer", department: "Product",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 600000, managerAgentId: h.ceoId,
    }));
    const lifecycle = (id: string) => (db.prepare("select lifecycle from agents where id = ?").get(id) as { lifecycle: string }).lifecycle;
    const identities = (id: string) => (db.prepare("select count(*) as n from service_identities where agent_id = ?").get(id) as { n: number }).n;
    const memberships = (id: string) => (db.prepare("select count(*) as n from chat_memberships where principal_type = 'agent' and principal_id = ?").get(id) as { n: number }).n;
    const runAs = (id: string) => requireAssignedAgent(db, h.orgId, { assignee_agent_id: id } as TaskExecutionTaskRow);
    const approvalOf = (name: string) => (db.prepare("select id from approvals where org_id = ? and kind = 'agent_hire' and title = ?").get(h.orgId, `Review hire: ${name}`) as { id: string }).id;
    const employeeId = (db.prepare("select id from employees where org_id = ?").get(h.orgId) as { id: string }).id;
    const approvals = new ApprovalService(db);

    const ava = hire("Ava");
    expect([lifecycle(ava), identities(ava), memberships(ava)]).toEqual(["pending_hire", 0, 0]);
    expect(() => runAs(ava)).toThrow("Ava is not hired yet: the hire awaits approval.");
    expect(() => hire("ava")).toThrow('An agent named "ava" is already on staff or awaiting approval. Pick a different name.');
    const channel = h.connection.transaction(() => h.deps.chat.createSpace({ orgId: h.orgId, name: "design", topic: "t", spaceType: "project", visibility: "workspace" }));
    expect(memberships(ava)).toBe(0);
    expect(() => h.connection.transaction(() => h.deps.chat.createSpace({ orgId: h.orgId, name: "ava-room", topic: "t", spaceType: "project", visibility: "restricted", memberAgentIds: [ava] })))
      .toThrow("Ava is not on staff, so cannot join a channel.");
    expect(channel).toBeTruthy();
    h.connection.transaction(() => approvals.decide({ orgId: h.orgId, approvalId: approvalOf("Ava"), state: "approved", decidedByEmployeeId: employeeId }));
    expect(lifecycle(ava)).toBe("active");
    expect(identities(ava)).toBe(1);
    expect(memberships(ava)).toBeGreaterThan(0);
    expect(runAs(ava).id).toBe(ava);

    const bo = hire("Bo");
    h.connection.transaction(() => approvals.decide({ orgId: h.orgId, approvalId: approvalOf("Bo"), state: "declined", decidedByEmployeeId: employeeId }));
    expect([lifecycle(bo), identities(bo), memberships(bo)]).toEqual(["declined", 0, 0]);
    expect(() => runAs(bo)).toThrow("Bo's hire was declined; reassign the task.");
  });
});
