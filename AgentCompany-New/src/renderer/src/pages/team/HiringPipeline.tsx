import { Avatar } from "../../shared/ui";
import type { AgentRecord, ApprovalRecord } from "../../../../shared/domain";
import { formatRelative } from "../types";

interface PipelineStage {
  id: string;
  label: string;
  color: string;
}

const STAGES: PipelineStage[] = [
  { id: "pending_approval", label: "Pending approval", color: "var(--amber)" },
  { id: "approved", label: "Approved", color: "var(--green)" },
  { id: "active", label: "Active", color: "var(--accent)" },
  { id: "rejected", label: "Rejected", color: "var(--red)" },
];

interface PipelineEntry {
  agent: AgentRecord;
  stage: string;
  approval: ApprovalRecord | null;
}

function resolveStage(agent: AgentRecord, approvals: ApprovalRecord[]): PipelineEntry {
  const hireApproval = approvals.find(
    (a) => a.sourceEntityType === "agent" && a.sourceEntityId === agent.id && a.kind === "agent_hire",
  ) ?? null;

  if (hireApproval?.state === "pending") return { agent, stage: "pending_approval", approval: hireApproval };
  if (hireApproval?.state === "declined") return { agent, stage: "rejected", approval: hireApproval };
  if (agent.lifecycle === "active") return { agent, stage: "active", approval: hireApproval };
  return { agent, stage: "approved", approval: hireApproval };
}

export function HiringPipeline({ agents, approvals }: { agents: AgentRecord[]; approvals: ApprovalRecord[] }) {
  const entries = agents.map((a) => resolveStage(a, approvals));

  return (
    <section style={{ marginBottom: 24 }}>
      <div className="section-label" style={{ marginBottom: 12 }}>Hiring pipeline</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
        {STAGES.map((stage) => {
          const stageEntries = entries.filter((e) => e.stage === stage.id);
          return (
            <div key={stage.id}>
              <div className="row" style={{ gap: 6, marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: stage.color }} />
                <span style={{ fontSize: 12, fontWeight: 540 }}>{stage.label}</span>
                <span className="num" style={{ fontSize: 12, color: "var(--text-3)" }}>{stageEntries.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {stageEntries.map((entry) => (
                  <div key={entry.agent.id} className="card" style={{ padding: 10 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <Avatar name={entry.agent.name} size="sm" bot />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.agent.name}</div>
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{entry.agent.role} · {entry.agent.department}</div>
                      </div>
                    </div>
                    {entry.approval && (
                      <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-3)" }}>
                        {formatRelative(entry.approval.createdAt)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
