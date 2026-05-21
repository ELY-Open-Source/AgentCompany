import { Icon, Pill } from "../shared/ui";
import type { PageProps } from "./types";
import { activeOrgId, money } from "./types";

export function HomePage({ snapshot }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const organization = snapshot.organizations.find((item) => item.id === orgId);
  if (!organization) throw new Error("Active organization is missing.");
  const tasks = snapshot.tasks.filter((item) => item.orgId === orgId);
  const approvals = snapshot.approvals.filter((item) => item.orgId === orgId);
  const agents = snapshot.agents.filter((item) => item.orgId === orgId);
  const providers = snapshot.providers.filter((item) => item.orgId === orgId && item.enabled);
  const budget = agents.reduce((sum, agent) => sum + agent.budgetCents, 0);
  const pending = approvals.filter((item) => item.state === "pending");

  return (
    <div className="page">
      <h1 className="page-h1">{organization.name}</h1>
      <p className="page-sub">{organization.goal}</p>
      <div className="grid-3" style={{ marginBottom: 12 }}>
        <MetricCard label="Agents" value={String(agents.length)} />
        <MetricCard label="Open work" value={String(tasks.filter((item) => item.status !== "done").length)} />
        <MetricCard label="Monthly budget" value={money(budget)} />
      </div>
      <div className="grid-3">
        <div className="card" style={{ gridColumn: "span 2" }}>
          <div className="card-label" style={{ marginBottom: 14 }}>Work</div>
          {tasks.length === 0 ? <EmptyLine label="No tasks" /> : tasks.slice(0, 6).map((task) => (
            <div key={task.id} className="row" style={{ padding: "10px 0", borderBottom: "1px solid var(--border-soft)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-4)" }} />
              <span style={{ flex: 1, fontWeight: 480 }}>{task.title}</span>
              <Pill>{task.status.replaceAll("_", " ")}</Pill>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="card-label" style={{ marginBottom: 14 }}>Decisions</div>
          {pending.length === 0 ? <EmptyLine label="No pending approvals" /> : pending.slice(0, 4).map((approval) => (
            <div key={approval.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border-soft)" }}>
              <div style={{ fontWeight: 540, marginBottom: 4 }}>{approval.title}</div>
              <Pill tone={approval.risk === "high" ? "amber" : undefined}>{approval.risk}</Pill>
            </div>
          ))}
        </div>
      </div>
      <div className="grid-3" style={{ marginTop: 12 }}>
        <div className="card">
          <div className="card-label" style={{ marginBottom: 14 }}>Providers</div>
          {providers.length === 0 ? <EmptyLine label="No connected providers" /> : providers.map((provider) => (
            <div key={provider.id} className="row" style={{ padding: "8px 0" }}>
              <Icon name="check" />
              <span>{provider.label}</span>
            </div>
          ))}
        </div>
        <div className="card" style={{ gridColumn: "span 2" }}>
          <div className="card-label" style={{ marginBottom: 14 }}>Mission</div>
          <div style={{ fontSize: 15, lineHeight: 1.5 }}>{organization.mission}</div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="card-label" style={{ marginBottom: 8 }}>{label}</div>
      <div className="num" style={{ fontSize: 28, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function EmptyLine({ label }: { label: string }) {
  return <div style={{ color: "var(--text-3)", padding: "10px 0" }}>{label}</div>;
}
