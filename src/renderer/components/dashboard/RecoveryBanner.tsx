import { useState, useEffect } from "react";
import { Warning, ArrowClockwise, X, Trash } from "@phosphor-icons/react";

interface InterruptedRun {
  runId: string;
  taskId: string;
  taskTitle: string;
  agentId: string;
  agentName: string;
  connectorId: string;
  interruptedAt: string;
}

export function RecoveryBanner() {
  const [runs, setRuns] = useState<InterruptedRun[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const unsubscribe = window.agentCompany?.subscribe?.((event: any) => {
      if (event.type === "recovery-needed" && event.interruptedRuns) {
        setRuns(event.interruptedRuns);
      }
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  if (runs.length === 0 || dismissed) return null;

  const handleRetry = async (run: InterruptedRun) => {
    await window.agentCompany?.recoveryRetry(run.taskId, run.agentId, "");
    setRuns(prev => prev.filter(r => r.runId !== run.runId));
  };

  const handleFail = async (run: InterruptedRun) => {
    await window.agentCompany?.recoveryFail(run.taskId);
    setRuns(prev => prev.filter(r => r.runId !== run.runId));
  };

  const handleDismissAll = () => setDismissed(true);

  return (
    <div className="bg-[color:var(--warn-soft)] border border-[color:var(--warn)]/30 rounded-[8px] px-4 py-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-[color:var(--warn)] font-medium">
          <Warning size={18} weight="bold" />
          <span>{runs.length} interrupted task(s) detected from previous session</span>
        </div>
        <button onClick={handleDismissAll} className="text-[color:var(--muted-strong)] hover:text-[color:var(--text)] transition-colors" aria-label="Dismiss recovery banner">
          <X size={16} />
        </button>
      </div>
      <div className="space-y-2">
        {runs.map(run => (
          <div key={run.runId} className="flex items-center justify-between bg-[color:var(--panel-soft)] rounded-[4px] px-3 py-2 text-[13px]">
            <div className="min-w-0 flex-1">
              <span className="truncate text-[color:var(--text)]">{run.taskTitle}</span>
              <span className="whitespace-nowrap text-[color:var(--muted)] ml-2">({run.agentName})</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleRetry(run)}
                className="flex items-center gap-1 text-[color:var(--success)] hover:text-[color:var(--success)] text-xs transition-colors"
              >
                <ArrowClockwise size={14} /> Retry
              </button>
              <button
                onClick={() => handleFail(run)}
                className="flex items-center gap-1 text-[color:var(--danger)] hover:text-[color:var(--danger)] text-xs transition-colors"
              >
                <Trash size={14} /> Cancel
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
