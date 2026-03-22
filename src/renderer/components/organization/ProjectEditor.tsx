import { useState } from "react";
import { Pencil, Trash } from "@phosphor-icons/react";
import type { AgentRecord, GoalRecord, ProjectRecord } from "@shared/types";
import { ActionButton, Input, Select, TextArea } from "../ui";
import { ConfirmDelete } from "./helpers";

export function ProjectEditor({
  project,
  goals,
  agents,
  companyId,
  onSaved,
  onDeleted,
}: {
  project: ProjectRecord;
  goals: GoalRecord[];
  agents: AgentRecord[];
  companyId: string;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [status, setStatus] = useState<ProjectRecord["status"]>(project.status);
  const [goalId, setGoalId] = useState(project.goalId ?? "");
  const [leadAgentId, setLeadAgentId] = useState(project.leadAgentId ?? "");
  const [targetDate, setTargetDate] = useState(project.targetDate ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="grid gap-4">
      <Input label="Project name" value={name} onChange={setName} placeholder="Project name" />
      <TextArea label="Description" value={description} onChange={setDescription} placeholder="Description" />
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
      <Select
        label="Linked goal"
        value={goalId}
        onChange={setGoalId}
        options={[
          { value: "", label: "No linked goal" },
          ...goals.map((g) => ({ value: g.id, label: g.title })),
        ]}
      />
      <Select
        label="Lead agent"
        value={leadAgentId}
        onChange={setLeadAgentId}
        options={[
          { value: "", label: "No lead" },
          ...agents.map((a) => ({ value: a.id, label: a.name })),
        ]}
      />
      <Input label="Target date" value={targetDate} onChange={setTargetDate} placeholder="YYYY-MM-DD" />

      <div className="flex items-center gap-3">
        <ActionButton
          label="Save changes"
          tone="accent"
          icon={Pencil}
          onClick={() =>
            void (async () => {
              try {
              await window.agentCompany.saveProject({
                id: project.id,
                companyId,
                name,
                description,
                status,
                goalId: goalId || null,
                leadAgentId: leadAgentId || null,
                targetDate: targetDate || null,
              });
              await onSaved();
              } catch (error) {
                void error;
              }
            })()
          }
        />
        {confirmingDelete ? (
          <ConfirmDelete
            entityLabel={project.name}
            onConfirm={() =>
              void (async () => {
                await window.agentCompany.deleteProject({ id: project.id, companyId });
                await onDeleted();
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
    </div>
  );
}
