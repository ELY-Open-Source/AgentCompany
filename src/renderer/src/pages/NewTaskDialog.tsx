import type { FormEvent } from "react";
import { Dialog } from "../shared/Dialog";
import { Field } from "../shared/ui";
import type { AppSnapshot, RiskLevel, TaskPriority, WritingMode } from "../../../shared/domain";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS, WRITING_MODE } from "../../../shared/domain";
import type { SnapshotActions } from "../app/useSnapshot";
import { t } from "../i18n/i18n";
import { WRITING_OPTIONS, readWorkLanguage } from "./work/task-helpers";
import { WorkLanguageField } from "./work/WorkLanguageField";
import { requireActiveOrganization } from "./types";

const RISK_OPTIONS: ReadonlyArray<{ value: RiskLevel; label: string }> = [
  { value: RISK_LEVEL.LOW, label: t("Low") },
  { value: RISK_LEVEL.MEDIUM, label: t("Medium") },
  { value: RISK_LEVEL.HIGH, label: t("High") },
];

const PRIORITY_OPTIONS: ReadonlyArray<{ value: TaskPriority; label: string }> = [
  { value: TASK_PRIORITY.LOW, label: t("Low") },
  { value: TASK_PRIORITY.NORMAL, label: t("Normal") },
  { value: TASK_PRIORITY.HIGH, label: t("High") },
];

function value(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function optional(form: FormData, key: string): string | null {
  return value(form, key) || null;
}

export function NewTaskDialog({
  open,
  onClose,
  orgId,
  snapshot,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  snapshot: AppSnapshot;
  actions: SnapshotActions;
}) {
  const agents = snapshot.agents.filter((item) => item.orgId === orgId);
  const projects = snapshot.projects.filter((item) => item.orgId === orgId);
  const goals = snapshot.goals.filter((item) => item.orgId === orgId);
  const workspaces = snapshot.workspaces.filter((item) => item.orgId === orgId);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createTask({
      orgId,
      title: value(form, "title"),
      description: value(form, "description"),
      status: TASK_STATUS.BACKLOG,
      assigneeAgentId: optional(form, "assigneeAgentId"),
      risk: value(form, "risk") as RiskLevel,
      projectId: optional(form, "projectId"),
      goalId: optional(form, "goalId"),
      workspaceId: optional(form, "workspaceId"),
      priority: value(form, "priority") as TaskPriority,
      requiresFilesystem: form.get("requiresFilesystem") === "on",
      writingMode: value(form, "writingMode") as WritingMode,
      workLanguage: readWorkLanguage(form),
    })).then((result) => {
      if (result) onClose();
    });
  };

  return (
    <Dialog title={t("New task")} open={open} submitLabel={t("Create")} onClose={onClose} onSubmit={submit}>
      <Field label={t("Title")}><input className="input" name="title" required autoFocus /></Field>
      <Field label={t("Description")}><textarea className="input" name="description" required /></Field>
      <Field label={t("Assignee")}>
        <select className="input" name="assigneeAgentId">
          <option value="">{t("Unassigned")}</option>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select>
      </Field>
      <Field label={t("Project")}>
        <select className="input" name="projectId">
          <option value="">{t("None")}</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </Field>
      <Field label={t("Goal")}>
        <select className="input" name="goalId">
          <option value="">{t("None")}</option>
          {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
        </select>
      </Field>
      <Field label={t("Workspace")}>
        <select className="input" name="workspaceId">
          <option value="">{t("None")}</option>
          {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
        </select>
      </Field>
      <Field label={t("Risk")}>
        <select className="input" name="risk" defaultValue={RISK_LEVEL.LOW}>
          {RISK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </Field>
      <Field label={t("Priority")}>
        <select className="input" name="priority" defaultValue={TASK_PRIORITY.NORMAL}>
          {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </Field>
      <Field label={t("Writing")}>
        <select className="input" name="writingMode" defaultValue={WRITING_MODE.CONVERSATIONAL}>
          {WRITING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </Field>
      <WorkLanguageField companyLanguage={requireActiveOrganization(snapshot).workLanguage} defaultValue={null} />
      <label className="checkbox-row">
        <input type="checkbox" name="requiresFilesystem" /> {t("Requires workspace access")}
      </label>
    </Dialog>
  );
}
