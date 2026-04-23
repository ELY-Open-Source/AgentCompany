import { describe, expect, it } from "vitest";
import { judgeSemanticRubric } from "./semantic-rubric-judge.js";
import type { AssistantTurn, SemanticRubricDimension } from "./types.js";

const assistantTurn: AssistantTurn = {
  type: "turn",
  turnIndex: 0,
  role: "assistant",
  content: [{
    type: "text",
    text: "The reply names the beta risk, assigns CTO ownership, and gives a daily review cadence.",
  }],
  tokenLedger: {
    input: 10,
    cache_read: 0,
    cache_creation: 0,
    output: 10,
  },
};

describe("semantic rubric judge", () => {
  it("passes rubric dimensions when transcript evidence satisfies the rubric", () => {
    const rubric: SemanticRubricDimension[] = [{
      id: "risk-owner-cadence",
      question: "Does the CEO answer with risk, owner, and cadence?",
      passRubric: "The answer names a concrete risk, owner, and review cadence.",
      failRubric: "The answer omits risk, owner, or cadence.",
      mustContain: ["risk", "CTO", "daily review"],
    }];

    const results = judgeSemanticRubric(rubric, [assistantTurn]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      dimensionId: "risk-owner-cadence",
      passed: true,
    });
  });

  it("fails rubric dimensions with a concrete missing-evidence reason", () => {
    const rubric: SemanticRubricDimension[] = [{
      id: "no-plan-only",
      question: "Does the answer avoid plan-only behavior?",
      passRubric: "The answer performs the requested action in the transcript.",
      failRubric: "The answer only promises future work.",
      mustContain: ["mark_read"],
      mustNotContain: ["I'll get back to you"],
    }];

    const results = judgeSemanticRubric(rubric, [assistantTurn]);

    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.reason).toContain('missing required evidence "mark_read"');
  });
});
