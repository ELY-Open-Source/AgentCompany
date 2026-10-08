import { randomInt } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AgentTurnMessage, AgentTurnResult, ToolDefinition } from "./provider-tool-turn";

export const MODEL_CHECK_TOOL = "confirm_ready";

export interface ModelCheckTurn {
  code: string;
  instructions: string;
  messages: AgentTurnMessage[];
  tools: ToolDefinition[];
}

/** One turn that needs what agent work needs: system instructions, a tool, and arguments taken from the conversation. */
export function modelCheckTurn(): ModelCheckTurn {
  const code = String(randomInt(100_000, 1_000_000));
  return {
    code,
    instructions: `You are being checked for agent work. Answer only by calling ${MODEL_CHECK_TOOL} with the code from the user's message; never answer in text.`,
    messages: [{ role: "user", text: `The code is ${code}.` }],
    tools: [{
      name: MODEL_CHECK_TOOL,
      description: "Confirms the agent is ready by echoing the code.",
      parameters: { type: "object", properties: { code: { type: "string", description: "The code from the user's message." } }, required: ["code"] },
    }],
  };
}

/** Why the answer shows the model cannot do agent work on this interface, or null when it passed. */
export function modelCheckProblem(result: Pick<AgentTurnResult, "toolCalls">, code: string): string | null {
  const call = result.toolCalls.find((candidate) => candidate.name === MODEL_CHECK_TOOL);
  if (!call) return result.toolCalls.length > 0 ? `it called ${result.toolCalls[0].name}, a tool it was not given` : "it answered in text instead of calling the tool it was given";
  if (call.argumentsError) return `its tool arguments were ${call.argumentsError}`;
  if (String(call.arguments.code) !== code) return "it called the tool without the code its instructions asked for";
  return null;
}

export type ModelCheck = { passed: true } | { passed: false; detail: string };

export function readModelCheck(db: DatabaseSync, providerId: string, model: string, credentialId: string): ModelCheck | null {
  const row = db.prepare("select passed, detail from model_checks where provider_id = ? and model = ? and credential_id = ?")
    .get(providerId, model, credentialId) as { passed: number; detail: string | null } | undefined;
  if (!row) return null;
  if (row.passed === 1) return { passed: true };
  if (!row.detail) throw new Error(`The failed agent check of ${model} has no reason recorded.`);
  return { passed: false, detail: row.detail };
}

export function recordModelCheck(db: DatabaseSync, input: { orgId: string; providerId: string; model: string; credentialId: string; problem: string | null; now: Date }): void {
  db.prepare(`
    insert into model_checks(provider_id, model, credential_id, org_id, passed, detail, checked_at) values (?, ?, ?, ?, ?, ?, ?)
    on conflict(provider_id, model, credential_id) do update set passed = excluded.passed, detail = excluded.detail, checked_at = excluded.checked_at
  `).run(input.providerId, input.model, input.credentialId, input.orgId, input.problem ? 0 : 1, input.problem, input.now.toISOString());
}

export function modelCheckFailure(providerLabel: string, model: string, detail: string): string {
  return `${model} on ${providerLabel} failed the agent check: ${detail}. Pick another model, or check it again in Settings.`;
}
