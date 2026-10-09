import { StartupScreen } from "./StartupScreen";
import type { Focus } from "../pages/types";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Shell, type RouteId } from "../shared/Shell";
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

export function App() {
  const { snapshot, syncFailure, actions } = useSnapshot();
  const [route, setRoute] = useState<RouteId>("home");
  const [focus, setFocus] = useState<Focus | null>(null);
  // Opening a page for an object remembers it; plain navigation forgets it.
  const navigate = (next: RouteId, nextFocus?: Focus) => {
    setRoute(next);
    setFocus(nextFocus ?? null);
  };
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
      <Shell
        snapshot={snapshot}
        route={route}
        setRoute={(next) => navigate(next)}
        onSwitchOrg={(orgId) => void actions.run(() => window.agentCompany.setActiveOrganization({ orgId }))}
        onDeleteOrg={(orgId) => void actions.run(() => window.agentCompany.deleteOrganization({ orgId }))}
        onNewOrg={() => setCreatingOrg(true)}
      >
        <Fragment key={pageKey}>{page}</Fragment>
      </Shell>
    </AvatarDirectoryContext.Provider>
  );
}
