import { CircleNotch, TerminalWindow } from "@phosphor-icons/react";
import { LocaleContext, TranslationContext } from "./i18n";
import { CompanyOnboarding } from "./components/CompanyOnboarding";
import TitleBar from "./components/TitleBar";
import ToastContainer from "./components/Toast";
import { SidebarView } from "./views/SidebarView";
import { SectionContentView } from "./views/SectionContentView";
import { ConsoleView } from "./views/ConsoleView";
import { CommandPaletteView } from "./views/CommandPaletteView";
import { useAppController } from "./hooks/useAppController";

export function App() {
  const c = useAppController();

  const showCustomTitleBar = window.agentCompany.platform !== "darwin";
  const isMac = !showCustomTitleBar;

  if (!c.snapshot) {
    return (
      <LocaleContext.Provider value={c.locale}>
        <TranslationContext.Provider value={c.t}>
          <div className="flex h-[100dvh] flex-col overflow-hidden">
            {showCustomTitleBar && <TitleBar />}
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
              <CircleNotch size={24} className="animate-spin text-primary" />
              <span className="text-[13px] text-muted-foreground">{c.t("app.loading")}</span>
            </div>
          </div>
        </TranslationContext.Provider>
      </LocaleContext.Provider>
    );
  }

  if (c.snapshot.companies.length === 0 || c.showOnboarding || c.initialOnboardingLocked) {
    return (
      <LocaleContext.Provider value={c.locale}>
        <TranslationContext.Provider value={c.t}>
          <div className="flex h-[100dvh] flex-col overflow-hidden">
            {showCustomTitleBar && <TitleBar />}
            <div className="min-h-0 flex-1 overflow-auto">
              <CompanyOnboarding
                connectors={c.snapshot.connectors}
                onDone={c.handleOnboardingDone}
                canCancel={c.snapshot.companies.length > 0 && !c.initialOnboardingLocked}
                onCancel={() => {
                  c.setShowOnboarding(false);
                  c.setInitialOnboardingLocked(false);
                  c.setError(null);
                }}
                currentLocale={c.locale}
                onLocaleChange={c.handleLocaleChange}
                isFirstLaunch={c.snapshot.companies.length === 0}
              />
            </div>
          </div>
        </TranslationContext.Provider>
      </LocaleContext.Provider>
    );
  }

  return (
    <LocaleContext.Provider value={c.locale}>
    <TranslationContext.Provider value={c.t}>
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
    {showCustomTitleBar && <TitleBar />}
    <div className={`grid min-h-0 flex-1 overflow-hidden transition-[grid-template-columns] duration-200 ${c.sidebarCollapsed ? "grid-cols-[56px_minmax(0,1fr)]" : "grid-cols-[220px_minmax(0,1fr)]"}`} style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}>

      <SidebarView
        isMac={isMac}
        sidebarCollapsed={c.sidebarCollapsed}
        setSidebarCollapsed={c.setSidebarCollapsed}
        section={c.section}
        setSection={c.setSection}
        sidebarNav={c.sidebarNav}
        navBadges={c.navBadges}
        companySwitcherOpen={c.companySwitcherOpen}
        setCompanySwitcherOpen={c.setCompanySwitcherOpen}
        confirmDeleteCompanyId={c.confirmDeleteCompanyId}
        setConfirmDeleteCompanyId={c.setConfirmDeleteCompanyId}
        currentCompany={c.currentCompany}
        snapshot={c.snapshot}
        setCompany={c.setCompany}
        deleteCompany={c.deleteCompany}
        setCommandPaletteOpen={c.setCommandPaletteOpen}
        t={c.t}
      />

      <main aria-label="Content" className="flex min-w-0 flex-col overflow-hidden">
        <header className="sidebar-drag shrink-0 border-b border-border bg-background">
          <div className="mx-auto flex w-full max-w-[1040px] items-start justify-between gap-4 px-6 pb-5 pt-6 lg:gap-6 lg:px-10 lg:pt-8">
            <h1 className="text-[28px] font-bold tracking-[-0.02em] text-foreground">
              {c.navItems.find((item) => item.id === c.section)?.label ?? c.t(`nav.${c.section}`)}
            </h1>
            <div className="flex shrink-0 items-center gap-3 lg:gap-5">
              <button
                type="button"
                aria-label={c.consoleOpen ? "Hide console" : "Show console"}
                title={c.consoleOpen ? "Hide console" : "Show console"}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 inline-flex items-center gap-2 py-1 text-[12px] font-semibold text-muted-foreground transition hover:text-foreground"
                onClick={() => c.setConsoleOpen(!c.consoleOpen)}
              >
                <TerminalWindow size={16} />
                <span className="hidden lg:inline">{c.consoleOpen ? c.t("app.hideConsole") : c.t("app.showConsole")}</span>
              </button>
            </div>
          </div>
        </header>

        <SectionContentView
          section={c.section}
          error={c.error}
          snapshot={c.snapshot}
          currentCompany={c.currentCompany}
          locale={c.locale}
          tasks={c.tasks}
          runs={c.runs}
          approvals={c.approvals}
          pendingApprovals={c.pendingApprovals}
          companyAgents={c.companyAgents}
          companyGoals={c.companyGoals}
          companyProjects={c.companyProjects}
          companyWorkspaces={c.companyWorkspaces}
          companyCosts={c.companyCosts}
          filteredActivity={c.filteredActivity}
          companySecrets={c.companySecrets}
          companyDocuments={c.companyDocuments}
          companyKnowledge={c.companyKnowledge}
          companyMeetings={c.companyMeetings}
          companySprints={c.companySprints}
          socialAccounts={c.socialAccounts}
          browserActions={c.browserActions}
          inboxItems={c.inboxItems}
          companyMetrics={c.companyMetrics}
          standupReport={c.standupReport}
          selectedTask={c.selectedTask}
          selectedTaskId={c.selectedTaskId}
          setSelectedTaskId={c.setSelectedTaskId}
          selectedConnector={c.selectedConnector}
          setSelectedConnectorId={c.setSelectedConnectorId}
          selectedApproval={c.selectedApproval}
          selectedApprovalId={c.selectedApprovalId}
          setSelectedApprovalId={c.setSelectedApprovalId}
          selectedAgent={c.selectedAgent}
          selectedAgentId={c.selectedAgentId}
          setSelectedAgentId={c.setSelectedAgentId}
          selectedGoal={c.selectedGoal}
          selectedGoalId={c.selectedGoalId}
          setSelectedGoalId={c.setSelectedGoalId}
          selectedProject={c.selectedProject}
          selectedProjectId={c.selectedProjectId}
          setSelectedProjectId={c.setSelectedProjectId}
          selectedWorkspace={c.selectedWorkspace}
          setSelectedWorkspaceId={c.setSelectedWorkspaceId}
          selectedCommunicationEntityId={c.selectedCommunicationEntityId}
          setSelectedCommunicationEntityId={c.setSelectedCommunicationEntityId}
          taskViewMode={c.taskViewMode}
          setTaskViewMode={c.setTaskViewMode}
          selectedRunId={c.selectedRunId}
          navigateTo={c.navigateTo}
          setSection={c.setSection}
          setConsoleOpen={c.setConsoleOpen}
          setSelectedRunId={c.setSelectedRunId}
          refresh={c.refresh}
          startRun={c.startRun}
          cancelRun={c.cancelRun}
          openPathWithFeedback={c.openPathWithFeedback}
          setError={c.setError}
          pageTransition={c.pageTransition}
        />

        <ConsoleView
          consoleOpen={c.consoleOpen}
          setConsoleOpen={c.setConsoleOpen}
          selectedRun={c.selectedRun}
          setSelectedRunId={c.setSelectedRunId}
          runs={c.runs}
          logBufferRef={c.logBufferRef}
          openPathWithFeedback={c.openPathWithFeedback}
          panelTransition={c.panelTransition}
          t={c.t}
        />
      </main>

      <CommandPaletteView
        commandPaletteOpen={c.commandPaletteOpen}
        setCommandPaletteOpen={c.setCommandPaletteOpen}
        commandPaletteSearch={c.commandPaletteSearch}
        setCommandPaletteSearch={c.setCommandPaletteSearch}
        selectedPaletteIndex={c.selectedPaletteIndex}
        setSelectedPaletteIndex={c.setSelectedPaletteIndex}
        paletteTrapRef={c.paletteTrapRef}
        filteredNavItems={c.filteredNavItems}
        matchedAgents={c.matchedAgents}
        matchedTasks={c.matchedTasks}
        matchedRuns={c.matchedRuns}
        matchedGoals={c.matchedGoals}
        matchedProjects={c.matchedProjects}
        hasEntityResults={c.hasEntityResults}
        paletteActions={c.paletteActions}
        paletteActionIndex={c.paletteActionIndex}
        runs={c.runs}
        navigateTo={c.navigateTo}
        panelTransition={c.panelTransition}
        t={c.t}
      />

      <ToastContainer />
    </div>
    </div>
    </TranslationContext.Provider>
    </LocaleContext.Provider>
  );
}

export default App;
