import { useState } from "react";
import { Kanban } from "@phosphor-icons/react";
import type { AgentRecord, GoalRecord } from "@shared/types";
import { ActionButton, Input, Select, TextArea } from "../ui";

export function ProjectCreator({
  companyId,
  goals,
  agents,
  onSaved,
}: {
  companyId: string;
  goals: GoalRecord[];
  agents: AgentRecord[];
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [goalId, setGoalId] = useState(goals[0]?.id ?? "");
  const [leadAgentId, setLeadAgentId] = useState(agents[0]?.id ?? "");
  const [targetDate, setTargetDate] = useState("");
  return (
    <div className="grid gap-4">
      <Input label="Project name" value={name} onChange={setName} placeholder="Project name" />
      <TextArea
        label="Description"
        value={description}
        onChange={setDescription}
        placeholder="Project description"
      />
      <Select
        label="Linked goal"
        value={goalId}
        onChange={setGoalId}
        options={[
          { value: "", label: "No linked goal" },
          ...goals.map((goal) => ({ value: goal.id, label: goal.title })),
        ]}
      />
      <Select
        label="Lead agent"
        value={leadAgentId}
        onChange={setLeadAgentId}
        options={[
          { value: "", label: "No lead" },
          ...agents.map((agent) => ({ value: agent.id, label: agent.name })),
        ]}
      />
      <Input label="Target date" value={targetDate} onChange={setTargetDate} placeholder="YYYY-MM-DD" />
      <ActionButton
        label="Create project"
        tone="accent"
        onClick={() =>
          void (async () => {
            try {
            await window.agentCompany.saveProject({
              companyId,
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
            await onSaved();
            } catch (error) {
              void error;
            }
          })()
        }
        icon={Kanban}
      />
    </div>
  );
}
