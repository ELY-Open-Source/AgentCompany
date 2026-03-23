import { useState } from "react";
import { Target } from "@phosphor-icons/react";
import type { AgentRecord, GoalRecord } from "@shared/types";
import { ActionButton, Input, Select, TextArea } from "../ui";

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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerAgentId, setOwnerAgentId] = useState(agents[0]?.id ?? "");
  const [parentId, setParentId] = useState("");
  return (
    <div className="grid gap-4">
      <Input label="Goal title" value={title} onChange={setTitle} placeholder="Goal title" />
      <TextArea
        label="Success criteria"
        value={description}
        onChange={setDescription}
        placeholder="Define the acceptance criteria"
      />
      <Select
        label="Owner agent"
        value={ownerAgentId}
        onChange={setOwnerAgentId}
        options={[
          { value: "", label: "No owner" },
          ...agents.map((agent) => ({ value: agent.id, label: agent.name })),
        ]}
      />
      <Select
        label="Parent goal"
        value={parentId}
        onChange={setParentId}
        options={[
          { value: "", label: "No parent goal" },
          ...goals.map((g) => ({ value: g.id, label: g.title })),
        ]}
      />
      <ActionButton
        label="Create goal"
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
