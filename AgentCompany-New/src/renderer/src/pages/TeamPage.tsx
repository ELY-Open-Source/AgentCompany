import { useMemo, useState, type FormEvent } from "react";
import { Avatar, Button, Field, Icon, IconButton, Pill } from "../shared/ui";
import { Dialog } from "../shared/Dialog";
import type { AgentRecord, EmployeeRecord, ProviderRecord } from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId, money } from "./types";

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function optional(form: FormData, key: string): string | null {
  return text(form, key) || null;
}

export function TeamPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const [hireOpen, setHireOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "human" | "agent">("all");

  const employees = useMemo(() => snapshot.employees.filter((item) => item.orgId === orgId), [snapshot.employees, orgId]);
  const agents = useMemo(() => snapshot.agents.filter((item) => item.orgId === orgId), [snapshot.agents, orgId]);
  const providers = useMemo(
    () => snapshot.providers.filter((provider) => provider.orgId === orgId && provider.enabled),
    [snapshot.providers, orgId],
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createAgent({
      orgId,
      name: text(form, "name"),
      role: text(form, "role"),
      department: text(form, "department"),
      modelProviderId: optional(form, "modelProviderId"),
      modelId: optional(form, "modelId"),
      budgetCents: Math.max(0, Math.round(Number(text(form, "budget")) * 100)),
      managerAgentId: optional(form, "managerAgentId"),
      title: text(form, "title") || text(form, "role"),
      roleLevel: text(form, "roleLevel") || "staff",
      modelStrategy: text(form, "modelId") ? "explicit" : "pooled",
      heartbeatEnabled: false,
      heartbeatIntervalSec: 0,
    })).then((result) => { if (result) setHireOpen(false); });
  };

  const rosterRows = buildRoster(employees, agents, providers, filter);

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-h1">Team</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            {employees.length + agents.length} {employees.length + agents.length === 1 ? "member" : "members"} ·
            {" "}{employees.length} {employees.length === 1 ? "human" : "humans"} ·
            {" "}{agents.length} {agents.length === 1 ? "agent" : "agents"}
          </p>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <Button tone="ghost" onClick={() => cycleFilter(filter, setFilter)} title="Filter">
            <Icon name="filter" size={13} /> {filterLabel(filter)}
          </Button>
          <Button tone="primary" onClick={() => setHireOpen(true)}><Icon name="plus" size={13} /> Hire</Button>
        </div>
      </div>

      <section className="card" style={{ padding: 32, marginBottom: 28 }}>
        <div className="section-label">Org</div>
        {employees[0] ? (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 18, marginBottom: 12 }}>
            <OrgCard name={employees[0].displayName} role={employees[0].role} human />
          </div>
        ) : null}
        {agents.length > 0 && <OrgConnector slots={agents.length} />}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 14,
            marginTop: 18,
            justifyContent: "center",
          }}
        >
          {agents.slice(0, 4).map((agent) => (
            <OrgCard key={agent.id} name={agent.name} role={agent.role} />
          ))}
        </div>
      </section>

      <div className="section-label" style={{ marginBottom: 10 }}>Roster</div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          className="table-row head"
          style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.2fr) minmax(0, 1.4fr) minmax(0, 1.4fr) 60px" }}
        >
          <div>Member</div><div>Department</div><div>Model</div><div>Budget</div><div />
        </div>
        {rosterRows.map((row, index) => (
          <RosterRow key={row.id} row={row} last={index === rosterRows.length - 1} />
        ))}
      </div>

      <Dialog title="Hire agent" open={hireOpen} submitLabel="Hire" onClose={() => setHireOpen(false)} onSubmit={submit}>
        <Field label="Name"><input className="input" name="name" required /></Field>
        <Field label="Role"><input className="input" name="role" required /></Field>
        <Field label="Title"><input className="input" name="title" /></Field>
        <Field label="Department"><input className="input" name="department" required /></Field>
        <Field label="Provider">
          <select className="input" name="modelProviderId">
            <option value="">Unassigned</option>
            {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select>
        </Field>
        <Field label="Model">
          <input
            className="input"
            name="modelId"
            list="agent-model-suggestions"
          />
        </Field>
        <datalist id="agent-model-suggestions">
          {snapshot.providerCatalog.flatMap((entry) =>
            entry.models.map((model) => (
              <option key={`${entry.key}-${model.id}`} value={model.id}>{entry.label} · {model.name}</option>
            )),
          )}
        </datalist>
        <Field label="Monthly budget"><input className="input" name="budget" type="number" min="0" step="1" defaultValue="250" /></Field>
        <Field label="Seniority">
          <select className="input" name="roleLevel" defaultValue="staff">
            <option value="staff">Staff</option>
            <option value="lead">Lead</option>
            <option value="director">Director</option>
            <option value="c_suite">Executive</option>
          </select>
        </Field>
      </Dialog>
    </div>
  );
}

function OrgCard({ name, role, human = false }: { name: string; role: string; human?: boolean }) {
  return (
    <div
      style={{
        width: 220,
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "14px 14px 12px",
        background: "var(--panel)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div className="row">
        <Avatar name={name} bot={!human} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 540, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{role}</div>
        </div>
      </div>
      <div>
        {human ? <Pill>Human</Pill> : <Pill tone="violet" dot>Agent</Pill>}
      </div>
    </div>
  );
}

function OrgConnector({ slots }: { slots: number }) {
  if (slots <= 1) {
    return (
      <svg width="100%" height="36" style={{ display: "block", marginTop: 18 }} aria-hidden="true">
        <line x1="50%" x2="50%" y1="0" y2="36" stroke="var(--border-strong)" strokeWidth="1" />
      </svg>
    );
  }
  const count = Math.min(4, slots);
  const step = 100 / (count * 2);
  const positions = Array.from({ length: count }, (_, i) => step * (2 * i + 1));
  const left = positions[0];
  const right = positions[positions.length - 1];
  return (
    <svg width="100%" height="36" style={{ display: "block", marginTop: 18 }} aria-hidden="true">
      <line x1="50%" x2="50%" y1="0" y2="14" stroke="var(--border-strong)" strokeWidth="1" />
      <line x1={`${left}%`} x2={`${right}%`} y1="14" y2="14" stroke="var(--border-strong)" strokeWidth="1" />
      {positions.map((pos) => (
        <line key={pos} x1={`${pos}%`} x2={`${pos}%`} y1="14" y2="36" stroke="var(--border-strong)" strokeWidth="1" />
      ))}
    </svg>
  );
}

interface RosterEntry {
  id: string;
  name: string;
  role: string;
  dept: string;
  model: string;
  providerLabel: string;
  budgetCents: number | null;
  budgetCapCents: number | null;
  human: boolean;
}

function buildRoster(
  employees: EmployeeRecord[],
  agents: AgentRecord[],
  providers: ProviderRecord[],
  filter: "all" | "human" | "agent",
): RosterEntry[] {
  const rows: RosterEntry[] = [];
  if (filter !== "agent") {
    for (const employee of employees) {
      rows.push({
        id: employee.id,
        name: employee.displayName,
        role: employee.role,
        dept: "Executive",
        model: "—",
        providerLabel: "—",
        budgetCents: null,
        budgetCapCents: null,
        human: true,
      });
    }
  }
  if (filter !== "human") {
    const cap = agents.reduce((max, agent) => (agent.budgetCents > max ? agent.budgetCents : max), 0);
    for (const agent of agents) {
      const provider = agent.modelProviderId ? providers.find((entry) => entry.id === agent.modelProviderId) : null;
      rows.push({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        dept: agent.department || "—",
        model: agent.modelId ?? (provider?.model ?? "—"),
        providerLabel: provider?.label ?? "—",
        budgetCents: agent.budgetCents,
        budgetCapCents: cap > 0 ? cap : null,
        human: false,
      });
    }
  }
  return rows;
}

function RosterRow({ row, last }: { row: RosterEntry; last: boolean }) {
  return (
    <div
      className="table-row"
      style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.2fr) minmax(0, 1.4fr) minmax(0, 1.4fr) 60px", borderBottom: last ? "none" : "1px solid var(--border-soft)" }}
    >
      <div className="row" style={{ gap: 10, minWidth: 0 }}>
        <Avatar name={row.name} size="sm" bot={!row.human} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.role}</div>
        </div>
      </div>
      <div style={{ color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.dept}</div>
      <div
        style={{
          color: "var(--text-2)",
          fontFamily: row.human ? "inherit" : "var(--font-mono)",
          fontSize: row.human ? 13 : 12,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {row.model}
      </div>
      <div>
        {row.budgetCents === null ? (
          <span style={{ color: "var(--text-4)" }}>—</span>
        ) : (
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: 1, height: 3, background: "var(--panel-3)", borderRadius: 2, overflow: "hidden", maxWidth: 100 }}>
              <div
                style={{
                  width: `${row.budgetCapCents && row.budgetCapCents > 0 ? Math.min(100, Math.round((row.budgetCents / row.budgetCapCents) * 100)) : 0}%`,
                  height: "100%",
                  background: "var(--text-2)",
                }}
              />
            </div>
            <span className="num mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{money(row.budgetCents)}</span>
          </div>
        )}
      </div>
      <div style={{ textAlign: "right" }}>
        <IconButton icon="more" label="More" />
      </div>
    </div>
  );
}

function cycleFilter(current: "all" | "human" | "agent", set: (value: "all" | "human" | "agent") => void) {
  if (current === "all") set("human");
  else if (current === "human") set("agent");
  else set("all");
}

function filterLabel(filter: "all" | "human" | "agent"): string {
  if (filter === "human") return "Humans only";
  if (filter === "agent") return "Agents only";
  return "All";
}
