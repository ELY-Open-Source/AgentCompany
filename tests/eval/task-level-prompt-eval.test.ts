import { describe, expect, it, vi } from "vitest";
import { getEncoding } from "js-tiktoken";
import {
  collectRequiredHeadingUsage,
  evaluateTaskPromptCase,
  runTaskPromptEvalCase,
} from "./task-level-prompt-eval.js";
import { TASK_LEVEL_PROMPT_EVAL_CASES } from "./task-level-prompt-cases.js";
import { buildStableSystemPrompt, buildTaskPrompt } from "../../src/main/prompt-builder/index";

const TEST_ENCODING = getEncoding("cl100k_base");

describe("task-level prompt eval harness", () => {
  it.each(TASK_LEVEL_PROMPT_EVAL_CASES)(
    "passes task-level prompt section contract for $caseId",
    (testCase) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-20T12:00:00.000Z"));
      const result = runTaskPromptEvalCase(testCase);
      vi.useRealTimers();

      if (!result.passed) {
        throw new Error(`${result.caseId} failed:\n${result.failures.join("\n")}`);
      }

      expect(result.promptHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.totalTokens).toBeGreaterThan(0);
      expect(result.stablePrefixTokens).toBeGreaterThan(0);
      expect(result.volatileTailTokens).toBeGreaterThan(0);
      expect(result.sections.length).toBeGreaterThan(testCase.requiredHeadings.length);
      for (const heading of testCase.requiredHeadings) {
        const section = result.sections.find((candidate) => candidate.heading === heading);
        expect(section?.tokenCount).toBeGreaterThan(0);
        expect(section?.byteLength).toBeGreaterThan(0);
      }
    },
  );

  it("builds the heading usage ledger that gates future prompt section removal", () => {
    const usage = collectRequiredHeadingUsage(TASK_LEVEL_PROMPT_EVAL_CASES);

    expect(usage.get("Current Task")).toEqual([
      "ceo-bootstrap-hiring",
      "manager-review-handoff",
      "ic-implementation-task",
      "cofounder-plan-review-gate",
    ]);
    expect(usage.get("Operating Instructions (CEO — Team Building Phase)")).toEqual([
      "ceo-bootstrap-hiring",
    ]);
    expect(usage.get("Tasks Awaiting Your Review (1 pending)")).toEqual([
      "manager-review-handoff",
    ]);
    expect(usage.get("Execution Mode: AI Co-Founder (Human-Reviewed)")).toEqual([
      "cofounder-plan-review-gate",
    ]);
  });

  it("counts volatile tail tokens from the actual prompt boundary slice", () => {
    const stablePrefix = "AgentCompany API\n";
    const volatileTail = "\n# Current Task";
    const prompt = `${stablePrefix}${volatileTail}`;
    const result = evaluateTaskPromptCase({
      caseId: "token-boundary",
      taskLevel: "individual_contributor",
      description: "BPE boundary regression case.",
      context: TASK_LEVEL_PROMPT_EVAL_CASES[0]!.context,
      requiredHeadings: ["Current Task"],
      forbiddenHeadings: [],
    }, prompt, stablePrefix);

    expect(result.volatileTailTokens).toBe(TEST_ENCODING.encode(volatileTail).length);
    expect(result.volatileTailTokens).not.toBe(result.totalTokens - result.stablePrefixTokens);
  });

  it("fails when CEO bootstrap prompt receives the operating proactive footer", () => {
    const testCase = TASK_LEVEL_PROMPT_EVAL_CASES.find(
      (candidate) => candidate.caseId === "ceo-bootstrap-hiring",
    );
    if (!testCase) throw new Error("missing ceo-bootstrap-hiring eval case");

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T12:00:00.000Z"));
    const stablePrefix = buildStableSystemPrompt(testCase.context);
    const prompt = `${buildTaskPrompt(testCase.context)}
# Proactive Behaviors (Things to Do Without Being Asked)
- If a department has no active tasks: create strategic tasks.`;
    const result = evaluateTaskPromptCase(testCase, prompt, stablePrefix);
    vi.useRealTimers();

    expect(result.passed).toBe(false);
    expect(result.failures).toContain(
      'forbidden heading "Proactive Behaviors (Things to Do Without Being Asked)" is present',
    );
  });

  it("fails loud when a required prompt section is removed", () => {
    const testCase = TASK_LEVEL_PROMPT_EVAL_CASES.find(
      (candidate) => candidate.caseId === "ic-implementation-task",
    );
    if (!testCase) throw new Error("missing ic-implementation-task eval case");

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T12:00:00.000Z"));
    const stablePrefix = buildStableSystemPrompt(testCase.context);
    const prompt = buildTaskPrompt(testCase.context).replace(
      /^# Current Task\n[\s\S]*?(?=^# Your Assigned Tasks|^# Context)/m,
      "",
    );
    const result = evaluateTaskPromptCase(testCase, prompt, stablePrefix);
    vi.useRealTimers();

    expect(result.passed).toBe(false);
    expect(result.failures).toContain('missing required heading "Current Task"');
  });
});
