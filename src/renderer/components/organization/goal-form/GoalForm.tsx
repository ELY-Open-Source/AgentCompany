import { useState } from "react";
import { Pencil, Target, Trash } from "../../ui/icons";
import type { AgentRecord, GoalRecord } from "@shared/types";
import { ActionButton, Input, Select, TextArea } from "../../ui";
import { ConfirmDelete } from "../helpers";
import { useT } from "../../../i18n";

type CreateProps = {
  mode: "create";
  companyId: string;
  agents: AgentRecord[];
  goals: GoalRecord[];
  onSaved: () => Promise<void>;
};

type EditProps = {
  mode: "edit";
  companyId: string;
  agents: AgentRecord[];
  goals: GoalRecord[];
  goal: GoalRecord;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
};

export type GoalFormProps = CreateProps | EditProps;

export function GoalForm(props: GoalFormProps) {
  const t = useT();
  const isEdit = props.mode === "edit";
  const editGoal = isEdit ? props.goal : null;

  const [title, setTitle] = useState(editGoal?.title ?? "");
  const [description, setDescription] = useState(editGoal?.description ?? "");
  const [status, setStatus] = useState<GoalRecord["status"]>(editGoal?.status ?? "active");
  const [ownerAgentId, setOwnerAgentId] = useState(
    editGoal ? (editGoal.ownerAgentId ?? "") : (props.agents[0]?.id ?? ""),
  );
  const [parentId, setParentId] = useState(editGoal?.parentId ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const parentCandidates = editGoal
    ? props.goals.filter((g) => g.id !== editGoal.id)
    : props.goals;

  return (
    <div className="grid gap-4">
      <Input label={t("org.goalTitle")} value={title} onChange={setTitle} placeholder={t("org.goalTitle")} />
      <TextArea
        label={isEdit ? t("org.description") : t("org.successCriteria")}
        value={description}
        onChange={setDescription}
        placeholder={isEdit ? t("org.description") : t("org.successCriteria")}
      />
      {isEdit && (
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
      )}
      {isEdit ? (
        <>
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
              ...props.agents.map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
        </>
      ) : (
        <>
          <Select
            label={t("org.ownerAgent")}
            value={ownerAgentId}
            onChange={setOwnerAgentId}
            options={[
              { value: "", label: t("org.noOwner") },
              ...props.agents.map((agent) => ({ value: agent.id, label: agent.name })),
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
        </>
      )}

      {isEdit ? (
        <div className="flex items-center gap-3 flex-wrap">
          <ActionButton
            label={t("org.saveChanges")}
            tone="accent"
            icon={Pencil}
            onClick={() =>
              void (async () => {
                try {
                  await window.agentCompany.saveGoal({
                    id: props.goal.id,
                    companyId: props.companyId,
                    title,
                    description,
                    status,
                    parentId: parentId || null,
                    ownerAgentId: ownerAgentId || null,
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
              entityLabel={props.goal.title}
              onConfirm={() =>
                void (async () => {
                  await window.agentCompany.deleteGoal({ id: props.goal.id, companyId: props.companyId });
                  await props.onDeleted();
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
      ) : (
        <ActionButton
          label={t("org.createGoal")}
          tone="accent"
          icon={Target}
          onClick={() =>
            void (async () => {
              try {
                await window.agentCompany.saveGoal({
                  companyId: props.companyId,
                  title,
                  description,
                  ownerAgentId: ownerAgentId || null,
                  parentId: parentId || null,
                  status: "active",
                });
                setTitle("");
                setDescription("");
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
