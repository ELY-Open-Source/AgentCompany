import type { DatabaseSync } from "node:sqlite";
import type { ModelCapability } from "@shared/types";
import type { ReadAll, Transaction } from "./helpers";
import { nowIso } from "./helpers";

/**
 * CRUD for `model_capabilities`. The table is (provider, model_id) keyed; the
 * dispatcher reads it on every run, so every row must have numeric scores —
 * we validate inputs at the application layer before touching the DB.
 */
export function buildModelCapabilityMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
) {
  type Row = {
    provider: string;
    model_id: string;
    reasoning: number;
    coding: number;
    writing: number;
    tier: "trivial" | "standard" | "hard";
    cost_per_mtok_out: number;
    updated_at: string;
  };

  function rowToRecord(row: Row): ModelCapability {
    return {
      provider: row.provider,
      modelId: row.model_id,
      reasoning: row.reasoning,
      coding: row.coding,
      writing: row.writing,
      tier: row.tier,
      costPerMtokOut: row.cost_per_mtok_out,
      updatedAt: row.updated_at,
    };
  }

  function listModelCapabilities(): ModelCapability[] {
    return readAll<Row>(
      "SELECT provider, model_id, reasoning, coding, writing, tier, cost_per_mtok_out, updated_at FROM model_capabilities ORDER BY provider, model_id",
    ).map(rowToRecord);
  }

  function getModelCapability(provider: string, modelId: string): ModelCapability | null {
    const row = getDb()
      .prepare(
        "SELECT provider, model_id, reasoning, coding, writing, tier, cost_per_mtok_out, updated_at FROM model_capabilities WHERE provider = ? AND model_id = ?",
      )
      .get(provider, modelId) as Row | undefined;
    return row ? rowToRecord(row) : null;
  }

  function upsertModelCapability(input: Omit<ModelCapability, "updatedAt">): void {
    const now = nowIso();
    getDb()
      .prepare(
        `INSERT INTO model_capabilities (provider, model_id, reasoning, coding, writing, tier, cost_per_mtok_out, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider, model_id) DO UPDATE SET
           reasoning = excluded.reasoning,
           coding = excluded.coding,
           writing = excluded.writing,
           tier = excluded.tier,
           cost_per_mtok_out = excluded.cost_per_mtok_out,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.provider,
        input.modelId,
        input.reasoning,
        input.coding,
        input.writing,
        input.tier,
        input.costPerMtokOut,
        now,
      );
  }

  function deleteModelCapability(provider: string, modelId: string): void {
    getDb()
      .prepare("DELETE FROM model_capabilities WHERE provider = ? AND model_id = ?")
      .run(provider, modelId);
  }

  /**
   * Seed the table from a list of rows. Used at boot when the table is empty
   * so a fresh install has something to dispatch against. Runs inside a
   * single transaction so either every row is written or none — we don't
   * want partial seeding if something goes wrong mid-loop.
   */
  function seedModelCapabilities(rows: Array<Omit<ModelCapability, "updatedAt">>): number {
    return transaction(() => {
      let inserted = 0;
      const ts = nowIso();
      const stmt = getDb().prepare(
        `INSERT OR IGNORE INTO model_capabilities (
          provider, model_id, reasoning, coding, writing, tier, cost_per_mtok_out, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of rows) {
        const result = stmt.run(
          row.provider,
          row.modelId,
          row.reasoning,
          row.coding,
          row.writing,
          row.tier,
          row.costPerMtokOut,
          ts,
        );
        inserted += Number(result.changes ?? 0);
      }
      return inserted;
    });
  }

  return {
    listModelCapabilities,
    getModelCapability,
    upsertModelCapability,
    deleteModelCapability,
    seedModelCapabilities,
  };
}
