import { motion } from "framer-motion";
import {
  ShieldCheck,
  XCircle,
  CurrencyCircleDollar,
  Warning,
  Eye,
  ChatCircle,
} from "../ui/icons";
import type { InboxItemType } from "@shared/types";
import { Card } from "../ui";

export const typeConfig: Record<InboxItemType, { icon: React.ElementType; label: string }> = {
  pending_approval: { icon: ShieldCheck, label: "Approval" },
  failed_run: { icon: XCircle, label: "Failed Run" },
  budget_warning: { icon: CurrencyCircleDollar, label: "Budget" },
  blocked_task: { icon: Warning, label: "Blocked" },
  review_needed: { icon: Eye, label: "Review" },
  agent_message: { icon: ChatCircle, label: "Message" },
};

export function CompactMetric({ label, value, tone = "default", subtitle }: {
  label: string;
  value: string | number;
  tone?: "default" | "success" | "warn" | "danger" | "accent";
  subtitle?: string;
}) {
  const toneMap = {
    default: "text-foreground",
    success: "text-success",
    warn: "text-warning",
    danger: "text-destructive",
    accent: "text-primary",
  };

  return (
    <Card padding="sm">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className={`text-[22px] font-bold ${toneMap[tone]}`}>{value}</div>
      {subtitle ? <div className="text-[10px] text-muted-foreground">{subtitle}</div> : null}
    </Card>
  );
}

export function RunProgressBar({ succeeded, failed, total }: { succeeded: number; failed: number; total: number }) {
  if (total === 0) return <div className="h-3 rounded-full bg-muted" />;
  const successPct = (succeeded / total) * 100;
  const failPct = (failed / total) * 100;

  return (
    <div className="flex h-3 overflow-hidden rounded-full bg-muted">
      <motion.div
        className="h-full bg-success"
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
