import type {
  AgentRecord,
  HiringPolicyRecord,
  ProviderCatalogEntry,
  ProviderRecord,
  ProviderRequestRecord,
  WorkspaceRecord,
} from "../../../../shared/domain";
import type { SnapshotActions } from "../../app/useSnapshot";
import { BillingPanel } from "./BillingPanel";
import { ProviderRequestPanel } from "./ProviderRequestPanel";

/** The low-frequency operator surfaces, one section each. */
export function AdvancedPanel({
  orgId,
  agents,
  providers,
  catalog,
  workspaces,
  providerRequests,
  hiringPolicies,
  actions,
}: {
  orgId: string;
  agents: AgentRecord[];
  providers: ProviderRecord[];
  catalog: ProviderCatalogEntry[];
  workspaces: WorkspaceRecord[];
  providerRequests: ProviderRequestRecord[];
  hiringPolicies: HiringPolicyRecord[];
  actions: SnapshotActions;
}) {
  const connected = providers.filter((provider) => provider.enabled);
  return (
    <div className="page">
      <h1 className="page-h1">Advanced</h1>

      {connected.length > 0 && (
        <div style={{ marginTop: 16 }}>
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
    </div>
  );
}
