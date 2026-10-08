import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";

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
});
