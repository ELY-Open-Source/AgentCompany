import { useMemo, useState, type FormEvent } from "react";
import { Button, Field, Icon, IconButton, Pill } from "../shared/ui";
import { TopbarActions } from "../shared/TopbarActions";
import { Dialog } from "../shared/Dialog";
import type { AutomationRuleRecord } from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId, formatRelative } from "./types";

const TRIGGER_EVENTS = [
  "task_created",
  "task_status_changed",
  "agent_hired",
  "approval_created",
  "message_sent",
  "file_uploaded",
  "goal_created",
  "project_created",
] as const;

const ACTION_TYPES = [
  "assign_to_department",
  "create_task",
  "send_notification",
  "update_status",
  "escalate",
] as const;

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export function AutomationPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const rules = useMemo(() => snapshot.automationRules.filter((r) => r.orgId === orgId), [snapshot.automationRules, orgId]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = editingId ? rules.find((r) => r.id === editingId) ?? null : null;
  const enabledCount = rules.filter((r) => r.enabled).length;
  const totalFires = rules.reduce((sum, r) => sum + r.fireCount, 0);

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createAutomationRule({
      orgId,
      name: text(form, "name"),
      triggerEvent: text(form, "triggerEvent"),
      conditions: {},
      actionType: text(form, "actionType"),
      actionConfig: {},
      priority: Number(text(form, "priority")) || 100,
      enabled: true,
    })).then((r) => { if (r) setCreateOpen(false); });
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.updateAutomationRule({
      orgId,
      ruleId: editing.id,
      name: text(form, "name"),
      triggerEvent: text(form, "triggerEvent"),
      conditions: {},
      actionType: text(form, "actionType"),
      actionConfig: {},
      priority: Number(text(form, "priority")) || editing.priority,
      enabled: form.get("enabled") === "on",
    })).then((r) => { if (r) setEditingId(null); });
  };

  const remove = (ruleId: string) => {
    void actions.run(() => window.agentCompany.deleteAutomationRule({ orgId, ruleId }));
    setEditingId(null);
  };

  return (
    <div className="page">
      <TopbarActions>
        <Button tone="primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={13} /> New rule</Button>
      </TopbarActions>
      <h1 className="page-h1">Automation</h1>
      <p className="page-sub">{enabledCount} active · {totalFires} total fires</p>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-row head" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.2fr) minmax(0, 1.2fr) 70px 80px 50px" }}>
          <div>Name</div><div>Trigger</div><div>Action</div><div>Fires</div><div>Status</div><div />
        </div>
        {rules.map((rule, index) => (
          <div
            key={rule.id}
            role="button"
            tabIndex={0}
            className="table-row clickable"
            onClick={() => setEditingId(rule.id)}
            onKeyDown={(e) => { if (e.key === "Enter") setEditingId(rule.id); }}
            style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.2fr) minmax(0, 1.2fr) 70px 80px 50px", borderBottom: index === rules.length - 1 ? "none" : "1px solid var(--border-soft)" }}
          >
            <div style={{ fontWeight: 480, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rule.name}</div>
            <div><Pill>{humanize(rule.triggerEvent)}</Pill></div>
            <div><Pill tone="violet">{humanize(rule.actionType)}</Pill></div>
            <div className="num" style={{ fontSize: 12 }}>{rule.fireCount}</div>
            <div>{rule.enabled ? <Pill tone="green">Active</Pill> : <Pill>Paused</Pill>}</div>
            <div style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
              <IconButton icon="x" label="Delete" onClick={() => remove(rule.id)} />
            </div>
          </div>
        ))}
      </div>

      <Dialog title="New automation rule" open={createOpen} submitLabel="Create" onClose={() => setCreateOpen(false)} onSubmit={create}>
        <Field label="Name"><input className="input" name="name" required /></Field>
        <Field label="Trigger">
          <select className="input" name="triggerEvent" defaultValue="task_created">
            {TRIGGER_EVENTS.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
          </select>
        </Field>
        <Field label="Action">
          <select className="input" name="actionType" defaultValue="assign_to_department">
            {ACTION_TYPES.map((a) => <option key={a} value={a}>{humanize(a)}</option>)}
          </select>
        </Field>
        <Field label="Priority"><input className="input" name="priority" type="number" defaultValue="100" /></Field>
      </Dialog>

      {editing && (
        <Dialog key={editing.id} title={editing.name} open submitLabel="Save" onClose={() => setEditingId(null)} onSubmit={save}>
          <Field label="Name"><input className="input" name="name" defaultValue={editing.name} required /></Field>
          <Field label="Trigger">
            <select className="input" name="triggerEvent" defaultValue={editing.triggerEvent}>
              {TRIGGER_EVENTS.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </select>
          </Field>
          <Field label="Action">
            <select className="input" name="actionType" defaultValue={editing.actionType}>
              {ACTION_TYPES.map((a) => <option key={a} value={a}>{humanize(a)}</option>)}
            </select>
          </Field>
          <Field label="Priority"><input className="input" name="priority" type="number" defaultValue={editing.priority} /></Field>
          <Field label="Enabled">
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" name="enabled" defaultChecked={editing.enabled} />
              <span style={{ fontSize: 13 }}>Rule is active</span>
            </label>
          </Field>
          {editing.lastFiredAt && <div style={{ fontSize: 12, color: "var(--text-3)" }}>Last fired {formatRelative(editing.lastFiredAt)}</div>}
        </Dialog>
      )}
    </div>
  );
}

function humanize(value: string): string {
  return value.replace(/_/g, " ");
}
