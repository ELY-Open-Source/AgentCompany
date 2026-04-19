import log from "electron-log/main.js";
import type { Migration, MigrationDeps } from "./types";
import { columnExists, tableExists } from "./types";

export function createMigrationsV38V39(deps: MigrationDeps): Migration[] {
  const { db } = deps;
  return [
    {
      // Model capability table. Maps (provider, model_id) to 1..5 scores across
      // three domains (reasoning / coding / writing), a tier enum used as a
      // hard lower bound for task-profile matching, and a cost-per-Mtok-output
      // figure used to pick the cheapest qualifying model.
      //
      // Scores, tier, and cost are data — editable at runtime via IPC. Seed
      // rows are inserted by the main process on startup when the table is
      // empty so a fresh install boots with a sensible matrix covering the
      // providers in the pi-ai catalog and the curated Fireworks list.
      version: 38,
      name: "create_model_capabilities",
      fn: () => {
        if (tableExists(db, "model_capabilities")) {
          log.info("[migration v38] model_capabilities already exists; skipping");
          return;
        }
        db.exec(
          `CREATE TABLE model_capabilities (
            provider TEXT NOT NULL,
            model_id TEXT NOT NULL,
            reasoning INTEGER NOT NULL,
            coding INTEGER NOT NULL,
            writing INTEGER NOT NULL,
            tier TEXT NOT NULL,
            cost_per_mtok_out REAL NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (provider, model_id)
          )`,
        );
        db.exec("CREATE INDEX idx_model_capabilities_tier ON model_capabilities(tier)");
        log.info("[migration v38] created model_capabilities table");
      },
    },
    {
      // agents.model_strategy drives run-time model dispatch.
      //
      //   'explicit' — use agent.connector_id and agent.model verbatim
      //                (the pre-v39 behavior — kept for existing rows so there
      //                are no regressions on upgrade).
      //   'auto'     — ignore agent.connector_id/model; at run dispatch time
      //                pick the cheapest model whose capability vector meets
      //                the agent's inferred task profile.
      //
      // New agents default to 'auto' at the application layer. Existing rows
      // on upgrade are forced to 'explicit' because the user previously picked
      // their model manually and we must not silently re-route them.
      version: 39,
      name: "add_agents_model_strategy",
      fn: () => {
        if (!tableExists(db, "agents")) {
          throw new Error("agents table missing; refusing to migrate v39");
        }
        if (columnExists(db, "agents", "model_strategy")) {
          log.info("[migration v39] agents.model_strategy already exists; skipping");
          return;
        }
        // Default at schema level = 'explicit' so existing rows keep their
        // hand-picked model. Application code uses 'auto' as the default for
        // freshly created agents.
        db.exec(
          "ALTER TABLE agents ADD COLUMN model_strategy TEXT NOT NULL DEFAULT 'explicit'",
        );
        log.info("[migration v39] added agents.model_strategy column");
      },
    },
  ];
}
