import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  ArrowRight,
  Robot,
  Tray,
} from "@phosphor-icons/react";
import type { InboxItem, InboxItemType, SectionId } from "@shared/types";
import { timeAgo } from "../../lib/formatters";
import { useT } from "../../i18n";
import { typeConfig, severityColors } from "./inbox-helpers";

interface InboxProps {
  items: InboxItem[];
  onNavigate: (section: SectionId, entityId?: string) => void;
}

export function Inbox({ items, onNavigate }: InboxProps) {
  const t = useT();
  const [filter, setFilter] = useState<InboxItemType | "all">("all");

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    return items.filter(i => i.type === filter);
  }, [items, filter]);

  const counts = useMemo(() => ({
    all: items.length,
    pending_approval: items.filter(i => i.type === "pending_approval").length,
    failed_run: items.filter(i => i.type === "failed_run").length,
    budget_warning: items.filter(i => i.type === "budget_warning").length,
    blocked_task: items.filter(i => i.type === "blocked_task").length,
    review_needed: items.filter(i => i.type === "review_needed").length,
    agent_message: items.filter(i => i.type === "agent_message").length,
  }), [items]);

  const handleItemClick = (item: InboxItem) => {
    const sectionMap: Record<string, SectionId> = {
      approval: "approvals",
      run: "runs",
      agent: "agents",
      task: "tasks",
      message: "communication",
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
    { key: "agent_message", label: "Messages", count: counts.agent_message },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-[color:var(--accent-soft)]">
            <Bell size={20} weight="fill" className="text-[color:var(--accent)]" />
          </div>
          <div>
            <h2 className="text-[18px] font-bold tracking-[-0.02em] text-[color:var(--text)]">{t("inbox.title")}</h2>
            <p className="text-[12px] text-[color:var(--muted)]">
              {counts.all} item{counts.all !== 1 ? "s" : ""} need{counts.all === 1 ? "s" : ""} your attention
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {filterButtons.map(btn => (
          <button
            key={btn.key}
            type="button"
            onClick={() => setFilter(btn.key)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
              filter === btn.key
                ? "bg-[color:var(--accent)] text-[color:var(--text-on-accent)]"
                : "bg-[color:var(--panel-soft)] text-[color:var(--muted-strong)] hover:bg-[color:var(--line)]"
            }`}
          >
            {btn.label}
            {btn.count > 0 ? (
              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                filter === btn.key ? "bg-[color:var(--text-on-accent)]/20 text-[color:var(--text-on-accent)]" : "bg-[color:var(--line)] text-[color:var(--muted)]"
              }`}>
                {btn.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[8px] border border-dashed border-[color:var(--line)] py-16 text-center">
          <Tray size={32} className="mb-3 text-[color:var(--muted)]" />
          <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">{t("inbox.allClear")}</div>
          <div className="mt-1 text-[12px] text-[color:var(--muted)]">{t("inbox.noItemsNow")}</div>
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
                  className={`group flex items-center gap-3 rounded-[8px] border border-l-[3px] border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3 transition duration-150 hover:border-[color:var(--line-strong)] hover:shadow-md hover:-translate-y-px ${severityColors[item.severity] ?? ""}`}
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
                      <span className="truncate">{item.subtitle.slice(0, 80)}</span>
                      <span className="shrink-0 tabular-nums">{timeAgo(item.createdAt)}</span>
                    </div>
                  </button>
                  <ArrowRight size={14} className="shrink-0 text-[color:var(--muted)] opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100" />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
