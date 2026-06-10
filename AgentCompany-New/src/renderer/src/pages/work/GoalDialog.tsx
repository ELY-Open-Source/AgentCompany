import { type FormEvent } from "react";
import { Field } from "../../shared/ui";
import { Dialog } from "../../shared/Dialog";
import type { AgentRecord } from "../../../../shared/domain";
import type { SnapshotActions } from "../../app/useSnapshot";

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function optional(form: FormData, key: string): string | null {
  return text(form, key) || null;
}

export function GoalDialog({
  open,
  orgId,
  agents,
  actions,
  onClose,
}: {
  open: boolean;
  orgId: string;
  agents: AgentRecord[];
  actions: SnapshotActions;
  onClose: () => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createGoal({
      orgId,
      title: text(form, "title"),
      description: text(form, "description"),
      ownerAgentId: optional(form, "ownerAgentId"),
    })).then((result) => { if (result) onClose(); });
  };

  return (
    <Dialog title="New goal" open={open} submitLabel="Create" onClose={onClose} onSubmit={submit}>
      <Field label="Title"><input className="input" name="title" required /></Field>
      <Field label="Description"><textarea className="input" name="description" required /></Field>
      <Field label="Owner agent">
        <select className="input" name="ownerAgentId" defaultValue="">
          <option value="">Unassigned</option>
          {agents.filter((agent) => agent.lifecycle === "active").map((agent) => (
            <option key={agent.id} value={agent.id}>{agent.name} · {agent.role}</option>
          ))}
        </select>
      </Field>
    </Dialog>
  );
}
