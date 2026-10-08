import { useEffect, useMemo, useState } from "react";
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
  const { snapshot, actions } = useSnapshot();
  const [route, setRoute] = useState<RouteId>("home");
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
  // Keeps the wizard mounted through its post-bootstrap connectors step: the
  // organization exists from Launch onward, so the org-count check alone
  // would flip to the shell mid-onboarding.
  const [finishingSetup, setFinishingSetup] = useState(false);

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
    return <div className="app-shell" style={{ display: "grid", placeItems: "center" }} />;
  }
  if (snapshot.organizations.length === 0 || creatingOrg || finishingSetup) {
    return (
      <Onboarding
        snapshot={snapshot}
        actions={actions}
        onCancel={creatingOrg ? () => setCreatingOrg(false) : null}
        onBootstrapped={() => setFinishingSetup(true)}
        onCompleted={() => {
          setCreatingOrg(false);
          setFinishingSetup(false);
        }}
      />
    );
  }

  const pageProps = { snapshot, actions, navigate: setRoute };
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

  return (
    <AvatarDirectoryContext.Provider value={avatarDirectory}>
      <Shell
        snapshot={snapshot}
        route={route}
        setRoute={setRoute}
        onSwitchOrg={(orgId) => void actions.run(() => window.agentCompany.setActiveOrganization({ orgId }))}
        onDeleteOrg={(orgId) => void actions.run(() => window.agentCompany.deleteOrganization({ orgId }))}
        onNewOrg={() => setCreatingOrg(true)}
      >
        {page}
      </Shell>
    </AvatarDirectoryContext.Provider>
  );
}
