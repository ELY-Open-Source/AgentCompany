import type { AgentRecord, RunRecord, TaskRecord, WorkspaceRecord } from "@shared/types";
import { timeAgo } from "../../lib/formatters";
import { EmptyState, Input, ListFrame, ListRow, Panel, Select, StatusPill } from "../ui";
import type { TranslationFn } from "../../i18n";

interface RunQueueProps {
  filteredRuns: RunRecord[];
  selectedRun: RunRecord | null;
  taskMap: Map<string, TaskRecord>;
  agentMap: Map<string, AgentRecord>;
  workspaceMap: Map<string, WorkspaceRecord>;
  statusFilter: "all" | RunRecord["status"];
  setStatusFilter: (value: "all" | RunRecord["status"]) => void;
  search: string;
  setSearch: (value: string) => void;
  onSelectRun: (runId: string) => void;
  t: TranslationFn;
}

export function RunQueue({
  filteredRuns,
  selectedRun,
  taskMap,
  agentMap,
  workspaceMap,
  statusFilter,
  setStatusFilter,
  search,
  setSearch,
  onSelectRun,
  t,
}: RunQueueProps) {
  return (
    <div className="space-y-5">
      <Panel
        title={t("runs.runQueue")}
        action={(
          <Select
            compact
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as "all" | RunRecord["status"])}
            options={[
              { value: "all", label: "All" },
              { value: "queued", label: "Queued" },
              { value: "running", label: "Running" },
              { value: "succeeded", label: "Succeeded" },
              { value: "failed", label: "Failed" },
              { value: "timed_out", label: "Timed out" },
              { value: "cancelled", label: "Cancelled" },
              { value: "interrupted", label: "Interrupted" },
            ]}
          />
        )}
      >
        <div className="mb-4">
          <Input
            ariaLabel="Search runs"
            value={search}
            onChange={setSearch}
            placeholder={t("runs.searchRuns")}
          />
        </div>
        <ListFrame>
          {filteredRuns.map((run) => {
            const task = taskMap.get(run.taskId);
            const agent = agentMap.get(run.agentId);
            const workspace = run.workspaceId ? workspaceMap.get(run.workspaceId) : null;
            const title = task?.title ?? (run.summary || `Run ${run.id.slice(0, 8)}`);
            const supportingText = run.errorMessage || run.summary || "No summary yet";
            return (
              <ListRow
                key={run.id}
                onClick={() => onSelectRun(run.id)}
                className={selectedRun?.id === run.id ? "bg-[color:var(--accent-soft)]" : "hover:bg-[color:var(--panel-soft)]"}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-[color:var(--text)]">{title}</div>
                      <div className="mt-0.5 truncate text-[11px] text-[color:var(--muted)]">
                        {agent?.name ?? "Unknown agent"} via {run.connectorId} {workspace ? `\u00B7 ${workspace.name}` : ""}
                      </div>
                    </div>
                    <StatusPill status={run.status} />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[11px] text-[color:var(--muted)]">
                    <span className="truncate">{supportingText}</span>
                    <span className="shrink-0">{timeAgo(run.updatedAt)}</span>
                  </div>
                </div>
              </ListRow>
            );
          })}
        </ListFrame>
        {filteredRuns.length === 0 ? (
          <EmptyState
            title={t("runs.noRunsMatch")}
            detail={t("runs.noRunsMatchDetail")}
          />
        ) : null}
      </Panel>
    </div>
  );
}
