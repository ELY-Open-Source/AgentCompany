import {
  ArrowSquareOut,
  ClockCounterClockwise,
  Robot,
} from "@phosphor-icons/react";
import type { BrowserActionRecord } from "@shared/types";
import { timeAgo } from "../../lib/formatters";
import { actionTypeLabels } from "./social-config";

interface ActionHistoryProps {
  actions: BrowserActionRecord[];
  agents: Array<{ id: string; name: string }>;
  onOpenPath: (path: string) => Promise<void>;
  onCancelAction: (actionId: string) => Promise<void>;
  onNavigate: (section: "tasks" | "approvals", entityId: string) => void;
}

export function ActionHistory({ actions, agents, onOpenPath, onCancelAction, onNavigate }: ActionHistoryProps) {
  if (actions.length === 0) {
    return (
      <div className="py-8 text-center text-[13px] text-[color:var(--muted)]">
        No browser actions yet
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {actions.slice(0, 30).map((action) => {
        const config = actionTypeLabels[action.actionType] ?? actionTypeLabels.custom_script;
        const Icon = config.icon;
        const agent = agents.find((a) => a.id === action.agentId);
        const isSuccess = action.status === "succeeded";
        const isFailed = action.status === "failed";
        const isRunning = action.status === "running";

        return (
          <div
            key={action.id}
            className="flex items-center gap-3 rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-2.5 text-[12px]"
          >
            <Icon size={16} className={
              isSuccess ? "text-[color:var(--success)]"
              : isFailed ? "text-[color:var(--danger)]"
              : isRunning ? "text-[color:var(--accent)]"
              : "text-[color:var(--muted)]"
            } />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[color:var(--text)]">{config.label}</span>
                {agent ? (
                  <span className="flex items-center gap-1 text-[color:var(--muted)]">
                    <Robot size={10} />
                    {agent.name}
                  </span>
                ) : null}
              </div>
              {action.resultSummary ? (
                <div className="mt-0.5 truncate text-[11px] text-[color:var(--muted)]">{action.resultSummary}</div>
              ) : null}
              {action.errorMessage ? (
                <div className="mt-0.5 truncate text-[11px] text-[color:var(--danger)]">{action.errorMessage}</div>
              ) : null}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {action.taskId ? (
                  <button
                    type="button"
                    onClick={() => onNavigate("tasks", action.taskId!)}
                    className="rounded-[5px] bg-[color:var(--panel-soft)] px-2 py-1 text-[10px] font-medium text-[color:var(--muted-strong)] transition hover:text-[color:var(--text)]"
                  >
                    Open task
                  </button>
                ) : null}
                {action.approvalId ? (
                  <button
                    type="button"
                    onClick={() => onNavigate("approvals", action.approvalId!)}
                    className="rounded-[5px] bg-[color:var(--panel-soft)] px-2 py-1 text-[10px] font-medium text-[color:var(--muted-strong)] transition hover:text-[color:var(--text)]"
                  >
                    Open approval
                  </button>
                ) : null}
                {action.screenshotPath ? (
                  <button
                    type="button"
                    onClick={() => void onOpenPath(action.screenshotPath!)}
                    className="inline-flex items-center gap-1 rounded-[5px] bg-[color:var(--panel-soft)] px-2 py-1 text-[10px] font-medium text-[color:var(--muted-strong)] transition hover:text-[color:var(--text)]"
                  >
                    <ArrowSquareOut size={10} />
                    Screenshot
                  </button>
                ) : null}
                {["queued", "running", "approval_required"].includes(action.status) ? (
                  <button
                    type="button"
                    onClick={() => void onCancelAction(action.id)}
                    className="inline-flex items-center gap-1 rounded-[5px] bg-[color:var(--danger-soft)] px-2 py-1 text-[10px] font-medium text-[color:var(--danger)] transition hover:brightness-95"
                  >
                    <ClockCounterClockwise size={10} />
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
            <div className="shrink-0 text-[10px] text-[color:var(--muted)]">
              {timeAgo(action.createdAt)}
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${
              isSuccess ? "bg-[color:var(--success-soft)] text-[color:var(--success)]"
              : isFailed ? "bg-[color:var(--danger-soft)] text-[color:var(--danger)]"
              : isRunning ? "bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
              : action.status === "approval_required" ? "bg-[color:var(--warn-soft)] text-[color:var(--warn)]"
              : "bg-[color:var(--panel-soft)] text-[color:var(--muted)]"
            }`}>
              {action.status.replace("_", " ")}
            </span>
          </div>
        );
      })}
    </div>
  );
}
