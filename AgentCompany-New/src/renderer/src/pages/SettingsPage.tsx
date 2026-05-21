import { useState, type FormEvent } from "react";
import { Button, Field, Icon, Pill } from "../shared/ui";
import { Dialog } from "../shared/Dialog";
import type { ProviderRecord, SkillDefinitionRecord } from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId } from "./types";

type SettingsTab = "providers" | "skills" | "policies" | "migration";

function value(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export function SettingsPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const [tab, setTab] = useState<SettingsTab>("providers");
  const [providerDialog, setProviderDialog] = useState<ProviderRecord | null>(null);
  const [skillOpen, setSkillOpen] = useState(false);
  const providers = snapshot.providers.filter((item) => item.orgId === orgId);
  const skills = snapshot.skillDefinitions.filter((item) => item.orgId === orgId);
  const agents = snapshot.agents.filter((item) => item.orgId === orgId);
  const revisions = snapshot.skillRevisions;

  const saveProvider = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!providerDialog) return;
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.saveProviderCredential({
      orgId,
      providerId: providerDialog.id,
      secret: value(form, "secret"),
      model: value(form, "model") || null,
    })).then(() => setProviderDialog(null));
  };

  const importSkill = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.importSkillDirectory({
      orgId,
      directoryPath: value(form, "directoryPath"),
      versionSemver: value(form, "versionSemver") || "1.0.0",
    })).then(() => setSkillOpen(false));
  };

  return (
    <div className="split-main" style={{ height: "calc(100vh - 112px)", margin: "-28px -32px -40px" }}>
      <aside className="secondary-pane">
        <div style={{ fontWeight: 600, padding: "4px 8px 14px" }}>Settings</div>
        <SettingsNav label="Providers" active={tab === "providers"} onClick={() => setTab("providers")} />
        <SettingsNav label="Skills" active={tab === "skills"} onClick={() => setTab("skills")} />
        <SettingsNav label="Policies" active={tab === "policies"} onClick={() => setTab("policies")} />
        <SettingsNav label="Migration" active={tab === "migration"} onClick={() => setTab("migration")} />
      </aside>
      <div className="content" style={{ flex: 1 }}>
        {tab === "providers" && (
          <ProvidersPanel providers={providers} onManage={setProviderDialog} />
        )}
        {tab === "skills" && (
          <SkillsPanel
            skills={skills}
            agents={agents}
            revisions={revisions}
            onImport={() => setSkillOpen(true)}
            onBind={(agentId, skill, revisionId) => void actions.run(() => window.agentCompany.bindSkill({
              orgId,
              agentId,
              skillId: skill.id,
              revisionId,
            }))}
          />
        )}
        {tab === "policies" && <PolicyPanel />}
        {tab === "migration" && <MigrationPanel />}
      </div>
      <Dialog title="Provider credential" open={Boolean(providerDialog)} submitLabel="Save" onClose={() => setProviderDialog(null)} onSubmit={saveProvider}>
        <Field label="Provider"><input className="input" value={providerDialog?.label ?? ""} readOnly /></Field>
        <Field label="Secret"><input className="input" name="secret" type="password" required /></Field>
        <Field label="Model"><input className="input" name="model" defaultValue={providerDialog?.model ?? ""} /></Field>
      </Dialog>
      <Dialog title="Import skill" open={skillOpen} submitLabel="Import" onClose={() => setSkillOpen(false)} onSubmit={importSkill}>
        <Field label="Directory path"><input className="input" name="directoryPath" required /></Field>
        <Field label="Version"><input className="input" name="versionSemver" defaultValue="1.0.0" required /></Field>
      </Dialog>
    </div>
  );
}

function SettingsNav({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>{label}</button>;
}

function ProvidersPanel({ providers, onManage }: { providers: ProviderRecord[]; onManage: (provider: ProviderRecord) => void }) {
  return (
    <div className="page">
      <h1 className="page-h1">Providers</h1>
      <p className="page-sub">Keys, account grants, OAuth profiles.</p>
      <div className="section-label">Configured providers</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {providers.map((provider) => (
          <div key={provider.id} className="card row">
            <ProviderLogo label={provider.label} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 540 }}>{provider.label}</div>
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>{provider.authType.replaceAll("_", " ")}</div>
            </div>
            <Pill tone={provider.enabled ? "green" : undefined}>{provider.enabled ? "Enabled" : "Unconfigured"}</Pill>
            <Button onClick={() => onManage(provider)}>Manage</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SkillsPanel({
  skills,
  agents,
  revisions,
  onImport,
  onBind,
}: {
  skills: SkillDefinitionRecord[];
  agents: Array<{ id: string; name: string }>;
  revisions: Array<{ id: string; skillId: string; versionSemver: string }>;
  onImport: () => void;
  onBind: (agentId: string, skill: SkillDefinitionRecord, revisionId: string) => void;
}) {
  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-h1">Skills</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>{skills.length} skills · {agents.length} agents</p>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <Button tone="primary" onClick={onImport}><Icon name="plus" /> Import</Button>
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {skills.length === 0 ? (
          <div style={{ padding: 18, color: "var(--text-3)" }}>No skills</div>
        ) : skills.map((skill) => {
          const revision = revisions.find((item) => item.skillId === skill.id);
          return (
            <div key={skill.id} className="table-row" style={{ gridTemplateColumns: "1.6fr 1fr 1.6fr" }}>
              <div>
                <div style={{ fontWeight: 540 }}>{skill.name}</div>
                <div style={{ color: "var(--text-3)", fontSize: 11 }}>{skill.slug}</div>
              </div>
              <Pill>{revision?.versionSemver ?? "No revision"}</Pill>
              <select
                className="input"
                defaultValue=""
                onChange={(event) => {
                  if (event.target.value && revision) onBind(event.target.value, skill, revision.id);
                  event.target.value = "";
                }}
              >
                <option value="">Bind to agent</option>
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PolicyPanel() {
  return (
    <div className="page">
      <h1 className="page-h1">Policies</h1>
      <p className="page-sub">Approval, risk, provider, browser boundaries.</p>
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <PolicyRow label="High-risk task" value="Board approval" />
        <PolicyRow label="Social publish" value="Human approval" />
        <PolicyRow label="Browser permissions" value="Deny by default" />
        <PolicyRow label="Provider secrets" value="OS encrypted" />
      </div>
    </div>
  );
}

function MigrationPanel() {
  return (
    <div className="page">
      <h1 className="page-h1">Migration</h1>
      <p className="page-sub">Legacy import, id maps, checksum validation.</p>
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <PolicyRow label="Legacy snapshot" value="Immutable" />
        <PolicyRow label="Entity checksums" value="Required" />
        <PolicyRow label="Delta journal" value="Recorded" />
      </div>
    </div>
  );
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ justifyContent: "space-between" }}>
      <span>{label}</span>
      <Pill>{value}</Pill>
    </div>
  );
}

function ProviderLogo({ label }: { label: string }) {
  return (
    <div style={{ width: 30, height: 30, borderRadius: 7, display: "grid", placeItems: "center", background: "var(--text-1)", color: "#fff", fontWeight: 700 }}>
      {label.slice(0, 2)}
    </div>
  );
}
