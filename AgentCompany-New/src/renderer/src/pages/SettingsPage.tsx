import { useMemo, useState } from "react";
import { ProvidersPanel } from "./settings/ProvidersPanel";
import { SkillsPanel } from "./settings/SkillsPanel";
import { WorkspacePanel } from "./settings/WorkspacePanel";
import { MembersPanel } from "./settings/MembersPanel";
import { BillingPanel } from "./settings/BillingPanel";
import { ModelsPanel } from "./settings/ModelsPanel";
import { PoliciesPanel } from "./settings/PoliciesPanel";
import { OperationsPanel } from "./settings/OperationsPanel";
import { SdlcPanel } from "./settings/SdlcPanel";
import { MigrationPanel } from "./settings/MigrationPanel";
import { CompliancePanel } from "./settings/CompliancePanel";
import { NotificationsPanel, ProfilePanel, SecurityPanel } from "./settings/AccountPanels";
import type { PageProps } from "./types";
import { activeOrgId, requireActiveEmployee, requireActiveOrganization } from "./types";

type SettingsTab =
  | "workspace"
  | "members"
  | "billing"
  | "models"
  | "providers"
  | "skills"
  | "policies"
  | "operations"
  | "sdlc"
  | "compliance"
  | "migration"
  | "profile"
  | "notifications"
  | "security";

interface NavSpec {
  id: SettingsTab;
  label: string;
}

const WORKSPACE_GROUP: NavSpec[] = [
  { id: "workspace", label: "Workspace" },
  { id: "members", label: "Members" },
  { id: "billing", label: "Billing" },
];
const AGENTS_GROUP: NavSpec[] = [
  { id: "models", label: "Models" },
  { id: "providers", label: "Providers" },
  { id: "skills", label: "Skills" },
  { id: "policies", label: "Policies" },
  { id: "operations", label: "Operations" },
  { id: "sdlc", label: "SDLC" },
  { id: "compliance", label: "Compliance" },
  { id: "migration", label: "Migration" },
];
const ACCOUNT_GROUP: NavSpec[] = [
  { id: "profile", label: "Profile" },
  { id: "notifications", label: "Notifications" },
  { id: "security", label: "Security" },
];

export function SettingsPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const organization = requireActiveOrganization(snapshot);
  const employee = requireActiveEmployee(snapshot);
  const [tab, setTab] = useState<SettingsTab>("providers");

  const employees = useMemo(() => snapshot.employees.filter((item) => item.orgId === orgId), [snapshot.employees, orgId]);
  const agents = useMemo(() => snapshot.agents.filter((item) => item.orgId === orgId), [snapshot.agents, orgId]);
  const providers = useMemo(() => snapshot.providers.filter((item) => item.orgId === orgId), [snapshot.providers, orgId]);
  const skills = useMemo(() => snapshot.skillDefinitions.filter((item) => item.orgId === orgId), [snapshot.skillDefinitions, orgId]);
  const skillRevisions = useMemo(() => {
    const skillIds = new Set(skills.map((skill) => skill.id));
    return snapshot.skillRevisions.filter((revision) => skillIds.has(revision.skillId));
  }, [snapshot.skillRevisions, skills]);
  const skillBindings = useMemo(() => snapshot.skillBindings.filter((item) => item.orgId === orgId), [snapshot.skillBindings, orgId]);
  const policies = useMemo(() => snapshot.policyRules.filter((item) => item.orgId === orgId), [snapshot.policyRules, orgId]);
  const workspaces = useMemo(() => snapshot.workspaces.filter((item) => item.orgId === orgId), [snapshot.workspaces, orgId]);
  const chatSpaces = useMemo(() => snapshot.chatSpaces.filter((item) => item.orgId === orgId), [snapshot.chatSpaces, orgId]);
  const chatThreads = useMemo(() => snapshot.chatThreads.filter((item) => item.orgId === orgId), [snapshot.chatThreads, orgId]);
  const files = useMemo(() => snapshot.files.filter((item) => item.orgId === orgId), [snapshot.files, orgId]);
  const providerRequests = useMemo(() => snapshot.providerRequests.filter((item) => item.orgId === orgId), [snapshot.providerRequests, orgId]);
  const auditEvents = useMemo(() => snapshot.auditEvents.filter((event) => event.orgId === orgId), [snapshot.auditEvents, orgId]);
  const migrationReports = useMemo(() => snapshot.migrationReports.filter((report) => report.orgId === orgId), [snapshot.migrationReports, orgId]);
  const complianceExports = useMemo(() => snapshot.complianceExports.filter((item) => item.orgId === orgId), [snapshot.complianceExports, orgId]);
  const legalHolds = useMemo(() => snapshot.legalHolds.filter((item) => item.orgId === orgId), [snapshot.legalHolds, orgId]);
  const retentionFreezes = useMemo(() => snapshot.retentionFreezes.filter((item) => item.orgId === orgId), [snapshot.retentionFreezes, orgId]);
  const employeeIdentities = useMemo(() => snapshot.employeeIdentities.filter((item) => item.orgId === orgId), [snapshot.employeeIdentities, orgId]);
  const serviceIdentities = useMemo(() => snapshot.serviceIdentities.filter((item) => item.orgId === orgId), [snapshot.serviceIdentities, orgId]);
  const roleGrants = useMemo(() => snapshot.roleGrants.filter((item) => item.orgId === orgId), [snapshot.roleGrants, orgId]);
  const orgDepartments = useMemo(() => snapshot.orgDepartments.filter((item) => item.orgId === orgId), [snapshot.orgDepartments, orgId]);
  const hiringPolicies = useMemo(() => snapshot.hiringPolicies.filter((item) => item.orgId === orgId), [snapshot.hiringPolicies, orgId]);
  const approvalRoutingRules = useMemo(() => snapshot.approvalRoutingRules.filter((item) => item.orgId === orgId), [snapshot.approvalRoutingRules, orgId]);
  const approvalAssignments = useMemo(() => snapshot.approvalAssignments.filter((item) => item.orgId === orgId), [snapshot.approvalAssignments, orgId]);
  const featureFlags = useMemo(() => snapshot.featureFlags.filter((item) => item.orgId === orgId), [snapshot.featureFlags, orgId]);
  const sloTargets = useMemo(() => snapshot.sloTargets.filter((item) => item.orgId === orgId), [snapshot.sloTargets, orgId]);
  const operationalEvents = useMemo(() => snapshot.operationalEvents.filter((item) => item.orgId === orgId), [snapshot.operationalEvents, orgId]);
  const chaosDrills = useMemo(() => snapshot.chaosDrills.filter((item) => item.orgId === orgId), [snapshot.chaosDrills, orgId]);
  const chaosDrillRuns = useMemo(() => snapshot.chaosDrillRuns.filter((item) => item.orgId === orgId), [snapshot.chaosDrillRuns, orgId]);
  const sdlcReviewAgents = useMemo(() => snapshot.sdlcReviewAgents.filter((item) => item.orgId === orgId), [snapshot.sdlcReviewAgents, orgId]);
  const sdlcReviewRuns = useMemo(() => snapshot.sdlcReviewRuns.filter((item) => item.orgId === orgId), [snapshot.sdlcReviewRuns, orgId]);
  const evalSuites = useMemo(() => snapshot.evalSuites.filter((item) => item.orgId === orgId), [snapshot.evalSuites, orgId]);
  const evalCases = useMemo(() => snapshot.evalCases.filter((item) => item.orgId === orgId), [snapshot.evalCases, orgId]);
  const evalRuns = useMemo(() => snapshot.evalRuns.filter((item) => item.orgId === orgId), [snapshot.evalRuns, orgId]);
  const prBotGates = useMemo(() => snapshot.prBotGates.filter((item) => item.orgId === orgId), [snapshot.prBotGates, orgId]);
  const auditReplayRuns = useMemo(() => snapshot.auditReplayRuns.filter((item) => item.orgId === orgId), [snapshot.auditReplayRuns, orgId]);
  const rollbackSnapshots = useMemo(() => snapshot.rollbackSnapshots.filter((item) => item.orgId === orgId), [snapshot.rollbackSnapshots, orgId]);

  return (
    <div className="split-main" style={{ height: "calc(100vh - 44px)", margin: "-28px -32px -40px" }}>
      <aside className="secondary-pane">
        <div style={{ fontSize: 13, fontWeight: 600, padding: "4px 8px 14px" }}>Settings</div>
        <NavGroup items={WORKSPACE_GROUP} active={tab} onChange={setTab} />
        <NavGroupLabel>Agents</NavGroupLabel>
        <NavGroup items={AGENTS_GROUP} active={tab} onChange={setTab} />
        <NavGroupLabel>Account</NavGroupLabel>
        <NavGroup items={ACCOUNT_GROUP} active={tab} onChange={setTab} />
      </aside>
      <div className="main" style={{ flex: 1, minWidth: 0 }}>
        <div className="content">
          {tab === "workspace" && <WorkspacePanel organization={organization} workspaces={workspaces} />}
          {tab === "members" && (
            <MembersPanel
              employees={employees}
              agents={agents}
              employeeIdentities={employeeIdentities}
              serviceIdentities={serviceIdentities}
              roleGrants={roleGrants}
            />
          )}
          {tab === "billing" && <BillingPanel agents={agents} providers={providers} providerRequests={providerRequests} />}
          {tab === "models" && <ModelsPanel providers={providers} agents={agents} />}
          {tab === "providers" && (
            <ProvidersPanel
              orgId={orgId}
              providers={providers}
              catalog={snapshot.providerCatalog}
              agents={agents}
              providerRequests={providerRequests}
              actions={actions}
            />
          )}
          {tab === "skills" && (
            <SkillsPanel
              orgId={orgId}
              skills={skills}
              revisions={skillRevisions}
              bindings={skillBindings}
              agents={agents}
              actions={actions}
            />
          )}
          {tab === "policies" && (
            <PoliciesPanel
              policies={policies}
              agents={agents}
              employees={employees}
              orgDepartments={orgDepartments}
              hiringPolicies={hiringPolicies}
              approvalRoutingRules={approvalRoutingRules}
              approvalAssignments={approvalAssignments}
            />
          )}
          {tab === "operations" && (
            <OperationsPanel
              orgId={orgId}
              featureFlags={featureFlags}
              sloTargets={sloTargets}
              operationalEvents={operationalEvents}
              chaosDrills={chaosDrills}
              chaosDrillRuns={chaosDrillRuns}
              actions={actions}
            />
          )}
          {tab === "sdlc" && (
            <SdlcPanel
              orgId={orgId}
              reviewAgents={sdlcReviewAgents}
              reviewRuns={sdlcReviewRuns}
              evalSuites={evalSuites}
              evalCases={evalCases}
              evalRuns={evalRuns}
              prBotGates={prBotGates}
              migrationReports={migrationReports}
              policies={policies}
              actions={actions}
            />
          )}
          {tab === "compliance" && (
            <CompliancePanel
              orgId={orgId}
              employeeId={employee.id}
              employees={employees}
              agents={agents}
              chatSpaces={chatSpaces}
              chatThreads={chatThreads}
              files={files}
              exports={complianceExports}
              legalHolds={legalHolds}
              retentionFreezes={retentionFreezes}
              auditReplayRuns={auditReplayRuns}
              actions={actions}
            />
          )}
          {tab === "migration" && (
            <MigrationPanel
              orgId={orgId}
              employeeId={employee.id}
              reports={migrationReports}
              rollbackSnapshots={rollbackSnapshots}
              actions={actions}
            />
          )}
          {tab === "profile" && <ProfilePanel employee={employee} />}
          {tab === "notifications" && <NotificationsPanel events={auditEvents} employee={employee} />}
          {tab === "security" && <SecurityPanel events={auditEvents} />}
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

function NavGroupLabel({ children }: { children: string }) {
  return (
    <div className="section-label" style={{ margin: "18px 0 6px", padding: "0 8px" }}>{children}</div>
  );
}
