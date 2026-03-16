import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  ShieldCheck,
  Warning,
  XCircle,
  CurrencyCircleDollar,
  ArrowRight,
  CheckCircle,
  Clock,
  Eye,
  FunnelSimple,
  Robot,
  Heartbeat,
  Target,
  ChatCircle,
  Tray,
} from "@phosphor-icons/react";
import type { InboxItem, InboxItemType, SectionId, StandupReport, AgentMetrics, CompanyMetrics } from "@shared/types";
import { formatMoney } from "../lib/formatters";

/* ------------------------------------------------------------------ */
/*  Inbox Panel                                                        */
/* ------------------------------------------------------------------ */

const typeConfig: Record<InboxItemType, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  pending_approval: { icon: ShieldCheck, color: "var(--warn)", bg: "var(--warn-soft)", label: "Approval" },
  failed_run: { icon: XCircle, color: "var(--danger)", bg: "var(--danger-soft)", label: "Failed Run" },
  budget_warning: { icon: CurrencyCircleDollar, color: "var(--warn)", bg: "var(--warn-soft)", label: "Budget" },
  blocked_task: { icon: Warning, color: "var(--danger)", bg: "var(--danger-soft)", label: "Blocked" },
  review_needed: { icon: Eye, color: "var(--accent)", bg: "var(--accent-soft)", label: "Review" },
  agent_message: { icon: ChatCircle, color: "var(--accent)", bg: "var(--accent-soft)", label: "Message" },
};

const severityColors: Record<string, string> = {
  critical: "border-l-[color:var(--danger)]",
  high: "border-l-[color:var(--warn)]",
  medium: "border-l-[color:var(--accent)]",
  low: "border-l-[color:var(--line)]",
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface InboxProps {
  items: InboxItem[];
  onNavigate: (section: SectionId, entityId?: string) => void;
  onDismiss: (itemId: string) => void;
}

export function Inbox({ items, onNavigate, onDismiss }: InboxProps) {
  const [filter, setFilter] = useState<InboxItemType | "all">("all");
  const [showDismissed, setShowDismissed] = useState(false);

  const filteredItems = useMemo(() => {
    let result = items;
    if (!showDismissed) result = result.filter(i => !i.dismissed);
    if (filter !== "all") result = result.filter(i => i.type === filter);
    return result;
  }, [items, filter, showDismissed]);

  const counts = useMemo(() => {
    const active = items.filter(i => !i.dismissed);
    return {
      all: active.length,
      pending_approval: active.filter(i => i.type === "pending_approval").length,
      failed_run: active.filter(i => i.type === "failed_run").length,
      budget_warning: active.filter(i => i.type === "budget_warning").length,
      blocked_task: active.filter(i => i.type === "blocked_task").length,
      review_needed: active.filter(i => i.type === "review_needed").length,
      agent_message: active.filter(i => i.type === "agent_message").length,
    };
  }, [items]);

  const handleItemClick = (item: InboxItem) => {
    const sectionMap: Record<string, SectionId> = {
      approval: "approvals",
      run: "tasks",
      agent: "agents",
      task: "tasks",
    };
    const section = sectionMap[item.entityType] ?? "overview";
    onNavigate(section, item.entityId);
  };

  const filterButtons: Array<{ key: InboxItemType | "all"; label: string; count: number }> = [
    { key: "all", label: "All", count: counts.all },
    { key: "pending_approval", label: "Approvals", count: counts.pending_approval },
    { key: "review_needed", label: "Reviews", count: counts.review_needed },
    { key: "failed_run", label: "Failed", count: counts.failed_run },
    { key: "blocked_task", label: "Blocked", count: counts.blocked_task },
    { key: "budget_warning", label: "Budget", count: counts.budget_warning },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[color:var(--accent-soft)]">
            <Bell size={20} weight="fill" className="text-[color:var(--accent)]" />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-[color:var(--text)]">Inbox</h2>
            <p className="text-[12px] text-[color:var(--muted)]">
              {counts.all} item{counts.all !== 1 ? "s" : ""} need{counts.all === 1 ? "s" : ""} your attention
            </p>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-1.5">
        {filterButtons.map(btn => (
          <button
            key={btn.key}
            type="button"
            onClick={() => setFilter(btn.key)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
              filter === btn.key
                ? "bg-[color:var(--accent)] text-white"
                : "bg-[color:var(--panel-soft)] text-[color:var(--muted-strong)] hover:bg-[color:var(--line)]"
            }`}
          >
            {btn.label}
            {btn.count > 0 ? (
              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                filter === btn.key ? "bg-white/20 text-white" : "bg-[color:var(--line)] text-[color:var(--muted)]"
              }`}>
                {btn.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Items */}
      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-[color:var(--line)] py-16 text-center">
          <Tray size={32} className="mb-3 text-[color:var(--muted)]" />
          <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">All clear!</div>
          <div className="mt-1 text-[12px] text-[color:var(--muted)]">No items need your attention right now</div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <AnimatePresence>
            {filteredItems.map((item) => {
              const config = typeConfig[item.type];
              const Icon = config.icon;
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className={`group flex items-center gap-3 rounded-[8px] border border-l-[3px] border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3 transition hover:border-[color:var(--line-strong)] hover:shadow-sm ${severityColors[item.severity] ?? ""}`}
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]"
                    style={{ backgroundColor: config.bg }}
                  >
                    <Icon size={18} weight="fill" style={{ color: config.color }} />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleItemClick(item)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-[color:var(--text)]">{item.title}</span>
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]"
                        style={{ backgroundColor: config.bg, color: config.color }}
                      >
                        {config.label}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[color:var(--muted)]">
                      {item.agentName ? (
                        <span className="flex items-center gap-1">
                          <Robot size={10} />
                          {item.agentName}
                        </span>
                      ) : null}
                      <span>{item.subtitle.slice(0, 80)}</span>
                      <span className="shrink-0">{timeAgo(item.createdAt)}</span>
                    </div>
                  </button>
                  <ArrowRight size={14} className="shrink-0 text-[color:var(--muted)] opacity-0 transition group-hover:opacity-100" />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Standup Report View                                                */
/* ------------------------------------------------------------------ */

interface StandupProps {
  report: StandupReport | null;
  onNavigate: (section: SectionId, entityId?: string) => void;
}

export function StandupView({ report, onNavigate }: StandupProps) {
  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-[color:var(--line)] py-16 text-center">
        <Clock size={32} className="mb-3 text-[color:var(--muted)]" />
        <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">No standup data</div>
        <div className="mt-1 text-[12px] text-[color:var(--muted)]">Company needs active agents to generate standup reports</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-[12px] border border-[color:var(--line)] bg-[color:var(--panel)] p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[color:var(--accent-soft)]">
            <Heartbeat size={20} weight="fill" className="text-[color:var(--accent)]" />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-[color:var(--text)]">Daily Standup</h2>
            <p className="text-[12px] text-[color:var(--muted)]">
              Generated {new Date(report.generatedAt).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="text-[14px] font-medium text-[color:var(--text)]">{report.summary}</div>
        <div className="mt-3 flex gap-4">
          <div className="text-center">
            <div className="text-[18px] font-bold text-[color:var(--success)]">{report.agentReports.filter(r => r.tasksCompleted24h > 0).length}</div>
            <div className="text-[10px] text-[color:var(--muted)]">Productive</div>
          </div>
          <div className="h-10 w-px bg-[color:var(--line)]" />
          <div className="text-center">
            <div className="text-[18px] font-bold text-[color:var(--danger)]">{report.blockers.length}</div>
            <div className="text-[10px] text-[color:var(--muted)]">Blockers</div>
          </div>
          <div className="h-10 w-px bg-[color:var(--line)]" />
          <div className="text-center">
            <div className="text-[18px] font-bold text-[color:var(--warn)]">{report.pendingApprovals}</div>
            <div className="text-[10px] text-[color:var(--muted)]">Approvals</div>
          </div>
          <div className="h-10 w-px bg-[color:var(--line)]" />
          <div className="text-center">
            <div className={`text-[18px] font-bold ${report.budgetUtilization > 80 ? "text-[color:var(--danger)]" : "text-[color:var(--text)]"}`}>
              {report.budgetUtilization}%
            </div>
            <div className="text-[10px] text-[color:var(--muted)]">Budget Used</div>
          </div>
        </div>
      </div>

      {/* Company Highlights */}
      {report.companyHighlights.length > 0 ? (
        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Highlights</div>
          <div className="space-y-1.5">
            {report.companyHighlights.map((h, i) => (
              <div key={i} className="flex items-center gap-2 rounded-[6px] bg-[color:var(--success-soft)] px-3 py-2 text-[12px] text-[color:var(--success)]">
                <CheckCircle size={14} weight="fill" />
                {h}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Blockers */}
      {report.blockers.length > 0 ? (
        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--danger)]">Blockers</div>
          <div className="space-y-1.5">
            {report.blockers.map((b, i) => (
              <div key={i} className="flex items-center gap-2 rounded-[6px] bg-[color:var(--danger-soft)] px-3 py-2 text-[12px] text-[color:var(--danger)]">
                <Warning size={14} weight="fill" />
                {b}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Agent Reports */}
      <section>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Agent Status</div>
        <div className="space-y-2">
          {report.agentReports.map((ar) => (
            <button
              key={ar.agentId}
              type="button"
              onClick={() => onNavigate("agents", ar.agentId)}
              className="flex w-full items-center gap-3 rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3 text-left transition hover:border-[color:var(--line-strong)] hover:shadow-sm"
            >
              <div className="relative">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full text-[12px] font-bold ${
                  ar.status === "running" ? "bg-[color:var(--success-soft)] text-[color:var(--success)]"
                  : ar.status === "error" ? "bg-[color:var(--danger-soft)] text-[color:var(--danger)]"
                  : "bg-[color:var(--panel-soft)] text-[color:var(--muted-strong)]"
                }`}>
                  {ar.agentName.split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase()}
                </div>
                {ar.status === "running" ? (
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--success)] opacity-40" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--success)]" />
                  </span>
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-[color:var(--text)]">{ar.agentName}</span>
                  <span className="text-[10px] text-[color:var(--muted)]">{ar.role}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-[color:var(--muted)]">
                  {ar.tasksInProgress > 0 ? <span className="text-[color:var(--accent)]">{ar.tasksInProgress} in progress</span> : null}
                  {ar.tasksCompleted24h > 0 ? <span className="text-[color:var(--success)]">{ar.tasksCompleted24h} done</span> : null}
                  {ar.tasksBlocked > 0 ? <span className="text-[color:var(--danger)]">{ar.tasksBlocked} blocked</span> : null}
                  {ar.costLast24h > 0 ? <span>${ar.costLast24h.toFixed(2)}</span> : null}
                </div>
                {ar.highlights.length > 0 ? (
                  <div className="mt-1 text-[10px] text-[color:var(--muted)]">{ar.highlights.join(" · ")}</div>
                ) : null}
              </div>
              <ArrowRight size={14} className="shrink-0 text-[color:var(--muted)]" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Performance Metrics View                                           */
/* ------------------------------------------------------------------ */

interface PerformanceProps {
  metrics: CompanyMetrics | null;
  onNavigate: (section: SectionId, entityId?: string) => void;
}

export function PerformanceView({ metrics, onNavigate }: PerformanceProps) {
  if (!metrics) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-[color:var(--line)] py-16 text-center">
        <Target size={32} className="mb-3 text-[color:var(--muted)]" />
        <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">No metrics yet</div>
        <div className="mt-1 text-[12px] text-[color:var(--muted)]">Metrics will appear after agents start working</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Company Overview Metrics */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <CompactMetric
          label="Success Rate"
          value={`${metrics.overallSuccessRate}%`}
          tone={metrics.overallSuccessRate >= 80 ? "success" : metrics.overallSuccessRate >= 50 ? "warn" : "danger"}
        />
        <CompactMetric
          label="Tasks Done"
          value={metrics.completedTasks}
          tone="success"
          subtitle={`of ${metrics.totalTasks} total`}
        />
        <CompactMetric
          label="Throughput"
          value={`${metrics.throughputTasksPerDay.toFixed(1)}`}
          tone="accent"
          subtitle="tasks/day"
        />
        <CompactMetric
          label="Avg Cost/Task"
          value={formatMoney(metrics.avgCostPerTask)}
          tone="default"
        />
      </div>

      {/* Run Stats */}
      <div className="rounded-[12px] border border-[color:var(--line)] bg-[color:var(--panel)] p-5">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Run Activity (30d)</div>
        <div className="flex items-center gap-6">
          <div className="flex-1">
            <RunProgressBar
              succeeded={metrics.successfulRuns}
              failed={metrics.failedRuns}
              total={metrics.totalRuns}
            />
          </div>
          <div className="flex gap-4 text-[12px]">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--success)]" />
              <span className="text-[color:var(--muted)]">{metrics.successfulRuns} succeeded</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--danger)]" />
              <span className="text-[color:var(--muted)]">{metrics.failedRuns} failed</span>
            </span>
          </div>
        </div>
      </div>

      {/* Agent Performance Table */}
      <section>
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Agent Performance</div>
        <div className="overflow-x-auto rounded-[10px] border border-[color:var(--line)]">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[color:var(--line)] bg-[color:var(--panel-soft)]">
                <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">Agent</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)] text-right">Tasks Done</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)] text-right">Success %</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)] text-right">Runs</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)] text-right">Avg Duration</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)] text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {metrics.agentMetrics
                .sort((a, b) => b.tasksCompleted - a.tasksCompleted)
                .map((am) => (
                  <tr
                    key={am.agentId}
                    className="border-b border-[color:var(--line)] bg-[color:var(--panel)] transition hover:bg-[color:var(--panel-soft)] cursor-pointer"
                    onClick={() => onNavigate("agents", am.agentId)}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[color:var(--panel-soft)] text-[10px] font-bold text-[color:var(--muted-strong)]">
                          {am.agentName.split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase()}
                        </div>
                        <span className="text-[12px] font-medium text-[color:var(--text)]">{am.agentName}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-[12px] font-semibold text-[color:var(--success)]">{am.tasksCompleted}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-[12px] font-semibold ${
                        am.successRate >= 80 ? "text-[color:var(--success)]"
                        : am.successRate >= 50 ? "text-[color:var(--warn)]"
                        : "text-[color:var(--danger)]"
                      }`}>
                        {am.successRate}%
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-[12px] text-[color:var(--muted)]">{am.runsTotal}</td>
                    <td className="px-3 py-2.5 text-right text-[12px] text-[color:var(--muted)]">{formatDuration(am.avgRunDurationSec)}</td>
                    <td className="px-3 py-2.5 text-right text-[12px] text-[color:var(--muted)]">{formatMoney(am.totalCostUsd)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function CompactMetric({ label, value, tone = "default", subtitle }: {
  label: string;
  value: string | number;
  tone?: "default" | "success" | "warn" | "danger" | "accent";
  subtitle?: string;
}) {
  const toneMap = {
    default: "text-[color:var(--text)]",
    success: "text-[color:var(--success)]",
    warn: "text-[color:var(--warn)]",
    danger: "text-[color:var(--danger)]",
    accent: "text-[color:var(--accent)]",
  };

  return (
    <div className="rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{label}</div>
      <div className={`text-[22px] font-bold ${toneMap[tone]}`}>{value}</div>
      {subtitle ? <div className="text-[10px] text-[color:var(--muted)]">{subtitle}</div> : null}
    </div>
  );
}

function RunProgressBar({ succeeded, failed, total }: { succeeded: number; failed: number; total: number }) {
  if (total === 0) return <div className="h-3 rounded-full bg-[color:var(--panel-soft)]" />;
  const successPct = (succeeded / total) * 100;
  const failPct = (failed / total) * 100;

  return (
    <div className="flex h-3 overflow-hidden rounded-full bg-[color:var(--panel-soft)]">
      <motion.div
        className="h-full bg-[color:var(--success)]"
        initial={{ width: 0 }}
        animate={{ width: `${successPct}%` }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      />
      <motion.div
        className="h-full bg-[color:var(--danger)]"
        initial={{ width: 0 }}
        animate={{ width: `${failPct}%` }}
        transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
      />
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
