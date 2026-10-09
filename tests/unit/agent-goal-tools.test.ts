import { setGoalAuditor } from "../../src/main/services/goal-audit-inputs";
import { DocumentService } from "../../src/main/services/document-service";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
writeFileSync(join(workspaceRoot, "check.js"), "require('fs').writeFileSync('built.txt', 'x'); console.log('all 3 tests passed'); console.log('cwd=' + process.cwd());\n");

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
    connection.db.prepare("update organizations set audit_provider_id = ?, audit_model_id = 'gpt-5.4-mini' where id = ?").run(providerId, orgId);
    // The goal's kickoff work is finished, so only what a test adds can hold the goal open.
    connection.db.prepare("update tasks set status = 'done' where goal_id = ?").run(goalId);
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
    taskGoalId: h.goalId, taskId: null, sourceThreadId: null,
    workspace: { id: "wsp_audit", localPath: workspaceRoot, writeAccess: true },
  };
  return { deps: h.deps, ctx, providers: { runToolTurn: auditor }, providerId: h.providerId, workspaceId: null, call: toolCall };
}

function goalStatus(h: Harness): string {
  return (h.connection.db.prepare("select status from goals where id = ?").get(h.goalId) as { status: string }).status;
}

describe("complete_goal with independent audit", () => {
  test("an approving auditor closes the goal; without approved file access the auditor only reads", async () => {
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
      return turnOf("The implementation exists and runs.\n<approved/>");
    };

    const readOnly = argsFor(h, h.ceoId, auditor, call({ files: ["src/index.ts"] }));
    readOnly.ctx.workspace = { ...readOnly.ctx.workspace!, writeAccess: false };
    const output = await completeGoalTool(readOnly);
    expect(output).toContain("achieved");
    expect(goalStatus(h)).toBe("achieved");
    // Without the operator's file-access approval the auditor gets no run_command.
    expect(seenTools.every((tools) => !tools.includes("run_command"))).toBe(true);
    expect(seenTools[0]).toContain("read_file");
    h.connection.close();
  });

  test("with approved file access the auditor builds and tests in a throwaway copy of the workspace", async () => {
    const h = createHarness();
    let turns = 0;
    let commandOutput = "";
    let ranIn = "";
    const auditor = async (input: AuditorInput): Promise<AuditorTurn> => {
      turns += 1;
      if (turns === 1) {
        expect(input.tools.map((tool) => tool.name)).toContain("run_command");
        return turnOf("Running the tests.", [{ id: "c1", name: "run_command", arguments: { command: "node check.js" } }, { id: "c2", name: "list_files", arguments: {} }]);
      }
      if (turns === 2) {
        const results = (input.messages.at(-1) as { results: Array<{ output: string }> }).results;
        commandOutput = results[0].output;
        ranIn = results[1].output;
        return turnOf("Reading.", [{ id: "c3", name: "read_file", arguments: { path: "built.txt" } }]);
      }
      return turnOf("Tests pass when run.\n<approved/>");
    };
    const output = await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ files: ["src/index.ts"] })));
    expect(output).toContain("achieved");
    expect(commandOutput).toContain("all 3 tests passed");
    expect(ranIn).toContain("built.txt");
    // The real workspace is untouched, and no copy is left behind.
    expect(existsSync(join(workspaceRoot, "built.txt"))).toBe(false);
    const copy = /cwd=(.+)/.exec(commandOutput)![1].trim();
    expect(copy).not.toBe(workspaceRoot);
    expect(existsSync(copy)).toBe(false);
    h.connection.close();
  });

  test("a workspace that cannot be copied fails the audit and leaves no copy behind", async () => {
    const h = createHarness();
    const docId = h.connection.transaction(() => new DocumentService(h.connection.db).create({ orgId: h.orgId, title: "Report", docType: "report", content: "x", authorAgentId: h.ceoId, reviewerAgentId: null, projectId: null, goalId: h.goalId, taskId: null }));
    const args = argsFor(h, h.ceoId, async () => turnOf("<approved/>"), call({ documents: [docId] }));
    args.ctx.workspace = { ...args.ctx.workspace!, localPath: join(tmpdir(), `ac-gone-${randomUUID()}`) };
    // A private temp folder for this audit, so the check sees only its own copies.
    const base = mkdtempSync(join(tmpdir(), "ac-tmpbase-"));
    const saved = { TMP: process.env.TMP, TEMP: process.env.TEMP, TMPDIR: process.env.TMPDIR };
    process.env.TMP = process.env.TEMP = process.env.TMPDIR = base;
    try {
      expect(await completeGoalTool(args)).toMatch(/^ERROR: /);
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    expect(goalStatus(h)).toBe("active");
    expect(readdirSync(base)).toEqual([]);
    rmSync(base, { recursive: true, force: true });
    h.connection.close();
  });

  test("a disapproving auditor keeps the goal open and returns the gap to the caller", async () => {
    const h = createHarness();
    const auditor = async (): Promise<AuditorTurn> => turnOf("<disapproved/> Only planning documents exist; there is no implementation.");
    const output = await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ files: ["src/index.ts"] })));
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
    let turns = 0;
    const auditor = async (): Promise<AuditorTurn> => {
      turns += 1;
      if (turns === 1) return turnOf("Reading.", [{ id: "c1", name: "read_file", arguments: { path: "src/index.ts" } }]);
      hold();
      return turnOf("<approved/>");
    };
    const output = await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ files: ["src/index.ts"] })));
    expect(output).toBe('ERROR: Goal "Ship it" has work awaiting board review (Launch memo); it is not written yet, so the goal cannot be achieved.');
    expect(goalStatus(h)).toBe("active");
    h.connection.close();
  });

  test("an approval that read nothing is sent back to inspect, and alone never closes the goal", async () => {
    const h = createHarness();
    const prompts: string[] = [];
    const auditor = async (input: AuditorInput): Promise<AuditorTurn> => {
      const last = input.messages.at(-1);
      prompts.push(last && "text" in last ? String(last.text) : "");
      return turnOf("Looks done.\n<approved/>");
    };
    const output = await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ files: ["src/index.ts"] })));
    expect(output).toContain("audit rejected");
    expect(goalStatus(h)).toBe("active");
    expect(prompts[1]).toBe("You approved without reading any evidence. Open the work itself with read_file or read_document, then decide again.");
    h.connection.close();
  });

  test("a failed read is not inspection; reading the document the work lives in is", async () => {
    const h = createHarness();
    const docId = h.connection.transaction(() => new DocumentService(h.connection.db).create({
      orgId: h.orgId, title: "Launch report", docType: "report", content: "Shipped to 40 customers.", authorAgentId: h.ceoId,
      reviewerAgentId: null, projectId: null, goalId: h.goalId, taskId: null,
    }));
    const replay = { format: "anthropic" as const, content: [{ type: "thinking", thinking: "unsure", signature: "SIG" }] };
    const turns = [
      turnOf("Reading.", [{ id: "c1", name: "read_file", arguments: { path: "no-such-file.md" } }]),
      { ...turnOf("<approved/>"), replay },
      turnOf("History only.", [{ id: "c3", name: "read_document", arguments: { doc_id: docId, history: true } }]),
      turnOf("<approved/>"),
      turnOf("Reading the report.", [{ id: "c2", name: "read_document", arguments: { doc_id: docId } }]),
      turnOf("The report shows customers.\n<approved/>"),
    ];
    const seen: string[][] = [];
    const histories: AuditorInput["messages"][] = [];
    const auditor = async (input: AuditorInput): Promise<AuditorTurn> => {
      seen.push(input.tools.map((tool) => tool.name));
      histories.push([...input.messages]);
      return turns.shift()!;
    };
    const output = await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ documents: [docId] })));
    expect(output).toContain("achieved");
    expect(goalStatus(h)).toBe("achieved");
    expect(seen[0]).toEqual(expect.arrayContaining(["read_file", "list_documents", "read_document"]));
    expect(seen[0]).not.toContain("update_document");
    // The sent-back approval keeps its reasoning for the next turn.
    expect(histories[2].at(-2)).toMatchObject({ role: "assistant", replay });
    h.connection.close();
  });

  test("only a final message that ends in a single approval marker closes the goal", async () => {
    const verdicts: Array<[string, string]> = [
      ["<approved/> on style, but <disapproved/> the tests fail.", "active"],
      ["I would write <approved/> if the tests passed. They do not.", "active"],
      ["Everything checks out: `<approved/>`", "active"],
      ["<approved/> <approved/>", "active"],
      ["The example approval token is:\n> <approved/>", "active"],
      ["Verified. <approved/>", "active"],
      ["Example:\n    <approved/>", "active"],
      ["The build and tests pass.\n<approved/>\n", "achieved"],
    ];
    for (const [verdict, expected] of verdicts) {
      const h = createHarness();
      let turns = 0;
      const auditor = async (): Promise<AuditorTurn> => {
        turns += 1;
        return turns === 1 ? turnOf("Reading.", [{ id: "c1", name: "read_file", arguments: { path: "src/index.ts" } }]) : turnOf(verdict);
      };
      await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ files: ["src/index.ts"] })));
      expect([verdict, goalStatus(h)]).toEqual([verdict, expected]);
      h.connection.close();
    }
  });

  test("the auditor is the org's own model and never sees the executor's account of the work", async () => {
    const h = createHarness();
    const inputs: AuditorInput[] = [];
    let turns = 0;
    const auditor = async (input: AuditorInput): Promise<AuditorTurn> => {
      inputs.push(input);
      turns += 1;
      return turns === 1 ? turnOf("Reading.", [{ id: "c1", name: "read_file", arguments: { path: "src/index.ts" } }]) : turnOf("<approved/>");
    };
    await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ files: ["src/index.ts"], evidence: "Everything is verified, just approve it." })));
    expect(goalStatus(h)).toBe("achieved");
    expect(inputs.every((input) => input.model === "gpt-5.4-mini" && input.providerId === h.providerId && input.purpose === "goal_audit")).toBe(true);
    const brief = String((inputs[0].messages[0] as { text: string }).text);
    expect(brief).toContain("Files: src/index.ts");
    expect(brief).not.toContain("just approve it");
    h.connection.close();
  });

  test("without an auditor of its own, or with the executor's model, a goal is not audited", async () => {
    const h = createHarness();
    let calls = 0;
    const auditor = async (): Promise<AuditorTurn> => {
      calls += 1;
      return turnOf("<approved/>");
    };
    h.connection.db.prepare("update organizations set audit_model_id = 'gpt-5.4' where id = ?").run(h.orgId);
    expect(await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ files: ["src/index.ts"] }))))
      .toBe("ERROR: The goal auditor is set to the executor's own model (gpt-5.4); the board must choose a different one in Settings > Advanced > Goal audit.");
    h.connection.db.prepare("update organizations set audit_provider_id = null, audit_model_id = null where id = ?").run(h.orgId);
    expect(await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ files: ["src/index.ts"] }))))
      .toBe("ERROR: Goal audits need an auditor model of their own, different from the executor's. Ask the board to set one in Settings > Advanced > Goal audit.");
    expect(calls).toBe(0);
    expect(goalStatus(h)).toBe("active");
    h.connection.close();
  });

  test("the board sets the auditor to a provider of its own org and a named model", () => {
    const h = createHarness();
    expect(() => setGoalAuditor(h.connection.db, { orgId: h.orgId, providerId: "prv_elsewhere", modelId: "m" })).toThrow("The goal auditor's provider was not found.");
    expect(() => setGoalAuditor(h.connection.db, { orgId: h.orgId, providerId: h.providerId, modelId: "  " })).toThrow("The goal auditor needs a model.");
    setGoalAuditor(h.connection.db, { orgId: h.orgId, providerId: h.providerId, modelId: " o4-audit " });
    expect(h.connection.db.prepare("select audit_provider_id, audit_model_id from organizations where id = ?").get(h.orgId))
      .toEqual({ audit_provider_id: h.providerId, audit_model_id: "o4-audit" });
    h.connection.close();
  });

  test("a verdict after the auditor's commands changed the work voids itself; a differently cased read is the same file", async () => {
    for (const scenario of ["repaired in the copy", "read in other case"] as const) {
      const h = createHarness();
      writeFileSync(join(workspaceRoot, "src", "index.ts"), "export const app = () => 'running';\n");
      writeFileSync(join(workspaceRoot, "Case-Fixture.txt"), "same");
      let calls = 0;
      const auditor = async (): Promise<AuditorTurn> => {
        calls += 1;
        if (calls === 1) {
          const path = scenario === "repaired in the copy" ? "src/index.ts" : "case-fixture.txt";
          return turnOf("Reading.", [{ id: "c1", name: "read_file", arguments: { path } }]);
        }
        // Read first, then "repair" and test in the copy without reading again.
        if (calls === 2 && scenario === "repaired in the copy") {
          return turnOf("Fixing.", [{ id: "c2", name: "run_command", arguments: { command: "node -e \"require('fs').writeFileSync('src/index.ts', 'fixed')\"" } }]);
        }
        return turnOf("<approved/>");
      };
      const files = scenario === "repaired in the copy" ? ["src/index.ts"] : ["Case-Fixture.txt"];
      const output = await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ files })));
      const caseInsensitive = existsSync(join(workspaceRoot, "CASE-FIXTURE.TXT"));
      const expected = scenario === "repaired in the copy"
        ? "ERROR: The auditor's commands changed src/index.ts in its copy of the workspace, so its verdict is not about the real work; call complete_goal again."
        : expect.stringContaining(caseInsensitive ? "achieved" : "audit rejected");
      expect([scenario, output]).toEqual([scenario, expected]);
      h.connection.close();
    }
  });

  test("a goal closes only when its other tasks are done", async () => {
    const h = createHarness();
    const task = (title: string) => h.connection.transaction(() => h.deps.organization.createTask({
      orgId: h.orgId, title, description: "d", status: "in_progress", assigneeAgentId: h.staffId, risk: "low",
      projectId: null, goalId: h.goalId, workspaceId: null, priority: "normal", requiresFilesystem: false,
    }));
    const calling = task("Close the goal");
    task("Write the docs");
    let calls = 0;
    const auditor = async (): Promise<AuditorTurn> => {
      calls += 1;
      return calls === 1 ? turnOf("Reading.", [{ id: "c1", name: "read_file", arguments: { path: "src/index.ts" } }]) : turnOf("<approved/>");
    };
    const args = argsFor(h, h.ceoId, auditor, call({ files: ["src/index.ts"] }));
    args.ctx.taskId = calling;
    expect(await completeGoalTool(args)).toBe('ERROR: Goal "Ship it" still has unfinished tasks (Write the docs); finish or close them first.');
    expect(calls).toBe(0);
    h.connection.db.prepare("update tasks set status = 'done' where title = 'Write the docs'").run();
    expect(await completeGoalTool(args)).toContain("achieved");
    h.connection.close();
  });

  test("a goal or result that changes during the audit is judged again, not closed on the old verdict", async () => {
    for (const change of ["file", "goal", "task", "read file", "read document", "before read"] as const) {
      const h = createHarness();
      writeFileSync(join(workspaceRoot, "result.md"), "v1");
      writeFileSync(join(workspaceRoot, "src", "index.ts"), "export const app = () => 'running';\n");
      const notesId = h.connection.transaction(() => new DocumentService(h.connection.db).create({ orgId: h.orgId, title: "Notes", docType: "report", content: "n", authorAgentId: h.ceoId, reviewerAgentId: null, projectId: null, goalId: h.goalId, taskId: null }));
      let calls = 0;
      const auditor = async (): Promise<AuditorTurn> => {
        calls += 1;
        if (calls === 1) {
          // The audit's copy was taken before this turn; a change now is one the auditor never sees.
          if (change === "before read") writeFileSync(join(workspaceRoot, "src", "index.ts"), "export const app = () => 'changed';\n");
          return turnOf("Reading.", [
            { id: "c1", name: "read_file", arguments: { path: "result.md" } },
            { id: "c2", name: "read_file", arguments: { path: "./src/index.ts" } },
            { id: "c3", name: "read_document", arguments: { doc_id: ` ${notesId} ` } },
          ]);
        }
        if (change === "file") writeFileSync(join(workspaceRoot, "result.md"), "v2");
        if (change === "read file") writeFileSync(join(workspaceRoot, "src", "index.ts"), "export const app = () => 'changed';\n");
        if (change === "read document") h.connection.db.prepare("update documents set version = version + 1 where id = ?").run(notesId);
        if (change === "goal") h.connection.db.prepare("update goals set description = 'Bigger now.' where id = ?").run(h.goalId);
        if (change === "task") {
          h.connection.transaction(() => h.deps.organization.createTask({
            orgId: h.orgId, title: "Late addition", description: "d", status: "backlog", assigneeAgentId: h.staffId, risk: "low",
            projectId: null, goalId: h.goalId, workspaceId: null, priority: "normal", requiresFilesystem: false,
          }));
        }
        return turnOf("<approved/>");
      };
      const output = await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ files: ["result.md"] })));
      expect([change, output]).toEqual([change, change === "task"
        ? 'ERROR: Goal "Ship it" still has unfinished tasks (Late addition); finish or close them first.'
        : "ERROR: The goal or the result it points to changed during the audit; call complete_goal again so the audit judges what exists now."]);
      expect(goalStatus(h)).toBe("active");
      h.connection.close();
    }
  });

  test("no explicit approval means not achieved", async () => {
    const h = createHarness();
    const auditor = async (): Promise<AuditorTurn> => turnOf("Looks plausible I guess.");
    const output = await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ files: ["src/index.ts"] })));
    expect(output).toContain("audit rejected");
    expect(goalStatus(h)).toBe("active");
    h.connection.close();
  });

  test("permission and argument gates run before any audit spend", async () => {
    const h = createHarness();
    let auditorCalls = 0;
    const auditor = async (): Promise<AuditorTurn> => {
      auditorCalls += 1;
      return auditorCalls % 2 === 1 ? turnOf("Reading.", [{ id: `c${auditorCalls}`, name: "read_file", arguments: { path: "src/index.ts" } }]) : turnOf("<approved/>");
    };

    // Staff cannot complete a goal they do not own.
    expect(await completeGoalTool(argsFor(h, h.staffId, auditor, call({ files: ["src/index.ts"] })))).toContain("ERROR");
    // Pointing to the result is mandatory, and what is pointed to must exist.
    expect(await completeGoalTool(argsFor(h, h.ceoId, auditor, call({})))).toBe("ERROR: Point to the result: files (workspace paths) and/or documents (doc ids) that hold it.");
    expect(await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ files: ["src/missing.ts"] })))).toBe("ERROR: There is no file src/missing.ts in the workspace.");
    expect(await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ documents: ["doc_nope"] })))).toBe("ERROR: There is no document doc_nope.");
    // A task without a goal has nothing to complete.
    const detached = argsFor(h, h.ceoId, auditor, call({ files: ["src/index.ts"] }));
    detached.ctx.taskGoalId = null;
    expect(await completeGoalTool(detached)).toContain("ERROR");

    expect(auditorCalls).toBe(0);
    expect(goalStatus(h)).toBe("active");

    // Once achieved, a second attempt reports the state instead of re-auditing.
    await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ files: ["src/index.ts"] })));
    expect(goalStatus(h)).toBe("achieved");
    expect(await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ files: ["src/index.ts"] })))).toContain("already achieved");
    expect(auditorCalls).toBe(2);
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
    // The harness finished the goal's kickoff task, so it counts as done.
    expect(output).toContain(`[active] "Ship it" (goal_id=${h.goalId}, owner: CEO) — 0 backlog, 1 in flight, 2 done`);
    expect(output).toContain("Real work tasks: 3 total — 0 backlog, 1 in progress, 0 in review, 2 done");
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
    h.connection.db.prepare("update goals set description = ? where id = ?").run("证".repeat(5_000), h.goalId);
    // The auditor's own provider sets the window: 19,000 tokens leave 3,000 for input.
    h.connection.db.prepare("update providers set context_window_tokens = 19000 where id = ?").run(h.providerId);
    const output = await completeGoalTool(argsFor(h, h.ceoId, auditor, call({ files: ["src/index.ts"] })));
    expect(output).toMatch(/^ERROR: This run needs ~\d+ input tokens but the provider's context window leaves 3000/);
    expect(calls).toBe(0);
    expect(goalStatus(h)).toBe("active");
    h.connection.close();
  });
});
