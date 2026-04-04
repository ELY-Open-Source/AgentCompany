/**
 * Company Context Provider
 *
 * Provides shared company infrastructure to section components, eliminating
 * the need to thread 80+ props through SectionContentView. Components can
 * import useCompanyContext() instead of receiving props from the root.
 *
 * This context holds stable references to company data and actions that
 * nearly every section needs: companyId, snapshot, refresh, navigation, etc.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { CompanyRecord, ProfileSnapshot, SectionId } from "@shared/types";

export interface CompanyContextValue {
  companyId: string | null;
  currentCompany: CompanyRecord | null;
  snapshot: ProfileSnapshot | null;
  refresh: () => void;
  navigateTo: (section: SectionId, entityId?: string) => void;
  setSection: (section: SectionId) => void;
  setError: (error: string | null) => void;
  openPath: (targetPath: string) => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

interface CompanyContextProviderProps {
  companyId: string | null;
  currentCompany: CompanyRecord | null;
  snapshot: ProfileSnapshot | null;
  refresh: () => void;
  navigateTo: (section: SectionId, entityId?: string) => void;
  setSection: (section: SectionId) => void;
  setError: (error: string | null) => void;
  openPath: (targetPath: string) => Promise<void>;
  children: ReactNode;
}

export function CompanyContextProvider({
  companyId, currentCompany, snapshot, refresh,
  navigateTo, setSection, setError, openPath, children,
}: CompanyContextProviderProps) {
  const value = useMemo<CompanyContextValue>(() => ({
    companyId, currentCompany, snapshot, refresh,
    navigateTo, setSection, setError, openPath,
  }), [companyId, currentCompany, snapshot, refresh, navigateTo, setSection, setError, openPath]);

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompanyContext(): CompanyContextValue {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompanyContext must be used within CompanyContextProvider");
  return ctx;
}
