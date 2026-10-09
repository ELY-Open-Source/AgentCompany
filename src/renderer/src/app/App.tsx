import { StaleBanner } from "./StaleBanner";
import { oneOf, readViewState, seedViewState, writeViewState } from "../shared/view-state";
import { LeaveGuardContext } from "./leave-guard";
import { t } from "../i18n/i18n";
import { Button } from "../shared/ui";
import { hasPageUnsaved } from "../shared/unsaved";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import { StartupScreen } from "./StartupScreen";
import type { Focus } from "../pages/types";
import { useEffect, useMemo, useState } from "react";
import { Shell } from "../shared/Shell";
import { ROUTE_IDS, type RouteId } from "../shared/routes";
import { AvatarDirectoryContext, type AvatarLook } from "../shared/ui";
import { Onboarding } from "./Onboarding";
import { useSnapshot } from "./useSnapshot";
import { HomePage } from "../pages/HomePage";
import { TeamPage } from "../pages/TeamPage";
import { WorkPage } from "../pages/WorkPage";
import { ChatPage } from "../pages/ChatPage";
import { FilesPage } from "../pages/FilesPage";
import { LibraryPage } from "../pages/LibraryPage";
import { ApprovalsPage } from "../pages/ApprovalsPage";
import { ConnectorsPage } from "../pages/ConnectorsPage";
import { RunsPage } from "../pages/RunsPage";
import { SettingsPage } from "../pages/SettingsPage";
import { OfficePage } from "../pages/OfficePage";

const isRoute = oneOf(ROUTE_IDS);

export function App() {
  const { snapshot, syncFailure, syncedAt, actions } = useSnapshot();
  const [routeChoice, setRoute] = useState<RouteId | null>(null);
  // A focus belongs to the company it was opened in; another company's page never receives it.
  const [focusChoice, setFocus] = useState<{ orgId: string | null; focus: Focus } | null>(null);
  // Leaving a page with input that would be lost asks first.
  const [leaving, setLeaving] = useState<{ proceed: () => void } | null>(null);
  const requestLeave = (proceed: () => void) => {
    if (hasPageUnsaved()) setLeaving({ proceed });
    else proceed();
  };
  // Opening a page for an object remembers it; plain navigation forgets it.
  const navigate = (next: RouteId, nextFocus?: Focus) => requestLeave(() => {
    setRoute(next);
    writeViewState("route", next);
    setFocus(nextFocus ? { orgId: snapshot?.activeOrgId ?? null, focus: nextFocus } : null);
  });
  const avatarDirectory = useMemo(() => {
    // Scope the directory to the active organization: names are only unique
    // within one org, and a same-named principal in another org must not
    // hijack the avatar shown here.
    const directory = new Map<string, AvatarLook>();
    const orgId = snapshot?.activeOrgId ?? null;
    for (const agent of snapshot?.agents ?? []) {
      if (agent.orgId !== orgId) continue;
      if (agent.avatarEmoji || agent.avatarColor || agent.avatarImage) {
        directory.set(agent.name, { emoji: agent.avatarEmoji, color: agent.avatarColor, image: agent.avatarImage });
      }
    }
    for (const employee of snapshot?.employees ?? []) {
      if (employee.orgId !== orgId) continue;
      if (employee.avatarEmoji || employee.avatarColor || employee.avatarImage) {
        directory.set(employee.displayName, { emoji: employee.avatarEmoji, color: employee.avatarColor, image: employee.avatarImage });
      }
    }
    return directory;
  }, [snapshot?.agents, snapshot?.employees, snapshot?.activeOrgId]);
  const [creatingOrg, setCreatingOrg] = useState(false);

  const theme = snapshot?.uiPreferences.theme ?? "system";
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  if (!snapshot) {
    // A failed manual retry is already recorded in syncFailure, which the screen shows.
    return <StartupScreen failure={syncFailure} onRetry={() => void actions.reload().catch(() => undefined)} />;
  }
  seedViewState(snapshot.viewState);
  const route = routeChoice ?? readViewState("route", isRoute) ?? "home";
  // A company exists from Launch on, but its setup is unfinished until the connectors step is done; that is stored, so a restart resumes it.
  const unfinished = snapshot.organizations.find((organization) => organization.setupCompletedAt === null) ?? null;
  if (snapshot.organizations.length === 0 || creatingOrg || unfinished) {
    return (
      <Onboarding
        snapshot={snapshot}
        actions={actions}
        onCancel={creatingOrg && !unfinished ? () => setCreatingOrg(false) : null}
        resumeOrgId={unfinished?.id ?? null}
        onCompleted={() => setCreatingOrg(false)}
      />
    );
  }

  const focus = focusChoice && focusChoice.orgId === snapshot.activeOrgId ? focusChoice.focus : null;
  const pageProps = { snapshot, actions, navigate, focus };
  const page = {
    home: <HomePage {...pageProps} />,
    team: <TeamPage {...pageProps} />,
    work: <WorkPage {...pageProps} />,
    chat: <ChatPage {...pageProps} />,
    files: <FilesPage {...pageProps} />,
    library: <LibraryPage {...pageProps} />,
    runs: <RunsPage {...pageProps} />,
    approvals: <ApprovalsPage {...pageProps} />,
    connectors: <ConnectorsPage {...pageProps} />,
    office: <OfficePage {...pageProps} />,
    settings: <SettingsPage {...pageProps} />,
  }[route];
  const pageKey = `${snapshot.activeOrgId}:${route}${focus ? `:${focus.kind}:${focus.id}` : ""}`;

  return (
    <AvatarDirectoryContext.Provider value={avatarDirectory}>
      <LeaveGuardContext.Provider value={requestLeave}>
      <Shell
        snapshot={snapshot}
        route={route}
        setRoute={(next) => navigate(next)}
        onSwitchOrg={(orgId) => requestLeave(() => void actions.run(() => window.agentCompany.setActiveOrganization({ orgId })))}
        onDeleteOrg={(orgId) => requestLeave(() => void actions.run(() => window.agentCompany.deleteOrganization({ orgId })))}
        onNewOrg={() => requestLeave(() => setCreatingOrg(true))}
        onOpen={navigate}
      >
        <ErrorBoundary key={pageKey} scope="page">{page}</ErrorBoundary>
      </Shell>
      </LeaveGuardContext.Provider>
      {/* A failed manual retry is already recorded in syncFailure, which the banner shows. */}
      {syncFailure && <StaleBanner failure={syncFailure} syncedAt={syncedAt} onRetry={() => void actions.reload().catch(() => undefined)} />}
      {leaving && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="alertdialog" aria-label={t("Leave this page?")}>
            <h2 className="modal-title">{t("Leave this page?")}</h2>
            <p style={{ margin: 0 }}>{t("What you typed here is lost if you leave.")}</p>
            <div className="modal-actions">
              <Button tone="ghost" onClick={() => setLeaving(null)}>{t("Stay")}</Button>
              <Button tone="primary" onClick={() => { setLeaving(null); leaving.proceed(); }}>{t("Leave")}</Button>
            </div>
          </div>
        </div>
      )}
    </AvatarDirectoryContext.Provider>
  );
}
