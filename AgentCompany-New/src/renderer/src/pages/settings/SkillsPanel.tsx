import { useState, type FormEvent } from "react";
import { Button, Field, Icon, Pill } from "../../shared/ui";
import { Dialog } from "../../shared/Dialog";
import type {
  AgentRecord,
  SkillBindingRecord,
  SkillDefinitionRecord,
  SkillRevisionRecord,
} from "../../../../shared/domain";
import type { SnapshotActions } from "../../app/useSnapshot";

interface SkillsPanelProps {
  orgId: string;
  skills: SkillDefinitionRecord[];
  revisions: SkillRevisionRecord[];
  bindings: SkillBindingRecord[];
  agents: AgentRecord[];
  actions: SnapshotActions;
}

export function SkillsPanel({ orgId, skills, revisions, bindings, agents, actions }: SkillsPanelProps) {
  const [importOpen, setImportOpen] = useState(false);

  const importSkill = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.importSkillDirectory({
      orgId,
      directoryPath: String(form.get("directoryPath") ?? "").trim(),
      versionSemver: String(form.get("versionSemver") ?? "").trim(),
    })).then((result) => { if (result) setImportOpen(false); });
  };

  const bind = (skill: SkillDefinitionRecord, agentId: string) => {
    const latest = revisions.find((revision) => revision.skillId === skill.id);
    if (!latest) return;
    void actions.run(() => window.agentCompany.bindSkill({ orgId, agentId, skillId: skill.id, revisionId: latest.id }));
  };

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-h1">Skills</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            {skills.length} {skills.length === 1 ? "definition" : "definitions"} · {revisions.length} revisions · {bindings.filter((b) => b.enabled).length} bindings
          </p>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <Button tone="primary" onClick={() => setImportOpen(true)}><Icon name="plus" size={13} /> Import</Button>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          className="table-row head"
          style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1.6fr)" }}
        >
          <div>Skill</div><div>Version</div><div>Bindings</div><div>Bind to agent</div>
        </div>
        {skills.map((skill, index) => {
          const last = index === skills.length - 1;
          const latest = revisions.find((revision) => revision.skillId === skill.id);
          const skillBindings = bindings.filter((binding) => binding.skillId === skill.id && binding.enabled);
          return (
            <div
              key={skill.id}
              className="table-row"
              style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1.6fr)", borderBottom: last ? "none" : "1px solid var(--border-soft)" }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{skill.name}</div>
                <div style={{ color: "var(--text-3)", fontSize: 11 }}>{skill.slug}</div>
              </div>
              <Pill>{latest ? latest.versionSemver : "—"}</Pill>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {skillBindings.map((binding) => (
                  <Pill key={binding.id}>{agentName(binding.agentId, agents)}</Pill>
                ))}
              </div>
              <BindAgent skill={skill} agents={agents} onBind={(agentId) => bind(skill, agentId)} disabled={!latest} />
            </div>
          );
        })}
      </div>

      <Dialog title="Import skill" open={importOpen} submitLabel="Import" onClose={() => setImportOpen(false)} onSubmit={importSkill}>
        <Field label="Directory path"><input className="input" name="directoryPath" required /></Field>
        <Field label="Version (semver)"><input className="input" name="versionSemver" required defaultValue="1.0.0" /></Field>
      </Dialog>
    </div>
  );
}

function BindAgent({
  skill: _skill,
  agents,
  onBind,
  disabled,
}: {
  skill: SkillDefinitionRecord;
  agents: AgentRecord[];
  onBind: (agentId: string) => void;
  disabled: boolean;
}) {
  if (agents.length === 0) return null;
  return (
    <select
      className="input"
      style={{ height: 28, padding: "0 8px", fontSize: 12 }}
      defaultValue=""
      disabled={disabled}
      onChange={(event) => {
        if (event.target.value) onBind(event.target.value);
        event.target.value = "";
      }}
    >
      <option value="">Pick an agent…</option>
      {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
    </select>
  );
}

function agentName(agentId: string, agents: AgentRecord[]): string {
  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}
