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
import { SettingsPage } from "../pages/SettingsPage";

export function App() {
  const { snapshot, error, actions } = useSnapshot();
  const [route, setRoute] = useState<RouteId>("home");

  if (!snapshot) {
    return <div className="app-shell" style={{ display: "grid", placeItems: "center" }} />;
  }
  if (snapshot.organizations.length === 0) {
    return <Onboarding snapshot={snapshot} actions={actions} />;
  }

  const pageProps = { snapshot, actions };
  const page = {
    home: <HomePage {...pageProps} />,
    team: <TeamPage {...pageProps} />,
    work: <WorkPage {...pageProps} />,
    chat: <ChatPage {...pageProps} />,
    files: <FilesPage {...pageProps} />,
    approvals: <ApprovalsPage {...pageProps} />,
    social: <SocialPage {...pageProps} />,
    settings: <SettingsPage {...pageProps} />,
  }[route];

  return (
    <Shell snapshot={snapshot} route={route} setRoute={setRoute}>
      {error && (
        <div className="card" style={{ marginBottom: 16, color: "var(--red)" }}>
          {error}
        </div>
      )}
      {page}
    </Shell>
  );
}
