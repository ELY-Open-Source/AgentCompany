import { useState } from "react";
import {
  ArrowRight,
  Check,
  UserPlus,
  X,
} from "@phosphor-icons/react";
import type { AgentRecord, ApprovalRecord } from "@shared/types";
import { useT } from "../../i18n";
import { getAgentInitials } from "../../lib/formatters";
import { unwrap } from "../../lib/desktop";
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
  onRefresh: () => Promise<void>;
  onNavigateToAgent: (agentId: string) => void;
}

export function HiringPipeline({ agents, approvals, onRefresh, onNavigateToAgent }: HiringPipelineProps) {
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
      try { return JSON.parse(a.payloadJson).agentId === agent.id; } catch { return false; }
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

  const pendingCount = stageCounts.requisition + stageCounts.pending_approval;
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
                  filterStage === stage ? "ring-1 ring-[color:var(--accent)]/40 bg-[color:var(--panel-soft)]" : "hover:bg-[color:var(--panel-soft)]"
                } ${stageColor(stage)}`}
              >
                {stageLabelMap[stage]}
                <span className="ml-1.5 inline-flex items-center justify-center h-5 w-5 rounded-full bg-[color:var(--line)] text-[10px]">
                  {stageCounts[stage]}
                </span>
              </button>
              {idx < STAGE_ORDER.length - 2 && (
                <ArrowRight size={12} className="text-[color:var(--muted)] flex-shrink-0" />
              )}
            </div>
          ))}
          {stageCounts.rejected > 0 && (
            <button
              onClick={() => setFilterStage(filterStage === "rejected" ? "all" : "rejected")}
              className={`ml-4 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                filterStage === "rejected" ? "ring-1 ring-[color:var(--danger)]/40 bg-[color:var(--panel-soft)]" : "hover:bg-[color:var(--panel-soft)]"
              } ${stageColor("rejected")}`}
            >
              {stageLabelMap.rejected}
              <span className="ml-1.5 inline-flex items-center justify-center h-5 w-5 rounded-full bg-[color:var(--line)] text-[10px]">
                {stageCounts.rejected}
              </span>
            </button>
          )}
        </div>
      </Panel>

      {pendingCount > 0 && (
        <Panel title={t("hiring.pendingApproval")}>
          <div className="divide-y divide-[color:var(--line)]">
            {allCandidates
              .filter(c => c.stage === "requisition" || c.stage === "pending_approval")
              .map((candidate) => {
                const a = candidate.approval;
                const ag = candidate.agent;
                return (
                  <div key={a?.id ?? ag?.id} className="px-4 py-3 flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5 h-8 w-8 rounded-full bg-[color:var(--warn-soft)] flex items-center justify-center">
                      <UserPlus size={16} className="text-[color:var(--warn)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-[color:var(--text)]">{ag?.name ?? t("hiring.pendingHires")}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${stageColor(candidate.stage)}`}>
                          {stageLabelMap[candidate.stage]}
                        </span>
                      </div>
                      <div className="text-xs text-[color:var(--muted)] mt-0.5">
                        {ag ? `${ag.role} — ${ag.title}` : a?.payloadSummary}
                      </div>
                      {ag?.capabilities && (
                        <div className="text-xs text-[color:var(--muted)] mt-1 line-clamp-2">{ag.capabilities}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {a && a.state === "pending" && (
                        <>
                          <ActionButton
                            label={t("hiring.approved")}
                            icon={Check}
                            tone="accent"
                            onClick={async () => {
                              unwrap(await window.agentCompany.decideApproval({
                                companyId: a.companyId,
                                approvalId: a.id,
                                state: "approved",
                                decisionNote: "Hire approved via hiring pipeline",
                              }));
                              await onRefresh();
                            }}
                          />
                          <ActionButton
                            label={t("status.rejected")}
                            icon={X}
                            tone="danger"
                            onClick={async () => {
                              unwrap(await window.agentCompany.decideApproval({
                                companyId: a.companyId,
                                approvalId: a.id,
                                state: "rejected",
                                decisionNote: "Hire rejected via hiring pipeline",
                              }));
                              await onRefresh();
                            }}
                          />
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </Panel>
      )}

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
          <div className="divide-y divide-[color:var(--line)]">
            {filteredCandidates.map((candidate) => {
              const ag = candidate.agent;
              if (!ag) return null;
              const manager = agents.find(a => a.id === ag.reportsTo);
              const requestedBy = candidate.approval?.requestedByAgentId
                ? agents.find(a => a.id === candidate.approval!.requestedByAgentId)
                : null;
              return (
                <div
                  key={ag.id}
                  className="px-4 py-3 flex items-center gap-3 hover:bg-[color:var(--panel-soft)] cursor-pointer transition-colors"
                  onClick={() => onNavigateToAgent(ag.id)}
                >
                  <div className="flex-shrink-0 h-8 w-8 rounded-full bg-[color:var(--panel-soft)] flex items-center justify-center text-xs font-bold text-[color:var(--muted-strong)]">
                    {getAgentInitials(ag.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-[color:var(--text)] truncate">{ag.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${stageColor(candidate.stage)}`}>
                        {stageLabelMap[candidate.stage]}
                      </span>
                      <StatusPill status={ag.status} />
                    </div>
                    <div className="text-xs text-[color:var(--muted)] mt-0.5">
                      {ag.role} — {ag.title}{ag.department ? ` | ${ag.department}` : ""}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-xs text-[color:var(--muted)]">
                      {manager ? `${t("hiring.reportsTo")} ${manager.name}` : t("hiring.topLevel")}
                    </div>
                    {requestedBy && (
                      <div className="text-[10px] text-[color:var(--muted)]">{t("hiring.proposedBy")} {requestedBy.name}</div>
                    )}
                    <div className="text-xs text-[color:var(--muted)]">${ag.budgetMonthlyUsd}/mo</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg px-4 py-3 border border-[color:var(--line)] bg-[color:var(--panel)]">
          <div className="text-[10px] uppercase text-[color:var(--muted)] tracking-wider">{t("hiring.totalAgents")}</div>
          <div className="text-2xl font-bold text-[color:var(--text)] mt-1">{agents.filter(a => a.status !== "terminated").length}</div>
        </div>
        <div className="rounded-lg px-4 py-3 border border-[color:var(--line)] bg-[color:var(--panel)]">
          <div className="text-[10px] uppercase text-[color:var(--muted)] tracking-wider">{t("hiring.pendingHires")}</div>
          <div className="text-2xl font-bold text-[color:var(--warn)] mt-1">{agents.filter(a => a.status === "pending_approval").length}</div>
        </div>
        <div className="rounded-lg px-4 py-3 border border-[color:var(--line)] bg-[color:var(--panel)]">
          <div className="text-[10px] uppercase text-[color:var(--muted)] tracking-wider">{t("hiring.departments")}</div>
          <div className="text-2xl font-bold text-[color:var(--text)] mt-1">
            {new Set(agents.filter(a => a.department && a.status !== "terminated").map(a => a.department)).size}
          </div>
        </div>
        <div className="rounded-lg px-4 py-3 border border-[color:var(--line)] bg-[color:var(--panel)]">
          <div className="text-[10px] uppercase text-[color:var(--muted)] tracking-wider">{t("hiring.monthlyPayroll")}</div>
          <div className="text-2xl font-bold text-[color:var(--text)] mt-1">
            ${agents.filter(a => a.status !== "terminated" && a.status !== "pending_approval").reduce((s, a) => s + a.budgetMonthlyUsd, 0).toLocaleString()}
          </div>
        </div>
      </div>

      <Panel title={t("hiring.departmentHeadcount")}>
        <div className="grid grid-cols-3 gap-2 p-4">
          {(["executive", "engineering", "product", "design", "marketing", "sales", "hr", "finance", "legal", "customer_support", "operations", "research"] as const).map(dept => {
            const deptAgents = agents.filter(a => a.department === dept && a.status !== "terminated");
            const pending = deptAgents.filter(a => a.status === "pending_approval").length;
            const active = deptAgents.filter(a => a.status !== "pending_approval").length;
            if (active === 0 && pending === 0) return null;
            return (
              <div key={dept} className="bg-[color:var(--panel-soft)] rounded-md px-3 py-2">
                <div className="text-xs font-medium text-[color:var(--text)] capitalize">{dept.replace("_", " ")}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm font-bold text-[color:var(--text)]">{active}</span>
                  <span className="text-[10px] text-[color:var(--muted)]">{t("hiring.active")}</span>
                  {pending > 0 && (
                    <>
                      <span className="text-sm font-bold text-[color:var(--warn)]">+{pending}</span>
                      <span className="text-[10px] text-[color:var(--warn)]">{t("hiring.pendingApproval")}</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
