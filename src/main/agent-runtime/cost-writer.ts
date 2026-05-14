import { calculateCost, type Usage } from "@mariozechner/pi-ai";
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

// Local OpenAI-compatible servers run on the user's own machine, so the
// LLM call has no third-party billing line. Record a zero cost entry
// without invoking pi-ai's calculator (which would require the model's
// baseUrl from the credential — unnecessary work for a flat-zero cost).
const ZERO_COST_PROVIDERS: ReadonlySet<string> = new Set(["ollama", "lm-studio"]);

export class CostWriter {
  constructor(private readonly deps: CostWriterDeps) {}

  observeAssistantMessage(input: ObserveInput): void {
    const definition = getConnectorDefinition(input.connectorId);
    if (!definition.provider) {
      throw new Error(`[cost-writer] connector ${input.connectorId} has no provider mapping`);
    }
    if (ZERO_COST_PROVIDERS.has(definition.provider)) {
      this.deps.db.core.runs.recordCostEntry({
        runId: input.runId,
        companyId: input.companyId,
        agentId: input.agentId,
        taskId: input.taskId,
        connectorId: input.connectorId,
        amountUsd: 0,
        unattributed: false,
      });
      return;
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
