import { calculateCost, type Usage } from "@mariozechner/pi-ai";
import type { AppDatabase } from "@main/database";
import { getConnectorDefinition } from "@main/connectors";
import { resolveModel } from "@main/model-resolver";

export interface CostWriterDeps {
  db: AppDatabase;
  logger: { warn: (...args: unknown[]) => void };
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
 * Writes a `cost_entries` row for an assistant `message_end` and updates the
 * cumulative `runs.cost_usd` for the active run.
 */
export class CostWriter {
  constructor(private readonly deps: CostWriterDeps) {}

  observeAssistantMessage(input: ObserveInput): void {
    let amountUsd: number | null = null;
    try {
      const definition = getConnectorDefinition(input.connectorId);
      if (definition.provider) {
        const model = resolveModel(definition.provider, input.modelId);
        if (model) {
          const cost = calculateCost(model, input.usage);
          amountUsd = Number.isFinite(cost.total) ? cost.total : null;
        }
      }
    } catch (error) {
      this.deps.logger.warn(
        `[cost-writer] cost calculation failed for ${input.connectorId}/${input.modelId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      amountUsd = null;
    }

    this.deps.db.queryAll(
      "insert into cost_entries (id, company_id, run_id, task_id, agent_id, connector_id, amount_usd, unattributed, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      cryptoRandomId(),
      input.companyId,
      input.runId,
      input.taskId,
      input.agentId,
      input.connectorId,
      amountUsd,
      amountUsd === null ? 1 : 0,
      new Date().toISOString(),
    );
  }
}

function cryptoRandomId(): string {
  // Avoid pulling node:crypto at module top-level so this file can be
  // imported from non-Node contexts during type checks.
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
