import {
  ArrowClockwise,
  FolderOpen,
  Lightning,
  ListChecks,
  WarningCircle,
} from "@phosphor-icons/react";
import type { AgentRecord, RunRecord, TaskRecord, WorkspaceRecord } from "@shared/types";
import { formatMoney, formatTime } from "../../lib/formatters";
import { ActionButton, Panel, StatusPill } from "../ui";
import type { TranslationFn } from "../../i18n";
import { RunMeta, isActiveStatus } from "./run-helpers";
import type { RunLogState } from "./run-helpers";

interface RunDetailProps {
  selectedRun: RunRecord;
  taskMap: Map<string, TaskRecord>;
  agentMap: Map<string, AgentRecord>;
  workspaceMap: Map<string, WorkspaceRecord>;
  logState: RunLogState;
  onOpenConsole: (runId: string) => void;
  onCancelRun: (runId: string) => Promise<void> | void;
  onOpenLogPath: (path: string) => Promise<void> | void;
  onReloadLog: () => void;
  onLoadOlderLogs: () => void;
  t: TranslationFn;
}

export function RunDetail({
  selectedRun,
  taskMap,
  agentMap,
  workspaceMap,
  logState,
  onOpenConsole,
  onCancelRun,
  onOpenLogPath,
  onReloadLog,
  onLoadOlderLogs,
  t,
}: RunDetailProps) {
  return (
    <div className="space-y-6">
      <Panel
        title={t("runs.runDetail")}
        action={(
          <div className="flex items-center gap-2">
            <ActionButton
              label={t("runs.openConsole")}
              icon={Lightning}
              onClick={() => onOpenConsole(selectedRun.id)}
            />
            {isActiveStatus(selectedRun.status) ? (
              <ActionButton
                label={t("runs.cancelRun")}
                tone="danger"
                icon={WarningCircle}
                onClick={() => void onCancelRun(selectedRun.id)}
              />
            ) : null}
          </div>
        )}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <RunMeta label="Status" value={<StatusPill status={selectedRun.status} />} />
          <RunMeta label="Connector" value={selectedRun.connectorId} />
          <RunMeta label="Task" value={taskMap.get(selectedRun.taskId)?.title ?? selectedRun.taskId} />
          <RunMeta label="Agent" value={agentMap.get(selectedRun.agentId)?.name ?? selectedRun.agentId} />
          <RunMeta label="Workspace" value={selectedRun.workspaceId ? (workspaceMap.get(selectedRun.workspaceId)?.name ?? selectedRun.workspaceId) : "No exclusive workspace lock"} />
          <RunMeta label="Model" value={selectedRun.model ?? "Connector default"} />
          <RunMeta label="Started" value={formatTime(selectedRun.startedAt)} />
          <RunMeta label="Finished" value={formatTime(selectedRun.finishedAt)} />
          <RunMeta label="Cost" value={formatMoney(selectedRun.costUsd)} />
          <RunMeta label="Log bytes" value={logState.totalBytes.toLocaleString()} />
        </div>
        {selectedRun.errorMessage ? (
          <div className="mt-5 rounded-[10px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-[color:var(--danger)]">
            {selectedRun.errorMessage}
          </div>
        ) : null}
        {selectedRun.logPath ? (
          <div className="mt-5">
            <ActionButton
              label={t("runs.openLogFile")}
              icon={FolderOpen}
              onClick={() => void onOpenLogPath(selectedRun.logPath!)}
            />
          </div>
        ) : null}
      </Panel>

      <Panel
        title={t("runs.logTail")}
        eyebrow={t("runs.incrementalReader")}
        action={(
          <div className="flex items-center gap-2">
            <ActionButton
              label={t("runs.reloadTail")}
              icon={ArrowClockwise}
              onClick={onReloadLog}
            />
            {logState.offset > 0 ? (
              <ActionButton
                label={t("runs.loadOlder")}
                icon={ListChecks}
                onClick={onLoadOlderLogs}
                disabled={logState.loading}
              />
            ) : null}
          </div>
        )}
      >
        {logState.error ? (
          <div className="rounded-[10px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-[color:var(--danger)]">
            {logState.error}
          </div>
        ) : null}
        <div className="mb-3 flex items-center justify-between text-[11px] text-[color:var(--muted)]">
          <span>
            Showing bytes {logState.offset.toLocaleString()} to {logState.nextOffset.toLocaleString()} of {logState.totalBytes.toLocaleString()}
          </span>
          <span>{logState.loading ? "Refreshing\u2026" : logState.eof ? "At latest tail" : "Tail window loaded"}</span>
        </div>
        <div className="max-h-[420px] overflow-auto rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3">
          <pre className="mono whitespace-pre-wrap text-[12px] leading-relaxed text-[color:var(--muted-strong)]">
            {logState.content || "No log output captured yet."}
          </pre>
        </div>
      </Panel>
    </div>
  );
}
