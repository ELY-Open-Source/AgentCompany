import { XpBar } from "../shared/XpBar";
import { useRevealObject } from "../shared/reveal";
import { oneOf, usePersistentState } from "../shared/view-state";
import { agentModel } from "../../../shared/agent-model";
import { useMemo, useState, type FormEvent } from "react";
import { Avatar, Button, Field, Icon, IconButton } from "../shared/ui";
import { AvatarField } from "../shared/AvatarField";
import { TopbarActions } from "../shared/TopbarActions";
import { Dialog } from "../shared/Dialog";
import { OrgChartTree } from "./team/OrgChartTree";
import { AgentModelField } from "./team/AgentModelField";
import type { AgentRecord, EmployeeRecord, ProviderCatalogEntry, ProviderRecord } from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId, money } from "./types";
import { t } from "../i18n/i18n";

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function optional(form: FormData, key: string): string | null {
  return text(form, key) || null;
}

export function TeamPage({ snapshot, actions, focus }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const [hireOpen, setHireOpen] = useState(false);
  const [hireProviderId, setHireProviderId] = useState("");
  const [hireModelId, setHireModelId] = useState("");
  const [editAgentId, setEditAgentId] = useState<string | null>(null);
  const [filter, setFilter] = usePersistentState<"all" | "human" | "agent">(`${orgId}:team.filter`, "all", oneOf(["all", "human", "agent"] as const), focus?.kind === "agent" || focus?.kind === "employee" ? "all" : undefined);
  useRevealObject(focus?.kind === "agent" || focus?.kind === "employee" ? focus.id : null);

  const employees = useMemo(() => snapshot.employees.filter((item) => item.orgId === orgId), [snapshot.employees, orgId]);
  const agents = useMemo(() => snapshot.agents.filter((item) => item.orgId === orgId), [snapshot.agents, orgId]);
  const providers = useMemo(
    () => snapshot.providers.filter((provider) => provider.orgId === orgId && provider.enabled),
    [snapshot.providers, orgId],
  );
  const workspaces = useMemo(() => snapshot.workspaces.filter((workspace) => workspace.orgId === orgId), [snapshot.workspaces, orgId]);
  const primaryWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.isPrimary) ?? workspaces[0] ?? null,
    [workspaces],
  );

  const openHireDialog = () => {
    const provider = providers[0] ?? null;
    setHireProviderId(provider?.id ?? "");
    setHireModelId("");
    setHireOpen(true);
  };

  const updateHireProvider = (providerId: string) => {
    setHireProviderId(providerId);
    setHireModelId("");
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedProvider = providers.find((provider) => provider.id === hireProviderId) ?? null;
    const modelId = selectedProvider ? hireModelId.trim() || null : null;
    return actions.run(() => window.agentCompany.createAgent({
      orgId,
      name: text(form, "name"),
      role: text(form, "role"),
      department: text(form, "department"),
      modelProviderId: selectedProvider?.id ?? null,
      modelId,
      budgetCents: Math.max(0, Math.round(Number(text(form, "budget")) * 100)),
      managerAgentId: optional(form, "managerAgentId"),
      title: text(form, "title") || text(form, "role"),
      roleLevel: text(form, "roleLevel") || "staff",
      modelStrategy: selectedProvider ? "explicit" : "pooled",
      workspaceId: primaryWorkspace?.id ?? null,
      heartbeatEnabled: Boolean(selectedProvider),
      heartbeatIntervalSec: selectedProvider ? 120 : 0,
    })).then((result) => { if (result) setHireOpen(false); });
  };

  const editingAgent = editAgentId ? agents.find((agent) => agent.id === editAgentId) ?? null : null;

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingAgent) return;
    const form = new FormData(event.currentTarget);
    return actions.run(() => window.agentCompany.updateAgent({
      orgId,
      agentId: editingAgent.id,
      name: text(form, "name"),
      role: text(form, "role"),
      title: text(form, "title") || text(form, "role"),
      roleLevel: text(form, "roleLevel") || "staff",
      department: text(form, "department") || editingAgent.department,
      budgetCents: Math.max(0, Math.round(Number(text(form, "budget")) * 100)),
      modelProviderId: optional(form, "modelProviderId"),
      modelId: optional(form, "modelId"),
      avatarEmoji: String(form.get("avatarEmoji") ?? ""),
      avatarColor: String(form.get("avatarColor") ?? ""),
      avatarImage: String(form.get("avatarImage") ?? ""),
    })).then((result) => { if (result) setEditAgentId(null); });
  };

  const rosterRows = buildRoster(employees, agents, providers, filter);

  return (
    <div className="page">
      <TopbarActions>
        <Button tone="ghost" onClick={() => cycleFilter(filter, setFilter)} title={t("Filter")}>
          <Icon name="filter" /> {filterLabel(filter)}
        </Button>
        <Button tone="primary" onClick={openHireDialog}><Icon name="plus" /> {t("Hire")}</Button>
      </TopbarActions>
      <h1 className="page-h1">{t("Team")}</h1>
      <p className="page-sub">
        {employees.length + agents.length === 1 ? t("{n} member", { n: employees.length + agents.length }) : t("{n} members", { n: employees.length + agents.length })} ·{" "}
        {employees.length === 1 ? t("{n} human", { n: employees.length }) : t("{n} humans", { n: employees.length })} ·{" "}
        {agents.length === 1 ? t("{n} agent", { n: agents.length }) : t("{n} agents", { n: agents.length })}
      </p>

      <section className="card" style={{ padding: 32, marginBottom: 28 }}>
        <div className="section-label">{t("Org")}</div>
        <OrgChartTree boardChair={employees[0] ?? null} agents={agents} onSelectAgent={setEditAgentId} />
      </section>

      <div className="section-label" style={{ marginBottom: 10 }}>{t("Roster")}</div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          className="table-row head"
          style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.2fr) minmax(0, 1.4fr) minmax(0, 1.4fr) 60px" }}
        >
          <div>{t("Member")}</div><div>{t("Department")}</div><div>{t("Model")}</div><div>{t("Budget")}</div><div />
        </div>
        {rosterRows.map((row, index) => (
          <RosterRow
            key={row.id}
            row={row}
            last={index === rosterRows.length - 1}
            onEdit={row.human ? null : () => setEditAgentId(row.id)}
          />
        ))}
      </div>

      <Dialog title={t("Hire agent")} open={hireOpen} submitLabel={t("Hire")} onClose={() => setHireOpen(false)} onSubmit={submit}>
        <Field label={t("Name")}><input className="input" name="name" required /></Field>
        <Field label={t("Role")}><input className="input" name="role" required /></Field>
        <Field label={t("Title")}><input className="input" name="title" /></Field>
        <Field label={t("Department")}><input className="input" name="department" required /></Field>
        <Field label={t("Provider")}>
          <select className="input" name="modelProviderId" value={hireProviderId} onChange={(event) => updateHireProvider(event.currentTarget.value)}>
            <option value="">{t("Unassigned")}</option>
            {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select>
        </Field>
        <AgentModelField
          provider={providers.find((provider) => provider.id === hireProviderId) ?? null}
          entry={catalogEntry(snapshot.providerCatalog, providers, hireProviderId)}
          value={hireModelId}
          onChange={setHireModelId}
        />
        <p style={{ fontSize: "var(--fs-body)", color: "var(--text-3)", margin: 0 }}>{t("Leave the model blank to use the provider's default. A changed model applies from the agent's next session.")}</p>
        <Field label={t("Manager")}>
          <select className="input" name="managerAgentId" defaultValue="">
            <option value="">{t("None")}</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role}</option>)}
          </select>
        </Field>
        <Field label={t("Monthly budget")}><input className="input" name="budget" type="number" min="0" step="1" defaultValue="250" /></Field>
        <Field label={t("Seniority")}>
          <select className="input" name="roleLevel" defaultValue="staff">
            <option value="staff">{t("Staff")}</option>
            <option value="lead">{t("Lead")}</option>
            <option value="director">{t("Director")}</option>
          </select>
        </Field>
      </Dialog>

      {editingAgent && (
        <Dialog key={editingAgent.id} title={t("Edit {name}", { name: editingAgent.name })} open submitLabel={t("Save")} onClose={() => setEditAgentId(null)} onSubmit={submitEdit}>
          <Field label={t("Name")}><input className="input" name="name" defaultValue={editingAgent.name} required /></Field>
          <AvatarField previewName={editingAgent.name} defaultEmoji={editingAgent.avatarEmoji} defaultColor={editingAgent.avatarColor} defaultImage={editingAgent.avatarImage} />
          <Field label={t("Role")}><input className="input" name="role" defaultValue={editingAgent.role} required /></Field>
          <Field label={t("Title")}><input className="input" name="title" defaultValue={editingAgent.title} /></Field>
          <Field label={t("Department")}><input className="input" name="department" defaultValue={editingAgent.department} required /></Field>
          <Field label={t("Monthly budget")}><input className="input" name="budget" type="number" min="0" step="1" defaultValue={editingAgent.budgetCents / 100} /></Field>
          <EditModelFields agent={editingAgent} providers={providers} catalog={snapshot.providerCatalog} />
          <p style={{ fontSize: "var(--fs-body)", color: "var(--text-3)", margin: 0 }}>{t("Leave the model blank to use the provider's default. A changed model applies from the agent's next session.")}</p>
          <Field label={t("Seniority")}>
            {/* The CEO's rank carries company-wide powers, so it is shown, never picked. */}
            {editingAgent.roleLevel === "c_suite" ? (
              <>
                <input type="hidden" name="roleLevel" value="c_suite" />
                <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{t("CEO: hires officers, grants connectors and skills, and closes goals. This rank cannot be changed.")}</div>
              </>
            ) : (
              <select className="input" name="roleLevel" defaultValue={editingAgent.roleLevel}>
                <option value="staff">{t("Staff")}</option>
                <option value="lead">{t("Lead")}</option>
                <option value="director">{t("Director")}</option>
              </select>
            )}
          </Field>
        </Dialog>
      )}

    </div>
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
        dept: t("Executive"),
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
      const inEffect = agentModel(agent.modelId, provider?.model ?? null);
      rows.push({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        dept: agent.department || "—",
        model: inEffect.source === "provider_default" ? t("{model} (provider default)", { model: inEffect.model ?? "" }) : inEffect.model ?? "—",
        providerLabel: provider?.label ?? "—",
        budgetCents: agent.budgetCents,
        budgetCapCents: cap > 0 ? cap : null,
        human: false,
      });
    }
  }
  return rows;
}

function EditModelFields({ agent, providers, catalog }: { agent: AgentRecord; providers: ProviderRecord[]; catalog: ProviderCatalogEntry[] }) {
  const [providerId, setProviderId] = useState(agent.modelProviderId ?? "");
  const [modelId, setModelId] = useState(agent.modelId ?? "");
  return (
    <>
      <Field label={t("Provider")}>
        <select className="input" name="modelProviderId" value={providerId} onChange={(event) => { setProviderId(event.currentTarget.value); setModelId(""); }}>
          <option value="">{t("Unassigned")}</option>
          {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
        </select>
      </Field>
      <AgentModelField
        provider={providers.find((provider) => provider.id === providerId) ?? null}
        entry={catalogEntry(catalog, providers, providerId)}
        value={modelId}
        onChange={setModelId}
      />
    </>
  );
}

/** The catalog entry of the provider picked now. */
function catalogEntry(catalog: ProviderCatalogEntry[], providers: ProviderRecord[], providerId: string): ProviderCatalogEntry | null {
  const providerKey = providers.find((provider) => provider.id === providerId)?.providerKey;
  return catalog.find((entry) => entry.key === providerKey) ?? null;
}

function RosterRow({ row, last, onEdit }: { row: RosterEntry; last: boolean; onEdit: (() => void) | null }) {
  return (
    <div
      data-object-id={row.id}
      className="table-row"
      style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.2fr) minmax(0, 1.4fr) minmax(0, 1.4fr) 60px", borderBottom: last ? "none" : "1px solid var(--border-soft)" }}
    >
      <div className="row" style={{ gap: 10, minWidth: 0 }}>
        <Avatar name={row.name} size="sm" bot={!row.human} />
        <div style={{ minWidth: 0 }}>
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</div>
          <div style={{ fontSize: "var(--fs-body)", color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.role}</div>
        </div>
      </div>
      <div style={{ color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.dept}</div>
      <div
        style={{
          color: "var(--text-2)",
          fontFamily: row.human ? "inherit" : "var(--font-mono)",
          fontSize: "var(--fs-body)",
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
            <div style={{ flex: 1, maxWidth: 100 }}>
              <XpBar percent={row.budgetCapCents && row.budgetCapCents > 0 ? (row.budgetCents / row.budgetCapCents) * 100 : 0} label={t("Budget compared with the largest agent budget")} />
            </div>
            <span className="num mono" style={{ fontSize: "var(--fs-body)", color: "var(--text-3)" }}>{money(row.budgetCents)}</span>
          </div>
        )}
      </div>
      <div style={{ textAlign: "right" }}>
        {onEdit && <IconButton icon="edit" label={t("Edit {name}", { name: row.name })} onClick={onEdit} />}
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
  if (filter === "human") return t("Humans only");
  if (filter === "agent") return t("Agents only");
  return t("All");
}
