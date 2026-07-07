import { useMemo, useState } from "react";
import { ProvidersPanel } from "./settings/ProvidersPanel";
import { SkillsPanel } from "./settings/SkillsPanel";
import { WorkspacePanel } from "./settings/WorkspacePanel";
import { AdvancedPanel } from "./settings/AdvancedPanel";
import type { PageProps } from "./types";
import { activeOrgId, requireActiveEmployee, requireActiveOrganization } from "./types";

type SettingsTab = "general" | "providers" | "skills" | "advanced";

interface NavSpec {
  id: SettingsTab;
  label: string;
}

const TABS: NavSpec[] = [
  { id: "general", label: "General" },
  { id: "providers", label: "Providers" },
  { id: "skills", label: "Skills" },
  { id: "advanced", label: "Advanced" },
];

export function SettingsPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const organization = requireActiveOrganization(snapshot);
  const employee = requireActiveEmployee(snapshot);
  const [tab, setTab] = useState<SettingsTab>("general");

  const agents = useMemo(() => snapshot.agents.filter((item) => item.orgId === orgId), [snapshot.agents, orgId]);
  const providers = useMemo(() => snapshot.providers.filter((item) => item.orgId === orgId), [snapshot.providers, orgId]);
  const providerAuthProfiles = useMemo(() => snapshot.providerAuthProfiles.filter((item) => item.orgId === orgId), [snapshot.providerAuthProfiles, orgId]);
  const providerRateLimits = useMemo(() => snapshot.providerRateLimits.filter((item) => item.orgId === orgId), [snapshot.providerRateLimits, orgId]);
  const skills = useMemo(() => snapshot.skillDefinitions.filter((item) => item.orgId === orgId), [snapshot.skillDefinitions, orgId]);
  const skillRevisions = useMemo(() => {
    const skillIds = new Set(skills.map((skill) => skill.id));
    return snapshot.skillRevisions.filter((revision) => skillIds.has(revision.skillId));
  }, [snapshot.skillRevisions, skills]);
  const skillTests = useMemo(() => {
    const revisionIds = new Set(skillRevisions.map((revision) => revision.id));
    return snapshot.skillTests.filter((test) => revisionIds.has(test.revisionId));
  }, [snapshot.skillTests, skillRevisions]);
  const skillBindings = useMemo(() => snapshot.skillBindings.filter((item) => item.orgId === orgId), [snapshot.skillBindings, orgId]);
  const workspaces = useMemo(() => snapshot.workspaces.filter((item) => item.orgId === orgId), [snapshot.workspaces, orgId]);
  const providerRequests = useMemo(() => snapshot.providerRequests.filter((item) => item.orgId === orgId), [snapshot.providerRequests, orgId]);
  const hiringPolicies = useMemo(() => snapshot.hiringPolicies.filter((item) => item.orgId === orgId), [snapshot.hiringPolicies, orgId]);
  const migrationReports = useMemo(() => snapshot.migrationReports.filter((report) => report.orgId === orgId), [snapshot.migrationReports, orgId]);
  const rollbackSnapshots = useMemo(() => snapshot.rollbackSnapshots.filter((item) => item.orgId === orgId), [snapshot.rollbackSnapshots, orgId]);

  return (
    <div className="split-main">
      <aside className="secondary-pane">
        <div style={{ fontSize: 14, fontWeight: 600, padding: "4px 8px 14px" }}>Settings</div>
        <div className="pane-scroll">
          <NavGroup items={TABS} active={tab} onChange={setTab} />
        </div>
      </aside>
      <div className="main" style={{ flex: 1, minWidth: 0 }}>
        <div className="content">
          {tab === "general" && <WorkspacePanel organization={organization} workspaces={workspaces} projects={snapshot.projects.filter((p) => p.orgId === orgId)} orgId={orgId} actions={actions} />}
          {tab === "providers" && (
            <ProvidersPanel
              orgId={orgId}
              employeeId={employee.id}
              providers={providers}
              authProfiles={providerAuthProfiles}
              catalog={snapshot.providerCatalog}
              agents={agents}
              providerRateLimits={providerRateLimits}
              actions={actions}
            />
          )}
          {tab === "skills" && (
            <SkillsPanel
              orgId={orgId}
              skills={skills}
              revisions={skillRevisions}
              bindings={skillBindings}
              tests={skillTests}
              agents={agents}
              actions={actions}
            />
          )}
          {tab === "advanced" && (
            <AdvancedPanel
              orgId={orgId}
              employeeId={employee.id}
              agents={agents}
              providers={providers}
              catalog={snapshot.providerCatalog}
              workspaces={workspaces}
              providerRequests={providerRequests}
              hiringPolicies={hiringPolicies}
              composioSettings={snapshot.composioSettings}
              migrationReports={migrationReports}
              rollbackSnapshots={rollbackSnapshots}
              reconciliationItems={snapshot.migrationReconciliationItems.filter((item) => item.orgId === orgId)}
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
