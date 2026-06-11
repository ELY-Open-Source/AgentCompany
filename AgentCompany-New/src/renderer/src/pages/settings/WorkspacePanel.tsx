import { useState, type FormEvent } from "react";
import type { OrganizationRecord, ProjectRecord, WorkspaceRecord } from "../../../../shared/domain";
import { Button, Field, Icon, Pill } from "../../shared/ui";
import { Dialog } from "../../shared/Dialog";
import type { SnapshotActions } from "../../app/useSnapshot";

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function optional(form: FormData, key: string): string | null {
  return text(form, key) || null;
}

export function WorkspacePanel({
  organization,
  workspaces,
  projects,
  orgId,
  actions,
}: {
  organization: OrganizationRecord;
  workspaces: WorkspaceRecord[];
  projects: ProjectRecord[];
  orgId: string;
  actions: SnapshotActions;
}) {
  const [createOpen, setCreateOpen] = useState(false);

  const chooseDirectory = async (form: HTMLFormElement) => {
    const result = await window.agentCompany.pickDirectory();
    if (result.ok && result.data) {
      const input = form.elements.namedItem("localPath") as HTMLInputElement | null;
      if (input) input.value = result.data;
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createWorkspace({
      orgId,
      name: text(form, "name"),
      localPath: text(form, "localPath"),
      projectId: optional(form, "projectId"),
    })).then((result) => { if (result) setCreateOpen(false); });
  };

  return (
    <div className="page">
      <h1 className="page-h1">Workspace</h1>
      <p className="page-sub">Identity, mission, and execution mode for {organization.name}.</p>

      <div className="card" style={{ padding: 18, marginBottom: 20 }}>
        <div className="section-label" style={{ marginBottom: 12 }}>Identity</div>
        <KeyValue label="Name" value={organization.name} />
        <KeyValue label="Mission" value={organization.mission || "—"} />
        <KeyValue label="Goal" value={organization.goal || "—"} />
        <KeyValue label="Description" value={organization.description || "—"} />
      </div>

      <div className="card" style={{ padding: 18, marginBottom: 20 }}>
        <div className="section-label" style={{ marginBottom: 12 }}>Execution mode</div>
        <div className="row" style={{ gap: 8 }}>
          <Pill tone="violet" dot>{organization.executionMode === "ai_ceo" ? "AI CEO" : "AI Co-Founder"}</Pill>
          {organization.autoApproveHires ? <Pill tone="green" dot>Auto-approve hires</Pill> : <Pill>Hires require approval</Pill>}
          {organization.reviewDeliverables ? <Pill tone="amber" dot>Reviews deliverables</Pill> : <Pill>Deliverables ship without review</Pill>}
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="section-label">Workspaces</div>
          <span style={{ marginLeft: "auto" }}><Button tone="ghost" onClick={() => setCreateOpen(true)}><Icon name="plus" size={16} /> Add</Button></span>
        </div>
        {workspaces.map((workspace) => (
          <div key={workspace.id} className="row" style={{ padding: "8px 0", borderBottom: "1px solid var(--border-soft)" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 540 }}>{workspace.name}</div>
              <div style={{ fontSize: 12, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{workspace.localPath}</div>
            </div>
            <div style={{ marginLeft: "auto" }}>
              {workspace.isPrimary ? <Pill tone="violet">Primary</Pill> : <Pill>Secondary</Pill>}
            </div>
          </div>
        ))}
        {workspaces.length === 0 && <div style={{ fontSize: 14, color: "var(--text-3)" }}>No workspaces configured</div>}
      </div>

      <Dialog title="Add workspace" open={createOpen} submitLabel="Create" onClose={() => setCreateOpen(false)} onSubmit={submit}>
        <Field label="Name"><input className="input" name="name" required /></Field>
        <Field label="Local path">
          <div className="row" style={{ gap: 6 }}>
            <input className="input" name="localPath" required style={{ flex: 1 }} />
            <Button tone="ghost" onClick={() => {
              const form = document.querySelector<HTMLFormElement>("form:has([name='localPath'])");
              if (form) void chooseDirectory(form);
            }}>
              <Icon name="folder" size={16} /> Browse
            </Button>
          </div>
        </Field>
        <Field label="Project">
          <select className="input" name="projectId" defaultValue="">
            <option value="">None</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </Dialog>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ padding: "6px 0", borderBottom: "1px solid var(--border-soft)" }}>
      <span style={{ color: "var(--text-3)", width: 120, flexShrink: 0, fontSize: 12 }}>{label}</span>
      <span style={{ flex: 1, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
    </div>
  );
}
