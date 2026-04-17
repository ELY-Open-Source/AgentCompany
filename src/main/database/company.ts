import type { DatabaseSync } from "node:sqlite";
import type { ProfileSnapshot } from "@shared/types";
import type { ReadAll, Transaction } from "./helpers";
import { buildCompanyCrudMethods } from "./company-crud";
import { buildCompanyMetricsMethods } from "./company-metrics";
import { buildCompanySettingsMethods } from "./company-settings";

export function buildCompanyMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
  deps: {
    getSetting: (key: string) => string | null;
    setSetting: (key: string, value: string) => void;
    listSnapshot: (options: { companyId?: string | null }) => ProfileSnapshot;
    addComment: (input: { companyId: string; taskId: string; authorAgentId: string | null; authorName: string; body: string }) => void;
  },
) {
  return {
    ...buildCompanyCrudMethods(getDb, readAll, transaction, deps),
    ...buildCompanySettingsMethods(getDb, readAll, transaction, { listSnapshot: deps.listSnapshot }),
    ...buildCompanyMetricsMethods(getDb, readAll, transaction),
  };
}
