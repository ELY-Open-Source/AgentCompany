import { useMemo } from "react";
import {
  Buildings,
  ChartLineUp,
  Cpu,
  CurrencyCircleDollar,
  Heartbeat,
  Lightning,
  Rocket,
  ShieldCheck,
  Target,
  TrendUp,
  Users,
} from "@phosphor-icons/react";
import type { AgentRecord, RunRecord, SectionId, TaskRecord } from "@shared/types";

const DEPARTMENT_INFO: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  executive: { label: "Executive", icon: Buildings, color: "var(--accent)" },
  engineering: { label: "Engineering", icon: Cpu, color: "#6366f1" },
  product: { label: "Product", icon: Rocket, color: "#8b5cf6" },
  design: { label: "Design", icon: Target, color: "#ec4899" },
  marketing: { label: "Marketing", icon: TrendUp, color: "#0ea5e9" },
  sales: { label: "Sales", icon: ChartLineUp, color: "#10b981" },
  hr: { label: "People", icon: Users, color: "#06b6d4" },
  finance: { label: "Finance", icon: CurrencyCircleDollar, color: "#14b8a6" },
  legal: { label: "Legal", icon: ShieldCheck, color: "#64748b" },
  operations: { label: "Operations", icon: Lightning, color: "#475569" },
  customer_support: { label: "Support", icon: Heartbeat, color: "#3b82f6" },
  research: { label: "Research", icon: Target, color: "#a855f7" },
};

export function DepartmentOverview({
  agents,
  tasks,
  runs,
  onNavigate,
}: {
  agents: AgentRecord[];
  tasks: TaskRecord[];
  runs: RunRecord[];
  onNavigate: (section: SectionId) => void;
}) {
  const departments = useMemo(() => {
    const depts = new Map<string, { agents: AgentRecord[]; tasks: TaskRecord[]; activeRuns: number }>();
    for (const agent of agents) {
      if (agent.status === "terminated") continue;
      const dept = agent.department ?? "unassigned";
      if (!depts.has(dept)) depts.set(dept, { agents: [], tasks: [], activeRuns: 0 });
      depts.get(dept)!.agents.push(agent);
    }
    for (const task of tasks) {
      if (task.assigneeAgentId) {
        const agent = agents.find((a) => a.id === task.assigneeAgentId);
        if (agent?.department) {
          const dept = depts.get(agent.department);
          if (dept) dept.tasks.push(task);
        }
      }
    }
    for (const run of runs) {
      if (run.status === "running") {
        const agent = agents.find((a) => a.id === run.agentId);
        if (agent?.department) {
          const dept = depts.get(agent.department);
          if (dept) dept.activeRuns++;
        }
      }
    }
    return Array.from(depts.entries())
      .filter(([key]) => key !== "unassigned")
      .sort((a, b) => b[1].agents.length - a[1].agents.length);
  }, [agents, tasks, runs]);

  if (departments.length <= 1) return null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {departments.map(([deptId, data]) => {
        const info = DEPARTMENT_INFO[deptId] ?? { label: deptId, icon: Buildings, color: "var(--muted)" };
        const Icon = info.icon;
        const activeTasks = data.tasks.filter((t) => t.status === "in_progress" || t.status === "in_review").length;
        const doneTasks = data.tasks.filter((t) => t.status === "done").length;
        const blockedTasks = data.tasks.filter((t) => t.status === "blocked").length;
        const runningAgents = data.agents.filter((a) => a.status === "running").length;

        return (
          <button
            key={deptId}
            type="button"
            onClick={() => onNavigate("agents")}
            className="focus-ring group relative overflow-hidden rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] p-3.5 text-left transition duration-150 hover:border-[color:var(--line-strong)] hover:shadow-sm"
          >
            <div className="absolute left-0 top-0 h-full w-[3px]" style={{ backgroundColor: info.color }} />
            <div className="flex items-center gap-2 pl-1">
              <Icon size={15} weight="fill" style={{ color: info.color }} />
              <span className="truncate text-[11px] font-medium text-[color:var(--text)]">{info.label}</span>
              {runningAgents > 0 && (
                <span className="ml-auto flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--success)]" />
                  <span className="text-[9px] text-[color:var(--success)]">{runningAgents}</span>
                </span>
              )}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1 pl-1">
              <div>
                <div className="text-[16px] font-bold tabular-nums text-[color:var(--text)]">{data.agents.length}</div>
                <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">People</div>
              </div>
              <div>
                <div className="text-[16px] font-bold tabular-nums text-[color:var(--accent)]">{activeTasks}</div>
                <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Active</div>
              </div>
              <div>
                <div className={`text-[16px] font-bold tabular-nums ${blockedTasks > 0 ? "text-[color:var(--danger)]" : "text-[color:var(--success)]"}`}>
                  {blockedTasks > 0 ? blockedTasks : doneTasks}
                </div>
                <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">
                  {blockedTasks > 0 ? "Blocked" : "Done"}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
