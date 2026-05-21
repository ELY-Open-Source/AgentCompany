import { Pill } from "../../shared/ui";
import type { AgentRecord, ProviderRecord } from "../../../../shared/domain";

export function ModelsPanel({
  providers,
  agents,
}: {
  providers: ProviderRecord[];
  agents: AgentRecord[];
}) {
  const rows = collectModels(providers, agents);
  return (
    <div className="page">
      <h1 className="page-h1">Models</h1>
      <p className="page-sub">Models that agents reference, derived from connected providers and agent assignments.</p>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          className="table-row head"
          style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1fr)" }}
        >
          <div>Provider</div><div>Model</div><div>Agents</div><div>Source</div>
        </div>
        {rows.length === 0 ? (
          <div style={{ padding: 18, color: "var(--text-3)" }}>No models configured.</div>
        ) : rows.map((row, index) => (
          <div
            key={`${row.providerId}-${row.model}`}
            className="table-row"
            style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1fr)", borderBottom: index === rows.length - 1 ? "none" : "1px solid var(--border-soft)" }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 540 }}>{row.providerLabel}</div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>{row.authType}</div>
            </div>
            <div className="mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.model}</div>
            <div className="num mono">{row.agentCount}</div>
            <div>{row.source === "default" ? <Pill>Provider default</Pill> : <Pill tone="violet">Agent assignment</Pill>}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ModelRow {
  providerId: string;
  providerLabel: string;
  authType: string;
  model: string;
  agentCount: number;
  source: "default" | "agent";
}

function collectModels(providers: ProviderRecord[], agents: AgentRecord[]): ModelRow[] {
  const map = new Map<string, ModelRow>();
  for (const provider of providers) {
    if (!provider.enabled || !provider.model) continue;
    const key = `${provider.id}::${provider.model}`;
    map.set(key, {
      providerId: provider.id,
      providerLabel: provider.label,
      authType: humanAuth(provider.authType),
      model: provider.model,
      agentCount: agents.filter((agent) => agent.modelProviderId === provider.id && (agent.modelId === provider.model || !agent.modelId)).length,
      source: "default",
    });
  }
  for (const agent of agents) {
    if (!agent.modelProviderId || !agent.modelId) continue;
    const provider = providers.find((item) => item.id === agent.modelProviderId);
    if (!provider) continue;
    const key = `${provider.id}::${agent.modelId}`;
    const existing = map.get(key);
    if (existing) {
      existing.agentCount += 1;
      continue;
    }
    map.set(key, {
      providerId: provider.id,
      providerLabel: provider.label,
      authType: humanAuth(provider.authType),
      model: agent.modelId,
      agentCount: 1,
      source: "agent",
    });
  }
  return [...map.values()].sort((a, b) => a.providerLabel.localeCompare(b.providerLabel));
}

function humanAuth(authType: string): string {
  if (authType === "api_key") return "API key";
  if (authType === "oauth_pkce") return "OAuth";
  if (authType === "account_subscription") return "Account";
  if (authType === "cloud") return "Cloud";
  return authType;
}
