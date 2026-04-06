import { useCallback, useEffect, useMemo, useRef } from "react";
import type { CompanyRecord, OnboardingBootstrapResult } from "@shared/types";
import { useAppStore } from "../state/store";
import { NEW_ENTITY_ID } from "../lib/constants";
import { unwrap } from "../lib/desktop";
import { useDesktopEvents } from "./useDesktopEvents";
import { useDataLoader } from "./useDataLoader";
import { useCompanyData } from "./useCompanyData";

export function useCompanyController() {
  const snapshot = useAppStore((s) => s.snapshot);
  const setSnapshot = useAppStore((s) => s.setSnapshot);
  const section = useAppStore((s) => s.section);
  const setError = useAppStore((s) => s.setError);
  const setInitialOnboardingLocked = useAppStore((s) => s.setInitialOnboardingLocked);
  const setSection = useAppStore((s) => s.setSection);
  const setShowOnboarding = useAppStore((s) => s.setShowOnboarding);
  const setSelectedRunId = useAppStore((s) => s.setSelectedRunId);
  const setSelectedAgentId = useAppStore((s) => s.setSelectedAgentId);
  const setSelectedConnectorId = useAppStore((s) => s.setSelectedConnectorId);
  const selectedConnectorId = useAppStore((s) => s.selectedConnectorId);
  const selectedRunId = useAppStore((s) => s.selectedRunId);
  const setBadges = useAppStore((s) => s.setBadges);
  const setInboxItems = useAppStore((s) => s.setInboxItems);
  const setSocialAccounts = useAppStore((s) => s.setSocialAccounts);
  const setBrowserActions = useAppStore((s) => s.setBrowserActions);
  const setCompanyMetrics = useAppStore((s) => s.setCompanyMetrics);
  const setStandupReport = useAppStore((s) => s.setStandupReport);
  const setConfirmDeleteCompanyId = useAppStore((s) => s.setConfirmDeleteCompanyId);
  const setCompanySwitcherOpen = useAppStore((s) => s.setCompanySwitcherOpen);
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const incrementLogRevision = useAppStore((s) => s.incrementLogRevision);

  const currentCompany = useMemo<CompanyRecord | null>(() => {
    if (!snapshot) return null;
    return snapshot.companies.find((company) => company.id === snapshot.currentCompanyId) ?? snapshot.companies[0] ?? null;
  }, [snapshot]);

  const companyData = useCompanyData(snapshot, currentCompany);

  const selectedConnector = snapshot?.connectors.find((connector) => connector.id === selectedConnectorId) ?? snapshot?.connectors[0] ?? null;

  const clearCompanyScopedUiState = useCallback(() => {
    const store = useAppStore.getState();
    store.clearCompanyScopedSelections();
    store.setInboxItems([]);
    store.setCompanyMetrics(null);
    store.setStandupReport(null);
    store.setSocialAccounts([]);
    store.setBrowserActions([]);
    store.setBadges(null);
    store.setSkills([]);
    store.setSelectedSkillId(null);
    store.setSelectedSkillFilePath("SKILL.md");
    store.setSkillImportModalOpen(false);
  }, []);

  const { refresh } = useDataLoader(
    snapshot, section, selectedConnectorId, selectedRunId,
    setSnapshot, setError, setInitialOnboardingLocked,
    setSelectedConnectorId, setSelectedRunId,
    setBadges, setInboxItems, setSocialAccounts, setBrowserActions,
    setCompanyMetrics, setStandupReport,
  );

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
    if (snapshot.locale && snapshot.locale !== locale) setLocale(snapshot.locale);
    if (snapshot.theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", applyTheme);
      return () => mq.removeEventListener("change", applyTheme);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setLocale is a stable Zustand setter
  }, [snapshot, locale]);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  // Keep selectedRunId in sync when run list changes
  useEffect(() => {
    if (selectedRunId && !companyData.runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(companyData.runs[0]?.id ?? null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setSelectedRunId is a stable Zustand setter
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
      setError(result.error.message);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- incrementLogRevision and setError are stable Zustand setters
  }, [activeRunId, companyData.runs]);

  const setCompany = useCallback(async (companyId: string) => {
    if (companyId === NEW_ENTITY_ID) { setShowOnboarding(true); return; }
    try {
      unwrap(await window.agentCompany.setCurrentCompany(companyId));
      clearCompanyScopedUiState();
      await refresh();
      setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setError and setShowOnboarding are stable Zustand setters
  }, [clearCompanyScopedUiState, refresh]);

  const deleteCompany = useCallback(async (companyId: string) => {
    try {
      unwrap(await window.agentCompany.deleteCompany(companyId));
      setConfirmDeleteCompanyId(null);
      setCompanySwitcherOpen(false);
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Zustand setters are stable references
  }, [refresh]);

  const handleOnboardingDone = useCallback(async (summary: OnboardingBootstrapResult) => {
    setShowOnboarding(false);
    setInitialOnboardingLocked(false);
    await refresh();
    setError(null);
    setSection("overview");
    if (summary.runId) setSelectedRunId(summary.runId);
    if (summary.leadAgentId) setSelectedAgentId(summary.leadAgentId);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Zustand setters are stable references
  }, [refresh]);

  const openPathWithFeedback = useCallback(async (path: string) => {
    try { unwrap(await window.agentCompany.openPath(path)); setError(null); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setError is a stable Zustand setter
  }, []);

  return {
    snapshot,
    currentCompany,
    selectedConnector,
    logBufferRef,
    refresh,
    setCompany,
    deleteCompany,
    handleOnboardingDone,
    openPathWithFeedback,
    ...companyData,
  };
}
