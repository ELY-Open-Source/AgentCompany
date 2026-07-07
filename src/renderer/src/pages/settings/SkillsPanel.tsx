import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, Icon, Pill } from "../../shared/ui";
import { Dialog } from "../../shared/Dialog";
import { t } from "../../i18n/i18n";
import type {
  AgentRecord,
  SkillBindingRecord,
  SkillDefinitionRecord,
  SkillRevisionRecord,
  SkillTestRecord,
} from "../../../../shared/domain";
import type { SnapshotActions } from "../../app/useSnapshot";

interface SkillsPanelProps {
  orgId: string;
  skills: SkillDefinitionRecord[];
  revisions: SkillRevisionRecord[];
  bindings: SkillBindingRecord[];
  tests: SkillTestRecord[];
  agents: AgentRecord[];
  actions: SnapshotActions;
}

export function SkillsPanel({ orgId, skills, revisions, bindings, tests, agents, actions }: SkillsPanelProps) {
  const [importOpen, setImportOpen] = useState(false);

  // The on-disk skill library (global ~/.agents/skills and each workspace's
  // .agents/skills) syncs in when the panel opens.
  useEffect(() => {
    void actions.run(() => window.agentCompany.syncSkillsFromDisk({ orgId }));
  }, [orgId, actions]);

  const importSkill = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.importSkillDirectory({
      orgId,
      directoryPath: String(form.get("directoryPath") ?? "").trim(),
      versionSemver: String(form.get("versionSemver") ?? "").trim(),
    })).then((result) => { if (result) setImportOpen(false); });
  };

  const runTests = (revisionId: string) => {
    void actions.run(() => window.agentCompany.runSkillTests({ orgId, revisionId }));
  };

  return (
    <div className="page reveal-row">
      <div className="row" style={{ marginBottom: 24 }}>
        <h1 className="page-h1" style={{ margin: 0 }}>{t("Skills")}</h1>
        <div className="reveal" style={{ marginLeft: "auto" }}>
          <Button tone="primary" onClick={() => setImportOpen(true)}><Icon name="plus" size={16} /> {t("Import")}</Button>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          className="table-row head"
          style={{ gridTemplateColumns: "minmax(0, 1.4fr) 92px 132px minmax(0, 1.2fr) 132px" }}
        >
          <div>{t("Skill")}</div><div>{t("Version")}</div><div>{t("Tests")}</div><div>{t("Held by")}</div><div>{t("Actions")}</div>
        </div>
        {skills.map((skill, index) => {
          const last = index === skills.length - 1;
          const latest = revisions.find((revision) => revision.skillId === skill.id);
          const skillBindings = bindings.filter((binding) => binding.skillId === skill.id && binding.enabled);
          const revisionTests = latest ? tests.filter((test) => test.revisionId === latest.id) : [];
          return (
            <div
              key={skill.id}
              className="table-row"
              style={{ gridTemplateColumns: "minmax(0, 1.4fr) 92px 132px minmax(0, 1.2fr) 132px", borderBottom: last ? "none" : "1px solid var(--border-soft)" }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{skill.name}</div>
                <div style={{ color: "var(--text-3)", fontSize: 12 }}>{skill.slug}</div>
              </div>
              <Pill>{latest ? latest.versionSemver : "—"}</Pill>
              <Pill>{testSummary(revisionTests)}</Pill>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {skillBindings.map((binding) => (
                  <Pill key={binding.id}>{agentName(binding.agentId, agents)}</Pill>
                ))}
              </div>
              <div className="row" style={{ minWidth: 0 }}>
                <Button size="small" onClick={() => { if (latest && revisionTests.length > 0) runTests(latest.id); }} disabled={!latest || revisionTests.length === 0}>{t("Run tests")}</Button>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog title={t("Import skill")} open={importOpen} submitLabel={t("Import")} onClose={() => setImportOpen(false)} onSubmit={importSkill}>
        <Field label={t("Directory path")}><input className="input" name="directoryPath" required /></Field>
        <Field label={t("Version (semver)")}><input className="input" name="versionSemver" required defaultValue="1.0.0" /></Field>
      </Dialog>
    </div>
  );
}

function agentName(agentId: string, agents: AgentRecord[]): string {
  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}

function testSummary(tests: SkillTestRecord[]): string {
  if (tests.length === 0) return t("No tests");
  const completed = tests.filter((test) => test.lastResult);
  if (completed.length === 0) return t("Never run");
  const passed = completed.filter((test) => testStatus(test) === "passed").length;
  const failed = completed.length - passed;
  if (failed > 0) return t("{n} failed", { n: failed });
  return t("{passed}/{total} passed", { passed, total: tests.length });
}

function testStatus(test: SkillTestRecord): "passed" | "failed" {
  if (!test.lastResult) return "failed";
  try {
    const result = JSON.parse(test.lastResult) as { status?: unknown };
    return result.status === "passed" ? "passed" : "failed";
  } catch {
    return "failed";
  }
}
