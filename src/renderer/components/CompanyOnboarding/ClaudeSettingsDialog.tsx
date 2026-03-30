import { useEffect } from "react";
import { X } from "@phosphor-icons/react";
import type { AppLocale } from "@shared/locale";
import { useFocusTrap } from "../ui";

interface ClaudeSettingsDialogProps {
  claudeApiKey: string;
  setClaudeApiKey: (v: string) => void;
  claudeBaseUrl: string;
  setClaudeBaseUrl: (v: string) => void;
  claudeModel: string;
  setClaudeModel: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  currentLocale: AppLocale;
}

export function ClaudeSettingsDialog({
  claudeApiKey,
  setClaudeApiKey,
  claudeBaseUrl,
  setClaudeBaseUrl,
  claudeModel,
  setClaudeModel,
  onSave,
  onClose,
  saving,
  currentLocale,
}: ClaudeSettingsDialogProps) {
  const trapRef = useFocusTrap(true);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }; document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey) }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/72 backdrop-blur-sm" onClick={onClose}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-label={currentLocale === "zh" ? "Claude Code 设置" : "Claude Code Settings"} className="w-full max-w-[min(420px,90vw)] rounded-lg border border-border bg-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-foreground">Claude Code {currentLocale === "zh" ? "设置" : "Settings"}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted-foreground transition hover:text-foreground"><X size={16} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label htmlFor="claude-api-key" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">API Key</label>
            <input
              id="claude-api-key"
              type="password"
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground"
              value={claudeApiKey}
              onChange={(e) => setClaudeApiKey(e.target.value)}
              placeholder="sk-ant-..."
            />
            <div className="mt-1 text-[11px] text-muted-foreground">{currentLocale === "zh" ? "留空使用订阅认证" : "Leave empty to use subscription auth"}</div>
          </div>
          <div>
            <label htmlFor="claude-base-url" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Base URL</label>
            <input
              id="claude-base-url"
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground"
              value={claudeBaseUrl}
              onChange={(e) => setClaudeBaseUrl(e.target.value)}
              placeholder="https://api.anthropic.com"
            />
            <div className="mt-1 text-[11px] text-muted-foreground">{currentLocale === "zh" ? "留空使用默认端点" : "Leave empty for default endpoint"}</div>
          </div>
          <div>
            <label htmlFor="claude-model" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Model</label>
            <input
              id="claude-model"
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground"
              value={claudeModel}
              onChange={(e) => setClaudeModel(e.target.value)}
              placeholder="claude-sonnet-4-20250514"
            />
            <div className="mt-1 text-[11px] text-muted-foreground">{currentLocale === "zh" ? "留空使用连接器默认模型" : "Leave empty for connector default"}</div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-[13px] font-medium text-muted-foreground transition hover:text-foreground">
            {currentLocale === "zh" ? "取消" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? (currentLocale === "zh" ? "保存中..." : "Saving...") : (currentLocale === "zh" ? "保存" : "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
