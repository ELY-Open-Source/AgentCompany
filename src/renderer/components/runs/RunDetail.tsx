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
import { isActiveStatus } from "./run-helpers";
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

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="text-[13px] text-foreground">{children}</span>
    </div>
  );
}

export function RunDetail({
  selectedRun,
  taskMap,
  agentMap,
  logState,
  onOpenConsole,
  onCancelRun,
  onOpenLogPath,
  onReloadLog,
  onLoadOlderLogs,
  t,
}: RunDetailProps) {
  const task = taskMap.get(selectedRun.taskId);
  const agent = agentMap.get(selectedRun.agentId);

  return (
    <div className="space-y-6">
      <Panel
        title={task?.title ?? selectedRun.summary ?? t("runs.runDetail")}
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
        <div className="divide-y divide-[color:var(--border)]">
          <DetailRow label="Status"><StatusPill status={selectedRun.status} /></DetailRow>
          <DetailRow label="Agent">{agent?.name ?? selectedRun.agentId}</DetailRow>
          <DetailRow label="Connector">{selectedRun.connectorId}</DetailRow>
          {selectedRun.model ? <DetailRow label="Model">{selectedRun.model}</DetailRow> : null}
          <DetailRow label="Started">{formatTime(selectedRun.startedAt)}</DetailRow>
          {selectedRun.finishedAt ? <DetailRow label="Finished">{formatTime(selectedRun.finishedAt)}</DetailRow> : null}
          <DetailRow label="Cost">{formatMoney(selectedRun.costUsd)}</DetailRow>
        </div>
        {selectedRun.errorMessage ? (
          <div className="mt-4 rounded-lg border border-[color:var(--destructive)] bg-destructive-muted px-4 py-3 text-[13px] text-destructive">
            {selectedRun.errorMessage}
          </div>
        ) : null}
        {selectedRun.logPath ? (
          <div className="mt-4">
            <ActionButton
              label={t("runs.openLogFile")}
              icon={FolderOpen}
              onClick={() => { const p = selectedRun.logPath; if (p) void onOpenLogPath(p); }}
            />
          </div>
        ) : null}
      </Panel>

      <Panel
        title={t("runs.logTail")}
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
          <div className="rounded-lg border border-[color:var(--destructive)] bg-destructive-muted px-4 py-3 text-[13px] text-destructive">
            {logState.error}
          </div>
        ) : null}
        <div className="mb-3 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{logState.loading ? "Refreshing\u2026" : logState.eof ? "At latest tail" : "Tail window loaded"}</span>
        </div>
        <div className="max-h-[420px] overflow-auto rounded-lg border border-border bg-card px-4 py-3">
          <pre className="font-mono whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground">
            {logState.content || "No log output captured yet."}
          </pre>
        </div>
      </Panel>
    </div>
  );
}
