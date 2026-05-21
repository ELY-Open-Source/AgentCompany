import { useState, type FormEvent } from "react";
import { Avatar, Button, Field, Icon, Pill } from "../shared/ui";
import { Dialog } from "../shared/Dialog";
import type { PageProps } from "./types";
import { activeOrgId, money } from "./types";

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export function TeamPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const [open, setOpen] = useState(false);
  const employees = snapshot.employees.filter((item) => item.orgId === orgId);
  const agents = snapshot.agents.filter((item) => item.orgId === orgId);
  const providers = snapshot.providers.filter((item) => item.orgId === orgId && item.enabled);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createAgent({
      orgId,
      name: text(form, "name"),
      role: text(form, "role"),
      department: text(form, "department"),
      modelProviderId: text(form, "providerId") || null,
      modelId: text(form, "modelId") || null,
      budgetCents: Math.max(0, Math.round(Number(text(form, "budget")) * 100)),
      managerAgentId: text(form, "managerAgentId") || null,
    })).then(() => setOpen(false));
  };

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-h1">Team</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>{employees.length} human · {agents.length} agents</p>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <Button tone="primary" onClick={() => setOpen(true)}><Icon name="plus" /> Hire</Button>
        </div>
      </div>
      <div className="card" style={{ padding: 32, marginBottom: 28 }}>
        <div className="section-label">Org</div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 18, marginBottom: 12 }}>
          {employees[0] && <OrgCard name={employees[0].displayName} role={employees[0].role} human />}
        </div>
        {agents.length > 0 && <OrgConnector count={agents.length} />}
        <div className="grid-4" style={{ marginTop: 18 }}>
          {agents.map((agent) => (
            <OrgCard key={agent.id} name={agent.name} role={agent.role} />
          ))}
        </div>
      </div>
      <div className="section-label">Roster</div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-row" style={{ gridTemplateColumns: "2fr 1.2fr 1.4fr 1fr", background: "var(--panel-2)", fontSize: 11, color: "var(--text-3)" }}>
          <div>Member</div><div>Department</div><div>Model</div><div>Budget</div>
        </div>
        {employees.map((employee) => (
          <RosterRow key={employee.id} name={employee.displayName} role={employee.role} dept="Board" model="" budget={null} human />
        ))}
        {agents.map((agent) => (
          <RosterRow
            key={agent.id}
            name={agent.name}
            role={agent.role}
            dept={agent.department}
            model={agent.modelId ?? ""}
            budget={agent.budgetCents}
          />
        ))}
      </div>
      <Dialog title="Hire agent" open={open} submitLabel="Hire" onClose={() => setOpen(false)} onSubmit={submit}>
        <Field label="Name"><input className="input" name="name" required /></Field>
        <Field label="Role"><input className="input" name="role" required /></Field>
        <Field label="Department"><input className="input" name="department" required /></Field>
        <Field label="Provider">
          <select className="input" name="providerId">
            <option value="">Unassigned</option>
            {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select>
        </Field>
        <Field label="Model"><input className="input" name="modelId" /></Field>
        <Field label="Monthly budget"><input className="input" name="budget" type="number" min="0" step="1" defaultValue="0" /></Field>
      </Dialog>
    </div>
  );
}

function OrgConnector({ count }: { count: number }) {
  const positions = Array.from({ length: count }, (_, i) => {
    const left = count === 1 ? 50 : ((i / (count - 1)) * 100);
    return left;
  });
  return (
    <svg width="100%" height="36" style={{ display: "block" }}>
      <line x1="50%" x2="50%" y1="0" y2="14" stroke="var(--border-strong)" strokeWidth="1" />
      {count > 1 && (
        <line x1={`${positions[0]}%`} x2={`${positions[positions.length - 1]}%`} y1="14" y2="14" stroke="var(--border-strong)" strokeWidth="1" />
      )}
      {positions.map((pos, i) => (
        <line key={i} x1={`${pos}%`} x2={`${pos}%`} y1="14" y2="36" stroke="var(--border-strong)" strokeWidth="1" />
      ))}
    </svg>
  );
}

function OrgCard({ name, role, human = false }: { name: string; role: string; human?: boolean }) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="row">
        <Avatar name={name} bot={!human} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 540 }}>{name}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>{role}</div>
        </div>
      </div>
      <Pill tone={human ? undefined : "violet"} dot={!human}>{human ? "Human" : "Agent"}</Pill>
    </div>
  );
}

function RosterRow({
  name,
  role,
  dept,
  model,
  budget,
  human = false,
}: {
  name: string;
  role: string;
  dept: string;
  model: string;
  budget: number | null;
  human?: boolean;
}) {
  return (
    <div className="table-row" style={{ gridTemplateColumns: "2fr 1.2fr 1.4fr 1fr" }}>
      <div className="row">
        <Avatar name={name} size="sm" bot={!human} />
        <div>
          <div style={{ fontWeight: 500 }}>{name}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>{role}</div>
        </div>
      </div>
      <div style={{ color: "var(--text-2)" }}>{dept}</div>
      <div style={{ color: "var(--text-2)", fontFamily: model ? "var(--font-mono)" : "inherit", fontSize: model ? 12 : 13 }}>
        {model || "—"}
      </div>
      <div>{budget === null ? <span style={{ color: "var(--text-4)" }}>—</span> : <span className="num">{money(budget)}</span>}</div>
    </div>
  );
}
