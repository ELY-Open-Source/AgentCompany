import { useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import {
  Bell,
  Robot,
  Tray,
} from "../ui/icons";
import type { InboxItem, InboxItemType, SectionId } from "@shared/types";
import { timeAgo } from "../../lib/formatters";
import { useT } from "../../i18n";
import { typeConfig } from "./inbox-helpers";
import { AttentionRow } from "../ui";

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
    { key: "all", label: t("inbox.filter.all"), count: counts.all },
    { key: "pending_approval", label: t("inbox.filter.approvals"), count: counts.pending_approval },
    { key: "review_needed", label: t("inbox.filter.reviews"), count: counts.review_needed },
    { key: "failed_run", label: t("inbox.filter.failed"), count: counts.failed_run },
    { key: "blocked_task", label: t("inbox.filter.blocked"), count: counts.blocked_task },
    { key: "budget_warning", label: t("inbox.filter.budget"), count: counts.budget_warning },
    { key: "agent_message", label: t("inbox.filter.messages"), count: counts.agent_message },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
            <Bell size={20} weight="fill" className="text-primary" />
          </div>
          <div>
            <h2 className="text-[18px] font-bold tracking-[-0.02em] text-foreground">{t("inbox.title")}</h2>
            <p className="text-[12px] text-muted-foreground">
              {counts.all} {t("inbox.needsAttention")}
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
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-[color:var(--border)]"
            }`}
          >
            {btn.label}
            {btn.count > 0 ? (
              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                filter === btn.key ? "bg-[color:var(--primary-foreground)]/20 text-primary-foreground" : "bg-[color:var(--border)] text-muted-foreground"
              }`}>
                {btn.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <Tray size={32} className="mb-3 text-muted-foreground" />
          <div className="text-[14px] font-medium text-muted-foreground">{t("inbox.allClear")}</div>
          <div className="mt-1 text-[12px] text-muted-foreground">{t("inbox.noItemsNow")}</div>
        </div>
      ) : (
        <div>
          <AnimatePresence>
            {filteredItems.map((item, i) => {
              const config = typeConfig[item.type];
              const Icon = config.icon;
              const isUrgent = item.severity === "critical" || item.severity === "high";
              const title = (
                <span className={`truncate ${isUrgent ? "font-semibold" : "font-medium"}`}>{item.title}</span>
              );
              const subtitle = (
                <span className="flex items-center gap-2">
                  {item.agentName ? (
                    <span className="flex items-center gap-1">
                      <Robot size={10} />
                      {item.agentName}
                    </span>
                  ) : null}
                  <span className="truncate">{item.subtitle.slice(0, 80)}</span>
                  {isUrgent ? (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  ) : null}
                  <span className="shrink-0 tabular-nums">{timeAgo(item.createdAt)}</span>
                </span>
              );
              return (
                <AttentionRow
                  key={item.id}
                  index={i}
                  icon={Icon}
                  tone="info"
                  iconWeight={isUrgent ? "bold" : "regular"}
                  variant="line"
                  title={title}
                  subtitle={subtitle}
                  onClick={() => handleItemClick(item)}
                  showArrow={false}
                />
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
