import { useState, type FormEvent } from "react";
import { Button, Field, Icon, Pill } from "../shared/ui";
import { Dialog } from "../shared/Dialog";
import type { MigrationReportRecord, PolicyRuleRecord, ProviderRecord, SkillDefinitionRecord } from "../../../shared/domain";
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
  const [migrationOpen, setMigrationOpen] = useState(false);
  const providers = snapshot.providers.filter((item) => item.orgId === orgId);
  const skills = snapshot.skillDefinitions.filter((item) => item.orgId === orgId);
  const agents = snapshot.agents.filter((item) => item.orgId === orgId);
  const revisions = snapshot.skillRevisions;
  const policies = snapshot.policyRules.filter((item) => item.orgId === orgId);
  const reports = snapshot.migrationReports.filter((item) => item.orgId === orgId);

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
      versionSemver: value(form, "versionSemver"),
    })).then(() => setSkillOpen(false));
  };

  const createMigrationReport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createMigrationReport({
      orgId,
      sourceDatabasePath: value(form, "sourceDatabasePath"),
    })).then(() => setMigrationOpen(false));
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
        {tab === "policies" && <PolicyPanel policies={policies} />}
        {tab === "migration" && <MigrationPanel reports={reports} onCreate={() => setMigrationOpen(true)} />}
      </div>
      <Dialog title="Provider credential" open={Boolean(providerDialog)} submitLabel="Save" onClose={() => setProviderDialog(null)} onSubmit={saveProvider}>
        <Field label="Provider"><input className="input" value={providerDialog?.label ?? ""} readOnly /></Field>
        <Field label="Secret"><input className="input" name="secret" type="password" required /></Field>
        <Field label="Model"><input className="input" name="model" defaultValue={providerDialog?.model ?? ""} /></Field>
      </Dialog>
      <Dialog title="Import skill" open={skillOpen} submitLabel="Import" onClose={() => setSkillOpen(false)} onSubmit={importSkill}>
        <Field label="Directory path"><input className="input" name="directoryPath" required /></Field>
        <Field label="Version"><input className="input" name="versionSemver" required /></Field>
      </Dialog>
      <Dialog title="Migration report" open={migrationOpen} submitLabel="Create" onClose={() => setMigrationOpen(false)} onSubmit={createMigrationReport}>
        <Field label="Source database path"><input className="input" name="sourceDatabasePath" required /></Field>
      </Dialog>
    </div>
  );
}

function SettingsNav({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" aria-label={label} className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>{label}</button>;
}

function ProvidersPanel({ providers, onManage }: { providers: ProviderRecord[]; onManage: (provider: ProviderRecord) => void }) {
  return (
    <div className="page">
      <h1 className="page-h1">Providers</h1>
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
          const revision = requireRevision(skill, revisions);
          return (
            <div key={skill.id} className="table-row" style={{ gridTemplateColumns: "1.6fr 1fr 1.6fr" }}>
              <div>
                <div style={{ fontWeight: 540 }}>{skill.name}</div>
                <div style={{ color: "var(--text-3)", fontSize: 11 }}>{skill.slug}</div>
              </div>
              <Pill>{revision.versionSemver}</Pill>
              {agents.length === 0 ? (
                <Pill>No agents</Pill>
              ) : (
                <select
                  className="input"
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value) onBind(event.target.value, skill, revision.id);
                    event.target.value = "";
                  }}
                >
                  <option value="">Agent</option>
                  {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PolicyPanel({ policies }: { policies: PolicyRuleRecord[] }) {
  return (
    <div className="page">
      <h1 className="page-h1">Policies</h1>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-row" style={{ gridTemplateColumns: "1.2fr 1.2fr 1fr", background: "var(--panel-2)", color: "var(--text-3)", fontSize: 11 }}>
          <div>Action</div><div>Effect</div><div>Risk ceiling</div>
        </div>
        {policies.length === 0 ? (
          <div style={{ padding: 18, color: "var(--text-3)" }}>No policies</div>
        ) : policies.map((policy) => (
          <div key={policy.id} className="table-row" style={{ gridTemplateColumns: "1.2fr 1.2fr 1fr" }}>
            <span>{policy.action}</span>
            <Pill>{policy.effect}</Pill>
            <Pill tone={policy.riskCeiling === "high" ? "amber" : undefined}>{policy.riskCeiling}</Pill>
          </div>
        ))}
      </div>
    </div>
  );
}

function MigrationPanel({ reports, onCreate }: { reports: MigrationReportRecord[]; onCreate: () => void }) {
  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-h1">Migration</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>{reports.length} reports</p>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <Button tone="primary" onClick={onCreate}><Icon name="plus" /> Report</Button>
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {reports.length === 0 ? (
          <div style={{ padding: 18, color: "var(--text-3)" }}>No reports</div>
        ) : reports.map((report) => <MigrationReportRow key={report.id} report={report} />)}
      </div>
    </div>
  );
}

function MigrationReportRow({ report }: { report: MigrationReportRecord }) {
  const body = parseMigrationReport(report.reportJson);
  const idCount = Object.values(body.idMaps).reduce((sum, ids) => sum + ids.length, 0);
  return (
    <div className="table-row" style={{ gridTemplateColumns: "1.4fr 1fr 1fr 1fr" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={report.sourceRef}>{report.sourceRef}</div>
        <div style={{ color: "var(--text-3)", fontSize: 11 }}>{new Date(report.createdAt).toLocaleString()}</div>
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {Object.entries(body.tableCounts).map(([table, count]) => <Pill key={table}>{table}: {count}</Pill>)}
      </div>
      <Pill>{Object.keys(body.tableChecksums).length} checksums</Pill>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Pill>{idCount} ids</Pill>
        <Pill>{body.failures.length} failures</Pill>
      </div>
    </div>
  );
}

function parseMigrationReport(reportJson: string): {
  tableCounts: Record<string, number>;
  tableChecksums: Record<string, string>;
  idMaps: Record<string, string[]>;
  failures: Array<{ table: string; reason: string }>;
} {
  const parsed = JSON.parse(reportJson) as {
    tableCounts?: Record<string, number>;
    tableChecksums?: Record<string, string>;
    idMaps?: Record<string, string[]>;
    failures?: Array<{ table: string; reason: string }>;
  };
  if (!parsed.tableCounts || !parsed.tableChecksums || !parsed.idMaps || !Array.isArray(parsed.failures)) {
    throw new Error("Migration report is invalid.");
  }
  return {
    tableCounts: parsed.tableCounts,
    tableChecksums: parsed.tableChecksums,
    idMaps: parsed.idMaps,
    failures: parsed.failures,
  };
}

function requireRevision(
  skill: SkillDefinitionRecord,
  revisions: Array<{ id: string; skillId: string; versionSemver: string }>,
): { id: string; versionSemver: string } {
  const revision = revisions.find((item) => item.skillId === skill.id);
  if (!revision) throw new Error(`Skill revision is missing for ${skill.slug}.`);
  return revision;
}

function ProviderLogo({ label }: { label: string }) {
  return (
    <div style={{ width: 30, height: 30, borderRadius: 7, display: "grid", placeItems: "center", background: "var(--text-1)", color: "#fff", fontWeight: 700 }}>
      {label.slice(0, 2)}
    </div>
  );
}
