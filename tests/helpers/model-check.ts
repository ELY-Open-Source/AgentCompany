import type { DatabaseSync } from "node:sqlite";
import { MODEL_CHECK_TOOL } from "../../src/main/services/model-check";
import type { AgentTurnResult, ProviderToolTurnInput } from "../../src/main/services/provider-tool-turn";

/** A scripted provider that also passes the agent check the way a capable model would. */
export function answeringModelCheck<T extends (input: ProviderToolTurnInput) => Promise<AgentTurnResult>>(turn: T): T {
  return (async (input: ProviderToolTurnInput) => {
    if (!input.tools.some((tool) => tool.name === MODEL_CHECK_TOOL)) return turn(input);
    const first = input.messages[0];
    const code = first?.role === "user" ? /The code is (\d+)/.exec(first.text)?.[1] : undefined;
    if (!code) throw new Error("The agent check sent no code.");
    return { text: "", toolCalls: [{ id: "check", name: MODEL_CHECK_TOOL, arguments: { code } }], rawResponseJson: "{}" };
  }) as T;
}

/** Records that a provider's model already passed the agent check, so a test sees only its own requests. */
export function markModelChecked(db: DatabaseSync, providerId: string, model: string): void {
  const provider = db.prepare("select org_id, credential_id from providers where id = ?").get(providerId) as { org_id: string; credential_id: string | null } | undefined;
  if (!provider?.credential_id) throw new Error(`Provider ${providerId} has no credential to check a model against.`);
  db.prepare("insert into model_checks(provider_id, model, credential_id, org_id, passed, detail, checked_at) values (?, ?, ?, ?, 1, null, ?)")
    .run(providerId, model, provider.credential_id, provider.org_id, new Date().toISOString());
}
