import { useCallback, useEffect, useState } from "react";
import { Plus, ShieldCheck, Trash, Warning } from "@phosphor-icons/react";
import type { BudgetPolicyRecord, BudgetStatusSummary } from "@shared/types";
import { ActionButton, EmptyState, ListFrame, ListRow } from "../ui";
import { PolicyFormModal } from "./PolicyFormModal";

interface PolicyListProps {
  companyId: string;
  agents: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
}

export function PolicyList({ companyId, agents, projects }: PolicyListProps) {
  const [policies, setPolicies] = useState<BudgetPolicyRecord[]>([]);
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatusSummary | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<BudgetPolicyRecord | null>(null);

  const loadData = useCallback(async () => {
    const [polRes, statusRes] = await Promise.all([
      window.agentCompany.listBudgetPolicies(companyId),
      window.agentCompany.getBudgetStatus(companyId),
    ]);
    if (polRes.ok) setPolicies(polRes.data);
    if (statusRes.ok) setBudgetStatus(statusRes.data);
  }, [companyId]);

  useEffect(() => { void loadData(); }, [loadData]);

  function getScopeName(policy: BudgetPolicyRecord): string {
    if (policy.scopeType === "company") return "Company";
    if (policy.scopeType === "agent") {
      const agent = agents.find((a) => a.id === policy.scopeId);
      return agent ? agent.name : policy.scopeId.slice(0, 8);
    }
    if (policy.scopeType === "project") {
      const project = projects.find((p) => p.id === policy.scopeId);
      return project ? project.name : policy.scopeId.slice(0, 8);
    }
    return policy.scopeId.slice(0, 8);
  }

  function getUtilization(policyId: string): { spent: number; amount: number; pct: number; hasIncident: boolean } | null {
    if (!budgetStatus) return null;
    const entry = budgetStatus.policies.find((p) => p.policyId === policyId);
    if (!entry) return null;
    const pct = entry.amount > 0 ? (entry.spent / entry.amount) * 100 : 0;
    return { spent: entry.spent, amount: entry.amount, pct, hasIncident: entry.hasOpenIncident };
  }

  async function handleDelete(policyId: string) {
    const result = await window.agentCompany.deleteBudgetPolicy({ companyId, policyId });
    if (result.ok) void loadData();
  }

  function handleEdit(policy: BudgetPolicyRecord) {
    setEditingPolicy(policy);
    setShowForm(true);
  }

  function handleAdd() {
    setEditingPolicy(null);
    setShowForm(true);
  }

  function handleSaved() {
    void loadData();
  }

  if (policies.length === 0 && !showForm) {
    return (
      <div className="p-6">
        <EmptyState
          title="No budget policies"
          detail="Add your first policy to track and enforce spending limits."
          action={<ActionButton label="Add Policy" icon={Plus} onClick={handleAdd} />}
        />
        <PolicyFormModal
          open={showForm}
          onClose={() => setShowForm(false)}
          onSaved={handleSaved}
          companyId={companyId}
          editingPolicy={editingPolicy}
          agents={agents}
          projects={projects}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-[15px] font-semibold text-foreground">Budget Policies</h3>
        <ActionButton label="Add Policy" icon={Plus} onClick={handleAdd} />
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <ListFrame>
          {policies.map((policy) => {
            const util = getUtilization(policy.id);
            const pct = util?.pct ?? 0;
            const barColor = pct > 100 ? "bg-destructive" : pct > 80 ? "bg-yellow-600 dark:bg-yellow-400" : "bg-green-600 dark:bg-green-400";
            return (
              <ListRow key={policy.id} onClick={() => handleEdit(policy)}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                        {policy.scopeType}
                      </span>
                      <span className="truncate text-[13px] font-medium text-foreground">{getScopeName(policy)}</span>
                      {policy.hardStopEnabled ? <ShieldCheck size={14} className="shrink-0 text-primary" /> : null}
                      {util?.hasIncident ? <Warning size={14} weight="fill" className="shrink-0 text-yellow-600 dark:text-yellow-400" /> : null}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="font-[family-name:var(--font-mono)]" style={{ fontVariantNumeric: "tabular-nums" }}>
                        ${(policy.amount / 100).toFixed(2)}/mo
                      </span>
                      <span>Warn at {policy.warnPercent}%</span>
                    </div>
                    {util ? (
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-[color:var(--border)]">
                          <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                        <span className="text-[10px] font-[family-name:var(--font-mono)] text-muted-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                          {Math.round(pct)}%
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-muted-foreground transition hover:text-destructive"
                    title="Delete policy"
                    aria-label="Delete policy"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(policy.id);
                    }}
                  >
                    <Trash size={14} />
                  </button>
                </div>
              </ListRow>
            );
          })}
        </ListFrame>
      </div>
      <PolicyFormModal
        open={showForm}
        onClose={() => { setShowForm(false); setEditingPolicy(null); }}
        onSaved={handleSaved}
        companyId={companyId}
        editingPolicy={editingPolicy}
        agents={agents}
        projects={projects}
      />
    </div>
  );
}
