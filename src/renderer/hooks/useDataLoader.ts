import { useCallback, useEffect } from "react";
import type { ProfileSnapshot, SectionId } from "@shared/types";
import { unwrap } from "../lib/desktop";
import { useAppStore } from "../state/store";

export function useDataLoader(
  snapshot: ProfileSnapshot | null,
  section: SectionId,
  selectedConnectorId: string | null,
  selectedRunId: string | null,
  setSnapshot: (snapshot: ProfileSnapshot) => void,
  setError: (error: string | null) => void,
  setInitialOnboardingLocked: (locked: boolean) => void,
  setSelectedConnectorId: (id: string | null) => void,
  setSelectedRunId: (id: string | null) => void,
  setBadges: (badges: Parameters<ReturnType<typeof useAppStore.getState>["setBadges"]>[0]) => void,
  setInboxItems: (items: Parameters<ReturnType<typeof useAppStore.getState>["setInboxItems"]>[0]) => void,
  setSocialAccounts: (accounts: Parameters<ReturnType<typeof useAppStore.getState>["setSocialAccounts"]>[0]) => void,
  setBrowserActions: (actions: Parameters<ReturnType<typeof useAppStore.getState>["setBrowserActions"]>[0]) => void,
  setCompanyMetrics: (metrics: Parameters<ReturnType<typeof useAppStore.getState>["setCompanyMetrics"]>[0]) => void,
  setStandupReport: (report: Parameters<ReturnType<typeof useAppStore.getState>["setStandupReport"]>[0]) => void,
) {
  const refresh = useCallback(async () => {
    try {
      const next = unwrap<ProfileSnapshot>(await window.agentCompany.loadSnapshot());
      setSnapshot(next);
      if (next.companies.length === 0) {
        setInitialOnboardingLocked(true);
      }
      if (!selectedConnectorId && next.connectors[0]) setSelectedConnectorId(next.connectors[0].id);
      if (!selectedRunId && next.runs[0]) setSelectedRunId(next.runs[0].id);
      if (next.currentCompanyId) {
        const badgeResult = await window.agentCompany.getSidebarBadges(next.currentCompanyId);
        if (badgeResult.ok) setBadges(badgeResult.data);
        const inboxResult = await window.agentCompany.getInbox(next.currentCompanyId);
        if (inboxResult.ok) setInboxItems(inboxResult.data);
        setSocialAccounts(next.socialAccounts?.filter(a => a.companyId === next.currentCompanyId) ?? []);
        const browserActionResult = await window.agentCompany.listBrowserActions({ companyId: next.currentCompanyId, limit: 50 });
        if (browserActionResult.ok) {
          setBrowserActions(browserActionResult.data);
        }
      }
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Zustand setters are stable references
  }, [selectedConnectorId, selectedRunId]);

  // Section-based data loading
  useEffect(() => {
    if (!snapshot?.currentCompanyId) return;
    const companyId = snapshot.currentCompanyId;
    let cancelled = false;

    if (section === "inbox") {
      void window.agentCompany.getInbox(companyId).then((result) => {
        if (!cancelled && result.ok) setInboxItems(result.data);
      });
    }

    if (section === "performance") {
      void window.agentCompany.getCompanyMetrics({ companyId, days: 30 }).then((result) => {
        if (!cancelled && result.ok) setCompanyMetrics(result.data);
      });
    }

    if (section === "standup") {
      void window.agentCompany.getStandupReport(companyId).then((result) => {
        if (!cancelled && result.ok) setStandupReport(result.data);
      });
    }

    if (section === "social") {
      setSocialAccounts(snapshot.socialAccounts?.filter((a) => a.companyId === companyId) ?? []);
    }

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Zustand setters are stable references
  }, [section, snapshot]);

  return { refresh };
}
