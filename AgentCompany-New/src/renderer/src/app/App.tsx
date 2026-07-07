import { useState } from "react";
import { Shell, type RouteId } from "../shared/Shell";
import { Onboarding } from "./Onboarding";
import { useSnapshot } from "./useSnapshot";
import { HomePage } from "../pages/HomePage";
import { TeamPage } from "../pages/TeamPage";
import { WorkPage } from "../pages/WorkPage";
import { ChatPage } from "../pages/ChatPage";
import { FilesPage } from "../pages/FilesPage";
import { ApprovalsPage } from "../pages/ApprovalsPage";
import { SocialPage } from "../pages/SocialPage";
import { DocumentsPage } from "../pages/DocumentsPage";
import { RunsPage } from "../pages/RunsPage";
import { SettingsPage } from "../pages/SettingsPage";
import { OfficePage } from "../pages/OfficePage";

export function App() {
  const { snapshot, actions } = useSnapshot();
  const [route, setRoute] = useState<RouteId>("home");
  const [creatingOrg, setCreatingOrg] = useState(false);

  if (!snapshot) {
    return <div className="app-shell" style={{ display: "grid", placeItems: "center" }} />;
  }
  if (snapshot.organizations.length === 0 || creatingOrg) {
    return (
      <Onboarding
        snapshot={snapshot}
        actions={actions}
        onCancel={creatingOrg ? () => setCreatingOrg(false) : null}
        onCompleted={() => setCreatingOrg(false)}
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
    docs: <DocumentsPage {...pageProps} />,
    runs: <RunsPage {...pageProps} />,
    approvals: <ApprovalsPage {...pageProps} />,
    social: <SocialPage {...pageProps} />,
    office: <OfficePage {...pageProps} />,
    settings: <SettingsPage {...pageProps} />,
  }[route];

  return (
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
  );
}
