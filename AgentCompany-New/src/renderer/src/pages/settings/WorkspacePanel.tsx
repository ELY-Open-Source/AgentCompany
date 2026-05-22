import type { OrganizationRecord, WorkspaceRecord } from "../../../../shared/domain";
import { Pill } from "../../shared/ui";

export function WorkspacePanel({
  organization,
  workspaces,
}: {
  organization: OrganizationRecord;
  workspaces: WorkspaceRecord[];
}) {
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

      {workspaces.length > 0 && (
        <div className="card" style={{ padding: 18 }}>
          <div className="section-label" style={{ marginBottom: 12 }}>Workspaces</div>
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
        </div>
      )}
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
