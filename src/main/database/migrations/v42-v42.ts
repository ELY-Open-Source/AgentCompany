import log from "electron-log/main.js";
import type { Migration, MigrationDeps } from "./types";
import { tableExists } from "./types";

/**
 * Company-scope the connector model-pool settings.
 *
 * "Model pool" is the per-connector list of models a user has
 * enabled/disabled during onboarding (Settings → Model pool). The
 * original storage put it in the key-value `settings` table under
 * `disabled_models:${connectorId}` — global, not tied to any
 * company. That meant deleting a company left the pool config behind,
 * and creating a new company inherited the previous company's
 * enabled/disabled choices.
 *
 * This migration moves the data to a real relational table with a
 * cascade FK. Company deletion now naturally wipes the settings —
 * no manual cleanup in `deleteCompany()`, no risk of drift.
 *
 * Existing global entries cannot be assigned to a single company
 * (the constraint they were written under had none), so the
 * migration drops them. Users re-select their model pool on the
 * next onboarding wake. Acceptable: this data is a one-click UI
 * preference, not business-critical state, and the bug report was
 * literally "these carry over wrongly — clear them."
 */
export function createMigrationsV42V42(deps: MigrationDeps): Migration[] {
  const { db } = deps;
  return [
    {
      version: 42,
      name: "scope_connector_model_pool_by_company",
      fn: () => {
        if (!tableExists(db, "connector_model_pool_settings")) {
          db.exec(`
            CREATE TABLE connector_model_pool_settings (
              company_id TEXT NOT NULL,
              connector_id TEXT NOT NULL,
              disabled_models_json TEXT NOT NULL DEFAULT '[]',
              updated_at TEXT NOT NULL,
              PRIMARY KEY (company_id, connector_id),
              FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_connector_model_pool_company
              ON connector_model_pool_settings(company_id);
          `);
          log.info("[migration v42] created connector_model_pool_settings");
        }

        // Purge stale global keys. Prefix scan is enough — both the
        // key format (`disabled_models:<connectorId>`) and the
        // semantics (one per connector) mean dropping them all is the
        // correct reset.
        const deleted = db
          .prepare("DELETE FROM settings WHERE key LIKE 'disabled_models:%'")
          .run();
        const changes = Number(deleted.changes);
        if (changes > 0) {
          log.info(`[migration v42] dropped ${changes} legacy disabled_models:* key(s) from settings`);
        }
      },
    },
  ];
}
