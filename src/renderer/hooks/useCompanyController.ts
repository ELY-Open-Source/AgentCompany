import { useCallback, useEffect, useMemo, useRef } from "react";
import type { CompanyRecord, OnboardingBootstrapResult } from "@shared/types";
import { useAppStore } from "../state/store";
import { NEW_ENTITY_ID } from "../lib/constants";
import { unwrap } from "../lib/desktop";
import { useDesktopEvents } from "./useDesktopEvents";
import { useDataLoader } from "./useDataLoader";
import { useCompanyData } from "./useCompanyData";
import type { SectionContextValue } from "./useSectionContext";

export function useCompanyController() {
  const snapshot = useAppStore((s) => s.snapshot);
  const section = useAppStore((s) => s.section);
  const selectedConnectorId = useAppStore((s) => s.selectedConnectorId);
  const selectedRunId = useAppStore((s) => s.selectedRunId);
  const locale = useAppStore((s) => s.locale);
  const incrementLogRevision = useAppStore((s) => s.incrementLogRevision);

  const currentCompany = useMemo<CompanyRecord | null>(() => {
    if (!snapshot) return null;
    return snapshot.companies.find((company) => company.id === snapshot.currentCompanyId) ?? snapshot.companies[0] ?? null;
  }, [snapshot]);

  const companyData = useCompanyData(snapshot, currentCompany);

  // HOOK-005 fix: memoize selectedConnector so its identity is stable.
  const selectedConnector = useMemo(
    () =>
      snapshot?.connectors.find((connector) => connector.id === selectedConnectorId) ??
      snapshot?.connectors[0] ??
      null,
    [snapshot, selectedConnectorId],
  );

  const clearCompanyScopedUiState = useCallback(() => {
    const store = useAppStore.getState();
    store.clearCompanyScopedSelections();
    store.setCompanyMetrics(null);
    store.setStandupReport(null);
    store.setSocialAccounts([]);
    store.setBrowserActions([]);
    store.setSkills([]);
    store.setSelectedSkillId(null);
    store.setSelectedSkillFilePath("SKILL.md");
    store.setSkillImportModalOpen(false);
  }, []);

  const { refresh } = useDataLoader(snapshot, section);

  const logBufferRef = useRef<Record<string, string>>({});

  // Stable ref so the subscribe callback always calls the latest refresh
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useDesktopEvents(refreshRef, logBufferRef, incrementLogRevision);

  // Theme / locale sync
  useEffect(() => {
    if (!snapshot) return;
    const root = document.documentElement;
    const applyTheme = () => {
      const isDark = snapshot.theme === "dark" ||
        (snapshot.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.classList.toggle("dark", isDark);
      root.style.colorScheme = isDark ? "dark" : "light";
    };
    applyTheme();
    if (snapshot.locale && snapshot.locale !== locale) useAppStore.getState().setLocale(snapshot.locale);
    if (snapshot.theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", applyTheme);
      return () => mq.removeEventListener("change", applyTheme);
    }
  }, [snapshot, locale]);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  // Keep selectedRunId in sync when run list changes
  useEffect(() => {
    if (selectedRunId && !companyData.runs.some((run) => run.id === selectedRunId)) {
      useAppStore.getState().setSelectedRunId(companyData.runs[0]?.id ?? null);
    }
  }, [companyData.runs, selectedRunId]);

  // Pre-load run log when active run changes
  const activeRunId = companyData.selectedRun?.id ?? null;
  useEffect(() => {
    if (!activeRunId) return;
    void (async () => {
      const activeRun = companyData.runs.find((run) => run.id === activeRunId);
      if (!activeRun) return;
      const result = await window.agentCompany.getRunLog({ companyId: activeRun.companyId, runId: activeRunId });
      if (result.ok) {
        logBufferRef.current = { ...logBufferRef.current, [activeRunId]: result.data };
        incrementLogRevision();
        return;
      }
      useAppStore.getState().setError(result.error.message);
    })();
  }, [activeRunId, companyData.runs, incrementLogRevision]);

  const setCompany = useCallback(async (companyId: string) => {
    const store = useAppStore.getState();
    if (companyId === NEW_ENTITY_ID) { store.setShowOnboarding(true); return; }
    try {
      unwrap(await window.agentCompany.setCurrentCompany(companyId));
      clearCompanyScopedUiState();
      await refresh();
      store.setError(null);
    } catch (err) { store.setError(err instanceof Error ? err.message : String(err)); }
  }, [clearCompanyScopedUiState, refresh]);

  const deleteCompany = useCallback(async (companyId: string) => {
    const store = useAppStore.getState();
    try {
      unwrap(await window.agentCompany.deleteCompany(companyId));
      store.setConfirmDeleteCompanyId(null);
      store.setCompanySwitcherOpen(false);
      await refresh();
    } catch (err) { store.setError(err instanceof Error ? err.message : String(err)); }
  }, [refresh]);

  const handleOnboardingDone = useCallback(async (summary: OnboardingBootstrapResult) => {
    const store = useAppStore.getState();
    store.setShowOnboarding(false);
    store.setInitialOnboardingLocked(false);
    await refresh();
    store.setError(null);
    store.setSection("overview");
    if (summary.runId) store.setSelectedRunId(summary.runId);
  }, [refresh]);

  const openPathWithFeedback = useCallback(async (path: string) => {
    const store = useAppStore.getState();
    try { unwrap(await window.agentCompany.openPath(path)); store.setError(null); }
    catch (err) { store.setError(err instanceof Error ? err.message : String(err)); }
  }, []);

  // HOOK-002 fix: return a STABLE useMemo'd object. Deps are each primitive
  // field that affects consumers; companyData and snapshot are already
  // stable refs thanks to the memoizations above.
  const sectionContextValue = useMemo<SectionContextValue>(
    () => ({ snapshot, currentCompany, selectedConnector, ...companyData }),
    [snapshot, currentCompany, selectedConnector, companyData],
  );

  return useMemo(() => ({
    snapshot,
    currentCompany,
    selectedConnector,
    logBufferRef,
    refresh,
    setCompany,
    deleteCompany,
    handleOnboardingDone,
    openPathWithFeedback,
    sectionContextValue,
    // Fields forwarded from companyData so existing consumers keep working
    // without a wider refactor.
    tasks: companyData.tasks,
    approvals: companyData.approvals,
    pendingApprovals: companyData.pendingApprovals,
    runs: companyData.runs,
    companyAgents: companyData.companyAgents,
    companyGoals: companyData.companyGoals,
    companyProjects: companyData.companyProjects,
    companyWorkspaces: companyData.companyWorkspaces,
    companyCosts: companyData.companyCosts,
    filteredActivity: companyData.filteredActivity,
    companySecrets: companyData.companySecrets,
    companyDocuments: companyData.companyDocuments,
    companyWorkProducts: companyData.companyWorkProducts,
    companyKnowledge: companyData.companyKnowledge,
    companyMeetings: companyData.companyMeetings,
    companySprints: companyData.companySprints,
    selectedTask: companyData.selectedTask,
    selectedApproval: companyData.selectedApproval,
    selectedRun: companyData.selectedRun,
    selectedAgent: companyData.selectedAgent,
    editingAgent: companyData.editingAgent,
    selectedGoal: companyData.selectedGoal,
    selectedProject: companyData.selectedProject,
    selectedWorkspace: companyData.selectedWorkspace,
    navBadges: companyData.navBadges,
  }), [
    snapshot,
    currentCompany,
    selectedConnector,
    refresh,
    setCompany,
    deleteCompany,
    handleOnboardingDone,
    openPathWithFeedback,
    sectionContextValue,
    companyData,
  ]);
}
