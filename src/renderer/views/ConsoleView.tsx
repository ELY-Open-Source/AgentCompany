import { AnimatePresence, motion } from "framer-motion";
import { FolderOpen, TerminalWindow, X } from "@phosphor-icons/react";
import type { RunRecord } from "@shared/types";
import { ActionButton, Select, StatusPill } from "../components/ui";
import { formatMoney, formatTime } from "../lib/formatters";

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
                options={(() => {
                  const activeRuns = runs.filter((r) => r.summary !== "Application shut down." && r.summary !== "Worker process crashed.");
                  return activeRuns.length > 0
                    ? activeRuns.map((run) => ({ value: run.id, label: run.summary || `Run ${run.id.slice(0, 8)}` }))
                    : [{ value: "", label: t("console.noRuns") }];
                })()}
              />
              <button
                type="button"
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg p-1 text-muted-foreground transition hover:text-foreground"
                onClick={() => setConsoleOpen(false)}
                aria-label="Close console"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="grid border-t border-border xl:grid-cols-[240px_minmax(0,1fr)]">
            <div className="border-b border-border px-5 py-3 xl:border-b-0 xl:border-r">
              {selectedRun ? (
                <div className="space-y-2.5 text-[12px] text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>{t("common.status")}</span>
                    <StatusPill status={selectedRun.status} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t("common.started")}</span>
                    <span className="font-mono text-[11px]">{formatTime(selectedRun.startedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t("common.finished")}</span>
                    <span className="font-mono text-[11px]">{formatTime(selectedRun.finishedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t("common.cost")}</span>
                    <span className="font-mono text-[11px]">{formatMoney(selectedRun.costUsd)}</span>
                  </div>
                  {selectedRun.logPath ? (
                    <div className="pt-1">
                      <ActionButton label={t("common.openLog")} onClick={() => { const p = selectedRun.logPath; if (p) void openPathWithFeedback(p); }} icon={FolderOpen} />
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="py-4 text-center text-[12px] text-muted-foreground">{t("common.noRunSelected")}</div>
              )}
            </div>
            <div className="h-[200px] overflow-auto px-5 py-3">
              <pre className="font-mono whitespace-pre-wrap break-all text-[12px] leading-relaxed text-muted-foreground">
                {selectedRun ? logBufferRef.current[selectedRun.id] ?? t("common.waitingForLog") : t("common.noRunSelected")}
              </pre>
            </div>
          </div>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
