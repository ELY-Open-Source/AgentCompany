import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FolderOpen, TerminalWindow, X } from "../components/ui/icons";
import type { RunRecord } from "@shared/types";
import { ActionButton, Select, StatusPill } from "../components/ui";
import { formatMoney, formatTime } from "../lib/formatters";
import { useAppStore } from "../state/store";

// Run summaries that indicate the run is no longer active; these entries
// should not appear in the console run selector.
const SHUTDOWN_SUMMARY = "Application shut down.";
const WORKER_CRASH_SUMMARY = "Worker process crashed.";

interface ConsoleViewProps {
  consoleOpen: boolean;
  setConsoleOpen: (value: boolean) => void;
  selectedRun: RunRecord | null;
  setSelectedRunId: (id: string | null) => void;
  runs: RunRecord[];
  logBufferRef: React.RefObject<Record<string, string>>;
  openPathWithFeedback: (path: string) => Promise<void>;
  panelTransition: { duration: number; ease?: readonly [number, number, number, number] } | { duration: number };
  t: (key: string) => string;
}

export function ConsoleView({
  consoleOpen,
  setConsoleOpen,
  selectedRun,
  setSelectedRunId,
  runs,
  logBufferRef,
  openPathWithFeedback,
  panelTransition,
  t,
}: ConsoleViewProps) {
  const logRevision = useAppStore((s) => s.logRevision);
  const logBuffer = useMemo(
    () => (selectedRun ? logBufferRef.current[selectedRun.id] ?? "" : ""),
    // logRevision is intentionally part of deps: it bumps on every run-log
    // push into the ref, forcing this memo (and this component) to re-evaluate
    // the ref contents on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedRun, logRevision, logBufferRef],
  );
  const runSelectOptions = useMemo(() => {
    const activeRuns = runs.filter(
      (run) => run.summary !== SHUTDOWN_SUMMARY && run.summary !== WORKER_CRASH_SUMMARY,
    );
    return activeRuns.length > 0
      ? activeRuns.map((run) => ({ value: run.id, label: run.summary || `Run ${run.id.slice(0, 8)}` }))
      : [{ value: "", label: t("console.noRuns") }];
  }, [runs, t]);
  return (
    <AnimatePresence>
      {consoleOpen ? (
        <motion.section
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={panelTransition}
          className="shrink-0 overflow-hidden border-t border-border bg-card"
        >
          <div className="flex items-center justify-between px-5 py-2.5">
            <div className="flex items-center gap-3">
              <TerminalWindow size={15} className="text-muted-foreground" />
              <span className="text-[13px] font-semibold text-foreground">{t("console.title")}</span>
            </div>
            <div className="flex items-center gap-3">
              <Select
                compact
                value={selectedRun?.id ?? ""}
                onChange={setSelectedRunId}
                options={runSelectOptions}
              />
              <button
                type="button"
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg p-1 text-muted-foreground transition hover:text-foreground"
                onClick={() => setConsoleOpen(false)}
                aria-label={t("console.close")}
              >
                <X size={14} />
              </button>
            </div>
          </div>
          {selectedRun ? (
            <div className="grid border-t border-border xl:grid-cols-[240px_minmax(0,1fr)]">
              <div className="border-b border-border px-5 py-3 xl:border-b-0 xl:border-r">
                <div className="space-y-2.5 text-[12px] text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>{t("common.status")}</span>
                    <StatusPill status={selectedRun.status} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t("common.started")}</span>
                    <span className="font-mono text-[11px] text-foreground">{formatTime(selectedRun.startedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t("common.finished")}</span>
                    <span className="font-mono text-[11px] text-foreground">{formatTime(selectedRun.finishedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t("common.cost")}</span>
                    <span className="font-mono text-[11px] text-foreground">{formatMoney(selectedRun.costUsd)}</span>
                  </div>
                  {selectedRun.logPath ? (
                    <div className="pt-1">
                      <ActionButton label={t("common.openLog")} onClick={() => { const p = selectedRun.logPath; if (p) void openPathWithFeedback(p); }} icon={FolderOpen} />
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="h-[200px] overflow-auto px-5 py-3">
                <pre className="font-mono whitespace-pre-wrap break-all text-[12px] leading-relaxed text-foreground/90">
                  {logBuffer || t("common.waitingForLog")}
                </pre>
              </div>
            </div>
          ) : (
            <div className="flex h-[200px] items-center justify-center border-t border-border">
              <div className="text-center text-[12px] text-muted-foreground">{t("common.noRunSelected")}</div>
            </div>
          )}
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
