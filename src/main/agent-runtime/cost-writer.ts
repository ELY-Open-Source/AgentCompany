import { calculateCost, type Usage, type Api, type Model } from "@mariozechner/pi-ai";
import type { AppDatabase } from "@main/database";
import { getConnectorDefinition } from "@main/connectors";
import { resolveModel, resolveModelCostFallback } from "@main/model-resolver";

export interface CostWriterDeps {
  db: AppDatabase;
}

interface ObserveInput {
  runId: string;
  companyId: string;
  agentId: string;
  taskId: string | null;
  connectorId: string;
  modelId: string;
  usage: Usage;
}

export class CostWriter {
  constructor(private readonly deps: CostWriterDeps) {}

  observeAssistantMessage(input: ObserveInput): void {
    const definition = getConnectorDefinition(input.connectorId);
    if (!definition.provider) {
      throw new Error(`[cost-writer] connector ${input.connectorId} has no provider mapping`);
    }
    const model = resolveModel(definition.provider, input.modelId);
    if (!model) {
      throw new Error(`[cost-writer] model ${input.modelId} not found for provider ${definition.provider}`);
    }
    const patchedModel = resolveModelCostFallback(model, definition.provider);
    const cost = calculateCost(patchedModel, input.usage);
    if (!Number.isFinite(cost.total)) {
      throw new Error(
        `[cost-writer] cost calculation returned non-finite total for ${input.connectorId}/${input.modelId}`,
      );
    }

    this.deps.db.core.runs.recordCostEntry({
      runId: input.runId,
      companyId: input.companyId,
      agentId: input.agentId,
      taskId: input.taskId,
      connectorId: input.connectorId,
      amountUsd: cost.total,
      unattributed: false,
    });
  }
}
