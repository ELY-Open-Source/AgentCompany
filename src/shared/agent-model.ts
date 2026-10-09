/** Where an agent's model comes from: its own setting, else its provider's default. */
export type ModelSource = "agent" | "provider_default" | "none";

/** The model a new session of the agent starts with; a running session keeps the one it pinned. */
export function agentModel(agentModelId: string | null, providerModel: string | null): { model: string | null; source: ModelSource } {
  const own = agentModelId?.trim();
  if (own) return { model: own, source: "agent" };
  if (providerModel) return { model: providerModel, source: "provider_default" };
  return { model: null, source: "none" };
}

/** A model names one of its provider's models, so it means nothing without that provider. */
export function assertModelHasProvider(modelProviderId: string | null, modelId: string | null): void {
  if (modelId?.trim() && !modelProviderId) throw new Error("Pick the provider before its model.");
}

/** Agents a change to this provider's default model reaches, and those that keep their own model. */
export function defaultModelReach(agents: Array<{ modelProviderId: string | null; modelId: string | null }>, providerId: string): { following: number; ownModel: number } {
  const bound = agents.filter((agent) => agent.modelProviderId === providerId);
  const ownModel = bound.filter((agent) => agent.modelId?.trim()).length;
  return { following: bound.length - ownModel, ownModel };
}
