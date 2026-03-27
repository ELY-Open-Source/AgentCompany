import { useState, useEffect, useMemo, useCallback } from "react";
import { Warning, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "framer-motion";
import type { AgentRecord, BudgetIncidentRecord, SectionId } from "@shared/types";
import { useReducedMotion } from "../ui";

export interface BudgetAlertBannerProps {
  agents: AgentRecord[];
  onNavigate: (section: SectionId, entityId?: string) => void;
  companyId?: string;
}

interface AgentOverThreshold {
  id: string;
  name: string;
  pct: number;
}

export function BudgetAlertBanner({ agents, onNavigate, companyId }: BudgetAlertBannerProps) {
  const reducedMotion = useReducedMotion();
  const [dismissed, setDismissed] = useState(false);
  const [incidents, setIncidents] = useState<BudgetIncidentRecord[]>([]);

  // Load policy-based incidents when companyId is provided
  useEffect(() => {
    if (!companyId) return;
    void (async () => {
      const result = await window.agentCompany.listBudgetIncidents({ companyId, status: "open" });
      if (result.ok) setIncidents(result.data);
    })();
  }, [companyId]);

  // Fallback: agent-level threshold detection (existing logic)
  const agentsOverThreshold = useMemo<AgentOverThreshold[]>(() => {
    return agents
      .filter((a) => a.budgetMonthlyUsd > 0 && a.spentMonthlyUsd / a.budgetMonthlyUsd >= 0.8)
      .map((a) => ({
        id: a.id,
        name: a.name,
        pct: Math.round((a.spentMonthlyUsd / a.budgetMonthlyUsd) * 100),
      }))
      .sort((a, b) => b.pct - a.pct);
  }, [agents]);

  // Determine whether to use policy-based or agent-based alerts
  const usePolicyAlerts = companyId && incidents.length > 0;

  // Reset dismissed state when the set of alerts changes
  const alertKey = useMemo(() => {
    if (usePolicyAlerts) {
      return incidents.map((i) => i.id).sort().join(",");
    }
    return agentsOverThreshold.map((a) => a.id).sort().join(",");
  }, [usePolicyAlerts, incidents, agentsOverThreshold]);

  useEffect(() => {
    setDismissed(false);
  }, [alertKey]);

  const handleDismiss = useCallback(() => setDismissed(true), []);
  const handleViewCosts = useCallback(() => onNavigate("costs"), [onNavigate]);

  // Nothing to show
  if (!usePolicyAlerts && agentsOverThreshold.length === 0) return null;
  if (dismissed) return null;

  function getScopeName(scopeType: string, scopeId: string): string {
    if (scopeType === "company") return "Company";
    if (scopeType === "agent") {
      const agent = agents.find((a) => a.id === scopeId);
      return agent ? agent.name : scopeId.slice(0, 8);
    }
    return scopeId.slice(0, 8);
  }

  // Policy-based alert content
  const policyContent = usePolicyAlerts ? (
    <div className="space-y-2">
      {incidents.map((incident) => {
        const isHardStop = incident.thresholdType === "hard_stop";
        const borderColor = isHardStop ? "border-[color:var(--danger)]" : "border-[color:var(--warn)]";
        const bgColor = isHardStop ? "bg-[color:var(--danger-soft)]" : "bg-[color:var(--warn-soft)]";
        const textColor = isHardStop ? "text-[color:var(--danger)]" : "text-[color:var(--warn)]";
        const pct = incident.amountLimit > 0 ? Math.round((incident.amountObserved / incident.amountLimit) * 100) : 0;

        return (
          <div
            key={incident.id}
            role="alert"
            aria-live="assertive"
            className={`rounded-[8px] border ${borderColor} border-opacity-30 ${bgColor} px-4 py-3`}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                <Warning size={18} weight="bold" className={textColor} />
              </div>
              <div className="min-w-0 flex-1">
                <div className={`text-[13px] font-semibold ${textColor}`}>
                  {isHardStop ? "Budget Hard Stop" : "Budget Warning"}
                </div>
                <div className="mt-0.5 text-[13px] text-[color:var(--muted-strong)]">
                  {getScopeName(incident.scopeType, incident.scopeId)} — ${(incident.amountObserved / 100).toFixed(2)} / ${(incident.amountLimit / 100).toFixed(2)} ({pct}%)
                </div>
                <button
                  type="button"
                  onClick={handleViewCosts}
                  className="mt-1.5 text-[11px] font-medium text-[color:var(--accent)] hover:underline cursor-pointer"
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
          className="shrink-0 rounded p-0.5 text-[color:var(--muted-strong)] transition hover:text-[color:var(--text)]"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  ) : null;

  // Fallback agent-level alert content (existing logic)
  const agentContent = !usePolicyAlerts ? (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-[8px] border border-[color:var(--warn)] border-opacity-30 bg-[color:var(--warn-soft)] px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          <Warning size={18} weight="bold" className="text-[color:var(--warn)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[color:var(--warn)]">
            Budget Alert
          </div>
          <div className="mt-0.5 text-[13px] text-[color:var(--muted-strong)]">
            {agentsOverThreshold.length} agent(s) approaching budget limit
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {agentsOverThreshold.map((agent) => (
              <span
                key={agent.id}
                className={`whitespace-nowrap text-[11px] font-[family-name:var(--font-mono)] ${
                  agent.pct >= 100
                    ? "text-[color:var(--danger)]"
                    : "text-[color:var(--warn)]"
                }`}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {agent.name} ({agent.pct}%)
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={handleViewCosts}
            className="mt-1.5 text-[11px] font-medium text-[color:var(--accent)] hover:underline cursor-pointer"
          >
            View Costs
          </button>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          title="Dismiss budget alert"
          aria-label="Dismiss budget alert"
          className="shrink-0 rounded p-0.5 text-[color:var(--muted-strong)] transition hover:text-[color:var(--text)]"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  ) : null;

  const content = usePolicyAlerts ? policyContent : agentContent;

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
