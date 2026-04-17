import { createContext, useContext } from "react";
import type { CompanyRecord, ConnectorRecord, ProfileSnapshot } from "@shared/types";
import type { CompanyData } from "./useCompanyData";

/**
 * Shared data context for section views. Provided once at the App layer
 * (via useCompanyController) so that section roots do not each run
 * useCompanyData independently. Fixes HOOK-004 (4x duplicate filter work).
 */
export interface SectionContextValue extends CompanyData {
  snapshot: ProfileSnapshot | null;
  currentCompany: CompanyRecord | null;
  selectedConnector: ConnectorRecord | null;
}

export const SectionContext = createContext<SectionContextValue | null>(null);

export function useSectionContext(): SectionContextValue {
  const value = useContext(SectionContext);
  if (!value) {
    throw new Error("useSectionContext must be used inside <SectionContext.Provider>");
  }
  return value;
}
