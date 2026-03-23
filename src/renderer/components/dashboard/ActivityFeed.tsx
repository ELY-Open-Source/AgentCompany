import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle,
  Heartbeat,
  Lightning,
  ShieldCheck,
  Warning,
  XCircle,
} from "@phosphor-icons/react";
import type { ActivityRecord, AgentRecord } from "@shared/types";
import { timeAgo } from "../../lib/formatters";

const actionIcons: Record<string, React.ElementType> = {
  created: CheckCircle,
  updated: Lightning,
  deleted: XCircle,
  started: Heartbeat,
  completed: CheckCircle,
  failed: Warning,
  approved: ShieldCheck,
  rejected: XCircle,
};

export function ActivityFeed({ activity, agents, limit = 15 }: { activity: ActivityRecord[]; agents: AgentRecord[]; limit?: number }) {
  const recentActivity = useMemo(() => {
    return [...activity]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }, [activity, limit]);

  if (recentActivity.length === 0) {
    return (
      <div className="flex h-full items-center justify-center py-8 text-center">
        <div className="text-[13px] text-[color:var(--muted)]">No activity yet</div>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {recentActivity.map((item, index) => {
        const Icon = actionIcons[item.action] ?? Lightning;
        const agent = agents.find((a) => a.id === item.actor);
        const actorName = agent?.name ?? (item.actor === "board" ? "Board" : item.actor.slice(0, 8));

        return (
          <motion.div
            key={item.id}
            initial={index === 0 ? { opacity: 0, y: -8 } : false}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 rounded-[6px] px-3 py-2 transition hover:bg-[color:var(--panel-soft)]"
          >
            <div className="mt-0.5 shrink-0">
              <Icon size={14} className="text-[color:var(--muted)]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] leading-relaxed text-[color:var(--text)]">
                <span className="font-medium">{actorName}</span>
                {" "}
                <span className="text-[color:var(--muted)]">{item.action}</span>
                {" "}
                <span className="text-[color:var(--muted-strong)]">{item.entityType}</span>
                {item.detail ? (
                  <span className="text-[color:var(--muted)]"> — {item.detail.slice(0, 60)}{item.detail.length > 60 ? "..." : ""}</span>
                ) : null}
              </div>
              <div className="mt-0.5 whitespace-nowrap text-[10px] text-[color:var(--muted)]">{timeAgo(item.createdAt)}</div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
