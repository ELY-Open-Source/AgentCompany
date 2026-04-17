import { useState } from "react";
import { Kanban, Pencil, Trash } from "@phosphor-icons/react";
import type { AgentRecord, GoalRecord, ProjectRecord } from "@shared/types";
import { ActionButton, Input, Select, TextArea } from "../../ui";
import { ConfirmDelete } from "../helpers";

type CreateProps = {
  mode: "create";
  companyId: string;
  goals: GoalRecord[];
  agents: AgentRecord[];
  onSaved: () => Promise<void>;
};

type EditProps = {
  mode: "edit";
  companyId: string;
  goals: GoalRecord[];
  agents: AgentRecord[];
  project: ProjectRecord;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
};

export type ProjectFormProps = CreateProps | EditProps;

export function ProjectForm(props: ProjectFormProps) {
  const isEdit = props.mode === "edit";
  const editProject = isEdit ? props.project : null;

  const [name, setName] = useState(editProject?.name ?? "");
  const [description, setDescription] = useState(editProject?.description ?? "");
  const [status, setStatus] = useState<ProjectRecord["status"]>(editProject?.status ?? "planned");
  const [goalId, setGoalId] = useState(
    editProject ? (editProject.goalId ?? "") : (props.goals[0]?.id ?? ""),
  );
  const [leadAgentId, setLeadAgentId] = useState(
    editProject ? (editProject.leadAgentId ?? "") : (props.agents[0]?.id ?? ""),
  );
  const [targetDate, setTargetDate] = useState(editProject?.targetDate ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="grid gap-4">
      <Input label="Project name" value={name} onChange={setName} placeholder="Project name" />
      <TextArea
        label="Description"
        value={description}
        onChange={setDescription}
        placeholder={isEdit ? "Description" : "Project description"}
      />
      {isEdit && (
        <Select
          label="Status"
          value={status}
          onChange={(v) => setStatus(v as ProjectRecord["status"])}
          options={[
            { value: "backlog", label: "Backlog" },
            { value: "planned", label: "Planned" },
            { value: "in_progress", label: "In Progress" },
            { value: "completed", label: "Completed" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
      )}
      <Select
        label="Linked goal"
        value={goalId}
        onChange={setGoalId}
        options={[
          { value: "", label: "No linked goal" },
          ...props.goals.map((g) => ({ value: g.id, label: g.title })),
        ]}
      />
      <Select
        label="Lead agent"
        value={leadAgentId}
        onChange={setLeadAgentId}
        options={[
          { value: "", label: "No lead" },
          ...props.agents.map((a) => ({ value: a.id, label: a.name })),
        ]}
      />
      <Input label="Target date" value={targetDate} onChange={setTargetDate} placeholder="YYYY-MM-DD" />

      {isEdit ? (
        <div className="flex items-center gap-3">
          <ActionButton
            label="Save changes"
            tone="accent"
            icon={Pencil}
            onClick={() =>
              void (async () => {
                try {
                  await window.agentCompany.saveProject({
                    id: props.project.id,
                    companyId: props.companyId,
                    name,
                    description,
                    status,
                    goalId: goalId || null,
                    leadAgentId: leadAgentId || null,
                    targetDate: targetDate || null,
                  });
                  await props.onSaved();
                } catch (error) {
                  void error;
                }
              })()
            }
          />
          {confirmingDelete ? (
            <ConfirmDelete
              entityLabel={props.project.name}
              onConfirm={() =>
                void (async () => {
                  await window.agentCompany.deleteProject({ id: props.project.id, companyId: props.companyId });
                  await props.onDeleted();
                })()
              }
              onCancel={() => setConfirmingDelete(false)}
            />
          ) : (
            <ActionButton
              label="Delete"
              tone="danger"
              icon={Trash}
              onClick={() => setConfirmingDelete(true)}
            />
          )}
        </div>
      ) : (
        <ActionButton
          label="Create project"
          tone="accent"
          icon={Kanban}
          onClick={() =>
            void (async () => {
              try {
                await window.agentCompany.saveProject({
                  companyId: props.companyId,
                  goalId: goalId || null,
                  name,
                  description,
                  leadAgentId: leadAgentId || null,
                  targetDate: targetDate || null,
                  status: "planned",
                });
                setName("");
                setDescription("");
                setTargetDate("");
                await props.onSaved();
              } catch (error) {
                void error;
              }
            })()
          }
        />
      )}
    </div>
  );
}
