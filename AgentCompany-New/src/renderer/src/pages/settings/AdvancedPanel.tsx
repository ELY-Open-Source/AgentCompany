import type {
  AgentRecord,
  HiringPolicyRecord,
  MigrationReportRecord,
  ProviderCatalogEntry,
  ProviderRecord,
  ProviderRequestRecord,
  RollbackSnapshotRecord,
  WorkspaceRecord,
} from "../../../../shared/domain";
import type { MigrationReconciliationItemRecord } from "../../../../shared/rollback-domain";
import type { ComposioSettingRecord } from "../../../../shared/snapshot-domain";
import type { SnapshotActions } from "../../app/useSnapshot";
import { BillingPanel } from "./BillingPanel";
import { ComposioPanel } from "./ComposioPanel";
import { MigrationPanel } from "./MigrationPanel";
import { ProviderRequestPanel } from "./ProviderRequestPanel";

/** The low-frequency operator surfaces, one section each. */
export function AdvancedPanel({
  orgId,
  employeeId,
  agents,
  providers,
  catalog,
  workspaces,
  providerRequests,
  hiringPolicies,
  composioSettings,
  migrationReports,
  rollbackSnapshots,
  reconciliationItems,
  actions,
}: {
  orgId: string;
  employeeId: string;
  agents: AgentRecord[];
  providers: ProviderRecord[];
  catalog: ProviderCatalogEntry[];
  workspaces: WorkspaceRecord[];
  providerRequests: ProviderRequestRecord[];
  hiringPolicies: HiringPolicyRecord[];
  composioSettings: ComposioSettingRecord[];
  migrationReports: MigrationReportRecord[];
  rollbackSnapshots: RollbackSnapshotRecord[];
  reconciliationItems: MigrationReconciliationItemRecord[];
  actions: SnapshotActions;
}) {
  const connected = providers.filter((provider) => provider.enabled);
  return (
    <div className="page">
      <h1 className="page-h1">Advanced</h1>

      <div className="section-label" style={{ margin: "16px 0 10px" }}>Composio</div>
      <ComposioPanel orgId={orgId} settings={composioSettings} actions={actions} />

      {connected.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <ProviderRequestPanel
            orgId={orgId}
            providers={connected}
            catalog={catalog}
            workspaces={workspaces}
            providerRequests={providerRequests}
            actions={actions}
          />
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <BillingPanel agents={agents} providers={providers} providerRequests={providerRequests} hiringPolicies={hiringPolicies} />
      </div>

      <div style={{ marginTop: 28 }}>
        <MigrationPanel
          orgId={orgId}
          employeeId={employeeId}
          reports={migrationReports}
          rollbackSnapshots={rollbackSnapshots}
          reconciliationItems={reconciliationItems}
          actions={actions}
        />
      </div>
    </div>
  );
}
