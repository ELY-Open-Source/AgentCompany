import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { completeGoalTool, type GoalCompletionArgs } from "../../src/main/services/agent-goal-tools";
import type { AgentToolContext, AgentToolDeps } from "../../src/main/services/agent-tools";
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

function argsFor(h: Harness, agentId: string, auditor: Auditor, toolCall: ToolCall): GoalCompletionArgs {
  const ctx: AgentToolContext = {
    orgId: h.orgId,
    agent: { id: agentId, modelProviderId: h.providerId, modelId: "gpt-5.4" },
    taskProjectId: null,
    taskGoalId: h.goalId,
    workspace: { id: "wsp_audit", localPath: workspaceRoot, writeAccess: true },
  };
  return { deps: h.deps, ctx, providers: { runToolTurn: auditor }, providerId: h.providerId, workspaceId: null, call: toolCall };
}

function goalStatus(h: Harness): string {
  return (h.connection.db.prepare("select status from goals where id = ?").get(h.goalId) as { status: string }).status;
}

describe("complete_goal with independent audit", () => {
  test("an approving auditor closes the goal; the auditor gets read-only workspace access", async () => {
    const h = createHarness();
    const seenTools: string[][] = [];
    let turns = 0;
    const auditor = async (input: AuditorInput): Promise<AuditorTurn> => {
      seenTools.push(input.tools.map((tool) => tool.name));
      turns += 1;
      if (turns === 1) {
        return turnOf("Inspecting.", [{ id: "c1", name: "read_file", arguments: { path: "src/index.ts" } }]);
      }
      const readResult = input.messages.at(-1);
      expect(readResult?.role).toBe("tool");
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
