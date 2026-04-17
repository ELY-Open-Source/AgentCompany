import { useCallback, useMemo, type ReactNode } from "react";
import { CircleNotch, TerminalWindow } from "./components/ui/icons";
import { LocaleContext, TranslationContext, type TranslationFn } from "./i18n";
import type { AppLocale } from "@shared/locale";
import { CompanyOnboarding } from "./components/CompanyOnboarding";
import TitleBar from "./components/TitleBar";
import ToastContainer from "./components/Toast";
import { SidebarView } from "./views/SidebarView";
import { SectionContentView } from "./views/SectionContentView";
import { ConsoleView } from "./views/ConsoleView";
import { CommandPaletteView } from "./views/CommandPaletteView";
import { useAppStore } from "./state/store";
import { useUIController } from "./hooks/useUIController";
import { useCompanyController } from "./hooks/useCompanyController";
import { useCommandPaletteHotkeys } from "./hooks/useCommandPaletteHotkeys";
import { AppActionsContext, type AppActions } from "./hooks/useAppActions";
import { unwrap } from "./lib/desktop";

function Shell({
  locale,
  t,
  showCustomTitleBar,
  className,
  children,
}: {
  locale: AppLocale;
  t: TranslationFn;
  showCustomTitleBar: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>
      <TranslationContext.Provider value={t}>
        <div className={`flex h-[100dvh] flex-col overflow-hidden${className ? " " + className : ""}`}>
          {showCustomTitleBar && <TitleBar />}
          {children}
        </div>
      </TranslationContext.Provider>
    </LocaleContext.Provider>
  );
}

export function App() {
  const ui = useUIController();
  const company = useCompanyController();

  const error = useAppStore((s) => s.error);
  const setError = useAppStore((s) => s.setError);
  const setSelectedRunId = useAppStore((s) => s.setSelectedRunId);
  const setConsoleOpen = useAppStore((s) => s.setConsoleOpen);
  const navigateTo = useAppStore((s) => s.navigateTo);

  const showCustomTitleBar = window.agentCompany.platform !== "darwin";
  const isMac = !showCustomTitleBar;

  const startRun = useCallback(async (taskId: string) => {
    if (!company.currentCompany) { setError("Select a company before starting a run."); return; }
    const result = await window.agentCompany.startTaskRun({ companyId: company.currentCompany.id, taskId });
    if (!result.ok) { setError(result.error.message); return; }
    setSelectedRunId(result.data);
    setConsoleOpen(true);
    await company.refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Zustand setters and company.refresh are stable
  }, [company.currentCompany, company.refresh]);

  const cancelRun = useCallback(async (runId: string) => {
    try {
      const run = company.runs.find((entry) => entry.id === runId);
      if (!run) throw new Error("Selected run is no longer available.");
      unwrap(await window.agentCompany.cancelRun({ companyId: run.companyId, runId }));
      await company.refresh();
      setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setError is a stable Zustand setter
  }, [company.refresh, company.runs]);

  const { filteredNavItems, matchedAgents, matchedTasks, matchedRuns, matchedGoals, matchedProjects, hasEntityResults } =
    useMemo(() => ui.buildPaletteResults(
      ui.navItems,
      company.companyAgents,
      company.tasks,
      company.runs,
      company.companyGoals,
      company.companyProjects,
    ), [
      ui.navItems,
      ui.paletteQuery,
      company.companyAgents,
      company.tasks,
      company.runs,
      company.companyGoals,
      company.companyProjects,
     
    ]);

  const paletteActions = useMemo(
    () => ui.buildPaletteActions(filteredNavItems, matchedAgents, matchedTasks, matchedRuns, matchedGoals, matchedProjects),
    [ui, filteredNavItems, matchedAgents, matchedTasks, matchedRuns, matchedGoals, matchedProjects],
  );

  const paletteActionIndex = useMemo(
    () => new Map(paletteActions.map((action, index) => [action.key, index])),
    [paletteActions],
  );

  useCommandPaletteHotkeys({
    commandPaletteOpen: ui.commandPaletteOpen,
    setCommandPaletteOpen: ui.setCommandPaletteOpen,
    setCommandPaletteSearch: ui.setCommandPaletteSearch,
    setSelectedPaletteIndex: ui.setSelectedPaletteIndex,
    paletteActions,
    navigateTo,
    commandPaletteSearch: ui.commandPaletteSearch,
  });

  const appActions = useMemo<AppActions>(() => ({
    refresh: company.refresh,
    setError,
    openPathWithFeedback: company.openPathWithFeedback,
    startRun,
    cancelRun,
  }), [company.refresh, company.openPathWithFeedback, startRun, cancelRun, setError]);

  if (!company.snapshot) {
    return (
      <Shell locale={ui.locale} t={ui.t} showCustomTitleBar={showCustomTitleBar}>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
          <CircleNotch size={24} className="animate-spin text-primary" />
          <span className="text-[13px] text-muted-foreground">{ui.t("app.loading")}</span>
        </div>
      </Shell>
    );
  }

  if (company.snapshot.companies.length === 0 || ui.showOnboarding || ui.initialOnboardingLocked) {
    return (
      <Shell locale={ui.locale} t={ui.t} showCustomTitleBar={showCustomTitleBar}>
        <div className="min-h-0 flex-1 overflow-auto">
          <CompanyOnboarding
            connectors={company.snapshot.connectors}
            onDone={company.handleOnboardingDone}
            canCancel={company.snapshot.companies.length > 0 && !ui.initialOnboardingLocked}
            onCancel={() => {
              ui.setShowOnboarding(false);
              ui.setInitialOnboardingLocked(false);
              setError(null);
            }}
            currentLocale={ui.locale}
            onLocaleChange={ui.handleLocaleChange}
            isFirstLaunch={company.snapshot.companies.length === 0}
          />
        </div>
      </Shell>
    );
  }

  return (
    <LocaleContext.Provider value={ui.locale}>
    <TranslationContext.Provider value={ui.t}>
    <AppActionsContext.Provider value={appActions}>
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
    {showCustomTitleBar && <TitleBar />}
    <div className={`grid min-h-0 flex-1 overflow-hidden transition-[grid-template-columns] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${ui.sidebarCollapsed ? "grid-cols-[56px_minmax(0,1fr)]" : "grid-cols-[220px_minmax(0,1fr)]"}`}>

      <SidebarView
        isMac={isMac}
        sidebarCollapsed={ui.sidebarCollapsed}
        setSidebarCollapsed={ui.setSidebarCollapsed}
        section={ui.section}
        setSection={ui.setSection}
        sidebarGroups={ui.sidebarGroups}
        navBadges={company.navBadges}
        companySwitcherOpen={ui.companySwitcherOpen}
        setCompanySwitcherOpen={ui.setCompanySwitcherOpen}
        confirmDeleteCompanyId={ui.confirmDeleteCompanyId}
        setConfirmDeleteCompanyId={ui.setConfirmDeleteCompanyId}
        currentCompany={company.currentCompany}
        snapshot={company.snapshot}
        setCompany={company.setCompany}
        deleteCompany={company.deleteCompany}
        setCommandPaletteOpen={ui.setCommandPaletteOpen}
        t={ui.t}
      />

      <main aria-label="Content" className="flex min-w-0 flex-col overflow-hidden">
        <header className="sidebar-drag shrink-0 border-b border-border bg-background">
          <div className="mx-auto flex w-full max-w-[1040px] items-start justify-between gap-4 px-6 pb-5 pt-6 lg:gap-6 lg:px-10 lg:pt-8">
            <h1 className="text-[28px] font-bold tracking-[-0.02em] text-foreground">
              {ui.navItems.find((item) => item.id === ui.section)?.label ?? ui.t(`nav.${ui.section}`)}
            </h1>
            <div className="flex shrink-0 items-center gap-3 lg:gap-5">
              <button
                type="button"
                aria-label={ui.consoleOpen ? ui.t("app.hideConsole") : ui.t("app.showConsole")}
                title={ui.consoleOpen ? ui.t("app.hideConsole") : ui.t("app.showConsole")}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 inline-flex items-center gap-2 py-1 text-[12px] font-semibold text-muted-foreground transition hover:text-foreground"
                onClick={() => ui.setConsoleOpen(!ui.consoleOpen)}
              >
                <TerminalWindow size={16} />
                <span className="hidden lg:inline">{ui.consoleOpen ? ui.t("app.hideConsole") : ui.t("app.showConsole")}</span>
              </button>
            </div>
          </div>
        </header>

        <SectionContentView
          section={ui.section}
          error={error}
          pageTransition={ui.pageTransition}
        />

        <ConsoleView
          consoleOpen={ui.consoleOpen}
          setConsoleOpen={ui.setConsoleOpen}
          selectedRun={company.selectedRun}
          setSelectedRunId={setSelectedRunId}
          runs={company.runs}
          logBufferRef={company.logBufferRef}
          openPathWithFeedback={company.openPathWithFeedback}
          panelTransition={ui.panelTransition}
          t={ui.t}
        />
      </main>

      <CommandPaletteView
        commandPaletteOpen={ui.commandPaletteOpen}
        setCommandPaletteOpen={ui.setCommandPaletteOpen}
        commandPaletteSearch={ui.commandPaletteSearch}
        setCommandPaletteSearch={ui.setCommandPaletteSearch}
        selectedPaletteIndex={ui.selectedPaletteIndex}
        setSelectedPaletteIndex={ui.setSelectedPaletteIndex}
        paletteTrapRef={ui.paletteTrapRef}
        filteredNavItems={filteredNavItems}
        matchedAgents={matchedAgents}
        matchedTasks={matchedTasks}
        matchedRuns={matchedRuns}
        matchedGoals={matchedGoals}
        matchedProjects={matchedProjects}
        hasEntityResults={hasEntityResults}
        paletteActions={paletteActions}
        paletteActionIndex={paletteActionIndex}
        runs={company.runs}
        navigateTo={navigateTo}
        panelTransition={ui.panelTransition}
        t={ui.t}
      />

      <ToastContainer />
    </div>
    </div>
    </AppActionsContext.Provider>
    </TranslationContext.Provider>
    </LocaleContext.Provider>
  );
}

export default App;
