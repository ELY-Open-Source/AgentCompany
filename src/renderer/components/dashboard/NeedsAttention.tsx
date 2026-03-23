import { useMemo } from "react";
import {
  ArrowRight,
  Cpu,
  Lightning,
  ShieldCheck,
  Users,
  XCircle,
} from "@phosphor-icons/react";
import type {
  AgentRecord,
  AgentMessageRecord,
  ApprovalRecord,
  BrowserActionRecord,
  RunRecord,
  SectionId,
  WorkflowPipelineRecord,
} from "@shared/types";
import { useT } from "../../i18n";

export function NeedsAttention({
  agents,
  approvals,
  runs,
  messages,
  browserActions,
  workflows,
  onNavigate,
}: {
  agents: AgentRecord[];
  approvals: ApprovalRecord[];
  runs: RunRecord[];
  messages: AgentMessageRecord[];
  browserActions: BrowserActionRecord[];
  workflows: WorkflowPipelineRecord[];
  onNavigate: (section: SectionId, entityId?: string) => void;
}) {
  const t = useT();
  const pendingApprovals = useMemo(() => approvals.filter((a) => a.state === "pending"), [approvals]);
  const failedRuns = useMemo(() => runs.filter((r) => r.status === "failed" || r.status === "timed_out" || r.status === "interrupted"), [runs]);
  const urgentMessages = useMemo(() => messages.filter((message) => !message.readAt && (message.priority === "urgent" || message.channel === "incident")), [messages]);
  const blockedBrowserActions = useMemo(() => browserActions.filter((action) => action.status === "approval_required" || action.status === "failed"), [browserActions]);
  const stalledWorkflows = useMemo(() => workflows.filter((workflow) => workflow.status === "paused" || workflow.status === "failed"), [workflows]);

  if (pendingApprovals.length === 0 && failedRuns.length === 0 && urgentMessages.length === 0 && blockedBrowserActions.length === 0 && stalledWorkflows.length === 0) {
    return null;
  }

  return (
    <section>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--warn)]">{t("dash.needsAttentionSection")}</div>
      <div className="space-y-1.5">
        {pendingApprovals.slice(0, 5).map((approval) => {
          const requester = agents.find((a) => a.id === approval.requestedByAgentId);
          return (
            <button
              key={approval.id}
              type="button"
              onClick={() => onNavigate("approvals", approval.id)}
              className="focus-ring flex w-full items-center gap-3 rounded-[8px] border border-[color:var(--warn)] border-opacity-20 bg-[color:var(--warn-soft)] px-4 py-3 text-left transition hover:border-opacity-40"
            >
              <ShieldCheck size={18} className="shrink-0 text-[color:var(--warn)]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-[color:var(--text)]">{approval.payloadSummary}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[color:var(--muted)]">
                  <span className="uppercase tracking-[0.1em]">{approval.type.replaceAll("_", " ")}</span>
                  {requester ? <span>by {requester.name}</span> : null}
                </div>
              </div>
              <ArrowRight size={14} className="shrink-0 text-[color:var(--muted)]" />
            </button>
          );
        })}
        {failedRuns.slice(0, 3).map((run) => {
          const agent = agents.find((a) => a.id === run.agentId);
          return (
            <button
              key={run.id}
              type="button"
              onClick={() => onNavigate("runs", run.id)}
              className="focus-ring flex w-full items-center gap-3 rounded-[8px] border border-[color:var(--danger)] border-opacity-20 bg-[color:var(--danger-soft)] px-4 py-3 text-left transition hover:border-opacity-40"
            >
              <XCircle size={18} className="shrink-0 text-[color:var(--danger)]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-[color:var(--text)]">{run.summary || "Run failed"}</div>
                <div className="mt-0.5 text-[11px] text-[color:var(--muted)]">
                  {agent?.name} — {run.errorMessage?.slice(0, 80) ?? "Unknown error"}
                </div>
              </div>
              <ArrowRight size={14} className="shrink-0 text-[color:var(--muted)]" />
            </button>
          );
        })}
        {urgentMessages.slice(0, 3).map((message) => {
          const sender = agents.find((agent) => agent.id === message.fromAgentId);
          return (
            <button
              key={message.id}
              type="button"
              onClick={() => onNavigate("communication", message.id)}
              className="focus-ring flex w-full items-center gap-3 rounded-[8px] border border-[color:var(--warn)] border-opacity-20 bg-[color:var(--warn-soft)] px-4 py-3 text-left transition hover:border-opacity-40"
            >
              <Users size={18} className="shrink-0 text-[color:var(--warn)]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-[color:var(--text)]">{message.subject}</div>
                <div className="mt-0.5 text-[11px] text-[color:var(--muted)]">
                  {sender?.name ?? "Unknown"} — {message.channel} {message.priority === "urgent" ? "· urgent" : ""}
                </div>
              </div>
              <ArrowRight size={14} className="shrink-0 text-[color:var(--muted)]" />
            </button>
          );
        })}
        {blockedBrowserActions.slice(0, 3).map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => onNavigate("social")}
            className="focus-ring flex w-full items-center gap-3 rounded-[8px] border border-[color:var(--warn)] border-opacity-20 bg-[color:var(--warn-soft)] px-4 py-3 text-left transition hover:border-opacity-40"
          >
            <Cpu size={18} className="shrink-0 text-[color:var(--warn)]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-[color:var(--text)]">{action.resultSummary || action.actionType}</div>
              <div className="mt-0.5 whitespace-nowrap text-[11px] text-[color:var(--muted)]">Browser action {action.status.replaceAll("_", " ")}</div>
            </div>
            <ArrowRight size={14} className="shrink-0 text-[color:var(--muted)]" />
          </button>
        ))}
        {stalledWorkflows.slice(0, 3).map((workflow) => (
          <button
            key={workflow.id}
            type="button"
            onClick={() => onNavigate("automation")}
            className="focus-ring flex w-full items-center gap-3 rounded-[8px] border border-[color:var(--warn)] border-opacity-20 bg-[color:var(--warn-soft)] px-4 py-3 text-left transition hover:border-opacity-40"
          >
            <Lightning size={18} className="shrink-0 text-[color:var(--warn)]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-[color:var(--text)]">{workflow.name}</div>
              <div className="mt-0.5 whitespace-nowrap text-[11px] text-[color:var(--muted)]">Workflow {workflow.status}</div>
            </div>
            <ArrowRight size={14} className="shrink-0 text-[color:var(--muted)]" />
          </button>
        ))}
      </div>
    </section>
  );
}
