import { useState, useEffect, useMemo, useCallback } from "react";
import { Warning, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "framer-motion";
import type { AgentRecord, SectionId } from "@shared/types";
import { useReducedMotion } from "../ui";

export interface BudgetAlertBannerProps {
  agents: AgentRecord[];
  onNavigate: (section: SectionId, entityId?: string) => void;
}

interface AgentOverThreshold {
  id: string;
  name: string;
  pct: number;
}

export function BudgetAlertBanner({ agents, onNavigate }: BudgetAlertBannerProps) {
  const reducedMotion = useReducedMotion();
  const [dismissed, setDismissed] = useState(false);

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

  // Reset dismissed state when the set of agents over threshold changes
  const overThresholdKey = useMemo(
    () => agentsOverThreshold.map((a) => a.id).sort().join(","),
    [agentsOverThreshold],
  );

  useEffect(() => {
    setDismissed(false);
  }, [overThresholdKey]);

  const handleDismiss = useCallback(() => setDismissed(true), []);
  const handleViewCosts = useCallback(() => onNavigate("costs"), [onNavigate]);

  if (agentsOverThreshold.length === 0) return null;

  const content = (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-[8px] border border-[color:var(--warn)] border-opacity-30 bg-[color:var(--warn-soft)] px-4 py-3"
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="mt-0.5 shrink-0">
          <Warning size={18} weight="bold" className="text-[color:var(--warn)]" />
        </div>

        {/* Content */}
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

        {/* Dismiss button */}
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
  );

  if (dismissed) return null;

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
