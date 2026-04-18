import { useState } from "react";
import {
  ArrowRight,
  X,
} from "../ui/icons";
import type { AgentRecord, ApprovalRecord } from "@shared/types";
import { useT } from "../../i18n";
import { getAgentInitials } from "../../lib/formatters";
import { safeJson } from "../../lib/safe-json";
import { ActionButton, EmptyState, Panel, StatusPill } from "../ui";
import {
  type HiringStage,
  type HiringCandidate,
  getHiringStage,
  stageColor,
  STAGE_ORDER,
} from "./hiring-helpers";

interface HiringPipelineProps {
  agents: AgentRecord[];
  approvals: ApprovalRecord[];
  onNavigateToAgent: (agentId: string) => void;
}

export function HiringPipeline({ agents, approvals, onNavigateToAgent }: HiringPipelineProps) {
  const t = useT();
  const [filterStage, setFilterStage] = useState<HiringStage | "all">("all");

  const stageLabelMap: Record<HiringStage, string> = {
    requisition: t("hiring.requisition"),
    pending_approval: t("hiring.pendingApproval"),
    approved: t("hiring.approved"),
    onboarding: t("hiring.onboarding"),
    active: t("hiring.active"),
    rejected: t("status.rejected"),
  };

  const hireApprovals = approvals.filter(a => a.type === "hire_agent");

  const candidates: HiringCandidate[] = agents.map(agent => {
    const approval = hireApprovals.find(a => {
      if (a.relatedAgentId === agent.id) return true;
      if (!a.payloadJson) return false;
      const payload = safeJson<{ agentId?: string }>(a.payloadJson, {});
      return payload.agentId === agent.id;
    }) ?? null;
    return {
      agent,
      approval,
      stage: getHiringStage(agent, approval),
    };
  });

  const pendingHireApprovals = hireApprovals.filter(a => {
    return a.state === "pending" && !candidates.some(c => c.approval?.id === a.id);
  });

  const allCandidates = [
    ...candidates,
    ...pendingHireApprovals.map(a => ({
      agent: null,
      approval: a,
      stage: "pending_approval" as HiringStage,
    })),
  ].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));

  const filteredCandidates = filterStage === "all"
    ? allCandidates
    : allCandidates.filter(c => c.stage === filterStage);

  const stageCounts = STAGE_ORDER.reduce((acc, stage) => {
    acc[stage] = allCandidates.filter(c => c.stage === stage).length;
    return acc;
  }, {} as Record<HiringStage, number>);

  const activeHires = allCandidates.filter(c => c.stage !== "active" && c.stage !== "rejected").length;

  return (
    <div className="space-y-4">
      <Panel title={t("hiring.title")} eyebrow={`${activeHires} ${t("hiring.activeProcesses")}`}>
        <div className="flex items-center gap-1 px-4 py-3 overflow-x-auto">
          {STAGE_ORDER.filter(s => s !== "rejected").map((stage, idx) => (
            <div key={stage} className="flex items-center gap-1">
              <button
                onClick={() => setFilterStage(filterStage === stage ? "all" : stage)}
                className={`px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  filterStage === stage ? "ring-1 ring-[color:var(--primary)]/40 bg-muted" : "hover:bg-muted"
                } ${stageColor(stage)}`}
              >
                {stageLabelMap[stage]}
                <span className="ml-1.5 inline-flex items-center justify-center h-5 w-5 rounded-full bg-[color:var(--border)] text-[10px]">
                  {stageCounts[stage]}
                </span>
              </button>
              {idx < STAGE_ORDER.length - 2 && (
                <ArrowRight size={12} className="text-muted-foreground flex-shrink-0" />
              )}
            </div>
          ))}
          {stageCounts.rejected > 0 && (
            <button
              onClick={() => setFilterStage(filterStage === "rejected" ? "all" : "rejected")}
              className={`ml-4 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                filterStage === "rejected" ? "ring-1 ring-[color:var(--destructive)]/40 bg-muted" : "hover:bg-muted"
              } ${stageColor("rejected")}`}
            >
              {stageLabelMap.rejected}
              <span className="ml-1.5 inline-flex items-center justify-center h-5 w-5 rounded-full bg-[color:var(--border)] text-[10px]">
                {stageCounts.rejected}
              </span>
            </button>
          )}
        </div>
      </Panel>

      <Panel
        title={filterStage === "all" ? t("hiring.allAgents") : `${stageLabelMap[filterStage]} (${filteredCandidates.length})`}
        action={
          filterStage !== "all" ? (
            <ActionButton label={t("hiring.allAgents")} icon={X} onClick={() => setFilterStage("all")} />
          ) : undefined
        }
      >
        {filteredCandidates.length === 0 ? (
          <EmptyState title={t("panel.noData")} />
        ) : (
          <div className="divide-y divide-[color:var(--border)]">
            {filteredCandidates.map((candidate) => {
              const ag = candidate.agent;
              if (!ag) return null;
              const manager = agents.find(a => a.id === ag.reportsTo);
              const approvalRequestedBy = candidate.approval?.requestedByAgentId ?? null;
              const requestedBy = approvalRequestedBy
                ? agents.find(a => a.id === approvalRequestedBy)
                : null;
              return (
                <div
                  key={ag.id}
                  className="px-4 py-3 flex items-center gap-3 hover:bg-muted cursor-pointer transition-colors"
                  onClick={() => onNavigateToAgent(ag.id)}
                >
                  <div className="flex-shrink-0 h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                    {getAgentInitials(ag.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-foreground truncate">{ag.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${stageColor(candidate.stage)}`}>
                        {stageLabelMap[candidate.stage]}
                      </span>
                      <StatusPill status={ag.status} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {ag.role} — {ag.title}{ag.department ? ` | ${ag.department}` : ""}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-xs text-muted-foreground">
                      {manager ? `${t("hiring.reportsTo")} ${manager.name}` : t("hiring.topLevel")}
                    </div>
                    {requestedBy && (
                      <div className="text-[10px] text-muted-foreground">{t("hiring.proposedBy")} {requestedBy.name}</div>
                    )}
                    <div className="text-xs text-muted-foreground">${ag.budgetMonthlyUsd}/mo</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

    </div>
  );
}
