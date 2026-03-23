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
    <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">{label}</div>
          <div className={`mt-1 text-[28px] font-semibold tracking-[-0.03em] ${tone === "danger" ? "text-[color:var(--danger)]" : "text-[color:var(--text)]"}`}>
            {value}
          </div>
          <div className="mt-1 text-[12px] text-[color:var(--muted)]">{detail}</div>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-[8px] ${tone === "danger" ? "bg-[color:var(--danger-soft)] text-[color:var(--danger)]" : "bg-[color:var(--panel-soft)] text-[color:var(--muted-strong)]"}`}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

export function RunMeta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-3.5 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{label}</div>
      <div className="mt-1 text-[13px] text-[color:var(--text)]">{value}</div>
    </div>
  );
}
