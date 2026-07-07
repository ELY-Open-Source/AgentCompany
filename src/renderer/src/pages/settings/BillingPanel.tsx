import { Avatar, Pill } from "../../shared/ui";
import type { AgentRecord, HiringPolicyRecord, ProviderRecord, ProviderRequestRecord } from "../../../../shared/domain";
import { money } from "../types";

export function BillingPanel({
  agents,
  providers,
  providerRequests,
  hiringPolicies,
}: {
  agents: AgentRecord[];
  providers: ProviderRecord[];
  providerRequests: ProviderRequestRecord[];
  hiringPolicies: HiringPolicyRecord[];
}) {
  const totalBudget = agents.reduce((sum, a) => sum + a.budgetCents, 0);
  const totalCap = hiringPolicies.reduce((sum, p) => sum + p.monthlyBudgetLimitCents, 0);
  const monthRequests = providerRequests.filter((r) => withinDays(r.createdAt, 30));
  const totalInputChars = monthRequests.reduce((s, r) => s + r.inputCharCount, 0);
  const totalOutputChars = monthRequests.reduce((s, r) => s + r.outputCharCount, 0);
  const failedRequests = monthRequests.filter((r) => r.state === "failed");
  const agentSpend = buildAgentSpend(agents, providers, monthRequests);

  return (
    <div>
      <div className="section-label" style={{ marginBottom: 10 }}>Billing</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 20 }}>
        <StatTile label="Monthly allocation" value={money(totalBudget)} />
        <StatTile label="Budget cap" value={totalCap > 0 ? money(totalCap) : "—"} />
        <StatTile label="Requests (30d)" value={String(monthRequests.length)} />
        <StatTile label="Failures (30d)" value={String(failedRequests.length)} tone={failedRequests.length > 0 ? "red" : undefined} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        <div className="card" style={{ padding: 14 }}>
          <div className="card-label" style={{ marginBottom: 8 }}>Token usage (30d)</div>
          <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "6px 14px", fontSize: 12 }}>
            <span style={{ color: "var(--text-3)" }}>Input chars</span><span className="num">{totalInputChars.toLocaleString()}</span>
            <span style={{ color: "var(--text-3)" }}>Output chars</span><span className="num">{totalOutputChars.toLocaleString()}</span>
            <span style={{ color: "var(--text-3)" }}>Total</span><span className="num">{(totalInputChars + totalOutputChars).toLocaleString()}</span>
          </div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="card-label" style={{ marginBottom: 8 }}>Budget utilization</div>
          <div style={{ height: 6, background: "var(--panel-3)", borderRadius: 3, overflow: "hidden", marginBottom: 8 }}>
            <div style={{ width: `${totalCap > 0 ? Math.min(100, Math.round((totalBudget / totalCap) * 100)) : 0}%`, height: "100%", background: "var(--accent)" }} />
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>
            {totalCap > 0 ? `${Math.round((totalBudget / totalCap) * 100)}% of cap` : "No budget cap set"}
          </div>
        </div>
      </div>

      <div className="section-label" style={{ marginBottom: 10 }}>Cost by agent</div>
      <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
        <div className="table-row head" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)" }}>
          <div>Agent</div><div>Budget</div><div>Requests</div><div>Input</div><div>Output</div>
        </div>
        {agentSpend.map((row, i) => (
          <div key={row.agent.id} className="table-row" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", borderBottom: i === agentSpend.length - 1 ? "none" : "1px solid var(--border-soft)" }}>
            <div className="row" style={{ gap: 8 }}>
              <Avatar name={row.agent.name} size="sm" bot />
              <span style={{ fontWeight: 480 }}>{row.agent.name}</span>
            </div>
            <div className="num mono">{money(row.agent.budgetCents)}</div>
            <div className="num mono">{row.requestCount}</div>
            <div className="num mono" style={{ fontSize: 12 }}>{row.inputChars.toLocaleString()}</div>
            <div className="num mono" style={{ fontSize: 12 }}>{row.outputChars.toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div className="section-label" style={{ marginBottom: 10 }}>Provider activity (30d)</div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-row head" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)" }}>
          <div>Provider</div><div>Requests</div><div>Errors</div><div>Agents</div>
        </div>
        {providers.map((provider, index) => {
          const requests = monthRequests.filter((r) => r.providerId === provider.id);
          const errors = requests.filter((r) => r.state === "failed").length;
          const boundAgents = agents.filter((a) => a.modelProviderId === provider.id).length;
          return (
            <div key={provider.id} className="table-row" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", borderBottom: index === providers.length - 1 ? "none" : "1px solid var(--border-soft)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 540 }}>{provider.label}</div>
                {provider.model && <div style={{ fontSize: 12, color: "var(--text-3)" }}>{provider.model}</div>}
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

function StatTile({ label, value, tone }: { label: string; value: string; tone?: "red" }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="card-label" style={{ marginBottom: 6 }}>{label}</div>
      <div className="num" style={{ fontSize: 18, fontWeight: 600, color: tone === "red" ? "var(--red)" : "var(--text-1)" }}>{value}</div>
    </div>
  );
}

interface AgentSpendRow {
  agent: AgentRecord;
  requestCount: number;
  inputChars: number;
  outputChars: number;
}

function buildAgentSpend(agents: AgentRecord[], providers: ProviderRecord[], requests: ProviderRequestRecord[]): AgentSpendRow[] {
  return agents.map((agent) => {
    const agentRequests = requests.filter((r) => {
      if (!agent.modelProviderId) return false;
      return r.providerId === agent.modelProviderId;
    });
    return {
      agent,
      requestCount: agentRequests.length,
      inputChars: agentRequests.reduce((s, r) => s + r.inputCharCount, 0),
      outputChars: agentRequests.reduce((s, r) => s + r.outputCharCount, 0),
    };
  }).sort((a, b) => b.requestCount - a.requestCount);
}

function withinDays(iso: string, days: number): boolean {
  return Date.now() - new Date(iso).getTime() < days * 24 * 60 * 60 * 1000;
}
