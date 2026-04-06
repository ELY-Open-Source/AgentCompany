import { useState } from "react";
import { Pencil, Trash } from "@phosphor-icons/react";
import type { AgentRecord, GoalRecord } from "@shared/types";
import { ActionButton, Input, Select, TextArea } from "../ui";
import { ConfirmDelete } from "./helpers";
import { useT } from "../../i18n";

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
  const t = useT();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const parentCandidates = goals.filter((g) => g.id !== goal.id);

  return (
    <div className="grid gap-4">
      <Input label={t("org.goalTitle")} value={title} onChange={setTitle} placeholder={t("org.goalTitle")} />
      <TextArea label={t("org.description")} value={description} onChange={setDescription} placeholder={t("org.description")} />
      <Select
        label={t("org.status")}
        value={status}
        onChange={(v) => setStatus(v as GoalRecord["status"])}
        options={[
          { value: "planned", label: t("org.statusPlanned") },
          { value: "active", label: t("org.statusActive") },
          { value: "achieved", label: t("org.statusAchieved") },
          { value: "cancelled", label: t("org.statusCancelled") },
        ]}
      />
      <Select
        label={t("org.parentGoal")}
        value={parentId}
        onChange={setParentId}
        options={[
          { value: "", label: t("org.noParentGoal") },
          ...parentCandidates.map((g) => ({ value: g.id, label: g.title })),
        ]}
      />
      <Select
        label={t("org.ownerAgent")}
        value={ownerAgentId}
        onChange={setOwnerAgentId}
        options={[
          { value: "", label: t("org.noOwner") },
          ...agents.map((a) => ({ value: a.id, label: a.name })),
        ]}
      />

      <div className="flex items-center gap-3 flex-wrap">
        <ActionButton
          label={t("org.saveChanges")}
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
            label={t("common.delete")}
            tone="danger"
            icon={Trash}
            onClick={() => setConfirmingDelete(true)}
          />
        )}
      </div>
    </div>
  );
}
