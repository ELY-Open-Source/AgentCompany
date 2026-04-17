import {
  ArrowSquareOut,
  ClockCounterClockwise,
  Robot,
} from "../ui/icons";
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
      <div className="py-8 text-center text-[13px] text-muted-foreground">
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
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-[12px]"
          >
            <Icon size={16} className={
              isSuccess ? "text-success"
              : isFailed ? "text-destructive"
              : isRunning ? "text-primary"
              : "text-muted-foreground"
            } />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">{config.label}</span>
                {agent ? (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Robot size={10} />
                    {agent.name}
                  </span>
                ) : null}
              </div>
              {action.resultSummary ? (
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{action.resultSummary}</div>
              ) : null}
              {action.errorMessage ? (
                <div className="mt-0.5 truncate text-[11px] text-destructive">{action.errorMessage}</div>
              ) : null}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {action.taskId ? (
                  <button
                    type="button"
                    onClick={() => { const id = action.taskId; if (id) onNavigate("tasks", id); }}
                    className="rounded-[5px] bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground transition hover:text-foreground"
                  >
                    Open task
                  </button>
                ) : null}
                {action.approvalId ? (
                  <button
                    type="button"
                    onClick={() => { const id = action.approvalId; if (id) onNavigate("approvals", id); }}
                    className="rounded-[5px] bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground transition hover:text-foreground"
                  >
                    Open approval
                  </button>
                ) : null}
                {action.screenshotPath ? (
                  <button
                    type="button"
                    onClick={() => { const p = action.screenshotPath; if (p) void onOpenPath(p); }}
                    className="inline-flex items-center gap-1 rounded-[5px] bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground transition hover:text-foreground"
                  >
                    <ArrowSquareOut size={10} />
                    Screenshot
                  </button>
                ) : null}
                {["queued", "running", "approval_required"].includes(action.status) ? (
                  <button
                    type="button"
                    onClick={() => void onCancelAction(action.id)}
                    className="inline-flex items-center gap-1 rounded-[5px] bg-destructive-muted px-2 py-1 text-[10px] font-medium text-destructive transition hover:brightness-95"
                  >
                    <ClockCounterClockwise size={10} />
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
            <div className="shrink-0 text-[10px] text-muted-foreground">
              {timeAgo(action.createdAt)}
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${
              isSuccess ? "bg-success-muted text-success"
              : isFailed ? "bg-destructive-muted text-destructive"
              : isRunning ? "bg-accent text-primary"
              : action.status === "approval_required" ? "bg-warning-muted text-warning"
              : "bg-muted text-muted-foreground"
            }`}>
              {action.status.replace("_", " ")}
            </span>
          </div>
        );
      })}
    </div>
  );
}
