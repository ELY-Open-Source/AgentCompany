import { motion } from "framer-motion";
import {
  ShieldCheck,
  XCircle,
  CurrencyCircleDollar,
  Warning,
  Eye,
  ChatCircle,
} from "@phosphor-icons/react";
import type { InboxItemType } from "@shared/types";

export const typeConfig: Record<InboxItemType, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  pending_approval: { icon: ShieldCheck, color: "var(--destructive)", bg: "var(--muted-foreground)", label: "Approval" },
  failed_run: { icon: XCircle, color: "var(--destructive)", bg: "var(--destructive)", label: "Failed Run" },
  budget_warning: { icon: CurrencyCircleDollar, color: "var(--destructive)", bg: "var(--muted-foreground)", label: "Budget" },
  blocked_task: { icon: Warning, color: "var(--destructive)", bg: "var(--destructive)", label: "Blocked" },
  review_needed: { icon: Eye, color: "var(--primary)", bg: "var(--primary)", label: "Review" },
  agent_message: { icon: ChatCircle, color: "var(--primary)", bg: "var(--primary)", label: "Message" },
};

export const severityColors: Record<string, string> = {
  critical: "border-l-[color:var(--destructive)]",
  high: "border-l-[color:var(--destructive)]",
  medium: "border-l-[color:var(--primary)]",
  low: "border-l-[color:var(--border)]",
};

export function CompactMetric({ label, value, tone = "default", subtitle }: {
  label: string;
  value: string | number;
  tone?: "default" | "success" | "warn" | "danger" | "accent";
  subtitle?: string;
}) {
  const toneMap = {
    default: "text-foreground",
    success: "text-green-600 dark:text-green-400",
    warn: "text-yellow-600 dark:text-yellow-400",
    danger: "text-destructive",
    accent: "text-primary",
  };

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className={`text-[22px] font-bold ${toneMap[tone]}`}>{value}</div>
      {subtitle ? <div className="text-[10px] text-muted-foreground">{subtitle}</div> : null}
    </div>
  );
}

export function RunProgressBar({ succeeded, failed, total }: { succeeded: number; failed: number; total: number }) {
  if (total === 0) return <div className="h-3 rounded-full bg-muted" />;
  const successPct = (succeeded / total) * 100;
  const failPct = (failed / total) * 100;

  return (
    <div className="flex h-3 overflow-hidden rounded-full bg-muted">
      <motion.div
        className="h-full bg-green-600 dark:bg-green-400"
        initial={{ width: 0 }}
        animate={{ width: `${successPct}%` }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      />
      <motion.div
        className="h-full bg-destructive"
        initial={{ width: 0 }}
        animate={{ width: `${failPct}%` }}
        transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
      />
    </div>
  );
}
