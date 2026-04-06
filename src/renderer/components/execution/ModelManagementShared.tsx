import { CaretDown, CaretRight } from "@phosphor-icons/react";
import type { ProfileSnapshot } from "@shared/types";
import { COMPATIBLE_PROVIDERS } from "../company-onboarding/ProvidersStepShared";

export { COMPATIBLE_PROVIDERS };

export const COMPAT_SLOTS = [
  "claude_compatible", "claude_compat_2", "claude_compat_3", "claude_compat_4", "claude_compat_5",
  "claude_compat_6", "claude_compat_7", "claude_compat_8", "claude_compat_9", "claude_compat_10",
] as const;

/* ------------------------------------------------------------------ */
/*  Shared                                                             */
/* ------------------------------------------------------------------ */

export const INPUT_CLS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-full rounded-lg border border-border bg-card px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground";

export interface ModelEntry {
  id: string;
  label: string;
  enabled: boolean;
}

export type ConnectorStatus = ProfileSnapshot["connectors"][number]["status"];

export function parseEnvValue(text: string, key: string): string {
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1) : "";
}

/* ------------------------------------------------------------------ */
/*  StatusBadge                                                        */
/* ------------------------------------------------------------------ */

export function StatusBadge({ status, zh }: { status: ConnectorStatus; zh: boolean }) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success-muted px-2 py-0.5 text-[11px] font-medium text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        {zh ? "就绪" : "Ready"}
      </span>
    );
  }
  if (status === "not_installed") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        {zh ? "未安装" : "Not installed"}
      </span>
    );
  }
  if (status === "auth_required") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-muted px-2 py-0.5 text-[11px] font-medium text-warning">
        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
        {zh ? "需登录" : "Auth required"}
      </span>
    );
  }
  if (status === "detected" || (status as string) === "checking") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-muted-foreground border-t-primary" />
        {zh ? "检测中" : "Checking"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-caution-muted px-2 py-0.5 text-[11px] font-medium text-caution">
      <span className="h-1.5 w-1.5 rounded-full bg-caution" />
      {status.replaceAll("_", " ")}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  ProviderCard                                                       */
/* ------------------------------------------------------------------ */

export function ProviderCard({
  title,
  badge,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  badge: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center justify-between px-4 py-3 transition hover:bg-muted/50"
      >
        <div className="flex items-center gap-2.5">
          {expanded ? (
            <CaretDown size={14} className="text-muted-foreground" />
          ) : (
            <CaretRight size={14} className="text-muted-foreground" />
          )}
          <span className="text-[13px] font-semibold text-foreground">{title}</span>
        </div>
        {badge}
      </button>
      {expanded && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Toggle switch                                                      */
/* ------------------------------------------------------------------ */

export function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? "bg-success" : "bg-muted-foreground/30"}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-[3px]"}`}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Model toggle list                                                  */
/* ------------------------------------------------------------------ */

import { X as XIcon } from "@phosphor-icons/react";

export function ModelToggleList({
  models,
  onToggle,
  onRemove,
  canRemove,
  zh,
}: {
  models: ModelEntry[];
  onToggle: (id: string) => void;
  onRemove?: (id: string) => void;
  canRemove: boolean;
  zh: boolean;
}) {
  if (models.length === 0) {
    return (
      <div className="text-[12px] text-muted-foreground">
        {zh ? "暂无模型" : "No models available"}
      </div>
    );
  }
  const enabledCount = models.filter((m) => m.enabled).length;
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">
        {zh ? "模型" : "Models"} ({enabledCount}/{models.length} {zh ? "已启用" : "enabled"})
      </div>
      <div className="space-y-1">
        {models.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between rounded-md border border-border px-3 py-2"
          >
            <div className="flex items-center gap-2.5">
              <ToggleSwitch
                checked={m.enabled}
                onChange={() => onToggle(m.id)}
                label={`${m.enabled ? "Disable" : "Enable"} ${m.label}`}
              />
              <span
                className={`text-[12px] ${m.enabled ? "text-foreground" : "text-muted-foreground line-through"}`}
              >
                {m.label}
              </span>
            </div>
            {canRemove && onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(m.id)}
                className="text-muted-foreground transition hover:text-destructive"
                aria-label={`Remove ${m.label}`}
              >
                <XIcon size={12} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
