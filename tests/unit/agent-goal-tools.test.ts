import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { completeGoalTool, type GoalCompletionArgs } from "../../src/main/services/agent-goal-tools";
import { dispatchAgentTool, type AgentToolContext, type AgentToolDeps } from "../../src/main/services/agent-tools";
import type { ProviderService } from "../../src/main/services/provider-service";
import type { ToolCall } from "../../src/main/services/provider-tool-turn";

type Auditor = ProviderService["runToolTurn"];
type AuditorInput = Parameters<Auditor>[0];
type AuditorTurn = Awaited<ReturnType<Auditor>>;

function turnOf(text: string, toolCalls: ToolCall[] = []): AuditorTurn {
  return { text, toolCalls, rawResponseJson: "{}", requestId: `req_${randomUUID()}` };
}

const workspaceRoot = join(tmpdir(), `ac-goal-audit-${randomUUID()}`);
mkdirSync(join(workspaceRoot, "src"), { recursive: true });
writeFileSync(join(workspaceRoot, "src", "index.ts"), "export const app = () => 'running';\n");

afterAll(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

interface Harness {
  connection: DatabaseConnection;
  deps: AgentToolDeps;
  orgId: string;
  ceoId: string;
  staffId: string;
  goalId: string;
  providerId: string;
}

function createHarness(): Harness {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-goal-tool-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  let ceoId = "";
  let staffId = "";
  let goalId = "";
  let providerId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "GoalCorp", employeeName: "Yang", mission: "m", goal: "g" });
    providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
    ceoId = organization.createAgent({
      orgId, name: "CEO", role: "CEO", department: "Executive",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null, roleLevel: "c_suite",
    });
    staffId = organization.createAgent({
      orgId, name: "Dev", role: "Engineer", department: "Engineering",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 10000, managerAgentId: ceoId, roleLevel: "staff",
    });
    goalId = organization.createGoal({ orgId, title: "Ship it", description: "For real.", ownerAgentId: ceoId });
  });
  return { connection, deps: { db: connection.db, organization, chat: new ChatService(connection.db) }, orgId, ceoId, staffId, goalId, providerId };
}

function call(args: Record<string, unknown>): ToolCall {
  return { id: `call_${randomUUID()}`, name: "complete_goal", arguments: args };
}

function argsFor(h: Harness, agentId: string, auditor: Auditor, toolCall: ToolCall, inputBudgetTokens = 112_000): GoalCompletionArgs {
  const ctx: AgentToolContext = {
    orgId: h.orgId,
    agent: { id: agentId, modelProviderId: h.providerId, modelId: "gpt-5.4" },
    taskProjectId: null,
    taskGoalId: h.goalId, taskId: null, sourceThreadId: null,
    workspace: { id: "wsp_audit", localPath: workspaceRoot, writeAccess: true },
  };
  return { deps: h.deps, ctx, providers: { runToolTurn: auditor }, providerId: h.providerId, workspaceId: null, inputBudgetTokens, call: toolCall };
}

function goalStatus(h: Harness): string {
  return (h.connection.db.prepare("select status from goals where id = ?").get(h.goalId) as { status: string }).status;
}

describe("complete_goal with independent audit", () => {
  test("an approving auditor closes the goal; the auditor gets read-only workspace access", async () => {
    const h = createHarness();
    const seenTools: string[][] = [];
    const replay = { format: "anthropic" as const, content: [{ type: "thinking", thinking: "check", signature: "SIG" }] };
    let turns = 0;
    const auditor = async (input: AuditorInput): Promise<AuditorTurn> => {
      seenTools.push(input.tools.map((tool) => tool.name));
      turns += 1;
      if (turns === 1) {
        return { ...turnOf("Inspecting.", [{ id: "c1", name: "read_file", arguments: { path: "src/index.ts" } }]), replay };
      }
      const readResult = input.messages.at(-1);
      expect(readResult?.role).toBe("tool");
      expect(input.messages.at(-2)).toMatchObject({ role: "assistant", replay });
      return turnOf("The implementation exists and runs. <approved/>");
    };

    const output = await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ evidence: "src/index.ts implements the app and runs." })));
    expect(output).toContain("achieved");
    expect(goalStatus(h)).toBe("achieved");
    // The auditor never receives run_command — inspection is read-only.
    expect(seenTools.every((tools) => !tools.includes("run_command"))).toBe(true);
    expect(seenTools[0]).toContain("read_file");
    h.connection.close();
  });

  test("a disapproving auditor keeps the goal open and returns the gap to the caller", async () => {
    const h = createHarness();
    const auditor = async (): Promise<AuditorTurn> => turnOf("<disapproved/> Only planning documents exist; there is no implementation.");
    const output = await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ evidence: "We wrote a very thorough plan." })));
    expect(output).toContain("audit rejected");
    expect(output).toContain("no implementation");
    expect(goalStatus(h)).toBe("active");
    h.connection.close();
  });

  test("work held for board review keeps the goal open, even when held while the audit runs", async () => {
    const h = createHarness();
    const hold = () => h.connection.db.prepare(`
      insert into held_deliverables(id, org_id, approval_id, kind, goal_id, title, doc_type, content, state, created_at)
      values (?, ?, 'app_x', 'document_create', ?, 'Launch memo', 'memo', 'draft', 'held', ?)
    `).run(`hld_${randomUUID()}`, h.orgId, h.goalId, new Date().toISOString());
    const auditor = async (): Promise<AuditorTurn> => {
      hold();
      return turnOf("<approved/>");
    };
    const output = await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ evidence: "src/index.ts works" })));
    expect(output).toBe('ERROR: Goal "Ship it" has work awaiting board review (Launch memo); it is not written yet, so the goal cannot be achieved.');
    expect(goalStatus(h)).toBe("active");
    h.connection.close();
  });

  test("no explicit approval means not achieved", async () => {
    const h = createHarness();
    const auditor = async (): Promise<AuditorTurn> => turnOf("Looks plausible I guess.");
    const output = await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ evidence: "Trust me." })));
    expect(output).toContain("audit rejected");
    expect(goalStatus(h)).toBe("active");
    h.connection.close();
  });

  test("permission and argument gates run before any audit spend", async () => {
    const h = createHarness();
    let auditorCalls = 0;
    const auditor = async (): Promise<AuditorTurn> => {
      auditorCalls += 1;
      return turnOf("<approved/>");
    };

    // Staff cannot complete a goal they do not own.
    expect(await completeGoalTool(argsFor(h, h.staffId, auditor, call({ evidence: "done" })))).toContain("ERROR");
    // Evidence is mandatory.
    expect(await completeGoalTool(argsFor(h, h.ceoId, auditor, call({})))).toContain("ERROR");
    // A task without a goal has nothing to complete.
    const detached = argsFor(h, h.ceoId, auditor, call({ evidence: "done" }));
    detached.ctx.taskGoalId = null;
    expect(await completeGoalTool(detached)).toContain("ERROR");

    expect(auditorCalls).toBe(0);
    expect(goalStatus(h)).toBe("active");

    // Once achieved, a second attempt reports the state instead of re-auditing.
    await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ evidence: "src/index.ts works" })));
    expect(goalStatus(h)).toBe("achieved");
    expect(await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ evidence: "again" })))).toContain("already achieved");
    expect(auditorCalls).toBe(1);
    h.connection.close();
  });
});

function toolCtx(h: Harness, agentId: string): AgentToolContext {
  return {
    orgId: h.orgId,
    agent: { id: agentId, modelProviderId: h.providerId, modelId: "gpt-5.4" },
    taskProjectId: null,
    taskGoalId: null, taskId: null, sourceThreadId: null,
    workspace: null,
  };
}

function dispatch(h: Harness, agentId: string, name: string, args: Record<string, unknown>): string {
  return dispatchAgentTool(h.deps, toolCtx(h, agentId), { id: `call_${randomUUID()}`, name, arguments: args });
}

describe("update_goal", () => {
  test("the CEO rewrites an active goal and the change is audited", () => {
    const h = createHarness();
    const output = dispatch(h, h.ceoId, "update_goal", {
      goal_id: h.goalId,
      title: "Ship the SMB dashboard",
      description: "Pivot from consumer to SMB analytics.",
    });
    expect(output).toContain(`Goal updated: "Ship the SMB dashboard"`);
    expect(output).toContain(`(was "Ship it")`);

    const goal = h.connection.db.prepare("select title, description, status from goals where id = ?").get(h.goalId) as
      { title: string; description: string; status: string };
    expect(goal).toEqual({ title: "Ship the SMB dashboard", description: "Pivot from consumer to SMB analytics.", status: "active" });

    const audit = h.connection.db.prepare(
      "select count(*) as count from audit_events where org_id = ? and entity_type = 'goal' and entity_id = ? and action = 'updated'",
    ).get(h.orgId, h.goalId) as { count: number };
    expect(audit.count).toBe(1);
    h.connection.close();
  });

  test("a description-only change keeps the title", () => {
    const h = createHarness();
    dispatch(h, h.ceoId, "update_goal", { goal_id: h.goalId, description: "Same goal, sharper scope." });
    const goal = h.connection.db.prepare("select title, description from goals where id = ?").get(h.goalId) as
      { title: string; description: string };
    expect(goal).toEqual({ title: "Ship it", description: "Same goal, sharper scope." });
    h.connection.close();
  });

  test("staff who do not own the goal are refused and nothing changes", () => {
    const h = createHarness();
    const output = dispatch(h, h.staffId, "update_goal", { goal_id: h.goalId, title: "Hijacked" });
    expect(output).toContain("ERROR");
    const goal = h.connection.db.prepare("select title from goals where id = ?").get(h.goalId) as { title: string };
    expect(goal.title).toBe("Ship it");
    h.connection.close();
  });

  test("an unknown goal id and an empty change are both loud errors", () => {
    const h = createHarness();
    expect(dispatch(h, h.ceoId, "update_goal", { goal_id: "gol_missing", title: "x" })).toContain("company_status");
    expect(dispatch(h, h.ceoId, "update_goal", { goal_id: h.goalId })).toContain("ERROR");
    h.connection.close();
  });

  test("a non-active goal reports its state instead of changing", () => {
    const h = createHarness();
    h.connection.db.prepare("update goals set status = 'achieved' where id = ?").run(h.goalId);
    const output = dispatch(h, h.ceoId, "update_goal", { goal_id: h.goalId, title: "Too late" });
    expect(output).toContain("achieved");
    const goal = h.connection.db.prepare("select title from goals where id = ?").get(h.goalId) as { title: string };
    expect(goal.title).toBe("Ship it");
    h.connection.close();
  });
});

describe("company_status", () => {
  test("reports goals with real-work task counts and hides wake-task bookkeeping", () => {
    const h = createHarness();
    h.connection.transaction(() => {
      h.deps.organization.createTask({
        orgId: h.orgId, title: "Build the ingestion pipeline", description: "d", status: "in_progress",
        assigneeAgentId: h.staffId, risk: "medium", projectId: null, goalId: h.goalId,
        workspaceId: null, priority: "high", requiresFilesystem: false,
      });
      h.deps.organization.createTask({
        orgId: h.orgId, title: "Write the launch post", description: "d", status: "done",
        assigneeAgentId: h.staffId, risk: "low", projectId: null, goalId: h.goalId,
        workspaceId: null, priority: "normal", requiresFilesystem: false,
      });
      h.deps.organization.createTask({
        orgId: h.orgId, title: "Reply to CEO", description: "d", status: "backlog",
        assigneeAgentId: h.staffId, risk: "low", projectId: null, goalId: null,
        workspaceId: null, priority: "high", requiresFilesystem: false, origin: "chat_wake",
      });
    });

    // createGoal materializes a kickoff task, so the goal starts with one
    // backlog item of real work before the two tasks this test adds.
    const output = dispatch(h, h.ceoId, "company_status", {});
    expect(output).toContain(`[active] "Ship it" (goal_id=${h.goalId}, owner: CEO) — 1 backlog, 1 in flight, 1 done`);
    expect(output).toContain("Real work tasks: 3 total — 1 backlog, 1 in progress, 0 in review, 1 done");
    expect(output).toContain(`"Build the ingestion pipeline" — in_progress, Dev`);
    expect(output).toContain(`"Write the launch post"`);
    expect(output).not.toContain("Reply to CEO");
    expect(output).toContain("Team: 2 active agents");
    h.connection.close();
  });

  test("only officers can pull the company-wide status", () => {
    const h = createHarness();
    const output = dispatch(h, h.staffId, "company_status", {});
    expect(output).toContain("ERROR");
    expect(output).toContain("Ask the CEO");
    h.connection.close();
  });

  test("an audit that outgrows the context budget fails as an error instead of sending an oversized request", async () => {
    const h = createHarness();
    let calls = 0;
    const auditor = async (): Promise<AuditorTurn> => {
      calls += 1;
      return { text: "", toolCalls: [], rawResponseJson: "{}", requestId: "r" };
    };
    const output = await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ evidence: "证".repeat(5_000) }), 3_000));
    expect(output).toMatch(/^ERROR: This run needs ~\d+ input tokens but the provider's context window leaves 3000/);
    expect(calls).toBe(0);
    expect(goalStatus(h)).toBe("active");
    h.connection.close();
  });
});
