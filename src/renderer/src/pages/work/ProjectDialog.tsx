import { type FormEvent } from "react";
import { Field } from "../../shared/ui";
import { Dialog } from "../../shared/Dialog";
import type { AgentRecord, GoalRecord } from "../../../../shared/domain";
import type { SnapshotActions } from "../../app/useSnapshot";

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function optional(form: FormData, key: string): string | null {
  return text(form, key) || null;
}

export function ProjectDialog({
  open,
  orgId,
  goals,
  agents,
  actions,
  onClose,
}: {
  open: boolean;
  orgId: string;
  goals: GoalRecord[];
  agents: AgentRecord[];
  actions: SnapshotActions;
  onClose: () => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createProject({
      orgId,
      goalId: optional(form, "goalId"),
      name: text(form, "name"),
      description: text(form, "description"),
      leadAgentId: optional(form, "leadAgentId"),
    })).then((result) => { if (result) onClose(); });
  };

  return (
    <Dialog title="New project" open={open} submitLabel="Create" onClose={onClose} onSubmit={submit}>
      <Field label="Name"><input className="input" name="name" required /></Field>
      <Field label="Description"><textarea className="input" name="description" required /></Field>
      <Field label="Goal">
        <select className="input" name="goalId" defaultValue="">
          <option value="">None</option>
          {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
        </select>
      </Field>
      <Field label="Lead agent">
        <select className="input" name="leadAgentId" defaultValue="">
          <option value="">Unassigned</option>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role}</option>)}
        </select>
      </Field>
    </Dialog>
  );
}
