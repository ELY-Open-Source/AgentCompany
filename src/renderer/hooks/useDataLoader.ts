import { useCallback, useEffect } from "react";
import type { ProfileSnapshot, SectionId } from "@shared/types";
import { describeDesktopError, unwrap } from "../lib/desktop";
import { useAppStore } from "../state/store";

export function useDataLoader(
  snapshot: ProfileSnapshot | null,
  section: SectionId,
) {
  // HOOK-006 fix: empty deps. The callback reads selectedConnectorId /
  // selectedRunId via getState() at call time so its identity stays stable
  // across connector/run selection changes and AppActions consumers do not
  // cascade re-render.
  const refresh = useCallback(async () => {
    const store = useAppStore.getState();
    try {
      const next = unwrap<ProfileSnapshot>(await window.agentCompany.loadSnapshot());
      store.setSnapshot(next);
      if (next.companies.length === 0) {
        store.setInitialOnboardingLocked(true);
      }
      const currentSelectedConnectorId = useAppStore.getState().selectedConnectorId;
      const currentSelectedRunId = useAppStore.getState().selectedRunId;
      if (!currentSelectedConnectorId && next.connectors[0]) store.setSelectedConnectorId(next.connectors[0].id);
      if (!currentSelectedRunId && next.runs[0]) store.setSelectedRunId(next.runs[0].id);
      if (next.currentCompanyId) {
        store.setSocialAccounts(next.socialAccounts?.filter((a) => a.companyId === next.currentCompanyId) ?? []);
        const browserActionResult = await window.agentCompany.listBrowserActions({ companyId: next.currentCompanyId, limit: 50 });
        if (browserActionResult.ok) {
          store.setBrowserActions(browserActionResult.data);
        }
      }
      store.setError(null);
    } catch (nextError) {
      store.setError(describeDesktopError(nextError));
    }
  }, []);

  const currentCompanyId = snapshot?.currentCompanyId ?? null;
  // HOOK-003 fix: IPC effect keyed on [section, currentCompanyId,
  // snapshotRevision]. snapshotRevision only bumps on full-snapshot swaps
  // (setSnapshot / refreshSnapshot), so granular patchTask/patchRun/etc. do
  // not re-trigger inbox/metrics/standup IPC fetches.
  const snapshotRevision = useAppStore((s) => s.snapshotRevision);
  useEffect(() => {
    if (!currentCompanyId) return;
    const companyId = currentCompanyId;
    let cancelled = false;
    const store = useAppStore.getState();

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

    return () => {
      cancelled = true;
    };
  }, [section, currentCompanyId, snapshotRevision]);

  // Social accounts are read directly from the snapshot (no IPC), so keep
  // them reactive to snapshot mutations independently of the IPC effect
  // above.
  const socialAccounts = snapshot?.socialAccounts;
  useEffect(() => {
    if (!currentCompanyId) return;
    if (section !== "social") return;
    useAppStore.getState().setSocialAccounts(
      socialAccounts?.filter((a) => a.companyId === currentCompanyId) ?? [],
    );
  }, [section, currentCompanyId, socialAccounts]);

  return { refresh };
}
