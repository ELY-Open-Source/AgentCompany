import type { ReactNode } from "react";
import type { RunRecord } from "@shared/types";

export const LOG_CHUNK_BYTES = 65_536;

export interface RunLogState {
  content: string;
  offset: number;
  nextOffset: number;
  totalBytes: number;
  eof: boolean;
  loading: boolean;
  error: string | null;
}

export const initialLogState: RunLogState = {
  content: "",
  offset: 0,
  nextOffset: 0,
  totalBytes: 0,
  eof: true,
  loading: false,
  error: null,
};

export function isActiveStatus(status: RunRecord["status"]) {
  return status === "queued" || status === "running";
}

export function isAttentionStatus(status: RunRecord["status"]) {
  return status === "failed" || status === "timed_out" || status === "interrupted";
}

export function RunSummaryCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number;
  detail: string;
  icon: React.ElementType;
  tone?: "default" | "danger";
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
          <div className={`mt-1 text-[28px] font-semibold tracking-[-0.03em] ${tone === "danger" ? "text-destructive" : "text-foreground"}`}>
            {value}
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">{detail}</div>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tone === "danger" ? "bg-red-100 dark:bg-red-900/50 text-destructive" : "bg-muted text-muted-foreground"}`}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

export function RunMeta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted px-3.5 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-[13px] text-foreground">{value}</div>
    </div>
  );
}
