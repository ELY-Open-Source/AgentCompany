import { calculateCost, type Usage } from "@mariozechner/pi-ai";
import type { AppDatabase } from "@main/database";
import { getConnectorDefinition } from "@main/connectors";
import { resolveModel } from "@main/model-resolver";

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

/**
 * Writes a `cost_entries` row for each pi `message_end`. finishRun reads
 * SUM(cost_entries.amount_usd) for the run-level aggregate, so this is
 * the single source of truth for cost attribution.
 */
export class CostWriter {
  constructor(private readonly deps: CostWriterDeps) {}

  observeAssistantMessage(input: ObserveInput): void {
    // Fail closed on cost calculation — budget policies read `cost_entries`
    // to enforce spending gates; silently emitting an unattributed row
    // would let an agent run unbounded. If pricing cannot be resolved,
    // throw so the caller logs and the missing cost is visible.
    const definition = getConnectorDefinition(input.connectorId);
    if (!definition.provider) {
      throw new Error(`[cost-writer] connector ${input.connectorId} has no provider mapping`);
    }
    const model = resolveModel(definition.provider, input.modelId);
    if (!model) {
      throw new Error(`[cost-writer] model ${input.modelId} not found for provider ${definition.provider}`);
    }
    const cost = calculateCost(model, input.usage);
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
