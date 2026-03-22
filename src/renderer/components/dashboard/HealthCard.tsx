import { useMemo } from "react";
import { motion } from "framer-motion";
import type {
  AgentRecord,
  AgentMessageRecord,
  ApprovalRecord,
  BrowserActionRecord,
  ConnectorRecord,
  RunRecord,
  TaskRecord,
  WorkflowPipelineRecord,
} from "@shared/types";
import { isConnectorExecutionReady } from "@shared/connector-policy";

interface HealthInputProps {
  agents: AgentRecord[];
  tasks: TaskRecord[];
  runs: RunRecord[];
  approvals: ApprovalRecord[];
  connectors: ConnectorRecord[];
  messages?: AgentMessageRecord[];
  browserActions?: BrowserActionRecord[];
  workflows?: WorkflowPipelineRecord[];
}

export function computeHealthScore(props: HealthInputProps): number {
  let score = 100;
  const { agents, tasks, runs, approvals, connectors, messages = [], browserActions = [], workflows = [] } = props;

  const failedRuns = runs.filter((r) => r.status === "failed" || r.status === "timed_out");
  score -= Math.min(failedRuns.length * 5, 25);

  const blockedTasks = tasks.filter((t) => t.status === "blocked");
  score -= Math.min(blockedTasks.length * 8, 20);

  const pendingApprovals = approvals.filter((a) => a.state === "pending");
  score -= Math.min(pendingApprovals.length * 5, 15);

  const errorAgents = agents.filter((a) => a.status === "error");
  score -= Math.min(errorAgents.length * 10, 20);

  const readyConnectors = connectors.filter((connector) => isConnectorExecutionReady(connector));
  if (readyConnectors.length === 0 && connectors.length > 0) score -= 15;

  const overBudget = agents.filter((a) => a.budgetMonthlyUsd > 0 && a.spentMonthlyUsd >= a.budgetMonthlyUsd);
  score -= Math.min(overBudget.length * 5, 10);

  const urgentMessages = messages.filter((message) => !message.readAt && (message.priority === "urgent" || message.channel === "incident"));
  score -= Math.min(urgentMessages.length * 4, 12);

  const blockedBrowserActions = browserActions.filter((action) => action.status === "approval_required" || action.status === "failed");
  score -= Math.min(blockedBrowserActions.length * 4, 12);

  const stalledWorkflows = workflows.filter((workflow) => workflow.status === "paused" || workflow.status === "failed");
  score -= Math.min(stalledWorkflows.length * 5, 15);

  return Math.max(0, Math.min(100, score));
}

function healthLabel(score: number): { label: string; tone: string } {
  if (score >= 90) return { label: "Excellent", tone: "text-[color:var(--success)]" };
  if (score >= 70) return { label: "Good", tone: "text-[color:var(--success)]" };
  if (score >= 50) return { label: "Fair", tone: "text-[color:var(--warn)]" };
  if (score >= 30) return { label: "Poor", tone: "text-[color:var(--warn)]" };
  return { label: "Critical", tone: "text-[color:var(--danger)]" };
}

export function HealthRing({ score }: { score: number }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const { label, tone } = healthLabel(score);

  const strokeColor = score >= 70
    ? "var(--success)"
    : score >= 50
      ? "var(--warn)"
      : "var(--danger)";

  return (
    <div className="flex items-center gap-5">
      <div className="relative h-[90px] w-[90px] shrink-0">
        <svg viewBox="0 0 88 88" className="h-full w-full -rotate-90">
          <circle cx="44" cy="44" r={radius} fill="none" stroke="var(--line)" strokeWidth="6" />
          <motion.circle
            cx="44"
            cy="44"
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.2, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-[22px] font-bold ${tone}`}>{score}</span>
        </div>
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Company Health</div>
        <div className={`text-[16px] font-semibold ${tone}`}>{label}</div>
      </div>
    </div>
  );
}
