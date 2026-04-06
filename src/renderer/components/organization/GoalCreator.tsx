import { useState } from "react";
import { Target } from "@phosphor-icons/react";
import type { AgentRecord, GoalRecord } from "@shared/types";
import { ActionButton, Input, Select, TextArea } from "../ui";
import { useT } from "../../i18n";

export function GoalCreator({
  companyId,
  agents,
  goals,
  onSaved,
}: {
  companyId: string;
  agents: AgentRecord[];
  goals: GoalRecord[];
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerAgentId, setOwnerAgentId] = useState(agents[0]?.id ?? "");
  const [parentId, setParentId] = useState("");
  return (
    <div className="grid gap-4">
      <Input label={t("org.goalTitle")} value={title} onChange={setTitle} placeholder={t("org.goalTitle")} />
      <TextArea
        label={t("org.successCriteria")}
        value={description}
        onChange={setDescription}
        placeholder={t("org.successCriteria")}
      />
      <Select
        label={t("org.ownerAgent")}
        value={ownerAgentId}
        onChange={setOwnerAgentId}
        options={[
          { value: "", label: t("org.noOwner") },
          ...agents.map((agent) => ({ value: agent.id, label: agent.name })),
        ]}
      />
      <Select
        label={t("org.parentGoal")}
        value={parentId}
        onChange={setParentId}
        options={[
          { value: "", label: t("org.noParentGoal") },
          ...goals.map((g) => ({ value: g.id, label: g.title })),
        ]}
      />
      <ActionButton
        label={t("org.createGoal")}
        tone="accent"
        onClick={() =>
          void (async () => {
            try {
            await window.agentCompany.saveGoal({
              companyId,
              title,
              description,
              ownerAgentId: ownerAgentId || null,
              parentId: parentId || null,
              status: "active",
            });
            setTitle("");
            setDescription("");
            await onSaved();
            } catch (error) {
              void error;
            }
          })()
        }
        icon={Target}
      />
    </div>
  );
}
