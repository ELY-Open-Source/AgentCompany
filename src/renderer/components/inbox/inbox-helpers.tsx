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
  pending_approval: { icon: ShieldCheck, color: "var(--warn)", bg: "var(--warn-soft)", label: "Approval" },
  failed_run: { icon: XCircle, color: "var(--danger)", bg: "var(--danger-soft)", label: "Failed Run" },
  budget_warning: { icon: CurrencyCircleDollar, color: "var(--warn)", bg: "var(--warn-soft)", label: "Budget" },
  blocked_task: { icon: Warning, color: "var(--danger)", bg: "var(--danger-soft)", label: "Blocked" },
  review_needed: { icon: Eye, color: "var(--accent)", bg: "var(--accent-soft)", label: "Review" },
  agent_message: { icon: ChatCircle, color: "var(--accent)", bg: "var(--accent-soft)", label: "Message" },
};

export const severityColors: Record<string, string> = {
  critical: "border-l-[color:var(--danger)]",
  high: "border-l-[color:var(--warn)]",
  medium: "border-l-[color:var(--accent)]",
  low: "border-l-[color:var(--line)]",
};

export function CompactMetric({ label, value, tone = "default", subtitle }: {
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
    <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{label}</div>
      <div className={`text-[22px] font-bold ${toneMap[tone]}`}>{value}</div>
      {subtitle ? <div className="text-[10px] text-[color:var(--muted)]">{subtitle}</div> : null}
    </div>
  );
}

export function RunProgressBar({ succeeded, failed, total }: { succeeded: number; failed: number; total: number }) {
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
