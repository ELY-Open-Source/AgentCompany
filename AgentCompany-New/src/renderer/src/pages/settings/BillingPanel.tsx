import { Pill } from "../../shared/ui";
import type { AgentRecord, ProviderRecord, ProviderRequestRecord } from "../../../../shared/domain";
import { money } from "../types";

export function BillingPanel({
  agents,
  providers,
  providerRequests,
}: {
  agents: AgentRecord[];
  providers: ProviderRecord[];
  providerRequests: ProviderRequestRecord[];
}) {
  const totalBudget = agents.reduce((sum, agent) => sum + agent.budgetCents, 0);
  const monthRequests = providerRequests.filter((request) => withinDays(request.createdAt, 30));
  return (
    <div className="page">
      <h1 className="page-h1">Billing</h1>
      <p className="page-sub">Allocations, provider activity, and budget windows.</p>
      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div className="section-label" style={{ marginBottom: 8 }}>Monthly allocation</div>
        <div className="num" style={{ fontSize: 28, fontWeight: 600 }}>{money(totalBudget)}</div>
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>across {agents.length} {agents.length === 1 ? "agent" : "agents"}</div>
      </div>

      <div className="section-label" style={{ marginBottom: 10 }}>Activity (30 days)</div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          className="table-row head"
          style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)" }}
        >
          <div>Provider</div><div>Requests</div><div>Errors</div><div>Agents</div>
        </div>
        {providers.map((provider, index) => {
          const requests = monthRequests.filter((request) => request.providerId === provider.id);
          const errors = requests.filter((request) => request.state === "failed").length;
          const boundAgents = agents.filter((agent) => agent.modelProviderId === provider.id).length;
          const last = index === providers.length - 1;
          return (
            <div
              key={provider.id}
              className="table-row"
              style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", borderBottom: last ? "none" : "1px solid var(--border-soft)" }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 540 }}>{provider.label}</div>
                {provider.model && (
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>{provider.model}</div>
                )}
              </div>
              <div className="num mono">{requests.length}</div>
              <div>{errors > 0 ? <Pill tone="amber">{errors}</Pill> : <span className="num mono" style={{ color: "var(--text-3)" }}>0</span>}</div>
              <div className="num mono" style={{ color: "var(--text-2)" }}>{boundAgents}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function withinDays(iso: string, days: number): boolean {
  return Date.now() - new Date(iso).getTime() < days * 24 * 60 * 60 * 1000;
}
