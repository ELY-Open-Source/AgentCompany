import { useState } from "react";
import { Pencil, Trash } from "@phosphor-icons/react";
import type { AgentRecord, GoalRecord } from "@shared/types";
import { ActionButton, Input, Select, TextArea } from "../ui";
import { ConfirmDelete } from "./helpers";

export function GoalEditor({
  goal,
  goals,
  agents,
  companyId,
  onSaved,
  onDeleted,
}: {
  goal: GoalRecord;
  goals: GoalRecord[];
  agents: AgentRecord[];
  companyId: string;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [title, setTitle] = useState(goal.title);
  const [description, setDescription] = useState(goal.description);
  const [status, setStatus] = useState<GoalRecord["status"]>(goal.status);
  const [parentId, setParentId] = useState(goal.parentId ?? "");
  const [ownerAgentId, setOwnerAgentId] = useState(goal.ownerAgentId ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const parentCandidates = goals.filter((g) => g.id !== goal.id);

  return (
    <div className="grid gap-4">
      <Input label="Goal title" value={title} onChange={setTitle} placeholder="Goal title" />
      <TextArea label="Description" value={description} onChange={setDescription} placeholder="Description" />
      <Select
        label="Status"
        value={status}
        onChange={(v) => setStatus(v as GoalRecord["status"])}
        options={[
          { value: "planned", label: "Planned" },
          { value: "active", label: "Active" },
          { value: "achieved", label: "Achieved" },
          { value: "cancelled", label: "Cancelled" },
        ]}
      />
      <Select
        label="Parent goal"
        value={parentId}
        onChange={setParentId}
        options={[
          { value: "", label: "No parent goal" },
          ...parentCandidates.map((g) => ({ value: g.id, label: g.title })),
        ]}
      />
      <Select
        label="Owner agent"
        value={ownerAgentId}
        onChange={setOwnerAgentId}
        options={[
          { value: "", label: "No owner" },
          ...agents.map((a) => ({ value: a.id, label: a.name })),
        ]}
      />

      <div className="flex items-center gap-3 flex-wrap">
        <ActionButton
          label="Save changes"
          tone="accent"
          icon={Pencil}
          onClick={() =>
            void (async () => {
              try {
              await window.agentCompany.saveGoal({
                id: goal.id,
                companyId,
                title,
                description,
                status,
                parentId: parentId || null,
                ownerAgentId: ownerAgentId || null,
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
            entityLabel={goal.title}
            onConfirm={() =>
              void (async () => {
                await window.agentCompany.deleteGoal({ id: goal.id, companyId });
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
