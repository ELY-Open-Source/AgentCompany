/**
 * Deterministic semantic rubric judge for B5 eval fixtures.
 *
 * The rubric text states the semantic behavior being protected; the evidence
 * fields make that behavior executable in CI. This keeps eval runs offline and
 * repeatable while still forcing every behavior fixture to name the quality bar
 * it is meant to protect.
 */

import type {
  SemanticRubricDimension,
  SemanticRubricResult,
  TraceTurn,
} from "./types.js";

function collectAssistantText(turns: TraceTurn[]): string {
  const chunks: string[] = [];
  for (const turn of turns) {
    if (turn.role !== "assistant") continue;
    for (const block of turn.content) {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        chunks.push((block as { text: string }).text);
      }
    }
  }
  return chunks.join("\n");
}

function evaluateDimension(
  dimension: SemanticRubricDimension,
  assistantText: string,
): SemanticRubricResult {
  const evidence: string[] = [];

  for (const required of dimension.mustContain) {
    if (!assistantText.includes(required)) {
      return {
        dimensionId: dimension.id,
        passed: false,
        evidence,
        reason: `missing required evidence "${required}"`,
      };
    }
    evidence.push(required);
  }

  for (const forbidden of dimension.mustNotContain ?? []) {
    if (assistantText.includes(forbidden)) {
      return {
        dimensionId: dimension.id,
        passed: false,
        evidence,
        reason: `found forbidden evidence "${forbidden}"`,
      };
    }
  }

  return {
    dimensionId: dimension.id,
    passed: true,
    evidence,
  };
}

export function judgeSemanticRubric(
  rubric: SemanticRubricDimension[],
  turns: TraceTurn[],
): SemanticRubricResult[] {
  const assistantText = collectAssistantText(turns);
  return rubric.map((dimension) => evaluateDimension(dimension, assistantText));
}
