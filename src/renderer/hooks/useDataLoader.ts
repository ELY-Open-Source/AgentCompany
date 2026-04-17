import { useCallback, useEffect } from "react";
import type { ProfileSnapshot, SectionId } from "@shared/types";
import { unwrap } from "../lib/desktop";
import { useAppStore } from "../state/store";

export function useDataLoader(
  snapshot: ProfileSnapshot | null,
  section: SectionId,
  selectedConnectorId: string | null,
  selectedRunId: string | null,
) {
  const refresh = useCallback(async () => {
    const store = useAppStore.getState();
    try {
      const next = unwrap<ProfileSnapshot>(await window.agentCompany.loadSnapshot());
      store.setSnapshot(next);
      if (next.companies.length === 0) {
        store.setInitialOnboardingLocked(true);
      }
      if (!selectedConnectorId && next.connectors[0]) store.setSelectedConnectorId(next.connectors[0].id);
      if (!selectedRunId && next.runs[0]) store.setSelectedRunId(next.runs[0].id);
      if (next.currentCompanyId) {
        const badgeResult = await window.agentCompany.getSidebarBadges(next.currentCompanyId);
        if (badgeResult.ok) store.setBadges(badgeResult.data);
        const inboxResult = await window.agentCompany.getInbox(next.currentCompanyId);
        if (inboxResult.ok) store.setInboxItems(inboxResult.data);
        store.setSocialAccounts(next.socialAccounts?.filter((a) => a.companyId === next.currentCompanyId) ?? []);
        const browserActionResult = await window.agentCompany.listBrowserActions({ companyId: next.currentCompanyId, limit: 50 });
        if (browserActionResult.ok) {
          store.setBrowserActions(browserActionResult.data);
        }
      }
      store.setError(null);
    } catch (nextError) {
      store.setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [selectedConnectorId, selectedRunId]);

  // Section-based data loading; resets when section OR company changes so
  // in-flight requests for the previous company cannot overwrite new state.
  const currentCompanyId = snapshot?.currentCompanyId ?? null;
  useEffect(() => {
    if (!currentCompanyId) return;
    const companyId = currentCompanyId;
    let cancelled = false;
    const store = useAppStore.getState();

    if (section === "inbox") {
      void window.agentCompany.getInbox(companyId).then((result) => {
        if (!cancelled && result.ok) store.setInboxItems(result.data);
      });
    }

    if (section === "performance") {
      void window.agentCompany.getCompanyMetrics({ companyId, days: 30 }).then((result) => {
        if (!cancelled && result.ok) store.setCompanyMetrics(result.data);
      });
    }

    if (section === "standup") {
      void window.agentCompany.getStandupReport(companyId).then((result) => {
        if (!cancelled && result.ok) store.setStandupReport(result.data);
      });
    }

    if (section === "social") {
      store.setSocialAccounts(snapshot?.socialAccounts?.filter((a) => a.companyId === companyId) ?? []);
    }

    return () => {
      cancelled = true;
    };
  }, [section, currentCompanyId, snapshot]);

  return { refresh };
}
