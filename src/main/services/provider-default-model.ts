import type { DatabaseSync } from "node:sqlite";
import type { SetProviderModelInput } from "../../shared/commands";
import { AuditService } from "./audit-service";

/** Changes a connected provider's default model without touching its credential; sessions already started keep their pinned model. */
export function setProviderModel(db: DatabaseSync, input: SetProviderModelInput): void {
  const provider = db.prepare("select provider_key, credential_id, model from providers where id = ? and org_id = ?")
    .get(input.providerId, input.orgId) as { provider_key: string; credential_id: string | null; model: string | null } | undefined;
  if (!provider) throw new Error("Provider was not found.");
  const model = input.model.trim();
  if (!model) throw new Error("Name the default model.");
  if (!provider.credential_id) throw new Error("Connect this provider first; its default model is set when it connects.");
  if (provider.provider_key === "azure-openai") throw new Error("Azure OpenAI calls the deployment saved with its credential; change the deployment under Manage.");
  db.prepare("update providers set model = ? where id = ? and org_id = ?").run(model, input.providerId, input.orgId);
  new AuditService(db).record({ orgId: input.orgId, entityType: "provider", entityId: input.providerId, actorType: "employee", actorId: null, action: "default_model_changed", payload: { from: provider.model, to: model } });
  console.info(`[providers] ${provider.provider_key} default model: ${provider.model ?? "none"} -> ${model}`);
}
