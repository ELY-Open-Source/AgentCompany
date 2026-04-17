import { useState, useEffect, useMemo, useCallback } from "react";
import { Warning, X } from "../ui/icons";
import { AnimatePresence, motion } from "framer-motion";
import type { AgentRecord, BudgetIncidentRecord, SectionId } from "@shared/types";
import { useReducedMotion } from "../ui";
import { computeBudgetAlerts, type BudgetAlert } from "../../lib/budget-alerts";

export interface BudgetAlertBannerProps {
  agents: AgentRecord[];
  onNavigate: (section: SectionId, entityId?: string) => void;
  companyId?: string;
}

export function BudgetAlertBanner({ agents, onNavigate, companyId }: BudgetAlertBannerProps) {
  const reducedMotion = useReducedMotion();
  const [dismissed, setDismissed] = useState(false);
  const [incidents, setIncidents] = useState<BudgetIncidentRecord[]>([]);

  useEffect(() => {
    if (!companyId) return;
    void (async () => {
      const result = await window.agentCompany.listBudgetIncidents({ companyId, status: "open" });
      if (result.ok) setIncidents(result.data);
    })();
  }, [companyId]);

  const alerts = useMemo<BudgetAlert[]>(
    () => computeBudgetAlerts(incidents, agents),
    [incidents, agents],
  );

  const alertKey = useMemo(
    () => alerts.map((a) => a.id).sort().join(","),
    [alerts],
  );

  useEffect(() => {
    setDismissed(false);
  }, [alertKey]);

  const handleDismiss = useCallback(() => setDismissed(true), []);
  const handleViewCosts = useCallback(() => onNavigate("costs"), [onNavigate]);

  if (alerts.length === 0) return null;
  if (dismissed) return null;

  const content = (
    <div className="space-y-2">
      {alerts.map((alert) => {
        const isDanger = alert.severity === "danger";
        const bgColor = isDanger ? "bg-destructive-muted" : "bg-warning-muted";
        const textColor = isDanger ? "text-destructive" : "text-warning";
        return (
          <div
            key={alert.id}
            role="alert"
            aria-live="assertive"
            className={`rounded-lg border border-[color:var(--destructive)] border-opacity-30 ${bgColor} px-4 py-3`}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                <Warning size={18} weight="bold" className={textColor} />
              </div>
              <div className="min-w-0 flex-1">
                <div className={`text-[13px] font-semibold ${textColor}`}>{alert.title}</div>
                <div className="mt-0.5 text-[13px] text-muted-foreground">
                  {alert.scopeLabel} — ${alert.observedUsd.toFixed(2)} / ${alert.limitUsd.toFixed(2)} ({alert.pct}%)
                </div>
                <button
                  type="button"
                  onClick={handleViewCosts}
                  className="mt-1.5 text-[11px] font-medium text-primary hover:underline cursor-pointer"
                >
                  View Costs
                </button>
              </div>
            </div>
          </div>
        );
      })}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleDismiss}
          title="Dismiss budget alerts"
          aria-label="Dismiss budget alerts"
          className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );

  if (reducedMotion) {
    return content;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        {content}
      </motion.div>
    </AnimatePresence>
  );
}
