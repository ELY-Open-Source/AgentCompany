import type { UsageStatsRecord } from "../../../../shared/usage-stats";
import type { ProviderRateLimitStateRecord } from "../../../../shared/provider-runtime-domain";
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
import { t } from "../../i18n/i18n";

/** The low-frequency operator surfaces, one section each. */
export function AdvancedPanel({
  orgId,
  agents,
  providers,
  catalog,
  workspaces,
  providerRequests,
  providerRateLimits,
  usage,
  hiringPolicies,
  actions,
}: {
  orgId: string;
  agents: AgentRecord[];
  providers: ProviderRecord[];
  catalog: ProviderCatalogEntry[];
  workspaces: WorkspaceRecord[];
  providerRequests: ProviderRequestRecord[];
  providerRateLimits: ProviderRateLimitStateRecord[];
  usage: UsageStatsRecord;
  hiringPolicies: HiringPolicyRecord[];
  actions: SnapshotActions;
}) {
  const connected = providers.filter((provider) => provider.enabled);
  return (
    <div className="page">
      <h1 className="page-h1">{t("Advanced")}</h1>

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
        <BillingPanel agents={agents} providers={providers} usage={usage} providerRateLimits={providerRateLimits} hiringPolicies={hiringPolicies} />
      </div>
    </div>
  );
}
