import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ConnectorId } from "../../src/shared/types";

export const E2E_READY_CONNECTOR_ID = "anthropic" as ConnectorId;
export const E2E_READY_CONNECTOR_MODEL_ID = "claude-sonnet-4-5";
export const E2E_PROVIDER_API_KEY = "sk-ant-e2e-key-do-not-use-000000000000";

export interface OnboardingProfileState {
  companyCount: number;
  currentCompanyName: string | null;
  leadAgentConnectorId: string | null;
  leadAgentModel: string | null;
  taskCount: number;
  runCount: number;
  disabledModelCount: number;
}

function first<T>(db: DatabaseSync, sql: string, ...params: Array<string | number | null>): T | null {
  return (db.prepare(sql).get(...params) as T | undefined) ?? null;
}

export function readOnboardingProfileState(profileDir: string): OnboardingProfileState {
  const db = new DatabaseSync(join(profileDir, "profile.sqlite"));
  try {
    const companyCount =
      first<{ count: number }>(db, "select count(*) as count from companies")?.count ?? 0;
    const currentCompanyId =
      first<{ value: string }>(db, "select value from settings where key = 'current_company_id'")?.value ?? null;
    const currentCompany = currentCompanyId
      ? first<{ id: string; name: string }>(db, "select id, name from companies where id = ?", currentCompanyId)
      : first<{ id: string; name: string }>(db, "select id, name from companies order by created_at asc limit 1");
    const companyId = currentCompany?.id ?? null;
    const leadAgent = companyId
      ? first<{ connector_id: string; model: string | null }>(
        db,
        "select connector_id, model from agents where company_id = ? and reports_to is null limit 1",
        companyId,
      )
      : null;
    const disabledModelsJson = companyId
      ? first<{ disabled_models_json: string }>(
        db,
        "select disabled_models_json from connector_model_pool_settings where company_id = ? and connector_id = ?",
        companyId,
        E2E_READY_CONNECTOR_ID,
      )?.disabled_models_json ?? "[]"
      : "[]";
    const disabledModels = JSON.parse(disabledModelsJson) as unknown[];
    return {
      companyCount,
      currentCompanyName: currentCompany?.name ?? null,
      leadAgentConnectorId: leadAgent?.connector_id ?? null,
      leadAgentModel: leadAgent?.model ?? null,
      taskCount: companyId
        ? first<{ count: number }>(db, "select count(*) as count from tasks where company_id = ?", companyId)?.count ?? 0
        : 0,
      runCount: companyId
        ? first<{ count: number }>(db, "select count(*) as count from runs where company_id = ?", companyId)?.count ?? 0
        : 0,
      disabledModelCount: disabledModels.length,
    };
  } finally {
    db.close();
  }
}
