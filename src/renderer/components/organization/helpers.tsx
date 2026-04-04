import { Heartbeat, Lightning, Trash, XCircle } from "@phosphor-icons/react";
import type { AgentRecord } from "@shared/types";
import { ActionButton, Select } from "../ui";
import { formatMoney, formatTime } from "../../lib/formatters";
import { unwrap } from "../../lib/desktop";

export function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  const overBudget = spent > budget && budget > 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[color:var(--border)]">
        <div
          className={`h-full rounded-full transition-all ${overBudget ? "bg-destructive" : "bg-success"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[11px] ${overBudget ? "text-destructive" : "text-muted-foreground"}`}>
        {formatMoney(spent)} / {formatMoney(budget)}
      </span>
    </div>
  );
}

export function ConfirmDelete({
  entityLabel,
  onConfirm,
  onCancel,
}: {
  entityLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[color:var(--destructive)] bg-destructive-muted px-4 py-3">
      <span className="text-[13px] text-destructive">Delete {entityLabel}?</span>
      <ActionButton label="Yes, delete" tone="danger" onClick={onConfirm} icon={Trash} />
      <ActionButton label="Cancel" onClick={onCancel} icon={XCircle} />
    </div>
  );
}

const HEARTBEAT_INTERVALS = [
  { value: "30", label: "30 seconds" },
  { value: "60", label: "1 minute" },
  { value: "120", label: "2 minutes" },
  { value: "300", label: "5 minutes" },
  { value: "600", label: "10 minutes" },
  { value: "1800", label: "30 minutes" },
  { value: "3600", label: "1 hour" },
];

export function HeartbeatSection({
  agent,
  companyId,
  pendingApproval,
  persistedConnectorIssue,
  onSaved,
  onWakeNow,
}: {
  agent: AgentRecord;
  companyId: string;
  pendingApproval: boolean;
  persistedConnectorIssue: string | null;
  onSaved: () => Promise<void>;
  onWakeNow?: () => void;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center gap-2">
        <Heartbeat size={16} className="text-primary" />
        <span className="text-[13px] font-semibold text-foreground">Continuous Execution</span>
      </div>
      <div className="mb-2 flex items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={agent.heartbeatEnabled}
            disabled={pendingApproval}
            onChange={(e) =>
              void (async () => {
                await window.agentCompany.setHeartbeat({ agentId: agent.id, companyId, enabled: e.target.checked, intervalSec: agent.heartbeatIntervalSec || 120 });
                await onSaved();
              })()
            }
            className="h-4 w-4 rounded border-border accent-[color:var(--primary)]"
          />
          <span className="text-[13px] text-foreground">Enable heartbeat</span>
        </label>
        {agent.heartbeatEnabled && (
          <span className="text-[11px] text-muted-foreground">
            Every {agent.heartbeatIntervalSec}s{agent.lastHeartbeatAt ? ` · Last: ${formatTime(agent.lastHeartbeatAt)}` : ""}
          </span>
        )}
      </div>
      {agent.heartbeatEnabled && (
        <Select
          label="Interval"
          value={String(agent.heartbeatIntervalSec)}
          onChange={(v) =>
            void (async () => {
              await window.agentCompany.setHeartbeat({ agentId: agent.id, companyId, enabled: true, intervalSec: Number(v) });
              await onSaved();
            })()
          }
          disabled={pendingApproval}
          options={HEARTBEAT_INTERVALS}
        />
      )}
      <div className="mt-2">
        <ActionButton
          label="Wake now"
          tone="accent"
          icon={Lightning}
          disabled={pendingApproval || !!persistedConnectorIssue}
          onClick={() =>
            void (async () => {
              if (onWakeNow) {
                onWakeNow();
                return;
              }
              unwrap(await window.agentCompany.triggerHeartbeat({ agentId: agent.id, companyId, trigger: "manual" }));
              await onSaved();
            })()
          }
        />
        {persistedConnectorIssue ? (
          <p className="mt-2 text-[12px] text-warning">
            {persistedConnectorIssue} Save a ready connector before waking this agent again.
          </p>
        ) : null}
      </div>
    </div>
  );
}
