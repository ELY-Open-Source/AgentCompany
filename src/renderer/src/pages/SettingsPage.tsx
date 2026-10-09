import { useRevealObject } from "../shared/reveal";
import { oneOf, usePersistentState } from "../shared/view-state";
import { useLeaveGuard } from "../app/leave-guard";
import { useMemo } from "react";
import { ProvidersPanel } from "./settings/ProvidersPanel";
import { WorkspacePanel } from "./settings/WorkspacePanel";
import { AdvancedPanel } from "./settings/AdvancedPanel";
import { IntegrationKeysPanel } from "./settings/IntegrationKeysPanel";
import { t } from "../i18n/i18n";
import type { PageProps } from "./types";
import { activeOrgId, requireActiveEmployee, requireActiveOrganization, requireUsageStats } from "./types";

const SETTINGS_TABS = ["general", "providers", "integrations", "advanced"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

interface NavSpec {
  id: SettingsTab;
  label: string;
}

const TABS: NavSpec[] = [
  { id: "general", label: t("General") },
  { id: "providers", label: t("Providers") },
  { id: "integrations", label: t("Integrations") },
  { id: "advanced", label: t("Advanced") },
];

export function SettingsPage({ snapshot, actions, focus }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const organization = requireActiveOrganization(snapshot);
  const employee = requireActiveEmployee(snapshot);
  // A workspace link opens General, where workspaces are, whatever section was left open.
  const [tab, setTab] = usePersistentState<SettingsTab>(`${orgId}:settings.tab`, "general", oneOf(SETTINGS_TABS), focus?.kind === "workspace" ? "general" : focus?.kind === "provider" ? "providers" : undefined);
  useRevealObject(focus?.kind === "provider" ? focus.id : null);
  const requestLeave = useLeaveGuard();

  const agents = useMemo(() => snapshot.agents.filter((item) => item.orgId === orgId), [snapshot.agents, orgId]);
  const providers = useMemo(() => snapshot.providers.filter((item) => item.orgId === orgId), [snapshot.providers, orgId]);
  const providerAuthProfiles = useMemo(() => snapshot.providerAuthProfiles.filter((item) => item.orgId === orgId), [snapshot.providerAuthProfiles, orgId]);
  const usage = requireUsageStats(snapshot.usageStats, orgId);
  const providerRateLimits = useMemo(() => snapshot.providerRateLimits.filter((item) => item.orgId === orgId), [snapshot.providerRateLimits, orgId]);
  const workspaces = useMemo(() => snapshot.workspaces.filter((item) => item.orgId === orgId), [snapshot.workspaces, orgId]);
  const providerRequests = useMemo(() => snapshot.providerRequests.filter((item) => item.orgId === orgId), [snapshot.providerRequests, orgId]);
  const hiringPolicies = useMemo(() => snapshot.hiringPolicies.filter((item) => item.orgId === orgId), [snapshot.hiringPolicies, orgId]);

  return (
    <div className="split-main">
      <aside className="secondary-pane">
        <div style={{ fontSize: 14, fontWeight: 600, padding: "4px 8px 14px" }}>{t("Settings")}</div>
        <div className="pane-scroll">
          <NavGroup items={TABS} active={tab} onChange={(next) => requestLeave(() => setTab(next))} />
        </div>
      </aside>
      <div className="main" style={{ flex: 1, minWidth: 0 }}>
        <div className="content">
          {tab === "general" && <WorkspacePanel focusedWorkspaceId={focus?.kind === "workspace" ? focus.id : null} organization={organization} workspaces={workspaces} projects={snapshot.projects.filter((p) => p.orgId === orgId)} orgId={orgId} uiPreferences={snapshot.uiPreferences} actions={actions} />}
          {tab === "providers" && (
            <ProvidersPanel
              orgId={orgId}
              companyName={organization.name}
              employeeId={employee.id}
              providers={providers}
              authProfiles={providerAuthProfiles}
              catalog={snapshot.providerCatalog}
              agents={agents}
              providerRateLimits={providerRateLimits}
              actions={actions}
            />
          )}
          {tab === "integrations" && <IntegrationKeysPanel keys={snapshot.integrationKeys} companyName={organization.name} actions={actions} />}
          {tab === "advanced" && (
            <AdvancedPanel
              orgId={orgId}
              organization={organization}
              agents={agents}
              providers={providers}
              catalog={snapshot.providerCatalog}
              workspaces={workspaces}
              providerRequests={providerRequests}
              providerRateLimits={providerRateLimits}
              usage={usage}
              hiringPolicies={hiringPolicies}
              actions={actions}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function NavGroup({
  items,
  active,
  onChange,
}: {
  items: NavSpec[];
  active: SettingsTab;
  onChange: (next: SettingsTab) => void;
}) {
  return (
    <div className="nav" style={{ gap: 1 }}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-label={item.label}
          className={`nav-item ${item.id === active ? "active" : ""}`.trim()}
          onClick={() => onChange(item.id)}
        >
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
