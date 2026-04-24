import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import { loadSkills } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { buildAgentHooks } from "../../src/main/agent-runtime/agent-hooks";
import {
  createPiAgent,
  resolveThinkingLevel,
} from "../../src/main/worker/runtime/pi-agent-factory";
import {
  createRunScopedBashOptions,
  createRunScopedCodingTools,
} from "../../src/main/worker/runtime/run-tools";
import type { WorkerRpcClient } from "../../src/main/worker/entry/rpc";

function createModel(): Model<"openai-responses"> {
  return {
    id: "contract-model",
    name: "Contract Model",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 2048,
  };
}

function createRpc(): WorkerRpcClient {
  return {
    invoke: async () => {
      throw new Error("Unexpected RPC call in pi runtime contract test.");
    },
  } as unknown as WorkerRpcClient;
}

describe("pi runtime integration contract", () => {
  it("builds the AgentCompany pi Agent boundary with sequential execution and hooks", () => {
    const agent = createPiAgent({
      runId: "run-contract",
      taskSessionId: "session-contract",
      systemPrompt: "Contract prompt",
      model: createModel(),
      tools: [],
      priorMessages: [],
      thinkingLevel: resolveThinkingLevel("high"),
      apiKey: "contract-key",
      extraHeaders: { "x-contract": "true" },
      rpc: createRpc(),
    });

    expect(agent).toBeInstanceOf(Agent);
    expect(agent.sessionId).toBe("session-contract");
    expect(agent.toolExecution).toBe("sequential");
    expect(agent.state.systemPrompt).toBe("Contract prompt");
    expect(agent.state.thinkingLevel).toBe("high");
    expect(agent.state.tools).toEqual([]);
    expect(agent.state.messages).toEqual([]);
    expect(typeof agent.beforeToolCall).toBe("function");
    expect(typeof agent.transformContext).toBe("function");
    expect(agent.afterToolCall).toBeUndefined();
  });

  it("keeps the coding-tool surface expected by worker runs", () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "agentcompany-pi-tools-"));
    try {
      const tools = createRunScopedCodingTools(workspaceDir, { AGENTCOMPANY_CONTRACT: "1" });
      expect(tools.map((tool) => tool.name)).toEqual(["read", "bash", "edit", "write"]);
      for (const tool of tools) {
        expect(typeof tool.execute).toBe("function");
      }
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("preserves run-scoped environment through the bash spawn hook", () => {
    const options = createRunScopedBashOptions({
      AGENTCOMPANY_CONTRACT: "1",
      PATH: "/contract/bin",
    });
    const result = options.spawnHook?.({
      command: "pwd",
      cwd: "/tmp",
      env: {
        HOME: "/home/contract",
        PATH: "/base/bin",
      },
    });

    expect(result?.command).toBe("pwd");
    expect(result?.cwd).toBe("/tmp");
    expect(result?.env.HOME).toBe("/home/contract");
    expect(result?.env.PATH).toBe("/contract/bin");
    expect(result?.env.AGENTCOMPANY_CONTRACT).toBe("1");
  });

  it("loads progressive-disclosure skills through the pinned pi runtime", () => {
    const root = mkdtempSync(join(tmpdir(), "agentcompany-pi-skills-"));
    const skillDir = join(root, "contract-skill");
    mkdirSync(skillDir);
    writeFileSync(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: contract-skill",
        "description: Contract skill loaded by the pinned pi runtime.",
        "---",
        "# Contract Skill",
        "",
        "Use this skill to prove the runtime loader contract.",
      ].join("\n"),
      "utf8",
    );

    try {
      const result = loadSkills({ skillPaths: [skillDir], includeDefaults: false });
      expect(result.diagnostics).toEqual([]);
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]?.name).toBe("contract-skill");
      expect(result.skills[0]?.description).toBe("Contract skill loaded by the pinned pi runtime.");
      expect(result.skills[0]?.filePath).toBe(join(skillDir, "SKILL.md"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the aggregated hook bundle assignable to pi Agent options at runtime", () => {
    const hooks = buildAgentHooks({ runId: "run-contract", rpc: createRpc() });
    expect(Object.keys(hooks).sort()).toEqual([
      "beforeToolCall",
      "transformContext",
    ]);
    expect(typeof hooks.beforeToolCall).toBe("function");
    expect(typeof hooks.transformContext).toBe("function");
  });
});
