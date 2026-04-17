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
 * Writes a `cost_entries` row for an assistant `message_end` and updates the
 * cumulative `runs.cost_usd` for the active run.
 */
export class CostWriter {
  constructor(private readonly deps: CostWriterDeps) {}

  observeAssistantMessage(input: ObserveInput): void {
    // Fail closed on cost calculation — budget policies read `cost_entries`
    // to enforce spending gates; an "unattributed" row would silently let
    // an agent run unbounded. If pricing cannot be resolved, refuse to
    // persist the row and let the caller see the error. The failure is
    // visible (throws) instead of invisible (null amount, unattributed=1).
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

    this.deps.db.queryAll(
      "insert into cost_entries (id, company_id, run_id, task_id, agent_id, connector_id, amount_usd, unattributed, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      cryptoRandomId(),
      input.companyId,
      input.runId,
      input.taskId,
      input.agentId,
      input.connectorId,
      cost.total,
      0,
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
