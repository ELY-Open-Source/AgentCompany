import { Heartbeat, Lightning, Trash, XCircle } from "@phosphor-icons/react";
import type { AgentRecord } from "@shared/types";
import { ActionButton, Select } from "../ui";
import { formatMoney, formatTime } from "../../lib/formatters";

export function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  const overBudget = spent > budget && budget > 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[color:var(--line)]">
        <div
          className={`h-full rounded-full transition-all ${overBudget ? "bg-[color:var(--danger)]" : "bg-[color:var(--success)]"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[11px] ${overBudget ? "text-[color:var(--danger)]" : "text-[color:var(--muted)]"}`}>
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
    <div className="flex items-center gap-3 rounded-[8px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-4 py-3">
      <span className="text-[13px] text-[color:var(--danger)]">Delete {entityLabel}?</span>
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
}: {
  agent: AgentRecord;
  companyId: string;
  pendingApproval: boolean;
  persistedConnectorIssue: string | null;
  onSaved: () => Promise<void>;
}) {
  return (
    <div className="rounded-lg border border-[color:var(--line)] p-3">
      <div className="mb-2 flex items-center gap-2">
        <Heartbeat size={16} className="text-[color:var(--accent)]" />
        <span className="text-[13px] font-semibold text-[color:var(--text)]">Continuous Execution</span>
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
            className="h-4 w-4 rounded border-[color:var(--line)] accent-[color:var(--accent)]"
          />
          <span className="text-[13px] text-[color:var(--text)]">Enable heartbeat</span>
        </label>
        {agent.heartbeatEnabled && (
          <span className="text-[11px] text-[color:var(--muted)]">
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
              await window.agentCompany.triggerHeartbeat({ agentId: agent.id, companyId, trigger: "manual" });
              await onSaved();
            })()
          }
        />
        {persistedConnectorIssue ? (
          <p className="mt-2 text-[12px] text-[color:var(--warn)]">
            {persistedConnectorIssue} Save a ready connector before waking this agent again.
          </p>
        ) : null}
      </div>
    </div>
  );
}
