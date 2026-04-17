import { useMemo } from "react";
import type { CompanyRecord } from "@shared/types";
import { useAppStore } from "../state/store";
import { useCompanyData } from "./useCompanyData";

/**
 * Shared data context for section views. Subscribes to the Zustand store
 * for snapshot + current company, derives per-company collections and
 * currently-selected entities via useCompanyData.
 *
 * Sections call this hook directly instead of receiving 30+ props through
 * SectionContentView.
 */
export function useSectionContext() {
  const snapshot = useAppStore((s) => s.snapshot);

  const currentCompany = useMemo<CompanyRecord | null>(() => {
    if (!snapshot) return null;
    return (
      snapshot.companies.find((company) => company.id === snapshot.currentCompanyId) ??
      snapshot.companies[0] ??
      null
    );
  }, [snapshot]);

  const companyData = useCompanyData(snapshot, currentCompany);

  const selectedConnectorId = useAppStore((s) => s.selectedConnectorId);
  const selectedConnector =
    snapshot?.connectors.find((connector) => connector.id === selectedConnectorId) ??
    snapshot?.connectors[0] ??
    null;

  return {
    snapshot,
    currentCompany,
    selectedConnector,
    ...companyData,
  };
}
