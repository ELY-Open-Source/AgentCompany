import { useState } from "react";
import {
  ArrowRight,
  Check,
  UserPlus,
  X,
} from "@phosphor-icons/react";
import type { AgentRecord, ApprovalRecord } from "@shared/types";
import { ActionButton, EmptyState, Panel, StatusPill } from "./ui";

interface HiringPipelineProps {
  companyId: string;
  agents: AgentRecord[];
  approvals: ApprovalRecord[];
  onRefresh: () => Promise<void>;
  onNavigateToAgent: (agentId: string) => void;
}

type HiringStage = "requisition" | "pending_approval" | "approved" | "onboarding" | "active" | "rejected";

interface HiringCandidate {
  agent: AgentRecord;
  approval: ApprovalRecord | null;
  stage: HiringStage;
}

function getHiringStage(agent: AgentRecord, approval: ApprovalRecord | null): HiringStage {
  if (agent.status === "pending_approval") {
    if (!approval) return "requisition";
    if (approval.state === "pending") return "pending_approval";
    if (approval.state === "rejected") return "rejected";
    if (approval.state === "revision_requested") return "requisition";
    return "approved";
  }
  if (agent.status === "idle" && approval?.state === "approved") {
    // Recently approved — check if they have any tasks yet
    return "onboarding";
  }
  return "active";
}

function stageLabel(stage: HiringStage): string {
  switch (stage) {
    case "requisition": return "Requisition";
    case "pending_approval": return "Pending Approval";
    case "approved": return "Approved";
    case "onboarding": return "Onboarding";
    case "active": return "Active";
    case "rejected": return "Rejected";
  }
}

function stageColor(stage: HiringStage): string {
  switch (stage) {
    case "requisition": return "bg-amber-500/20 text-amber-400";
    case "pending_approval": return "bg-yellow-500/20 text-yellow-400";
    case "approved": return "bg-green-500/20 text-green-400";
    case "onboarding": return "bg-blue-500/20 text-blue-400";
    case "active": return "bg-emerald-500/20 text-emerald-400";
    case "rejected": return "bg-red-500/20 text-red-400";
  }
}

const STAGE_ORDER: HiringStage[] = ["requisition", "pending_approval", "approved", "onboarding", "active", "rejected"];

export function HiringPipeline({ companyId: _companyId, agents, approvals, onRefresh, onNavigateToAgent }: HiringPipelineProps) {
  const [filterStage, setFilterStage] = useState<HiringStage | "all">("all");

  const hireApprovals = approvals.filter(a => a.type === "hire_agent");

  const candidates: HiringCandidate[] = agents.map(agent => {
    const approval = hireApprovals.find(a =>
      a.relatedAgentId === agent.id ||
      (a.payloadJson && (() => { try { const p = JSON.parse(a.payloadJson); return p.agentId === agent.id; } catch { return false; } })())
    ) ?? null;
    return {
      agent,
      approval,
      stage: getHiringStage(agent, approval),
    };
  });

  // Also include hire approvals that don't yet have an agent (pre-creation stage)
  const pendingHireApprovals = hireApprovals.filter(a => {
    return a.state === "pending" && !candidates.some(c => c.approval?.id === a.id);
  });

  const allCandidates = [
    ...candidates,
    ...pendingHireApprovals.map(a => ({
      agent: null as unknown as AgentRecord,
      approval: a,
      stage: "pending_approval" as HiringStage,
    })),
  ].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));

  const filteredCandidates = filterStage === "all"
    ? allCandidates
    : allCandidates.filter(c => c.stage === filterStage);

  // Stage counts for the pipeline overview
  const stageCounts = STAGE_ORDER.reduce((acc, stage) => {
    acc[stage] = allCandidates.filter(c => c.stage === stage).length;
    return acc;
  }, {} as Record<HiringStage, number>);

  const pendingCount = stageCounts.requisition + stageCounts.pending_approval;
  const activeHires = allCandidates.filter(c => c.stage !== "active" && c.stage !== "rejected").length;

  return (
    <div className="space-y-4">
      {/* Pipeline Overview */}
      <Panel title="Hiring Pipeline" eyebrow={`${activeHires} active hiring processes`}>
        <div className="flex items-center gap-1 px-4 py-3 overflow-x-auto">
          {STAGE_ORDER.filter(s => s !== "rejected").map((stage, idx) => (
            <div key={stage} className="flex items-center gap-1">
              <button
                onClick={() => setFilterStage(filterStage === stage ? "all" : stage)}
                className={`px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  filterStage === stage ? "ring-1 ring-orange-400/40 bg-zinc-700" : "hover:bg-zinc-700/60"
                } ${stageColor(stage)}`}
              >
                {stageLabel(stage)}
                <span className="ml-1.5 inline-flex items-center justify-center h-5 w-5 rounded-full bg-zinc-800 text-[10px]">
                  {stageCounts[stage]}
                </span>
              </button>
              {idx < STAGE_ORDER.length - 2 && (
                <ArrowRight size={12} className="text-zinc-600 flex-shrink-0" />
              )}
            </div>
          ))}
          {stageCounts.rejected > 0 && (
            <button
              onClick={() => setFilterStage(filterStage === "rejected" ? "all" : "rejected")}
              className={`ml-4 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                filterStage === "rejected" ? "ring-1 ring-red-400/40 bg-zinc-700" : "hover:bg-zinc-700/60"
              } ${stageColor("rejected")}`}
            >
              Rejected
              <span className="ml-1.5 inline-flex items-center justify-center h-5 w-5 rounded-full bg-zinc-800 text-[10px]">
                {stageCounts.rejected}
              </span>
            </button>
          )}
        </div>
      </Panel>

      {/* Pending Approvals Section */}
      {pendingCount > 0 && (
        <Panel title="Awaiting Board Decision" eyebrow={`${pendingCount} hire requests need your review`}>
          <div className="divide-y divide-zinc-800/60">
            {allCandidates
              .filter(c => c.stage === "requisition" || c.stage === "pending_approval")
              .map((candidate) => {
                const a = candidate.approval;
                const ag = candidate.agent;
                return (
                  <div key={a?.id ?? ag?.id} className="px-4 py-3 flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5 h-8 w-8 rounded-full bg-amber-500/15 flex items-center justify-center">
                      <UserPlus size={16} className="text-amber-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-zinc-200">{ag?.name ?? "Proposed Agent"}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${stageColor(candidate.stage)}`}>
                          {stageLabel(candidate.stage)}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-400 mt-0.5">
                        {ag ? `${ag.role} — ${ag.title}` : a?.payloadSummary}
                      </div>
                      {ag?.department && (
                        <div className="text-xs text-zinc-500 mt-0.5">
                          Dept: {ag.department} | Budget: ${ag.budgetMonthlyUsd}/mo | Connector: {ag.connectorId}
                        </div>
                      )}
                      {a?.payloadSummary && (
                        <div className="text-xs text-zinc-500 mt-1">{a.payloadSummary}</div>
                      )}
                      {a?.impactSummary && (
                        <div className="text-xs text-zinc-500">{a.impactSummary}</div>
                      )}
                      {ag?.capabilities && (
                        <div className="text-xs text-zinc-600 mt-1 line-clamp-2">{ag.capabilities}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {a && a.state === "pending" && (
                        <>
                          <ActionButton
                            label="Approve"
                            icon={Check}
                            tone="accent"
                            onClick={async () => {
                              await window.agentCompany.decideApproval({
                                approvalId: a.id,
                                state: "approved",
                                decisionNote: "Hire approved via hiring pipeline",
                              });
                              await onRefresh();
                            }}
                          />
                          <ActionButton
                            label="Reject"
                            icon={X}
                            tone="danger"
                            onClick={async () => {
                              await window.agentCompany.decideApproval({
                                approvalId: a.id,
                                state: "rejected",
                                decisionNote: "Hire rejected via hiring pipeline",
                              });
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

      {/* Full Pipeline List */}
      <Panel
        title={filterStage === "all" ? "All Agents" : `${stageLabel(filterStage)} (${filteredCandidates.length})`}
        action={
          filterStage !== "all" ? (
            <ActionButton label="Show all" icon={X} onClick={() => setFilterStage("all")} />
          ) : undefined
        }
      >
        {filteredCandidates.length === 0 ? (
          <EmptyState
            title="No hiring activity"
            detail="When agents propose new hires via the API, they will appear here for your review."
          />
        ) : (
          <div className="divide-y divide-zinc-800/60">
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
                  className="px-4 py-3 flex items-center gap-3 hover:bg-zinc-800/40 cursor-pointer transition-colors"
                  onClick={() => onNavigateToAgent(ag.id)}
                >
                  <div className="flex-shrink-0 h-8 w-8 rounded-full bg-zinc-700/60 flex items-center justify-center text-xs font-bold text-zinc-300">
                    {ag.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-zinc-200 truncate">{ag.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${stageColor(candidate.stage)}`}>
                        {stageLabel(candidate.stage)}
                      </span>
                      <StatusPill status={ag.status} />
                    </div>
                    <div className="text-xs text-zinc-400 mt-0.5">
                      {ag.role} — {ag.title}{ag.department ? ` | ${ag.department}` : ""}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-xs text-zinc-500">
                      {manager ? `Reports to ${manager.name}` : "Top level"}
                    </div>
                    {requestedBy && (
                      <div className="text-[10px] text-zinc-600">Proposed by {requestedBy.name}</div>
                    )}
                    <div className="text-xs text-zinc-500">${ag.budgetMonthlyUsd}/mo</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Hiring Statistics */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-zinc-900/60 rounded-lg px-4 py-3 border border-zinc-800/40">
          <div className="text-[10px] uppercase text-zinc-500 tracking-wider">Total Agents</div>
          <div className="text-2xl font-bold text-zinc-200 mt-1">{agents.filter(a => a.status !== "terminated").length}</div>
        </div>
        <div className="bg-zinc-900/60 rounded-lg px-4 py-3 border border-zinc-800/40">
          <div className="text-[10px] uppercase text-zinc-500 tracking-wider">Pending Hires</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">{agents.filter(a => a.status === "pending_approval").length}</div>
        </div>
        <div className="bg-zinc-900/60 rounded-lg px-4 py-3 border border-zinc-800/40">
          <div className="text-[10px] uppercase text-zinc-500 tracking-wider">Departments</div>
          <div className="text-2xl font-bold text-zinc-200 mt-1">
            {new Set(agents.filter(a => a.department && a.status !== "terminated").map(a => a.department)).size}
          </div>
        </div>
        <div className="bg-zinc-900/60 rounded-lg px-4 py-3 border border-zinc-800/40">
          <div className="text-[10px] uppercase text-zinc-500 tracking-wider">Monthly Payroll</div>
          <div className="text-2xl font-bold text-zinc-200 mt-1">
            ${agents.filter(a => a.status !== "terminated" && a.status !== "pending_approval").reduce((s, a) => s + a.budgetMonthlyUsd, 0).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Department Headcount */}
      <Panel title="Department Headcount">
        <div className="grid grid-cols-3 gap-2 p-4">
          {(["executive", "engineering", "product", "design", "marketing", "sales", "hr", "finance", "legal", "customer_support", "operations", "research"] as const).map(dept => {
            const deptAgents = agents.filter(a => a.department === dept && a.status !== "terminated");
            const pending = deptAgents.filter(a => a.status === "pending_approval").length;
            const active = deptAgents.filter(a => a.status !== "pending_approval").length;
            if (active === 0 && pending === 0) return null;
            return (
              <div key={dept} className="bg-zinc-800/40 rounded-md px-3 py-2">
                <div className="text-xs font-medium text-zinc-300 capitalize">{dept.replace("_", " ")}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm font-bold text-zinc-200">{active}</span>
                  <span className="text-[10px] text-zinc-500">active</span>
                  {pending > 0 && (
                    <>
                      <span className="text-sm font-bold text-amber-400">+{pending}</span>
                      <span className="text-[10px] text-amber-400/70">pending</span>
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
